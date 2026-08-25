'use server'

// Server Actions de escritura para el Padrón Web de Socios y Fincas
// (/dashboard/socios). Corren en el servidor con la Service Role Key
// (lib/supabaseServerClient.js) en vez de abrir políticas RLS `anon` de
// escritura sobre PADRON_SOCIOS/PADRON_PARCELAS — decisión confirmada con
// el usuario, ver specs/padron_web_socios.md (padrón maestro, PII real,
// compartido en vivo con otro repositorio).
//
// Como la Service Role Key bypasea RLS, el aislamiento multi-tenant que
// normalmente daría RLS es responsabilidad explícita de este archivo:
// mismo patrón que lib/inspeccionesActions.js::saveInspeccion — la
// organización activa se recibe del cliente (ya resuelta de datos
// visibles por lectura anon), y en edición se valida contra la
// organización REAL del registro existente (leída acá mismo con la
// Service Role Key) antes de escribir, nunca contra un valor que el
// propio formulario pueda inventar.

import { getSupabaseServerClient } from '@/lib/supabaseServerClient'
import { socioSchema, parcelaSchema } from '@/lib/validations/socios'
import { geoJsonToWkt } from '@/lib/geometryImport'
import { SocioActionError } from '@/lib/actions/socioActionError'
import { orgIdsMatch } from '@/lib/actions/orgIdMatch'

/**
 * Registra en consola el objeto `error` real de Postgrest (código, detalle,
 * hint) antes de lanzarlo — sin esto, un error de Supabase que llega hasta
 * la UI como Server Action se serializa como texto genérico y se pierde el
 * detalle que hace falta para diagnosticar (columna inexistente, violación
 * de constraint, etc.).
 */
function throwSupabaseError(context, error) {
  console.error(`[sociosActions] ${context}:`, error)
  throw error
}

function assertOrganizacion(organizationId) {
  if (!organizationId) {
    throw new SocioActionError('No se pudo determinar la organización activa.')
  }
}

async function assertMatchesExistingOrg(supabase, table, pkColumn, pkValue, organizationId) {
  const { data, error } = await supabase
    .from(table)
    .select('ID_Organizacion')
    .eq(pkColumn, pkValue)
    .maybeSingle()
  if (error) throwSupabaseError(`assertMatchesExistingOrg(${table})`, error)
  if (data && data.ID_Organizacion && !orgIdsMatch(data.ID_Organizacion, organizationId)) {
    throw new SocioActionError(
      `Violación multi-tenant: este registro de ${table} no pertenece a la organización activa.`
    )
  }
}

/**
 * Validación específica para PADRON_PARCELAS (fix 2026-08-18, "Violación
 * multi-tenant" falso positivo al editar parcelas): la causa real del
 * bug reportado no era esta función — era que app/dashboard/socios/page.jsx
 * pasaba una organización "adivinada" a nivel de página (la primera vista
 * en la tabla, que puede mezclar más de una organización) en vez de la
 * organización real del socio dueño de la parcela que se estaba editando.
 * Esa parte ya se corrigió en la página. Esta función se endurece además
 * por pedido explícito: si `PADRON_PARCELAS.ID_Organizacion` viniera
 * vacío en algún registro legado, en vez de omitir la validación en
 * silencio (como hacía `assertMatchesExistingOrg` antes), se usa como
 * respaldo la organización real del socio propietario
 * (`PADRON_SOCIOS.ID_Organizacion` vía `ID_Socio`) — nunca un fallback
 * "duro" que deje pasar la escritura sin validar nada.
 */
