-- MITIGACIÓN PARCIAL DE EMERGENCIA — NO APLICADA TODAVÍA.
-- Quita SOLO la escritura `anon` (INSERT/UPDATE/DELETE) de INSPECCIONES
-- + las 6 tablas CAP_*, dejando el SELECT `anon` exactamente como está
-- hoy. Ver AI_STATE.md, entrada "Bloqueo de emergencia INSPECCIONES/CAP_*"
-- para el análisis completo de impacto antes de aplicar esto.
--
-- ADVERTENCIA REAL, NO HIPOTÉTICA (confirmada leyendo
-- components/features/inspecciones/useInspeccionForm.js +
-- lib/inspeccionesActions.js::saveInspeccion): el submit real del
-- formulario /dashboard/inspecciones (alta Y edición) llama a
-- `supabase.rpc('fn_guardar_inspeccion_completa', ...)` con el cliente
-- de llave `anon` (getSupabaseClient()) — esa función NO es
-- `SECURITY DEFINER`, corre con el rol del llamador. Aplicar esta
-- migración **rompe por completo el guardado de inspecciones** (alta y
-- edición, ambas pasan por la misma RPC) hasta que exista un reemplazo
-- `SECURITY DEFINER`. No es una mitigación "gratis" — es un apagón
-- deliberado de la escritura del módulo a cambio de cerrar la escritura
-- anónima. Aplicar solo si el apagón es aceptable en el momento.
--
-- Diseño: se reemplaza la única política `FOR ALL TO anon, authenticated`
-- de cada tabla por 2 políticas separadas por rol — SELECT para `anon`
-- (idéntica condición que hoy, sin cambios de comportamiento de lectura)
-- y FOR ALL para `authenticated` (preserva la escritura de ese rol tal
-- cual estaba, aunque hoy no hay ninguna sesión `authenticated` real que
-- la use — no se tocó por no ser parte de lo pedido).

BEGIN;

-- ── INSPECCIONES ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "rls_anon_all_inspecciones" ON public."INSPECCIONES";

CREATE POLICY "rls_select_inspecciones_anon" ON public."INSPECCIONES"
FOR SELECT TO anon
USING (
  "ID_Organizacion" IS NOT NULL
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

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

-- ── Las 6 CAP_* — mismo patrón, condición original USING(true) ──────
DROP POLICY IF EXISTS "rls_anon_all_cap_datos_socio" ON public."CAP_DATOS_SOCIO";
CREATE POLICY "rls_select_cap_datos_socio_anon" ON public."CAP_DATOS_SOCIO"
FOR SELECT TO anon USING (true);
CREATE POLICY "rls_all_cap_datos_socio_authenticated" ON public."CAP_DATOS_SOCIO"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_anon_all_cap_mic" ON public."CAP_MIC";
CREATE POLICY "rls_select_cap_mic_anon" ON public."CAP_MIC"
FOR SELECT TO anon USING (true);
CREATE POLICY "rls_all_cap_mic_authenticated" ON public."CAP_MIC"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_anon_all_cap_conservacion" ON public."CAP_CONSERVACION";
CREATE POLICY "rls_select_cap_conservacion_anon" ON public."CAP_CONSERVACION"
FOR SELECT TO anon USING (true);
CREATE POLICY "rls_all_cap_conservacion_authenticated" ON public."CAP_CONSERVACION"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_anon_all_cap_bienestar" ON public."CAP_BIENESTAR";
CREATE POLICY "rls_select_cap_bienestar_anon" ON public."CAP_BIENESTAR"
FOR SELECT TO anon USING (true);
CREATE POLICY "rls_all_cap_bienestar_authenticated" ON public."CAP_BIENESTAR"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_anon_all_cap_riesgos" ON public."CAP_RIESGOS";
CREATE POLICY "rls_select_cap_riesgos_anon" ON public."CAP_RIESGOS"
FOR SELECT TO anon USING (true);
CREATE POLICY "rls_all_cap_riesgos_authenticated" ON public."CAP_RIESGOS"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_anon_all_cap_gestion" ON public."CAP_GESTION";
CREATE POLICY "rls_select_cap_gestion_anon" ON public."CAP_GESTION"
FOR SELECT TO anon USING (true);
CREATE POLICY "rls_all_cap_gestion_authenticated" ON public."CAP_GESTION"
FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
