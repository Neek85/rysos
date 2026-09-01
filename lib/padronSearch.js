// Búsqueda de padrón (PADRON_SOCIOS/PADRON_PARCELAS) para el
// autocompletado del formulario de Inspecciones (Fase 6).
//
// Reescrito (2026-09-01, ver AI_STATE.md "Reemplazo SECURITY DEFINER
// para lecturas de PADRON_SOCIOS/PADRON_PARCELAS"): antes consultaba
// las 2 tablas directo con la llave `anon` (dependía de
// rls_anon_select_padron_socios/parcelas, efectivamente sin restricción
// real -- ver AI_STATE.md 2026-09-01g/h). Delega a
// lib/actions/padronReadActions.js (Server Actions, Service Role Key,
// vía las funciones SECURITY DEFINER fn_buscar_padron_socios/
// fn_buscar_padron_parcelas). Ya no recibe `supabase` como parámetro --
// no lo necesita.

import { fnBuscarPadronSocios, fnBuscarPadronParcelas } from './actions/padronReadActions.js'

export async function searchSocios(organizationId, query, buscarPadronSocios = fnBuscarPadronSocios) {
  if (!organizationId || !query || query.trim().length < 2) return []
  return buscarPadronSocios(organizationId, query.trim())
}

export async function searchParcelas(organizationId, socioId, query, buscarPadronParcelas = fnBuscarPadronParcelas) {
  if (!organizationId) return []
  return buscarPadronParcelas(organizationId, socioId, query)
}
