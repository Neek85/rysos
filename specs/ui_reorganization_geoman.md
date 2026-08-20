# Spec — Reorganización del Editor Vectorial (Geoman): QC = crear+editar, Mapa = solo lectura

## Contexto

Cierra el punto explícitamente dejado pendiente en
`specs/gis_qc_rearchitecture.md`: mover el Editor Vectorial de
`/dashboard/mapa` a `/dashboard/qc` — en esa tarea se decidió NO hacerlo
todavía por el riesgo real de combinar 2 usos distintos de geoman en el
mismo mapa sin probarlo. Este prompt confirma la dirección
("tras la discusión de arquitectura") y pide implementarlo — se procede,
con el cuidado técnico ya identificado entonces.

## Riesgo real identificado y cómo se resolvió

`QcConsoleMap.jsx` ya usaba geoman de una forma (edición de vértices de
UN registro seleccionado, `layer.pm.enable()` sobre esa sola capa,
controlado por `editingKey`). El Editor Vectorial de Mapa usa geoman de
OTRA forma (`map.pm.addControls({..., editMode: true, dragMode: true,
removalMode: true})`, un toolbar global). El modo "Editar" GLOBAL de
geoman (`map.pm.enableGlobalEditMode()`, el botón que agrega
`editMode: true`) habilita vértices en **TODAS** las capas editables del
mapa a la vez — si conviviera con el mecanismo de `editingKey` (que
depende de que SOLO una capa esté en modo edición), un click accidental
en ese botón global rompería la invariante central de la Consola QC
("nunca más de un registro en edición a la vez").

**Solución:** `attachVectorEditor`/`useVectorEditor` (movidos a
`app/dashboard/qc/components/VectorEditorTools.jsx`) ganan un parámetro
nuevo `enableGlobalEditControls` (default `true`, para no romper otro
futuro consumidor) — `QcConsoleMap.jsx` lo pasa en `false`: el toolbar de
geoman en la Consola QC muestra SOLO los botones de dibujo (Polígono/
Marcador), nunca los de Editar/Arrastrar/Eliminar globales. Confirmado
por lectura de la arquitectura de eventos de geoman que esto es seguro:
`pm:vertexadded`/`pm:create` (dibujo, escuchados a nivel `map`) y
`pm:edit`/`pm:markerdragend` (edición de una capa específica, escuchados
en esa capa) son dos flujos de eventos separados en geoman — no chocan
entre sí mientras el toolbar global de edición no esté presente.

## Cambios

1. **`components/gis/MapDashboard.jsx`**: se remueve por completo
   `useVectorEditor`/`VectorEditorPanel`, el import de
   `@geoman-io/leaflet-geoman-free` (ya no tiene ningún propósito ahí sin
   el editor), el estado `mapReady` (solo existía para gatear el panel), y
   el layout `flex lg:flex-row` que le daba espacio al panel lateral — el
   mapa vuelve a ocupar el ancho completo. Filtros de capa, métricas
   (`EudrStatsWidget`, ver `app/dashboard/mapa/page.jsx`) y el exportador
   DDS quedan intactos, sin tocar.
2. **`app/dashboard/qc/components/VectorEditorTools.jsx`** (reubicado
   desde `app/dashboard/mapa/components/`, que queda vacío/eliminado):
   `useVectorEditor` gana `targetTables` (subconjunto configurable de
   `GIS_TARGET_TABLES`, default el completo) y `enableGlobalEditControls`;
   `onSaved(targetTable)` nuevo (antes no había forma de que el caller se
   enterara de un guardado exitoso). `VectorEditorPanel` itera
   `editor.targetTables` en vez de la constante global.
3. **`components/gis/QcConsoleMap.jsx`**: engancha
   `useVectorEditor({..., targetTables: ['EUDR_MONITOREO','EUDR_USO_SUELO'],
   enableGlobalEditControls: false, onSaved: onFeatureCreated})` — nunca
   `EUDR_INSTALACIONES`/`PADRON_PARCELAS` desde acá (pedido explícito del
   prompt). Nuevas props `organizationId`/`onFeatureCreated`. Renderiza
   `<VectorEditorPanel>` junto al mapa (mismo layout que tenía Mapa antes).
4. **`app/dashboard/qc/page.jsx`**: pasa `organizationId={resolveOrganizationId(records)}`
   (mismo heurístico ya usado en el resto del módulo — limitación conocida
   y ya documentada: sin ningún registro PENDIENTE cargado, no hay forma
   de resolver la organización activa para una geometría nueva) y
   `onFeatureCreated={loadPending}` (refresca la lista — el registro
   recién creado queda `PENDIENTE`, visible de inmediato en la misma
   consola).

## Verificado, no una premisa falsa esta vez

- **z-index:** `VectorEditorPanel` es un panel en flujo normal
  (`flex lg:flex-row`, sin `position:fixed/absolute`) — mismo layout no
  problemático que ya tenía en Mapa, y `CargaEspacialModal.jsx` (el único
  overlay real de la Consola QC) ya tiene su z-index corregido
  (`specs/gis_mapa_dashboard_polish_v2.md`). Nada que ajustar.
- **PII en logs:** cero `console.log` en los 4 archivos tocados
  (verificado por grep antes y después, y por test).

## Sin test de render (Jest/Testing Library no instalado)

`tests/test_ui_reorganization.mjs` certifica la ausencia/presencia real
mediante inspección del código fuente (imports, constantes, props) — no
un render de DOM real. Documentado explícitamente como una limitación
conocida del proyecto, no una prueba "falsa".

## Criterios de aceptación

- AC1: `MapDashboard.jsx` no importa `@geoman-io/leaflet-geoman-free` ni
  `VectorEditorPanel`/`useVectorEditor`.
- AC2: El Editor Vectorial de la Consola QC nunca ofrece
  `EUDR_INSTALACIONES`/`PADRON_PARCELAS` como tabla destino.
- AC3: `enableGlobalEditControls: false` en la llamada de `QcConsoleMap.jsx`.
- AC4: `npm run build` compila sin errores.
