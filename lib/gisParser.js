// Parseo de capas espaciales multi-formato para el Modal de Carga Espacial
// (/dashboard/mapa) — GeoJSON/KML/Shapefile-ZIP. GPKG queda fuera de
// alcance (ver specs/gis_ingestor_web.md): no hay parser JS liviano viable
// sin un servicio GDAL nuevo, y `gdal-async` requiere bindings nativos que
// no corren en el hosting serverless real de este proyecto.
//
// Funciones puras (archivo -> array de Features normalizadas), sin
// dependencia de Supabase — la sanitización real (SRID 4326, 6 decimales)
// ocurre server-side: trigger de BD para las tablas EUDR_* (ver ADR-001),
// o RPC fn_sanitize_geometry vía createParcela para PADRON_PARCELAS (ver
// lib/actions/sociosActions.js). A diferencia de lib/geometryImport.js
// (que solo toma la primera geometría de un archivo, para el caso de "una
// parcela a la vez"), este módulo devuelve TODAS las Features de la
// colección — el caso de uso normal acá es "una capa completa con N
// features".

import { kml } from '@tmcw/togeojson'
import { DOMParser } from '@xmldom/xmldom'
import shp from 'shpjs'

export class GisParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GisParseError'
  }
}

function normalizeFeatureCollection(geojson) {
  if (!geojson || typeof geojson !== 'object') {
    throw new GisParseError('El archivo no contiene un objeto GeoJSON válido.')
  }
  let features
  if (geojson.type === 'FeatureCollection') {
    features = geojson.features || []
  } else if (geojson.type === 'Feature') {
    features = [geojson]
  } else if (geojson.type && geojson.coordinates) {
    features = [{ type: 'Feature', geometry: geojson, properties: {} }]
  } else {
    throw new GisParseError('Formato GeoJSON no reconocido.')
  }

  const withGeom = features.filter((f) => f?.geometry)
  if (withGeom.length === 0) {
    throw new GisParseError('El archivo no contiene ninguna geometría.')
  }
  return withGeom.map((f) => ({ geometry: f.geometry, properties: f.properties || {} }))
}

/** Parsea un archivo .geojson/.json -> array de { geometry, properties }. */
export function parseGeoJsonLayer(text) {
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    throw new GisParseError('El archivo no es JSON válido.')
  }
  return normalizeFeatureCollection(obj)
}

/** Parsea un archivo .kml (vía @tmcw/togeojson) -> array de { geometry, properties }. */
export function parseKmlLayer(text) {
  let doc
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml')
  } catch {
    throw new GisParseError('El archivo no es XML/KML válido.')
  }
  let converted
  try {
    converted = kml(doc)
  } catch {
    throw new GisParseError('No se pudo convertir el KML a GeoJSON.')
  }
  return normalizeFeatureCollection(converted)
}

/**
 * Parsea un Shapefile empaquetado en .zip (.shp + .dbf, .prj opcional para
 * reproyección automática a WGS84 vía proj4, dependencia interna de shpjs)
 * -> array de { geometry, properties }. `buffer`: ArrayBuffer del .zip.
 * Async porque shpjs decodifica el .zip de forma asíncrona.
 */
export async function parseShapefileZipLayer(buffer) {
  let geojson
  try {
    geojson = await shp(buffer)
  } catch (err) {
    throw new GisParseError(
      `No se pudo leer el Shapefile: ${err?.message || 'archivo corrupto o incompleto (requiere .shp + .dbf dentro del .zip).'}`
    )
  }
  // shpjs devuelve un array si el .zip trae más de una capa .shp — se toma
  // la primera (un modal de carga de UNA capa a la vez, mismo alcance que
  // GeoJSON/KML).
  const collection = Array.isArray(geojson) ? geojson[0] : geojson
  return normalizeFeatureCollection(collection)
}

const EXTENSION_FORMATS = { geojson: 'geojson', json: 'geojson', kml: 'kml', zip: 'shapefile' }

/** Detecta el formato soportado a partir del nombre de archivo, o lanza con un mensaje que lista las opciones reales. */
export function detectFormat(filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase()
  const format = EXTENSION_FORMATS[ext]
  if (!format) {
    throw new GisParseError(
      `Formato de archivo no soportado (.${ext || '?'}) — usa .geojson, .json, .kml o .zip (Shapefile). ` +
        'GPKG no está soportado (ver specs/gis_ingestor_web.md).'
    )
  }
  return format
}

// Candidatos de nombre de propiedad por campo destino — mismo patrón
// "candidate-list" que scripts/etl_drive_to_supabase.py::resolve_field_with_fallback,
// porque el nombre de atributo varía según el software de origen del
// archivo (QGIS, ArcGIS, Google Earth, etc.). Comparación case-insensitive.
const FIELD_CANDIDATES = {
  ID_Socio: ['id_socio', 'socio_id', 'codigo_socio'],
  parcela_codigo: ['parcela_codigo', 'codigo_parcela', 'cod_parcela'],
  ID_Parcela_Fija: ['id_parcela_fija', 'id_parcela', 'parcela_id', 'codigo_finca'],
  id_parcela: ['id_parcela', 'id_parcela_fija', 'parcela_id'],
  tipo_uso: ['tipo_uso', 'uso', 'tipo'],
  tipo_infra: ['tipo_infra', 'tipo_instalacion', 'tipo'],
}

function findPropertyValue(properties, candidates) {
  const entries = Object.entries(properties || {})
  for (const candidate of candidates) {
    const hit = entries.find(([key]) => key.toLowerCase() === candidate)
    if (hit && hit[1] !== null && hit[1] !== undefined && hit[1] !== '') return String(hit[1])
  }
  return null
}

/**
 * Auto-detecta los campos relevantes de una Feature según la tabla
 * destino elegida en el modal — nunca lanza si no encuentra ninguna
 * coincidencia, devuelve `null` por campo (el usuario completa/corrige en
 * la vista previa antes de confirmar la carga).
 */
export function autoMatchProperties(properties, targetTable) {
  if (targetTable === 'PADRON_PARCELAS') {
    return {
      ID_Socio: findPropertyValue(properties, FIELD_CANDIDATES.ID_Socio),
      parcela_codigo: findPropertyValue(properties, FIELD_CANDIDATES.parcela_codigo),
    }
  }
  if (targetTable === 'EUDR_MONITOREO') {
    return {
      ID_Socio: findPropertyValue(properties, FIELD_CANDIDATES.ID_Socio),
      ID_Parcela_Fija: findPropertyValue(properties, FIELD_CANDIDATES.ID_Parcela_Fija),
    }
  }
  if (targetTable === 'EUDR_USO_SUELO') {
    return {
      id_parcela: findPropertyValue(properties, FIELD_CANDIDATES.id_parcela),
      tipo_uso: findPropertyValue(properties, FIELD_CANDIDATES.tipo_uso),
    }
  }
  if (targetTable === 'EUDR_INSTALACIONES') {
    return {
      id_parcela: findPropertyValue(properties, FIELD_CANDIDATES.id_parcela),
      tipo_infra: findPropertyValue(properties, FIELD_CANDIDATES.tipo_infra),
    }
  }
  return {}
}
