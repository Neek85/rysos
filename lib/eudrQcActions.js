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
import { geoJsonToWkt } from './geometryImport.js'

export { resolveOrganizationId }

export const PENDING_STATE = 'PENDIENTE'

export const LAYER_LABELS = {
  EUDR_MONITOREO: 'Monitoreos',
  EUDR_USO_SUELO: 'Uso de Suelo',
  EUDR_INSTALACIONES: 'Instalaciones',
}

// Campos realmente editables por tabla_origen (Consola QC 2.0,
// specs/gis_qc_console_v2.md) — corrige la lista inventada de un prompt
// anterior ("parcela_codigo"/"descripcion" no existen en ninguna de las 3
// tablas EUDR_*; parcela_codigo vive en PADRON_PARCELAS, y el único campo
// de texto libre real es observaciones, solo en EUDR_MONITOREO).
// ID_Organizacion/estado_revision/la PK NUNCA están acá a propósito —
// updateRecordAttributes whitelist-ea explícitamente contra este mapa, no
// hace un Object.assign genérico del payload del cliente.
export const EDITABLE_FIELDS = {
  EUDR_MONITOREO: [
    { key: 'ID_Socio', label: 'Código de Socio' },
    { key: 'ID_Parcela_Fija', label: 'Código de Parcela' },
    { key: 'observaciones', label: 'Observaciones' },
  ],
  EUDR_USO_SUELO: [
    { key: 'id_parcela', label: 'Código de Parcela' },
    { key: 'tipo_uso', label: 'Tipo de Uso' },
  ],
  EUDR_INSTALACIONES: [
    { key: 'id_parcela', label: 'Código de Parcela' },
    { key: 'tipo_infra', label: 'Tipo de Infraestructura' },
  ],
}

// Columna de geometría real por tabla — EUDR_MONITOREO usa geom_inspeccion
// (geometría genérica Point/Polygon capturada por QField), las otras dos
// usan geom (confirmado en docs/schema_live.md).
export const GEOM_COLUMN = {
  EUDR_MONITOREO: 'geom_inspeccion',
  EUDR_USO_SUELO: 'geom',
  EUDR_INSTALACIONES: 'geom',
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
 * Trae todos los registros PENDIENTE (poligonos + puntos) de UNA organización
 * — GAP REAL cerrado en specs/qc_visualization_panel_update.md: el
 * comentario original de esta función decía "RLS ya restringe... del lado
 * de Supabase", pero eso es falso para este frontend (anon key sin sesión,
 * ver el gotcha de RLS en CLAUDE.md) — vw_monitoreo_poligonos/puntos
 * corren con privilegio del owner (postgres), igual que vw_monitoreo_web,
 * así que sin este filtro cualquiera con la anon key veía PENDIENTE de
 * TODAS las organizaciones. Mismo patrón de fetch en dos pasos ya usado en
 * components/gis/MapDashboard.jsx: primero se resuelve la organización
 * activa con una consulta liviana (solo ID_Organizacion, límite 1), recién
 * después se pide el resto de columnas ya filtrado por esa organización —
 * ninguna fila de otra organización llega nunca al navegador.
 */
export async function fetchPendingRecords(supabase) {
  const probe = await supabase
    .from('vw_monitoreo_poligonos')
    .select('ID_Organizacion')
    .eq('estado_revision', PENDING_STATE)
    .limit(1)
  if (probe.error) throw probe.error

  let organizationId = probe.data?.[0]?.ID_Organizacion
  if (!organizationId) {
    const probePuntos = await supabase
      .from('vw_monitoreo_puntos')
      .select('ID_Organizacion')
      .eq('estado_revision', PENDING_STATE)
      .limit(1)
    if (probePuntos.error) throw probePuntos.error
    organizationId = probePuntos.data?.[0]?.ID_Organizacion
  }
  if (!organizationId) return []

  const [poligonos, puntos] = await Promise.all([
    supabase
      .from('vw_monitoreo_poligonos')
      .select(POLIGONOS_COLUMNS)
      .eq('estado_revision', PENDING_STATE)
      .eq('ID_Organizacion', organizationId),
    supabase
      .from('vw_monitoreo_puntos')
      .select(PUNTOS_COLUMNS)
      .eq('estado_revision', PENDING_STATE)
      .eq('ID_Organizacion', organizationId),
  ])

  if (poligonos.error) throw poligonos.error
  if (puntos.error) throw puntos.error

  const records = [...tagRecords(poligonos.data, 'poligono'), ...tagRecords(puntos.data, 'punto')]
  return enrichWithParcelaInfo(supabase, records)
}

