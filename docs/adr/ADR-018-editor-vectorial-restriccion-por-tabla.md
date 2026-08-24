# ADR-018 — El Editor Vectorial restringe sus botones de dibujo por tabla destino y prohíbe capas huérfanas

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-24
- **Código:** `app/dashboard/qc/components/VectorEditorTools.jsx`
  (`useVectorEditor` — nuevo efecto de restricción, nuevo parámetro
  `externalDrawDisabled`), `components/gis/QcConsoleMap.jsx` (pasa
  `externalDrawDisabled: !!editingKey` en vez de llamar
  `setButtonDisabled` directamente)
- **Tests:** `tests/test_qc_toolbar_edit_mutual_exclusion.mjs` (2 tests
  reescritos para reflejar la nueva arquitectura)

## El problema (investigación previa, solo-lectura, sin código)

Una investigación previa a esta tarea (sin cambios de código, solo
evidencia) confirmó 2 de los 4 hallazgos reportados sobre este editor:

1. **Un solo marcador esperado, pero se podía colocar más de uno**, sin
   forma de borrar los sobrantes desde la Consola QC (`removalMode: false`
   ahí — ver `enableGlobalEditControls` en `VectorEditorTools.jsx`).
2. **La restricción de geometría por tabla destino
   (`TARGET_TABLE_GEOMETRY_TYPES`) era puramente reactiva**: solo se
   evaluaba en `handleSave`, nunca antes — con "Uso de Suelo" seleccionado
   se podía dibujar un Point libremente, con el marcador ya puesto en el
   mapa, y recién al hacer clic en "Guardar" aparecía el error.

Esta tarea corrige ambos, de raíz — no con un parche puntual sobre cada
síntoma.

## La corrección

**Un solo efecto nuevo, un solo punto de verdad.** `useVectorEditor`
(`VectorEditorTools.jsx`) gana un `useEffect` que corre en cada cambio de
`targetTable`/`drawnLayer`/`externalDrawDisabled`/`mapReady`, y decide el
estado de CADA botón de dibujo combinando 3 razones (cualquiera alcanza
para deshabilitarlo):

```js
const DRAW_BUTTON_GEOMETRY_TYPES = { drawMarker: 'Point', drawPolygon: 'Polygon' }

useEffect(() => {
  const map = mapRef.current
  if (!mapReady || !map) return
  const allowedTypes = TARGET_TABLE_GEOMETRY_TYPES[targetTable] || []
  const hasUnresolvedDraft = !!drawnLayer
  Object.entries(DRAW_BUTTON_GEOMETRY_TYPES).forEach(([buttonName, geometryType]) => {
    const shouldDisable = externalDrawDisabled || hasUnresolvedDraft || !allowedTypes.includes(geometryType)
    try {
      map.pm.Toolbar.setButtonDisabled(buttonName, shouldDisable)
    } catch {
      // El botón todavía no existe (carrera de montaje/desmontaje) — nada que hacer.
    }
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [targetTable, drawnLayer, externalDrawDisabled, mapReady])
```

- **Razón 1 — tipo de geometría no permitido por la tabla destino**: con
  "Uso de Suelo" (`['Polygon']`) seleccionado, `drawMarker` queda
  deshabilitado ANTES de tocar el mapa, no solo al Guardar.
