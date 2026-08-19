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
  if (error) throw error
  if (data && data.ID_Organizacion && data.ID_Organizacion !== organizationId) {
    throw new SocioActionError(
      `Violación multi-tenant: este registro de ${table} no pertenece a la organización activa.`
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

/** Crea un socio nuevo. `organizationId`: resuelta del lado del cliente. */
export async function createSocio(values, organizationId) {
  assertOrganizacion(organizationId)
  const parsed = socioSchema.parse(values)
  const supabase = getSupabaseServerClient()

  const { error } = await supabase
    .from('PADRON_SOCIOS')
    .insert({ ID_Socio: parsed.ID_Socio, ID_Organizacion: organizationId, ...socioPayload(parsed) })
  if (error) throw error

  return { id: parsed.ID_Socio, created: true }
}

/** Edita un socio existente. Rechaza si no pertenece a `organizationId`. */
export async function updateSocio(values, organizationId) {
  assertOrganizacion(organizationId)
  const parsed = socioSchema.parse(values)
  const supabase = getSupabaseServerClient()

  await assertMatchesExistingOrg(supabase, 'PADRON_SOCIOS', 'ID_Socio', parsed.ID_Socio, organizationId)

  const { error } = await supabase
    .from('PADRON_SOCIOS')
    .update(socioPayload(parsed))
    .eq('ID_Socio', parsed.ID_Socio)
  if (error) throw error

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
  if (error) throw error
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

  await assertMatchesExistingOrg(supabase, 'PADRON_SOCIOS', 'ID_Socio', parsed.ID_Socio, organizationId)

  const sanitizedGeom = await sanitizeGeometryForStorage(supabase, geometry)
  const totalh = computeTotalHectares(parsed)

  const { error } = await supabase.from('PADRON_PARCELAS').insert({
    ID_Parcela_Fija: parsed.ID_Parcela_Fija,
    ID_Organizacion: organizationId,
    geom: sanitizedGeom,
    ...parcelaPayload(parsed, totalh),
  })
  if (error) throw error

  return { id: parsed.ID_Parcela_Fija, created: true }
}

/** Edita una parcela existente. Rechaza si no pertenece a `organizationId`. */
export async function updateParcela(values, organizationId, geometry = null) {
  assertOrganizacion(organizationId)
  const parsed = parcelaSchema.parse(values)
  const supabase = getSupabaseServerClient()

  await assertMatchesExistingOrg(
    supabase,
    'PADRON_PARCELAS',
    'ID_Parcela_Fija',
    parsed.ID_Parcela_Fija,
    organizationId
  )

  const totalh = computeTotalHectares(parsed)
  const updatePayload = parcelaPayload(parsed, totalh)

  if (geometry) {
    updatePayload.geom = await sanitizeGeometryForStorage(supabase, geometry)
  }

  const { error } = await supabase
    .from('PADRON_PARCELAS')
    .update(updatePayload)
    .eq('ID_Parcela_Fija', parsed.ID_Parcela_Fija)
  if (error) throw error

  return { id: parsed.ID_Parcela_Fija, created: false }
}
