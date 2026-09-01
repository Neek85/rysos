// Lectura del Padrón (PADRON_SOCIOS/PADRON_PARCELAS) para
// /dashboard/socios — vía la anon key existente (rls_anon_select_padron_socios
// / rls_anon_select_padron_parcelas, supabase/migrations/20260818_fix_inspecciones_rls.sql).
// Solo lectura — la escritura vive en lib/actions/sociosActions.js
// (Server Actions con Service Role Key, ver specs/padron_web_socios.md).

import { CERT_FLAG_FIELDS } from './validations/socios.js'
import { resolveOrganizationId as resolveOrganizationIdFallbackDefault } from './actions/organizacionesActions.js'

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
 *
 * HOTFIX (2026-08-25, "Multi-Tenant Estricto" — docs/RYZOS_ORQUESTADOR_V3.1.md
 * sección 5): sin Supabase Auth real no hay una "organización activa" de
 * sesión que filtrar de entrada. Mismo patrón de fetch en dos pasos ya
 * usado en lib/eudrQcActions.js::fetchPendingRecords y
 * components/gis/MapDashboard.jsx::fetchRecords — un primer probe liviano
 * (solo ID_Organizacion, límite 1) resuelve la organización con la misma
 * heurística de "primera encontrada", y recién la consulta real queda
 * filtrada por esa organización desde el propio query — a diferencia del
 * gap anterior (ver git blame), ninguna fila de otra organización llega
 * nunca al navegador, ni siquiera en la primera carga.
 *
 * Ronda 8 (2026-09-01, mejoras_importador_padron_masivo.md): el probe de
 * arriba consulta PADRON_SOCIOS, que solo tiene filas de una organización
 * DESPUÉS de su primera carga de datos -- una organización real recién
 * dada de alta (specs/alta_organizacion_real.md, el INSERT nunca toca
 * PADRON_SOCIOS/PADRON_PARCELAS) no tiene ninguna fila ahí todavía,
 * así que el probe no encontraba nada y `organizationId` quedaba `null`
 * incluso con una organización real ya existente -- root cause
 * confirmado de "No se pudo determinar la organización activa" al
 * confirmar la importación masiva de Socios/Parcelas (bug de arranque
 * "huevo y gallina": no se puede importar el primer socio porque no hay
 * ningún socio todavía del cual derivar a qué organización pertenece).
 * `resolveOrganizationIdFallback` (por defecto,
 * `resolveOrganizationId` de lib/actions/organizacionesActions.js, un
 * Server Action con Service Role Key contra ORGANIZACIONES -- `anon` no
 * puede leerla directo) se usa SOLO cuando el probe normal no encuentra
 * nada; inyectable como parámetro para poder testear sin depender de la
 * Service Role Key real (ver tests/test_sociossearch_multitenant.mjs).
 * `organizationId` ahora viaja en el valor de retorno -- antes había que
 * re-derivarlo del lado del caller con `resolveActiveOrganizationId(rows)`
 * (retirada, dependía de `rows` no estar vacío, mismo bug).
 */
export async function fetchSocios(
  supabase,
  { page = 0, search = '', filters = {}, resolveOrganizationIdFallback = resolveOrganizationIdFallbackDefault } = {}
) {
  const { data: orgProbe, error: probeError } = await supabase
    .from('PADRON_SOCIOS')
    .select('ID_Organizacion')
    .eq('activo', true)
    .limit(1)
  if (probeError) throw probeError

  let organizationId = orgProbe?.[0]?.ID_Organizacion
  if (!organizationId) {
    organizationId = await resolveOrganizationIdFallback()
  }
  if (!organizationId) return { rows: [], total: 0, pageSize: PAGE_SIZE, organizationId: null }

  let query = supabase
    .from('PADRON_SOCIOS')
    .select(SOCIO_COLUMNS, { count: 'exact' })
    .eq('ID_Organizacion', organizationId)
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
  return { rows: data ?? [], total: count ?? 0, pageSize: PAGE_SIZE, organizationId }
}

// activo: misma migración que SOCIO_COLUMNS arriba.
// ADR-028: id_producto_predominante agregado -- sin esto, ParcelaFormModal
// no puede pre-seleccionar el producto real de la parcela al editar.
const PARCELA_COLUMNS =
  'ID_Parcela_Fija,ID_Organizacion,ID_Socio,parcela_codigo,parcela_nombre,' +
  'hcp,hcc,ho,hip,hrp,hbp,otros_cultivo,totalh,geom,activo,id_producto_predominante'

// HOTFIX (2026-08-25, "Multi-Tenant Estricto"): a diferencia de fetchSocios
// arriba, acá no hace falta ningún probe -- el caller siempre ya tiene el
// socio dueño de las parcelas en mano (ParcelaFormModal recibe `organizationId`
// como prop, la organización real del socio que se está editando), mismo
// patrón que assertParcelaMatchesOrg/deactivateParcela en
// lib/actions/sociosActions.js: usar el ID_Organizacion del registro real,
// nunca una heurística nueva.
export async function fetchParcelasBySocio(supabase, socioId, organizationId) {
  if (!socioId || !organizationId) return []
  const { data, error } = await supabase
    .from('PADRON_PARCELAS')
    .select(PARCELA_COLUMNS)
    .eq('ID_Socio', socioId)
    .eq('ID_Organizacion', organizationId)
    .eq('activo', true)
    .order('parcela_codigo')

  if (error) throw error
  return data ?? []
}

// `resolveActiveOrganizationId(records)` (derivaba la organización de
// `rows` ya cargadas) se retiró en la ronda 8 (mejoras_importador_padron_masivo.md)
// -- era exactamente la fuente del bug "No se pudo determinar la
// organización activa": devolvía `null` cada vez que `rows` estaba
// vacío, que es el estado normal de una organización real recién dada
// de alta, antes de su primera carga. `fetchSocios` ahora devuelve
// `organizationId` ya resuelto (con fallback incluido, ver arriba) --
// el caller (app/dashboard/socios/page.jsx) ya no necesita re-derivarlo.
