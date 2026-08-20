// Generador/descargador cliente de la Declaración de Debida Diligencia (DDS)
// EUDR — Reglamento UE 2023/1115, formato TRACES UE.
//
// Contraparte cliente de `scripts/generate_eudr_dds.py`, pero adaptada al
// schema real de `vw_monitoreo_web` (no al de `view_eudr_dashboard_aprobados`
// que usa el script Python): esa vista trae UNA FILA POR EVENTO (perímetro,
// subdivisión de uso de suelo o punto de infraestructura), no una fila por
// parcela — las tres comparten el mismo `area_ha` (PADRON_PARCELAS.totalh
// vía JOIN). Por eso este módulo agrupa por parcela antes de construir cada
// Feature, en vez de tratar cada fila como una parcela independiente.

export const EUDR_REGULATION = 'EU 2023/1115'
export const EUDR_CUTOFF_DATE = '2020-12-31'
export const MIN_POLYGON_HECTARES = 4.0
const COORD_PRECISION = 6

// Las 2 modalidades de exportación REALES (specs/gis_mapa_dashboard_polish.md
// corrige la premisa de un prompt anterior que pedía "Polígonos GeoJSON/CSV"
// y "Puntos de Lista de Productores CSV" — ningún formato CSV existe ni está
// especificado en este proyecto). `exportTracesDDS` antes descargaba SIEMPRE
// los 2 archivos en el mismo click; ahora el caller elige uno de estos dos
// valores explícitamente.
export const EXPORT_FORMATS = [
  { value: 'json', label: 'DDS Completo (JSON)' },
  { value: 'geojson', label: 'Geometrías (GeoJSON)' },
]

export class EUDRValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EUDRValidationError'
  }
}

function parseGeometry(record) {
  if (!record?.geom_geojson) return null
  try {
    return typeof record.geom_geojson === 'string'
      ? JSON.parse(record.geom_geojson)
      : record.geom_geojson
  } catch {
    return null
  }
}

function roundCoords(coords, precision) {
  if (typeof coords[0] === 'number') {
    return coords.map((c) => Number(c.toFixed(precision)))
  }
  return coords.map((c) => roundCoords(c, precision))
}

function formatGeometryPrecision(geometry, precision = COORD_PRECISION) {
  if (!geometry || !geometry.coordinates) return geometry
  return { type: geometry.type, coordinates: roundCoords(geometry.coordinates, precision) }
}

// INVARIANTE: ver comentario de cabecera — agrupar por ID_Parcela_Fija evita
// contar el área de una misma parcela una vez por cada subdivisión/punto de
// infraestructura que tenga registrada.
function groupByParcela(records) {
  const groups = new Map()
  records.forEach((record) => {
    const key = record.ID_Parcela_Fija || record.parcela_codigo
    if (!key) return
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  })
  return groups
}

// INVARIANTE: el límite de una parcela lo define su perímetro
// (EUDR_MONITOREO) o, en su defecto, una subdivisión de uso de suelo
// (EUDR_USO_SUELO, siempre polígono por diseño). Un punto de
// EUDR_INSTALACIONES NUNCA representa el límite de la parcela — es un
// elemento puntual (vivienda, fuente de agua, etc.) dentro de ella, así que
// nunca se usa como geometría de la Feature ni queda sujeto a la regla de
// polígono obligatorio por hectáreas.
function pickBoundaryRecord(groupRecords) {
  return (
    groupRecords.find((r) => r.tabla_origen === 'EUDR_MONITOREO') ||
    groupRecords.find((r) => r.tabla_origen === 'EUDR_USO_SUELO') ||
    groupRecords[0]
  )
}

// cumple_eudr solo existe realmente en EUDR_MONITOREO — las filas de
// EUDR_USO_SUELO/EUDR_INSTALACIONES lo traen NULL desde la vista.
function pickCumpleEudr(groupRecords) {
  const withValue = groupRecords.find((r) => r.cumple_eudr)
  return withValue ? withValue.cumple_eudr : null
}

function validatePlotGeometry(parcelLabel, hectares, geometry) {
  if (hectares < MIN_POLYGON_HECTARES) return
  const geomType = geometry?.type
  if (geomType === 'Polygon' || geomType === 'MultiPolygon') return
  throw new EUDRValidationError(
    `La parcela "${parcelLabel}" tiene ${hectares.toFixed(2)} ha (≥ 4.0 ha) y debe delimitarse con ` +
      `un perímetro cerrado (Polygon) antes de exportar la DDS — geometría registrada: ` +
      `${geomType || 'sin geometría'}. Registra el recorrido perimetral completo (Reglamento UE 2023/1115).`
  )
}

