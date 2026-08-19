// Lectura del Padrón (PADRON_SOCIOS/PADRON_PARCELAS) para
// /dashboard/socios — vía la anon key existente (rls_anon_select_padron_socios
// / rls_anon_select_padron_parcelas, supabase/migrations/20260818_fix_inspecciones_rls.sql).
// Solo lectura — la escritura vive en lib/actions/sociosActions.js
// (Server Actions con Service Role Key, ver specs/padron_web_socios.md).

import { CERT_FLAG_FIELDS } from '@/lib/validations/socios'

// activo (supabase/migrations/20260818_padron_baja_logica.sql): requiere
// esa migración aplicada — sin ella, esta consulta falla con "column
// PADRON_SOCIOS.activo does not exist".
const SOCIO_COLUMNS =
  'ID_Socio,ID_Organizacion,codigo_finca,socio_nombre_completo,socio_dni,socio_genero,' +
  'socio_fecha_nacimiento,celular_socio,conyuge_nombre,conyuge_dni,socio_departamento,' +
  'socio_provincia,socio_distrito,localidad,certificaciones,cert_org_estatus,' +
  CERT_FLAG_FIELDS.map((f) => f.field).join(',') +
  ',socio_fecha_ingreso,activo'

const PAGE_SIZE = 15

/**
 * Lista paginada/buscable/filtrable de PADRON_SOCIOS.
 * `filters.certOrgEstatus`: valor exacto de cert_org_estatus.
 * `filters.certFlags`: array de nombres de columna (de CERT_FLAG_FIELDS)
 * que deben valer 'Sí'.
 * `filters.departamento`: valor exacto de socio_departamento.
 */
export async function fetchSocios(supabase, { page = 0, search = '', filters = {} } = {}) {
  let query = supabase
    .from('PADRON_SOCIOS')
    .select(SOCIO_COLUMNS, { count: 'exact' })
    .eq('activo', true)
    .order('socio_nombre_completo')
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

  if (search.trim()) {
    const term = search.trim()
    query = query.or(
      `socio_nombre_completo.ilike.%${term}%,socio_dni.ilike.%${term}%,codigo_finca.ilike.%${term}%,ID_Socio.ilike.%${term}%`
    )
  }

  if (filters.certOrgEstatus) {
    query = query.eq('cert_org_estatus', filters.certOrgEstatus)
  }

  if (filters.departamento) {
    query = query.eq('socio_departamento', filters.departamento)
  }

  for (const flagField of filters.certFlags || []) {
    query = query.eq(flagField, 'Sí')
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0, pageSize: PAGE_SIZE }
}

// activo: misma migración que SOCIO_COLUMNS arriba.
const PARCELA_COLUMNS =
  'ID_Parcela_Fija,ID_Organizacion,ID_Socio,parcela_codigo,parcela_nombre,' +
  'hcp,hcc,ho,hip,hrp,hbp,otros_cultivo,totalh,geom,activo'

export async function fetchParcelasBySocio(supabase, socioId) {
  if (!socioId) return []
  const { data, error } = await supabase
    .from('PADRON_PARCELAS')
    .select(PARCELA_COLUMNS)
    .eq('ID_Socio', socioId)
    .eq('activo', true)
    .order('parcela_codigo')

  if (error) throw error
  return data ?? []
}

/**
 * Deriva la organización activa a partir de un set de registros ya
 * cargados por RLS/lectura anon — mismo patrón que
 * lib/eudrDdsExporter.js::resolveOrganizationId, reimplementado acá para
 * no acoplar el módulo de Socios al de EUDR (dominios de datos separados
 * deliberadamente, ver docs/schema_live.md).
 */
export function resolveActiveOrganizationId(records) {
  const ids = new Set((Array.isArray(records) ? records : []).map((r) => r?.ID_Organizacion).filter(Boolean))
  if (ids.size === 0) return null
  return [...ids][0]
}