async function assertParcelaMatchesOrg(supabase, parcelaId, socioId, organizationId) {
  const { data: parcela, error: parcelaErr } = await supabase
    .from('PADRON_PARCELAS')
    .select('ID_Organizacion')
    .eq('ID_Parcela_Fija', parcelaId)
    .maybeSingle()
  if (parcelaErr) throwSupabaseError('assertParcelaMatchesOrg(select parcela)', parcelaErr)
  if (!parcela) return // parcela nueva, nada que validar todavía

  let ownerOrg = parcela.ID_Organizacion

  if (!ownerOrg && socioId) {
    const { data: socio, error: socioErr } = await supabase
      .from('PADRON_SOCIOS')
      .select('ID_Organizacion')
      .eq('ID_Socio', socioId)
      .maybeSingle()
    if (socioErr) throwSupabaseError('assertParcelaMatchesOrg(select socio)', socioErr)
    ownerOrg = socio?.ID_Organizacion
  }

  if (ownerOrg && !orgIdsMatch(ownerOrg, organizationId)) {
    throw new SocioActionError(
      'Violación multi-tenant: esta parcela no pertenece a la organización activa.'
    )
  }
}

/**
 * Anti-duplicados de DNI (2026-08-18, pedido explícito): `socio_dni` no
 * tiene constraint UNIQUE en la base (a diferencia de `ID_Socio`, que ya
 * es PK y por lo tanto Postgres rechaza un duplicado por sí solo — ver
 * el catch de código 23505 en createSocio/createParcela). Alcance
 * confirmado con el usuario: único POR ORGANIZACIÓN, no global — el
 * mismo DNI real puede pertenecer legítimamente a un productor que es
 * socio de dos cooperativas distintas, coherente con el aislamiento
 * multi-tenant del resto del sistema. `excludeSocioId`: en edición, no
 * debe chocar contra el propio registro que se está guardando.
 *
 * INTENCIONAL (ver ADR-016): esta consulta NO excluye socios `activo =
 * false`. Es decisión de negocio confirmada, no un gap pendiente — un DNI
 * de un socio ya dado de baja nunca se reutiliza para un socio nuevo en la
 * misma organización.
 */
async function assertDniNotDuplicated(supabase, dni, organizationId, excludeSocioId) {
  if (!dni) return // DNI es opcional; sin valor no hay nada que chequear
  let query = supabase
    .from('PADRON_SOCIOS')
    .select('ID_Socio')
    .eq('socio_dni', dni)
    .eq('ID_Organizacion', organizationId)
  if (excludeSocioId) {
    query = query.neq('ID_Socio', excludeSocioId)
  }
  const { data, error } = await query
  if (error) throwSupabaseError('assertDniNotDuplicated', error)
  if (data && data.length > 0) {
    throw new SocioActionError(
      `El DNI ${dni} ya está registrado para el socio "${data[0].ID_Socio}" en esta organización.`
    )
  }
}

/** Traduce una violación de PK de Postgres (código 23505) a un mensaje legible. */
function friendlyDuplicateError(error, entityLabel, idValue) {
  if (error?.code === '23505') {
    return new SocioActionError(`Ya existe ${entityLabel} con el código "${idValue}".`)
  }
  return null
}

/**
 * Anti-duplicados de Código de Finca (2026-08-18, pedido explícito).
 * `codigo_finca` es una columna de PADRON_SOCIOS únicamente — no existe en
 * PADRON_PARCELAS (verificado contra docs/schema_live.md antes de escribir
 * esto; la columna equivalente en PADRON_PARCELAS es `parcela_codigo`, un
 * campo distinto, ver assertParcelaCodigoNotDuplicated abajo). Mismo
 * alcance por-organización que assertDniNotDuplicated.
 *
 * INTENCIONAL (ver ADR-016): tampoco excluye socios `activo = false` —
 * mismo criterio de negocio que assertDniNotDuplicated, un Código de Finca
 * de baja nunca se reutiliza.
 */