// Deriva el organization_id a partir de los registros ya cargados (filtrados
// por RLS del lado de Supabase) — este frontend no tiene todavía un contexto
// de organización/autenticación propio. Si aparece más de un ID_Organizacion
// distinto en el mismo set de registros (no debería ocurrir bajo RLS), se
// trata como una violación multi-tenant en vez de generar una DDS ambigua.
export function resolveOrganizationId(records) {
  const ids = new Set(
    (Array.isArray(records) ? records : []).map((r) => r?.ID_Organizacion).filter(Boolean)
  )
  if (ids.size === 0) return null
  if (ids.size > 1) {
    throw new EUDRValidationError(
      'Los registros cargados pertenecen a más de una organización — no se puede generar una DDS única.'
    )
  }
  return [...ids][0]
}

/**
 * Construye el payload TRACES UE (DDS) a partir de los registros aprobados
 * de vw_monitoreo_web para una organización. Una Feature por parcela (no por
 * fila) — ver groupByParcela. Lanza EUDRValidationError si algún registro
 * pertenece a otra organización o si una parcela ≥ 4 ha no tiene un límite
 * poligonal registrado.
 */
export function buildTracesPayload(records, organizationId) {
  if (!organizationId) {
    throw new EUDRValidationError('Se requiere una organización válida para generar la DDS.')
  }

  const approved = (Array.isArray(records) ? records : []).filter(
    (r) => r?.estado_revision === 'APROBADO'
  )

  approved.forEach((record) => {
    if (record.ID_Organizacion !== organizationId) {
      throw new EUDRValidationError(
        `Violación multi-tenant: el registro de la parcela ` +
          `"${record.parcela_codigo || record.ID_Parcela_Fija || 'desconocida'}" no pertenece a ` +
          `la organización ${organizationId}.`
      )
    }
  })

  const groups = groupByParcela(approved)
  const features = []
  let totalHectares = 0

  groups.forEach((groupRecords, parcelKey) => {
    const boundary = pickBoundaryRecord(groupRecords)
    const hectares = Number(boundary.area_ha) || 0
    const geometry = parseGeometry(boundary)
    const label = boundary.parcela_codigo || parcelKey

    validatePlotGeometry(label, hectares, geometry)

    totalHectares += hectares
    features.push({
      type: 'Feature',
      geometry: geometry ? formatGeometryPrecision(geometry) : null,
      properties: {
        id_parcela: parcelKey,
        parcela_codigo: boundary.parcela_codigo || null,
        parcela_nombre: boundary.parcela_nombre || null,
        productor: boundary.productor || null,
        cumple_eudr: pickCumpleEudr(groupRecords),
        deforestation_cutoff_date: EUDR_CUTOFF_DATE,
        hectareas: Number(hectares.toFixed(4)),
      },
    })
  })

  return {
    declaration_type: 'DUE_DILIGENCE_STATEMENT',
    regulation: EUDR_REGULATION,
    organization_id: organizationId,
    total_plots: features.length,
    total_hectares: Number(totalHectares.toFixed(4)),
    geojson: {
      type: 'FeatureCollection',
      features,
    },
  }
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function todayStamp() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

function sanitizeForFilename(value) {
  const cleaned = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return cleaned || 'ORG'
}

/**
 * Genera el payload TRACES UE y dispara la descarga de UN SOLO archivo —
 * `format`: 'json' (DDS completo) o 'geojson' (solo la FeatureCollection),
 * nunca ambos a la vez (antes de specs/gis_mapa_dashboard_polish.md,
 * descargaba los 2 siempre en el mismo click sin que el usuario pudiera
 * elegir). Lanza EUDRValidationError si alguna regla EUDR no se cumple —
 * el caller decide cómo mostrarlo (toast/alert).
 */
export function exportTracesDDS(records, organizationId, format = 'json') {
  const payload = buildTracesPayload(records, organizationId)

  const orgSlug = sanitizeForFilename(organizationId)
  const dateStamp = todayStamp()

  if (format === 'geojson') {
    triggerDownload(
      `DDS_GEOMETRIAS_${orgSlug}_${dateStamp}.geojson`,
      JSON.stringify(payload.geojson, null, 2),
      'application/geo+json'
    )
  } else {
    triggerDownload(
      `DDS_TRACES_${orgSlug}_${dateStamp}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    )
  }

  return payload
}
