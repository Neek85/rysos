# Spec — Vinculación explícita de capa Leaflet/Geoman en edición de vértices (Consola QC)

## Contexto

Tercer prompt consecutivo pidiendo "corregir" la activación del modo de
edición de vértices en `/dashboard/qc` (`editingKey`/`onGeometryChange` en
`components/gis/QcConsoleMap.jsx`). Los dos anteriores (ver `specs/gis_qc_console_v2.md` — el mecanismo existe
desde Consola QC 2.0 — y `specs/qc_single_record_geometry_editing.md`) ya
habían confirmado, vía inspección del código instalado de
`@geoman-io/leaflet-geoman-free`, que el mecanismo `layer.pm.enable()` /
`layer.pm.disable()` por `editingKey`, junto con los listeners `pm:edit` /
`pm:markerdragend`, es correcto.

Dado que es la tercera vez que se reporta como roto, esta vez la
verificación fue más profunda que las anteriores: no solo se confirmó que
los nombres de evento existen, sino que se rastreó la ruta de ejecución
completa dentro del bundle instalado
(`node_modules/@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.js`) para
el caso específico de geometrías tipo `Point` (registros de
`EUDR_INSTALACIONES` y algunos `EUDR_MONITOREO` capturados como punto en
QField), que en este componente se renderizan como `L.CircleMarker`
(`pointToLayer` en el efecto de renderizado) — un tipo que **no** es
`instanceof L.Marker` en la jerarquía de clases de Leaflet, lo que lo hacía
el candidato más plausible para un bug real de delegación.

## Hallazgos de la investigación (evidencia, no repetición de lo ya
confirmado en tareas previas)

1. **Dispatch por tipo de capa** (`leaflet-geoman.js` líneas ~15990-16023,
   función `reInitLayer`/hook de inicialización de `.pm`): geoman tiene una
   rama dedicada `else if (layer instanceof L.CircleMarker) { layer.pm = new
   L.PM.Edit.CircleMarker(layer); }`, **distinta** de la rama
   `L.Marker` (`L.PM.Edit.Marker`). No hay reuso genérico ni fallback
   implícito — cada `L.CircleMarker` obtiene su propio módulo de edición
   dedicado apenas se agrega al mapa (vía `addInitHook`).

2. **Delegación FeatureGroup → sublayer** (`L.PM.Edit.LayerGroup.enable()`,
   líneas ~13676-13690): itera `this._layers` (los hijos reales del
   `L.geoJSON`/FeatureGroup) y llama `layer.pm.enable(options)` sobre cada
   uno que no sea a su vez un `L.LayerGroup`. Para una Feature de tipo
   Point, el único hijo es el `L.CircleMarker` creado por `pointToLayer` —
   la delegación es directa y sin casos especiales pendientes.

3. **Opciones heredadas por prototipo** (`L.PM.Edit` base, líneas
   ~13531-13562): `draggable: true` y `allowEditing: true` son defaults de
   la clase base de la que `L.PM.Edit.CircleMarker` hereda. Como
   `L.Util.setOptions` hace un merge (`L.extend({}, this.options,
   options)`) y no un reemplazo, llamar `enable({ allowSelfIntersection:
   false })` (como hacía el código anterior, a través del FeatureGroup) NO
   pisa esos defaults — `draggable` sigue siendo `true`. No es un bug, pero
   dependía de una cadena de herencia de tres niveles no evidente por
   simple lectura del componente.

4. **Disparo de `pm:edit` en el arrastre de un CircleMarker**
   (`enableLayerDrag()`/mixin de arrastre genérico, líneas ~12888-13120):
   `L.CircleMarker` no soporta `dragging` nativo de Leaflet (a diferencia de
   `L.Marker`), así que geoman simula el arrastre con sus propios handlers
   de mouse (`_dragMixinOnMouseDown/Move/Up`). Al soltar
   (`_dragMixinOnMouseUp`, línea ~13117) se llama **tanto**
   `this._fireDragEnd()` (evento interno `pm:dragend`) **como**
   `this._fireEdit()` (evento público `pm:edit`) — el mismo evento que ya
   escuchaba el código para polígonos. Confirmado: arrastrar un
   `CircleMarker` en modo edición SÍ dispara `pm:edit`, por lo tanto SÍ
   llega a `onGeometryChange`.

**Conclusión: no existe un bug de delegación FeatureGroup→CircleMarker.**
El mecanismo funcionaba correctamente para ambos tipos de geometría antes
de este cambio.

## Cambio aplicado (no motivado por un bug, sino por lo pedido
explícitamente en el prompt + reducir dependencia de comportamiento
implícito)

En `components/gis/QcConsoleMap.jsx`, el efecto de `editingKey` ahora:

- Obtiene la referencia real del sublayer (`childLayer =
  layer.getLayers?.()[0]`) y llama `.pm.enable()` / `.pm.disable()`
  **directamente sobre ese sublayer**, no sobre el FeatureGroup wrapper.
  Efecto práctico idéntico (la delegación ya funcionaba), pero ya no
  depende de la lógica interna de `L.PM.Edit.LayerGroup` ni de la cadena de
  herencia de opciones por prototipo — las opciones de arrastre/snap se
  pasan explícitas (`{ draggable: true, snappable: true,
  allowSelfIntersection: false }`).
- El chequeo `isEditing` usa `childLayer.pm.enabled?.()` en vez de
  `layer.pm?.enabled?.()`, por consistencia con lo anterior.
- Los listeners `pm:edit` / `pm:markerdragend` se registran igual que
  antes, sobre `childLayer` (ya era así — los eventos siempre los dispara
  el sublayer, nunca el FeatureGroup).

## Invariantes (sin cambios respecto a specs previas)

- Solo UNA capa puede estar en modo edición de vértices a la vez
  (`editingKey`).
- Mapa WebGIS (`/dashboard/mapa`, `components/gis/MapDashboard.jsx`)
  permanece 100% de solo lectura — geoman no se importa ahí.
- Nada se persiste a la base desde el efecto de edición — solo actualiza un
  borrador en memoria (`onGeometryChange` → `geometryDraft` en
  `app/dashboard/qc/page.jsx`) hasta que el usuario aprieta "Guardar
  Cambios de Geometría" en `QcDetailEditor.jsx`.

## Criterios de aceptación

- Seleccionar un registro de polígono (p. ej. "P-0004 - El Mango") y
  activar "Ajustar Geometría" hace `flyTo` Y muestra vértices arrastrables.
- Seleccionar un registro de punto (`EUDR_INSTALACIONES`) y activar
  "Ajustar Geometría" permite arrastrar el marcador; al soltar,
  `onGeometryChange` recibe la nueva geometría.
- Cambiar de registro seleccionado mientras se edita desactiva la edición
  de la capa anterior (`childLayer.pm.disable()`).
