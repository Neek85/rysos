-- FASE C PASO 2 (login real por organización y rol,
-- specs/login_real_organizacion_rol.md §6): aislamiento REAL por
-- organización en INSPECCIONES + las 6 tablas CAP_*, y cierre completo
-- de `anon`. Ver ADR-033 para el diseño completo, la verificación
-- previa (esta sesión) y las salvedades encontradas.
--
-- QUÉ REEMPLAZA: las 7 políticas combinadas `FOR ALL TO anon,
-- authenticated` (`rls_anon_all_inspecciones` +
-- `rls_anon_all_cap_datos_socio/mic/conservacion/bienestar/riesgos/
-- gestion`, de 20260818_fix_inspecciones_rls.sql) daban acceso
-- IDÉNTICO a `anon` y a `authenticated`, sin distinguir organización:
-- INSPECCIONES exigía solo `"ID_Organizacion" IS NOT NULL` (cierto para
-- CUALQUIER fila con ese campo cargado, de cualquier organización) y las
-- 6 CAP_* exigían literalmente `USING (true)` -- sin ninguna condición.
--
-- POR QUÉ ES SEGURO PARA EL FLUJO REAL (verificado en esta sesión, no
-- supuesto):
--   1. Los 3 call sites reales de guardado/lectura
--      (components/features/inspecciones/useInspeccionForm.js,
--      lib/inspeccionesActions.js) ya usan getSupabaseBrowserClient()
--      (cliente de sesión real, Fase B) desde Fase C Paso 1 (commit
--      6cc19f0) -- no el cliente `anon`. Una vez logueado, ese cliente
--      manda el JWT de sesión real (role: authenticated) en cada
--      request, no la llave anon cruda -- comportamiento estándar de
--      @supabase/ssr, no lógica propia de este repo.
--   2. fn_guardar_inspeccion_completa() (20260903045407) NO es SECURITY
--      DEFINER -- corre con el rol del llamador. Confirmado, línea por
--      línea, que en AMBAS ramas (creación y edición) el INSERT/UPDATE
--      de INSPECCIONES ocurre ANTES que los 6 pares DELETE+INSERT de
--      CAP_*, dentro de la MISMA transacción implícita -- así que el
--      EXISTS de las políticas de CAP_* de abajo siempre encuentra la
--      fila de INSPECCIONES ya escrita (visibilidad estándar de
--      Postgres dentro de una misma transacción, sin subtransacciones
--      ni COMMIT intermedios en la función).
--   3. auth_org_id() (20260902213506, ya aplicada y verificada contra
--      pg_proc en esta sesión) resuelve la organización real desde
--      PERFILES_USUARIO_INTERNOS para cualquier sesión authenticated
--      real -- las 5 cuentas de Fase D Paso 1 ya la ejercitan.
--
-- QUÉ CIERRA:
--   - Acceso `anon` directo vía REST con la llave pública (embebida en
--     el bundle JS, nunca secreta) -- hoy CUALQUIERA con esa llave
--     puede leer/escribir/borrar las 7 tablas sin login, sin sesión, sin
--     pasar por ninguna pantalla de RYZOS. Pasa a `USING (false)` --
--     deniega TODO para `anon` (no solo escritura, también lectura;
--     distinto de la mitigación parcial de 20260901150000, que solo
--     cerraba escritura).
--   - Aislamiento cross-org real: hoy la única barrera contra que una
--     sesión de una organización escriba/lea filas de OTRA organización
--     es un parámetro (`p_organizacion`) que el propio cliente decide
--     qué valor mandarle a la RPC -- confiado, no verificado contra la
--     sesión real. La política nueva de `authenticated` exige
--     "ID_Organizacion" = auth_org_id() (INSPECCIONES) o el EXISTS
--     equivalente contra INSPECCIONES (las 6 CAP_*) -- ahora la sesión
--     real, no el parámetro del cliente, decide qué organización puede
--     tocar cada fila.
--
-- SUPERSEDE, NO COMPLEMENTA, a las 2 migraciones de contención de
-- emergencia preparadas y sin aplicar
-- (20260901150000_lock_anon_write_inspecciones_cap.sql,
-- 20260901150100_lock_anon_all_inspecciones_cap.sql) -- esas usaban
-- `authenticated ... USING (true)` (CAP_*) o `IS NOT NULL` (INSPECCIONES),
-- el mismo hueco sin aislamiento real, solo restringido a un rol
-- distinto. Esta migración hace defensivamente DROP POLICY IF EXISTS de
-- TODOS los nombres de política de las 3 generaciones (original de
-- 20260818, la parcial de 150000, y la completa de 150100) para poder
-- aplicarse sin importar cuál de las 3 esté vigente al momento real de
-- aplicación -- pero **160000/150100 no deberían aplicarse nunca junto
-- con ni después de esta migración**: sus nombres de política
-- `rls_anon_deny_*` colisionan literalmente con los que crea esta migración
-- (mismo nombre, definición distinta) -- un CREATE POLICY duplicado
-- fallaría con 42710. Recomendado archivar o eliminar esos 2 archivos
-- una vez esta migración se apruebe (ver ADR-033).
--
-- SALVEDAD IMPORTANTE, NO RESUELTA POR ESTA MIGRACIÓN (ver ADR-033,
-- sección "Hallazgo colateral"): esta migración por sí sola NO restaura
-- un flujo de creación funcional desde el navegador real hoy --
-- `resolveOrganizationId()` (lib/inspeccionesActions.js, usado por
-- useInspeccionForm.js) deriva `organizationId` mirando los registros
-- YA CARGADOS de INSPECCIONES, no la sesión real. Con INSPECCIONES
-- vacía (0 filas, ver AI_STATE.md 2026-09-03f/g), esa resolución
-- siempre da `null` y el guardado nunca llega a la RPC -- un bug
-- preexistente, independiente de RLS, que sigue igual antes y después
-- de esta migración.

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- INSPECCIONES
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rls_anon_all_inspecciones" ON public."INSPECCIONES";           -- original 20260818
DROP POLICY IF EXISTS "rls_select_inspecciones_anon" ON public."INSPECCIONES";        -- parcial 20260901150000
DROP POLICY IF EXISTS "rls_all_inspecciones_authenticated" ON public."INSPECCIONES";  -- parcial/completa 150000/150100
DROP POLICY IF EXISTS "rls_anon_deny_inspecciones" ON public."INSPECCIONES";          -- completa 20260901150100
DROP POLICY IF EXISTS "rls_write_inspecciones_authenticated" ON public."INSPECCIONES"; -- por si se re-corre esta misma migración

