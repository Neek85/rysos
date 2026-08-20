# Plan de Ejecución — Reorganización GIS & EUDR (QC = ingesta, Mapa = solo lectura)

Ver spec: `specs/gis_qc_rearchitecture.md`.

## Pasos

1. **Verificación previa:** confirmado que `vw_monitoreo_web` ya filtra
   `APROBADO` y que `MapDashboard.jsx` ya filtra por organización (tareas
   anteriores) — nada que tocar ahí. Confirmado que no existe visor de
   fotos en la Consola QC (falso "preservar"). Decisión tomada de NO mover
   el Editor Vectorial (riesgo/alcance desproporcionado, ver spec).
2. Mover `app/dashboard/mapa/components/CargaEspacialModal.jsx` →
   `app/dashboard/qc/components/CargaEspacialModal.jsx` (copy interno
   actualizado al nuevo contexto).
3. `components/gis/MapDashboard.jsx`: quitar imports/estado/JSX de
   `CargaEspacialModal`/`DriveSyncButton` (botón, modal, toasts,
   `handleSpatialUploaded`).
4. `app/dashboard/qc/page.jsx`: agregar botón + modal + `showUpload` +
   `handleSpatialUploaded` (con `loadPending()` al terminar).
5. `app/dashboard/qc/components/QcDetailEditor.jsx`: visor de evidencia
   fotográfica nuevo (signed URL, mismo patrón que
   `MapDashboard.jsx::loadPhoto`).
6. `app/dashboard/mapa/page.jsx`: copy "Visor de solo lectura".
   `lib/gisTargetTables.js`: comentario de ruta actualizado.
7. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -v`
   (sin regresión, no se tocó Python), parar dev server + `rm -rf .next` +
   `npm run build` + `rm -rf .next` + reiniciar `npm run dev`. Smoke test
   en navegador de ambas páginas.
8. Commit a `main` — **sin push** (el prompt lo pide, pero se confirma
   con el usuario en el chat antes de hacerlo, ver spec).
