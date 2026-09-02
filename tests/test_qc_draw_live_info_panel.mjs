// Fase 2 (aprobada explícitamente tras Fase 1): panel de información en
// vivo mientras se dibuja geometría nueva en el Editor Vectorial — ver
// specs/consola_qc_layout_y_validacion.md (addendum panel de dibujo) y
// docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md.
//
// El cálculo puro (área/perímetro/self-intersect/umbral) ya está cubierto
// en tests/test_geo_area_utils.mjs y tests/test_gis_editor.mjs — acá se
// verifica que el panel JSX (VectorEditorPanel, no testeable con
// node --test sin jsdom) efectivamente muestra esos 4 datos con el
// redondeo correcto, no una versión distinta. Mismo criterio de
// inspección de código fuente que el resto de esta serie.
//
// Ejecutar con: node --test tests/test_qc_draw_live_info_panel.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('lib/geo/areaUtils.js existe y exporta calcularAreaHa/calcularPerimetroM/AREA_HA_DECIMALS', () => {
  const source = read('lib/geo/areaUtils.js')
  assert.match(source, /export function calcularAreaHa\(/)
  assert.match(source, /export function calcularPerimetroM\(/)
  assert.match(source, /export const AREA_HA_DECIMALS = 4/)
})

test('areaUtils.js documenta explícitamente que el redondeo debe coincidir con fn_calcular_area_ha (ROUND(...,4)), no fn_validar_topologia_eudr directamente', () => {
  const source = read('lib/geo/areaUtils.js')
  assert.match(source, /fn_calcular_area_ha/)
  assert.match(source, /ROUND\(\(ST_Area\(p_geom::geography\) \/ 10000\)::numeric, 4\)/)
  assert.match(source, /20260818_gis_core_sanitization\.sql/)
})

test('gisVectorEditor.js::evaluateGeometry usa calcularAreaHa/calcularPerimetroM de lib/geo/areaUtils.js (una sola fuente de verdad para el redondeo)', () => {
  const source = read('lib/gisVectorEditor.js')
  assert.match(source, /import \{ calcularAreaHa, calcularPerimetroM \} from '\.\/geo\/areaUtils\.js'/)
  assert.match(source, /const areaHa = calcularAreaHa\(previewGeometry\)/)
  assert.match(source, /const perimetroM = calcularPerimetroM\(previewGeometry\)/)
})

test('gisVectorEditor.js::evaluateGeometry reutiliza MIN_POLYGON_HECTARES de lib/eudrDdsExporter.js (no un 4.0 hardcodeado de nuevo)', () => {
  const source = read('lib/gisVectorEditor.js')
  assert.match(source, /import \{ MIN_POLYGON_HECTARES \} from '\.\/eudrDdsExporter\.js'/)
  assert.match(source, /< MIN_POLYGON_HECTARES/)
})

test('VectorEditorPanel muestra el área con 4 decimales (toFixed(4)), no 2', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  assert.match(source, /draft\.areaHa\.toFixed\(4\)/)
  assert.ok(!/draft\.areaHa\.toFixed\(2\)/.test(source), 'no debería quedar el redondeo viejo de 2 decimales')
})

test('VectorEditorPanel muestra el perímetro estimado', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  assert.match(source, /draft\.perimetroM/)
  assert.match(source, /Perímetro estimado/)
})

test('VectorEditorPanel muestra el aviso informativo (no bloqueante) de polygonBelowThreshold', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  assert.match(source, /draft\.polygonBelowThreshold/)
})

test('VectorEditorPanel muestra una nota informativa para Point (no hay forma de comprobar el umbral en vivo)', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  assert.match(source, /geometry\?\.type === 'Point'/)
  assert.match(source, /Un Point no tiene área medible/)
})

test('el auto-intersección en vivo (@turf/kinks) sigue funcionando, sin regresión de la Fase 1', () => {
  const source = read('lib/gisVectorEditor.js')
  assert.match(source, /import kinks from '@turf\/kinks'/)
  assert.match(source, /selfIntersects = kinks\(feature\)\.features\.length > 0/)
})

