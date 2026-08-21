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

## Re-investigación (2026-08-21, mismo día) — "editor de puntos abre modo polígono" SÍ era real

Un prompt de seguimiento aportó evidencia nueva y específica (2 capturas
reales de sesión, 1 minuto de diferencia, mismo registro Instalaciones):
la hipótesis de colisión entre el toolbar del Editor Vectorial (crear
registro nuevo — botones ⬠ Polígono/📍 Marcador, siempre visibles arriba
a la izquierda del mapa) y el modo "Ajustar Geometría" (editar el registro
ya seleccionado). Esta vez SÍ se confirmó.

**Código relevante ANTES de tocar nada:** `useVectorEditor`
(`app/dashboard/qc/components/VectorEditorTools.jsx`) engancha
`attachVectorEditor` en un `useEffect` con dependencia `[mapReady]`
únicamente — se ejecuta una sola vez al montar el mapa y nunca se
reevalúa por `editingKey`. El toolbar de dibujo (`map.pm.addControls(...)`)
queda activo y clickeable durante TODA la vida del componente,
completamente independiente de si un registro existente está en modo
"Ajustar Geometría".

**Reproducido en vivo** (no solo inspección de código, como pide el
prompt) con `javascript_tool`, secuencia exacta: seleccionar un registro
Point → "Ajustar Geometría" → sin salir de "Editando…" → click real
(`.click()`) sobre el botón "Dibujar Polígono" del toolbar. Resultado
confirmado con una sola consulta al DOM:

```json
{ "stillEditing": true, "hasFinishAction": true, "hasRemoveLastVertex": true, "hasCancel": true, "markerStillDraggable": true }
```

Los 5 campos en `true` a la vez: el registro seguía en "Editando…", el
marcador seguía arrastrable, Y el toolbar completo de dibujo de polígono
(Finalizar/Eliminar último vértice/Cancelar) estaba activo — exactamente
lo que muestran las 2 capturas del reporte.

(Nota metodológica: los clicks del `computer` tool sobre este botón
específico no lo activaban de forma confiable — mismo tipo de flakiness
ya documentado en esta sesión para otros elementos — por eso la
reproducción se hizo con un `.click()` real vía `javascript_tool` sobre
el elemento DOM, que sí dispara el evento que Leaflet escucha.)

### Regresión real y no relacionada, encontrada en el camino

Antes de poder reproducir nada, el toolbar del Editor Vectorial no
aparecía en absoluto — ni un solo botón de dibujo, en ningún registro. Se
aisló con un `console.error` temporal en el `catch` de `init()`
(`components/gis/QcConsoleMap.jsx`): `layerGroupRef.current.bringToFront
is not a function`. Causa: `L.layerGroup()` crea un `L.LayerGroup` plano,
que **no tiene** `.bringToFront()` — ese método solo existe en
`L.FeatureGroup`/capas basadas en `L.Path`. La línea se agregó en la
tarea anterior (capa de comparación de solapamiento) para intentar
garantizar el z-order visual; al tirar, quedaba atrapada por el
`catch {}` silencioso de `init()`, dejando `mapReady` en `false` para
siempre — con eso, **todo** el Editor Vectorial (no solo el toolbar de
dibujo) quedaba inoperable desde el commit anterior. Corregido sin
`bringToFront()`: `comparisonGroupRef` ahora se agrega al mapa ANTES que
`layerGroupRef` — Leaflet apila las capas en el orden en que se agregan,
así que el orden de creación por sí solo logra el mismo z-order buscado.

### Fix: exclusión mutua real, en ambas direcciones

