# Plan de Ejecución — Reorganización del Editor Vectorial (Geoman)

Ver spec: `specs/ui_reorganization_geoman.md`.

## Pasos

1. **Verificación previa:** confirmado el riesgo real ya identificado en
   `specs/gis_qc_rearchitecture.md` (modo Editar global de geoman vs.
   `editingKey`) — resuelto con `enableGlobalEditControls: false` en vez
   de improvisar. Confirmado que z-index/PII ya estaban bien (no premisas
   falsas del prompt esta vez, verificación de rutina).
2. `components/gis/MapDashboard.jsx`: remueve `useVectorEditor`/
   `VectorEditorPanel`, import de geoman, estado `mapReady`, layout de 2
   columnas.
3. Mueve `app/dashboard/mapa/components/VectorEditorTools.jsx` →
   `app/dashboard/qc/components/VectorEditorTools.jsx`, agrega
   `targetTables`/`enableGlobalEditControls`/`onSaved` parametrizables.
4. `components/gis/QcConsoleMap.jsx`: engancha `useVectorEditor` con
   `targetTables: ['EUDR_MONITOREO','EUDR_USO_SUELO']`,
   `enableGlobalEditControls: false`; nuevas props `organizationId`/
   `onFeatureCreated`; renderiza `VectorEditorPanel` junto al mapa.
5. `app/dashboard/qc/page.jsx`: pasa las 2 props nuevas a `QcConsoleMap`.
6. Corrige comentarios stale en `lib/gisTargetTables.js`,
   `lib/gisVectorEditor.js`, `tests/test_gis_editor.mjs` (rutas viejas).
7. `tests/test_ui_reorganization.mjs`: 10 tests de inspección de código
   fuente (ausencia en Mapa, presencia en QC, scoping de tablas, flag de
   controles globales, wiring de props, cero PII).
8. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -v`
   (sin regresión, no se tocó Python), parar dev server + `rm -rf .next` +
   `npm run build` + `rm -rf .next` + reiniciar `npm run dev`. Smoke test
   en navegador de ambas páginas.
9. Commit a `main`. Push: se confirma con el usuario antes de ejecutar
   (la autorización anterior fue para ese lote de commits específico).
