// Pruebas de la reorganización del Editor Vectorial (Geoman) —
// specs/ui_reorganization_geoman.md: Mapa WebGIS pasa a ser un visor de
// solo lectura, la Consola QC gana la capacidad completa de dibujar
// geometría nueva desde cero + editar vértices de un registro existente.
//
// No hay Jest/Testing Library en este proyecto (ver CLAUDE.md) — no se
// puede renderizar `<MapDashboard />`/`<QcConsoleMap />` de verdad ni
// hacer click en un botón inexistente y comprobar su ausencia en el DOM.
// En su lugar, estas pruebas certifican el hecho estructural real que le
// importa a esta tarea (¿el módulo de dibujo está importado/usado acá o
// no?) inspeccionando el código fuente directamente — un guard de
// regresión honesto: si alguien reintroduce el import de geoman en
// MapDashboard.jsx, o borra el wiring del editor en QcConsoleMap.jsx, esta
// suite lo detecta, aunque no sea una prueba de render pixel-perfect.
//
// Ejecutar con: node --test tests/test_ui_reorganization.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

// ---------------------------------------------------------------
// Mapa WebGIS — visor de solo lectura, sin Geoman
// ---------------------------------------------------------------

test('MapDashboard.jsx no importa geoman (ni el paquete ni su CSS)', () => {
  const source = read('components/gis/MapDashboard.jsx')
  assert.ok(!/@geoman-io\/leaflet-geoman-free/.test(source), 'no debería importar el paquete geoman')
})

test('MapDashboard.jsx no importa ni usa VectorEditorPanel/useVectorEditor', () => {
  const source = read('components/gis/MapDashboard.jsx')
  assert.ok(!/VectorEditorPanel/.test(source))
  assert.ok(!/useVectorEditor/.test(source))
})

test('app/dashboard/mapa/components/VectorEditorTools.jsx ya no existe (reubicado a la Consola QC)', () => {
  assert.equal(existsSync(path.join(ROOT, 'app/dashboard/mapa/components/VectorEditorTools.jsx')), false)
})

// ---------------------------------------------------------------
// Consola QC — Editor Vectorial completo (crear + editar)
// ---------------------------------------------------------------

test('app/dashboard/qc/components/VectorEditorTools.jsx existe (reubicado desde /dashboard/mapa)', () => {
  assert.equal(existsSync(path.join(ROOT, 'app/dashboard/qc/components/VectorEditorTools.jsx')), true)
})

test('QcConsoleMap.jsx importa y usa el Editor Vectorial (useVectorEditor + VectorEditorPanel)', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /useVectorEditor/)
  assert.match(source, /VectorEditorPanel/)
})

test('el Editor Vectorial de QC ofrece EUDR_MONITOREO/EUDR_USO_SUELO/EUDR_INSTALACIONES como destino (ADR-022), nunca PADRON_PARCELAS', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  // Array exacto de 3 elementos -- por construcción, PADRON_PARCELAS no
  // puede estar presente sin romper este match.
  assert.match(
    source,
    /QC_DRAWABLE_TABLES\s*=\s*\[\s*'EUDR_MONITOREO'\s*,\s*'EUDR_USO_SUELO'\s*,\s*'EUDR_INSTALACIONES'\s*\]/
  )
})

test('ADR-022: backend (lib/gisTargetTables.js) ya soportaba EUDR_INSTALACIONES sin cambios -- solo se tocó el array de QcConsoleMap.jsx', async () => {
  const { TARGET_TABLE_FIELDS, TARGET_TABLE_GEOMETRY_TYPES } = await import('../lib/gisTargetTables.js')
  assert.deepEqual(
    TARGET_TABLE_FIELDS.EUDR_INSTALACIONES.map((f) => f.key),
    ['id_parcela', 'tipo_infra']
  )
  assert.deepEqual(TARGET_TABLE_GEOMETRY_TYPES.EUDR_INSTALACIONES, ['Point'])
  // gisActions.js (server actions) tampoco se tocó -- la rama de escritura
  // de EUDR_INSTALACIONES ya validaba contra el padrón real desde antes
  // (ADR-019), confirmada en vivo en esta tarea contra ORG-TEST-E2E.
  const gisActionsSource = read('lib/actions/gisActions.js')
  assert.match(gisActionsSource, /assertParcelaActivaOSinValor\(supabase, fieldOverrides\.id_parcela, organizationId\)/)
})

test('QcConsoleMap.jsx deshabilita los controles globales de Editar/Arrastrar/Eliminar de geoman (evita chocar con editingKey)', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /enableGlobalEditControls:\s*false/)
})

test('QcConsoleMap.jsx conserva el mecanismo de edición de vértices del registro seleccionado (editingKey)', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /editingKey/)
  assert.match(source, /childLayer\.pm\.enable/)
})

test('app/dashboard/qc/page.jsx pasa organizationId y onFeatureCreated a QcConsoleMap (refresca la lista al crear una geometría nueva)', () => {
  const source = read('app/dashboard/qc/page.jsx')
  assert.match(source, /organizationId=\{resolveOrganizationId\(records\)\}/)
  assert.match(source, /onFeatureCreated=\{loadPending\}/)
})

// ---------------------------------------------------------------
// Cero PII en logs de consola (paso 4 del prompt) — mismo criterio ya
// verificado varias veces en esta serie de tareas.
// ---------------------------------------------------------------

test('ningún archivo tocado en esta reorganización tiene console.log', () => {
  const files = [
    'components/gis/MapDashboard.jsx',
    'components/gis/QcConsoleMap.jsx',
    'app/dashboard/qc/page.jsx',
    'app/dashboard/qc/components/VectorEditorTools.jsx',
  ]
  files.forEach((file) => {
    assert.ok(!/console\.log/.test(read(file)), `${file} no debería tener console.log`)
  })
})