async function assertCodigoFincaNotDuplicated(supabase, codigoFinca, organizationId, excludeSocioId) {
  if (!codigoFinca) return
  let query = supabase
    .from('PADRON_SOCIOS')
    .select('ID_Socio')
    .eq('codigo_finca', codigoFinca)
    .eq('ID_Organizacion', organizationId)
  if (excludeSocioId) {
    query = query.neq('ID_Socio', excludeSocioId)
  }
  const { data, error } = await query
  if (error) throwSupabaseError('assertCodigoFincaNotDuplicated', error)
  if (data && data.length > 0) {
    throw new SocioActionError(
      `El Código de Finca "${codigoFinca}" ya está registrado para el socio "${data[0].ID_Socio}" en esta organización.`
    )
  }
}

/**
 * Anti-duplicados del código interno de parcela (`parcela_codigo`,
 * PADRON_PARCELAS), por organización.
 *
 * INTENCIONAL (ver ADR-016): NO excluye parcelas `activo = false` — un
 * Código Interno de Parcela de una parcela dada de baja nunca se reutiliza,
 * mismo criterio de negocio que los anti-duplicados de socio arriba.
 */
async function assertParcelaCodigoNotDuplicated(supabase, parcelaCodigo, organizationId, excludeParcelaId) {
  if (!parcelaCodigo) return
  let query = supabase
    .from('PADRON_PARCELAS')
    .select('ID_Parcela_Fija')
    .eq('parcela_codigo', parcelaCodigo)
    .eq('ID_Organizacion', organizationId)
  if (excludeParcelaId) {
    query = query.neq('ID_Parcela_Fija', excludeParcelaId)
  }
  const { data, error } = await query
  if (error) throwSupabaseError('assertParcelaCodigoNotDuplicated', error)
  if (data && data.length > 0) {
    throw new SocioActionError(
      `El Código Interno de Parcela "${parcelaCodigo}" ya está registrado para la parcela "${data[0].ID_Parcela_Fija}" en esta organización.`
    )
  }
}

/**
 * Requiere que el socio referenciado por una parcela YA EXISTA en la
 * organización activa (2026-08-18, pedido explícito, gap real encontrado
 * al revisarlo: `assertMatchesExistingOrg` omite la validación en
 * silencio cuando no encuentra la fila — comportamiento correcto para
 * "estoy editando/dando de baja ESTE registro" pero incorrecto acá, donde
 * `ID_Socio` es una referencia a OTRA entidad que debe preexistir; sin
 * este chequeo, createParcela creaba parcelas huérfanas sin aviso cuando
 * el CSV importado traía un ID_Socio inventado o mal tipeado).
 *
 * INTENCIONAL (ver ADR-016): no distingue `activo`/`inactivo` — solo exige
 * que la fila exista en la organización activa. Confirmado como
 * comportamiento deseado, no un gap: no se cambia a propósito en esta
 * tarea.
 */
async function assertSocioExists(supabase, socioId, organizationId) {
  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .select('ID_Organizacion')
    .eq('ID_Socio', socioId)
    .maybeSingle()
  if (error) throwSupabaseError('assertSocioExists', error)
  const notFound = !data || (data.ID_Organizacion && !orgIdsMatch(data.ID_Organizacion, organizationId))
  if (notFound) {
    throw new SocioActionError(
      `El Código de Socio "${socioId}" no existe en la organización activa. Debe registrar al socio antes de crear/importar sus parcelas.`
    )
  }
}

