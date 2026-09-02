// Pruebas del fix de escritura RLS de la Consola QC (Aprobar/Rechazar/
// Guardar Atributos/Guardar Geometría) + reordenamiento de layout — ver
// specs/consola_qc_layout_y_validacion.md (sección "Hallazgo adicional no
// solicitado") y docs/adr/ADR-003-consola-qc-server-actions-escritura.md.
//
// Hallazgo real: las 4 escrituras se invocaban con getSupabaseClient()
// (anon key, sin sesión) pero las políticas RLS de escritura en
// EUDR_MONITOREO/EUDR_USO_SUELO/EUDR_INSTALACIONES son solo `TO
// authenticated` — todo UPDATE afectaba 0 filas siempre. Fix: Server
// Actions + Service Role Key (mismo patrón que lib/actions/sociosActions.js
// y lib/actions/gisActions.js). Mismo criterio de inspección de código
// fuente que el resto de esta serie (no hay Jest/Testing Library).
//
// Ejecutar con: node --test tests/test_qc_server_actions_write_fix.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('lib/actions/qcActions.js existe, es un módulo Server Actions, y usa la Service Role Key', () => {
  const source = read('lib/actions/qcActions.js')
  assert.match(source, /^'use server'/)
  assert.match(source, /getSupabaseServerClient/)
  assert.ok(!/from '@\/lib\/supabaseClient'/.test(source), 'no debería importar el cliente anon')
})

test('qcActions.js expone las 4 Server Actions esperadas, cada una envolviendo la función pura correspondiente', () => {
  const source = read('lib/actions/qcActions.js')
  for (const [action, wrapped] of [
    ['approveQcRecord', 'approveRecord'],
    ['rejectQcRecord', 'rejectRecord'],
    ['updateQcRecordAttributes', 'updateRecordAttributes'],
    ['updateQcRecordGeometry', 'updateRecordGeometry'],
  ]) {
    assert.match(source, new RegExp(`export async function ${action}\\(`))
    assert.match(source, new RegExp(`${wrapped}\\(`))
  }
})

test('las funciones puras de lib/eudrQcActions.js siguen exportadas sin cambios de firma (qcActions.js las reutiliza)', () => {
  const source = read('lib/eudrQcActions.js')
  assert.match(source, /export async function approveRecord\(supabase, record, organizationId\)/)
  assert.match(source, /export async function rejectRecord\(supabase, record, motivo, organizationId\)/)
  assert.match(source, /export async function updateRecordAttributes\(supabase, record, attributes, organizationId\)/)
  assert.match(source, /export async function updateRecordGeometry\(supabase, record, geometry, organizationId\)/)
})

test('page.jsx importa las 4 acciones de escritura desde lib/actions/qcActions, no directo de lib/eudrQcActions', () => {
  const source = read('app/dashboard/qc/page.jsx')
  assert.match(source, /from '@\/lib\/actions\/qcActions'/)
  const eudrQcImportBlock = source.match(/import \{[\s\S]*?\} from '@\/lib\/eudrQcActions'/)
  assert.ok(eudrQcImportBlock, 'debería seguir importando fetchPendingRecords/resolveOrganizationId/etc. de eudrQcActions')
  assert.ok(!/approveRecord|rejectRecord|updateRecordAttributes|updateRecordGeometry/.test(eudrQcImportBlock[0]),
    'las 4 funciones de escritura no deberían importarse directo de eudrQcActions en page.jsx')
})

test('handleDecision/handleSaveAttributes/handleSaveGeometry ya no llaman getSupabaseClient() (solo loadPending, que es lectura)', () => {
  const source = read('app/dashboard/qc/page.jsx')
  for (const fn of ['handleDecision', 'handleSaveAttributes', 'handleSaveGeometry']) {
    const match = source.match(new RegExp(`async function ${fn}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`))
    assert.ok(match, `${fn} debería existir`)
    assert.ok(!/getSupabaseClient\(\)/.test(match[0]), `${fn} no debería llamar getSupabaseClient()`)
  }
})

test('layout: la grilla principal es de 12 columnas con 3 secciones (lista 3 | mapa 6 | panel 3)', () => {
  const source = read('app/dashboard/qc/page.jsx')
  assert.match(source, /grid-cols-1 gap-4 lg:grid-cols-12/)
  assert.match(source, /lg:col-span-3/)
  assert.match(source, /lg:col-span-6/)
})

test('layout: el panel de edición es sticky con scroll interno propio, ya no está anidado dentro de la columna del mapa', () => {
  const source = read('app/dashboard/qc/page.jsx')
  const panelSection = source.match(/<section className="lg:col-span-3 lg:sticky[\s\S]*?<\/section>/)
  assert.ok(panelSection, 'la sección del panel de edición debería existir con sticky+overflow')
  assert.match(panelSection[0], /overflow-y-auto/)
  assert.match(panelSection[0], /QcDetailEditor/)

  const mapSection = source.match(/<section className="lg:col-span-6">[\s\S]*?<\/section>/)
  assert.ok(mapSection, 'la sección del mapa debería existir')
  assert.ok(!/QcDetailEditor/.test(mapSection[0]), 'QcDetailEditor ya no debería estar dentro de la columna del mapa')
})

test('QcConsoleMap.jsx ya no usa una altura fija de 600px — ocupa el alto disponible de la pantalla', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.ok(!/height: '600px'/.test(source), 'no debería quedar el alto fijo de 600px')
  assert.match(source, /h-\[70vh\]|h-\[calc\(100vh/)
})