1. **Editar bloquea dibujar** (la dirección reportada): el mismo efecto
   de `editingKey` en `QcConsoleMap.jsx` ahora llama
   `map.pm.Toolbar.setButtonDisabled('drawPolygon'|'drawMarker',
   isAnyEditing)` — API real de geoman que agrega la clase CSS
   `pm-disabled` + `aria-disabled="true"` (deshabilitado **visualmente**,
   no solo un flag lógico, tal como pedía el prompt). Confirmado en vivo:
   con un registro en "Editando…", el botón de Polígono muestra
   `pm-disabled`/`aria-disabled="true"`, y clickearlo ya no crea ningún
   vértice (`vertexMarkerCount: 0`, contenedor de acciones con
   `display: none`). Al terminar la edición, la clase se remueve.
2. **Dibujar bloquea editar** (dirección inversa, para exclusión mutua
   real): `QcConsoleMap.jsx` reporta hacia `page.jsx` (nuevo callback
   `onDrawSessionActiveChange`) cuando hay un borrador o una capa dibujada
   sin guardar (`vectorEditor.draft || vectorEditor.drawnLayer`).
   `page.jsx` deshabilita el botón "Ajustar Geometría" en
   `QcDetailEditor.jsx` (nueva prop `geometryEditDisabled`) para
   cualquier registro que NO esté ya en edición — nunca bloquea terminar
   una edición ya en curso.

Commit: `fix(qc): excluye mutuamente editor de geometria nueva y ajuste
de geometria existente`, push a `staging`.

## Fase 2 — verificación explícita del redondeo cliente/server (2026-08-21, a pedido directo)

A pedido explícito, verificación línea por línea de que el redondeo del
panel en vivo (`lib/geo/areaUtils.js`) coincide con el server:

- **Cliente** (`lib/geo/areaUtils.js:32-37`): `AREA_HA_DECIMALS = 4`,
  `roundTo(value, decimals) { const factor = 10**decimals; return
  Math.round(value * factor) / factor }`.
- **`fn_validar_topologia_eudr` NO redondea ella misma**
  (`supabase/migrations/20260820_fn_validar_topologia_eudr.sql:127`):
  `v_area_ha := public.fn_calcular_area_ha(v_geom);` — delega.
- **La constante real** (`supabase/migrations/20260818_gis_core_sanitization.sql:88`):
  `ROUND((ST_Area(p_geom::geography) / 10000)::numeric, 4)`.

Cantidad de decimales: coincide (4 ambos lados). Dirección de redondeo:
coincide (Postgres `numeric` `ROUND` y JS `Math.round` redondean
half-away-from-zero para valores positivos, y el área nunca es
negativa).

**Probado en vivo si `Number(x.toFixed(4))` sería más preciso que
`Math.round(x*10**4)/10**4`** (la sospecha específica que motivó la
pregunta) — no lo es: `node -e` confirmó que ambas técnicas devuelven
exactamente el mismo resultado en el caso clásico de imprecisión de
punto flotante (`1.005` con 2 decimales → ambas dan `1`, no `1.01`,
porque `1.005` no es representable exacto en binario IEEE754). Ninguna
técnica de redondeo nativa de JS evita esto — solo una librería de
precisión arbitraria (`decimal.js`/`big.js`) lo haría, y no se agregó esa
dependencia porque no resolvería el problema real: el área del cliente
(`@turf/area`, esfera aproximada) y la del server
(`ST_Area(geography)`, geodésica sobre el elipsoide WGS84) usan modelos
matemáticos distintos de la forma de la Tierra y ya divergen varios
dígitos ANTES del último decimal — un redondeo perfecto no las haría
coincidir, solo redondearía con más precisión dos números que ya son
distintos. Se documentó esto explícitamente como comentario en
`roundTo()` (`lib/geo/areaUtils.js`) para que no se persiga esta misma
pista de nuevo — commit de documentación, sin cambio funcional.

## Divergencia turf/PostGIS cuantificada (2026-08-21, mismo día)

