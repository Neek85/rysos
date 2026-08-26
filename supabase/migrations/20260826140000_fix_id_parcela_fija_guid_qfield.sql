-- MIGRACIÓN IDEMPOTENTE: resuelve el GUID crudo de QField mal etiquetado
-- como "ID_Parcela_Fija" en vw_monitoreo_poligonos/vw_monitoreo_puntos
-- (rama EUDR_USO_SUELO/EUDR_INSTALACIONES), alinea el trigger del paso 4
-- con el mismo criterio de desempate, y agrega el mismo desempate
-- secundario al LATERAL `mon` de vw_monitoreo_web (resuelve `productor`).
--
-- Ver specs/fix_id_parcela_fija_guid_qfield.md (diseño cerrado, secciones
-- 3/4/5 para las primeras 3 piezas, sección 5.1 para la 4ta agregada el
-- mismo día tras confirmación explícita del usuario) y ADR-010 (origen
-- del vínculo real vía qfield_relation_id).
--
-- CORRECCIÓN DE BASE encontrada al implementar (no estaba en el spec):
-- la versión de vw_monitoreo_web que este archivo reemplaza NO es la de
-- 20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql (la que
-- el spec citó en su auditoría) sino la más reciente,
-- 20260826120000_multi_producto_cafe_cacao.sql (mismo día, aplicada
-- después) -- agrega id_producto_predominante/producto_codigo/
-- producto_nombre y condiciones "AND ...ID_Organizacion" explícitas en
-- los 4 LEFT JOIN. El CREATE OR REPLACE VIEW de abajo parte de ESA
-- versión (no de la del spec) para no revertir esas columnas/joins --
-- único cambio real: agregar ", m.creado_en DESC" a las 2 ocurrencias de
-- "ORDER BY m.fecha_monitoreo DESC NULLS LAST" del LATERAL `mon`.
--
-- Las 4 piezas mantienen exactamente el mismo nombre/orden/tipo de
-- columna de salida que la versión vigente -- ningún GRANT existente se
-- pierde (CREATE OR REPLACE VIEW/FUNCTION, sin DROP).

BEGIN;

-- ============================================================
-- 1. vw_monitoreo_poligonos -- rama EUDR_USO_SUELO: "ID_Parcela_Fija" deja
--    de exponer el GUID crudo de QField (u.id_parcela) y pasa a resolver
--    la cadena real de 2 saltos (id_parcela -> EUDR_MONITOREO.
--    qfield_relation_id, + "ID_Organizacion" -- desempate por
--    fecha_monitoreo DESC NULLS LAST, creado_en DESC ante duplicado real
--    confirmado: qfield_relation_id '{4166dc2a-4cf0-452b-8eee-
--    d5f68ce05e5c}' en 2 filas de ORG-TEST-E2E con igual fecha_monitoreo).
--    Rama EUDR_MONITOREO sin cambios -- ya usa el código real.
-- ============================================================
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

-- No hace falta GRANT -- CREATE OR REPLACE VIEW preserva los GRANTs
-- existentes (columnas de salida sin cambios de nombre/orden/tipo).

-- ============================================================
-- 2. vw_monitoreo_puntos -- misma cadena exacta, rama EUDR_INSTALACIONES.
--    Rama EUDR_MONITOREO sin cambios.
-- ============================================================
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
LEFT JOIN LATERAL (                                    -- NUEVO, misma cadena que 1
    SELECT m."ID_Parcela_Fija"
    FROM public."EUDR_MONITOREO" m
    WHERE m.qfield_relation_id = i.id_parcela
      AND m."ID_Organizacion" = i."ID_Organizacion"
    ORDER BY m.fecha_monitoreo DESC NULLS LAST, m.creado_en DESC
    LIMIT 1
) resolved ON true
WHERE ST_Dimension(i.geom) = 0;

-- No hace falta GRANT -- mismo motivo que arriba.

-- ============================================================
-- 3. fn_set_producto_predominante_uso_suelo() (trigger BEFORE INSERT del
--    paso 4, supabase/migrations/20260826120000_multi_producto_cafe_cacao.sql)
--    -- agrega el mismo ORDER BY de desempate al SELECT ... LIMIT 1 que
--    resuelve el mismo qfield_relation_id, para que trigger y vistas
--    elijan siempre el mismo EUDR_MONITOREO padre ante un duplicado. No
--    hace falta recrear el trigger (DROP/CREATE) -- solo reemplazar la
--    función ya deja el trigger existente apuntando al nuevo cuerpo.
-- ============================================================
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

