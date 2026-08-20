// Pruebas de la edición de geometría de un solo registro en la Consola QC
// (/dashboard/qc) — ver specs/qc_single_record_geometry_editing.md.
//
// La mayor parte de este mecanismo ya existía (editingKey/layer.pm.enable/
// layer.pm.disable/pm:edit/pm:markerdragend, construido en la Consola QC
// 2.0 — ver specs/gis_qc_console_v2.md) y ya tiene cobertura parcial en
// tests/test_ui_reorganization.mjs. Estas pruebas certifican lo NUEVO de
// esta tarea (re-validación automática tras guardar) y la corrección de
// una premisa falsa del prompt (`pm:vertexfadd`, un evento que no existe
// en geoman) — mismo criterio de inspección de código fuente que el resto
// de esta serie (no hay Jest/Testing Library en el proyecto).
//
// Ejecutar con: node --test tests/test_qc_geometry_editing.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('page.jsx dispara la re-validación automática (handleValidateTopology) al guardar geometría exitosamente', () => {
  const source = read('app/dashboard/qc/page.jsx')
  const fnMatch = source.match(/async function handleSaveGeometry\([\s\S]*?\n  \}/)
  assert.ok(fnMatch, 'handleSaveGeometry debería existir')
  assert.match(fnMatch[0], /handleValidateTopology\(selectedRecord\)/)
})

test('page.jsx NO dispara la re-validación para EUDR_INSTALACIONES (el endpoint la rechaza igual, siempre puntual)', () => {
  const source = read('app/dashboard/qc/page.jsx')
  const fnMatch = source.match(/async function handleSaveGeometry\([\s\S]*?\n  \}/)
  assert.match(fnMatch[0], /tabla_origen !== 'EUDR_INSTALACIONES'/)
})

test('ningún archivo del módulo QC usa "pm:vertexfadd" (no existe en geoman — ni en node_modules ni en el código propio, el prompt lo confundió con pm:vertexadded, que es de dibujo, no de edición)', () => {
  const files = [
    'components/gis/QcConsoleMap.jsx',
    'app/dashboard/qc/components/QcDetailEditor.jsx',
    'app/dashboard/qc/page.jsx',
    'app/dashboard/qc/components/VectorEditorTools.jsx',
  ]
  files.forEach((file) => {
    assert.ok(!/pm:vertexfadd/.test(read(file)), `${file} no debería referenciar pm:vertexfadd`)
  })
})

test('QcConsoleMap.jsx sigue escuchando pm:edit y pm:markerdragend en la capa seleccionada (mecanismo ya existente, sin romper)', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /childLayer\.on\('pm:edit'/)
  assert.match(source, /childLayer\.on\('pm:markerdragend'/)
})

test('QcConsoleMap.jsx deshabilita layer.pm en cualquier capa que no sea editingKey (aislamiento por registro, nunca edición masiva)', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /layer\.pm\?\.disable\(\)/)
})

test('lib/eudrQcActions.js::updateRecordGeometry valida la organización antes de escribir (aislamiento multi-tenant)', () => {
  const source = read('lib/eudrQcActions.js')
  const fnMatch = source.match(/export async function updateRecordGeometry\([\s\S]*?\n\}/)
  assert.ok(fnMatch, 'updateRecordGeometry debería existir')
  assert.match(fnMatch[0], /assertSameOrganization/)
})

test('QcDetailEditor.jsx renombra el botón a "Guardar Cambios de Geometría" (alineado con el prompt)', () => {
  const source = read('app/dashboard/qc/components/QcDetailEditor.jsx')
  assert.match(source, /Guardar Cambios de Geometría/)
})

test('MapDashboard.jsx sigue sin geoman (Mapa WebGIS 100% solo lectura, sin regresión)', () => {
  const source = read('components/gis/MapDashboard.jsx')
  assert.ok(!/@geoman-io\/leaflet-geoman-free/.test(source))
})

test('ningún archivo tocado en esta tarea tiene console.log', () => {
  const files = [
    'app/dashboard/qc/page.jsx',
    'app/dashboard/qc/components/QcDetailEditor.jsx',
    'components/gis/QcConsoleMap.jsx',
  ]
  files.forEach((file) => {
    assert.ok(!/console\.log/.test(read(file)), `${file} no debería tener console.log`)
  })
})
