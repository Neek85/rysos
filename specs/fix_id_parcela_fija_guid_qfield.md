# Spec — Fix del GUID de QField mal etiquetado como `"ID_Parcela_Fija"` en `vw_monitoreo_poligonos`/`vw_monitoreo_puntos`

- **Estado:** Diseño cerrado (2026-08-26), listo para implementación. **Sigue
  sin existir ninguna migración SQL** — esta spec incluye el SQL exacto
  propuesto (secciones 3 y 4), pero no se aplicó como migración real.
- **Fecha:** 2026-08-26
- **Contexto previo:** auditoría de solo lectura hecha en la sesión de esta
  misma fecha (evidencia completa citada en la sección 1, no repetida
  íntegra acá), `docs/adr/ADR-010-vinculo-real-uso-suelo-monitoreo.md`
  (origen del vínculo real vía `qfield_relation_id`),
  `docs/adr/ADR-028-multi-producto-cafe-cacao.md`/
  `specs/multi_producto_cafe_cacao.md` sección 8.4/8.5 (el trigger del
  paso 4 ya resuelve la misma cadena, con la misma ambigüedad sin
  desempate que esta spec cierra).

## 1. El problema — resumen de la auditoría ya hecha (no repetida en detalle)

`EUDR_USO_SUELO.id_parcela`/`EUDR_INSTALACIONES.id_parcela` **no son
códigos de parcela** — son el GUID crudo que QField genera para el
`EUDR_MONITOREO` padre de esa subdivisión (ADR-010). `vw_monitoreo_poligonos`
(rama `EUDR_USO_SUELO`) y `vw_monitoreo_puntos` (rama `EUDR_INSTALACIONES`)
exponen ese GUID directo como `"ID_Parcela_Fija"` (`u.id_parcela AS
"ID_Parcela_Fija"` / `i.id_parcela AS "ID_Parcela_Fija"`, sin ningún JOIN
de por medio) — confirmado con el texto real y vigente de ambas vistas
en la auditoría previa. El vínculo real es la cadena de 2 saltos ya usada
por el trigger del paso 4: `id_parcela → EUDR_MONITOREO.qfield_relation_id
(+ "ID_Organizacion") → EUDR_MONITOREO."ID_Parcela_Fija"`.

**Verificado con datos reales, no asumido** (auditoría previa):
`EUDR_INSTALACIONES.id_parcela` tiene el mismo patrón exacto de GUID
(5/5 filas reales confirmadas, 3 coinciden literalmente con GUIDs ya
vistos en `EUDR_USO_SUELO`) — mismo mecanismo, mismo fix aplicable a
ambas ramas.

**Impacto real ya verificado corriendo el código real** (no solo
leyéndolo): `components/gis/MapDashboard.jsx::resolveParcelaCodigo` ya
se defiende de este bug (descarta valores con forma de UUID vía
`sanitizeCode()`, cae a `'S/C'`/`'N/A'`) — invisible en el Dashboard.
`lib/eudrDdsExporter.js::buildTracesPayload` **no** tiene ese guard:
corrido contra las 13 filas reales `APROBADO` de `ORG-TEST-E2E` produce
**6 "plots"** en vez de los 3 reales — 4 de ellos "fantasma", uno por
cada GUID único de `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`, con el GUID
crudo filtrando a la propiedad pública `id_parcela` del GeoJSON
exportado, geometría de la subdivisión (no el perímetro real),
`productor_nombre: "Socio no asignado"`, `hectareas: 0`.

**Ambigüedad real confirmada con datos reales:**
`EUDR_MONITOREO.qfield_relation_id = '{4166dc2a-4cf0-452b-8eee-d5f68ce05e5c}'`
aparece en **2 filas** con `"ID_Parcela_Fija"` distinto
(`COOP-JS-001`/`COOP-JS-003`). **Ambas tienen además el mismo
`fecha_monitoreo` (`2026-07-06`)** — un `ORDER BY fecha_monitoreo DESC`
solo (sin desempate secundario) **no alcanza** para resolver este caso
real, confirmado consultando las 2 filas en vivo. Sí difieren en
`creado_en` (`2026-08-22T04:21:52...` vs. `2026-08-24T23:02:17...`,
columna `timestamptz`, poblada en el 100% de las 19 filas reales de
`EUDR_MONITOREO` — nunca `NULL`) — candidato de desempate secundario
fiable, a diferencia de `fecha_monitoreo` que es solo `date` (granularidad
de día, cargada por el técnico, no por el sistema).