-- ============================================================
-- 4. vw_monitoreo_web -- ÚNICO cambio real: agregar ", m.creado_en DESC"
--    al ORDER BY del LATERAL `mon` (resuelve `productor` para filas de
--    EUDR_USO_SUELO/EUDR_INSTALACIONES desde la visita EUDR_MONITOREO más
--    reciente de la MISMA parcela ya resuelta -- ambigüedad distinta a la
--    de las piezas 1/2/3: acá el match es por "ID_Parcela_Fija", no por
--    qfield_relation_id). Confirmado con el usuario 2026-08-26 (spec
--    sección 5.1) alinear el mismo criterio de desempate en los 4
--    lugares. Base: la definición vigente de
--    20260826120000_multi_producto_cafe_cacao.sql -- ninguna otra
--    columna/JOIN/WHERE cambia.
-- ============================================================
CREATE OR REPLACE VIEW public.vw_monitoreo_web AS
SELECT
    'poligono'      AS tipo_geometria,
    src.tabla_origen,
    src.registro_id,
    src."ID_Organizacion",
    src."ID_Parcela_Fija",
    pp.parcela_codigo,
    pp.parcela_nombre,
    pp.totalh       AS area_ha,
    COALESCE(src.productor, mon.productor) AS productor,
    src.tipo_uso    AS clasificacion,
    src.evidencia_foto,
    src.estado_revision,
    src.fecha_monitoreo,
    src.observaciones,
    src.cumple_eudr,
    src.area_calculada_ha,
    src.requiere_revision_area,
    src.geom,
    ST_AsGeoJSON(src.geom)::json AS geom_geojson,
    COALESCE(
        ps.socio_nombre_completo, ps_parcela.socio_nombre_completo,
        src.productor, mon.productor, 'Socio no asignado'
    ) AS productor_nombre,
    src.id_producto_predominante,
    prod.codigo    AS producto_codigo,
    prod.nombre    AS producto_nombre
FROM public.vw_monitoreo_poligonos src
LEFT JOIN public."PADRON_PARCELAS" pp
    ON src."ID_Parcela_Fija" = pp."ID_Parcela_Fija" AND src."ID_Organizacion" = pp."ID_Organizacion"
LEFT JOIN LATERAL (
    SELECT COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor
    FROM public."EUDR_MONITOREO" m
    WHERE m."ID_Parcela_Fija" = src."ID_Parcela_Fija"
      AND m."ID_Organizacion" = src."ID_Organizacion"
    ORDER BY m.fecha_monitoreo DESC NULLS LAST, m.creado_en DESC  -- CAMBIO: antes sin m.creado_en DESC
    LIMIT 1
) mon ON true
LEFT JOIN public."PADRON_SOCIOS" ps
    ON ps."ID_Socio" = COALESCE(src.productor, mon.productor) AND ps."ID_Organizacion" = src."ID_Organizacion"
LEFT JOIN public."PADRON_SOCIOS" ps_parcela
    ON ps_parcela."ID_Socio" = pp."ID_Socio" AND ps_parcela."ID_Organizacion" = src."ID_Organizacion"
LEFT JOIN public."PRODUCTOS" prod
    ON prod.id = src.id_producto_predominante
WHERE src.estado_revision = 'APROBADO'

UNION ALL

SELECT
    'punto'         AS tipo_geometria,
    src.tabla_origen,
    src.registro_id,
    src."ID_Organizacion",
    src."ID_Parcela_Fija",
    pp.parcela_codigo,
    pp.parcela_nombre,
    pp.totalh       AS area_ha,
    COALESCE(src.productor, mon.productor) AS productor,
    src.tipo_infra  AS clasificacion,
    src.evidencia_foto,
    src.estado_revision,
    src.fecha_monitoreo,
    src.observaciones,
    src.cumple_eudr,
    src.area_calculada_ha,
    src.requiere_revision_area,
    src.geom,
    ST_AsGeoJSON(src.geom)::json AS geom_geojson,
    COALESCE(
        ps.socio_nombre_completo, ps_parcela.socio_nombre_completo,
        src.productor, mon.productor, 'Socio no asignado'
    ) AS productor_nombre,
    NULL::uuid AS id_producto_predominante,
    NULL::text AS producto_codigo,
    NULL::text AS producto_nombre
FROM public.vw_monitoreo_puntos src
LEFT JOIN public."PADRON_PARCELAS" pp
    ON src."ID_Parcela_Fija" = pp."ID_Parcela_Fija" AND src."ID_Organizacion" = pp."ID_Organizacion"
LEFT JOIN LATERAL (
    SELECT COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor
    FROM public."EUDR_MONITOREO" m
    WHERE m."ID_Parcela_Fija" = src."ID_Parcela_Fija"
      AND m."ID_Organizacion" = src."ID_Organizacion"
    ORDER BY m.fecha_monitoreo DESC NULLS LAST, m.creado_en DESC  -- CAMBIO: antes sin m.creado_en DESC
    LIMIT 1
) mon ON true
LEFT JOIN public."PADRON_SOCIOS" ps
    ON ps."ID_Socio" = COALESCE(src.productor, mon.productor) AND ps."ID_Organizacion" = src."ID_Organizacion"
LEFT JOIN public."PADRON_SOCIOS" ps_parcela
    ON ps_parcela."ID_Socio" = pp."ID_Socio" AND ps_parcela."ID_Organizacion" = src."ID_Organizacion"
WHERE src.estado_revision = 'APROBADO';

-- No hace falta GRANT -- mismo motivo que arriba (columnas de salida sin
-- cambios de nombre/orden/tipo respecto a 20260826120000_multi_producto_cafe_cacao.sql).

COMMIT;
