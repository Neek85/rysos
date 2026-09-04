'use server'

// Server Actions de escritura para el Padrón Web de Socios y Fincas
// (/dashboard/socios). Nunca se abrió política RLS `anon` de escritura
// sobre PADRON_SOCIOS/PADRON_PARCELAS — decisión original confirmada con
// el usuario, ver specs/padron_web_socios.md (padrón maestro, PII real;
// la nota de corrección de premisa ahí aclara que "compartido con otro
// repositorio" ya no aplica desde ADR-023, pero evitar anon sigue vigente
// por PII).
//
// HISTORIAL — por qué Service Role Key en su momento: sin sesión real
// server-side disponible (antes de Fase B) ni RLS real por organización
// en las tablas involucradas (antes de ADR-034), la única forma de que
// este módulo escribiera en absoluto era bypasear RLS por completo. El
// aislamiento multi-tenant era entonces responsabilidad explícita de
// este archivo — mismo patrón que lib/inspeccionesActions.js::saveInspeccion:
// la organización activa se recibe del cliente, y en edición se valida
// contra la organización REAL del registro existente antes de escribir,
// nunca contra un valor que el propio formulario pueda inventar.
//
// PILOTO CAMINO 1 — COMPLETO (Fase A.1 + A.2, ver
// docs/adr/ADR-036-migracion-parcial-camino-1-sociosactions.md y
// docs/adr/ADR-037-fase-a2-rls-certificaciones-socios.md): las 7
// funciones exportadas de este archivo corren hoy con la SESIÓN REAL del
// usuario (`createSessionServerClient`), no con Service Role Key — RLS
// es la autoridad real, no un bypass: ADR-034 para
// PADRON_SOCIOS/PADRON_PARCELAS (Fase A.1, `updateParcela`/
// `createParcela`/`deactivateParcela`/`deactivateSocio`), y la migración
// de Fase A.2 (`20260904174237_fase_a2_rls_certificaciones_socios.sql`)
// para SOCIO_CERTIFICACIONES/CERTIFICACIONES_CATALOGO + el `GRANT
// EXECUTE` de `fn_crear_socio_con_certificaciones` (`createSocio`/
// `updateSocio`/`resolveSocioCertFlags`). La validación de aplicación
// documentada arriba (organización recibida del cliente, validada contra
// el registro real antes de escribir) se mantiene igual en las 7 — ya no
// es la única barrera, es defensa en profundidad sobre el RLS real (ver
// ADR-036/037, "Nota de comportamiento": bajo RLS de sesión, un intento
// con la organización equivocada falla por RLS/0-filas antes de llegar a
// esa validación, no después).

import { createSessionServerClient } from '@/lib/supabase/sessionServerClient'
import { socioSchema, parcelaSchema, CERT_FLAG_FIELDS, ORGANIC_CERT_CODES } from '@/lib/validations/socios'
import { geoJsonToWkt } from '@/lib/geometryImport'
import { SocioActionError } from '@/lib/actions/socioActionError'
import { orgIdsMatch } from '@/lib/actions/orgIdMatch'
import { fetchSocioCertOrgEstatus } from '@/lib/padronCsv'

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

