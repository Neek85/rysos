// Pruebas de la vinculación explícita capa Leaflet/Geoman en la edición de
// vértices de la Consola QC (/dashboard/qc) — ver
// specs/qc_geoman_layer_binding_fix.md.
//
// Tercer prompt consecutivo sobre este mismo mecanismo. La investigación
// de esta tarea (documentada en el spec) rastreó el bundle instalado de
// @geoman-io/leaflet-geoman-free y confirmó que NO había un bug de
// delegación FeatureGroup→CircleMarker — el cambio de código de esta tarea
// es hacer explícito lo que antes era implícito (llamar .pm.enable()/
// .disable() directamente sobre el sublayer real, con opciones de
// arrastre/snap explícitas), no una corrección de un defecto funcional.
// Mismo criterio de inspección de código fuente que el resto de esta serie
// (no hay Jest/Testing Library en el proyecto).
//
// Ejecutar con: node --test tests/test_qc_layer_editing_binding.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('el efecto de editingKey obtiene el sublayer real (childLayer) antes de tocar .pm', () => {
  const effect = getEditingKeyEffect(read('components/gis/QcConsoleMap.jsx'))
  assert.match(effect, /const childLayer = layer\.getLayers\?\.\(\)\[0\]/)
})

test('enable()/disable() se llaman directamente sobre childLayer.pm, no sobre el FeatureGroup wrapper', () => {
  const effect = getEditingKeyEffect(read('components/gis/QcConsoleMap.jsx'))
  assert.match(effect, /childLayer\.pm\.enable\(/)
  assert.match(effect, /childLayer\.pm\.disable\(\)/)
  assert.ok(!/layer\.pm\?\.enable\(/.test(effect), 'no debería llamar enable() sobre el FeatureGroup')
  assert.ok(!/layer\.pm\?\.disable\(\)/.test(effect), 'no debería llamar disable() sobre el FeatureGroup')
})

test('enable() pasa opciones de arrastre/snap explícitas en vez de depender solo de los defaults heredados por prototipo', () => {
  const effect = getEditingKeyEffect(read('components/gis/QcConsoleMap.jsx'))
  const enableCall = effect.match(/childLayer\.pm\.enable\(\{[^}]*\}\)/)
  assert.ok(enableCall, 'la llamada a enable() debería incluir un objeto de opciones')
  assert.match(enableCall[0], /draggable:\s*true/)
  assert.match(enableCall[0], /snappable:\s*true/)
  assert.match(enableCall[0], /allowSelfIntersection:\s*false/)
})

test('el chequeo de isEditing usa childLayer.pm.enabled(), no layer.pm.enabled()', () => {
  const effect = getEditingKeyEffect(read('components/gis/QcConsoleMap.jsx'))
  assert.match(effect, /childLayer\.pm\.enabled\?\.\(\)/)
})

test('los listeners pm:edit/pm:markerdragend siguen registrados sobre childLayer (los dispara el sublayer, nunca el FeatureGroup)', () => {
  const effect = getEditingKeyEffect(read('components/gis/QcConsoleMap.jsx'))
  assert.match(effect, /childLayer\.on\('pm:edit', report\)/)
  assert.match(effect, /childLayer\.on\('pm:markerdragend', report\)/)
})

test('guard contra childLayer inexistente (registros sin geometría parseable, o FeatureGroup vacío)', () => {
  const effect = getEditingKeyEffect(read('components/gis/QcConsoleMap.jsx'))
  assert.match(effect, /if \(!childLayer\?\.pm\) return/)
})

test('Mapa WebGIS (MapDashboard.jsx) sigue sin geoman — invariante de solo lectura sin cambios por esta tarea', () => {
  const source = read('components/gis/MapDashboard.jsx')
  assert.ok(!/@geoman-io\/leaflet-geoman-free/.test(source))
})

test('geoman está instalado y su módulo de edición dedicado para CircleMarker existe en el bundle (evidencia de la investigación, no solo una premisa asumida)', () => {
  const bundlePath = path.join(
    ROOT,
    'node_modules/@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.js'
  )
  const bundle = readFileSync(bundlePath, 'utf8')
  assert.match(bundle, /layer instanceof L\.CircleMarker\)\s*\{\s*\n?\s*layer\.pm = new L\.PM\.Edit\.CircleMarker\(layer\)/)
})
