-- MIGRACIÓN IDEMPOTENTE (NO APLICADA TODAVÍA -- pendiente de revisión).
--
-- Fase A del login real por organización y rol (ver
-- specs/login_real_organizacion_rol.md,
-- plans/login_real_organizacion_rol_fase_a_ejecucion.md). Capa de
-- identidad pura: 1 tabla nueva + 1 función nueva + 1 función
-- redefinida. Sin login en el frontend todavía, sin tocar
-- INSPECCIONES/CAP_*, sin retirar el gate de Basic Auth
-- (middleware.js). INERTE EN COMPORTAMIENTO HOY: nadie tiene sesión
-- `authenticated` real todavía, así que:
--   - PERFILES_USUARIO_INTERNOS nace vacía -- sus 2 políticas de SELECT
--     no tienen ningún usuario real que las ejercite.
--   - auth_role() (nueva) siempre devuelve NULL hoy (sin filas en la
--     tabla nueva, sin sesiones authenticated reales).
--   - auth_org_id() (redefinida) preserva su comportamiento actual
--     (NULL) -- el SELECT a la tabla nueva no encuentra ninguna fila,
--     y el fallback al claim JWT legacy sigue igual que antes (también
--     NULL hoy, confirmado en vivo: `anon` lo llama y devuelve null).
--   - Las 6 políticas RLS que ya usan auth_org_id()
--     (ORGANIZACIONES/PADRON_SOCIOS/PADRON_PARCELAS/EUDR_MONITOREO/
--     EUDR_INSTALACIONES/EUDR_USO_SUELO) siguen deny-all para
--     `authenticated` -- cero cambio de comportamiento observable en
--     /dashboard/* hoy.
--
-- Verificación previa (paso 1, hecha antes de escribir esto, contra la
-- instancia real vía REST -- sin conexión Postgres directa disponible
-- en este entorno, mismo límite ya documentado desde 2026-08-25b):
--   - auth_org_id() existe, callable vía anon, devuelve `null` hoy.
--     Definición SQL confirmada cruzando
--     supabase/migrations/20260816_fase3_seguridad_rls.sql (única
--     migración del repo que la define, sin redefinición posterior)
--     contra el diseño de esta tarea -- coincide carácter por carácter
--     (LANGUAGE sql STABLE, sin SECURITY DEFINER, mismo SELECT).
--   - public.auth_role() NO existe (PGRST202 al invocarla).
--   - public."PERFILES_USUARIO_INTERNOS" NO existe (PGRST205).
--   - public."ORGANIZACIONES"."ID" confirmado real (COOP-AROMAS-VALLE,
--     ORG-TEST-DEMO) para el FOREIGN KEY de abajo.
--
-- ADVERTENCIA DE COMPATIBILIDAD verificada: auth_org_id() hoy NO tiene
-- ningún GRANT/REVOKE explícito documentado en docs/schema_live.md ni
-- en la migración original -- tiene el default de Postgres (EXECUTE a
-- PUBLIC, confirmado en vivo: la llamada anon de arriba funcionó sin
-- 42501). Pasar a SECURITY DEFINER + REVOKE ALL FROM PUBLIC + GRANT
-- EXECUTE TO authenticated, anon, service_role PRESERVA el acceso de
-- anon/authenticated explícitamente (mismos roles que ya podían
-- llamarla antes vía el grant default a PUBLIC) -- es un endurecimiento
-- estricto (cierra el acceso a cualquier OTRO rol de base de datos que
-- pudiera existir), nunca un ensanche. Ningún consumidor actual (las 6
-- políticas RLS, trg_set_id_organizacion() vía get_my_org_id()) pierde
-- acceso.

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- 1. Tabla de perfiles internos -- sin política de escritura para
--    `authenticated`: el aprovisionamiento (Fase D) es exclusivamente
--    vía Service Role Key desde un script server-side. Ningún rol
--    interno puede auto-asignarse un rol ni cambiar su propia
--    organización.
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."PERFILES_USUARIO_INTERNOS" (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  "ID_Organizacion" text NOT NULL REFERENCES public."ORGANIZACIONES"("ID"),
  rol text NOT NULL CHECK (rol IN ('admin','tecnico_campo','auditor_qc')),
  nombre_completo text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."PERFILES_USUARIO_INTERNOS" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_select_propio_perfil" ON public."PERFILES_USUARIO_INTERNOS";
CREATE POLICY "rls_select_propio_perfil" ON public."PERFILES_USUARIO_INTERNOS"
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_select_perfiles_admin_misma_org" ON public."PERFILES_USUARIO_INTERNOS";
CREATE POLICY "rls_select_perfiles_admin_misma_org" ON public."PERFILES_USUARIO_INTERNOS"
FOR SELECT TO authenticated
USING (
  current_user = 'postgres'
  OR (public.auth_role() = 'admin' AND "ID_Organizacion" = public.auth_org_id())
);

CREATE INDEX IF NOT EXISTS idx_perfiles_usuario_internos_org ON public."PERFILES_USUARIO_INTERNOS"("ID_Organizacion");

-- ════════════════════════════════════════════════════════════════════
-- 2. auth_role() -- nueva. SECURITY DEFINER para poder leer
--    PERFILES_USUARIO_INTERNOS sin depender de que la política de
--    SELECT del propio perfil ya haya resuelto (evita recursión con la
--    política "admin misma org", que llama a esta función).
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rol FROM public."PERFILES_USUARIO_INTERNOS"
  WHERE user_id = auth.uid() AND activo = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_role() TO authenticated, anon, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 3. auth_org_id() -- REDEFINIDA (mismo nombre y firma, CREATE OR
--    REPLACE, no rompe nada que ya la llama: trg_set_id_organizacion()
--    vía el alias get_my_org_id(), ni las 6 políticas RLS ya
--    declaradas). Perfil de la tabla nueva como fuente primaria, el
--    claim JWT legacy como fallback secundario (hoy siempre NULL,
--    preservado por si en el futuro se agrega un Auth Hook).
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.auth_org_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p."ID_Organizacion" FROM public."PERFILES_USUARIO_INTERNOS" p
       WHERE p.user_id = auth.uid() AND p.activo = true LIMIT 1),
    NULLIF(current_setting('request.jwt.claims', true)::json->>'ID_Organizacion', '')::text
  );
$$;

REVOKE ALL ON FUNCTION public.auth_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_org_id() TO authenticated, anon, service_role;

COMMIT;
