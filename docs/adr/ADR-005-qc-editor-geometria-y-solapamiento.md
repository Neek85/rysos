# ADR-005 — Editor Vectorial de QC: 2 bugs reales, y solapamiento auditable visualmente

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Migraciones:** ninguna nueva — `fn_validar_topologia_eudr`
  (`supabase/migrations/20260820_fn_validar_topologia_eudr.sql`) ya estaba
  correcta en los 3 puntos investigados (ver abajo), confirmada aplicada en
  la instancia real como precondición de esta tarea.
- **Spec:** `specs/consola_qc_layout_y_validacion.md` (addendum
  "Solapamiento auditable")
- **Tests:** `tests/test_qc_editor_bugs_and_solapamiento.mjs`,
  `tests/test_eudr_qc_actions.mjs` (3 tests nuevos de
  `fetchComparisonGeometries`)

## Precondición verificada antes de empezar

Reproducido en vivo (`curl` contra `/api/qc/validate-spatial` y contra
`vw_monitoreo_puntos` con la anon key): `fn_validar_topologia_eudr` y
`20260819_fix_vw_monitoreo_puntos_id_origen.sql` **ya están aplicadas** en
la instancia real (a diferencia de la tarea anterior, donde `fn_validar_topologia_eudr`
todavía no se había aplicado manualmente en Supabase Studio). Se procedió
con la Fase 1.

## Bug 1 — Popup permanente con nombre crudo de tabla (CONFIRMADO)

`components/gis/QcConsoleMap.jsx`, efecto de renderizado:

```js
layer.bindPopup(
  `<strong>${record.tabla_origen}</strong><br/>${record.clasificacion || 'Sin clasificar'}`
)
```

y en el efecto de `selectedKey`: `selectedLayer.openPopup?.()`.

Confirmado en vivo en el navegador antes de tocar código: seleccionar un
registro de Instalaciones mostraba un popup con el texto literal
"EUDR_INSTALACIONES" sobre el mapa. El panel derecho
(`QcDetailEditor.jsx`, sección "Corregir atributos") ya muestra el mismo
dato con la etiqueta legible (`LAYER_LABELS['EUDR_INSTALACIONES'] =
'Instalaciones'`) — el popup no aportaba nada que el panel no mostrara ya,
así que se eliminó (`bindPopup`/`openPopup`) sin reemplazo.

## Bug 2 — "Editor de puntos abre modo polígono" (NO REPRODUCIDO)

Investigado a fondo antes de tocar código, en 2 niveles:

1. **Lectura de código:** el efecto de `editingKey` llama
   `childLayer.pm.enable(...)` directamente sobre la sub-capa real
   (`layer.getLayers()[0]`) — para un registro Point esa sub-capa es un
   `L.CircleMarker` (vía `pointToLayer`), que activa el módulo dedicado
   `L.PM.Edit.CircleMarker` de geoman (confirmado en
   `specs/qc_geoman_layer_binding_fix.md`, tarea anterior) — un módulo sin
   concepto de "cadena de vértices" ni "Finalizar"/"Eliminar último
   vértice" (esos textos son tooltips del modo DIBUJO de geoman —
   `L.PM.Draw.Polygon`/`Line` — no del modo edición de una capa
   existente, confirmado grep-eando el bundle instalado).
2. **Verificación en vivo:** se seleccionó un registro real de
   Instalaciones (Point), se activó "Ajustar Geometría", y se inspeccionó
   el DOM real con `javascript_tool`:
   ```json
   { "pathClasses": ["leaflet-interactive leaflet-pm-draggable", "leaflet-interactive", "leaflet-interactive"] }
   ```
   Un solo elemento con la clase `leaflet-pm-draggable` (el marcador
   editado) y **cero** `.leaflet-marker-icon`/`.leaflet-editing-icon` en
   el DOM (`document.querySelectorAll(...).length === 0`) — sin cadena de
   vértices, sin modo polígono.

**Conclusión: el bug tal como está descrito no existe en el código
actual.** Ver `[[feedback_prompt_verification]]` (memoria de sesión) — es
el 4º/5º hallazgo de este tipo en esta línea de trabajo sobre el mismo
mecanismo de edición.