test('package.json declara @turf/length como dependencia explícita (usada para el perímetro)', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.ok(pkg.dependencies['@turf/length'], '@turf/length debería estar declarado en package.json')
})

// ---------------------------------------------------------------
// HALLAZGO REAL: pm:vertexadded nunca llegaba a `map` — confirmado en
// vivo con un log temporal (0 disparos pese a colocar vértices reales).
// geoman dispara ese evento sobre la capa "de trabajo" en construcción
// (propagate:false, nunca burbujea a `map`), a diferencia de
// pm:create/pm:remove que sí se disparan explícitamente sobre `map`. Sin
// este fix, el panel de información nunca se hubiera actualizado "en
// cada vértice" como pide la spec — solo al terminar de dibujar
// (pm:create). Ver docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md.
// ---------------------------------------------------------------

test('attachVectorEditor ya no escucha pm:vertexadded directo sobre map (nunca se disparaba ahí)', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  assert.ok(!/^\s*map\.on\('pm:vertexadded'/m.test(source), 'no debería quedar un listener roto sobre map')
})

test('attachVectorEditor escucha pm:drawstart sobre map y engancha pm:vertexadded sobre el workingLayer real', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  assert.match(source, /map\.on\('pm:drawstart', handleDrawStart\)/)
  const handlerBlock = source.match(/function handleDrawStart\(e\) \{[\s\S]*?\n  \}/)
  assert.ok(handlerBlock, 'handleDrawStart debería existir')
  assert.match(handlerBlock[0], /e\.workingLayer\?\.on\('pm:vertexadded'/)
})

test('el cleanup (detach) da de baja pm:drawstart, no un pm:vertexadded que nunca existió sobre map', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  const detachBlock = source.match(/return function detach\(\) \{[\s\S]*?\n  \}/)
  assert.ok(detachBlock, 'detach debería existir')
  assert.match(detachBlock[0], /map\.off\('pm:drawstart', handleDrawStart\)/)
  assert.ok(!/map\.off\('pm:vertexadded'/.test(detachBlock[0]))
})

test('gisVectorEditor.js convierte un LineString en construcción (>=3 puntos) a un Polygon de previsualización para poder calcular área/perímetro en vivo', () => {
  const source = read('lib/gisVectorEditor.js')
  assert.match(source, /function toPreviewPolygon\(geometry\)/)
  assert.match(source, /geometry\?\.type !== 'LineString'/)
  assert.match(source, /const previewGeometry = toPreviewPolygon\(geometry\)/)
})

// ---------------------------------------------------------------
// Margen de seguridad turf/PostGIS cuantificado a pedido explícito — ver
// docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md, "Divergencia
// turf/PostGIS cuantificada". Medido en vivo contra fn_calcular_area_ha
// real (RPC), no reimplementado a mano: ~0.017-0.018 ha de divergencia
// consistente (turf siempre sobreestima) en polígonos cerca de 4.0 ha,
// en 3 formas distintas (cuadrado, rectángulo 4:1, pentágono irregular),
// en coordenadas reales de operación (Jaén, Cajamarca).
// ---------------------------------------------------------------

test('gisVectorEditor.js declara CLIENT_AREA_SAFETY_MARGIN_HA y lo resta antes de comparar contra MIN_POLYGON_HECTARES', () => {
  const source = read('lib/gisVectorEditor.js')
  assert.match(source, /const CLIENT_AREA_SAFETY_MARGIN_HA = 0\.03/)
  assert.match(source, /areaHa - CLIENT_AREA_SAFETY_MARGIN_HA < MIN_POLYGON_HECTARES/)
})

test('docs/adr/ADR-005 documenta la divergencia medida (no solo la decisión, los números reales)', () => {
  const source = read('docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md')
  assert.match(source, /Divergencia turf\/PostGIS cuantificada/)
  assert.match(source, /0\.017/)
})
