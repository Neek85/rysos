// Generador/descargador cliente del Paquete de Trazabilidad EUDR —
// Reglamento UE 2023/1115. Ver docs/adr/ADR-017-formato-real-exportacion-trazabilidad.md
// para la investigación que motivó este archivo: RYZOS no presenta la DDS
// directamente ante TRACES (lo hace el comprador/importador europeo) — este
// módulo arma el paquete de datos que se le entrega.
//
// Dos representaciones DISTINTAS conviven a propósito, y no deben
// confundirse:
//   1. El payload INTERNO (`buildTracesPayload`) — organization_id,
//      total_plots, total_hectares, geojson con properties propias de RYZOS
//      (parcela_codigo, id_parcela, cumple_eudr, hectareas...). Es una
//      convención interna de RYZOS, NUNCA un estándar externo, y es la
//      misma forma que consumen lib/traceabilityHash.js (hash público
//      determinista de /trace/[lot_hash]) y components/gis/PublicLotMap.jsx
//      (labels del mapa público) — no se toca su forma en este archivo
//      porque cambiarla rompería esos dos consumidores en vivo.
//   2. El GeoJSON OFICIAL de geolocalización EUDR (`buildOfficialEuGeoJson`)
//      — properties con el casing exacto ProducerName/ProducerCountry/
//      ProductionPlace/Area que sí exige la Comisión Europea (EUDR
//      Information System / TRACES NT). Se deriva del payload interno solo
//      en el momento de la descarga (`downloadTraceabilityPackage`,
//      format='geojson') — nunca se usa para el hash ni el mapa público.
//
// Contraparte cliente de `scripts/generate_eudr_dds.py`, pero adaptada al
// schema real de `vw_monitoreo_web` (no al de `view_eudr_dashboard_aprobados`
// que usa el script Python): esa vista trae UNA FILA POR EVENTO (perímetro,
// subdivisión de uso de suelo o punto de infraestructura), no una fila por
// parcela — las tres comparten el mismo `area_ha` (PADRON_PARCELAS.totalh
// vía JOIN). Por eso este módulo agrupa por parcela antes de construir cada
// Feature, en vez de tratar cada fila como una parcela independiente.

import kinks from '@turf/kinks'

export const EUDR_REGULATION = 'EU 2023/1115'
export const EUDR_CUTOFF_DATE = '2020-12-31'
export const MIN_POLYGON_HECTARES = 4.0
const COORD_PRECISION = 6

// Único país operado hoy por RYZOS — no existe todavía un campo real de país
// en vw_monitoreo_web/PADRON_PARCELAS (confirmado en la investigación previa
// a ADR-017). Si en el futuro se agrega uno, debe reemplazar este literal en
// buildOfficialEuGeoJson, no coexistir con él.
const DEFAULT_PRODUCER_COUNTRY = 'PE'

// Las 2 modalidades de exportación REALES (specs/gis_mapa_dashboard_polish.md
// corrige la premisa de un prompt anterior que pedía "Polígonos GeoJSON/CSV"
// y "Puntos de Lista de Productores CSV" — ningún formato CSV existe ni está
// especificado en este proyecto). 'json' descarga el paquete interno
// completo (hoja de resumen RYZOS + geometrías); 'geojson' descarga
// EXCLUSIVAMENTE la proyección al esquema oficial de geolocalización EUDR
// (ver ADR-017) — son estructuras distintas, no el mismo geojson en dos
// envoltorios.
export const EXPORT_FORMATS = [
  { value: 'json', label: 'Paquete Completo (JSON)' },
  { value: 'geojson', label: 'Geolocalización (GeoJSON — esquema oficial UE)' },
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

// ADR-028: producto_codigo/producto_nombre solo existen realmente en filas
// de origen EUDR_USO_SUELO (poblados por el trigger BEFORE INSERT sobre esa
// tabla, ver la migración) — NUNCA en EUDR_MONITOREO. Mismo motivo que
// pickCumpleEudr arriba: no se puede leer solo de `boundary`
// (pickBoundaryRecord prefiere EUDR_MONITOREO cuando existe, que siempre
// trae producto_codigo NULL) — hay que buscar en todo el grupo.
function pickProducto(groupRecords) {
  const withValue = groupRecords.find((r) => r.producto_codigo)
  return withValue
    ? { producto_codigo: withValue.producto_codigo, producto_nombre: withValue.producto_nombre }
    : { producto_codigo: null, producto_nombre: null }
}

const LINE_GEOMETRY_TYPES = new Set(['LineString', 'MultiLineString'])

function ringIsClosed(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first?.[0] === last?.[0] && first?.[1] === last?.[1]
}

function polygonRingsClosed(geometry) {
  if (geometry.type === 'Polygon') {
    return (geometry.coordinates || []).every(ringIsClosed)
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).every((poly) => (poly || []).every(ringIsClosed))
  }
  return true
}