**Estado de datos hoy:** 100% `ORG-TEST-E2E` en las 3 tablas núcleo GIS
(19/`EUDR_MONITOREO`, 5/`EUDR_USO_SUELO`, 5/`EUDR_INSTALACIONES`) — cero
organizaciones reales con monitoreo cargado. Ventana abierta para aplicar
el fix sin impacto en datos de producción.

**Riesgo advertido, impacto real hoy = cero:**
`lib/traceabilityHash.js::generateLotHash` usa
`properties.id_parcela` (cuando falta `id_monitoreo`, que es el caso del
payload de `eudrDdsExporter.js`) como parte del hash público
determinista de `/trace/[lot_hash]`. Tras el fix, los "plots fantasma"
desaparecen (se fusionan con su parcela real) — cualquier URL pública ya
compartida para el `lot_hash` de un plot fantasma dejaría de resolver.
Sin impacto real hoy (100% datos de prueba, sin URLs públicas reales
compartidas de esos plots), pero documentado para cuando haya datos
reales.

## 2. Contrato del fix — resumen

| Objeto | Cambio |
|---|---|
| `vw_monitoreo_poligonos` (rama `EUDR_USO_SUELO`) | `u.id_parcela AS "ID_Parcela_Fija"` → `resolved."ID_Parcela_Fija"` vía `LEFT JOIN LATERAL` a `EUDR_MONITOREO` |
| `vw_monitoreo_puntos` (rama `EUDR_INSTALACIONES`) | `i.id_parcela AS "ID_Parcela_Fija"` → `resolved."ID_Parcela_Fija"` vía `LEFT JOIN LATERAL` a `EUDR_MONITOREO` (misma cadena) |
| `fn_set_producto_predominante_uso_suelo()` (trigger del paso 4) | agrega `ORDER BY fecha_monitoreo DESC NULLS LAST, creado_en DESC` al `SELECT ... LIMIT 1` existente — mismo criterio de desempate que las vistas, para que vista y trigger elijan siempre el mismo `EUDR_MONITOREO` padre ante un `qfield_relation_id` duplicado |
| `vw_monitoreo_web` | **sin cambios** — su `LEFT JOIN PADRON_PARCELAS` ya existente empieza a matchear solo una vez que `"ID_Parcela_Fija"` upstream es el código real |
| `lib/eudrDdsExporter.js` | **sin cambios** — el fix en las vistas resuelve en cascada el bug de "plots fantasma" (sección 5) |

## 3. Diseño — `vw_monitoreo_poligonos`

Reemplaza únicamente la rama `EUDR_USO_SUELO` del `UNION ALL` (rama
`EUDR_MONITOREO` sin cambios — ya usa el código real). `CREATE OR REPLACE
VIEW`, mismo patrón sin `DROP` ya usado en el resto del historial de esta
vista — el nombre/orden/tipo de cada columna de salida no cambia, solo la
expresión de `"ID_Parcela_Fija"` en esta rama.

