// Lógica pura del disparador manual de sincronización Google Drive
// (botón "Sincronizar Google Drive" en /dashboard/qc y /dashboard/mapa) —
// ver specs/drive_sync_trigger.md. Separado de app/api/gis/sync-drive/route.js
// (que sí tiene efectos de lado real: fs.existsSync, child_process.spawn)
// para que estas funciones sean testeables con node --test sin tocar disco
// ni procesos reales — mismo criterio que lib/gisVectorEditor.js.
//
// INVARIANTE DE ALCANCE (ver specs/drive_sync_trigger.md): esto NUNCA
// funciona en producción desplegada (Vercel) — drive_root
// (scripts/etl_drive_to_supabase.py) es una ruta de filesystem LOCAL (el
// mount de Google Drive Desktop en la máquina de un desarrollador), no una
// integración real con la API de Google Drive. Este botón es una
// conveniencia de DESARROLLO LOCAL: si RYZOS_DRIVE_ROOT no está seteada o
// la ruta no existe en el filesystem donde corre el proceso Node, se
// responde con un mensaje explicativo (200), nunca un intento de spawn
// que fallaría igual.

const RESULT_MARKER = 'RYZOS_ETL_RESULT_JSON:'

/**
 * Resuelve la ruta configurada de RYZOS_CLIENTES desde el entorno. `env`
 * se recibe por parámetro (no lee `process.env` directo) para que sea
 * testeable sin variables de entorno reales — el caller real pasa
 * `process.env`.
 */
export function resolveDriveRoot(env) {
  const value = env?.RYZOS_DRIVE_ROOT
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Extrae y parsea la línea `RYZOS_ETL_RESULT_JSON:{...}` que
 * scripts/etl_drive_to_supabase.py imprime como ÚLTIMA línea de stdout al
 * terminar (ver el propio script) — nunca scrapea los prints humanos
 * `[ETL-DRIVE] ...`, que pueden cambiar de formato sin avisar. Devuelve
 * `null` si el marcador no aparece (script falló antes de llegar a
 * imprimirlo, o cambió el formato) — el caller decide cómo mostrar eso.
 */
export function parseEtlSummary(stdout) {
  if (typeof stdout !== 'string') return null
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith(RESULT_MARKER))
  if (!line) return null
  try {
    return JSON.parse(line.slice(RESULT_MARKER.length))
  } catch {
    return null
  }
}

// HALLAZGO REAL (2026-08-21, ver
// docs/adr/ADR-009-fix-mensaje-error-sync-drive.md): app/api/gis/sync-drive/route.js
// devolvía `detail: ""` en cada fallo real (confirmado en vivo, no una
// hipótesis) — la causa NO era timing/buffering en la captura de
// child.stderr (una reproducción aislada con el mismo spawn() capturó
// stderr completo sin problema). La causa real: el proceso Python nunca
// llegaba a arrancar — `child.on('close')` se disparaba con
// code=3221225794 (NTSTATUS 0xC0000135, STATUS_DLL_NOT_FOUND — Windows no
// pudo cargar una DLL requerida por el "python" resuelto por spawn() en
// ese proceso concreto) y CERO bytes en stdout/stderr, porque el proceso
// jamás ejecutó ninguna línea. `(stderr || stdout).slice(-2000)` sobre dos
// strings vacíos da `""` — la información real (que el proceso murió sin
// arrancar, con qué código) se descartaba en vez de reportarse.
const KNOWN_EMPTY_OUTPUT_EXIT_CODES = {
  3221225794:
    'Windows no pudo cargar una DLL requerida por el intérprete de Python resuelto ' +
    '(NTSTATUS 0xC0000135, STATUS_DLL_NOT_FOUND) — el proceso nunca llegó a arrancar. ' +
    'En este proyecto se observó ligado a un proceso `next dev` de larga duración; ' +
    'reiniciarlo (matar node, borrar .next, `npm run dev` de nuevo) lo resolvió.',
}

/**
 * Arma el texto de `detail` a partir del resultado crudo de runPythonEtl()
 * — separado de route.js para poder testearlo sin child_process real (ver
 * ADR-009). Si stdout/stderr tienen contenido, se usa tal cual (recortado
 * a los últimos 2000 caracteres, como antes). Si AMBOS están vacíos pero
 * el proceso terminó con código distinto de cero, esto ya NO devuelve una
 * cadena vacía silenciosa: reporta que el proceso no produjo salida y, si
 * el código coincide con un caso conocido, agrega una pista concreta.
 */
export function buildSyncErrorDetail({ code, stdout, stderr }) {
  const raw = (stderr || stdout || '').trim()
  if (raw) return raw.slice(-2000)

  const hint = KNOWN_EMPTY_OUTPUT_EXIT_CODES[code]
  return (
    `El proceso Python terminó con código de salida ${code} sin producir ninguna salida ` +
    `(stdout y stderr vacíos) — no llegó a ejecutar ninguna línea del script.` +
    (hint ? ` ${hint}` : '')
  )
}

/**
 * Extrae la línea más útil de `detail` (típicamente la última línea no
 * vacía de un traceback de Python — la que tiene el tipo y mensaje real
 * de la excepción, ej. `postgrest.exceptions.APIError: {...}`) para
 * mostrar en el toast de DriveSyncButton.jsx sin volcar el traceback
 * completo en una notificación pequeña. Devuelve `null` si no hay nada
 * útil que mostrar (ver ADR-009).
 */
export function summarizeErrorDetail(detail) {
  if (typeof detail !== 'string') return null
  const lines = detail
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length ? lines[lines.length - 1] : null
}

/**
 * Arma el mensaje humano del toast a partir del summary ya parseado —
 * separado de la UI (DriveSyncButton.jsx) para poder testearlo sin JSX.
 */
export function formatSyncMessage(summary) {
  if (!summary) return 'Sincronización terminada, pero no se pudo leer el resumen de resultados.'
  const { packages_processed: packages, total_records: records, total_photos: photos } = summary
  if (!packages) return 'No había paquetes nuevos en Google Drive para procesar.'
  return (
    `${packages} paquete(s) procesado(s): ${records} registro(s) y ${photos} foto(s) ` +
    `subidos, quedan PENDIENTE de revisión en la Consola QC.`
  )
}
