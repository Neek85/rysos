# Plan de Ejecución — Botón "Sincronizar Google Drive"

Ver spec: `specs/drive_sync_trigger.md` (addendum "Reversión de la decisión").

## Pasos

1. **Verificación previa:** confirmado que la objeción anterior (drive_root
   es un mount local, no la API de Drive) sigue siendo cierta, pero el
   nuevo prompt la resuelve con degradación explícita ("si no está en
   entorno local... responde 200 con aviso") en vez de fingir que funciona
   en cualquier lado — esto SÍ es implementable como una conveniencia de
   desarrollo local. Corregido: `--once` no existe en el script (ya
   documentado), no se usa acá tampoco.
2. `scripts/etl_drive_to_supabase.py`: agrega una línea final
   `RYZOS_ETL_RESULT_JSON:{...}` a stdout en el bloque `__main__` (después
   de `pipeline.run()`) para que el disparador web tenga métricas
   estructuradas sin scrapear los prints humanos existentes.
3. `lib/driveSyncTrigger.js` (nuevo, no pedido explícitamente por el
   prompt pero necesario para separar lógica pura/testeable de los efectos
   de lado del Route Handler — mismo criterio que `lib/gisVectorEditor.js`):
   `resolveDriveRoot(env)`, `parseEtlSummary(stdout)`,
   `formatSyncMessage(summary)`.
4. `app/api/gis/sync-drive/route.js`: `runtime = 'nodejs'` (child_process
   no existe en Edge). Verifica `RYZOS_DRIVE_ROOT` + `fs.existsSync` +
   `SUPABASE_SERVICE_ROLE_KEY` ANTES de intentar el spawn — 200 con
   mensaje explicativo si falta cualquiera. Si todo está disponible,
   `child_process.spawn('python', [script, driveRoot], { env: {...} })`,
   pasando `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` explícitos (el
   script Python los lee sin prefijo `NEXT_PUBLIC_`).
5. `components/gis/DriveSyncButton.jsx` (ubicación corregida — no
   `app/dashboard/qc/components/`, ver spec): botón + toast propio,
   `onSynced(summary)` opcional.
6. Integración: `app/dashboard/qc/page.jsx` (header, `onSynced={loadPending}`)
   y `components/gis/MapDashboard.jsx` (junto al selector de exportación
   DDS, `onSynced={fetchRecords}` — se extrajo `fetchRecords` de su
   `useEffect` para poder reinvocarlo). `app/dashboard/mapa/page.jsx` NO
   se toca — es un wrapper delgado, los botones reales viven dentro de
   `MapDashboard.jsx`.
7. `.env.example`: documenta `RYZOS_DRIVE_ROOT` (comentada) y
   `SUPABASE_SERVICE_ROLE_KEY` (ya en uso real, nunca antes documentada
   ahí).
8. `tests/test_drive_sync_trigger.mjs`: cobertura de las 3 funciones puras
   de `lib/driveSyncTrigger.js`.
9. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -v`
   (sin regresión, confirma que el print nuevo no rompe nada), parar dev
   server + `rm -rf .next` + `npm run build` + `rm -rf .next` + reiniciar
   `npm run dev`.
10. Commit a `main` (sin push).