```sql
CREATE OR REPLACE VIEW public.vw_monitoreo_poligonos AS
SELECT
    'EUDR_MONITOREO'          AS tabla_origen,
    m.id_monitoreo::text      AS registro_id,
    m.id_monitoreo::text      AS id_origen,
    m.id_monitoreo            AS id_monitoreo,
    m."ID_Organizacion",
    m."ID_Parcela_Fija",
    COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor,
    NULL::text                AS tipo_uso,
    m.evidencia_foto,
    m.estado_revision,
    m.fecha_monitoreo,
    m.observaciones,
    m.cumple_eudr,
    m.area_calculada_ha,
    m.requiere_revision_area,
    ST_Multi(ST_CollectionExtract(ST_Transform(m.geom_inspeccion, 4326), 3))
        ::geometry(MultiPolygon, 4326) AS geom,
    ST_Multi(ST_CollectionExtract(ST_Transform(m.geom_inspeccion, 4326), 3))
        ::geometry(MultiPolygon, 4326) AS geom_inspeccion,
    NULL::uuid                AS id_producto_predominante
FROM public."EUDR_MONITOREO" m
WHERE ST_Dimension(m.geom_inspeccion) = 2

UNION ALL

SELECT
    'EUDR_USO_SUELO'          AS tabla_origen,
    u.fid::text               AS registro_id,
    u.id::text                AS id_origen,
    extensions.uuid_generate_v5(extensions.uuid_ns_url(), 'USO_SUELO_' || u.id::text)
                               AS id_monitoreo,
    u."ID_Organizacion",
    resolved."ID_Parcela_Fija" AS "ID_Parcela_Fija",  -- CAMBIO: antes u.id_parcela (GUID QField crudo)
    NULL::text                AS productor,
    u.tipo_uso,
    NULL::text                AS evidencia_foto,
    u.estado_revision,
    NULL::date                AS fecha_monitoreo,
    NULL::text                AS observaciones,
    NULL::text                AS cumple_eudr,
    u.area_calculada_ha,
    u.requiere_revision_area,
    ST_Multi(ST_CollectionExtract(ST_Transform(u.geom, 4326), 3))
        ::geometry(MultiPolygon, 4326) AS geom,
    ST_Multi(ST_CollectionExtract(ST_Transform(u.geom, 4326), 3))
        ::geometry(MultiPolygon, 4326) AS geom_inspeccion,
    u.id_producto_predominante
FROM public."EUDR_USO_SUELO" u
LEFT JOIN LATERAL (                                    -- NUEVO
    SELECT m."ID_Parcela_Fija"
    FROM public."EUDR_MONITOREO" m
    WHERE m.qfield_relation_id = u.id_parcela
      AND m."ID_Organizacion" = u."ID_Organizacion"
    ORDER BY m.fecha_monitoreo DESC NULLS LAST, m.creado_en DESC
    LIMIT 1
) resolved ON true
WHERE ST_Dimension(u.geom) = 2;
```

`LEFT JOIN LATERAL ... ON true` con un subquery que ya trae `LIMIT 1`
preserva la cardinalidad exacta de `u` (0 o 1 fila de `resolved` por cada
fila de `u`, nunca fan-out) — sin match, `resolved."ID_Parcela_Fija"` es
`NULL` de forma natural, nunca propaga el GUID crudo.

## 4. Diseño — `vw_monitoreo_puntos`

Misma cadena exacta, aplicada a la rama `EUDR_INSTALACIONES` (rama
`EUDR_MONITOREO` sin cambios).

```sql
CREATE OR REPLACE VIEW public.vw_monitoreo_puntos AS
SELECT
    'EUDR_MONITOREO'          AS tabla_origen,
    m.id_monitoreo::text      AS registro_id,
    m.id_monitoreo            AS id_monitoreo,
    m."ID_Organizacion",
    m."ID_Parcela_Fija",
    COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor,
    NULL::text                AS tipo_infra,
    m.evidencia_foto,
    m.estado_revision,
    m.fecha_monitoreo,
    m.observaciones,
    m.cumple_eudr,
    m.area_calculada_ha,
    m.requiere_revision_area,
    ST_Transform(m.geom_inspeccion, 4326)::geometry(Point, 4326) AS geom,
    ST_Transform(m.geom_inspeccion, 4326)::geometry(Point, 4326) AS geom_inspeccion,
    m.id_monitoreo::text      AS id_origen
FROM public."EUDR_MONITOREO" m
WHERE ST_Dimension(m.geom_inspeccion) = 0

UNION ALL

SELECT
    'EUDR_INSTALACIONES'      AS tabla_origen,
    i.fid::text               AS registro_id,
    extensions.uuid_generate_v5(extensions.uuid_ns_url(), 'INSTALACIONES_' || i.id::text)
                               AS id_monitoreo,
    i."ID_Organizacion",
    resolved."ID_Parcela_Fija" AS "ID_Parcela_Fija",  -- CAMBIO: antes i.id_parcela (GUID QField crudo)
    NULL::text                AS productor,
    i.tipo_infra,
    i.evidencia_foto,
    i.estado_revision,
    NULL::date                AS fecha_monitoreo,
    NULL::text                AS observaciones,
    NULL::text                AS cumple_eudr,
    i.area_calculada_ha,
    i.requiere_revision_area,
    ST_Transform(i.geom, 4326)::geometry(Point, 4326) AS geom,
    ST_Transform(i.geom, 4326)::geometry(Point, 4326) AS geom_inspeccion,
    i.id::text                AS id_origen
FROM public."EUDR_INSTALACIONES" i
LEFT JOIN LATERAL (                                    -- NUEVO, misma cadena que 3
    SELECT m."ID_Parcela_Fija"
    FROM public."EUDR_MONITOREO" m
    WHERE m.qfield_relation_id = i.id_parcela
      AND m."ID_Organizacion" = i."ID_Organizacion"
    ORDER BY m.fecha_monitoreo DESC NULLS LAST, m.creado_en DESC
    LIMIT 1
) resolved ON true
WHERE ST_Dimension(i.geom) = 0;
```

