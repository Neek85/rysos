// Parseo de archivos de geometría (GeoJSON/KML/CSV) para el modal de
// Parcela en /dashboard/socios — ver specs/padron_web_socios.md.
// Todas las funciones son puras (texto → geometry GeoJSON o excepción),
// sin dependencia de red ni de Supabase — la sanitización real
// (SRID 4326, 6 decimales, validez topológica) ocurre server-side vía
// fn_sanitize_geometry (lib/actions/sociosActions.js), este módulo solo
// normaliza el formato de entrada a un `geometry` GeoJSON estándar.

import { kml } from '@tmcw/togeojson'
import { DOMParser } from '@xmldom/xmldom'

export class GeometryImportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GeometryImportError'
  }
}

function firstGeometryFromGeoJson(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new GeometryImportError('El archivo no contiene un objeto GeoJSON válido.')
  }
  if (obj.type === 'FeatureCollection') {
    const withGeom = (obj.features || []).find((f) => f?.geometry)
    if (!withGeom) throw new GeometryImportError('La colección no tiene ninguna geometría.')
    return withGeom.geometry
  }
  if (obj.type === 'Feature') {
    if (!obj.geometry) throw new GeometryImportError('La Feature no tiene geometría.')
    return obj.geometry
  }
  // Objeto de geometría "pelado" (Point/Polygon/MultiPolygon/...)
  if (obj.type && obj.coordinates) return obj
  throw new GeometryImportError('Formato GeoJSON no reconocido.')
}

/** Parsea un archivo .geojson/.json → geometry GeoJSON. */
export function parseGeoJson(text) {
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    throw new GeometryImportError('El archivo no es JSON válido.')
  }
  return firstGeometryFromGeoJson(obj)
}

/** Parsea un archivo .kml → geometry GeoJSON (vía @tmcw/togeojson). */
export function parseKml(text) {
  let doc
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml')
  } catch {
    throw new GeometryImportError('El archivo no es XML/KML válido.')
  }
  let converted
  try {
    converted = kml(doc)
  } catch {
    throw new GeometryImportError('No se pudo convertir el KML a GeoJSON.')
  }
  return firstGeometryFromGeoJson(converted)
}

function splitCsvLine(line) {
  return line.split(',').map((cell) => cell.trim())
}

/**
 * Parsea un CSV de vértices (una fila por punto, columnas lat/lon o
 * latitud/longitud, en orden de recorrido). 1 fila -> Point; >= 3 filas
 * -> Polygon (se cierra automáticamente repitiendo el primer punto si
 * hace falta).
 */
export function parseCsvPoints(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length === 0) {
    throw new GeometryImportError('El CSV está vacío.')
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
  const latIdx = header.findIndex((h) => h === 'lat' || h === 'latitud' || h === 'latitude')
  const lonIdx = header.findIndex((h) => h === 'lon' || h === 'lng' || h === 'longitud' || h === 'longitude')

  const hasHeader = latIdx !== -1 && lonIdx !== -1
  const dataLines = hasHeader ? lines.slice(1) : lines
  const [effectiveLatIdx, effectiveLonIdx] = hasHeader ? [latIdx, lonIdx] : [0, 1]

  if (dataLines.length === 0) {
    throw new GeometryImportError('El CSV no tiene filas de datos.')
  }

  const points = dataLines.map((line, i) => {
    const cells = splitCsvLine(line)
    const lat = Number(cells[effectiveLatIdx])
    const lon = Number(cells[effectiveLonIdx])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new GeometryImportError(`Fila ${i + 1}: lat/lon inválidos ("${line}").`)
    }
    return [lon, lat] // GeoJSON: [lon, lat]
  })

  if (points.length === 1) {
    return { type: 'Point', coordinates: points[0] }
  }

  const first = points[0]
  const last = points[points.length - 1]
  const closed = first[0] === last[0] && first[1] === last[1] ? points : [...points, first]

  if (closed.length < 4) {
    throw new GeometryImportError('Se necesitan al menos 3 puntos distintos para formar un polígono.')
  }

  return { type: 'Polygon', coordinates: [closed] }
}

/**
 * Convierte una geometry GeoJSON (Point/Polygon/MultiPolygon) a WKT —
 * formato que fn_sanitize_geometry acepta como parámetro RPC (confirmado
 * empíricamente contra la instancia real, ver
 * docs/audits/verification_checklist_20260818.md). Se usa tanto para
 * enviar la geometría parseada a la función de sanitización como para
 * convertir su respuesta (GeoJSON) de vuelta a WKT antes de guardarla en
 * PADRON_PARCELAS.geom.
 */
export function geoJsonToWkt(geometry) {
  if (!geometry) return null
  const { type, coordinates } = geometry

  const point = ([lon, lat]) => `${lon} ${lat}`
  const ring = (r) => `(${r.map(point).join(', ')})`

  if (type === 'Point') return `POINT(${point(coordinates)})`
  if (type === 'Polygon') return `POLYGON(${coordinates.map(ring).join(', ')})`
  if (type === 'MultiPolygon') {
    return `MULTIPOLYGON(${coordinates.map((poly) => `(${poly.map(ring).join(', ')})`).join(', ')})`
  }
  throw new GeometryImportError(`Tipo de geometría no soportado para WKT: ${type}`)
}

const PARSERS_BY_EXTENSION = {
  geojson: parseGeoJson,
  json: parseGeoJson,
  kml: parseKml,
  csv: parseCsvPoints,
}

/** Despacha al parser correcto según la extensión del nombre de archivo. */
export function parseGeometryFile(filename, text) {
  const ext = (filename || '').split('.').pop()?.toLowerCase()
  const parser = PARSERS_BY_EXTENSION[ext]
  if (!parser) {
    throw new GeometryImportError(
      `Formato de archivo no soportado (.${ext || '?'}) — usa .geojson, .json, .kml o .csv.`
    )
  }
  return parser(text)
}
