'use server'

// Server Actions de SOLO LECTURA que envuelven las funciones SECURITY
// DEFINER de supabase/migrations/20260901160000_lecturas_padron_security_definer.sql
// (fn_listar_padron_socios, fn_listar_padron_parcelas_por_socio,
// fn_buscar_padron_socios, fn_buscar_padron_parcelas,
// fn_padron_socios_existentes, fn_padron_parcelas_existentes,
// fn_padron_socios_ids_todos, fn_padron_socios_sample_activos,
// fn_padron_parcelas_codigos_e_ids, fn_enriquecer_parcela_qc).
//
// Reemplaza el patrón anterior (lib/sociosSearch.js/lib/padronSearch.js/
// lib/padronCsv.js/lib/eudrQcActions.js consultando PADRON_SOCIOS/
// PADRON_PARCELAS directo con la llave `anon`, dependiendo de que la
// política RLS de esas 2 tablas fuera más permisiva de lo que cualquier
// consumidor real necesitaba — ver AI_STATE.md 2026-09-01g/h). Esas 2
// tablas ahora niegan SELECT a `anon` (USING(false), misma migración) —
// el único camino de lectura real pasa por acá, con la Service Role Key,
// igual que ya hacía lib/actions/sociosActions.js del lado de escritura.
//
// Cada función acá abajo es un wrapper delgado 1:1 sobre su función SQL
// — sin lógica propia más allá de pasar los parámetros y propagar el
// error real de Postgres (mismo criterio que createSocio/createParcela).
//
// Import RELATIVO, no el alias `@/lib/...` que usan el resto de
// lib/actions/*.js -- a diferencia de esos archivos (nunca importados
// directo por ningún test, el alias de Next.js nunca se ejercita fuera
// del build real), este archivo SÍ lo importan lib/sociosSearch.js/
// lib/padronSearch.js/lib/padronCsv.js/lib/eudrQcActions.js, que varios
// tests/*.mjs importan directo con Node puro (`node --test`, sin el
// resolver de alias de Next.js) -- `@/lib/...` rompería esa cadena con
// `ERR_MODULE_NOT_FOUND` (mismo motivo ya documentado en
// lib/actions/organizacionesActions.js).
import { getSupabaseServerClient } from '../supabaseServerClient.js'

export async function fnListarPadronSocios(organizationId, { search, certOrgEstatus, departamento, certFlags, page, pageSize } = {}) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_listar_padron_socios', {
    p_organizacion: organizationId,
    p_search: search || null,
    p_cert_org_estatus: certOrgEstatus || null,
    p_departamento: departamento || null,
    p_cert_flags: certFlags && certFlags.length ? certFlags : null,
    p_page: page ?? 0,
    p_page_size: pageSize ?? 15,
  })
  if (error) throw error
  return data ?? []
}

export async function fnListarPadronParcelasPorSocio(organizationId, socioId) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_listar_padron_parcelas_por_socio', {
    p_organizacion: organizationId,
    p_socio_id: socioId,
  })
  if (error) throw error
  return data ?? []
}

export async function fnBuscarPadronSocios(organizationId, query) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_buscar_padron_socios', {
    p_organizacion: organizationId,
    p_query: query,
  })
  if (error) throw error
  return data ?? []
}

export async function fnBuscarPadronParcelas(organizationId, socioId, query) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_buscar_padron_parcelas', {
    p_organizacion: organizationId,
    p_socio_id: socioId || null,
    p_query: query || null,
  })
  if (error) throw error
  return data ?? []
}

export async function fnPadronSociosExistentes(organizationId, { idSocios = [], dnis = [], codigosFinca = [] } = {}) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_padron_socios_existentes', {
    p_organizacion: organizationId,
    p_id_socios: idSocios,
    p_dnis: dnis,
    p_codigos_finca: codigosFinca,
  })
  if (error) throw error
  return data ?? []
}

export async function fnPadronParcelasExistentes(organizationId, { ids = [], codigos = [] } = {}) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_padron_parcelas_existentes', {
    p_organizacion: organizationId,
    p_ids: ids,
    p_codigos: codigos,
  })
  if (error) throw error
  return data ?? []
}

export async function fnPadronSociosIdsTodos(organizationId) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_padron_socios_ids_todos', { p_organizacion: organizationId })
  if (error) throw error
  return (data ?? []).map((r) => r.ID_Socio)
}

export async function fnPadronSociosSampleActivos(organizationId, limit = 2) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_padron_socios_sample_activos', {
    p_organizacion: organizationId,
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []).map((r) => r.ID_Socio)
}

export async function fnPadronParcelasCodigosEIds(organizationId) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_padron_parcelas_codigos_e_ids', { p_organizacion: organizationId })
  if (error) throw error
  const rows = data ?? []
  return {
    codigos: rows.map((r) => r.parcela_codigo).filter(Boolean),
    ids: rows.map((r) => r.ID_Parcela_Fija).filter(Boolean),
  }
}

export async function fnEnriquecerParcelaQc(organizationId, ids) {
  const supabase = getSupabaseServerClient()
  if (!ids || ids.length === 0) return []
  const { data, error } = await supabase.rpc('fn_enriquecer_parcela_qc', {
    p_organizacion: organizationId,
    p_ids: ids,
  })
  if (error) throw error
  return data ?? []
}

// Restauración de exportSociosCsv/exportParcelasCsv (lib/padronCsv.js),
// rotas tras el lockdown de fn_listar_padron_socios/PADRON_PARCELAS --
// ver AI_STATE.md "Restaurar exportSociosCsv/exportParcelasCsv". Sin
// filtros: las 2 funciones originales nunca respetaron ningún filtro de
// la UI, siempre exportaban el padrón activo completo (confirmado
// leyendo el código real antes de diseñar esto).
export async function fnExportarPadronSocios(organizationId) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_exportar_padron_socios', { p_organizacion: organizationId })
  if (error) throw error
  return data ?? []
}

export async function fnExportarPadronParcelas(organizationId) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.rpc('fn_exportar_padron_parcelas', { p_organizacion: organizationId })
  if (error) throw error
  return data ?? []
}