## 5. Diseño — trigger del paso 4, mismo desempate

`fn_set_producto_predominante_uso_suelo()` (`supabase/migrations/20260826120000_multi_producto_cafe_cacao.sql`)
resuelve HOY la misma cadena con un `SELECT ... LIMIT 1` **sin `ORDER BY`**
— ante el `qfield_relation_id` duplicado real (sección 1), su elección es
arbitraria/no determinística, y **puede no coincidir** con la que ahora
elegirían las vistas (sección 3/4) para el mismo `EUDR_USO_SUELO.id_parcela`
— dos fuentes de verdad (trigger para `id_producto_predominante`, vista
para `"ID_Parcela_Fija"`/`parcela_codigo`) podrían apuntar a parcelas
distintas para la misma subdivisión. Se agrega el mismo `ORDER BY` para
que ambos coincidan siempre:

```sql
CREATE OR REPLACE FUNCTION public.fn_set_producto_predominante_uso_suelo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_id_parcela_fija text;
    v_id_producto     uuid;
BEGIN
    SELECT m."ID_Parcela_Fija" INTO v_id_parcela_fija
    FROM public."EUDR_MONITOREO" m
    WHERE m.qfield_relation_id = NEW.id_parcela
      AND m."ID_Organizacion" = NEW."ID_Organizacion"
    ORDER BY m.fecha_monitoreo DESC NULLS LAST, m.creado_en DESC  -- NUEVO
    LIMIT 1;

    IF v_id_parcela_fija IS NOT NULL THEN
        SELECT pp.id_producto_predominante INTO v_id_producto
        FROM public."PADRON_PARCELAS" pp
        WHERE pp."ID_Parcela_Fija" = v_id_parcela_fija
          AND pp."ID_Organizacion" = NEW."ID_Organizacion"
        LIMIT 1;
    END IF;

    NEW.id_producto_predominante := v_id_producto;
    RETURN NEW;
END;
$$;
```

(La segunda consulta, contra `PADRON_PARCELAS`, no tiene esta ambigüedad
— `UNIQUE ("ID_Organizacion", "ID_Parcela_Fija")` ya la garantiza a nivel
de constraint real, ver `20260825201351_pk_surrogate_multiorganizacion.sql`
sección 2 de esa migración.)

**Nota de consistencia, fuera de alcance de esta spec:** el `LATERAL`
`mon` ya existente en `vw_monitoreo_web` (resuelve `productor` para
filas de `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` desde el `EUDR_MONITOREO`
más reciente) usa `ORDER BY m.fecha_monitoreo DESC NULLS LAST LIMIT 1`
— **el mismo patrón, con la misma ambigüedad sin desempate secundario**
que este fix cierra en otros 3 lugares. No se toca en esta spec (alcance
distinto: resuelve `productor`, no `"ID_Parcela_Fija"`), pero queda
señalado como el mismo tipo de gap, candidato a una spec de seguimiento
si se decide unificar el criterio en los 4 lugares.

## 6. Impacto verificado en cascada

- **`vw_monitoreo_web`: sin cambios de código.** Su `LEFT JOIN
  PADRON_PARCELAS pp ON src."ID_Parcela_Fija" = pp."ID_Parcela_Fija" AND
  src."ID_Organizacion" = pp."ID_Organizacion"` ya existente empieza a
  matchear solo para filas de `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` una
  vez que `src."ID_Parcela_Fija"` (heredado de las vistas de la sección
  3/4) es el código real — `parcela_codigo`/`parcela_nombre`/`area_ha`
  dejan de ser `NULL` para estas filas, sin ninguna migración adicional
  sobre esta vista.
