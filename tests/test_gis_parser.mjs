// Pruebas de lib/gisParser.js — parseo multi-Feature GeoJSON/KML y
// auto-vinculación de propiedades para el Ingestor de Capas Espaciales
// (/dashboard/mapa). Ver specs/gis_ingestor_web.md.
//
// parseShapefileZipLayer (shpjs, async, requiere un .zip binario real) no
// se cubre acá con un caso de éxito — se prueba solo su manejo de error
// con un buffer vacío; un fixture .zip binario no aporta valor de test
// adicional sobre lo que shpjs ya prueba en su propio paquete.
//
// Ejecutar con: node --test tests/test_gis_parser.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGeoJsonLayer,
  parseKmlLayer,
  parseShapefileZipLayer,
  detectFormat,
  autoMatchProperties,
  GisParseError,
} from '../lib/gisParser.js'

// ---------------------------------------------------------------
// parseGeoJsonLayer — a diferencia de lib/geometryImport.js::parseGeoJson,
// devuelve TODAS las Features, no solo la primera.
// ---------------------------------------------------------------

test('parseGeoJsonLayer devuelve todas las Features de una FeatureCollection', () => {
  const rows = parseGeoJsonLayer(
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id_parcela: 'P-01' }, geometry: { type: 'Point', coordinates: [1, 2] } },
        { type: 'Feature', properties: { id_parcela: 'P-02' }, geometry: { type: 'Point', coordinates: [3, 4] } },
      ],
    })
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].properties.id_parcela, 'P-01')
  assert.equal(rows[1].geometry.coordinates[0], 3)
})

test('parseGeoJsonLayer acepta una Feature suelta', () => {
  const rows = parseGeoJsonLayer(
    JSON.stringify({ type: 'Feature', properties: { a: 1 }, geometry: { type: 'Point', coordinates: [1, 2] } })
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].properties.a, 1)
})

test('parseGeoJsonLayer acepta un objeto de geometría "pelado" (properties vacío)', () => {
  const rows = parseGeoJsonLayer(JSON.stringify({ type: 'Point', coordinates: [1, 2] }))
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].properties, {})
})

test('parseGeoJsonLayer descarta Features sin geometría, no lanza si al menos una es válida', () => {
  const rows = parseGeoJsonLayer(
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: null },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } },
      ],
    })
  )
  assert.equal(rows.length, 1)
})

test('parseGeoJsonLayer lanza GisParseError con JSON inválido', () => {
  assert.throws(() => parseGeoJsonLayer('{ esto no es json'), GisParseError)
})

test('parseGeoJsonLayer lanza GisParseError si ninguna Feature tiene geometría', () => {
  assert.throws(
    () =>
      parseGeoJsonLayer(
        JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: null }] })
      ),
    GisParseError
  )
})

// ---------------------------------------------------------------
// parseKmlLayer
// ---------------------------------------------------------------

const SAMPLE_KML_MULTI = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Parcela 1</name>
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
    <Placemark>
      <name>Instalación 1</name>
      <Point>
        <coordinates>-77.45,-6.45,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`

test('parseKmlLayer convierte los 2 Placemarks a Features separadas', () => {
  const rows = parseKmlLayer(SAMPLE_KML_MULTI)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].geometry.type, 'Polygon')
  assert.equal(rows[1].geometry.type, 'Point')
})

test('parseKmlLayer lanza GisParseError con XML sin geometría', () => {
  assert.throws(() => parseKmlLayer('<?xml version="1.0"?><kml><Document></Document></kml>'), GisParseError)
})

// ---------------------------------------------------------------
// parseShapefileZipLayer — solo el caso de error (buffer inválido)
// ---------------------------------------------------------------

test('parseShapefileZipLayer lanza GisParseError con un buffer que no es un zip válido', async () => {
  const buffer = new TextEncoder().encode('esto no es un zip').buffer
  await assert.rejects(() => parseShapefileZipLayer(buffer), GisParseError)
})

// ---------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------

test('detectFormat reconoce .geojson/.json/.kml/.zip', () => {
  assert.equal(detectFormat('capa.geojson'), 'geojson')
  assert.equal(detectFormat('capa.json'), 'geojson')
  assert.equal(detectFormat('capa.kml'), 'kml')
  assert.equal(detectFormat('capa.zip'), 'shapefile')
})

test('detectFormat lanza GisParseError con .gpkg (fuera de alcance) u otra extensión no soportada', () => {
  assert.throws(() => detectFormat('capa.gpkg'), GisParseError)
  assert.throws(() => detectFormat('capa.shp'), GisParseError)
})

// ---------------------------------------------------------------
// autoMatchProperties
// ---------------------------------------------------------------

test('autoMatchProperties detecta ID_Socio/parcela_codigo case-insensitive para PADRON_PARCELAS', () => {
  const result = autoMatchProperties({ id_socio: 'JS-00001', Codigo_Parcela: 'P-01' }, 'PADRON_PARCELAS')
  assert.equal(result.ID_Socio, 'JS-00001')
  assert.equal(result.parcela_codigo, 'P-01')
})

test('autoMatchProperties detecta id_parcela/tipo_uso para EUDR_USO_SUELO', () => {
  const result = autoMatchProperties({ ID_PARCELA: 'COOP-001', tipo_uso: 'Café' }, 'EUDR_USO_SUELO')
  assert.equal(result.id_parcela, 'COOP-001')
  assert.equal(result.tipo_uso, 'Café')
})

test('autoMatchProperties detecta id_parcela/tipo_infra para EUDR_INSTALACIONES', () => {
  const result = autoMatchProperties({ id_parcela: 'COOP-001', tipo_infra: 'Vivienda' }, 'EUDR_INSTALACIONES')
  assert.equal(result.id_parcela, 'COOP-001')
  assert.equal(result.tipo_infra, 'Vivienda')
})

test('autoMatchProperties detecta ID_Socio/ID_Parcela_Fija para EUDR_MONITOREO, con candidatos alternativos', () => {
  const result = autoMatchProperties({ socio_id: 'JS-00002', codigo_finca: 'F-002' }, 'EUDR_MONITOREO')
  assert.equal(result.ID_Socio, 'JS-00002')
  assert.equal(result.ID_Parcela_Fija, 'F-002')
})

test('autoMatchProperties devuelve null por campo sin lanzar cuando no hay coincidencia', () => {
  const result = autoMatchProperties({ nombre: 'Sin relación' }, 'PADRON_PARCELAS')
  assert.equal(result.ID_Socio, null)
  assert.equal(result.parcela_codigo, null)
})

test('autoMatchProperties ignora valores vacíos como si no existieran', () => {
  const result = autoMatchProperties({ id_socio: '' }, 'PADRON_PARCELAS')
  assert.equal(result.ID_Socio, null)
})

test('autoMatchProperties devuelve objeto vacío para una tabla destino desconocida', () => {
  assert.deepEqual(autoMatchProperties({ id_socio: 'JS-1' }, 'TABLA_INEXISTENTE'), {})
})
