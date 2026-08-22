# ADR-009 — Fix del `detail` vacío en `/api/gis/sync-drive` + confirmación de migración ORG-COOP-NORTE → ORG-TEST-E2E

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-21
- **Código:** `lib/driveSyncTrigger.js` (`buildSyncErrorDetail`,
  `summarizeErrorDetail`), `app/api/gis/sync-drive/route.js`,
  `components/gis/DriveSyncButton.jsx`
- **Tests:** `tests/test_drive_sync_trigger.mjs` (+8 tests)
- **Por qué un ADR nuevo y no un addendum a ADR-008:** ADR-008 trata sobre
  integridad de datos y guardarailes de escritura contra organizaciones
  reales (`es_organizacion_prueba`). Este hallazgo es un tema distinto —
  observabilidad/DevEx en el reporte de errores del botón "Sincronizar
  Google Drive" — que solo comparte el día y el disparador (la
  investigación de la FK) con ADR-008, no el problema de fondo. Se
  documenta separado para que cada ADR se pueda referenciar sin arrastrar
  al otro.

## Parte 1: confirmación de que la carpeta renombrada procesa correctamente

Tras la investigación anterior (violación de FK `fk_eudr_instalaciones_organizacion`
porque `RYZOS_CLIENTES/ORG-COOP-NORTE/RYZOS_INBOX/data1.zip` usaba un
`ID_Organizacion` sin fila en `ORGANIZACIONES`), el usuario renombró
manualmente la carpeta de Google Drive Desktop a `ORG-TEST-E2E` (la
organización de prueba real creada en ADR-008). Confirmado:

- El rename se propagó al filesystem local sincronizado (`ls` sobre
  `RYZOS_CLIENTES/` mostró solo `ORG-TEST-E2E/`, con `data1.zip` todavía
  en `RYZOS_INBOX`).
- Corriendo `scripts/etl_drive_to_supabase.py` directo: `data1.zip` se
  procesó con éxito — 9 registros (`EUDR_INSTALACIONES=3`,
  `EUDR_MONITOREO=3`, `EUDR_USO_SUELO=3`), 5 fotos, `Org: ORG-TEST-E2E`,
  y el zip se archivó como
  `PROCESADO_20260821_232157_data1.zip`. La FK aceptó el insert porque
  `ORG-TEST-E2E` sí existe en `ORGANIZACIONES` (ver ADR-008).

## Parte 2: el hallazgo real detrás de `detail: ""`

La investigación anterior propuso como hipótesis un problema de
timing/buffering en cómo `app/api/gis/sync-drive/route.js` captura
`child.stderr` con `child_process.spawn` en Windows. **Esa hipótesis
quedó descartada por evidencia directa**, no asumida:

1. Reproduje `runPythonEtl()` de forma aislada (`node` standalone, mismo
   `spawn()` exacto, forzando un error real con un `.zip` sin capa
   `.gpkg`/`.geojson`) — stderr se capturó completo, 6 eventos `data`,
   668 bytes, y `close` se disparó *después* del último `data`. La
   captura en sí funciona correctamente.
2. Contra el servidor `next dev` que ya estaba corriendo en la sesión,
   **cualquier** llamada a `/api/gis/sync-drive` devolvía `500` en 30–527ms
   — un tiempo imposible para el script real (que tarda 3+ segundos solo
   en arrancar por los imports pesados de `geopandas`/`shapely`/
   `supabase-py`), incluso cuando no había ningún `.zip` pendiente que
   procesar.
3. Agregué logging temporal de diagnóstico a `runPythonEtl()` (removido
   antes de este commit) y confirmé la causa real:
   `child.on('close')` se disparaba con **`code = 3221225794`**
   (`0xC0000135` en hexadecimal — `STATUS_DLL_NOT_FOUND` de Windows) y
   **cero bytes** en stdout y stderr. El proceso Python nunca llegó a
   arrancar — Windows no pudo cargar una DLL requerida por el `python`
   que `spawn()` resolvió en ese proceso concreto — así que no había
   absolutamente nada que capturar.
4. Confirmé la causa de fondo reiniciando el servidor de desarrollo
   limpio (matar `node`, borrar `.next`, `npm run dev` de nuevo): el
   mismo request que antes fallaba con `code=3221225794` pasó a
   `code=0` con salida real. El problema estaba ligado al proceso
   `next dev` concreto que llevaba corriendo mucho tiempo en esta sesión
   (mismo patrón general que el incidente de `/dashboard/mapa` de hoy:
   un proceso de larga duración con estado interno que se corrompe), no
   al código de `route.js` en sí ni a un problema de timing de
   `child_process`.

**El bug real que sí estaba en el código:** `detail: (stderr ||
stdout).slice(-2000)` sobre dos strings vacíos da `""` — cuando el
proceso muere sin producir salida (por la causa de arriba, o por
cualquier otra falla a nivel de sistema operativo: permisos, antivirus,
OOM), el endpoint reportaba silenciosamente nada en vez de decir "el
proceso murió con código X sin producir salida". Esa pérdida de
información silenciosa es lo que se corrige acá — independientemente de
que la causa puntual de esta sesión (proceso `next dev` con estado
corrupto) sea o no la que se repita en el futuro.

## Decisión: `buildSyncErrorDetail()` — nunca más `detail: ""`

Nueva función pura en `lib/driveSyncTrigger.js` (testeable con
`node --test`, mismo criterio que el resto del archivo):

- Si `stderr` o `stdout` tienen contenido real, lo usa tal cual (recortado
  a los últimos 2000 caracteres, igual que antes).
- Si **ambos** están vacíos pero el proceso terminó con código distinto
  de cero, ya no devuelve `""`: arma un mensaje explícito ("el proceso
  Python terminó con código de salida N sin producir ninguna salida...")
  y, si el código coincide con `STATUS_DLL_NOT_FOUND` (3221225794, el
  caso real observado hoy), agrega una pista concreta sobre la causa y
  cómo se resolvió esta vez.

`app/api/gis/sync-drive/route.js` ahora usa `buildSyncErrorDetail({
code, stdout, stderr })` en vez de `(stderr || stdout).slice(-2000)`.

## Decisión: la UI ahora sí muestra el detalle, no solo el mensaje genérico

Segundo bug encontrado en el camino: `DriveSyncButton.jsx` **nunca leía
`data.detail`** — el toast de error siempre mostraba `data.message`
("El script de sincronización terminó con un error."), sin importar qué
tan específico fuera `detail`. Se agregó `summarizeErrorDetail()`
(también en `lib/driveSyncTrigger.js`) que extrae la última línea no
vacía de `detail` — para un traceback de Python, esa línea es
típicamente el tipo y mensaje real de la excepción (ej.
`postgrest.exceptions.APIError: {...}`), sin volcar el traceback
completo en una notificación pequeña. `DriveSyncButton.jsx` ahora
concatena `data.message` + esa línea resumida.

## Verificación en vivo (no mockeada) del fix completo

Con el servidor reiniciado limpio, forcé un error real: un `.zip`
desechable sin capa `.gpkg`/`.geojson` (`ORG-DEBUG-FAKE/RYZOS_INBOX/bad.zip`,
creado y borrado solo para esta prueba — nunca llegó a la carpeta
`RYZOS_ARCHIVE`, confirmando además que un fallo real nunca mueve el
`.zip` original). La respuesta de `/api/gis/sync-drive` pasó de
`{"detail":""}` a un `detail` con el traceback completo, terminando en
`FileNotFoundError: No se encontro capa .gpkg/.geojson en el paquete:
bad.zip` — exactamente la línea que `summarizeErrorDetail()` extraería
para el toast.
