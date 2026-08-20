// Pruebas de la activación de vértices editables (Geoman) en la Consola QC
// — cuarto prompt consecutivo sobre este mismo mecanismo, ver
// specs/qc_geoman_vertex_handles_fix.md. De las 4 piezas pedidas, 3 ya
// existían desde la tarea anterior (specs/qc_geoman_layer_binding_fix.md);
// la única pieza nueva es el listener `pm:dragend`. Mismo criterio de
// inspección de código fuente que el resto de esta serie (no hay Jest/
// Testing Library en el proyecto).
//
// Ejecutar con: node --test tests/test_qc_vertex_handles_fix.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

function getEditingKeyEffect(source) {
  const match = source.match(
    /\/\/ Modo edición de vértices[\s\S]*?\}, \[editingKey, records\]\)/
  )
  assert.ok(match, 'el efecto de editingKey debería existir')
  return match[0]
}

test('el archivo real del mapa de QC es components/gis/QcConsoleMap.jsx, NO app/dashboard/qc/components/QcConsoleMap.jsx (premisa falsa del prompt)', () => {
  assert.ok(existsSync(path.join(ROOT, 'components/gis/QcConsoleMap.jsx')))
  assert.ok(!existsSync(path.join(ROOT, 'app/dashboard/qc/components/QcConsoleMap.jsx')))
})

test('page.jsx importa QcConsoleMap desde components/gis, no desde app/dashboard/qc/components', () => {
  const source = read('app/dashboard/qc/page.jsx')
  assert.match(source, /@\/components\/gis\/QcConsoleMap/)
})

test('el efecto de editingKey escucha pm:dragend (nuevo en esta tarea) además de pm:edit/pm:markerdragend', () => {
  const effect = getEditingKeyEffect(read('components/gis/QcConsoleMap.jsx'))
  assert.match(effect, /childLayer\.on\('pm:edit', report\)/)
  assert.match(effect, /childLayer\.on\('pm:markerdragend', report\)/)
  assert.match(effect, /childLayer\.on\('pm:dragend', report\)/)
})

test('enable()/disable() se siguen llamando directamente sobre childLayer.pm, no sobre el FeatureGroup (mecanismo ya existente, sin regresión)', () => {
  const effect = getEditingKeyEffect(read('components/gis/QcConsoleMap.jsx'))
  assert.match(effect, /childLayer\.pm\.enable\(\{[^}]*draggable:\s*true[^}]*\}\)/)
  assert.match(effect, /childLayer\.pm\.disable\(\)/)
})

test('el efecto sigue obteniendo la sub-capa real vía layer.getLayers() antes de tocar .pm', () => {
  const effect = getEditingKeyEffect(read('components/gis/QcConsoleMap.jsx'))
  assert.match(effect, /const childLayer = layer\.getLayers\?\.\(\)\[0\]/)
})

test('Mapa WebGIS (MapDashboard.jsx) sigue sin geoman — invariante de solo lectura sin cambios por esta tarea', () => {
  const source = read('components/gis/MapDashboard.jsx')
  assert.ok(!/@geoman-io\/leaflet-geoman-free/.test(source))
})