Se hizo igual una mejora real y de bajo riesgo, alineada con el principio
que el propio prompt pide ("fuente de verdad: el campo de geometría real,
nunca el nombre de tabla"): `QcDetailEditor.jsx` ahora deriva
`isPointRecord` de `record.geom?.type === 'Point'` (la geometría real) en
vez de no diferenciar el texto de ayuda — antes decía genéricamente
"Arrastrá los vértices (o el marcador)"; ahora dice "Arrastrá el
marcador" o "Arrastrá los vértices" según corresponda. Relevante porque
un `EUDR_MONITOREO` puede ser Point si el técnico QField lo capturó así
(`ST_Dimension()` en la propia `fn_validar_topologia_eudr` ya contempla
este caso) — inferir por `tabla_origen === 'EUDR_INSTALACIONES'` habría
sido incorrecto para esos registros.

## Investigación 4 — Mecanismo de "Solapado X%"

La función real es `fn_validar_topologia_eudr`
(`supabase/migrations/20260820_fn_validar_topologia_eudr.sql`), invocada
desde `app/api/qc/validate-spatial/route.js` (Service Role Key). El
código real de la sección de solapamiento (ya existente, sin cambios):

```sql
WITH candidatos AS (
    SELECT 'EUDR_MONITOREO'::text AS tabla_origen, id_monitoreo::text AS registro_id, geom_inspeccion AS geom
    FROM public."EUDR_MONITOREO"
    WHERE "ID_Organizacion" = v_org
      AND estado_revision = 'APROBADO'
      AND ST_Dimension(geom_inspeccion) = 2
      AND NOT (p_tabla_origen = 'EUDR_MONITOREO' AND id_monitoreo::text = p_registro_id)
    UNION ALL
    SELECT 'EUDR_USO_SUELO'::text, id::text, geom
    FROM public."EUDR_USO_SUELO"
    WHERE "ID_Organizacion" = v_org
      AND estado_revision = 'APROBADO'
      AND ST_Dimension(geom) = 2
      AND NOT (p_tabla_origen = 'EUDR_USO_SUELO' AND id::text = p_registro_id)
),
solapados AS (
    SELECT
        tabla_origen, registro_id,
        ROUND((ST_Area(ST_Intersection(v_geom, geom)::geography) / NULLIF(ST_Area(v_geom::geography), 0) * 100)::numeric, 2)
            AS solapamiento_pct
    FROM candidatos
    WHERE ST_Overlaps(v_geom, geom) OR ST_Contains(geom, v_geom) OR ST_Contains(v_geom, geom)
)
```

Respuestas a las 3 preguntas del prompt (las 3 ya estaban bien, ninguna
requirió corrección):

- **(a) ¿Filtra por `ID_Organizacion`?** Sí — `WHERE "ID_Organizacion" =
  v_org` en el CTE `candidatos`, para ambas tablas candidatas.
- **(b) ¿Excluye la versión previa del propio registro?** Sí — el `NOT
  (p_tabla_origen = X AND id::text = p_registro_id)` en cada rama del
  `UNION ALL` excluye explícitamente la fila que se está validando.
- **(c) ¿`geography` o grados crudos?** `geography` — tanto
  `ST_Intersection(...)::geography` como `v_geom::geography` en el
  denominador, nunca área en grados de un CRS geográfico crudo.

**El contrato de datos que pedía el prompt YA estaba casi completo:** la
función ya devuelve `registros_solapados: [{ tabla_origen, registro_id,
solapamiento_pct }]` y `solapamiento_max_pct` (confirmado en vivo,
`curl` real) — nombres de campo `registro_id`/`tabla_origen` en vez de
`id`/`tabla` como pedía el contrato del prompt, pero ya consumidos por
código funcionando (`lib/qcTopologyValidation.js`, badges de
`QcDetailEditor.jsx`) — no se renombraron para no romper esos consumidores
sin ningún beneficio real. Lo único que faltaba, y sí se agregó: la
geometría de cada registro solapado.

## Decisión: exponer la geometría vía un fetch adicional, no ampliando la RPC

Se evaluó extender `fn_validar_topologia_eudr` para devolver también la
geometría de cada solapado, pero se prefirió una función nueva de solo
lectura (`fetchComparisonGeometries`, `lib/eudrQcActions.js`) que consulta
`vw_monitoreo_poligonos` por los `registro_id` ya devueltos — misma vista
de auditoría que ya usa el resto de la consola, ya legible con la anon key
(vistas con privilegio de owner, ver el gotcha de RLS en `CLAUDE.md`), sin
tocar la función SQL que ya está aplicada y funcionando en producción.
Defensa en profundidad: se filtra igual por `ID_Organizacion` del lado del
cliente aunque la RPC ya garantiza que esos IDs pertenecen a la misma
organización — mismo criterio que `assertSameOrganization` en el resto de
este archivo.

## Frontend — capa de comparación

`components/gis/QcConsoleMap.jsx` gana una nueva `comparisonGroupRef`
(capa Leaflet separada, agregada al mapa antes que la capa principal para
quedar siempre detrás visualmente) que dibuja las geometrías devueltas por
`comparisonFeatures` con contorno punteado ámbar (`dashArray: '6, 6'`,
`fillOpacity: 0.05`) — visualmente distinto del estilo de cualquier
`tabla_origen` (ver `LAYER_STYLES`). `app/dashboard/qc/page.jsx` calcula
`comparisonFeatures` dentro de `handleValidateTopology`, **solo cuando el
registro validado es el actualmente seleccionado** (esta misma función
también la usa "Validar Todos PENDIENTES" en modo batch — sin ese guard,
un batch sobrescribiría la capa de comparación con la del último registro
validado, no la que el usuario está mirando). Se limpia
(`setComparisonFeatures([])`) en el mismo efecto que ya reseteaba
`editingGeometryKey`/`geometryDraft` al cambiar `selectedKey`.
