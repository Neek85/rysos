// Acciones de la Consola de Auditoría QC WebGIS (/dashboard/qc).
//
// INVARIANTE — schema real, reverificado en vivo el 2026-08-19 (consulta
// REST directa `select=*` sobre ambas vistas, contra
// supabase/migrations/20260818_fix_views_eudr_flags.sql, que es la
// definición vigente hoy — no la de 20260816_fase2_vistas_qc.sql, ya
// obsoleta): vw_monitoreo_poligonos/puntos SÍ exponen "ID_Parcela_Fija"
// (aliasing la columna cruda `id_parcela` de EUDR_USO_SUELO/
// EUDR_INSTALACIONES), `registro_id`, `area_calculada_ha`, y
// `tipo_uso`(poligonos)/`tipo_infra`(puntos) por separado — NO existe una
// columna unificada `tipo_capa`, ni `id_parcela`, ni `area_ha`, ni
// `parcela_codigo`/`parcela_nombre` en ninguna de las dos vistas (esos dos
// últimos solo existen en vw_monitoreo_web, vía JOIN a PADRON_PARCELAS —
// ver enrichWithParcelaInfo más abajo, que replica ese JOIN del lado del
// cliente porque esta consola necesita leer PENDIENTE, estado que
// vw_monitoreo_web excluye estructuralmente).
//
// GAP REAL ENCONTRADO (2026-08-19, no estaba documentado): a diferencia de
// vw_monitoreo_poligonos, vw_monitoreo_puntos NO expone `id_origen` para
// su rama EUDR_INSTALACIONES (falta en la migración vigente) — sin esa
// columna no hay forma de identificar la fila real de EUDR_INSTALACIONES
// para poder aprobarla/rechazarla. Migración de corrección:
// supabase/migrations/20260819_fix_vw_monitoreo_puntos_id_origen.sql
// (agrega la columna al final del SELECT vía CREATE OR REPLACE VIEW, sin
// tocar vw_monitoreo_web que depende de esta vista — pendiente de
// aplicación manual, como toda migración de este repo). Hasta que se
// aplique, resolveUpdateTarget más abajo rechaza explícitamente
// aprobar/rechazar un registro EUDR_INSTALACIONES puntual en vez de
// fallar en silencio contra un `id` inexistente — hoy no bloquea nada
// real: no hay registros PENDIENTE de EUDR_INSTALACIONES en la base
// (verificado en vivo).
//
// Mismo motivo por el que approveRecord/rejectRecord NO escriben
// `actualizado_en` (a diferencia de scripts/qgis_qc_actions.py): un intento
// de aprobación en vivo devolvió "Could not find the 'actualizado_en'
// column of 'EUDR_MONITOREO' in the schema cache" — esa columna tampoco
// existe realmente, pese a que el spec de Fase 3 QGIS la documenta como
// invariante.
//
// Identificador real usado para cada UPDATE (nunca sobre la vista, que es
// de solo lectura, siempre sobre la tabla base):
//   - EUDR_MONITOREO: id_monitoreo (uuid nativo, PK real) — derivable
//     igual a `id_origen` incluso donde la vista no trae esa columna
//     (ver tagRecords), porque la vista sí siempre trae id_monitoreo.
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

import { resolveOrganizationId } from './eudrDdsExporter.js'

export { resolveOrganizationId }

export const PENDING_STATE = 'PENDIENTE'

export const LAYER_LABELS = {
  EUDR_MONITOREO: 'Monitoreos',
  EUDR_USO_SUELO: 'Uso de Suelo',
  EUDR_INSTALACIONES: 'Instalaciones',
}

const POLIGONOS_COLUMNS =
  'tabla_origen,registro_id,id_origen,id_monitoreo,ID_Organizacion,ID_Parcela_Fija,' +
  'productor,tipo_uso,evidencia_foto,estado_revision,fecha_monitoreo,observaciones,' +
  'cumple_eudr,area_calculada_ha,geom'

// Sin id_origen todavía — ver GAP REAL arriba. Se rellena para filas
// EUDR_MONITOREO en tagRecords (derivable de id_monitoreo); para
// EUDR_INSTALACIONES queda ausente hasta aplicar la migración.
const PUNTOS_COLUMNS =
  'tabla_origen,registro_id,id_monitoreo,ID_Organizacion,ID_Parcela_Fija,' +
  'productor,tipo_infra,evidencia_foto,estado_revision,fecha_monitoreo,observaciones,' +
  'cumple_eudr,area_calculada_ha,geom'

export class EUDRQcError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EUDRQcError'
  }
}