- **Razón 2 — `drawnLayer` sin resolver**: mientras exista un borrador ni
  guardado ni cancelado, **ambos** botones quedan deshabilitados sin
  importar su tipo — cierra de raíz el caso de "2 marcadores seguidos"
  (issue #1 original): no hay forma de empezar una geometría nueva hasta
  resolver la actual. `handleCancel` ya limpiaba correctamente el único
  borrador posible (`drawnLayer?.remove(); setDrawnLayer(null)`); con esta
  razón centralizada, el mismo cambio de estado que dispara la limpieza
  también re-habilita los botones automáticamente, sin código extra.
- **Razón 3 — `externalDrawDisabled`**: parámetro nuevo del hook, que
  reemplaza una llamada duplicada a `setButtonDisabled` que vivía en
  `QcConsoleMap.jsx` (ver más abajo).

**API real de geoman confirmada antes de escribir código** (no asumida):
`map.pm.Toolbar.getButtons()` devuelve `this.buttons`, keyed por el mismo
nombre pasado a `addControls` (`drawMarker`/`drawPolygon`); cada botón es
un `L.Control.PMButton` con `.disable()`/`.enable()` que setean
`_button.disabled` y aplican la clase CSS `pm-disabled`.
`_triggerClick()` — el handler real del click — hace
`if (this._button.disabled) return` antes de ejecutar `onClick`, así que
`.disable()` bloquea la interacción de verdad, no es solo cosmético. La
codebase ya tenía un helper de más alto nivel para esto,
`Toolbar.setButtonDisabled(name, state)` (`state=true` → `.disable()`,
`state=false` → `.enable()`), usado previamente en
`QcConsoleMap.jsx`/ADR-005 — se reutiliza ese mismo helper acá en vez de
introducir un segundo patrón.

## Por qué se centralizó en `useVectorEditor` en vez de agregar un segundo efecto en `QcConsoleMap.jsx`

Antes de esta tarea, `QcConsoleMap.jsx` YA tenía su propio efecto
(ADR-005) que llamaba `map.pm.Toolbar.setButtonDisabled('drawPolygon'/
'drawMarker', isAnyEditing)` para la exclusión mutua con el modo "Ajustar
Geometría" (`editingKey`). Agregar el nuevo efecto de restricción por
tabla como un efecto SEPARADO habría dejado 2 efectos independientes, en
2 archivos distintos, escribiendo al mismo par de botones — el orden de
ejecución entre ambos (determinado por el orden de declaración de hooks
dentro de `QcConsoleMap`, ya que `useVectorEditor` se invoca ahí) decide
cuál gana en cualquier render donde ambas condiciones cambian a la vez;
un cambio de `editingKey` podría re-habilitar un botón que la restricción
de tabla destino necesitaba mantener deshabilitado, o viceversa, según
quién corra último. Se optó por consolidar: `QcConsoleMap.jsx` ya no
llama `setButtonDisabled` en absoluto — le pasa `!!editingKey` a
`useVectorEditor` como `externalDrawDisabled`, y el único efecto que
decide el estado real de los botones vive en `VectorEditorTools.jsx`,
con las 3 razones combinadas en un solo lugar.

## Verificación en vivo (Consola QC real, `/dashboard/qc`, sin mocks)

Reproducido con clicks/eventos reales sobre el servidor `npm run dev`
levantado limpio (`taskkill node.exe` + `rm -rf .next` antes de arrancar):

1. **"Uso de Suelo" seleccionado → botón de marcador deshabilitado antes
   de tocar el mapa:** confirmado inspeccionando el DOM real —
   `drawMarker` con clase `pm-disabled` y `aria-disabled="true"`,
   `drawPolygon` sin esa clase. Un click programático real sobre el botón
   deshabilitado no produjo ningún efecto (`_triggerClick` lo bloquea).
2. **"Monitoreo EUDR" seleccionado, se dibuja un Point real (clicks
   físicos: botón de marcador → clic sobre el mapa) → ambos botones
   quedan `pm-disabled`:** confirmado en el DOM justo después de que
   `pm:create` disparó (`onFinalize` seteó `drawnLayer`). Un segundo click
   físico sobre el botón de polígono (ahora deshabilitado) no agregó
   ninguna capa nueva al mapa (conteo de `.leaflet-marker-icon` sin
   cambios) ni reinició una sesión de dibujo — el panel lateral se quedó
   mostrando el mismo borrador pendiente de Guardar/Cancelar.
3. **Clic real en "Cancelar":** el marcador dibujado se removió del mapa
   (conteo de `.leaflet-marker-icon` bajó de 2 a 1, quedando solo el
   registro pre-existente), y ambos botones volvieron a
   `leaflet-buttons-control-button` sin `pm-disabled` — sin capa huérfana
   remanente.

## Verificación no visual

- `npm run build`: compiló sin errores ni warnings nuevos.
- `node --test tests/*.mjs`: 504/504 (2 tests de
  `test_qc_toolbar_edit_mutual_exclusion.mjs` reescritos para la nueva
  arquitectura — ya no verifican la llamada directa a
  `setButtonDisabled` en `QcConsoleMap.jsx`, que se eliminó; en su lugar
  verifican `externalDrawDisabled: !!editingKey` ahí y la fórmula
  `shouldDisable` real en `VectorEditorTools.jsx`).
- `python -m pytest tests/ -v --tb=short`: 363 passed, 5 skipped (sin
  código Python tocado en esta tarea — ejecutado solo por convención de
  la sesión).

## Fuera de alcance de esta tarea (a propósito)

- **Puntos 2 (identidad de socio al crear un perímetro) y 3 original
  ("Tipo de Uso" texto libre)** de la investigación previa — ninguno de
  los dos se toca acá; ambos quedan pendientes de una decisión de diseño
  conjunta, tal como pidió la investigación original (el punto de
  identidad de socio, en particular, tiene más de un camino posible y
  choca con las restricciones ya conocidas de `ID_Parcela_Fija`/`ID_Socio`
  como PK global, no por organización — ver ADR-016).
- **Deshabilitar "Instalaciones"/`PADRON_PARCELAS`** — no aplica: la
  Consola QC nunca ofreció esas 2 tablas como destino
  (`QC_DRAWABLE_TABLES`), esto no cambia en esta tarea.
