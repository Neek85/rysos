// Fase B0 — vínculo real entre EUDR_USO_SUELO y su EUDR_MONITOREO padre
// (reemplaza el heurístico espacial temporal de ADR-005 Fase A) — ver
// docs/adr/ADR-010-vinculo-real-uso-suelo-monitoreo.md.
//
// La migración NO está aplicada todavía en la instancia real (aplicación
// manual en Supabase Studio, como toda migración de este repo) — se
// verifica por inspección de la SQL real, mismo criterio ya usado para
// las migraciones anteriores de esta sesión.
//
// Ejecutar con: node --test tests/test_vinculo_uso_suelo_monitoreo.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

const MIGRATION_PATH = 'supabase/migrations/20260823_145038_qfield_relation_id_monitoreo.sql'
const ETL_PATH = 'scripts/etl_drive_to_supabase.py'

test('la migración agrega qfield_relation_id (text, nullable) a EUDR_MONITOREO de forma idempotente', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /ADD COLUMN IF NOT EXISTS qfield_relation_id text;/)
})

test('la migración agrega un índice sobre qfield_relation_id, nunca una FK (identificador externo de QField)', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /CREATE INDEX IF NOT EXISTS idx_eudr_monitoreo_qfield_relation_id\s*\n\s*ON public\."EUDR_MONITOREO" \(qfield_relation_id\);/)
  assert.ok(!/REFERENCES/.test(source), 'no debería agregar ninguna FK — es un identificador externo, no una PK local')
  assert.ok(!/FOREIGN KEY/.test(source), 'no debería agregar ninguna FK — es un identificador externo, no una PK local')
})

test('build_monitoreo_payload lee row.get("id_monitoreo") (el GUID crudo del GeoPackage) y lo guarda en qfield_relation_id', () => {
  const source = read(ETL_PATH)
  assert.match(source, /"qfield_relation_id": row\.get\("id_monitoreo"\),/)
})

test('el id_monitoreo real (PK/upsert target) sigue calculándose igual que antes — no se reemplazó por el GUID crudo', () => {
  const source = read(ETL_PATH)
  assert.match(source, /id_monitoreo = self\.compute_deterministic_id\(\s*\n\s*MONITOREO_TABLE, org_id, id_parcela_fija, fecha_monitoreo\s*\n\s*\)/)
})

test('el ADR-010 documenta los resultados exactos del backfill (2 vinculados, 1 sin datos suficientes, 0 ambiguos) y la corrección de premisa sobre los paquetes de agosto', () => {
  const source = read('docs/adr/ADR-010-vinculo-real-uso-suelo-monitoreo.md')
  assert.match(source, /2 de 3 registros de `EUDR_MONITOREO`\s*\nvinculados sin ambigüedad, 1 sin resolver por falta de datos \(no por\s*\nconflicto\), 0 casos ambiguos/)
  assert.match(source, /ya se habían borrado.*ADR-007.*commit\s*\n`2391859`/s)
  assert.match(source, /qfield_relation_id/)
})
