// Acciones de la Consola de Auditoría QC WebGIS (/dashboard/qc).
//
// INVARIANTE — schema real vs. migración: supabase/migrations/
// 20260816_fase2_vistas_qc.sql documenta vw_monitoreo_poligonos/puntos con
// columnas (registro_id, tipo_uso/tipo_infra, "ID_Parcela_Fija",
// geom_geojson) que NO coinciden con las columnas reales devueltas por la
// instancia Supabase en vivo (verificado con una consulta REST directa:
// id_origen, tipo_capa, id_parcela, geom-ya-como-GeoJSON — sin
// registro_id/geom_geojson). La base de datos live evolucionó sin que el
// archivo de migración se actualizara. Este módulo se escribió contra el
// schema REAL confirmado en vivo, no contra el archivo de migración — si
// una futura migración vuelve a alinear ambos, revisar este comentario.
// Mismo motivo por el que approveRecord/rejectRecord NO escriben
// `actualizado_en` (a diferencia de scripts/qgis_qc_actions.py): un intento
// de aprobación en vivo devolvió "Could not find the 'actualizado_en'
// column of 'EUDR_MONITOREO' in the schema cache" — esa columna tampoco
// existe realmente, pese a que el spec de Fase 3 QGIS la documenta como
// invariante.
//
// Identificador real usado para cada UPDATE (nunca sobre la vista, que es
// de solo lectura, siempre sobre la tabla base):
//   - EUDR_MONITOREO: id_monitoreo (uuid nativo, PK real).
//   - EUDR_USO_SUELO / EUDR_INSTALACIONES: id_origen (alias de vista sobre
//     la columna `id` real de la tabla — confirmado por simetría: en filas
//     EUDR_MONITOREO, id_origen === id_monitoreo, que sí es su PK real).
//
// Contraparte web de scripts/qgis_qc_actions.py, pero ese script solo cubre
// EUDR_MONITOREO (una tabla); esta consola cubre las 3 tablas de origen.
//
// INVARIANTE: vw_monitoreo_web filtra estado_revision = 'APROBADO' en su
// propia definición — es estructuralmente incapaz de traer PENDIENTE. Los
// registros de esta consola salen de vw_monitoreo_poligonos/puntos (las
// vistas de auditoría, que exponen los 3 estados), nunca de vw_monitoreo_web.

import { resolveOrganizationId } from '@/lib/eudrDdsExporter'

export { resolveOrganizationId }

export const PENDING_STATE = 'PENDIENTE'

export const LAYER_LABELS = {
  EUDR_MONITOREO: 'Monitoreos',
  EUDR_USO_SUELO: 'Uso de Suelo',
  EUDR_INSTALACIONES: 'Instalaciones',
}

const AUDIT_COLUMNS =
  'id_monitoreo,id_origen,tabla_origen,ID_Organizacion,id_parcela,parcela_codigo,' +
  'parcela_nombre,productor,tipo_capa,evidencia_foto,estado_revision,fecha_monitoreo,' +
  'observaciones,cumple_eudr,area_ha,geom'

export class EUDRQcError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EUDRQcError'
  }
}

function tagRecords(records, tipoGeometria) {
  return (records || []).map((r) => ({
    ...r,
    tipo_geometria: tipoGeometria,
    // tipo_capa vale "MONITOREO_PERIMETRAL" para EUDR_MONITOREO — no es una
    // clasificación de campo real (uso de suelo/infraestructura), así que
    // no se expone como tal.
    clasificacion: r.tabla_origen === 'EUDR_MONITOREO' ? null : r.tipo_capa,
    key: `${r.tabla_origen}:${r.id_origen}`,
  }))
}

/**
 * Trae todos los registros PENDIENTE (poligonos + puntos) visibles para la
 * organización del usuario autenticado — RLS ya restringe ambas vistas del
 * lado de Supabase, igual que vw_monitoreo_web.
 */
export async function fetchPendingRecords(supabase) {
  const [poligonos, puntos] = await Promise.all([
    supabase.from('vw_monitoreo_poligonos').select(AUDIT_COLUMNS).eq('estado_revision', PENDING_STATE),
    supabase.from('vw_monitoreo_puntos').select(AUDIT_COLUMNS).eq('estado_revision', PENDING_STATE),
  ])

  if (poligonos.error) throw poligonos.error
  if (puntos.error) throw puntos.error

  return [...tagRecords(poligonos.data, 'poligono'), ...tagRecords(puntos.data, 'punto')]
}

// INVARIANTE: nunca se actualiza la vista de auditoría (solo lectura) —
// siempre la tabla base real detrás de tabla_origen.
function resolveUpdateTarget(record) {
  if (record.tabla_origen === 'EUDR_MONITOREO') {
    return { table: 'EUDR_MONITOREO', match: { id_monitoreo: record.id_monitoreo } }
  }
  if (record.tabla_origen === 'EUDR_USO_SUELO' || record.tabla_origen === 'EUDR_INSTALACIONES') {
    return { table: record.tabla_origen, match: { id: record.id_origen } }
  }
  throw new EUDRQcError(`tabla_origen desconocida: ${String(record.tabla_origen)}`)
}

function assertSameOrganization(record, organizationId) {
  if (organizationId && record.ID_Organizacion !== organizationId) {
    throw new EUDRQcError(
      `Violación multi-tenant: el registro "${record.id_origen}" no pertenece a la organización ${organizationId}.`
    )
  }
}

/**
 * Aprueba un registro PENDIENTE. `organizationId`, si se provee, se valida
 * contra record.ID_Organizacion como defensa adicional (RLS ya lo exige del
 * lado de Supabase; esto evita ejecutar una acción sobre estado de UI
 * desactualizado). El match siempre incluye ID_Organizacion +
 * estado_revision = 'PENDIENTE' además de la PK, como defensa en
 * profundidad y guarda de transición idempotente.
 */
export async function approveRecord(supabase, record, organizationId) {
  assertSameOrganization(record, organizationId)
  const { table, match } = resolveUpdateTarget(record)

  const payload = { estado_revision: 'APROBADO' }

  const { error } = await supabase
    .from(table)
    .update(payload)
    .match({ ...match, ID_Organizacion: record.ID_Organizacion, estado_revision: PENDING_STATE })

  if (error) throw error
}

/**
 * Rechaza un registro PENDIENTE y anexa el motivo a observaciones, con el
 * mismo formato de sufijo que scripts/qgis_qc_actions.py
 * (get_reject_action_sql), para que ambos flujos de auditoría (QGIS y
 * WebGIS) dejen un rastro consistente.
 */
export async function rejectRecord(supabase, record, motivo, organizationId) {
  assertSameOrganization(record, organizationId)
  const trimmedMotivo = (motivo || '').trim()
  if (!trimmedMotivo) {
    throw new EUDRQcError('Se requiere un motivo para rechazar un registro.')
  }

  const { table, match } = resolveUpdateTarget(record)
  const suffix = ` [RECHAZADO QC: ${trimmedMotivo}]`
  const newObservaciones = `${record.observaciones || ''}${suffix}`.trim()

  const payload = { estado_revision: 'RECHAZADO', observaciones: newObservaciones }

  const { error } = await supabase
    .from(table)
    .update(payload)
    .match({ ...match, ID_Organizacion: record.ID_Organizacion, estado_revision: PENDING_STATE })

  if (error) throw error
}