function socioPayload(values) {
  return {
    codigo_finca: values.codigo_finca || null,
    socio_nombre_completo: values.socio_nombre_completo,
    socio_dni: values.socio_dni || null,
    socio_genero: values.socio_genero || null,
    socio_fecha_nacimiento: values.socio_fecha_nacimiento || null,
    celular_socio: values.celular_socio || null,
    conyuge_nombre: values.conyuge_nombre || null,
    conyuge_dni: values.conyuge_dni || null,
    socio_departamento: values.socio_departamento || null,
    socio_provincia: values.socio_provincia || null,
    socio_distrito: values.socio_distrito || null,
    localidad: values.localidad || null,
    certificaciones: values.certificaciones || null,
    cert_org_estatus: values.cert_org_estatus || null,
    cert_nop_usda: values.cert_nop_usda || null,
    ue_2018_848: values.ue_2018_848 || null,
    cor_canada: values.cor_canada || null,
    cert_ds_0442006_ag: values.cert_ds_0442006_ag || null,
    cert_lpo_mx: values.cert_lpo_mx || null,
    cert_rainforest: values.cert_rainforest || null,
    cert_comercio_justo: values.cert_comercio_justo || null,
    cert_fair_trade_usa: values.cert_fair_trade_usa || null,
    socio_fecha_ingreso: values.socio_fecha_ingreso || null,
  }
}

/**
 * Crea un socio nuevo. `organizationId`: resuelta del lado del cliente.
 *
 * Un socio con 0 parcelas es un estado válido, no un error — la relación
 * Socio-Parcela es 1-a-N opcional en este sentido: `socioSchema` no
 * depende de PADRON_PARCELAS de ninguna forma, y nada en este archivo
 * exige que un socio tenga al menos una parcela (ver también
 * deactivateSocio, que tolera `parcelasDeactivated: 0` sin error).
 */
export async function createSocio(values, organizationId) {
  assertOrganizacion(organizationId)
  const parsed = socioSchema.parse(values)
  const supabase = getSupabaseServerClient()

  await assertDniNotDuplicated(supabase, parsed.socio_dni, organizationId, null)
  await assertCodigoFincaNotDuplicated(supabase, parsed.codigo_finca, organizationId, null)

  const { error } = await supabase
    .from('PADRON_SOCIOS')
    .insert({ ID_Socio: parsed.ID_Socio, ID_Organizacion: organizationId, ...socioPayload(parsed) })
  if (error) {
    const friendly = friendlyDuplicateError(error, 'un socio', parsed.ID_Socio)
    if (friendly) throw friendly
    throwSupabaseError('createSocio(insert)', error)
  }

  // socio_nombre_completo (ADR-021): aditivo, no rompe a nadie que ya
  // desestructuraba { id, created } de este retorno (app/dashboard/socios/page.jsx
  // solo usa `created`) — lo necesita el Editor Vectorial para mostrar el
  // nombre real del socio recién creado al abrir "+ Crear parcela nueva"
  // (ParcelaFormModal necesita socio.socio_nombre_completo), sin tener que
  // volver a consultarlo.
  return { id: parsed.ID_Socio, created: true, socio_nombre_completo: parsed.socio_nombre_completo }
}

/** Edita un socio existente. Rechaza si no pertenece a `organizationId`. */
export async function updateSocio(values, organizationId) {
  assertOrganizacion(organizationId)
  const parsed = socioSchema.parse(values)
  const supabase = getSupabaseServerClient()

  await assertMatchesExistingOrg(supabase, 'PADRON_SOCIOS', 'ID_Socio', parsed.ID_Socio, organizationId)
  await assertDniNotDuplicated(supabase, parsed.socio_dni, organizationId, parsed.ID_Socio)
  await assertCodigoFincaNotDuplicated(supabase, parsed.codigo_finca, organizationId, parsed.ID_Socio)

  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .update(socioPayload(parsed))
    .eq('ID_Socio', parsed.ID_Socio)
    .select('ID_Socio')
  if (error) throwSupabaseError('updateSocio(update)', error)
  if (!data || data.length === 0) {
    throw new SocioActionError(
      `No se encontró el socio "${parsed.ID_Socio}" para actualizar (0 filas afectadas). El cambio NO se guardó.`
    )
  }

  return { id: parsed.ID_Socio, created: false }
}