- **`lib/eudrDdsExporter.js`: sin cambios de código.** `groupByParcela`
  (línea 94, `record.ID_Parcela_Fija || record.parcela_codigo`) empieza a
  agrupar correctamente las subdivisiones bajo la clave real de su
  parcela — los "plots fantasma" verificados en la auditoría (6 en vez
  de 3, para las 13 filas reales de `ORG-TEST-E2E`) dejan de generarse,
  sin tocar este archivo. **Este mismo caso real (13 filas, `ORG-TEST-E2E`)
  es el que debería usarse como caso de prueba end-to-end una vez
  aplicada la migración real** — antes: `total_plots: 6`; después
  (esperado): `total_plots: 3`, uno por cada `EUDR_MONITOREO` real.
- **`components/gis/MapDashboard.jsx`: sin cambios de código.**
  `resolveParcelaCodigo`/`formatArea` ya tienen su fallback defensivo —
  simplemente dejan de activarse para estas filas (el dato real llega
  directo, `sanitizeCode()` ya no tiene nada que descartar).
- **`lib/traceabilityHash.js`/`/trace/[lot_hash]`: riesgo advertido, sin
  mitigación en esta spec** (sección 1) — los hashes de los plots
  fantasma dejan de existir tras el fix. Impacto real hoy: cero. Antes
  de aplicar la migración real contra una organización con datos
  reales y URLs públicas ya compartidas, sería necesario revisar si
  algún `lot_hash` real depende de esta ambigüedad (no aplicable hoy).

## 7. Riesgos y cómo los mitiga el diseño

| Riesgo (de la auditoría previa) | Mitigación en este diseño |
|---|---|
| `qfield_relation_id` duplicado produce fan-out en un `JOIN` plano | `LEFT JOIN LATERAL (... LIMIT 1) ON true` — cardinalidad 0-o-1 garantizada por diseño, no por convención |
| Elección arbitraria/no determinística ante el duplicado (mismo `fecha_monitoreo`, confirmado con datos reales) | `ORDER BY fecha_monitoreo DESC NULLS LAST, creado_en DESC` — `creado_en` nunca `NULL` (100% de las 19 filas reales), rompe el empate real observado |
| Vista y trigger podrían elegir un `EUDR_MONITOREO` padre distinto para el mismo `qfield_relation_id` duplicado | Mismo `ORDER BY` aplicado en los 3 lugares (secciones 3, 4, 5) |
| Rendimiento — la vista no tenía ningún `JOIN` propio antes | Índice ya existente (`idx_eudr_monitoreo_qfield_relation_id`, ADR-010) soporta el `LATERAL`; volumen real hoy trivial (19/5/5 filas) |
| Romper algo que dependa del `GUID`/`NULL` actual | Único consumidor identificado es `lib/traceabilityHash.js` vía plots fantasma — impacto real hoy cero (sección 1/6), documentado para el futuro |
| Cambiar la forma de las vistas (agregar/quitar columnas) | No aplica — mismo nombre/orden/tipo de columna de salida en las 2 vistas, `CREATE OR REPLACE VIEW` sin `DROP` |

## 8. Fuera de alcance (a propósito)

- **No se aplica ninguna migración SQL en esta spec** — el SQL de las
  secciones 3, 4 y 5 es el diseño propuesto, listo para una migración
  futura, no ejecutado todavía.
- **El `LATERAL` `mon` de `vw_monitoreo_web`** (sección 5, nota de
  consistencia) — misma clase de ambigüedad, en un lugar y con un
  propósito distintos (`productor`, no `"ID_Parcela_Fija"`). Señalado,
  no corregido acá.
- **Backfill de datos ya escritos con el `id_producto_predominante`
  potencialmente mal resuelto por el trigger sin desempate** (paso 4,
  antes de este fix) — hoy no aplica: 100% de `EUDR_USO_SUELO` sigue con
  `id_producto_predominante = NULL` (predata al trigger, confirmado en
  la verificación Live del paso 4), así que no hay ninguna fila real que
  backfillear con un valor potencialmente incorrecto. Si esto cambiara
  antes de aplicar la migración de esta spec, habría que evaluar un
  backfill de re-cálculo — no necesario hoy.
- **Test end-to-end contra las 13 filas reales de `ORG-TEST-E2E`**
  (sección 6) — a implementar junto con la migración real, no en esta
  spec de diseño.
