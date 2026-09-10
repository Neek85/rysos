// Fix de "las fotos de evidencia no cargan" (2026-09-09, ver AI_STATE.md
// para la causa real confirmada en vivo): createSignedUrl sobre el bucket
// privado evidencias_eudr exige una sesión `authenticated` real
// (rls_storage_select_evidencias, supabase/migrations/20260816_fase3_seguridad_rls.sql)
// -- QcDetailEditor.jsx/MapDashboard.jsx::loadPhoto firmaban con
// getSupabaseClient() (anon key, sin sesión), que devuelve 400 "Object
// not found" aunque el objeto exista. Tests estáticos (source), sin
// credenciales -- confirman que el fix real (getSupabaseBrowserClient,
// que sí lee la sesión de las cookies) quedó en el código y no se
// regresiona sin querer.
//
// Ejecutar con: node --test tests/test_qc_evidencia_foto_session.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

const QC_DETAIL_EDITOR_PATH = 'app/dashboard/qc/components/QcDetailEditor.jsx'
const MAP_DASHBOARD_PATH = 'components/gis/MapDashboard.jsx'

test('QcDetailEditor.jsx firma la foto de evidencia con getSupabaseBrowserClient (sesión real), no con getSupabaseClient (anon)', () => {
  const source = read(QC_DETAIL_EDITOR_PATH)
  assert.match(source, /import \{ getSupabaseBrowserClient \} from '@\/lib\/supabase\/browserClient'/)
  assert.ok(!/from '@\/lib\/supabaseClient'/.test(source), 'no debe seguir importando el cliente anon')

  const effectBlock = source.match(/useEffect\(\(\) => \{\s*if \(!record\.evidencia_foto\)[\s\S]*?\}, \[record\.evidencia_foto\]\)/)
  assert.ok(effectBlock, 'debería existir el efecto que firma la foto de evidencia')
  assert.match(effectBlock[0], /getSupabaseBrowserClient\(\)/)
})

test('MapDashboard.jsx::loadPhoto firma con getSupabaseBrowserClient (sesión real); fetchRecords sigue con getSupabaseClient (vw_monitoreo_web funciona igual con o sin sesión, a propósito)', () => {
  const source = read(MAP_DASHBOARD_PATH)
  assert.match(source, /import \{ getSupabaseBrowserClient \} from '@\/lib\/supabase\/browserClient'/)

  const loadPhotoBlock = source.match(/async function loadPhoto\([\s\S]*?\n  \}/)
  assert.ok(loadPhotoBlock, 'debería existir loadPhoto')
  assert.match(loadPhotoBlock[0], /getSupabaseBrowserClient\(\)/)
  assert.ok(!/getSupabaseClient\(\)/.test(loadPhotoBlock[0]), 'loadPhoto no debe volver a usar el cliente anon')

  const fetchRecordsBlock = source.match(/async function fetchRecords\(\)[\s\S]*?\n  \}/)
  assert.ok(fetchRecordsBlock, 'debería existir fetchRecords')
  assert.match(fetchRecordsBlock[0], /getSupabaseClient\(\)/, 'fetchRecords debe seguir usando el cliente anon -- vw_monitoreo_web funciona sin sesión a propósito')
})