function tagRecords(records, tipoGeometria) {
  return (records || []).map((r) => {
    // id_origen: ya viene de la vista en poligonos; en puntos, solo para
    // EUDR_MONITOREO se puede derivar sin la columna (ver GAP REAL arriba)
    // — para EUDR_INSTALACIONES queda undefined a propósito, y
    // resolveUpdateTarget lo rechaza explícitamente en vez de intentar un
    // UPDATE con un id inexistente.
    const id_origen = r.id_origen ?? (r.tabla_origen === 'EUDR_MONITOREO' ? r.id_monitoreo : undefined)
    return {
      ...r,
      id_origen,
      tipo_geometria: tipoGeometria,
      // tipo_uso/tipo_infra: "MONITOREO_PERIMETRAL" para EUDR_MONITOREO no
      // es una clasificación de campo real (uso de suelo/infraestructura),
      // así que no se expone como tal.
      clasificacion: r.tabla_origen === 'EUDR_MONITOREO' ? null : r.tipo_uso || r.tipo_infra || null,
      key: `${r.tabla_origen}:${r.registro_id}`,
    }
  })
}

/**
 * Enriquece los registros con parcela_codigo/parcela_nombre desde
 * PADRON_PARCELAS por ID_Parcela_Fija — mismo JOIN que hace
 * vw_monitoreo_web del lado del servidor (ver
 * supabase/migrations/20260818_fix_views_eudr_flags.sql), replicado acá
 * porque vw_monitoreo_poligonos/puntos (las vistas que sí traen
 * PENDIENTE) no incluyen esas columnas.
 */
async function enrichWithParcelaInfo(supabase, records) {
  const ids = [...new Set(records.map((r) => r.ID_Parcela_Fija).filter(Boolean))]
  if (ids.length === 0) return records

  const { data, error } = await supabase
    .from('PADRON_PARCELAS')
    .select('ID_Parcela_Fija, parcela_codigo, parcela_nombre')
    .in('ID_Parcela_Fija', ids)
  if (error) throw error

  const byId = new Map((data ?? []).map((p) => [p.ID_Parcela_Fija, p]))
  return records.map((r) => {
    const parcela = byId.get(r.ID_Parcela_Fija)
    return { ...r, parcela_codigo: parcela?.parcela_codigo ?? null, parcela_nombre: parcela?.parcela_nombre ?? null }
  })
}

/**
 * Trae todos los registros PENDIENTE (poligonos + puntos) visibles para la
 * organización del usuario autenticado — RLS ya restringe ambas vistas del
 * lado de Supabase, igual que vw_monitoreo_web.
 */
export async function fetchPendingRecords(supabase) {
  const [poligonos, puntos] = await Promise.all([
    supabase.from('vw_monitoreo_poligonos').select(POLIGONOS_COLUMNS).eq('estado_revision', PENDING_STATE),
    supabase.from('vw_monitoreo_puntos').select(PUNTOS_COLUMNS).eq('estado_revision', PENDING_STATE),
  ])

  if (poligonos.error) throw poligonos.error
  if (puntos.error) throw puntos.error

  const records = [...tagRecords(poligonos.data, 'poligono'), ...tagRecords(puntos.data, 'punto')]
  return enrichWithParcelaInfo(supabase, records)
}

// INVARIANTE: nunca se actualiza la vista de auditoría (solo lectura) —
// siempre la tabla base real detrás de tabla_origen.
function resolveUpdateTarget(record) {
  if (record.tabla_origen === 'EUDR_MONITOREO') {
    return { table: 'EUDR_MONITOREO', match: { id_monitoreo: record.id_monitoreo } }
  }
  if (record.tabla_origen === 'EUDR_USO_SUELO' || record.tabla_origen === 'EUDR_INSTALACIONES') {
    if (!record.id_origen) {
      // GAP REAL (ver comentario de cabecera): vw_monitoreo_puntos todavía
      // no expone id_origen para EUDR_INSTALACIONES — sin ese id no hay
      // forma segura de ubicar la fila real a actualizar. Rechazar
      // explícito en vez de un .match({ id: undefined }) que matchearía 0
      // filas en silencio (mismo riesgo ya visto y corregido en
      // lib/actions/sociosActions.js).
      throw new EUDRQcError(
        `No se puede aplicar la decisión sobre este registro de ${LAYER_LABELS[record.tabla_origen]}: falta aplicar ` +
          'la migración supabase/migrations/20260819_fix_vw_monitoreo_puntos_id_origen.sql.'
      )
    }
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

  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .match({ ...match, ID_Organizacion: record.ID_Organizacion, estado_revision: PENDING_STATE })
    .select('estado_revision')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new EUDRQcError(
      'No se pudo aprobar: el registro ya no está en estado PENDIENTE, o fue modificado por otra sesión. Recargá la consola.'
    )
  }
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

  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .match({ ...match, ID_Organizacion: record.ID_Organizacion, estado_revision: PENDING_STATE })
    .select('estado_revision')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new EUDRQcError(
      'No se pudo rechazar: el registro ya no está en estado PENDIENTE, o fue modificado por otra sesión. Recargá la consola.'
    )
  }
}
