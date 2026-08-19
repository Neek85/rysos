# Spec — Consola QC 2.0: Edición de Geometría, Corrección de Atributos (`/dashboard/qc`)

## Contexto y corrección de premisas (verificado contra el repo antes de diseñar)

Un prompt `[PROMPT PARA CLAUDE]` pidió "implementar la Consola QC 2.0" con un
tono de construcción desde cero. Verificado antes de escribir código: **la
Consola QC ya existe y funciona** (Fase 3, `specs/fase3_consola_qc_webgis.md`,
`lib/eudrQcActions.js`, `app/dashboard/qc/page.jsx`,
`components/gis/QcConsoleMap.jsx`, 13 tests en `tests/test_eudr_qc_actions.mjs`)
— esta tarea es una **extensión**, no una implementación desde cero, y varias
premisas del prompt ya estaban resueltas o eran incorrectas:

- **No existe un estado `OBSERVADO`.** Los 3 estados reales de
  `estado_revision` son `PENDIENTE`/`APROBADO`/`RECHAZADO` (confirmado en
  `supabase/migrations/20260816_fase2_vistas_qc.sql` y en el propio
  `lib/eudrQcActions.js`, ya implementado). "Rechazar con nota técnica
  obligatoria" **ya existe**: `rejectRecord()` exige un `motivo` no vacío y lo
  anexa a `observaciones` con el sufijo `[RECHAZADO QC: <motivo>]` — mismo
  formato que usa `scripts/qgis_qc_actions.py` para que ambos flujos de
  auditoría (QGIS Desktop y WebGIS) queden consistentes. No se agrega un
  cuarto estado nuevo.
- **No existe una columna `descripcion`** en ninguna de las 3 tablas
  EUDR\_\* (`grep` exhaustivo sobre `docs/schema_live.md`, cero resultados).
  El campo real de texto libre es `observaciones`, y solo existe en
  `EUDR_MONITOREO` — `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` no tienen ningún
  campo de texto libre editable. Ver "Campos editables reales" abajo.
- **"Aprobado pasa automáticamente a `vw_monitoreo_web`" ya es cierto
  estructuralmente** — esa vista filtra `estado_revision = 'APROBADO'` en su
  propia definición (`supabase/migrations/20260818_fix_views_eudr_flags.sql`);
  `approveRecord()` solo necesita actualizar `estado_revision`, nada más.
  Ningún cambio necesario acá.
- **La validación multi-tenant estricta + error explícito en 0 filas
  afectadas YA está implementada** en `approveRecord`/`rejectRecord`
  (`assertSameOrganization` + `.match({ ...pk, ID_Organizacion, estado_revision: 'PENDIENTE' })`
  + chequeo de `data.length === 0`). Las dos funciones nuevas de esta tarea
  (`updateRecordAttributes`/`updateRecordGeometry`) reutilizan exactamente el
  mismo patrón — no una implementación paralela.
- **El `flyTo` al seleccionar un registro YA EXISTE**
  (`QcConsoleMap.jsx`, `map.flyTo(target, ...)` en el efecto de
  `selectedKey`) — lo que pedía el prompt como "centrar con `flyTo` sobre el
  centroide (`ST_Centroid`)" ya ocurre, salvo que el punto usado hoy es
  `layer.getBounds().getCenter()` (centro del rectángulo envolvente), no el
  centroide geométrico real. Para un polígono cóncavo o en forma de L esos
  dos puntos pueden diferir notablemente (el centro del bounding box puede
  caer fuera del polígono). **Mejora real de esta tarea:** se reemplaza por
  `@turf/centroid` (misma familia de dependencias que `@turf/area`/
  `@turf/kinks`, ya instaladas en la tarea del Editor Vectorial), que sí
  calcula un centroide geométrico verdadero — más cercano en intención a
  `ST_Centroid` de PostGIS (aunque el cálculo real sigue siendo client-side
  sobre el GeoJSON ya cargado, no una llamada a la función PostGIS).

## Campos editables reales (reemplaza la lista inventada del prompt)

`ID_Socio, parcela_codigo, tipo_uso, tipo_infra, descripcion` del prompt no
corresponde a ninguna tabla real tal cual — `parcela_codigo` vive en
`PADRON_PARCELAS` (no en las 3 tablas EUDR\_\*, que solo guardan la
referencia `ID_Parcela_Fija`/`id_parcela`) y `descripcion` no existe. Campos
reales editables por `tabla_origen` (`lib/eudrQcActions.js::EDITABLE_FIELDS`):

- `EUDR_MONITOREO`: `ID_Socio`, `ID_Parcela_Fija`, `observaciones`.
- `EUDR_USO_SUELO`: `id_parcela`, `tipo_uso`.
- `EUDR_INSTALACIONES`: `id_parcela`, `tipo_infra`.

