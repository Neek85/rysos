// Búsqueda de padrón (PADRON_SOCIOS/PADRON_PARCELAS) para el
// autocompletado del formulario de Inspecciones (Fase 6).
//
// INVARIANTE: requiere la política `rls_anon_select_padron_socios`/
// `rls_anon_select_padron_parcelas` de
// supabase/migrations/20260818_fix_inspecciones_rls.sql. Sin esa
// migración aplicada en la instancia viva, estas consultas devuelven un
// array vacío (RLS filtra silenciosamente, PostgREST no lanza error para
// una fila que no pasa RLS) — no un error visible, así que el buscador
// simplemente no encuentra nada hasta que se aplique.

const SOCIO_COLUMNS = 'ID_Socio,ID_Organizacion,codigo_finca,socio_nombre_completo,socio_dni'
const PARCELA_COLUMNS = 'ID_Parcela_Fija,ID_Organizacion,ID_Socio,parcela_codigo,parcela_nombre,totalh'

export async function searchSocios(supabase, organizationId, query) {
  if (!organizationId || !query || query.trim().length < 2) return []
  const term = query.trim().replace(/[%,]/g, '')
  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .select(SOCIO_COLUMNS)
    .eq('ID_Organizacion', organizationId)
    // Excluye socios dados de baja (activo=false) -- un socio inactivo no
    // debe poder elegirse para una inspección NUEVA (mismo criterio ya
    // aplicado en lib/sociosSearch.js/lib/padronCsv.js; acá faltaba, ver
    // ADR-016). Nunca afecta inspecciones YA guardadas -- ID_Socio/
    // ID_Parcela quedan como texto libre congelado en INSPECCIONES/CAP_*,
    // sin FK, así que una baja posterior no altera ningún registro histórico.
    .eq('activo', true)
    .or(`socio_nombre_completo.ilike.%${term}%,socio_dni.ilike.%${term}%,codigo_finca.ilike.%${term}%`)
    .limit(8)

  if (error) throw error
  return data ?? []
}

export async function searchParcelas(supabase, organizationId, socioId, query) {
  if (!organizationId) return []

  let q = supabase
    .from('PADRON_PARCELAS')
    .select(PARCELA_COLUMNS)
    .eq('ID_Organizacion', organizationId)
    // Mismo criterio que searchSocios arriba -- ver ADR-016.
    .eq('activo', true)
    .limit(8)

  if (socioId) q = q.eq('ID_Socio', socioId)

  if (query && query.trim().length >= 2) {
    const term = query.trim().replace(/[%,]/g, '')
    q = q.or(`parcela_codigo.ilike.%${term}%,parcela_nombre.ilike.%${term}%`)
  }

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}