// HOTFIX PK multi-organización (2026-08-25, ver
// specs/multi_organizacion_codigos_unicos.md): pkColumn (ID_Socio/
// ID_Parcela_Fija) ya no identifica una única fila -- puede haber una por
// organización que use ese mismo código. .maybeSingle() lanzaría
// PGRST116 ("multiple rows returned") apenas dos organizaciones
// compartan un código. Se reemplaza por un SELECT sin límite de filas: si
// CUALQUIERA de las filas devueltas pertenece a una organización
// distinta de organizationId, sigue siendo una violación real (mismo
// mensaje que antes). Si no encuentra ninguna fila, sigue pasando en
// silencio -- comportamiento intencional preexistente, ver docstring de
// assertParcelaMatchesOrg abajo.
async function assertMatchesExistingOrg(supabase, table, pkColumn, pkValue, organizationId) {
  const { data, error } = await supabase.from(table).select('ID_Organizacion').eq(pkColumn, pkValue)
  if (error) throwSupabaseError(`assertMatchesExistingOrg(${table})`, error)
  const belongsToOtherOrg = (data ?? []).some(
    (row) => row.ID_Organizacion && !orgIdsMatch(row.ID_Organizacion, organizationId)
  )
  if (belongsToOtherOrg) {
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
// HOTFIX PK multi-organización (2026-08-25): mismo motivo que
// assertMatchesExistingOrg arriba -- ID_Parcela_Fija/ID_Socio ya no son
// PK, así que ambas consultas pueden devolver más de una fila (una por
// organización). En vez de "el único dueño", se chequea "¿organizationId
// está entre los dueños conocidos?" -- equivalente exacto de la lógica
// original (que comparaba un solo ownerOrg) para el caso de una sola
// fila, y ahora también correcto cuando hay varias.
async function assertParcelaMatchesOrg(supabase, parcelaId, socioId, organizationId) {
  const { data: parcelas, error: parcelaErr } = await supabase
    .from('PADRON_PARCELAS')
    .select('ID_Organizacion')
    .eq('ID_Parcela_Fija', parcelaId)
  if (parcelaErr) throwSupabaseError('assertParcelaMatchesOrg(select parcela)', parcelaErr)
  if (!parcelas || parcelas.length === 0) return // parcela nueva, nada que validar todavía

  const parcelaOrgs = parcelas.map((p) => p.ID_Organizacion).filter(Boolean)
  let ownerConfirmed = parcelaOrgs.length === 0 || parcelaOrgs.some((org) => orgIdsMatch(org, organizationId))

  if (parcelaOrgs.length === 0 && socioId) {
    const { data: socios, error: socioErr } = await supabase
      .from('PADRON_SOCIOS')
      .select('ID_Organizacion')
      .eq('ID_Socio', socioId)
    if (socioErr) throwSupabaseError('assertParcelaMatchesOrg(select socio)', socioErr)
    const socioOrgs = (socios ?? []).map((s) => s.ID_Organizacion).filter(Boolean)
    ownerConfirmed = socioOrgs.length === 0 || socioOrgs.some((org) => orgIdsMatch(org, organizationId))
  }

  if (!ownerConfirmed) {
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
 * PADRON_PARCELAS (verificado contra docs/schema_live_core.md antes de escribir
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
// HOTFIX PK multi-organización (2026-08-25): a diferencia de
// assertMatchesExistingOrg/assertParcelaMatchesOrg (que necesitan
// distinguir "pertenece a otra organización" de "no existe"), acá
// organizationId ya es un dato conocido y el mensaje de error no
// distingue esos dos casos -- filtrar la consulta por ambas columnas
// directamente (ID_Socio, ID_Organizacion) es más simple y, tras el
// UNIQUE(ID_Organizacion, ID_Socio) de la migración de PK, vuelve a
// garantizar 0-o-1 fila, así que .maybeSingle() es seguro de nuevo.
async function assertSocioExists(supabase, socioId, organizationId) {
  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .select('ID_Organizacion')
    .eq('ID_Socio', socioId)
    .eq('ID_Organizacion', organizationId)
    .maybeSingle()
  if (error) throwSupabaseError('assertSocioExists', error)
  if (!data) {
    throw new SocioActionError(
      `El Código de Socio "${socioId}" no existe en la organización activa. Debe registrar al socio antes de crear/importar sus parcelas.`
    )
  }
}

// ADR-027 (specs/padron_certificaciones_normalizado.md sección 3):
// certificaciones/cert_org_estatus/8 flags quedan FUERA de este payload
// a propósito -- esas columnas de PADRON_SOCIOS quedan congeladas en su
// valor actual (respaldo, no se tocan de acá en adelante). El destino
// real de esos campos del formulario ahora es syncSocioCertificaciones,
// abajo -- socioSchema sigue validando estos 8 campos igual que siempre
// (SocioFormModal.jsx no cambió), solo que ya no se escriben acá.
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
    socio_fecha_ingreso: values.socio_fecha_ingreso || null,
  }
}

/**
 * ADR-027 — sincroniza SOCIO_CERTIFICACIONES para un socio a partir de
 * los mismos 8 campos Sí/No que siempre validó `socioSchema`
 * (`CERT_FLAG_FIELDS`) + `cert_org_estatus`, ambos del payload ya
 * parseado (`parsed`), nunca leídos de vuelta de `PADRON_SOCIOS` (esas
 * columnas quedan congeladas, ver `socioPayload`).
 *
 * Estrategia "borrar todo + reinsertar": simple y siempre correcta —
 * permite tanto agregar como QUITAR una certificación en una edición
 * (algo que un `upsert` no puede hacer: no hay forma de "des-marcar" una
 * fila existente salvo borrándola, y `SOCIO_CERTIFICACIONES` no tiene
 * columna de baja lógica, es presencia pura). Costo aceptado: refresca
 * `creado_en` de certificaciones que no cambiaron. Dos pasos secuenciales
 * sin transacción real (mismo patrón ya usado en `deactivateSocio`, dos
 * `UPDATE` secuenciales) — si el `DELETE` tiene éxito y el `INSERT`
 * falla, el socio queda momentáneamente sin certificaciones hasta el
 * próximo guardado exitoso; riesgo aceptado, no bloqueante.
 *
 * `estado`: copia `cert_org_estatus` SOLO para las 5 certificaciones de
 * tipo "equivalencia orgánica" (`ORGANIC_CERT_CODES`) — mismo criterio
 * que el backfill de la migración
 * (`20260825222933_certificaciones_normalizadas.sql`), documentado con
 * su evidencia real en `specs/padron_certificaciones_normalizado.md`
 * sección 3.4. Las otras 3 quedan con `estado = NULL`.
 *
 * Una certificación del catálogo que ya no exista o esté `activo = false`
 * se omite en silencio (no rompe el guardado del socio por un catálogo
 * desactualizado) — igual que `parseCsv`/`normalizeRowKeys` tratan una
 * columna reconocida pero inactiva en `lib/padronCsv.js`.
 */
async function syncSocioCertificaciones(supabase, socioUuid, organizationId, parsed) {
  const { data: catalogo, error: catalogoErr } = await supabase
    .from('CERTIFICACIONES_CATALOGO')
    .select('id, codigo')
    .eq('activo', true)
  if (catalogoErr) throwSupabaseError('syncSocioCertificaciones(catalogo)', catalogoErr)
  const idByCodigo = new Map((catalogo ?? []).map((c) => [c.codigo, c.id]))

  const { error: deleteErr } = await supabase.from('SOCIO_CERTIFICACIONES').delete().eq('id_socio', socioUuid)
  if (deleteErr) throwSupabaseError('syncSocioCertificaciones(delete)', deleteErr)

  const rows = CERT_FLAG_FIELDS.filter(({ field }) => parsed[field] === 'Sí')
    .map(({ codigo }) => {
      const idCertificacion = idByCodigo.get(codigo)
      if (!idCertificacion) return null
      return {
        id_socio: socioUuid,
        id_organizacion: organizationId,
        id_certificacion: idCertificacion,
        estado: ORGANIC_CERT_CODES.includes(codigo) ? parsed.cert_org_estatus || null : null,
      }
    })
    .filter(Boolean)

  if (rows.length === 0) return
  const { error: insertErr } = await supabase.from('SOCIO_CERTIFICACIONES').insert(rows)
  if (insertErr) throwSupabaseError('syncSocioCertificaciones(insert)', insertErr)
}

/**
 * Crea un socio nuevo. `organizationId`: resuelta del lado del cliente.
 *
 * Un socio con 0 parcelas es un estado válido, no un error — la relación
 * Socio-Parcela es 1-a-N opcional en este sentido: `socioSchema` no
 * depende de PADRON_PARCELAS de ninguna forma, y nada en este archivo
 * exige que un socio tenga al menos una parcela (ver también
 * deactivateSocio, que tolera `parcelasDeactivated: 0` sin error).
 *
 * Mejoras importador padrón masivo (spec sección 12, ronda 9): el INSERT
 * a PADRON_SOCIOS y el alta de sus certificaciones ahora son UNA sola
 * llamada RPC transaccional (`fn_crear_socio_con_certificaciones`,
 * supabase/migrations/20260901120000_socio_creacion_atomica.sql) --
 * antes eran 3 llamadas independientes (insert + syncSocioCertificaciones,
 * que a su vez hacía SELECT+DELETE+INSERT), sin transacción de base de
 * datos, así que un corte a mitad de camino podía dejar un socio creado
 * sin ninguna de sus certificaciones -- permanente, porque un reintento
 * de la misma fila del CSV detecta el ID_Socio ya existente y la omite
 * como duplicado, nunca vuelve a sincronizar certificaciones para ese
 * socio. Mismo patrón ya probado en
 * lib/inspeccionesActions.js::saveInspeccion (fn_guardar_inspeccion_completa).
 * `updateSocio` (edición) NO se toca -- sigue usando
 * `syncSocioCertificaciones` tal cual, riesgo ya aceptado y documentado
 * ahí, fuera de alcance de este fix (específico de la carga masiva/alta
 * nueva).
 */
export async function createSocio(values, organizationId) {
  assertOrganizacion(organizationId)
  const parsed = socioSchema.parse(values)
  const supabase = await createSessionServerClient()

  await assertDniNotDuplicated(supabase, parsed.socio_dni, organizationId, null)
  await assertCodigoFincaNotDuplicated(supabase, parsed.codigo_finca, organizationId, null)

  // Mismo filtro/mapeo que syncSocioCertificaciones (JS) ya hacía --
  // solo las 8 marcadas 'Sí', `estado` = cert_org_estatus SOLO para las 5
  // de equivalencia orgánica. El codigo->id del catálogo se resuelve
  // DENTRO de la función RPC, no acá -- ver la migración.
  const certificaciones = CERT_FLAG_FIELDS.filter(({ field }) => parsed[field] === 'Sí').map(({ codigo }) => ({
    codigo,
    estado: ORGANIC_CERT_CODES.includes(codigo) ? parsed.cert_org_estatus || null : null,
  }))

  const { error } = await supabase.rpc('fn_crear_socio_con_certificaciones', {
    p_id_socio: parsed.ID_Socio,
    p_organizacion: organizationId,
    p_socio: socioPayload(parsed),
    p_certificaciones: certificaciones,
  })
  if (error) {
    const friendly = friendlyDuplicateError(error, 'un socio', parsed.ID_Socio)
    if (friendly) throw friendly
    throwSupabaseError('createSocio(rpc)', error)
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
  const supabase = await createSessionServerClient()

  await assertMatchesExistingOrg(supabase, 'PADRON_SOCIOS', 'ID_Socio', parsed.ID_Socio, organizationId)
  await assertDniNotDuplicated(supabase, parsed.socio_dni, organizationId, parsed.ID_Socio)
  await assertCodigoFincaNotDuplicated(supabase, parsed.codigo_finca, organizationId, parsed.ID_Socio)

  // HOTFIX PK multi-organización (2026-08-25): ID_Organizacion en el
  // propio WHERE del UPDATE, no solo en el guard previo -- defensa en
  // profundidad real, no redundante: sin esto, un ID_Socio compartido con
  // otra organización coincidiría con TODAS sus filas, no solo la de
  // organizationId.
  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .update(socioPayload(parsed))
    .eq('ID_Socio', parsed.ID_Socio)
    .eq('ID_Organizacion', organizationId)
    .select('id, ID_Socio')
  if (error) throwSupabaseError('updateSocio(update)', error)
  if (!data || data.length === 0) {
    throw new SocioActionError(
      `No se encontró el socio "${parsed.ID_Socio}" para actualizar (0 filas afectadas). El cambio NO se guardó.`
    )
  }

  // ADR-027: mismo criterio que createSocio -- sincroniza el set
  // completo de certificaciones del socio (agrega y quita según lo que
  // venga marcado ahora en el formulario).
  await syncSocioCertificaciones(supabase, data[0].id, organizationId, parsed)

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
    // ADR-028: dato maestro editable -- '' del <select> sin selección se
    // normaliza a null, nunca se guarda como string vacío.
    id_producto_predominante: values.id_producto_predominante || null,
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
  const supabase = await createSessionServerClient()

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
  const supabase = await createSessionServerClient()

  await assertParcelaMatchesOrg(supabase, parsed.ID_Parcela_Fija, parsed.ID_Socio, organizationId)
  await assertParcelaCodigoNotDuplicated(supabase, parsed.parcela_codigo, organizationId, parsed.ID_Parcela_Fija)

  const totalh = computeTotalHectares(parsed)
  const updatePayload = parcelaPayload(parsed, totalh)

  if (geometry) {
    updatePayload.geom = await sanitizeGeometryForStorage(supabase, geometry)
  }

  // HOTFIX PK multi-organización (2026-08-25): mismo motivo que
  // updateSocio -- ID_Organizacion en el propio WHERE del UPDATE.
  const { data, error } = await supabase
    .from('PADRON_PARCELAS')
    .update(updatePayload)
    .eq('ID_Parcela_Fija', parsed.ID_Parcela_Fija)
    .eq('ID_Organizacion', organizationId)
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
  const supabase = await createSessionServerClient()

  await assertMatchesExistingOrg(supabase, 'PADRON_SOCIOS', 'ID_Socio', socioId, organizationId)

  // HOTFIX PK multi-organización (2026-08-25): ID_Organizacion en el
  // propio WHERE, mismo motivo que updateSocio/updateParcela.
  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .update({ activo: false })
    .eq('ID_Socio', socioId)
    .eq('ID_Organizacion', organizationId)
    .select('ID_Socio, activo')
  if (error) throwSupabaseError('deactivateSocio(update)', error)
  if (!data || data.length === 0) {
    throw new SocioActionError(
      `No se encontró el socio "${socioId}" para dar de baja (0 filas afectadas). El cambio NO se guardó.`
    )
  }
  console.info('[sociosActions][audit] deactivateSocio:', JSON.stringify(data))

  // HOTFIX PK multi-organización (2026-08-25) -- el sitio más peligroso
  // de toda la auditoría (specs/multi_organizacion_codigos_unicos.md):
  // sin ID_Organizacion acá, dar de baja un socio en la Organización A
  // desactivaría también las parcelas de cualquier socio con el mismo
  // ID_Socio en la Organización B.
  const { data: parcelasData, error: parcelasErr } = await supabase
    .from('PADRON_PARCELAS')
    .update({ activo: false })
    .eq('ID_Socio', socioId)
    .eq('ID_Organizacion', organizationId)
    .select('ID_Parcela_Fija, activo')
  if (parcelasErr) throwSupabaseError('deactivateSocio(cascade parcelas)', parcelasErr)
  console.info('[sociosActions][audit] deactivateSocio cascade parcelas:', JSON.stringify(parcelasData))

  return { id: socioId, deactivated: true, parcelasDeactivated: parcelasData?.length ?? 0 }
}

/** Baja lógica de una parcela (activo = false) — mismo criterio que deactivateSocio. */
export async function deactivateParcela(parcelaId, socioId, organizationId) {
  assertOrganizacion(organizationId)
  if (!parcelaId) throw new SocioActionError('Falta el ID de la parcela a dar de baja.')
  const supabase = await createSessionServerClient()

  await assertParcelaMatchesOrg(supabase, parcelaId, socioId, organizationId)

  // HOTFIX PK multi-organización (2026-08-25): ID_Organizacion en el
  // propio WHERE, mismo motivo que el resto de escrituras de este archivo.
  const { data, error } = await supabase
    .from('PADRON_PARCELAS')
    .update({ activo: false })
    .eq('ID_Parcela_Fija', parcelaId)
    .eq('ID_Organizacion', organizationId)
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

/**
 * ADR-027 — resuelve los 8 flags de certificación REALES de un socio
 * existente desde `SOCIO_CERTIFICACIONES` (fuente de verdad desde la
 * migración de normalización), para que `SocioFormModal.jsx` pueda
 * preseleccionar sus 8 `<select>` Sí/No al abrir el modal de EDICIÓN.
 *
 * Hasta ahora el modal tomaba el valor inicial directo de
 * `socio.cert_nop_usda`/etc. -- las 8 columnas de `PADRON_SOCIOS`, que
 * `socioPayload()` (arriba) ya no escribe desde ADR-027 y que
 * `fn_listar_padron_socios` sigue devolviendo tal cual quedaron
 * congeladas -- por eso el modal mostraba "— Sin dato —" para cualquier
 * socio creado o editado después de esa migración (ver AI_STATE.md
 * "Fix autoselect de certificaciones en SocioFormModal.jsx").
 *
 * `PADRON_SOCIOS` ya no admite `SELECT` con `anon` (ADR-031, `USING
 * (false)`), así que el `id` (uuid, FK real de `SOCIO_CERTIFICACIONES.id_socio`)
 * no se puede resolver desde el cliente ni viene en `fn_listar_padron_socios`
 * (no expone `id`) -- se resuelve acá con la Service Role Key, igual que
 * el resto de este archivo. No hace falta ninguna función SQL
 * `SECURITY DEFINER` nueva para esto: la Service Role Key ya bypasea RLS
 * por sí sola (mismo motivo por el que `updateSocio` ya hace
 * `.select('id, ID_Socio')` contra `PADRON_SOCIOS` unas líneas más
 * arriba sin necesitar ninguna función intermedia).
 *
 * `cert_org_estatus` (2026-09-01, ver AI_STATE.md "Fix cert_org_estatus
 * desactualizado"): mismo defecto, mismo fix -- el campo de texto libre
 * "Estatus de Certificación Orgánica" del modal también leía la columna
 * congelada de `PADRON_SOCIOS`. Se resuelve acá reutilizando el uuid ya
 * obtenido arriba (evita un segundo roundtrip para resolverlo de nuevo)
 * y la MISMA lógica de negocio que ya usa `exportSociosCsv`
 * (`fetchSocioCertOrgEstatus`, `lib/padronCsv.js`) -- "valor consistente
 * entre las 5 certificaciones orgánicas (`ORGANIC_CERT_CODES`), o la más
 * reciente por `actualizado_en` si divergen" -- para no reimplementar
 * ese criterio dos veces.
 */
export async function resolveSocioCertFlags(socioId, organizationId) {
  assertOrganizacion(organizationId)
  const supabase = await createSessionServerClient()
  const result = Object.fromEntries(CERT_FLAG_FIELDS.map(({ field }) => [field, 'No']))
  result.cert_org_estatus = ''

  const { data: socioRow, error: socioErr } = await supabase
    .from('PADRON_SOCIOS')
    .select('id')
    .eq('ID_Socio', socioId)
    .eq('ID_Organizacion', organizationId)
    .maybeSingle()
  if (socioErr) throwSupabaseError('resolveSocioCertFlags(socio)', socioErr)
  if (!socioRow) return result

  const { data: catalogo, error: catalogoErr } = await supabase
    .from('CERTIFICACIONES_CATALOGO')
    .select('id, codigo')
    .eq('activo', true)
  if (catalogoErr) throwSupabaseError('resolveSocioCertFlags(catalogo)', catalogoErr)
  const codigoById = new Map((catalogo ?? []).map((c) => [c.id, c.codigo]))

  const { data: rows, error: certErr } = await supabase
    .from('SOCIO_CERTIFICACIONES')
    .select('id_certificacion')
    .eq('id_socio', socioRow.id)
  if (certErr) throwSupabaseError('resolveSocioCertFlags(certificaciones)', certErr)

  const ownedCodigos = new Set((rows ?? []).map((r) => codigoById.get(r.id_certificacion)).filter(Boolean))
  for (const { field, codigo } of CERT_FLAG_FIELDS) {
    if (ownedCodigos.has(codigo)) result[field] = 'Sí'
  }

  const estatusBySocio = await fetchSocioCertOrgEstatus(supabase, [socioRow.id])
  result.cert_org_estatus = estatusBySocio.get(socioRow.id) ?? ''

  return result
}