/**
 * Trae las geometrías reales de los registros APROBADOS que
 * fn_validar_topologia_eudr reportó como solapados con el registro en
 * validación (`registro.registros_solapados`, ya devuelto por esa RPC —
 * ver supabase/migrations/20260820_fn_validar_topologia_eudr.sql), para
 * que el frontend pueda pintarlos como capa de comparación
 * (specs/consola_qc_layout_y_validacion.md, addendum solapamiento
 * auditable). La RPC ya filtra sus candidatos por
 * `"ID_Organizacion" = v_org` del lado del servidor, así que los
 * `registro_id` recibidos acá ya son de confianza — se filtra IGUAL por
 * `organizationId` como defensa en profundidad (mismo criterio que
 * `assertSameOrganization` en el resto de este archivo), no porque se
 * desconfíe puntualmente de esta lista.
 *
 * `fn_validar_topologia_eudr` solo genera candidatos de solapamiento
 * desde EUDR_MONITOREO/EUDR_USO_SUELO (ver el CTE `candidatos` de la
 * función — EUDR_INSTALACIONES queda excluido ahí porque nunca tiene
 * geometría de área) — alcanza con consultar vw_monitoreo_poligonos.
 */
export async function fetchComparisonGeometries(supabase, registrosSolapados, organizationId) {
  const ids = [...new Set((registrosSolapados || []).map((r) => r.registro_id).filter(Boolean))]
  if (ids.length === 0) return []

  let query = supabase.from('vw_monitoreo_poligonos').select('id_origen,tabla_origen,geom').in('id_origen', ids)
  if (organizationId) query = query.eq('ID_Organizacion', organizationId)

  const { data, error } = await query
  if (error) throw error

  return (data || [])
    .map((row) => {
      let geometry = row.geom
      if (typeof geometry === 'string') {
        try {
          geometry = JSON.parse(geometry)
        } catch {
          geometry = null
        }
      }
      if (!geometry) return null
      return { registro_id: row.id_origen, tabla_origen: row.tabla_origen, geometry }
    })
    .filter(Boolean)
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

/**
 * Corrige atributos de un registro PENDIENTE antes de aprobar/rechazar
 * (Consola QC 2.0, specs/gis_qc_console_v2.md). `attributes`: objeto
 * arbitrario del formulario del cliente — se whitelist-ea explícitamente
 * contra EDITABLE_FIELDS[tabla_origen] acá adentro, nunca se hace un
 * Object.assign genérico (mismo criterio que el resto del proyecto para
 * payloads que vienen de un formulario, ver lib/actions/sociosActions.js).
 * Mismo guard que approveRecord/rejectRecord: solo aplica sobre un
 * registro PENDIENTE de la organización activa, 0 filas afectadas lanza.
 */
export async function updateRecordAttributes(supabase, record, attributes, organizationId) {
  assertSameOrganization(record, organizationId)
  const { table, match } = resolveUpdateTarget(record)

  const allowedFields = EDITABLE_FIELDS[record.tabla_origen] || []
  const payload = {}
  for (const { key } of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(attributes || {}, key)) {
      payload[key] = attributes[key] || null
    }
  }
  if (Object.keys(payload).length === 0) {
    throw new EUDRQcError('No hay ningún campo editable para actualizar.')
  }

  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .match({ ...match, ID_Organizacion: record.ID_Organizacion, estado_revision: PENDING_STATE })
    .select('estado_revision')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new EUDRQcError(
      'No se pudieron guardar los cambios: el registro ya no está en estado PENDIENTE, o fue modificado por otra sesión. Recargá la consola.'
    )
  }
}

/**
 * Corrige la geometría de un registro PENDIENTE (ajuste de vértices desde
 * la Consola QC, geoman — ver app/dashboard/qc/components/QcDetailEditor.jsx).
 * `geometry`: GeoJSON ya editado client-side. Convierte a WKT
 * (geoJsonToWkt, mismo helper que usa el Ingestor de Capas Espaciales) y
 * lo escribe en la columna real (GEOM_COLUMN) — deliberadamente SIN llamar
 * a fn_sanitize_geometry ni calcular área a mano: el trigger
 * trg_gis_sanitize_eudr_* (ADR-001) ya sanitiza y recalcula
 * area_calculada_ha/requiere_revision_area automáticamente al recibir el
 * UPDATE sobre esa columna. Mismo guard PENDIENTE + multi-tenant que el
 * resto de las acciones de esta consola.
 */
export async function updateRecordGeometry(supabase, record, geometry, organizationId) {
  assertSameOrganization(record, organizationId)
  const { table, match } = resolveUpdateTarget(record)

  const column = GEOM_COLUMN[record.tabla_origen]
  if (!column) {
    throw new EUDRQcError(`No se conoce la columna de geometría para ${record.tabla_origen}.`)
  }
  const wkt = geoJsonToWkt(geometry)
  if (!wkt) {
    throw new EUDRQcError('Geometría vacía o inválida — no se guardó ningún cambio.')
  }

  const { data, error } = await supabase
    .from(table)
    .update({ [column]: wkt })
    .match({ ...match, ID_Organizacion: record.ID_Organizacion, estado_revision: PENDING_STATE })
    .select('estado_revision')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new EUDRQcError(
      'No se pudo guardar la geometría: el registro ya no está en estado PENDIENTE, o fue modificado por otra sesión. Recargá la consola.'
    )
  }
}
