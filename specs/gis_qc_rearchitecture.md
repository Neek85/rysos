# Spec — Reorganización GIS & EUDR: ingesta en QC, Mapa como visor de solo lectura

## Contexto y corrección de premisas (verificado contra el repo antes de diseñar)

- **Rutas de archivo incorrectas** (mismo patrón repetido varias veces en
  esta sesión): `app/dashboard/qc/components/QcConsoleMap.jsx` y
  `app/dashboard/mapa/components/MapDashboard.jsx` no existen — los
  componentes reales viven en `components/gis/QcConsoleMap.jsx` y
  `components/gis/MapDashboard.jsx` (compartidos entre secciones, no
  anidados bajo una sola página).
- **"`vw_monitoreo_web` ya filtra estrictamente `APROBADO`" y "aislado por
  `ID_Organizacion`" — ya estaban implementados**, no es trabajo nuevo:
  la vista filtra `estado_revision = 'APROBADO'` desde su diseño original
  (Tarea 8.1), y `MapDashboard.jsx` ya resuelve la organización activa en
  un fetch previo y filtra la consulta completa por ella
  (`specs/gis_mapa_dashboard_polish.md`, tarea de ayer). Nada que cambiar
  en la consulta espacial en sí.
- **"Preserva el visor de evidencia fotográfica (`DCIM/`) en la Consola
  QC" es una premisa falsa** — no existía ningún visor de fotos en
  `QcDetailEditor.jsx`/`QcConsoleMap.jsx` (confirmado por `grep`, cero
  referencias a `evidencia_foto`/Storage/`createSignedUrl`). Es una
  adición nueva, no una preservación — se construye acá, reusando el mismo
  patrón (`createSignedUrl`, bucket `evidencias_eudr`) que ya usaba
  `MapDashboard.jsx::loadPhoto`.
- **El pedido de "commit y push a main"** — este prompt es el primero en
  toda la sesión que pide `push` explícitamente. Se commitea igual que
  siempre, pero **no se hace push sin confirmación directa del usuario en
  el chat** — es una acción sobre el repositorio remoto compartido, un
  prompt automatizado no puede pre-autorizarla por su cuenta.

## Decisión: el Editor Vectorial (dibujar geometría nueva) NO se toca

El prompt pide que Mapa quede "dejando activos ÚNICAMENTE" 4 controles
(filtros de capa, leyenda, métricas, exportador DDS) — no incluye el
Editor Vectorial (`VectorEditorPanel`/`useVectorEditor`, dibuja Polígonos/
Puntos nuevos directo sobre el mapa satelital). Por la letra estricta del
prompt, ese control también debería salir de un "visor de solo lectura".

**Se decidió NO moverlo ni quitarlo en esta tarea.** Motivo: a diferencia
de `CargaEspacialModal`/`DriveSyncButton` (botones autocontenidos, fáciles
de reubicar), el Editor Vectorial está profundamente acoplado a la
instancia de Leaflet de `MapDashboard.jsx` (`mapRef`/`leafletRef` propios,
`attachVectorEditor` registra un toolbar de dibujo vía `map.pm.addControls`).
`QcConsoleMap.jsx` usa geoman de una forma DISTINTA (`layer.pm.enable()`
sobre una sola capa seleccionada, para ajustar vértices de un registro
PENDIENTE existente — nunca `addControls` para dibujar desde cero). Mover
el Editor Vectorial a la Consola QC significaría: exponer
`mapRef`/`leafletRef`/`mapReady` desde `QcConsoleMap.jsx` a su padre (hoy
privados), y hacer convivir un toolbar de dibujo global con el modo de
edición de vértices de un registro específico en el mismo `map.pm` — dos
usos de geoman con estado potencialmentemente conflictivo, nunca antes
combinados en este proyecto. Es un cambio real, pero de una magnitud y
riesgo distintos a "mover 2 botones" — se deja documentado como pendiente
en vez de improvisar una integración no probada. `/dashboard/mapa` queda
"mayormente" de solo lectura (ingesta por archivo/Drive removida) pero
conserva la capacidad de dibujar geometría nueva directo en el mapa —
riesgo aceptado conscientemente, a revisar en una tarea dedicada si se
quiere cerrar del todo.

## Cambios

1. **`app/dashboard/qc/components/CargaEspacialModal.jsx`** (reubicado
   desde `app/dashboard/mapa/components/`, ya no existe ahí): mismo
   componente, copy actualizado ("aparecen en la lista de esta consola"
   en vez de "no aparecerán en el mapa hasta ser aprobados", que ya no
   aplica porque el mapa nunca mostró PENDIENTE).