CREATE POLICY "rls_anon_deny_inspecciones" ON public."INSPECCIONES"
FOR ALL TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY "rls_write_inspecciones_authenticated" ON public."INSPECCIONES"
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

-- ════════════════════════════════════════════════════════════════════
-- CAP_DATOS_SOCIO
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rls_anon_all_cap_datos_socio" ON public."CAP_DATOS_SOCIO";
DROP POLICY IF EXISTS "rls_select_cap_datos_socio_anon" ON public."CAP_DATOS_SOCIO";
DROP POLICY IF EXISTS "rls_all_cap_datos_socio_authenticated" ON public."CAP_DATOS_SOCIO";
DROP POLICY IF EXISTS "rls_anon_deny_cap_datos_socio" ON public."CAP_DATOS_SOCIO";
DROP POLICY IF EXISTS "rls_write_cap_datos_socio_authenticated" ON public."CAP_DATOS_SOCIO";

CREATE POLICY "rls_anon_deny_cap_datos_socio" ON public."CAP_DATOS_SOCIO"
FOR ALL TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY "rls_write_cap_datos_socio_authenticated" ON public."CAP_DATOS_SOCIO"
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_DATOS_SOCIO"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_DATOS_SOCIO"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- ════════════════════════════════════════════════════════════════════
-- CAP_MIC
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rls_anon_all_cap_mic" ON public."CAP_MIC";
DROP POLICY IF EXISTS "rls_select_cap_mic_anon" ON public."CAP_MIC";
DROP POLICY IF EXISTS "rls_all_cap_mic_authenticated" ON public."CAP_MIC";
DROP POLICY IF EXISTS "rls_anon_deny_cap_mic" ON public."CAP_MIC";
DROP POLICY IF EXISTS "rls_write_cap_mic_authenticated" ON public."CAP_MIC";