function geometrySelfIntersects(geometry) {
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return false
  try {
    const feature = { type: 'Feature', properties: {}, geometry }
    return kinks(feature).features.length > 0
  } catch {
    // Una geometría que kinks() no puede procesar (ej. anillo degenerado)
    // no debe tumbar la exportación por una excepción no controlada — la
    // regla de negocio real (cerrado/sin auto-intersección) ya se evaluó
    // arriba; esto es solo una salvaguarda de robustez.
    return false
  }
}

// Chequeo de integridad de geometría, independiente de la regla de área
// (validatePlotGeometry, abajo). El esquema oficial de geolocalización EUDR
// (ver ADR-017) NUNCA acepta LineString/MultiLineString, exige polígonos
// cerrados (primer punto = último) y sin auto-intersecciones — se corre
// para TODA parcela, incluso las < 4 ha con geometría puntual, a diferencia
// de la regla de polígono obligatorio (que sí depende del área).
function validateGeometryIntegrity(parcelLabel, geometry) {
  if (!geometry) return

  if (LINE_GEOMETRY_TYPES.has(geometry.type)) {
    throw new EUDRValidationError(
      `La parcela "${parcelLabel}" tiene una geometría tipo ${geometry.type}, no aceptada por el ` +
        `esquema de geolocalización EUDR (solo Point/MultiPoint/Polygon/MultiPolygon/GeometryCollection). ` +
        `Corrige el registro de origen antes de exportar.`
    )
  }

  if (!polygonRingsClosed(geometry)) {
    throw new EUDRValidationError(
      `La parcela "${parcelLabel}" tiene un polígono no cerrado (el primer y el último punto de un ` +
        `anillo deben coincidir) — corrige la geometría antes de exportar.`
    )
  }

  if (geometrySelfIntersects(geometry)) {
    throw new EUDRValidationError(
      `La parcela "${parcelLabel}" tiene un polígono con auto-intersecciones — el esquema de ` +
        `geolocalización EUDR exige polígonos simples. Corrige la geometría antes de exportar.`
    )
  }
}

function validatePlotGeometry(parcelLabel, hectares, geometry) {
  validateGeometryIntegrity(parcelLabel, geometry)

  if (hectares < MIN_POLYGON_HECTARES) return
  const geomType = geometry?.type
  if (geomType === 'Polygon' || geomType === 'MultiPolygon') return
  throw new EUDRValidationError(
    `La parcela "${parcelLabel}" tiene ${hectares.toFixed(2)} ha (≥ 4.0 ha) y debe delimitarse con ` +
      `un perímetro cerrado (Polygon) antes de exportar — geometría registrada: ` +
      `${geomType || 'sin geometría'}. Registra el recorrido perimetral completo (Reglamento UE 2023/1115).`
  )
}

// Deriva el organization_id a partir de los registros ya cargados (filtrados
// por RLS del lado de Supabase) — este frontend no tiene todavía un contexto
// de organización/autenticación propio. Si aparece más de un ID_Organizacion
// distinto en el mismo set de registros (no debería ocurrir bajo RLS), se
// trata como una violación multi-tenant en vez de generar un paquete
// ambiguo.
export function resolveOrganizationId(records) {
  const ids = new Set(
    (Array.isArray(records) ? records : []).map((r) => r?.ID_Organizacion).filter(Boolean)
  )
  if (ids.size === 0) return null
  if (ids.size > 1) {
    throw new EUDRValidationError(
      'Los registros cargados pertenecen a más de una organización — no se puede generar un paquete único.'
    )
  }
  return [...ids][0]
}

/**
 * Construye el payload interno (hoja de resumen RYZOS + geojson con
 * properties propias) a partir de los registros aprobados de
 * vw_monitoreo_web para una organización. Una Feature por parcela (no por
 * fila) — ver groupByParcela. Lanza EUDRValidationError si algún registro
 * pertenece a otra organización, si una geometría no es válida (tipo no
 * aceptado, anillo abierto, auto-intersección) o si una parcela ≥ 4 ha no
 * tiene un límite poligonal registrado.
 *
 * NO renombrar/reordenar organization_id/total_plots/total_hectares ni las
 * properties de cada Feature sin revisar lib/traceabilityHash.js
 * (generateLotHash lee exactamente esos campos + properties.id_monitoreo/
 * id_parcela para el hash público determinista de /trace/[lot_hash]) y
 * components/gis/PublicLotMap.jsx (lee properties.parcela_codigo/
 * .hectareas para las etiquetas del mapa público).
 */