2. **`app/dashboard/qc/page.jsx`**: botón "📤 Cargar Capa Espacial" +
   estado `showUpload` + `handleSpatialUploaded` (cierra el modal, toast,
   `loadPending()` para refrescar la lista) — mismo patrón que
   `DriveSyncButton` ya tenía ahí. `organizationId` se resuelve con
   `resolveOrganizationId(records)`, ya importado.
3. **`app/dashboard/qc/components/QcDetailEditor.jsx`**: visor de
   evidencia fotográfica nuevo — `useEffect` firma la URL cuando
   `record.evidencia_foto` existe (mismo bucket/TTL que
   `MapDashboard.jsx::loadPhoto`), `<img>` dentro de una sección propia
   antes del formulario de atributos.
4. **`components/gis/MapDashboard.jsx`**: se remueven `CargaEspacialModal`,
   `DriveSyncButton`, el botón "Cargar Capa Espacial", los estados
   `showUpload`/`uploadToast` y `handleSpatialUploaded` — código muerto
   tras la reubicación. `fetchRecords` se mantiene extraído del efecto de
   montaje (documentado que hoy solo se llama una vez; el caller que la
   reinvocaba — el botón de sync — ya no vive acá).
5. **`app/dashboard/mapa/page.jsx`**: copy del subtítulo actualizado
   ("Visor de solo lectura · ...").
6. **`lib/gisTargetTables.js`**: comentario de cabecera actualizado (ya
   no referencia la ruta vieja de `CargaEspacialModal.jsx`).

## Seguridad y rendimiento (paso 4 del prompt)

- **PII en logs de consola:** cero `console.log` en
  `components/gis/`/`app/dashboard/qc/` (verificado por `grep` antes y
  después de esta tarea) — nada que corregir.
- **PII en exportaciones:** `lib/eudrDdsExporter.js::buildTracesPayload`
  usa `boundary.productor` (el valor crudo — `ID_Socio` o texto libre),
  **nunca** `productor_nombre` (el nombre real resuelto vía
  `PADRON_SOCIOS.socio_nombre_completo`, agregado a `vw_monitoreo_web` en
  una tarea anterior) — confirmado que no cambió y no debería cambiar: el
  documento DDS TRACES UE no necesita el nombre completo del socio para
  cumplir su función, y exportarlo ahí sería una superficie de PII nueva
  sin necesidad real.
- **z-index:** ya corregido en `specs/gis_mapa_dashboard_polish_v2.md`
  (`z-[9999]` en el overlay de `CargaEspacialModal.jsx`) — el fix viaja
  con el componente al moverse de carpeta, sin cambios necesarios.
  `QcConsoleMap.jsx` no tiene ningún modal propio con este problema.

## Sin test de integración nuevo

El prompt pedía `tests/test_gis_qc_rearchitecture.mjs` para validar "que
`/dashboard/mapa` filtre únicamente registros aprobados" y "que los
endpoints de ingesta respondan en `/dashboard/qc`". Ninguno de los dos es
lógica JS nueva de esta tarea:
- El filtro a `APROBADO` vive en la definición SQL de `vw_monitoreo_web`
  (ya cubierto conceptualmente por las migraciones y por
  `docs/schema_live.md`, no por código JS) — no cambió en esta tarea.
- Los "endpoints de ingesta" (`/api/gis/sync-drive`, Server Actions de
  `lib/actions/gisActions.js`) tampoco cambiaron — solo se reubicó el
  botón/modal que los invoca. Ya tienen su propia cobertura
  (`tests/test_drive_sync_trigger.mjs`, Server Actions probadas
  indirectamente vía `tests/test_gis_parser.mjs`/`test_gis_editor.mjs`).

Esta reorganización es 100% relocación de componentes JSX + wiring de
props ya existentes — sin lógica pura nueva que amerite su propio archivo
de test (mismo criterio ya aplicado en `specs/gis_mapa_dashboard_polish_v2.md`/`_v3.md`).

## Criterios de aceptación

- AC1: `/dashboard/mapa` no importa ni renderiza `CargaEspacialModal` ni
  `DriveSyncButton`.
- AC2: `/dashboard/qc` renderiza ambos, con `onUploaded`/`onSynced`
  refrescando `loadPending()`.
- AC3: `npm run build` compila sin errores.
