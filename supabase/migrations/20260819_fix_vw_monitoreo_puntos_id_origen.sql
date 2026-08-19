-- MIGRACIÓN IDEMPOTENTE: agrega `id_origen` a vw_monitoreo_puntos.
--
-- CONTEXTO: 20260818_fix_views_eudr_flags.sql recreó vw_monitoreo_poligonos
-- Y vw_monitoreo_puntos, pero solo la primera quedó con una columna
-- `id_origen` (alias de la PK real `id` de EUDR_USO_SUELO/
-- EUDR_INSTALACIONES, distinta de `registro_id`/`fid` — ver
-- lib/eudrQcActions.js) — vw_monitoreo_puntos se quedó sin ella. Gap
-- encontrado el 2026-08-19 revisando /dashboard/qc: sin `id_origen` no
-- hay forma de ubicar la fila real de EUDR_INSTALACIONES para poder
-- aprobarla/rechazarla desde la Consola QC (approveRecord/rejectRecord
-- actualizan siempre la tabla base, nunca la vista, por match sobre esa
-- columna). Hoy no bloquea nada visible porque no hay registros
-- PENDIENTE de EUDR_INSTALACIONES en la base (verificado en vivo), pero
-- el primero que aparezca fallaría — o peor, matchearía 0 filas en
-- silencio si no fuera por la guarda explícita agregada en
-- lib/eudrQcActions.js::resolveUpdateTarget.
--
-- CREATE OR REPLACE VIEW (no DROP+CREATE): la columna nueva se agrega al
-- FINAL del SELECT de cada rama del UNION ALL, sin tocar ninguna columna
-- existente — Postgres permite este tipo de cambio sin necesidad de
-- recrear vw_monitoreo_web, que depende de esta vista.

BEGIN;

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
    ST_Transform(i.geom, 4326)::geometry(Point, 4326) AS geom_inspeccion,
    i.id::text                AS id_origen
FROM public."EUDR_INSTALACIONES" i
WHERE ST_Dimension(i.geom) = 0;

GRANT SELECT ON public.vw_monitoreo_puntos TO authenticated;

COMMIT;
