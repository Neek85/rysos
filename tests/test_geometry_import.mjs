// Pruebas de lib/geometryImport.js — parseo de GeoJSON/KML/CSV a
// geometría estándar para el modal de Parcela. Ver specs/padron_web_socios.md.
//
// Ejecutar con: node --test tests/test_geometry_import.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGeoJson,
  parseKml,
  parseCsvPoints,
  parseGeometryFile,
  geoJsonToWkt,
  GeometryImportError,
} from '../lib/geometryImport.js'

// ---------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------

test('parseGeoJson acepta un objeto de geometría "pelado"', () => {
  const geom = parseGeoJson(JSON.stringify({ type: 'Point', coordinates: [-77.5, -6.5] }))
  assert.deepEqual(geom, { type: 'Point', coordinates: [-77.5, -6.5] })
})

test('parseGeoJson acepta una Feature', () => {
  const geom = parseGeoJson(
    JSON.stringify({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [-77.5, -6.5] },
    })
  )
  assert.equal(geom.type, 'Point')
})

test('parseGeoJson acepta una FeatureCollection y toma la primera geometría', () => {
  const geom = parseGeoJson(
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [3, 4] } },
      ],
    })
  )
  assert.deepEqual(geom.coordinates, [1, 2])
})

test('parseGeoJson lanza GeometryImportError con JSON inválido', () => {
  assert.throws(() => parseGeoJson('{ esto no es json'), GeometryImportError)
})

test('parseGeoJson lanza GeometryImportError con una FeatureCollection vacía', () => {
  assert.throws(() => parseGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [] })), GeometryImportError)
})

// ---------------------------------------------------------------
// KML
// ---------------------------------------------------------------

const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Parcela de prueba</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              -77.5,-6.5,0 -77.4,-6.5,0 -77.4,-6.4,0 -77.5,-6.4,0 -77.5,-6.5,0
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`

test('parseKml convierte un Placemark Polygon a geometry GeoJSON', () => {
  const geom = parseKml(SAMPLE_KML)
  assert.equal(geom.type, 'Polygon')
  assert.ok(geom.coordinates[0].length >= 4)
})

test('parseKml lanza GeometryImportError con XML sin geometría', () => {
  assert.throws(
    () => parseKml('<?xml version="1.0"?><kml><Document></Document></kml>'),
    GeometryImportError
  )
})

// ---------------------------------------------------------------
// CSV
// ---------------------------------------------------------------

test('parseCsvPoints con 1 fila produce un Point', () => {
  const geom = parseCsvPoints('lat,lon\n-6.5,-77.5')
  assert.deepEqual(geom, { type: 'Point', coordinates: [-77.5, -6.5] })
})

test('parseCsvPoints con >= 3 filas produce un Polygon cerrado', () => {
  const geom = parseCsvPoints('lat,lon\n-6.5,-77.5\n-6.5,-77.4\n-6.4,-77.4\n-6.4,-77.5')
  assert.equal(geom.type, 'Polygon')
  const ring = geom.coordinates[0]
  assert.equal(ring.length, 5) // 4 puntos + cierre
  assert.deepEqual(ring[0], ring[ring.length - 1])
})

test('parseCsvPoints acepta encabezados en español (latitud/longitud)', () => {
  const geom = parseCsvPoints('latitud,longitud\n-6.5,-77.5')
  assert.deepEqual(geom, { type: 'Point', coordinates: [-77.5, -6.5] })
})

test('parseCsvPoints sin encabezado reconocible asume lat,lon en las 2 primeras columnas', () => {
  const geom = parseCsvPoints('-6.5,-77.5')
  assert.deepEqual(geom, { type: 'Point', coordinates: [-77.5, -6.5] })
})

test('parseCsvPoints ya cerrado (primer punto == último) no duplica el cierre', () => {
  const geom = parseCsvPoints(
    'lat,lon\n-6.5,-77.5\n-6.5,-77.4\n-6.4,-77.4\n-6.4,-77.5\n-6.5,-77.5'
  )
  assert.equal(geom.coordinates[0].length, 5)
})

test('parseCsvPoints lanza GeometryImportError con lat/lon no numéricos', () => {
  assert.throws(() => parseCsvPoints('lat,lon\nabc,def'), GeometryImportError)
})

test('parseCsvPoints lanza GeometryImportError con CSV vacío', () => {
  assert.throws(() => parseCsvPoints(''), GeometryImportError)
})

test('parseCsvPoints lanza GeometryImportError con exactamente 2 puntos (insuficiente para polígono)', () => {
  assert.throws(() => parseCsvPoints('lat,lon\n-6.5,-77.5\n-6.4,-77.4'), GeometryImportError)
})

// ---------------------------------------------------------------
// parseGeometryFile — despacho por extensión
// ---------------------------------------------------------------

test('parseGeometryFile despacha .geojson/.json/.kml/.csv al parser correcto', () => {
  assert.equal(
    parseGeometryFile('lote.geojson', JSON.stringify({ type: 'Point', coordinates: [1, 2] })).type,
    'Point'
  )
  assert.equal(
    parseGeometryFile('lote.json', JSON.stringify({ type: 'Point', coordinates: [1, 2] })).type,
    'Point'
  )
  assert.equal(parseGeometryFile('lote.kml', SAMPLE_KML).type, 'Polygon')
  assert.equal(parseGeometryFile('lote.csv', 'lat,lon\n-6.5,-77.5').type, 'Point')
})

test('parseGeometryFile lanza GeometryImportError con una extensión no soportada', () => {
  assert.throws(() => parseGeometryFile('lote.shp', 'contenido'), GeometryImportError)
})

// ---------------------------------------------------------------
// geoJsonToWkt
// ---------------------------------------------------------------

test('geoJsonToWkt convierte un Point', () => {
  assert.equal(geoJsonToWkt({ type: 'Point', coordinates: [-77.5, -6.5] }), 'POINT(-77.5 -6.5)')
})

test('geoJsonToWkt convierte un Polygon', () => {
  const wkt = geoJsonToWkt({
    type: 'Polygon',
    coordinates: [[[-77.5, -6.5], [-77.4, -6.5], [-77.4, -6.4], [-77.5, -6.5]]],
  })
  assert.equal(wkt, 'POLYGON((-77.5 -6.5, -77.4 -6.5, -77.4 -6.4, -77.5 -6.5))')
})

test('geoJsonToWkt ignora campos extra como crs (respuesta real de fn_sanitize_geometry)', () => {
  const wkt = geoJsonToWkt({
    type: 'Point',
    crs: { type: 'name', properties: { name: 'EPSG:4326' } },
    coordinates: [-77.123457, -6.987654],
  })
  assert.equal(wkt, 'POINT(-77.123457 -6.987654)')
})

test('geoJsonToWkt devuelve null con geometría nula', () => {
  assert.equal(geoJsonToWkt(null), null)
})

test('geoJsonToWkt lanza GeometryImportError con un tipo no soportado', () => {
  assert.throws(() => geoJsonToWkt({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }), GeometryImportError)
})