/**
 * Sanitiza una geometría (GeoJSON ya parseada, ver lib/geometryImport.js)
 * vía la RPC fn_sanitize_geometry (EPSG:4326, 6 decimales, reparación
 * topológica) y devuelve el WKT resultante listo para guardar en
 * PADRON_PARCELAS.geom. `null` si no se proveyó geometría — una parcela
 * sin geometría es válida (mayoría de los registros reales hoy).
 */
async function sanitizeGeometryForStorage(supabase, geometry) {
  if (!geometry) return null
  const inputWkt = geoJsonToWkt(geometry)
  const { data, error } = await supabase.rpc('fn_sanitize_geometry', { p_geom: inputWkt })
  if (error) throwSupabaseError('sanitizeGeometryForStorage(rpc)', error)
  return geoJsonToWkt(data)
}

function parcelaPayload(values, totalh) {
  return {
    ID_Socio: values.ID_Socio,
    parcela_codigo: values.parcela_codigo || null,
    parcela_nombre: values.parcela_nombre || null,
    hcp: values.hcp ?? null,
    hcc: values.hcc ?? null,
    ho: values.ho ?? null,
    hip: values.hip ?? null,
    hrp: values.hrp ?? null,
    hbp: values.hbp ?? null,
    otros_cultivo: values.otros_cultivo ?? null,
    totalh,
  }
}

function computeTotalHectares(values) {
  const parts = [values.hcp, values.hcc, values.ho, values.hip, values.hrp, values.hbp, values.otros_cultivo]
  const sum = parts.reduce((acc, v) => acc + (Number(v) || 0), 0)
  return Number(sum.toFixed(4))
}

/**
 * Crea una parcela nueva. `geometry` (opcional): objeto GeoJSON ya
 * parseado del lado del cliente vía lib/geometryImport.js — se sanitiza
 * acá antes de guardar.
 */
export async function createParcela(values, organizationId, geometry = null) {
  assertOrganizacion(organizationId)
  const parsed = parcelaSchema.parse(values)
  const supabase = getSupabaseServerClient()

  await assertSocioExists(supabase, parsed.ID_Socio, organizationId)
  await assertParcelaCodigoNotDuplicated(supabase, parsed.parcela_codigo, organizationId, null)

  const sanitizedGeom = await sanitizeGeometryForStorage(supabase, geometry)
  const totalh = computeTotalHectares(parsed)

  const { error } = await supabase.from('PADRON_PARCELAS').insert({
    ID_Parcela_Fija: parsed.ID_Parcela_Fija,
    ID_Organizacion: organizationId,
    geom: sanitizedGeom,
    ...parcelaPayload(parsed, totalh),
  })
  if (error) {
    const friendly = friendlyDuplicateError(error, 'una parcela', parsed.ID_Parcela_Fija)
    if (friendly) throw friendly
    throwSupabaseError('createParcela(insert)', error)
  }

  return { id: parsed.ID_Parcela_Fija, created: true }
}

/** Edita una parcela existente. Rechaza si no pertenece a `organizationId`. */
export async function updateParcela(values, organizationId, geometry = null) {
  assertOrganizacion(organizationId)
  const parsed = parcelaSchema.parse(values)
  const supabase = getSupabaseServerClient()

  await assertParcelaMatchesOrg(supabase, parsed.ID_Parcela_Fija, parsed.ID_Socio, organizationId)
  await assertParcelaCodigoNotDuplicated(supabase, parsed.parcela_codigo, organizationId, parsed.ID_Parcela_Fija)

  const totalh = computeTotalHectares(parsed)
  const updatePayload = parcelaPayload(parsed, totalh)

  if (geometry) {
    updatePayload.geom = await sanitizeGeometryForStorage(supabase, geometry)
  }

  const { data, error } = await supabase
    .from('PADRON_PARCELAS')
    .update(updatePayload)
    .eq('ID_Parcela_Fija', parsed.ID_Parcela_Fija)
    .select('ID_Parcela_Fija')
  if (error) throwSupabaseError('updateParcela(update)', error)
  if (!data || data.length === 0) {
    throw new SocioActionError(
      `No se encontró la parcela "${parsed.ID_Parcela_Fija}" para actualizar (0 filas afectadas). El cambio NO se guardó.`
    )
  }

  return { id: parsed.ID_Parcela_Fija, created: false }
}

