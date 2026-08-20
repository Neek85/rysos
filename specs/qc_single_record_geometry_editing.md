# Spec — Edición de Geometría de un Registro en la Consola QC (refuerzo)

## Contexto y corrección de premisas (verificado antes de tocar código)

Este prompt describe un mecanismo que, en su mayor parte, **ya existe** —
construido en la Consola QC 2.0 (`specs/gis_qc_console_v2.md`) y no
tocado desde entonces:

- **`QcConsoleMap.jsx` ya activa `layer.pm.enable()` SOLO en la capa que
  coincide con `editingKey`** (nunca en las demás — `layer.pm?.disable()`
  para cualquier otra que quedara en edición). Nada que agregar en (a)/(c).
- **Los eventos ya se capturan y reportan a `onGeometryChange`:**
  `childLayer.on('pm:edit', report)` y
  `childLayer.on('pm:markerdragend', report)` (ambos existían ya). El
  prompt pide además escuchar `pm:vertexfadd` — **ese evento no existe en
  geoman** (confirmado por `grep` exhaustivo sobre
  `node_modules/@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.js`:
  los únicos eventos reales son `pm:edit`, `pm:markerdragend` y
  `pm:vertexadded`). `pm:vertexadded` tampoco aplica acá — es un evento de
  **dibujo** (fires mientras se agrega un vértice a una figura nueva en
  construcción, `e.workingLayer`), no de **edición** de una capa ya
  existente; ya se usa correctamente en `attachVectorEditor`
  (`VectorEditorTools.jsx`) para el flujo de "crear desde cero", un
  mecanismo distinto y ya separado del de edición.
- **`QcDetailEditor.jsx` ya tiene el indicador visual y el botón** —
  toggle "✏️ Ajustar Geometría" (resaltado ámbar mientras está activo) +
  botón que aparece solo cuando hay un borrador (`geometryDraft`). Se
  renombra el botón a "Guardar Cambios de Geometría" (antes "Guardar
  Geometría") para alinear con el texto exacto del prompt — cosmético,
  sin cambio de comportamiento.
- **Multi-tenant, solo lectura de Mapa, cero PII en logs — ya verificados
  y siguen cumpliéndose**, confirmado de nuevo por grep antes de tocar
  código: `updateRecordGeometry` (`lib/eudrQcActions.js`) ya llama
  `assertSameOrganization`; `MapDashboard.jsx` sigue sin ninguna
  referencia a geoman (reorganización de la tarea anterior); cero
  `console.log` en los archivos del módulo.

## Lo único genuinamente nuevo: re-validación automática al guardar

Guardar una geometría nueva (`handleSaveGeometry`, `page.jsx`) actualiza
`records` pero **no** invalidaba ni refrescaba
`validationResults[record.key]` — cualquier badge de "Ejecutar Test
Espacial" ya calculado (topología/solapamiento/área) quedaba mostrando el
resultado de la geometría VIEJA. Se agrega: tras un
`updateRecordGeometry` exitoso, `handleSaveGeometry` llama a
`handleValidateTopology(selectedRecord)` (sin esperar — no bloquea el
toast de éxito), excepto para `EUDR_INSTALACIONES` (el endpoint la
rechaza igual, siempre puntual — mismo guard `canValidateTopology` que ya
usa el botón).

## Criterios de aceptación

- AC1: Guardar una geometría dispara automáticamente una nueva llamada a
  `/api/qc/validate-spatial` para ese registro (excepto
  `EUDR_INSTALACIONES`).
- AC2: Ningún archivo del módulo QC referencia `pm:vertexfadd`.
- AC3: El mecanismo de aislamiento por registro (`editingKey`) sigue
  editando UNA sola capa a la vez.
- AC4: `npm run build` compila sin errores.
