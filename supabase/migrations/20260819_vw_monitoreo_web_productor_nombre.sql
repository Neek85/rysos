-- MIGRACIÓN IDEMPOTENTE: agrega productor_nombre (nombre real del socio) a
-- vw_monitoreo_web.
--
-- CONTEXTO (specs/gis_mapa_dashboard_polish.md): `productor` en esta vista
-- es COALESCE(EUDR_MONITOREO."ID_Socio", EUDR_MONITOREO.nuevo_productor_nombre)
-- — o sea, o un código interno (ej. "JS-00002") o un nombre libre escrito
-- por el técnico en campo, NUNCA el nombre completo real del socio
-- (components/gis/MapDashboard.jsx lo mostraba tal cual, de ahí el reporte
-- de popups mostrando códigos en vez de nombres). PADRON_SOCIOS.ID_Socio es
-- la PK real de socios — se agrega un LEFT JOIN sobre esa columna:
--   - Si `productor` ya es un código real de socio (coincide con
--     PADRON_SOCIOS."ID_Socio"), el JOIN resuelve socio_nombre_completo.
--   - Si `productor` es texto libre (no matchea ningún ID_Socio real), el
--     JOIN no encuentra fila y productor_nombre cae al mismo valor de
--     `productor` (ya es un nombre, aunque no formalizado en el padrón).
--   - Si no hay productor en absoluto (parcela sin ninguna visita de
--     EUDR_MONITOREO registrada), productor_nombre queda NULL igual que
--     productor — el cliente sigue mostrando "Sin registrar".
-- `productor` (el código/valor crudo) se conserva sin cambios — otros
-- consumidores (lib/eudrDdsExporter.js) siguen usándolo tal cual, fuera de
-- alcance de esta tarea.
--
-- Nota de seguridad: socio_nombre_completo es PII catalogada desde Tarea 14
-- (ver docs/schema_live.md). Esta vista no filtra por ID_Organizacion (por
-- diseño — el Portal Público de Trazabilidad la consulta sin sesión), así
-- que exponer el nombre acá reintroduce el mismo patrón de riesgo
-- cross-tenant ya identificado y corregido una vez en
-- view_eudr_dashboard_aprobados (20260818_rls_multi_tenant_fortification.sql).
-- Decisión confirmada explícitamente con el usuario: agregar el nombre SÍ,
-- pero acompañado de un fetch filtrado por organización del lado del
-- cliente (ver components/gis/MapDashboard.jsx) — la vista en sí sigue sin
-- filtro (no hay una noción de "organización activa" a nivel de request sin
-- Supabase Auth real), pero el navegador ya no debe pedir NI recibir filas
-- de otras organizaciones para poder resolver el nombre de su propia data.
--
-- CREATE OR REPLACE VIEW (no DROP+CREATE): la columna nueva se agrega al
-- FINAL del SELECT de cada rama del UNION ALL, sin tocar ninguna columna
-- existente — mismo patrón que 20260819_fix_vw_monitoreo_puntos_id_origen.sql.

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
    COALESCE(ps.socio_nombre_completo, src.productor, mon.productor) AS productor_nombre
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
    COALESCE(ps.socio_nombre_completo, src.productor, mon.productor) AS productor_nombre
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
WHERE src.estado_revision = 'APROBADO';

GRANT SELECT ON public.vw_monitoreo_web TO authenticated;

COMMIT;
