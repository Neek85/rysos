-- =====================================================================
-- supabase/rollbacks/20261008092000_seguridad_rollback.sql
-- REABRE LA FUGA: solo para emergencia.
-- =====================================================================
-- Restaura el estado EXACTO previo a aplicar
--   20261008092000_seguridad_tablas_sin_rls_sin_acceso_cliente.sql
--   20261008093000_seguridad_lectura_anon_y_funciones.sql
-- Fuente: snapshot de solo lectura del 2026-10-07 (aclexplode, pg_policies,
-- proacl), fuera del repo en ~/ryzos_scratch/seguridad_antes2/.
-- NO esta en supabase/migrations/ a proposito: no debe correr como migracion.
-- APLICACION MANUAL por Neyser en Supabase Studio. El CLI no aplica nada.
-- =====================================================================

BEGIN;

-- 1) Tablas propias: sin RLS y con el ACL previo (arwdDxtm para anon y authenticated)
ALTER TABLE public."CONFIGURACION_REPORTES_ORG" DISABLE ROW LEVEL SECURITY;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."CONFIGURACION_REPORTES_ORG" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."CONFIGURACION_REPORTES_ORG" TO authenticated;
ALTER TABLE public."MENU_APP" DISABLE ROW LEVEL SECURITY;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."MENU_APP" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."MENU_APP" TO authenticated;
ALTER TABLE public."METADATOS_CAMPOS" DISABLE ROW LEVEL SECURITY;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."METADATOS_CAMPOS" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."METADATOS_CAMPOS" TO authenticated;

-- 2) spatial_ref_sys: la migracion solo lo intentaba (best effort). Si logro revocar
--    algo, esto lo restaura; si no hay privilegios para otorgar, solo avisa.
DO $srs$
BEGIN
  GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.spatial_ref_sys TO anon;
  GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.spatial_ref_sys TO authenticated;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'spatial_ref_sys: sin privilegios para otorgar (dueno supabase_admin)';
END
$srs$;

-- 3) Politicas anon con la condicion previa
ALTER POLICY rls_anon_select_agencias_certificadoras ON public."AGENCIAS_CERTIFICADORAS" USING (true);
ALTER POLICY rls_anon_select_organizacion_certificaciones ON public."ORGANIZACION_CERTIFICACIONES" USING ((id_organizacion IS NOT NULL));
ALTER POLICY rls_anon_select_organizacion_productos ON public."ORGANIZACION_PRODUCTOS" USING ((id_organizacion IS NOT NULL));
ALTER POLICY rls_anon_select_parcela_certificaciones ON public."PARCELA_CERTIFICACIONES" USING ((id_organizacion IS NOT NULL));

-- 4) EXECUTE previo (PUBLIC, anon, authenticated, service_role)
GRANT EXECUTE ON FUNCTION public.exportar_esquema_ryzos() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_jaula_tiene_otro_macho_activo(uuid,uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_son_parientes(uuid,uuid,integer) TO PUBLIC, anon, authenticated, service_role;

COMMIT;
