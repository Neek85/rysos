-- MIGRACIÓN IDEMPOTENTE: agrega un segundo nivel de resolución a
-- productor_nombre en vw_monitoreo_web, vía el dueño registrado de la
-- parcela (PADRON_PARCELAS."ID_Socio").
--
-- CONTEXTO (specs/gis_mapa_dashboard_polish_v2.md): la migración anterior
-- (20260819_vw_monitoreo_web_productor_nombre.sql) resuelve
-- productor_nombre SOLO a partir del productor ya resuelto en
-- vw_monitoreo_poligonos/puntos — que para EUDR_USO_SUELO/EUDR_INSTALACIONES
-- es NULL y cae al LEFT JOIN LATERAL contra la visita EUDR_MONITOREO más
-- reciente de la misma parcela (mon.productor). Si esa parcela nunca tuvo
-- una visita EUDR_MONITOREO registrada (común quando la Subdivisión/
-- Infraestructura se cargó vía el Ingestor de Capas Espaciales o el Editor
-- Vectorial, sin un perímetro QField previo), mon.productor también es
-- NULL y el popup mostraba "Sin registrar" aunque la parcela SÍ tenga un
-- dueño real en PADRON_PARCELAS."ID_Socio" (confirmado que esta columna
-- existe — ya usada en 20260818_sync_parcelas_baja_por_socio_inactivo.sql).
--
-- Fix: un segundo LEFT JOIN independiente a PADRON_SOCIOS (alias ps_parcela)
-- sobre pp."ID_Socio" (pp ya está joineada en esta vista para
-- parcela_codigo/parcela_nombre/area_ha — no hace falta un JOIN nuevo a
-- PADRON_PARCELAS, solo una columna más del mismo). Se mantiene como JOIN
-- separado del existente (alias ps, sobre el productor ya resuelto) en vez
-- de fusionar las llaves en un solo COALESCE, porque si `productor` es
-- texto libre (nuevo_productor_nombre, no matchea ningún ID_Socio real) no
-- debe "ganarle" en el COALESCE al intento de resolver por PADRON_PARCELAS
-- — cada camino se resuelve de forma independiente y se combinan recién al
-- final: COALESCE(ps.socio_nombre_completo, ps_parcela.socio_nombre_completo,
-- src.productor, mon.productor).
--
-- No se toca lib/actions/gisActions.js ni se agrega ningún helper cliente
-- nuevo tipo enrichWithParcelaInfo — a diferencia de la Consola QC
-- (lib/eudrQcActions.js), que enriquece del lado del cliente porque
-- vw_monitoreo_poligonos/puntos no traen datos de PADRON_PARCELAS,
-- vw_monitoreo_web YA joinea PADRON_PARCELAS (pp) del lado del servidor —
-- resolver el nombre ahí es más simple y evita un segundo roundtrip.
--
-- CREATE OR REPLACE VIEW: mismo nombre/tipo/posición de columna
-- (productor_nombre sigue siendo la última columna) — solo cambia la
-- expresión que la calcula, permitido sin recrear la vista.

BEGIN;

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
    COALESCE(ps.socio_nombre_completo, ps_parcela.socio_nombre_completo, src.productor, mon.productor)
        AS productor_nombre
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
LEFT JOIN public."PADRON_SOCIOS" ps ON ps."ID_Socio" = COALESCE(src.productor, mon.productor)
LEFT JOIN public."PADRON_SOCIOS" ps_parcela ON ps_parcela."ID_Socio" = pp."ID_Socio"
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
    COALESCE(ps.socio_nombre_completo, ps_parcela.socio_nombre_completo, src.productor, mon.productor)
        AS productor_nombre
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
LEFT JOIN public."PADRON_SOCIOS" ps ON ps."ID_Socio" = COALESCE(src.productor, mon.productor)
LEFT JOIN public."PADRON_SOCIOS" ps_parcela ON ps_parcela."ID_Socio" = pp."ID_Socio"
WHERE src.estado_revision = 'APROBADO';

GRANT SELECT ON public.vw_monitoreo_web TO authenticated;

COMMIT;
