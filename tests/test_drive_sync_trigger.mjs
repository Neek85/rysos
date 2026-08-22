// Pruebas de lib/driveSyncTrigger.js — lógica pura del botón "Sincronizar
// Google Drive" (/dashboard/qc, /dashboard/mapa). Ver specs/drive_sync_trigger.md.
// No prueba app/api/gis/sync-drive/route.js directo (fs.existsSync/
// child_process.spawn reales) — mismo criterio que el resto de los tests
// .mjs del proyecto, que separan lógica pura de efectos de lado.
//
// Ejecutar con: node --test tests/test_drive_sync_trigger.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveDriveRoot,
  parseEtlSummary,
  formatSyncMessage,
  buildSyncErrorDetail,
  summarizeErrorDetail,
} from '../lib/driveSyncTrigger.js'

// ---------------------------------------------------------------
// resolveDriveRoot
// ---------------------------------------------------------------

test('resolveDriveRoot devuelve la ruta si RYZOS_DRIVE_ROOT está seteada y no es solo espacios', () => {
  assert.equal(resolveDriveRoot({ RYZOS_DRIVE_ROOT: 'C:\\Users\\dev\\Mi unidad\\RYZOS_CLIENTES' }), 'C:\\Users\\dev\\Mi unidad\\RYZOS_CLIENTES')
})

test('resolveDriveRoot recorta espacios', () => {
  assert.equal(resolveDriveRoot({ RYZOS_DRIVE_ROOT: '  /home/dev/RYZOS_CLIENTES  ' }), '/home/dev/RYZOS_CLIENTES')
})

test('resolveDriveRoot devuelve null si la variable no está seteada', () => {
  assert.equal(resolveDriveRoot({}), null)
})

test('resolveDriveRoot devuelve null si la variable es un string vacío o solo espacios', () => {
  assert.equal(resolveDriveRoot({ RYZOS_DRIVE_ROOT: '   ' }), null)
})

test('resolveDriveRoot devuelve null si env es null/undefined (no lanza)', () => {
  assert.equal(resolveDriveRoot(null), null)
  assert.equal(resolveDriveRoot(undefined), null)
})

// ---------------------------------------------------------------
// parseEtlSummary
// ---------------------------------------------------------------

test('parseEtlSummary extrae el JSON de la línea RYZOS_ETL_RESULT_JSON: al final de stdout', () => {
  const stdout =
    '[ETL-DRIVE] Procesando paquete: foo.zip\n' +
    '  -> Org: COOP-JS | Registros: 3 (EUDR_MONITOREO=3) | Fotos: 2 | Archivado en: bar\n' +
    'RYZOS_ETL_RESULT_JSON:{"packages_processed":1,"total_records":3,"total_photos":2,"organizations":["COOP-JS"]}\n'
  const summary = parseEtlSummary(stdout)
  assert.deepEqual(summary, {
    packages_processed: 1,
    total_records: 3,
    total_photos: 2,
    organizations: ['COOP-JS'],
  })
})

test('parseEtlSummary usa la ÚLTIMA línea con el marcador si aparece más de una vez', () => {
  const stdout =
    'RYZOS_ETL_RESULT_JSON:{"packages_processed":0,"total_records":0,"total_photos":0,"organizations":[]}\n' +
    'algo más en el medio\n' +
    'RYZOS_ETL_RESULT_JSON:{"packages_processed":2,"total_records":5,"total_photos":1,"organizations":["A","B"]}\n'
  const summary = parseEtlSummary(stdout)
  assert.equal(summary.packages_processed, 2)
})

test('parseEtlSummary devuelve null si el marcador no aparece (script falló antes de imprimirlo)', () => {
  assert.equal(parseEtlSummary('[ERROR] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY\n'), null)
})

test('parseEtlSummary devuelve null si el JSON después del marcador está corrupto', () => {
  assert.equal(parseEtlSummary('RYZOS_ETL_RESULT_JSON:{esto no es json'), null)
})

test('parseEtlSummary devuelve null con stdout no-string (undefined/null)', () => {
  assert.equal(parseEtlSummary(undefined), null)
  assert.equal(parseEtlSummary(null), null)
})

// ---------------------------------------------------------------
// formatSyncMessage
// ---------------------------------------------------------------

