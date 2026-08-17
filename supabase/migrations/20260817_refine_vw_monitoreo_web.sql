-- MIGRACIÓN IDEMPOTENTE: Refinamiento de vw_monitoreo_web (Tarea 9.5)
-- Corrige dos gaps reales encontrados al construir el detalle de
-- MapDashboard.jsx:
--
-- 1. "Código de parcela" mostraba "ID_Parcela_Fija", que en la practica es
--    un identificador interno (UUID en muchos registros), no el codigo
--    legible de negocio (ej. "COOP-JS-003"). PADRON_PARCELAS SI tiene un
--    campo separado para eso: parcela_codigo (el mismo que ya usa
--    view_eudr_dashboard_aprobados de Fase 1). Se agrega aqui via el LEFT
--    JOIN a PADRON_PARCELAS que ya existia (Tarea 9.4) para parcela_nombre/
--    area_ha — no hace falta un join nuevo, solo una columna mas del mismo
--    join. El filtrado defensivo de UUIDs remanentes (sanitizeCode) queda
--    del lado del cliente (components/gis/MapDashboard.jsx), por si algun
--    registro no tiene parcela_codigo cargado en PADRON_PARCELAS todavia.
--
-- 2. `productor` viene NULL para toda fila EUDR_USO_SUELO/EUDR_INSTALACIONES
--    (ese campo solo existe en EUDR_MONITOREO). Para poder mostrar
--    "Productor" tambien en los tooltips de Subdivision/Infraestructura, se
--    agrega un LEFT JOIN LATERAL que busca la visita EUDR_MONITOREO mas
--    reciente sobre la MISMA parcela (mismo "ID_Parcela_Fija" + misma
--    organizacion) y usa su productor como respaldo via COALESCE. No
--    requiere ninguna columna nueva ni confirmar una relacion
--    PADRON_PARCELAS -> PADRON_SOCIOS que no esta verificada; solo reutiliza
--    columnas de EUDR_MONITOREO ya usadas en el resto de estas vistas.
--    Si la parcela nunca tuvo una visita de monitoreo registrada, el
--    productor queda NULL igual (el cliente lo muestra como "Sin registrar").
--
-- Solo se toca vw_monitoreo_web (Dashboard Web); vw_monitoreo_poligonos y
-- vw_monitoreo_puntos (auditoria QGIS) no cambian.

BEGIN;

DROP VIEW IF EXISTS public.vw_monitoreo_web CASCADE;

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
