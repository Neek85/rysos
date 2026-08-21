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

test('evaluateGeometry devuelve el default completo con geometría nula (área/perímetro/self-intersect/umbral, Fase 2)', () => {
  assert.deepEqual(evaluateGeometry(null), {
    areaHa: null,
    perimetroM: null,
    selfIntersects: false,
    polygonBelowThreshold: false,
  })
})

// ---------------------------------------------------------------
// evaluateGeometry — perímetro (Fase 2, panel de información en vivo)
// ---------------------------------------------------------------

test('evaluateGeometry calcula perímetro en metros para un Polygon (4 lados de ~1km)', () => {
  const { perimetroM } = evaluateGeometry(SQUARE_1KM)
  assert.ok(perimetroM > 3600 && perimetroM < 4400, `perímetro fuera de rango esperado: ${perimetroM}`)
})

test('evaluateGeometry devuelve perimetroM null para un Point', () => {
  const { perimetroM } = evaluateGeometry({ type: 'Point', coordinates: [-77.5, -6.5] })
  assert.equal(perimetroM, null)
})

// ---------------------------------------------------------------
// evaluateGeometry — polygonBelowThreshold (badge "Requiere Polygon",
// Fase 2 — MIN_POLYGON_HECTARES = 4.0, lib/eudrDdsExporter.js)
// ---------------------------------------------------------------

test('evaluateGeometry marca polygonBelowThreshold=true para un Polygon con área < 4.0 ha', () => {
  // ~100 ha por construcción (SQUARE_1KM) NO aplica acá — este caso usa un
  // cuadrado más chico, muy por debajo del umbral.
  const smallSquare = {
    type: 'Polygon',
    coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
  }
  const { areaHa, polygonBelowThreshold } = evaluateGeometry(smallSquare)
  assert.ok(areaHa < 4.0, `área debería ser < 4.0 ha para este caso de prueba: ${areaHa}`)
  assert.equal(polygonBelowThreshold, true)
})

test('evaluateGeometry marca polygonBelowThreshold=false para un Polygon con área >= 4.0 ha', () => {
  const { areaHa, polygonBelowThreshold } = evaluateGeometry(SQUARE_1KM)
  assert.ok(areaHa >= 4.0, `área debería ser >= 4.0 ha para este caso de prueba: ${areaHa}`)
  assert.equal(polygonBelowThreshold, false)
})

test('evaluateGeometry nunca marca polygonBelowThreshold para un Point (no hay área medible que comparar)', () => {
  const { polygonBelowThreshold } = evaluateGeometry({ type: 'Point', coordinates: [-77.5, -6.5] })
  assert.equal(polygonBelowThreshold, false)
})

// ---------------------------------------------------------------
// polygonBelowThreshold — margen de seguridad (CLIENT_AREA_SAFETY_MARGIN_HA
// = 0.03 ha, ver docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md,
// "Divergencia turf/PostGIS cuantificada"). turf SIEMPRE sobreestima el
// área respecto a fn_calcular_area_ha real (medido en vivo, ~0.017-0.018
// ha en polígonos cerca de 4.0 ha, en 3 formas distintas) — sin el
// margen, un polígono cuya área real (server) ya está por debajo de 4.0
// ha podría aparecer en el cliente como >= 4.0 ha y el badge no se
// mostraría pese a que el server sí lo consideraría por debajo del
// umbral.
// ---------------------------------------------------------------

test('evaluateGeometry marca polygonBelowThreshold=true para un área apenas por encima de 4.0 ha (dentro del margen de seguridad)', () => {
  const justAbove = { type: 'Polygon', coordinates: [[[0, 0], [0.0018, 0], [0.0018, 0.0018], [0, 0.0018], [0, 0]]] }
  const { areaHa, polygonBelowThreshold } = evaluateGeometry(justAbove)
  assert.ok(areaHa >= 4.0 && areaHa < 4.03, `área debería caer dentro del margen (4.0-4.03 ha): ${areaHa}`)
  assert.equal(polygonBelowThreshold, true, 'el margen de seguridad debería seguir mostrando el aviso acá')
})

test('evaluateGeometry marca polygonBelowThreshold=false para un área claramente por encima del margen de seguridad', () => {
  const clearlyAbove = { type: 'Polygon', coordinates: [[[0, 0], [0.00181, 0], [0.00181, 0.00181], [0, 0.00181], [0, 0]]] }
  const { areaHa, polygonBelowThreshold } = evaluateGeometry(clearlyAbove)
  assert.ok(areaHa >= 4.03, `área debería estar claramente fuera del margen de seguridad: ${areaHa}`)
  assert.equal(polygonBelowThreshold, false)
})

// ---------------------------------------------------------------
// evaluateGeometry — LineString en construcción (Fase 2, hallazgo real:
// mientras se dibuja un polígono, geoman lo serializa como LineString
// hasta cerrar el anillo — confirmado en vivo con un log temporal, 3
// vértices reales seguían dando geometry.type "LineString". Sin la
// conversión a "polígono de previsualización", el panel de información
// en vivo habría mostrado siempre null mientras se dibuja.)
// ---------------------------------------------------------------

test('evaluateGeometry calcula área/perímetro para un LineString abierto con >= 3 puntos (polígono aún sin cerrar, mientras se dibuja)', () => {
  // Mismo cuadrado que SQUARE_1KM pero sin el punto de cierre repetido —
  // así es como geoman serializa el polígono ANTES de terminar de dibujar.
  const openRing = {
    type: 'LineString',
    coordinates: [[0, 0], [0.009, 0], [0.009, 0.009], [0, 0.009]],
  }
  const { areaHa, perimetroM } = evaluateGeometry(openRing)
  assert.ok(areaHa > 90 && areaHa < 110, `área fuera de rango esperado: ${areaHa}`)
  assert.ok(perimetroM > 0, `perímetro debería ser positivo: ${perimetroM}`)
})

test('evaluateGeometry NO calcula área para un LineString con menos de 3 puntos (todavía no hay forma de polígono)', () => {
  const { areaHa, perimetroM } = evaluateGeometry({ type: 'LineString', coordinates: [[0, 0], [1, 0]] })
  assert.equal(areaHa, null)
  assert.equal(perimetroM, null)
})

test('evaluateGeometry no duplica el punto de cierre si el LineString en construcción ya llegó cerrado', () => {
  const closedRing = {
    type: 'LineString',
    coordinates: [[0, 0], [0.009, 0], [0.009, 0.009], [0, 0.009], [0, 0]],
  }
  const { areaHa } = evaluateGeometry(closedRing)
  assert.ok(areaHa > 90 && areaHa < 110, `área fuera de rango esperado: ${areaHa}`)
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
