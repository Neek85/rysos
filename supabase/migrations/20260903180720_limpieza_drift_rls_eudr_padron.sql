-- Task 10: Limpieza de drift de políticas RLS en las 5 tablas EUDR/PADRON
-- (EUDR_MONITOREO, EUDR_INSTALACIONES, EUDR_USO_SUELO, PADRON_SOCIOS,
-- PADRON_PARCELAS) + creación de las políticas rls_select_*/rls_write_*
-- oficiales que faltaban en PADRON_SOCIOS/PADRON_PARCELAS.
--
-- Hallazgo (recon en vivo, 2026-09-03): 13 de las 21 políticas activas en
-- estas 5 tablas son huérfanas -- nunca creadas por ninguna migración
-- (rls_all_*, ryzos_all_monitoreo/_socios/_parcelas) o creadas por una
-- migración activa que un DROP POLICY IF EXISTS posterior debería haber
-- eliminado y no surtió efecto en producción (ryzos_all_eudr_*,
-- ryzos_all_padron_*) -- mismo patrón que ADR-032 documentó para
-- INSPECCIONES/CAP_*. Ninguna deja pasar a anon (verificado: dependen de
-- auth_org_id() o del mismo mecanismo de claim JWT subyacente, ambos NULL
-- sin sesión).
--
-- Hallazgo adicional, más serio: PADRON_SOCIOS y PADRON_PARCELAS NUNCA
-- tuvieron políticas rls_select_*/rls_write_* vivas pese a que
-- 20260816_fase3_seguridad_rls.sql las creó -- desaparecieron por fuera
-- del historial de migraciones (mismo patrón de cambios manuales en
-- Studio ya documentado en otras partes del proyecto). Sin esta
-- migración, borrar las políticas huérfanas de estas 2 tablas dejaría a
-- `authenticated` sin ningún acceso real -- por eso esta migración crea
-- primero las políticas oficiales y recién después borra las huérfanas.
--
-- Ver docs/adr/ADR-034-limpieza-drift-rls-eudr-padron.md para el detalle
-- completo.

BEGIN;

-- ============================================================
-- PARTE 1: crear las políticas oficiales que faltaban en
-- PADRON_SOCIOS y PADRON_PARCELAS (mismo patrón que las 3 tablas
-- EUDR ya tienen desde 20260818_rls_multi_tenant_fortification.sql)
-- ============================================================

DROP POLICY IF EXISTS "rls_select_padron_socios" ON public."PADRON_SOCIOS";
CREATE POLICY "rls_select_padron_socios" ON public."PADRON_SOCIOS"
  FOR SELECT
  TO authenticated
  USING (
    "ID_Organizacion" = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  );

DROP POLICY IF EXISTS "rls_write_padron_socios" ON public."PADRON_SOCIOS";
CREATE POLICY "rls_write_padron_socios" ON public."PADRON_SOCIOS"
  FOR ALL
  TO authenticated
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

DROP POLICY IF EXISTS "rls_select_padron_parcelas" ON public."PADRON_PARCELAS";
CREATE POLICY "rls_select_padron_parcelas" ON public."PADRON_PARCELAS"
  FOR SELECT
  TO authenticated
  USING (
    "ID_Organizacion" = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  );

DROP POLICY IF EXISTS "rls_write_padron_parcelas" ON public."PADRON_PARCELAS";
CREATE POLICY "rls_write_padron_parcelas" ON public."PADRON_PARCELAS"
  FOR ALL
  TO authenticated
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
-- PARTE 2: borrar las 13 políticas huérfanas/no documentadas
-- (idempotente -- IF EXISTS en todas, seguro de re-correr)
-- ============================================================

-- EUDR_MONITOREO (3 huérfanas)
DROP POLICY IF EXISTS "rls_all_eudr_monitoreo" ON public."EUDR_MONITOREO";
DROP POLICY IF EXISTS "ryzos_all_eudr_monitoreo" ON public."EUDR_MONITOREO";
DROP POLICY IF EXISTS "ryzos_all_monitoreo" ON public."EUDR_MONITOREO";

-- EUDR_INSTALACIONES (2 huérfanas)
DROP POLICY IF EXISTS "rls_all_eudr_instalaciones" ON public."EUDR_INSTALACIONES";
DROP POLICY IF EXISTS "ryzos_all_eudr_instalaciones" ON public."EUDR_INSTALACIONES";

-- EUDR_USO_SUELO (2 huérfanas)
DROP POLICY IF EXISTS "rls_all_eudr_uso_suelo" ON public."EUDR_USO_SUELO";
DROP POLICY IF EXISTS "ryzos_all_eudr_uso_suelo" ON public."EUDR_USO_SUELO";

-- PADRON_SOCIOS (3 huérfanas)
DROP POLICY IF EXISTS "rls_all_padron_socios" ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "ryzos_all_padron_socios" ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "ryzos_all_socios" ON public."PADRON_SOCIOS";

-- PADRON_PARCELAS (3 huérfanas)
DROP POLICY IF EXISTS "rls_all_padron_parcelas" ON public."PADRON_PARCELAS";
DROP POLICY IF EXISTS "ryzos_all_padron_parcelas" ON public."PADRON_PARCELAS";
DROP POLICY IF EXISTS "ryzos_all_parcelas" ON public."PADRON_PARCELAS";

COMMIT;