test('formatSyncMessage resume paquetes/registros/fotos cuando hubo procesamiento', () => {
  const message = formatSyncMessage({ packages_processed: 2, total_records: 7, total_photos: 3, organizations: ['COOP-JS'] })
  assert.match(message, /2 paquete/)
  assert.match(message, /7 registro/)
  assert.match(message, /3 foto/)
  assert.match(message, /PENDIENTE/)
})

test('formatSyncMessage avisa que no había paquetes nuevos cuando packages_processed es 0', () => {
  const message = formatSyncMessage({ packages_processed: 0, total_records: 0, total_photos: 0, organizations: [] })
  assert.match(message, /No había paquetes nuevos/)
})

test('formatSyncMessage da un mensaje razonable si summary es null (parseEtlSummary falló)', () => {
  const message = formatSyncMessage(null)
  assert.equal(typeof message, 'string')
  assert.ok(message.length > 0)
})

// ---------------------------------------------------------------
// buildSyncErrorDetail / summarizeErrorDetail — ver
// docs/adr/ADR-009-fix-mensaje-error-sync-drive.md (detail vacío en
// fallos reales: la causa NO era timing/buffering de child.stderr, sino
// que el proceso Python moría a nivel de SO (Windows STATUS_DLL_NOT_FOUND,
// code=3221225794) sin llegar a escribir nada — (stderr || stdout) sobre
// dos strings vacíos daba "" silencioso).
// ---------------------------------------------------------------

test('buildSyncErrorDetail usa stderr tal cual (recortado a 2000 chars) cuando hay contenido real', () => {
  const stderr = 'Traceback (most recent call last):\n...\nFileNotFoundError: no se encontro capa'
  const detail = buildSyncErrorDetail({ code: 1, stdout: '', stderr })
  assert.equal(detail, stderr)
})

test('buildSyncErrorDetail cae a stdout si stderr está vacío pero stdout tiene contenido', () => {
  const detail = buildSyncErrorDetail({ code: 1, stdout: 'algo de stdout util', stderr: '' })
  assert.equal(detail, 'algo de stdout util')
})

test('buildSyncErrorDetail NUNCA devuelve cadena vacía cuando code !== 0, aunque stdout/stderr estén vacíos', () => {
  const detail = buildSyncErrorDetail({ code: 1, stdout: '', stderr: '' })
  assert.ok(detail.length > 0)
  assert.match(detail, /código de salida 1/)
  assert.match(detail, /sin producir ninguna salida/)
})

test('buildSyncErrorDetail agrega la pista conocida para STATUS_DLL_NOT_FOUND (code=3221225794) sin salida', () => {
  const detail = buildSyncErrorDetail({ code: 3221225794, stdout: '', stderr: '' })
  assert.match(detail, /STATUS_DLL_NOT_FOUND/)
  assert.match(detail, /DLL/)
})

test('buildSyncErrorDetail no agrega ninguna pista falsa para un código sin entrada conocida', () => {
  const detail = buildSyncErrorDetail({ code: 42, stdout: '', stderr: '' })
  assert.match(detail, /código de salida 42/)
  assert.ok(!/STATUS_/.test(detail), 'no debería inventar una pista para un código no mapeado')
})

test('summarizeErrorDetail extrae la última línea no vacía (el tipo+mensaje real de la excepción)', () => {
  const detail =
    'Traceback (most recent call last):\r\n' +
    '  File "scripts/etl_drive_to_supabase.py", line 467, in process_layer_rows\r\n' +
    '    self.supabase.table(table_name).upsert(payload, on_conflict=on_conflict).execute()\r\n' +
    'postgrest.exceptions.APIError: {\'message\': \'insert or update on table "EUDR_INSTALACIONES" violates foreign key constraint\'}\r\n'
  assert.equal(
    summarizeErrorDetail(detail),
    'postgrest.exceptions.APIError: {\'message\': \'insert or update on table "EUDR_INSTALACIONES" violates foreign key constraint\'}'
  )
})

test('summarizeErrorDetail devuelve null para entradas vacías o no-string', () => {
  assert.equal(summarizeErrorDetail(''), null)
  assert.equal(summarizeErrorDetail('   \n  \n'), null)
  assert.equal(summarizeErrorDetail(null), null)
  assert.equal(summarizeErrorDetail(undefined), null)
})
