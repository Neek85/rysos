// Pruebas de lib/driveSyncTrigger.js — lógica pura del botón "Sincronizar
// Google Drive" (/dashboard/qc, /dashboard/mapa). Ver specs/drive_sync_trigger.md.
// No prueba app/api/gis/sync-drive/route.js directo (fs.existsSync/
// child_process.spawn reales) — mismo criterio que el resto de los tests
// .mjs del proyecto, que separan lógica pura de efectos de lado.
//
// Ejecutar con: node --test tests/test_drive_sync_trigger.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDriveRoot, parseEtlSummary, formatSyncMessage } from '../lib/driveSyncTrigger.js'

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
