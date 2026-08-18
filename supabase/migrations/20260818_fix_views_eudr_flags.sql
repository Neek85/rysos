-- MIGRACIÓN IDEMPOTENTE: expone area_calculada_ha / requiere_revision_area
-- en vw_monitoreo_poligonos, vw_monitoreo_puntos y vw_monitoreo_web.
--
-- CONTEXTO: 20260818_gis_core_sanitization.sql agregó estas dos columnas a
-- EUDR_MONITOREO/EUDR_USO_SUELO/EUDR_INSTALACIONES, pero las 3 vistas
-- seleccionan listas de columnas explícitas (no SELECT *), así que las
-- columnas nuevas quedaban invisibles para el Dashboard Web y QGIS Desktop.
-- Gap documentado en docs/adr/ADR-001-gis-sanitization-and-eudr-triggers.md,
-- cerrado por esta migración. Ver specs/fix_views_eudr_flags.md.
--
-- Esta migración SOLO agrega columnas al final de cada SELECT — ningún join,
-- filtro, cast de geometría o columna existente cambia respecto a
-- 20260817_refine_vw_monitoreo_web.sql. Se recrean las vistas completas
-- (DROP CASCADE + CREATE) en vez de CREATE OR REPLACE VIEW porque cambia la
-- lista de columnas de 3 vistas encadenadas — mismo patrón ya usado en las
-- migraciones de vistas anteriores de este proyecto.

BEGIN;

DROP VIEW IF EXISTS public.vw_monitoreo_web CASCADE;
DROP VIEW IF EXISTS public.vw_monitoreo_poligonos;
DROP VIEW IF EXISTS public.vw_monitoreo_puntos;

-- ============================================================
-- 1. vw_monitoreo_poligonos
-- ============================================================
CREATE VIEW public.vw_monitoreo_poligonos AS
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
        ::geometry(MultiPolygon, 4326) AS geom_inspeccion
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
    u.id_parcela              AS "ID_Parcela_Fija",
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
        ::geometry(MultiPolygon, 4326) AS geom_inspeccion
FROM public."EUDR_USO_SUELO" u
WHERE ST_Dimension(u.geom) = 2;

GRANT SELECT ON public.vw_monitoreo_poligonos TO authenticated;

-- ============================================================
-- 2. vw_monitoreo_puntos
-- ============================================================
CREATE VIEW public.vw_monitoreo_puntos AS
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
    ST_Transform(m.geom_inspeccion, 4326)::geometry(Point, 4326) AS geom_inspeccion
FROM public."EUDR_MONITOREO" m
WHERE ST_Dimension(m.geom_inspeccion) = 0

UNION ALL

SELECT
    'EUDR_INSTALACIONES'      AS tabla_origen,
    i.fid::text               AS registro_id,
    extensions.uuid_generate_v5(extensions.uuid_ns_url(), 'INSTALACIONES_' || i.id::text)
                               AS id_monitoreo,
    i."ID_Organizacion",
    i.id_parcela              AS "ID_Parcela_Fija",
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
    ST_Transform(i.geom, 4326)::geometry(Point, 4326) AS geom_inspeccion
FROM public."EUDR_INSTALACIONES" i
WHERE ST_Dimension(i.geom) = 0;

GRANT SELECT ON public.vw_monitoreo_puntos TO authenticated;

-- ============================================================
-- 3. vw_monitoreo_web
-- ============================================================
CREATE VIEW public.vw_monitoreo_web AS
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
    ST_AsGeoJSON(src.geom)::json AS geom_geojson
FROM public.vw_monitoreo_poligonos src
LEFT JOIN public."PADRON_PARCELAS" pp ON src."ID_Parcela_Fija" = pp."ID_Parcela_Fija"
LEFT JOIN LATERAL (
    SELECT COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor
    FROM public."EUDR_MONITOREO" m
    WHERE m."ID_Parcela_Fija" = src."ID_Parcela_Fija"
      AND m."ID_Organizacion" = src."ID_Organizacion"
    ORDER BY m.fecha_monitoreo DESC NULLS LAST
    LIMIT 1
) mon ON true
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
    ST_AsGeoJSON(src.geom)::json AS geom_geojson
FROM public.vw_monitoreo_puntos src
LEFT JOIN public."PADRON_PARCELAS" pp ON src."ID_Parcela_Fija" = pp."ID_Parcela_Fija"
LEFT JOIN LATERAL (
    SELECT COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor
    FROM public."EUDR_MONITOREO" m
    WHERE m."ID_Parcela_Fija" = src."ID_Parcela_Fija"
      AND m."ID_Organizacion" = src."ID_Organizacion"
    ORDER BY m.fecha_monitoreo DESC NULLS LAST
    LIMIT 1
) mon ON true
WHERE src.estado_revision = 'APROBADO';

GRANT SELECT ON public.vw_monitoreo_web TO authenticated;

COMMIT;
