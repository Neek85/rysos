# Plan de Ejecución — Vinculación explícita de capa Leaflet/Geoman (Consola QC)

Ver spec: `specs/qc_geoman_layer_binding_fix.md`.

## Pasos

1. **Investigación profunda** (más allá de las dos verificaciones previas):
   rastreo del bundle instalado de `@geoman-io/leaflet-geoman-free` para el
   caso específico `L.CircleMarker` (registros Point) — dispatch por tipo
   de capa (`reInitLayer`), delegación `L.PM.Edit.LayerGroup.enable()`,
   herencia de opciones por prototipo (`L.PM.Edit` base), y disparo real de
   `pm:edit` en `_dragMixinOnMouseUp` para capas sin dragging nativo de
   Leaflet. Conclusión: no hay bug de delegación — el mecanismo ya
   funcionaba para polígonos y para puntos.
2. `components/gis/QcConsoleMap.jsx`: el efecto de `editingKey` ahora llama
   `.pm.enable()`/`.pm.disable()` directamente sobre el sublayer real
   (`childLayer`) en vez de sobre el FeatureGroup wrapper, con opciones de
   arrastre/snap explícitas — satisface literalmente lo pedido en el
   prompt y elimina la dependencia de la cadena de herencia de opciones
   implícita, sin cambiar el comportamiento observable (que ya era
   correcto).
3. `tests/test_qc_layer_editing_binding.mjs` (nuevo): inspección de código
   fuente validando (a) que el efecto obtiene `childLayer` y llama
   `.pm.enable()`/`.disable()` sobre él (no sobre el FeatureGroup), (b) que
   las opciones explícitas incluyen `draggable`/`snappable`, (c) que los
   listeners `pm:edit`/`pm:markerdragend` siguen registrados sobre
   `childLayer`, (d) que `Mapa` (`components/gis/MapDashboard.jsx`) sigue
   sin importar geoman (invariante de solo-lectura sin cambios).
4. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -v`
   (sin regresión, no se tocó Python), parar dev server + `rm -rf .next` +
   `npm run build` + `rm -rf .next` + reiniciar `npm run dev`, smoke test
   en browser (seleccionar un registro de polígono y uno de punto, activar
   "Ajustar Geometría", confirmar vértices/marcador visibles).
5. Commit a `main` — **sin push**: el prompt pide explícitamente preguntar
   al usuario antes de `git push origin main` — se pregunta como siempre.
