-- LIMPIEZA DE DRIFT: 8 políticas RLS huérfanas, nombradas en español,
-- encontradas en INSPECCIONES + las 6 tablas CAP_* — ver ADR-032
-- (docs/adr/ADR-032-limpieza-drift-rls-espanol.md) para el hallazgo
-- completo y la verificación de neutralidad.
--
-- ORIGEN: creadas fuera de este repo (probablemente directo en Supabase
-- Studio, en algún punto anterior a que estas 7 tablas empezaran a tener
-- migraciones propias acá) — confirmado con grep exacto de cada nombre
-- contra supabase/migrations/*.sql completo: ninguna migración, aplicada
-- o no, las crea, las referencia, ni depende de encontrarlas.
--
-- VERIFICADO COMO REDUNDANTE, no solo "probablemente igual" (contra la
-- instancia real, ver ADR-032):
--   - INSPECCIONES: "Permitir edicion desde el panel web" (UPDATE,
--     {public}, qual true) y "Permitir lectura al panel web" (SELECT,
--     {public}, qual true) cubren exactamente el mismo universo de filas
--     que la política oficial rls_anon_all_inspecciones
--     (20260818_fix_inspecciones_rls.sql, "ID_Organizacion" IS NOT NULL)
--     -- confirmado con SELECT count(*) FROM "INSPECCIONES" WHERE
--     "ID_Organizacion" IS NULL = 0, así que "IS NOT NULL" y "true" son
--     equivalentes sobre los datos reales de hoy.
--   - Las 6 CAP_*: "Permitir web SOCIO"/"Permitir web MIC" (ALL,
--     {public}, qual true) son subconjunto trivial de las oficiales
--     rls_anon_all_cap_* (ALL, {anon,authenticated}, USING(true) WITH
--     CHECK(true)) -- estas ya no tienen ninguna condición que filtrar,
--     así que cualquier fila que la política en español dejara pasar la
--     oficial también la deja pasar.
--
-- Este DROP no cambia ningún comportamiento de acceso real hoy -- es
-- limpieza de superficie RLS, no un endurecimiento de seguridad. El
-- drift más amplio en EUDR_MONITOREO/EUDR_INSTALACIONES/EUDR_USO_SUELO/
-- PADRON_SOCIOS/PADRON_PARCELAS (políticas rls_all_*/ryzos_all_*
-- huérfanas) y el endurecimiento real de anon en INSPECCIONES/CAP_*
-- (Fase C Paso 2, bloqueado por fn_guardar_inspeccion_completa no-
-- SECURITY-DEFINER) quedan explícitamente FUERA de alcance de esta
-- migración -- ver ADR-032, sección "Fuera de alcance".

BEGIN;

DROP POLICY IF EXISTS "Permitir edicion desde el panel web" ON public."INSPECCIONES";
DROP POLICY IF EXISTS "Permitir lectura al panel web" ON public."INSPECCIONES";

DROP POLICY IF EXISTS "Permitir web SOCIO" ON public."CAP_DATOS_SOCIO";
DROP POLICY IF EXISTS "Permitir web MIC" ON public."CAP_MIC";
DROP POLICY IF EXISTS "Permitir web MIC" ON public."CAP_CONSERVACION";
DROP POLICY IF EXISTS "Permitir web MIC" ON public."CAP_BIENESTAR";
DROP POLICY IF EXISTS "Permitir web MIC" ON public."CAP_RIESGOS";
DROP POLICY IF EXISTS "Permitir web MIC" ON public."CAP_GESTION";

COMMIT;
