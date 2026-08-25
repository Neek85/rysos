// Validación de organización de socio/parcela al Aprobar (ADR-020) — CAPA 2
// del gap encontrado en scripts/etl_drive_to_supabase.py (CAPA 1, ver
// tests/test_etl_drive.py::TestSocioOrgMismatchWarning). A diferencia del
// conflicto de código de parcela (ADR-014), este bloqueo SOLO frena
// "Aprobar" — decisión explícita, nunca hay que cerrar la salida de
// descartar un registro problemático con "Rechazar".
//
// Ejecutar con: node --test tests/test_qc_organizacion_socio_parcela.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

const QC_ACTIONS_PATH = 'lib/eudrQcActions.js'
const ROUTE_PATH = 'app/api/qc/validar-organizacion-socio-parcela/route.js'
const DETAIL_EDITOR_PATH = 'app/dashboard/qc/components/QcDetailEditor.jsx'

// ---------------------------------------------------------------
// lib/eudrQcActions.js — funciones reales (comportamiento cubierto en
// profundidad, con mock de Supabase, en tests/test_eudr_qc_actions.mjs;
// acá solo se confirma la forma/wiring del código fuente).
// ---------------------------------------------------------------

test('checkSocioParcelaOrganizacion está exportada (la usa tanto assertSocioParcelaMismaOrganizacion como el Route Handler)', () => {
  const source = read(QC_ACTIONS_PATH)
  assert.match(source, /export async function checkSocioParcelaOrganizacion\(supabase, record\)/)
})

test('assertSocioParcelaMismaOrganizacion se invoca SOLO en approveRecord, nunca en rejectRecord — decisión explícita ADR-020', () => {
  const source = read(QC_ACTIONS_PATH)
  const approveFn = source.match(/export async function approveRecord\([\s\S]*?\n\}/)
  const rejectFn = source.match(/export async function rejectRecord\([\s\S]*?\n\}/)
  assert.ok(approveFn, 'approveRecord debería existir')
  assert.ok(rejectFn, 'rejectRecord debería existir')
  assert.match(approveFn[0], /assertSocioParcelaMismaOrganizacion\(supabase, record\)/)
  assert.ok(
    !/assertSocioParcelaMismaOrganizacion/.test(rejectFn[0]),
    'rejectRecord no debería llamar assertSocioParcelaMismaOrganizacion — Rechazar siempre debe seguir disponible'
  )
  // Ambos SÍ siguen llamando assertSinConflictoDeParcela (ADR-014) —
  // confirma que esta tarea no tocó ese guard existente.
  assert.match(approveFn[0], /assertSinConflictoDeParcela\(supabase, record\)/)
  assert.match(rejectFn[0], /assertSinConflictoDeParcela\(supabase, record\)/)
})

test('el mensaje de error nunca expone un UUID crudo, y sí el código real de socio/parcela + la fecha cuando está disponible', () => {
  const source = read(QC_ACTIONS_PATH)
  const fnBlock = source.match(
    /export async function checkSocioParcelaOrganizacion[\s\S]*?(?=async function assertSocioParcelaMismaOrganizacion)/
  )
  assert.ok(fnBlock, 'checkSocioParcelaOrganizacion debería existir')
  assert.match(fnBlock[0], /fechaTexto/)
  assert.match(fnBlock[0], /No se puede aprobar\$\{fechaTexto\}/)
  assert.ok(!/registro_id|id_monitoreo\$\{/.test(fnBlock[0]), 'el mensaje no debería interpolar un id crudo')
})

// ---------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------

test('el Route Handler usa Service Role Key y reutiliza checkSocioParcelaOrganizacion (una sola fuente de verdad)', () => {
  const source = read(ROUTE_PATH)
  assert.match(source, /getSupabaseServerClient/)
  assert.match(source, /import \{ checkSocioParcelaOrganizacion \} from '@\/lib\/eudrQcActions'/)
  assert.ok(!/from '@\/lib\/supabaseClient'/.test(source), 'no debería importar el cliente anon')
})

test('el Route Handler exige ID_Organizacion en el body', () => {
  const source = read(ROUTE_PATH)
  assert.match(source, /if \(!ID_Organizacion\)/)
})

// ---------------------------------------------------------------
// QcDetailEditor.jsx — wiring del cliente
// ---------------------------------------------------------------

test('se busca automáticamente al seleccionar el registro (no detrás de un botón manual), para las 3 tablas EUDR_* (sin gate esMonitoreo, a diferencia del conflicto de código de parcela)', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const effect = source.match(
    /useEffect\(\(\) => \{\s*setOrgMismatchLoading\(true\)[\s\S]*?\}, \[record\.id_origen, record\.ID_Organizacion, record\.ID_Parcela_Fija, record\.tabla_origen, record\.id_monitoreo\]\)/
  )
  assert.ok(effect, 'el useEffect de auto-fetch de organización de socio/parcela debería existir')
  assert.match(effect[0], /fetch\('\/api\/qc\/validar-organizacion-socio-parcela'/)
  assert.ok(!/if \(!esMonitoreo\) return/.test(effect[0]), 'no debería estar limitado a EUDR_MONITOREO')
})

test('el botón Aprobar se deshabilita cuando orgMismatch.tieneConflicto es true', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const approveButton = source.match(/onClick=\{onApprove\}[\s\S]*?<\/button>/)
  assert.ok(approveButton, 'el botón Aprobar debería existir')
  assert.match(approveButton[0], /disabled=\{[^}]*orgMismatch\?\.tieneConflicto[^}]*\}/)
})

test('el botón Rechazar NUNCA se deshabilita por orgMismatch — decisión explícita ADR-020 (a diferencia del conflicto de código de parcela, que sí bloquea Rechazar)', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const rejectButton = source.match(/onClick=\{onReject\}[\s\S]*?<\/button>/)
  assert.ok(rejectButton, 'el botón Rechazar debería existir')
  const disabledAttr = rejectButton[0].match(/disabled=\{[^}]*\}/)
  assert.ok(disabledAttr, 'el botón Rechazar debería tener un atributo disabled')
  assert.ok(!disabledAttr[0].includes('orgMismatch'), 'Rechazar no debería depender de orgMismatch')
  // Sigue dependiendo de conflictoParcela (ADR-014) — eso no cambia acá.
  assert.match(disabledAttr[0], /conflictoParcela\?\.tiene_conflicto/)
})

test('el aviso de organización mismatch es bloqueante (rojo), mismo estilo que el conflicto de código de parcela', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const bloque = source.match(/\{orgMismatch\?\.tieneConflicto && \([\s\S]*?\)\}/)
  assert.ok(bloque, 'el bloque de aviso de orgMismatch debería existir')
  assert.match(bloque[0], /border-red-200 bg-red-50/)
  assert.match(bloque[0], /⛔/)
})
