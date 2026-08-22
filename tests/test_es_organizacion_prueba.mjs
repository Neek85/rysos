// Etiqueta es_organizacion_prueba + guardarail E2E + protocolo de
// confirmación para borrados masivos — ver
// docs/adr/ADR-008-etiqueta-organizacion-prueba-y-guardarail-e2e.md.
//
// La migración NO está aplicada todavía en la instancia real (aplicación
// manual en Supabase Studio, como toda migración de este repo) — se
// verifica por inspección de la SQL real, mismo criterio ya usado para
// las migraciones anteriores de esta sesión.
//
// Ejecutar con: node --test tests/test_es_organizacion_prueba.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

const MIGRATION_PATH = 'supabase/migrations/20260822_021532_es_organizacion_prueba.sql'
const E2E_SCRIPT_PATH = 'scripts/run_e2e_etl_test.py'
const SAFETY_LIB_PATH = 'lib/safety/confirmarOperacionMasiva.js'
const ADR_PATH = 'docs/adr/ADR-008-etiqueta-organizacion-prueba-y-guardarail-e2e.md'
const ORQUESTADOR_PATH = 'docs/RYZOS_ORQUESTADOR_V3.1.md'

test('la migración agrega es_organizacion_prueba boolean NOT NULL DEFAULT false (idempotente, IF NOT EXISTS)', () => {
  const source = read(MIGRATION_PATH)
  assert.match(
    source,
    /ADD COLUMN IF NOT EXISTS es_organizacion_prueba boolean NOT NULL DEFAULT false;/
  )
})

test('la migración inserta/actualiza ORG-TEST-E2E con es_organizacion_prueba = true (upsert idempotente vía ON CONFLICT)', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /'ORG-TEST-E2E'/)
  assert.match(source, /ON CONFLICT \("ID"\) DO UPDATE SET/)
  assert.match(source, /es_organizacion_prueba = true/)
})

test('run_e2e_etl_test.py usa ORG_ID = "ORG-TEST-E2E" (ya no "ORG-COOP-NORTE")', () => {
  const source = read(E2E_SCRIPT_PATH)
  assert.match(source, /ORG_ID = "ORG-TEST-E2E"/)
  assert.ok(
    !/^ORG_ID = "ORG-COOP-NORTE"/m.test(source),
    'no debería quedar el ORG_ID viejo como asignación activa a nivel de módulo (menciones en comentarios históricos sí son válidas)'
  )
})

test('run_e2e_etl_test.py tiene el guardarail assert_org_is_test_marked y lo llama antes de process_package en modo real', () => {
  const source = read(E2E_SCRIPT_PATH)
  assert.match(source, /def assert_org_is_test_marked\(supabase, org_id: str\) -> None:/)
  assert.match(source, /class UnsafeOrgIdError\(Exception\):/)

  const guardIndex = source.indexOf('if mock_supabase is None:\n        assert_org_is_test_marked(pipeline.supabase, ORG_ID)')
  const processIndex = source.indexOf('result = pipeline.process_package(zip_path, execute_move=True)')
  assert.ok(guardIndex !== -1, 'el guardarail debería llamarse en run_e2e()')
  assert.ok(guardIndex < processIndex, 'el guardarail debe correr ANTES de process_package (el punto real de escritura)')
})

test('el guardarail solo corre en modo real (mock_supabase is None) — el modo simulado no tiene ORGANIZACIONES que consultar', () => {
  const source = read(E2E_SCRIPT_PATH)
  assert.match(source, /if mock_supabase is None:\s*\n\s*assert_org_is_test_marked/)
})

test('teardown_e2e_rows sigue borrando por id_monitoreo, sin depender del valor de ORG_ID', () => {
  const source = read(E2E_SCRIPT_PATH)
  const fnMatch = source.match(/def teardown_e2e_rows\([\s\S]*?\n\n\n/)
  assert.ok(fnMatch, 'teardown_e2e_rows debería seguir existiendo')
  assert.match(fnMatch[0], /\.delete\(\)\.eq\("id_monitoreo", row_id\)\.execute\(\)/)
})

test('confirmarOperacionMasiva usa getSupabaseServerClient (server-only) y retorna nombre_organizacion/es_prueba/conteo_filas_afectadas', () => {
  const source = read(SAFETY_LIB_PATH)
  assert.match(source, /import \{ getSupabaseServerClient \} from '@\/lib\/supabaseServerClient'/)
  assert.match(source, /export async function confirmarOperacionMasiva\(/)
  assert.match(source, /nombre_organizacion:/)
  assert.match(source, /es_prueba:/)
  assert.match(source, /conteo_filas_afectadas:/)
  assert.ok(
    !/^['"]use client['"]/m.test(source),
    'no debería tener la directiva "use client" como statement del archivo — es server-only (mencionarla en un comentario explicando por qué NO se usa es válido)'
  )
})

test('confirmarOperacionMasiva trata la ausencia de fila en ORGANIZACIONES como es_prueba=false (lado seguro)', () => {
  const source = read(SAFETY_LIB_PATH)
  assert.match(source, /es_prueba: org\?\.es_organizacion_prueba \?\? false/)
})

test('el ADR-008 documenta el incidente, el DEFAULT false, y la fila ORG-TEST-E2E', () => {
  const source = read(ADR_PATH)
  assert.match(source, /ADR-007/)
  assert.match(source, /DEFAULT false/)
  assert.match(source, /ORG-TEST-E2E/)
  assert.match(source, /assert_org_is_test_marked/)
})

test('docs/RYZOS_ORQUESTADOR_V3.1.md Sección 5 documenta el protocolo de confirmación para borrados/actualizaciones masivas', () => {
  const source = read(ORQUESTADOR_PATH)
  assert.match(source, /es_organizacion_prueba = false/)
  assert.match(source, /confirmarOperacionMasiva/)
  assert.match(source, /Claude Code CLI.*script.*Supabase Studio|CLI[\s\S]{0,80}Studio/)
})