export function buildTracesPayload(records, organizationId) {
  if (!organizationId) {
    throw new EUDRValidationError('Se requiere una organización válida para generar el paquete.')
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
    const { producto_codigo, producto_nombre } = pickProducto(groupRecords)

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
        // Distinto de `productor` (arriba): ese es el código crudo resuelto
        // por vw_monitoreo_web (ID_Socio o nuevo_productor_nombre texto
        // libre, ver COALESCE en la vista) — NUNCA el nombre real de una
        // persona salvo que coincida por casualidad. `productor_nombre` es
        // la cascada YA resuelta a nombre real (PADRON_SOCIOS.socio_nombre_completo,
        // con 'Socio no asignado' como último fallback) — es la que debe
        // usarse para ProducerName en buildOfficialEuGeoJson (confirmado
        // con datos reales de ORG-TEST-E2E en la verificación en vivo de
        // ADR-017: `productor` traía literalmente "JS-00002", un código
        // interno, no un nombre).
        productor_nombre: boundary.productor_nombre || null,
        cumple_eudr: pickCumpleEudr(groupRecords),
        deforestation_cutoff_date: EUDR_CUTOFF_DATE,
        hectareas: Number(hectares.toFixed(4)),
        // ADR-028: solo el payload interno -- sin campo oficial confirmado
        // de producto/commodity en TRACES NT (spec sección 1.7), no se
        // agrega a buildOfficialEuGeoJson todavía.
        producto_codigo,
        producto_nombre,
      },
    })
  })

  return {
    // Ya NO se describe como "DUE_DILIGENCE_STATEMENT" — RYZOS no presenta
    // esta DDS directamente ante TRACES (lo hace el comprador/importador
    // europeo), y este wrapper no sigue ningún estándar oficial. Ver
    // ADR-017.
    declaration_type: 'RYZOS_TRACEABILITY_PACKAGE_SUMMARY',
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

/**
 * Proyecta el geojson interno de `payload` al esquema OFICIAL y público de
 * geolocalización EUDR — el que efectivamente exige la Comisión Europea
 * para el archivo GeoJSON que acompaña una DDS real (EUDR Information
 * System / TRACES NT, servidor ACCEPTANCE). Ver ADR-017 para la fuente.
 *
 * Properties oficiales, casing exacto: ProducerName, ProducerCountry,
 * ProductionPlace, Area (siempre numérico — nunca string, el sistema real
 * de TRACES lo trata como 0 si llega como texto). Un dato no disponible se
 * OMITE (nunca se inventa) salvo Area, que siempre se envía calculada —
 * nunca se depende del default implícito de 4 ha que asume TRACES para un
 * punto sin Area.
 */
// Sentinel literal que vw_monitoreo_web usa como último fallback de
// productor_nombre cuando ningún dato real de dueño existe (ver COALESCE en
// 20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql) — no es
// un nombre real, así que ProducerName debe omitirse igual que si fuera null.
const UNASSIGNED_PRODUCER_SENTINEL = 'Socio no asignado'

export function buildOfficialEuGeoJson(payload) {
  const features = (payload?.geojson?.features ?? []).map((feat) => {
    const props = feat?.properties ?? {}
    const officialProps = {}

    const producerName =
      props.productor_nombre && props.productor_nombre !== UNASSIGNED_PRODUCER_SENTINEL
        ? props.productor_nombre
        : null
    if (producerName) officialProps.ProducerName = producerName
    officialProps.ProducerCountry = DEFAULT_PRODUCER_COUNTRY
    const productionPlace = props.parcela_nombre || props.parcela_codigo
    if (productionPlace) officialProps.ProductionPlace = productionPlace
    officialProps.Area = Number(props.hectareas) || 0

    return {
      type: 'Feature',
      geometry: feat?.geometry ?? null,
      properties: officialProps,
    }
  })

  return { type: 'FeatureCollection', features }
}

// Devuelve, para cada parcela cuyo límite es un perímetro EUDR_MONITOREO
// real, el id_monitoreo necesario para invocar fn_cobertura_uso_suelo_parcela
// (requiere boundary.registro_id — agregar 'registro_id' al SELECT del
// caller si no está). Parcelas cuyo límite es una subdivisión de Uso de
// Suelo (sin perímetro de Monitoreo propio) quedan fuera: resolverlas
// requeriría el mismo join EUDR_USO_SUELO.id_parcela ->
// EUDR_MONITOREO.qfield_relation_id que ya usa
// app/api/qc/cobertura-uso-suelo/route.js — fuera de alcance acá, dado que
// la cobertura es solo informativa (nunca bloquea el export, ver ADR-011).
export function resolveMonitoreoIdsForCobertura(records) {
  const approved = (Array.isArray(records) ? records : []).filter(
    (r) => r?.estado_revision === 'APROBADO'
  )
  const groups = groupByParcela(approved)
  const lookups = []
  groups.forEach((groupRecords, parcelKey) => {
    const boundary = pickBoundaryRecord(groupRecords)
    if (boundary?.tabla_origen === 'EUDR_MONITOREO' && boundary?.registro_id) {
      lookups.push({
        parcelKey,
        parcelaCodigo: boundary.parcela_codigo || parcelKey,
        monitoreoId: boundary.registro_id,
      })
    }
  })
  return lookups
}

// Adjunta `cobertura_uso_suelo` como campo NUEVO de nivel superior del
// payload — nunca dentro de organization_id/total_plots/total_hectares ni
// de geojson.features[].properties, que son los únicos campos que
// generateLotHash usa para el hash público (lib/traceabilityHash.js) — así
// que esto NUNCA puede afectar un lot_hash ya impreso/emitido. Puramente
// informativo: `coberturaByMonitoreoId` viene de
// app/api/gis/dds-cobertura/route.js (fn_cobertura_uso_suelo_parcela no
// acepta llamadas anon/navegador — ver esa migración), y una parcela sin
// resultado disponible simplemente queda marcada `disponible: false`, nunca
// lanza ni bloquea la exportación (mismo criterio de ADR-011).
export function attachCoberturaSummary(payload, records, coberturaByMonitoreoId) {
  const lookups = resolveMonitoreoIdsForCobertura(records)
  const cobertura_uso_suelo = lookups.map(({ parcelKey, parcelaCodigo, monitoreoId }) => {
    const r = coberturaByMonitoreoId?.[monitoreoId]
    if (!r) {
      return { id_parcela: parcelKey, parcela_codigo: parcelaCodigo, disponible: false }
    }

    const areaMonitoreo = Number(r.area_monitoreo_ha) || 0
    const sumaUsoSuelo = Number(r.suma_uso_suelo_aprobado_ha) || 0
    const coberturaPct = areaMonitoreo > 0 ? Number(((sumaUsoSuelo / areaMonitoreo) * 100).toFixed(2)) : null
    const huecoCobertura = Boolean(r.hueco_cobertura)

    return {
      id_parcela: parcelKey,
      parcela_codigo: parcelaCodigo,
      disponible: true,
      cobertura_pct: coberturaPct,
      hueco_cobertura: huecoCobertura,
      aviso: huecoCobertura
        ? `Hueco de cobertura de Uso de Suelo detectado${
            coberturaPct != null ? ` (~${(100 - coberturaPct).toFixed(1)}% del área sin clasificar)` : ''
          } — informativo, no bloquea la exportación (ver ADR-011).`
        : null,
    }
  })

  return { ...payload, cobertura_uso_suelo }
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

const DIACRITICS_RANGE_RE = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g")

function sanitizeForFilename(value) {
  const cleaned = String(value || '')
    .normalize('NFD')
    .replace(DIACRITICS_RANGE_RE, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return cleaned || 'ORG'
}

/**
 * Dispara la descarga de UN SOLO archivo a partir de un payload YA
 * construido (`buildTracesPayload`, opcionalmente enriquecido con
 * `attachCoberturaSummary`) — `format`: 'json' descarga el paquete interno
 * completo tal cual (incluye `cobertura_uso_suelo` si se adjuntó); 'geojson'
 * descarga EXCLUSIVAMENTE la proyección al esquema oficial de
 * geolocalización EUDR (`buildOfficialEuGeoJson`), nunca el geojson
 * interno. Reemplaza a la antigua `exportTracesDDS` (ADR-017) — separar
 * "construir el payload" de "descargar" permite adjuntar cobertura entre
 * ambos pasos sin acoplar la descarga a un fetch de red.
 */
export function downloadTraceabilityPackage(payload, format = 'json') {
  const orgSlug = sanitizeForFilename(payload?.organization_id)
  const dateStamp = todayStamp()

  if (format === 'geojson') {
    const officialGeoJson = buildOfficialEuGeoJson(payload)
    triggerDownload(
      `GEOLOCALIZACION_UE_${orgSlug}_${dateStamp}.geojson`,
      JSON.stringify(officialGeoJson, null, 2),
      'application/geo+json'
    )
  } else {
    triggerDownload(
      `PAQUETE_TRAZABILIDAD_${orgSlug}_${dateStamp}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    )
  }

  return payload
}
