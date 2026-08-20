// Pruebas de las funciones puras de lib/gisVectorEditor.js — cálculo de
// área/auto-intersección y restricción de tipo de geometría por tabla
// destino, usadas por app/dashboard/qc/components/VectorEditorTools.jsx
// (reubicado desde /dashboard/mapa, ver specs/ui_reorganization_geoman.md).
// Ver specs/gis_vector_editor.md.
//
// attachVectorEditor/useVectorEditor (en VectorEditorTools.jsx, dependen
// de un mapa Leaflet real — L.Map, DOM, y son .jsx con JSX que node --test
// no puede parsear sin transformar) no se cubren acá. Se cubren con un
// smoke test en navegador real (claude-in-chrome), no con node --test.
//
// Ejecutar con: node --test tests/test_gis_editor.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateGeometry, isGeometryAllowedForTable } from '../lib/gisVectorEditor.js'
import { TARGET_TABLE_GEOMETRY_TYPES } from '../lib/gisTargetTables.js'

// ---------------------------------------------------------------
// evaluateGeometry — área
// ---------------------------------------------------------------

// Cuadrado ~1km x 1km alrededor del ecuador/meridiano de referencia —
// área esperada ~100 ha (orden de magnitud, no un valor exacto: @turf/area
// usa una esfera aproximada, no la elipsoide WGS84 exacta que usa PostGIS
// server-side, ver spec).
const SQUARE_1KM = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0.009, 0],
      [0.009, 0.009],
      [0, 0.009],
      [0, 0],
    ],
  ],
}

test('evaluateGeometry calcula área en hectáreas para un Polygon', () => {
  const { areaHa } = evaluateGeometry(SQUARE_1KM)
  assert.ok(areaHa > 90 && areaHa < 110, `área fuera de rango esperado: ${areaHa}`)
})

test('evaluateGeometry devuelve areaHa null para un Point', () => {
  const { areaHa } = evaluateGeometry({ type: 'Point', coordinates: [-77.5, -6.5] })
  assert.equal(areaHa, null)
})

test('evaluateGeometry devuelve areaHa/selfIntersects por defecto con geometría nula', () => {
  assert.deepEqual(evaluateGeometry(null), { areaHa: null, selfIntersects: false })
})

// ---------------------------------------------------------------
// evaluateGeometry — auto-intersección (kinks)
// ---------------------------------------------------------------

test('evaluateGeometry no marca selfIntersects en un polígono simple válido', () => {
  const { selfIntersects } = evaluateGeometry(SQUARE_1KM)
  assert.equal(selfIntersects, false)
})

test('evaluateGeometry marca selfIntersects=true en un polígono con forma de "corbata" (bowtie)', () => {
  // Clásico caso de auto-intersección: 2 triángulos que se cruzan en el centro.
  const bowtie = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
        [0, 0],
      ],
    ],
  }
  const { selfIntersects } = evaluateGeometry(bowtie)
  assert.equal(selfIntersects, true)
})

test('evaluateGeometry no calcula selfIntersects (queda false) para un Point', () => {
  const { selfIntersects } = evaluateGeometry({ type: 'Point', coordinates: [-77.5, -6.5] })
  assert.equal(selfIntersects, false)
})

// ---------------------------------------------------------------
// isGeometryAllowedForTable
// ---------------------------------------------------------------

test('isGeometryAllowedForTable acepta Polygon para PADRON_PARCELAS/EUDR_USO_SUELO, rechaza Point', () => {
  const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
  const point = { type: 'Point', coordinates: [0, 0] }
  assert.equal(isGeometryAllowedForTable(polygon, 'PADRON_PARCELAS'), true)
  assert.equal(isGeometryAllowedForTable(point, 'PADRON_PARCELAS'), false)
  assert.equal(isGeometryAllowedForTable(polygon, 'EUDR_USO_SUELO'), true)
  assert.equal(isGeometryAllowedForTable(point, 'EUDR_USO_SUELO'), false)
})

test('isGeometryAllowedForTable acepta solo Point para EUDR_INSTALACIONES', () => {
  const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
  const point = { type: 'Point', coordinates: [0, 0] }
  assert.equal(isGeometryAllowedForTable(point, 'EUDR_INSTALACIONES'), true)
  assert.equal(isGeometryAllowedForTable(polygon, 'EUDR_INSTALACIONES'), false)
})

test('isGeometryAllowedForTable acepta Polygon y Point para EUDR_MONITOREO', () => {
  const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
  const point = { type: 'Point', coordinates: [0, 0] }
  assert.equal(isGeometryAllowedForTable(polygon, 'EUDR_MONITOREO'), true)
  assert.equal(isGeometryAllowedForTable(point, 'EUDR_MONITOREO'), true)
})

test('isGeometryAllowedForTable devuelve false para una tabla destino desconocida', () => {
  assert.equal(isGeometryAllowedForTable({ type: 'Point', coordinates: [0, 0] }, 'TABLA_INEXISTENTE'), false)
})

test('TARGET_TABLE_GEOMETRY_TYPES cubre las 4 tablas destino reales', () => {
  assert.deepEqual(Object.keys(TARGET_TABLE_GEOMETRY_TYPES).sort(), [
    'EUDR_INSTALACIONES',
    'EUDR_MONITOREO',
    'EUDR_USO_SUELO',
    'PADRON_PARCELAS',
  ])
})
