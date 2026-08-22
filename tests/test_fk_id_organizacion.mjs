// Auditoría de integridad referencial de ID_Organizacion — ver
// docs/adr/ADR-007-integridad-referencial-id-organizacion.md.
//
// Migración pendiente de aplicación manual (como toda migración de este
// repo) — se verifica por inspección de la SQL real, mismo criterio ya
// usado para fn_validar_topologia_eudr/fn_parcelas_vecinas_eudr antes de
// que esas migraciones se aplicaran.
//
// Ejecutar con: node --test tests/test_fk_id_organizacion.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

const MIGRATION_PATH = 'supabase/migrations/20260821_225310_fk_id_organizacion_eudr.sql'

test('la migración agrega la FK NOT VALID y luego la valida en las 3 tablas EUDR_* (los huérfanos se borran antes en el mismo archivo)', () => {
  const source = read(MIGRATION_PATH)
  for (const table of ['EUDR_MONITOREO', 'EUDR_USO_SUELO', 'EUDR_INSTALACIONES']) {
    const addRe = new RegExp(
      `ALTER TABLE public\\."${table}"\\s+ADD CONSTRAINT (\\w+)\\s+FOREIGN KEY \\("ID_Organizacion"\\) REFERENCES public\\."ORGANIZACIONES"\\("ID"\\)\\s+NOT VALID;`
    )
    const addMatch = source.match(addRe)
    assert.ok(addMatch, `${table} debería tener la FK NOT VALID`)
    const validateRe = new RegExp(
      `ALTER TABLE public\\."${table}"\\s+VALIDATE CONSTRAINT ${addMatch[1]};`
    )
    assert.match(source, validateRe, `${table} debería validar la FK ${addMatch[1]} después de agregarla`)
  }
})

test('la migración borra las filas huérfanas ORG-COOP-NORTE de las 3 tablas EUDR_* antes de agregar la FK', () => {
  const source = read(MIGRATION_PATH)
  for (const table of ['EUDR_MONITOREO', 'EUDR_USO_SUELO', 'EUDR_INSTALACIONES']) {
    const deleteRe = new RegExp(
      `DELETE FROM public\\."${table}" WHERE "ID_Organizacion" = 'ORG-COOP-NORTE';`
    )
    assert.match(source, deleteRe, `${table} debería borrar las filas ORG-COOP-NORTE`)
    const deleteIndex = source.search(deleteRe)
    const addIndex = source.indexOf(`ALTER TABLE public."${table}"\n    ADD CONSTRAINT`)
    assert.ok(deleteIndex < addIndex, `el DELETE de ${table} debe ir antes del ADD CONSTRAINT`)
  }
})

test('la migración es idempotente (DROP CONSTRAINT IF EXISTS antes de cada ADD CONSTRAINT)', () => {
  const source = read(MIGRATION_PATH)
  const dropMatches = source.match(/DROP CONSTRAINT IF EXISTS/g) || []
  assert.equal(dropMatches.length, 3, 'debería haber un DROP CONSTRAINT IF EXISTS por cada una de las 3 tablas')
})

test('la migración NO toca PADRON_SOCIOS/PADRON_PARCELAS (padrón maestro compartido con otro repositorio, decisión documentada en el ADR)', () => {
  const source = read(MIGRATION_PATH)
  assert.ok(!/ALTER TABLE public\."PADRON_SOCIOS"/.test(source))
  assert.ok(!/ALTER TABLE public\."PADRON_PARCELAS"/.test(source))
})

test('el ADR-007 documenta la auditoría completa (6 tablas con columna real, huérfano único, y por qué PADRON_* queda afuera)', () => {
  const source = read('docs/adr/ADR-007-integridad-referencial-id-organizacion.md')
  assert.match(source, /ORG-COOP-NORTE/)
  assert.match(source, /NOT VALID/)
  assert.match(source, /compartid[oa]\s+en\s+vivo\s+con\s+otro\s+repositorio/)
})

test('run_e2e_etl_test.py tiene teardown_e2e_rows y un try/finally en run_e2e', () => {
  const source = read('scripts/run_e2e_etl_test.py')
  assert.match(source, /def teardown_e2e_rows\(/)
  assert.match(source, /def run_e2e\(base_dir: Path, mock_supabase: MagicMock \| None = None, cleanup: bool = True\)/)
  assert.match(source, /finally:/)
})

test('el teardown solo borra por id_monitoreo (nunca un DELETE sin acotar por ID_Organizacion, que borraría corridas ajenas)', () => {
  const source = read('scripts/run_e2e_etl_test.py')
  const fnMatch = source.match(/def teardown_e2e_rows\([\s\S]*?\n\n\n/)
  assert.ok(fnMatch, 'teardown_e2e_rows debería existir')
  assert.match(fnMatch[0], /\.delete\(\)\.eq\("id_monitoreo", row_id\)\.execute\(\)/)
  assert.ok(!/ID_Organizacion.*==.*ORG_ID|eq\("ID_Organizacion"/.test(fnMatch[0]))
})
