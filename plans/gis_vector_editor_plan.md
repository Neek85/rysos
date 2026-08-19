# Plan de Ejecución — Editor Vectorial WebGIS

Ver spec: `specs/gis_vector_editor.md`.

## Pasos

1. **Verificación previa:** confirmado que `app/dashboard/mapa/components/MapDashboard.jsx`
   no existe (el real es `components/gis/MapDashboard.jsx`); que `leaflet-draw`
   está sin releases reales hace años y `leaflet-geoman-free` (2.20.0) sí se
   mantiene, con API imperativa compatible con el patrón de Leaflet ya
   usado en este archivo (import dinámico dentro de `useEffect`); que
   `@turf/turf` completo no hace falta, solo `@turf/area`+`@turf/kinks`.
2. `npm install @geoman-io/leaflet-geoman-free @turf/area @turf/kinks`.
3. `lib/gisTargetTables.js` — extrae `TARGET_TABLE_LABELS`/`TARGET_TABLE_FIELDS`
   de `CargaEspacialModal.jsx` (fuente única, evita divergencia) y agrega
   `TARGET_TABLE_GEOMETRY_TYPES`. Actualizar `CargaEspacialModal.jsx` para
   importar desde ahí.
4. `app/dashboard/mapa/components/VectorEditorTools.jsx`:
   - `attachVectorEditor(map, L, { onDraftChange, onFinalize })`: agrega
     controles geoman (Polígono, Marcador, Editar, Arrastrar, Eliminar —
     nada más), `allowSelfIntersection: false`, calcula área
     (`@turf/area`) y auto-intersección (`@turf/kinks`) en cada
     `pm:vertexadded`/`pm:edit`/`pm:markerdragend`, dispara `onFinalize`
     en `pm:create`. Devuelve función de limpieza (`removeControls` +
     `off`).
   - `useVectorEditor({ mapRef, leafletRef, mapReady, organizationId })`:
     hook que llama `attachVectorEditor` una vez `mapReady` es `true`,
     mantiene estado (`draft`, `drawnLayer`, `targetTable`,
     `fieldValues`, `saving`, `result`), expone `handleSave`/`handleCancel`
     que llaman a `uploadGeoSpatialFeature` (`lib/actions/gisActions.js`,
     sin cambios).
   - `VectorEditorPanel` (export default): panel lateral compacto —
     selector de tabla, área/validación en vivo, campos manuales
     (`TARGET_TABLE_FIELDS`), Cancelar/Guardar.
5. `components/gis/MapDashboard.jsx`:
   - Importar geoman + su CSS dinámicamente dentro del `init()` ya
     existente, **antes** de `L.map(...)` (para que `L.Map.addInitHook`
     de geoman registre antes de que se cree la instancia del mapa).
   - Nuevo estado `mapReady`, `true` tras un init exitoso.
   - `useVectorEditor(...)` + renderizar `<VectorEditorPanel />` junto a
     los botones existentes ("Cargar Capa Espacial"/"Exportar DDS").
6. `tests/test_gis_editor.mjs` — funciones puras extraídas a
   `VectorEditorTools.jsx` (cálculo de área/kinks a partir de una
   geometry GeoJSON, sin depender de un mapa Leaflet real) + validación
   `TARGET_TABLE_GEOMETRY_TYPES`. `attachVectorEditor`/`useVectorEditor`
   en sí no son testeables con `node --test` (requieren un `L.Map` real,
   sin jsdom en este proyecto) — se dejan fuera, cubiertas por el smoke
   test en navegador del paso 8.
7. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -q`
   (sin regresión, no se tocó Python).
8. Smoke test en navegador real (claude-in-chrome): cargar
   `/dashboard/mapa`, dibujar un polígono de prueba, confirmar que el
   panel muestra área/geometría, revisar consola sin errores.
9. Detener dev server + `rm -rf .next` + `npm run build` + `rm -rf .next`
   + reiniciar `npm run dev` (regla ya documentada de no correr build y
   dev en paralelo).
10. Commit a `main` (sin push).
