-- MIGRACIÓN IDEMPOTENTE: agrega geom_geojson a view_eudr_dashboard_aprobados.
--
-- CONTEXTO: app/page.jsx (dashboard legacy, Fase 1) pedía columnas que
-- nunca existieron en esta vista (`hectareas`, `riesgo_satelital`,
-- `lot_hash` — confirmado error real en vivo: "column
-- view_eudr_dashboard_aprobados.hectareas does not exist"). El fix real
-- de esas columnas vive en app/page.jsx (usa las columnas reales:
-- hectareas_totales, y remueve riesgo_satelital/lot_hash, que no tienen
-- fuente de datos en este schema — riesgo_satelital nunca se calculó ni
-- persistió en ninguna tabla, lot_hash es un concepto agregado por
-- organización, no por fila/parcela, y nunca se persiste en ningún lado
-- por diseño, ver specs/trace_public_audit.md).
--
-- Lo que SÍ requiere un cambio de schema es `geom`: esta vista expone
-- geometry cruda, que PostgREST serializa como WKB hex, no como GeoJSON
-- — components/EUDRMap.jsx hacía JSON.parse(record.geom) directo, que
-- fallaba silenciosamente para cada fila (mismo problema ya documentado y
-- resuelto para vw_monitoreo_web con geom_geojson,
-- 20260816_fase2_vistas_qc.sql). Esta migración agrega la misma columna
-- geom_geojson acá. Solo se agrega una columna al final — CREATE OR
-- REPLACE VIEW es seguro (no cambia ni reordena columnas existentes).

BEGIN;

CREATE OR REPLACE VIEW public.view_eudr_dashboard_aprobados AS
SELECT
    m.id_monitoreo,
    m."ID_Organizacion",
    m."ID_Parcela_Fija",
    m."ID_Socio",
    m.fecha_monitoreo,
    m.tecnico_responsable,
    m.precision_gps,
    m.evidencia_foto,
    m.cumple_eudr,
    m.observaciones,
    m.estado_revision,
    p.parcela_codigo,
    p.parcela_nombre,
    p.totalh AS hectareas_totales,
    s.localidad,
    s.certificaciones,
    COALESCE(m.geom_inspeccion, p.geom) AS geom,
    ST_AsGeoJSON(COALESCE(m.geom_inspeccion, p.geom))::json AS geom_geojson
FROM public."EUDR_MONITOREO" m
LEFT JOIN public."PADRON_PARCELAS" p ON m."ID_Parcela_Fija" = p."ID_Parcela_Fija"
LEFT JOIN public."PADRON_SOCIOS" s ON m."ID_Socio" = s."ID_Socio"
WHERE m.estado_revision = 'APROBADO'
  AND (
    m."ID_Organizacion" = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  );

GRANT SELECT ON public.view_eudr_dashboard_aprobados TO authenticated;

COMMIT;
