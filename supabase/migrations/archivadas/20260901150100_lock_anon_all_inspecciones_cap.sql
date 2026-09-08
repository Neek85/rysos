-- CONTENCIÓN COMPLETA DE EMERGENCIA — NO APLICADA TODAVÍA.
-- Quita TODO acceso `anon` (lectura Y escritura) a INSPECCIONES + las
-- 6 tablas CAP_*. Ver AI_STATE.md, entrada "Bloqueo de emergencia
-- INSPECCIONES/CAP_*" para el análisis completo de impacto.
--
-- INDEPENDIENTE de si 20260901150000_lock_anon_write_inspecciones_cap.sql
-- se aplicó antes o no — este archivo hace DROP de los nombres de
-- política de AMBAS versiones (la original de
-- 20260818_fix_inspecciones_rls.sql y la parcial del archivo de arriba)
-- y vuelve a crear la política de `authenticated` desde cero en los dos
-- casos, para no dejar a ese rol sin ninguna política si esta migración
-- se aplica SIN pasar primero por la parcial (el `DROP POLICY` de la
-- original `rls_anon_all_inspecciones`/`rls_anon_all_cap_*` se llevaría
-- también el acceso de `authenticated`, que hoy vive en la MISMA política
-- combinada `TO anon, authenticated`).
--
-- ROMPE (además de todo lo que ya rompía la migración parcial):
-- fetchInspecciones (listado, /dashboard/inspecciones),
-- fetchInspeccionDetalle (ver/editar una inspección existente,
-- /dashboard/inspecciones/[id]/editar). El módulo de Inspecciones queda
-- completamente inutilizable desde el navegador con la llave `anon`
-- (que es la única que el frontend usa hoy — no hay sesión
-- `authenticated` real, ver CLAUDE.md) hasta que exista el reemplazo
-- `SECURITY DEFINER` (ver AI_STATE.md, mecanismo propuesto en la
-- entrada anterior sobre PADRON_SOCIOS/PADRON_PARCELAS — mismo patrón
-- aplica acá).

BEGIN;

-- ── INSPECCIONES ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "rls_anon_all_inspecciones"       ON public."INSPECCIONES"; -- original 20260818
DROP POLICY IF EXISTS "rls_select_inspecciones_anon"    ON public."INSPECCIONES"; -- de la migración parcial
DROP POLICY IF EXISTS "rls_all_inspecciones_authenticated" ON public."INSPECCIONES";

CREATE POLICY "rls_anon_deny_inspecciones" ON public."INSPECCIONES"
FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "rls_all_inspecciones_authenticated" ON public."INSPECCIONES"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" IS NOT NULL
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" IS NOT NULL
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- ── Las 6 CAP_* — mismo patrón ───────────────────────────────────────
DROP POLICY IF EXISTS "rls_anon_all_cap_datos_socio"    ON public."CAP_DATOS_SOCIO";
DROP POLICY IF EXISTS "rls_select_cap_datos_socio_anon" ON public."CAP_DATOS_SOCIO";
DROP POLICY IF EXISTS "rls_all_cap_datos_socio_authenticated" ON public."CAP_DATOS_SOCIO";
CREATE POLICY "rls_anon_deny_cap_datos_socio" ON public."CAP_DATOS_SOCIO"
FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "rls_all_cap_datos_socio_authenticated" ON public."CAP_DATOS_SOCIO"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_anon_all_cap_mic"    ON public."CAP_MIC";
DROP POLICY IF EXISTS "rls_select_cap_mic_anon" ON public."CAP_MIC";
DROP POLICY IF EXISTS "rls_all_cap_mic_authenticated" ON public."CAP_MIC";
CREATE POLICY "rls_anon_deny_cap_mic" ON public."CAP_MIC"
FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "rls_all_cap_mic_authenticated" ON public."CAP_MIC"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_anon_all_cap_conservacion"    ON public."CAP_CONSERVACION";
DROP POLICY IF EXISTS "rls_select_cap_conservacion_anon" ON public."CAP_CONSERVACION";
DROP POLICY IF EXISTS "rls_all_cap_conservacion_authenticated" ON public."CAP_CONSERVACION";
CREATE POLICY "rls_anon_deny_cap_conservacion" ON public."CAP_CONSERVACION"
FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "rls_all_cap_conservacion_authenticated" ON public."CAP_CONSERVACION"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_anon_all_cap_bienestar"    ON public."CAP_BIENESTAR";
DROP POLICY IF EXISTS "rls_select_cap_bienestar_anon" ON public."CAP_BIENESTAR";
DROP POLICY IF EXISTS "rls_all_cap_bienestar_authenticated" ON public."CAP_BIENESTAR";
CREATE POLICY "rls_anon_deny_cap_bienestar" ON public."CAP_BIENESTAR"
FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "rls_all_cap_bienestar_authenticated" ON public."CAP_BIENESTAR"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_anon_all_cap_riesgos"    ON public."CAP_RIESGOS";
DROP POLICY IF EXISTS "rls_select_cap_riesgos_anon" ON public."CAP_RIESGOS";
DROP POLICY IF EXISTS "rls_all_cap_riesgos_authenticated" ON public."CAP_RIESGOS";
CREATE POLICY "rls_anon_deny_cap_riesgos" ON public."CAP_RIESGOS"
FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "rls_all_cap_riesgos_authenticated" ON public."CAP_RIESGOS"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_anon_all_cap_gestion"    ON public."CAP_GESTION";
DROP POLICY IF EXISTS "rls_select_cap_gestion_anon" ON public."CAP_GESTION";
DROP POLICY IF EXISTS "rls_all_cap_gestion_authenticated" ON public."CAP_GESTION";
CREATE POLICY "rls_anon_deny_cap_gestion" ON public."CAP_GESTION"
FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "rls_all_cap_gestion_authenticated" ON public."CAP_GESTION"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