CREATE POLICY "rls_anon_deny_cap_mic" ON public."CAP_MIC"
FOR ALL TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY "rls_write_cap_mic_authenticated" ON public."CAP_MIC"
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_MIC"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_MIC"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- ════════════════════════════════════════════════════════════════════
-- CAP_CONSERVACION
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rls_anon_all_cap_conservacion" ON public."CAP_CONSERVACION";
DROP POLICY IF EXISTS "rls_select_cap_conservacion_anon" ON public."CAP_CONSERVACION";
DROP POLICY IF EXISTS "rls_all_cap_conservacion_authenticated" ON public."CAP_CONSERVACION";
DROP POLICY IF EXISTS "rls_anon_deny_cap_conservacion" ON public."CAP_CONSERVACION";
DROP POLICY IF EXISTS "rls_write_cap_conservacion_authenticated" ON public."CAP_CONSERVACION";

CREATE POLICY "rls_anon_deny_cap_conservacion" ON public."CAP_CONSERVACION"
FOR ALL TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY "rls_write_cap_conservacion_authenticated" ON public."CAP_CONSERVACION"
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_CONSERVACION"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_CONSERVACION"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- ════════════════════════════════════════════════════════════════════
-- CAP_BIENESTAR
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rls_anon_all_cap_bienestar" ON public."CAP_BIENESTAR";
DROP POLICY IF EXISTS "rls_select_cap_bienestar_anon" ON public."CAP_BIENESTAR";
DROP POLICY IF EXISTS "rls_all_cap_bienestar_authenticated" ON public."CAP_BIENESTAR";
DROP POLICY IF EXISTS "rls_anon_deny_cap_bienestar" ON public."CAP_BIENESTAR";
DROP POLICY IF EXISTS "rls_write_cap_bienestar_authenticated" ON public."CAP_BIENESTAR";

CREATE POLICY "rls_anon_deny_cap_bienestar" ON public."CAP_BIENESTAR"
FOR ALL TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY "rls_write_cap_bienestar_authenticated" ON public."CAP_BIENESTAR"
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_BIENESTAR"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_BIENESTAR"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- ════════════════════════════════════════════════════════════════════
-- CAP_RIESGOS
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rls_anon_all_cap_riesgos" ON public."CAP_RIESGOS";
DROP POLICY IF EXISTS "rls_select_cap_riesgos_anon" ON public."CAP_RIESGOS";
DROP POLICY IF EXISTS "rls_all_cap_riesgos_authenticated" ON public."CAP_RIESGOS";
DROP POLICY IF EXISTS "rls_anon_deny_cap_riesgos" ON public."CAP_RIESGOS";
DROP POLICY IF EXISTS "rls_write_cap_riesgos_authenticated" ON public."CAP_RIESGOS";

CREATE POLICY "rls_anon_deny_cap_riesgos" ON public."CAP_RIESGOS"
FOR ALL TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY "rls_write_cap_riesgos_authenticated" ON public."CAP_RIESGOS"
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_RIESGOS"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_RIESGOS"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- ════════════════════════════════════════════════════════════════════
-- CAP_GESTION
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rls_anon_all_cap_gestion" ON public."CAP_GESTION";
DROP POLICY IF EXISTS "rls_select_cap_gestion_anon" ON public."CAP_GESTION";
DROP POLICY IF EXISTS "rls_all_cap_gestion_authenticated" ON public."CAP_GESTION";
DROP POLICY IF EXISTS "rls_anon_deny_cap_gestion" ON public."CAP_GESTION";
DROP POLICY IF EXISTS "rls_write_cap_gestion_authenticated" ON public."CAP_GESTION";

CREATE POLICY "rls_anon_deny_cap_gestion" ON public."CAP_GESTION"
FOR ALL TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY "rls_write_cap_gestion_authenticated" ON public."CAP_GESTION"
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_GESTION"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."INSPECCIONES" i
    WHERE i."ID_Inspeccion" = "CAP_GESTION"."ID_Inspeccion"
      AND i."ID_Organizacion" = public.auth_org_id()
  )
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

COMMIT;
