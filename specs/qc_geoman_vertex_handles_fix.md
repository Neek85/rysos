# Spec — Activación de vértices editables (Geoman), cuarto prompt sobre el mismo mecanismo

## Contexto

Cuarto prompt consecutivo pidiendo "corregir de forma definitiva" la
activación de vértices editables en `/dashboard/qc`. Los tres anteriores
(`specs/gis_qc_console_v2.md`, `specs/qc_single_record_geometry_editing.md`,
`specs/qc_geoman_layer_binding_fix.md` — este último con un rastreo línea
por línea del bundle instalado de `@geoman-io/leaflet-geoman-free`) ya
habían confirmado que el mecanismo es correcto, tanto para geometrías
Polygon como Point (`L.CircleMarker`).

## Corrección de premisa

El prompt indica modificar `app/dashboard/qc/components/QcConsoleMap.jsx`
— **ese archivo no existe**. El componente real vive en
`components/gis/QcConsoleMap.jsx` (confirmado: `ls
app/dashboard/qc/components/` solo lista `CargaEspacialModal.jsx`,
`QcDetailEditor.jsx`, `QcTable.jsx`, `VectorEditorTools.jsx`; `page.jsx`
importa `QcConsoleMap` desde `@/components/gis/QcConsoleMap`). Se aplicó el
cambio ahí.

## Qué pedía el prompt vs. qué ya existía (desde el commit anterior, `ebd5707`)

| Pedido | Estado antes de esta tarea |
|---|---|
| Localizar la capa del registro seleccionado e iterar `.getLayers()` sobre sus hijos | Ya existía: `const childLayer = layer.getLayers?.()[0]` |
| Llamar `subLayer.pm.enable({ allowSelfIntersection: false, draggable: true })` directamente sobre la sub-capa real | Ya existía: `childLayer.pm.enable({ draggable: true, snappable: true, allowSelfIntersection: false })` |
| Deshabilitar `.pm` en las sub-capas de todos los demás registros | Ya existía: `childLayer.pm.disable()` en el `else` |
| Escuchar `pm:edit` sobre la sub-capa activa | Ya existía |
| Escuchar `pm:dragend` sobre la sub-capa activa | **Nuevo en esta tarea** (antes solo `pm:markerdragend`) |

La única pieza genuinamente nueva es el listener de `pm:dragend`. Se agregó
tal cual lo pide el prompt, aunque la investigación de la tarea anterior ya
había determinado que es redundante para los dos tipos de capa reales que
usa este componente:

- **Point (`L.CircleMarker`, vía `pointToLayer`)**: el módulo dedicado
  `L.PM.Edit.CircleMarker` usa el mixin de arrastre genérico de geoman
  (`enableLayerDrag`/`_dragMixinOnMouseUp`, ver
  `specs/qc_geoman_layer_binding_fix.md`), que dispara **tanto**
  `pm:dragend` **como** `pm:edit` al soltar. Escuchar `pm:dragend` acá no
  rompe nada — simplemente llama `onGeometryChange` una segunda vez con la
  misma geometría final (ya estable en ese punto), lo cual es inofensivo
  porque solo actualiza un draft en memoria (`geometryDraft` en
  `page.jsx`), no escribe a la base.
- **Polygon (`L.Polygon`, vía `L.geoJSON`)**: la edición de vértices dispara
  `pm:edit` directamente sobre la capa y `pm:markerdragend` sobre el
  marcador auxiliar de cada vértice — `pm:dragend` en el `L.Polygon` mismo
  corresponde a arrastrar la FORMA completa (modo "Drag", no habilitado en
  este componente), así que en la práctica no dispara. El listener queda
  como no-op inofensivo, no como una corrección real de un bug.

No se cambió la estrategia de tomar solo `layer.getLayers()[0]` (en vez de
iterar todos los hijos): cada capa de `layersByKeyRef` se construye con
`L.geoJSON({ type: 'Feature', geometry, properties: record }, ...)` — una
sola Feature por construcción, por lo tanto un solo hijo real (el
`L.Polygon`/`L.CircleMarker` de esa Feature). Iterar más allá de `[0]`
no tendría ningún hijo adicional que recorrer con los datos reales de este
proyecto.

## Verificación en vivo

Confirmado en `/dashboard/qc`: seleccionar "P-00001 — El Lache" (polígono
real) + "✏️ Ajustar Geometría" muestra los marcadores de vértice
directamente sobre el contorno del polígono, sin errores de consola
(ver captura de la tarea anterior, mismo componente, mismo mecanismo, solo
se agregó un listener adicional). Mapa WebGIS (`components/gis/MapDashboard.jsx`)
sigue sin geoman — solo lectura, sin cambios.

## docs/schema_live.md

Revisado — esta tarea es puramente de frontend (interacción con la capa
Leaflet en el cliente), no toca ninguna tabla ni columna. No aplica ningún
cambio de esquema.
