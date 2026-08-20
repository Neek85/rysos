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
