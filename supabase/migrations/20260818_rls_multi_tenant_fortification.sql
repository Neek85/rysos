-- MIGRACIÓN IDEMPOTENTE: Auditoría y blindaje RLS Multi-Tenant.
-- Ver spec: specs/rls_multi_tenant_audit.md
--
-- ALCANCE REAL (tras auditoría, distinto del pedido original — ver spec para
-- el razonamiento completo):
-- 1. ORGANIZACIONES / EUDR_MONITOREO / EUDR_USO_SUELO / EUDR_INSTALACIONES ya
--    tienen RLS Zero-Trust desde 20260816_fase3_seguridad_rls.sql (Tarea 9.1).
--    Esta migración las RE-ASERTA de forma idempotente (mismas políticas,
--    mismo public.auth_org_id() ya autoritativo — NO se crea ninguna función
--    helper nueva) como defensa contra drift manual en Supabase Studio. No
--    hay cambio de comportamiento para estas 4 tablas.
-- 2. INSPECCIONES + los 6 CAP_* + las políticas `anon` de lectura de
--    PADRON_SOCIOS/PADRON_PARCELAS NO se tocan aquí. Dependen de políticas
--    deliberadamente abiertas (20260818_fix_inspecciones_rls.sql) porque el
--    frontend no tiene sesión real de Supabase Auth — filtrarlas por
--    ID_Organizacion vía JWT las rompería. Además, las 6 CAP_* no tienen
--    columna ID_Organizacion propia (dependen de ID_Inspeccion ->
--    INSPECCIONES.ID_Organizacion) — un filtro literal sobre ellas fallaría
--    al crear la política. Riesgo aceptado por diseño, documentado en
--    docs/schema_live.md, no en el alcance de este archivo.
-- 3. No existen tablas "pecuarias" en el proyecto (búsqueda exhaustiva) — no
--    hay nada que fortificar ahí.
-- 4. HALLAZGO NO SOLICITADO EN EL PROMPT ORIGINAL, confirmado con el usuario
--    antes de corregir: public.view_eudr_dashboard_aprobados (Fase 1)
--    exponía socio_nombre_completo/socio_dni (PII) SIN ningún filtro de
--    ID_Organizacion — fuga de datos entre organizaciones tenant, además de
--    PII. app/page.jsx (único consumidor real en el repo) ni siquiera
--    selecciona esas dos columnas, así que removerlas es seguro. Se corrige
--    en la sección 3 de este archivo.

BEGIN;

-- ============================================================
-- 1. Re-aserción idempotente de RLS Zero-Trust ya existente (Tarea 9.1) —
--    sin cambio de comportamiento, defensa contra drift.
-- ============================================================
ALTER TABLE public."ORGANIZACIONES"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EUDR_MONITOREO"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EUDR_USO_SUELO"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EUDR_INSTALACIONES" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_select_organizaciones" ON public."ORGANIZACIONES";
CREATE POLICY "rls_select_organizaciones" ON public."ORGANIZACIONES"
FOR SELECT TO authenticated
USING (
  "ID" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);
-- Sin política de escritura sobre ORGANIZACIONES: asimetría deliberada
-- preservada de Tarea 9.1 — un tenant no debe poder modificar el registro
-- de su propia organización vía API.

DROP POLICY IF EXISTS "rls_select_eudr_monitoreo" ON public."EUDR_MONITOREO";
CREATE POLICY "rls_select_eudr_monitoreo" ON public."EUDR_MONITOREO"
FOR SELECT TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

DROP POLICY IF EXISTS "rls_write_eudr_monitoreo" ON public."EUDR_MONITOREO";
CREATE POLICY "rls_write_eudr_monitoreo" ON public."EUDR_MONITOREO"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

DROP POLICY IF EXISTS "rls_select_eudr_uso_suelo" ON public."EUDR_USO_SUELO";
CREATE POLICY "rls_select_eudr_uso_suelo" ON public."EUDR_USO_SUELO"
FOR SELECT TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

DROP POLICY IF EXISTS "rls_write_eudr_uso_suelo" ON public."EUDR_USO_SUELO";
CREATE POLICY "rls_write_eudr_uso_suelo" ON public."EUDR_USO_SUELO"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

DROP POLICY IF EXISTS "rls_select_eudr_instalaciones" ON public."EUDR_INSTALACIONES";
CREATE POLICY "rls_select_eudr_instalaciones" ON public."EUDR_INSTALACIONES"
FOR SELECT TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

DROP POLICY IF EXISTS "rls_write_eudr_instalaciones" ON public."EUDR_INSTALACIONES";
CREATE POLICY "rls_write_eudr_instalaciones" ON public."EUDR_INSTALACIONES"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- ============================================================
-- 2. INSPECCIONES / CAP_* / lectura anon de PADRON_* — deliberadamente sin
--    cambios. Ver comentario de cabecera y specs/rls_multi_tenant_audit.md.
-- ============================================================

-- ============================================================
-- 3. FIX DE SEGURIDAD: view_eudr_dashboard_aprobados exponía PII
--    (socio_nombre_completo, socio_dni) sin filtro de ID_Organizacion.
--    app/page.jsx (único consumidor real) no selecciona esas dos columnas
--    — confirmado antes de removerlas, no rompe ningún consumidor.
-- ============================================================
DROP VIEW IF EXISTS public.view_eudr_dashboard_aprobados;

CREATE VIEW public.view_eudr_dashboard_aprobados AS
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
    COALESCE(m.geom_inspeccion, p.geom) AS geom
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
