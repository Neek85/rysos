// Lectura del Padrón (PADRON_SOCIOS/PADRON_PARCELAS) para
// /dashboard/socios.
//
// Reescrito (2026-09-01, ver AI_STATE.md "Reemplazo SECURITY DEFINER
// para lecturas de PADRON_SOCIOS/PADRON_PARCELAS"): antes consultaba
// PADRON_SOCIOS/PADRON_PARCELAS directo con la llave `anon`
// (rls_anon_select_padron_socios/parcelas, USING("ID_Organizacion" IS
// NOT NULL) -- efectivamente sin restricción real, ver AI_STATE.md
// 2026-09-01g/h). Esas 2 políticas ahora son USING(false) para `anon` --
// este archivo ya no toca las tablas directo, delega a
// lib/actions/padronReadActions.js (Server Actions, Service Role Key,
// que a su vez llaman a las funciones SECURITY DEFINER
// fn_listar_padron_socios/fn_listar_padron_parcelas_por_socio). Ninguna
// de las 2 funciones exportadas acá recibe `supabase` como parámetro
// ya -- no los necesitan, la Service Role Key vive del lado del servidor.
//
// HALLAZGO DE SEGURIDAD (2026-09-08) -- `resolveOrganizationIdFallback`
// apuntaba por defecto a `resolveOrganizationId` (organizacionesActions.js),
// que resolvía "la organización real más antigua" SIN mirar la sesión.
// Con login real ya activo para /dashboard/** (middleware.js), eso
// significaba que cualquier cuenta autenticada -- de cualquier
// organización -- veía siempre el padrón completo de COOP-AROMAS-VALLE.
// Reemplazada por `resolveSessionOrganizationId` (mismo archivo, resuelve
// por sesión real vía PERFILES_USUARIO_INTERNOS, ver el comentario ahí
// para el detalle completo del hallazgo). El parámetro sigue
// llamándose `resolveOrganizationIdFallback` -- solo cambia cuál función
// es el default -- para no romper la inyección que ya usan los tests.

import { fnListarPadronSocios, fnListarPadronParcelasPorSocio } from './actions/padronReadActions.js'
import { resolveSessionOrganizationId as resolveOrganizationIdFallbackDefault } from './actions/organizacionesActions.js'

const PAGE_SIZE = 15

/**
 * Lista paginada/buscable/filtrable de PADRON_SOCIOS, vía
 * fn_listar_padron_socios (SECURITY DEFINER, filtra por organización
 * dentro de la función misma -- no hay forma de pedir "todo").
 *
 * `filters.certOrgEstatus`: valor exacto de cert_org_estatus.
 * `filters.certFlags`: array de nombres de columna (de CERT_FLAG_FIELDS)
 * que deben valer 'Sí'.
 * `filters.departamento`: valor exacto de socio_departamento.
 *
 * Resolución de organización: ya NO hace ningún probe contra
 * PADRON_SOCIOS (ese probe era la única razón por la que este archivo
 * necesitaba leer la tabla directo con `anon` antes de saber a qué
 * organización pertenecía). `resolveOrganizationIdFallback` (por
 * defecto `resolveSessionOrganizationId`, resuelve por SESIÓN real --
 * ver el hallazgo de seguridad arriba) es ahora el ÚNICO mecanismo de
 * resolución, salvo que venga un `organizationIdOverride` ya verificado
 * (ver abajo) -- inyectable como parámetro para poder testear sin
 * depender de una sesión real.
 *
 * `organizationIdOverride` (TEMPORAL, ronda de robustez del importador
 * contra ORG-TEST-DEMO -- ver AI_STATE.md 2026-09-01f): cuando viene con
 * un valor truthy, se usa DIRECTO como `organizationId`, saltando
 * `resolveOrganizationIdFallback` -- el caller
 * (`app/dashboard/socios/page.jsx`) es responsable de haberlo
 * pre-verificado contra `ORGANIZACIONES` (`resolveTestOrganizationOverride`)
 * antes de pasarlo acá; esta función no repite esa verificación.
 * `undefined`/`null` (el default) preserva el comportamiento normal.
 */
export async function fetchSocios(
  {
    page = 0,
    search = '',
    filters = {},
    resolveOrganizationIdFallback = resolveOrganizationIdFallbackDefault,
    organizationIdOverride = null,
    listarPadronSocios = fnListarPadronSocios,
  } = {}
) {
  const organizationId = organizationIdOverride || (await resolveOrganizationIdFallback())
  if (!organizationId) return { rows: [], total: 0, pageSize: PAGE_SIZE, organizationId: null }

  const rows = await listarPadronSocios(organizationId, {
    search: search.trim(),
    certOrgEstatus: filters.certOrgEstatus,
    departamento: filters.departamento,
    certFlags: filters.certFlags,
    page,
    pageSize: PAGE_SIZE,
  })

  const total = rows.length > 0 ? Number(rows[0].total_count) : 0
  const cleanRows = rows.map(({ total_count, ...rest }) => rest)
  return { rows: cleanRows, total, pageSize: PAGE_SIZE, organizationId }
}

/**
 * Parcelas de un socio puntual, vía fn_listar_padron_parcelas_por_socio
 * (SECURITY DEFINER) -- mismo criterio de siempre: el caller siempre ya
 * tiene el socio dueño de las parcelas en mano (ParcelaFormModal recibe
 * `organizationId` como prop, la organización real del socio que se
 * está editando), nunca una heurística nueva.
 */
export async function fetchParcelasBySocio(socioId, organizationId, listarParcelasPorSocio = fnListarPadronParcelasPorSocio) {
  if (!socioId || !organizationId) return []
  return listarParcelasPorSocio(organizationId, socioId)
}
