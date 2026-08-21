// Re-investigación del bug "editor de puntos abre modo polígono" bajo la
// hipótesis de colisión entre el toolbar de "Editor Vectorial" (crear
// registro nuevo) y el modo "Ajustar Geometría" (editar registro
// existente) — ver docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md,
// sección de re-investigación (2026-08-21).
//
// CONFIRMADO en vivo (javascript_tool, click real sobre el botón "Dibujar
// Polígono" mientras un registro Point estaba en "Editando…"): el toolbar
// de dibujo se activaba igual, con el marcador del registro seleccionado
// TODAVÍA arrastrable — ambos mecanismos simultáneos, exactamente lo que
// mostraban las 2 capturas del reporte. Esta vez SÍ era el bug real.
//
// De paso se encontró y corrigió una regresión real y no relacionada
// introducida en la tarea anterior (ADR-005 original): `L.LayerGroup` no
// tiene `.bringToFront()` (solo `L.FeatureGroup`/`L.Path`) — esa llamada
// tiraba dentro del try/catch silencioso de `init()`, dejando `mapReady`
// en `false` para siempre y con eso tumbando TODO el toolbar del Editor
// Vectorial. Confirmado con un catch de debug temporal
// (`console.error`) antes de arreglarlo.
//
// Mismo criterio de inspección de código fuente que el resto de esta
// serie (no hay Jest/Testing Library).
//
// Ejecutar con: node --test tests/test_qc_toolbar_edit_mutual_exclusion.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('QcConsoleMap.jsx ya no llama LayerGroup.bringToFront() (no existe, causaba la regresión que tumbaba mapReady)', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.ok(!/\.bringToFront\(\)/.test(source), 'no debería quedar ninguna llamada real a bringToFront()')
})

test('QcConsoleMap.jsx agrega comparisonGroupRef ANTES que layerGroupRef (orden de capas sin bringToFront)', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  const comparisonIdx = source.indexOf('comparisonGroupRef.current = L.layerGroup().addTo(map)')
  const mainIdx = source.indexOf('layerGroupRef.current = L.layerGroup().addTo(map)')
  assert.ok(comparisonIdx > -1 && mainIdx > -1, 'ambas asignaciones deberían existir')
  assert.ok(comparisonIdx < mainIdx, 'comparisonGroupRef debe agregarse antes para quedar visualmente debajo')
})

test('QcConsoleMap.jsx deshabilita drawPolygon/drawMarker del toolbar mientras editingKey esté activo', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /map\.pm\.Toolbar\.setButtonDisabled\('drawPolygon', isAnyEditing\)/)
  assert.match(source, /map\.pm\.Toolbar\.setButtonDisabled\('drawMarker', isAnyEditing\)/)
  assert.match(source, /const isAnyEditing = !!editingKey/)
})

test('QcConsoleMap.jsx reporta hacia arriba (onDrawSessionActiveChange) cuando hay un dibujo en curso', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /onDrawSessionActiveChange\?\.\(isDrawing\)/)
  assert.match(source, /Boolean\(vectorEditor\.draft \|\| vectorEditor\.drawnLayer\)/)
})

test('page.jsx conecta onDrawSessionActiveChange a QcConsoleMap y geometryEditDisabled a QcDetailEditor', () => {
  const source = read('app/dashboard/qc/page.jsx')
  assert.match(source, /onDrawSessionActiveChange=\{setIsDrawSessionActive\}/)
  assert.match(source, /geometryEditDisabled=\{isDrawSessionActive && editingGeometryKey !== selectedRecord\.key\}/)
})

test('QcDetailEditor.jsx deshabilita el botón "Ajustar Geometría" cuando geometryEditDisabled es true', () => {
  const source = read('app/dashboard/qc/components/QcDetailEditor.jsx')
  const buttonBlock = source.match(/<button\s+type="button"\s+onClick=\{onToggleGeometryEdit\}[\s\S]*?<\/button>/)
  assert.ok(buttonBlock, 'el botón de Ajustar Geometría debería existir')
  assert.match(buttonBlock[0], /disabled=\{geometryEditDisabled\}/)
})