Cuantificación real (no estimada) de la divergencia entre turf.js
(cliente) y `fn_calcular_area_ha` (server, `ST_Area(geometry::geography)`)
para polígonos cerca del umbral de 4.0 ha, en coordenadas reales de
operación de RYZOS: lat/lng tomadas de un polígono `EUDR_MONITOREO` real
existente en `ORG-COOP-NORTE`, vía consulta REST directa (`lng ≈ -78.87,
lat ≈ -5.89`, zona Jaén, Cajamarca — no se asumió el ecuador). El área
PostGIS se obtuvo con una llamada RPC real y directa a
`fn_calcular_area_ha` (`POST .../rest/v1/rpc/fn_calcular_area_ha`, ya
tiene `EXECUTE` para `anon` por default de Postgres, sin `GRANT`
explícito) — nunca reimplementada a mano.

**7 cuadrados cerca de 4.0 ha:**

| área objetivo (ha) | turf (ha) | PostGIS (ha) | diff (ha) | diff (%) |
|---|---|---|---|---|
| 3.90 | 3.891252 | 3.874400 | 0.016852 | 0.4350% |
| 3.95 | 3.941140 | 3.924100 | 0.017040 | 0.4342% |
| 3.99 | 3.981050 | 3.963800 | 0.017250 | 0.4352% |
| 4.00 | 3.991028 | 3.973700 | 0.017328 | 0.4361% |
| 4.01 | 4.001005 | 3.983700 | 0.017305 | 0.4344% |
| 4.05 | 4.040916 | 4.023400 | 0.017516 | 0.4353% |
| 4.10 | 4.090803 | 4.073100 | 0.017703 | 0.4346% |

**Confirmación de que la divergencia no depende de la forma** (misma
zona real, 2 formas adicionales, área objetivo ~3.95/4.00/4.05 ha cada
una): rectángulo 4:1 → diff 0.017040 / 0.017328 / 0.017516 ha (idéntico
al cuadrado); pentágono irregular → diff 0.017100 / 0.017300 / 0.017500
ha. Prácticamente el mismo valor sin importar la forma — confirma que es
un factor de escala sistemático (esfera aproximada de turf vs elipsoide
WGS84 real de PostGIS), no un artefacto de la forma probada.

**Conclusión:** la divergencia es real, consistente, y **siempre en la
misma dirección** — turf sobreestima respecto a PostGIS, nunca al revés,
~0.017–0.018 ha (~0.43–0.44%) en todos los casos probados cerca de 4.0
ha. No es despreciable frente al margen sugerido de referencia
(0.05 ha) pero tampoco lo agota.

**Decisión:** como turf siempre sobreestima, un polígono cuya área real
(server) ya está por debajo de 4.0 ha puede aparecer en el cliente como
>= 4.0 ha — el badge informativo de `polygonBelowThreshold` no se
mostraría pese a que el server sí consideraría el área por debajo del
umbral ("sub-advertencia" del cliente respecto al server, exactamente lo
que pedía evitar la tarea). Se agregó `CLIENT_AREA_SAFETY_MARGIN_HA =
0.03` (`lib/gisVectorEditor.js`) — corre el punto de disparo del cliente
hacia arriba (~70% de margen sobre el máximo medido, 0.0177 ha) para que
el cliente jamás deje de mostrar el aviso en un caso donde el server sí
lo mostraría. No es un margen simétrico "por las dudas": la dirección
(hacia arriba, no hacia abajo) refleja la dirección real y medida de la
divergencia — turf nunca subestima en esta zona, así que un margen hacia
abajo no habría corregido nada. El texto del badge se actualizó para no
sobre-prometer precisión ("Área cercana o menor a 4.0 ha... el valor
exacto se recalcula al guardar").

`MIN_POLYGON_HECTARES` (`lib/eudrDdsExporter.js`) **no se tocó** — sigue
siendo el umbral regulatorio real, usado tal cual en el export DDS
(sobre el área ya calculada server-side, autoritativa, sin esta
divergencia). El margen solo afecta la vista previa informativa del
cliente durante el dibujo.

Commit: `fix(qc): margen de seguridad en badge Requiere Polygon segun
divergencia turf/postgis`, push a `staging` tras confirmación explícita.