`ID_Organizacion`/`estado_revision`/PK nunca son editables desde este
formulario — el whitelisting por tabla en `updateRecordAttributes` es
explícito (nunca un `Object.assign` genérico del payload del cliente).

## Edición de geometría (vértices)

Reutiliza `@geoman-io/leaflet-geoman-free` (ya usado en
`app/dashboard/mapa/components/VectorEditorTools.jsx` para dibujar capas
nuevas) — acá en modo **edición de una geometría ya existente**, no dibujo
desde cero: al activar "Ajustar Geometría" para el registro seleccionado,
`QcConsoleMap.jsx` llama `layer.pm.enable({ allowSelfIntersection: false })`
sobre esa capa puntual (nunca sobre todas a la vez). Los eventos
`pm:edit`/`pm:markerdragend` de esa capa reportan la geometría GeoJSON
actualizada hacia `QcDetailEditor`, que la mantiene en un estado "borrador"
hasta que el usuario confirma "Guardar Geometría" — nada se escribe a la
base mientras se arrastra un vértice.

`updateRecordGeometry` (`lib/eudrQcActions.js`) convierte el GeoJSON a WKT
(`geoJsonToWkt`, `lib/geometryImport.js`, ya existente) e inserta en la
columna de geometría real de la tabla — **`geom_inspeccion` para
`EUDR_MONITOREO`, `geom` para `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`**
(nombres de columna distintos, confirmado en `docs/schema_live.md`) —
**sin llamar a `fn_sanitize_geometry` ni calcular área a mano**: el trigger
`trg_gis_sanitize_eudr_*` ya existente (ADR-001) sanitiza y recalcula
`area_calculada_ha`/`requiere_revision_area` automáticamente al recibir el
UPDATE sobre esa columna — mismo criterio ya aplicado en
`lib/actions/gisActions.js` para el Ingestor de Capas Espaciales, no se
duplica esa lógica una tercera vez.

## Guardas de la corrección (atributos y geometría)

Ambas funciones nuevas exigen `estado_revision = 'PENDIENTE'` en el
`.match()` del UPDATE, igual que `approveRecord`/`rejectRecord` — no tiene
sentido corregir un registro ya `APROBADO`/`RECHAZADO` desde esta consola
(un registro aprobado que necesite corrección debe pasar por un flujo de
reversión aparte, fuera de alcance de esta tarea). 0 filas afectadas
lanza `EUDRQcError` con el mismo mensaje que ya usan approve/reject
("recargá la consola"), por consistencia.

## Alcance de la interfaz

`app/dashboard/qc/components/QcDetailEditor.jsx` (nuevo) reemplaza el panel
de detalle que hoy vive inline en `page.jsx`: formulario de atributos reales
por tabla, botón "✏️ Ajustar Geometría" (activa el modo edición de vértices
en el mapa para ese registro), botón "Guardar Cambios" (persiste atributos
+ geometría si hay un borrador pendiente), y los botones Aprobar/Rechazar ya
existentes (sin cambios de comportamiento, solo reubicados). Corregir
atributos o geometría no saca el registro de la lista de pendientes — solo
Aprobar/Rechazar lo hacen (mismo comportamiento ya implementado).

## Fuera de alcance de esta tarea

- Un cuarto estado `OBSERVADO` (no existe precedente ni necesidad real —
  `RECHAZADO` con motivo ya cubre "requiere corrección").
- Deshacer una aprobación/rechazo ya confirmado (reversión de estado).
- Edición de geometría para el gap ya documentado de `EUDR_INSTALACIONES`
  sin `id_origen` (`resolveUpdateTarget` ya lo rechaza explícitamente antes
  de llegar a `updateRecordGeometry`/`updateRecordAttributes`, mismo guard
  reutilizado).

## Criterios de aceptación

- AC1: `updateRecordAttributes` solo escribe los campos de
  `EDITABLE_FIELDS[tabla_origen]` — un campo fuera de esa lista en el
  payload del cliente se ignora, nunca se escribe.
- AC2: `updateRecordAttributes`/`updateRecordGeometry` rechazan un registro
  que no está en `PENDIENTE`, o que no pertenece a la organización activa,
  con `EUDRQcError` y cero filas escritas.
- AC3: `updateRecordGeometry` escribe en `geom_inspeccion` para
  `EUDR_MONITOREO` y en `geom` para las otras dos tablas.
- AC4: El centroide usado para `flyTo` es el resultado real de
  `@turf/centroid` sobre la geometría del registro, no
  `getBounds().getCenter()`.
- AC5: `npm run build` compila sin errores.
