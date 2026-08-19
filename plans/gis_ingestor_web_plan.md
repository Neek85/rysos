# Plan de Ejecución — Ingestor de Capas Espaciales Multiformato

Ver spec: `specs/gis_ingestor_web.md`.

## Pasos

1. **Verificación previa (hecha antes de escribir código):** confirmado
   contra el repo que `estado_gestion` no existe (la columna real es
   `estado_revision`), que GPKG no tiene parser JS viable en este stack,
   y que la regla "≥4ha exige Polygon" ya está decidida como informativa
   (`ADR-001`) — nunca bloqueante también en este módulo. Confirmado con
   el usuario vía `AskUserQuestion` antes de diseñar: alcance de formatos
   (GeoJSON+KML+Shapefile-ZIP, GPKG fuera) y criterio de la regla de área
   (informativa).
2. `npm install shpjs` (Shapefile-ZIP → GeoJSON, cliente).
3. `lib/gisParser.js` — funciones puras: `parseGeoJsonLayer`,
   `parseKmlLayer` (reutilizan el patrón de `lib/geometryImport.js` pero
   devuelven TODAS las Features, no solo la primera), `parseShapefileZipLayer`
   (async, vía `shpjs`), `detectFormat(filename)`, `autoMatchProperties`
   (candidate-list case-insensitive por tabla destino).
4. `lib/actions/gisActions.js` — Server Action `'use server'`:
   `uploadGeoSpatialFeature` (rutea por tabla destino — `PADRON_PARCELAS`
   delega en `createParcela` ya existente; `EUDR_MONITOREO`/`EUDR_USO_SUELO`/
   `EUDR_INSTALACIONES` insertan directo confiando en el trigger de
   sanitización/área ya existente, `estado_revision` siempre `'PENDIENTE'`)
   y `uploadGeoSpatialBatch` (recorre features, no aborta el lote por una
   fila fallida, mismo patrón que `ImportPadronModal.jsx`).
5. `app/dashboard/mapa/components/CargaEspacialModal.jsx` — drag/select de
   archivo, selector de tabla destino, vista previa editable por Feature
   (geometría + campos auto-detectados), confirmar → `uploadGeoSpatialBatch`,
   resumen creados/fallidos. Sigue las convenciones visuales de
   `ImportPadronModal.jsx` (tabla de vista previa, toast, Tailwind).
6. Conectar el modal en `components/gis/MapDashboard.jsx` (no en
   `page.jsx` — ahí vive el estado `records` que ya resuelve
   `organizationId` vía `resolveOrganizationId`, mismo patrón que
   `handleExportDDS`) con un botón "📤 Cargar Capa Espacial" junto al de
   exportar DDS.
7. Tests: `tests/test_gis_parser.mjs` (`node --test`, funciones puras de
   parseo/auto-match, sin red — mismo patrón que
   `tests/test_geometry_import.mjs`).
8. Verificación: parar el dev server antes de compilar (regla ya
   documentada: `npm run build` concurrente con `npm run dev` corrompe el
   caché `.next/`), `node --test tests/*.mjs`, `npm run build`, reiniciar
   el dev server después.
9. Actualizar `docs/schema_live.md` con el nuevo path de escritura hacia
   `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` desde el
   frontend (antes solo ETL/QGIS).
10. Commit a `main` (sin push).