/**
 * Baja lógica de un socio (activo = false, nunca DELETE físico —
 * decisión confirmada con el usuario, ver
 * supabase/migrations/20260818_padron_baja_logica.sql: el padrón es
 * compartido en vivo con otro repositorio y sus IDs pueden estar
 * referenciados desde INSPECCIONES/EUDR_MONITOREO). Requiere esa
 * migración aplicada — sin ella, falla con "column ... activo does not
 * exist".
 *
 * Cascada (2026-08-18, pedido explícito): da de baja también todas las
 * parcelas del socio en PADRON_PARCELAS — un socio inactivo no debería
 * dejar parcelas "activas" huérfanas en el padrón. Alcance deliberadamente
 * limitado a PADRON_PARCELAS: NO toca EUDR_MONITOREO ni las vistas
 * WebGIS/EUDR (vw_monitoreo_web, view_eudr_dashboard_aprobados) —
 * decisión confirmada con el usuario: ese historial de monitoreo/
 * trazabilidad debe sobrevivir a que un socio se dé de baja
 * administrativamente del padrón (implicancia de cumplimiento EUDR, no
 * solo de UI).
 */
export async function deactivateSocio(socioId, organizationId) {
  assertOrganizacion(organizationId)
  if (!socioId) throw new SocioActionError('Falta el ID del socio a dar de baja.')
  const supabase = getSupabaseServerClient()

  await assertMatchesExistingOrg(supabase, 'PADRON_SOCIOS', 'ID_Socio', socioId, organizationId)

  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .update({ activo: false })
    .eq('ID_Socio', socioId)
    .select('ID_Socio, activo')
  if (error) throwSupabaseError('deactivateSocio(update)', error)
  if (!data || data.length === 0) {
    throw new SocioActionError(
      `No se encontró el socio "${socioId}" para dar de baja (0 filas afectadas). El cambio NO se guardó.`
    )
  }
  console.info('[sociosActions][audit] deactivateSocio:', JSON.stringify(data))

  const { data: parcelasData, error: parcelasErr } = await supabase
    .from('PADRON_PARCELAS')
    .update({ activo: false })
    .eq('ID_Socio', socioId)
    .select('ID_Parcela_Fija, activo')
  if (parcelasErr) throwSupabaseError('deactivateSocio(cascade parcelas)', parcelasErr)
  console.info('[sociosActions][audit] deactivateSocio cascade parcelas:', JSON.stringify(parcelasData))

  return { id: socioId, deactivated: true, parcelasDeactivated: parcelasData?.length ?? 0 }
}

/** Baja lógica de una parcela (activo = false) — mismo criterio que deactivateSocio. */
export async function deactivateParcela(parcelaId, socioId, organizationId) {
  assertOrganizacion(organizationId)
  if (!parcelaId) throw new SocioActionError('Falta el ID de la parcela a dar de baja.')
  const supabase = getSupabaseServerClient()

  await assertParcelaMatchesOrg(supabase, parcelaId, socioId, organizationId)

  const { data, error } = await supabase
    .from('PADRON_PARCELAS')
    .update({ activo: false })
    .eq('ID_Parcela_Fija', parcelaId)
    .select('ID_Parcela_Fija, activo')
  if (error) throwSupabaseError('deactivateParcela(update)', error)
  if (!data || data.length === 0) {
    throw new SocioActionError(
      `No se encontró la parcela "${parcelaId}" para dar de baja (0 filas afectadas). El cambio NO se guardó.`
    )
  }
  console.info('[sociosActions][audit] deactivateParcela:', JSON.stringify(data))

  return { id: parcelaId, deactivated: true }
}
