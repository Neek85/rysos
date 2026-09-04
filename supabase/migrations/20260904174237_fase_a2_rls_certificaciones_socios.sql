-- Fase A.2 del piloto Camino 1 (ver docs/adr/ADR-037-fase-a2-rls-
-- certificaciones-socios.md): cierra los 2 gaps que bloqueaban migrar
-- createSocio/updateSocio/resolveSocioCertFlags (lib/actions/sociosActions.js)
-- de Service Role Key a sesión real, confirmados en el reconocimiento de
-- Fase A y reverificados en vivo antes de escribir esta migración:
--
--   1. SOCIO_CERTIFICACIONES/CERTIFICACIONES_CATALOGO no tenían NINGUNA
--      política RLS para `authenticated` (solo `anon SELECT`, sin tocar
--      acá). RLS está habilitado en ambas -- sin política que aplique a
--      `authenticated`, ese rol quedaba denegado por completo.
--   2. fn_crear_socio_con_certificaciones no tenía GRANT EXECUTE para
--      `authenticated` -- solo postgres/service_role. Firma confirmada
--      en vivo (pg_get_function_identity_arguments): p_id_socio text,
--      p_organizacion text, p_socio jsonb, p_certificaciones jsonb.
--
-- Verificado antes de escribir (solo lectura, sin cambios):
--   - SOCIO_CERTIFICACIONES: 4414 filas totales, 0 con id_organizacion
--     IS NULL -- ninguna fila queda invisible bajo la condición nueva.
--   - Las 2 políticas `anon` existentes (rls_anon_select_socio_certificaciones,
--     rls_anon_select_certificaciones_catalogo) siguen intactas, NO se
--     tocan acá -- exportSociosCsv depende de ellas.
--
-- Con esto, lib/actions/sociosActions.js queda 100% bajo RLS de sesión
-- real -- cierra Fase A.2 completa (ver ADR-037).

BEGIN;

-- ============================================================
-- SOCIO_CERTIFICACIONES -- 2 políticas nuevas para authenticated,
-- misma condición estándar que ADR-034/035/036, columna en minúscula
-- (id_organizacion, no "ID_Organizacion" -- schema real de esta tabla).
-- La política anon existente NO se toca.
-- ============================================================

DROP POLICY IF EXISTS "rls_select_socio_certificaciones" ON public."SOCIO_CERTIFICACIONES";
CREATE POLICY "rls_select_socio_certificaciones" ON public."SOCIO_CERTIFICACIONES"
  FOR SELECT
  TO authenticated
  USING (
    id_organizacion = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  );

DROP POLICY IF EXISTS "rls_write_socio_certificaciones" ON public."SOCIO_CERTIFICACIONES";
CREATE POLICY "rls_write_socio_certificaciones" ON public."SOCIO_CERTIFICACIONES"
  FOR ALL
  TO authenticated
  USING (
    id_organizacion = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
  WITH CHECK (
    id_organizacion = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  );

-- ============================================================
-- CERTIFICACIONES_CATALOGO -- 1 política nueva de SOLO LECTURA para
-- authenticated. Catálogo compartido, sin columna de organización --
-- mismo criterio que la política anon ya existente (USING true). Sin
-- política de escritura: ninguna función de sociosActions.js escribe
-- en este catálogo.
-- ============================================================

DROP POLICY IF EXISTS "rls_select_certificaciones_catalogo_authenticated" ON public."CERTIFICACIONES_CATALOGO";
CREATE POLICY "rls_select_certificaciones_catalogo_authenticated" ON public."CERTIFICACIONES_CATALOGO"
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- fn_crear_socio_con_certificaciones -- GRANT EXECUTE para authenticated
-- (antes: solo postgres/service_role). SECURITY INVOKER (sin cláusula
-- explícita, confirmado en el reconocimiento de Fase A) -- corre con el
-- rol de quien la invoca, así que sus propios INSERT (PADRON_SOCIOS,
-- SOCIO_CERTIFICACIONES) ya quedan sujetos al RLS real de authenticated
-- (ADR-034 + las 2 políticas nuevas de arriba), no a un bypass.
-- ============================================================

GRANT EXECUTE ON FUNCTION public.fn_crear_socio_con_certificaciones(
  p_id_socio text, p_organizacion text, p_socio jsonb, p_certificaciones jsonb
) TO authenticated;

COMMIT;
