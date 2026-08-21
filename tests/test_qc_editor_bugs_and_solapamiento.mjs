// Pruebas de la corrección de 2 bugs reales en el Editor Vectorial de la
// Consola QC + investigación/mejora de la auditabilidad del solapamiento
// — ver docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md.
//
// Bug 1 (popup con nombre crudo de tabla): CONFIRMADO real, verificado en
// vivo en el navegador ("EUDR_INSTALACIONES" mostrado literalmente en un
// popup) antes de tocar código — corregido eliminando bindPopup()/
// openPopup().
//
// Bug 2 ("editor de puntos abre modo polígono"): investigado a fondo
// (lectura del código + verificación en vivo con javascript_tool
// inspeccionando el DOM real) y NO se reprodujo — al editar un registro
// Point, geoman solo agrega la clase leaflet-pm-draggable al marcador,
// cero marcadores de vértice en el DOM. La mejora real hecha acá es de
// claridad de UI (texto de ayuda distinto según el tipo de geometría
// REAL del registro, nunca inferido por tabla_origen — pedido explícito
// del prompt aunque no había un bug funcional detrás).
//
// Mismo criterio de inspección de código fuente que el resto de esta
// serie (no hay Jest/Testing Library en el proyecto).
//
// Ejecutar con: node --test tests/test_qc_editor_bugs_and_solapamiento.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('QcConsoleMap.jsx ya no llama bindPopup()/openPopup() con el nombre crudo de tabla_origen', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.ok(!/layer\.bindPopup\(/.test(source), 'no debería quedar ninguna llamada real a bindPopup()')
  assert.ok(!/\.openPopup\?\.\(\)/.test(source), 'no debería quedar ninguna llamada real a openPopup()')
})

test('QcDetailEditor.jsx deriva isPointRecord de la geometría real (record.geom), nunca de tabla_origen', () => {
  const source = read('app/dashboard/qc/components/QcDetailEditor.jsx')
  assert.match(source, /isPointRecord = recordGeometry\?\.type === 'Point'/)
  const helpTextBlock = source.match(/\{isEditingGeometry && \([\s\S]*?\)\}/)
  assert.ok(helpTextBlock, 'el bloque de texto de ayuda debería existir')
  assert.match(helpTextBlock[0], /isPointRecord/)
  assert.ok(!/tabla_origen === 'EUDR_INSTALACIONES'/.test(helpTextBlock[0]),
    'el texto de ayuda no debería inferir el tipo por tabla_origen')
})

test('QcConsoleMap.jsx acepta y renderiza comparisonFeatures como capa secundaria punteada', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /comparisonFeatures/)
  assert.match(source, /comparisonGroupRef/)
  assert.match(source, /dashArray: '6, 6'/)
})

test('QcConsoleMap.jsx limpia (clearLayers) la capa de comparación en cada cambio de comparisonFeatures', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  const effect = source.match(/useEffect\(\(\) => \{\s*const L = leafletRef\.current\s*const group = comparisonGroupRef[\s\S]*?\}, \[comparisonFeatures\]\)/)
  assert.ok(effect, 'el efecto de comparisonFeatures debería existir')
  assert.match(effect[0], /group\.clearLayers\(\)/)
})

test('page.jsx limpia comparisonFeatures al cambiar de registro seleccionado', () => {
  const source = read('app/dashboard/qc/page.jsx')
  const resetEffect = source.match(/useEffect\(\(\) => \{\s*setEditingGeometryKey\(null\)[\s\S]*?\}, \[selectedKey\]\)/)
  assert.ok(resetEffect, 'el efecto de reset por selectedKey debería existir')
  assert.match(resetEffect[0], /setComparisonFeatures\(\[\]\)/)
})

test('page.jsx solo calcula la capa de comparación para el registro actualmente seleccionado (nunca durante "Validar Todos" en batch)', () => {
  const source = read('app/dashboard/qc/page.jsx')
  const fn = source.match(/async function handleValidateTopology\([\s\S]*?\n  \}/)
  assert.ok(fn, 'handleValidateTopology debería existir')
  assert.match(fn[0], /record\.key === selectedKey/)
  assert.match(fn[0], /fetchComparisonGeometries/)
})

test('page.jsx pasa comparisonFeatures a QcConsoleMap', () => {
  const source = read('app/dashboard/qc/page.jsx')
  const mapCall = source.match(/<QcConsoleMap[\s\S]*?\/>/)
  assert.ok(mapCall, 'el uso de QcConsoleMap debería existir')
  assert.match(mapCall[0], /comparisonFeatures=\{comparisonFeatures\}/)
})

test('fn_validar_topologia_eudr (migración instalada) ya filtra por ID_Organizacion, excluye el propio registro, y usa ::geography para el % de solapamiento', () => {
  const source = read('supabase/migrations/20260820_fn_validar_topologia_eudr.sql')
  assert.match(source, /WHERE "ID_Organizacion" = v_org/)
  assert.match(source, /NOT \(p_tabla_origen = 'EUDR_MONITOREO' AND id_monitoreo::text = p_registro_id\)/)
  assert.match(source, /NOT \(p_tabla_origen = 'EUDR_USO_SUELO' AND id::text = p_registro_id\)/)
  assert.match(source, /ST_Area\(ST_Intersection\(v_geom, geom\)::geography\)/)
})
