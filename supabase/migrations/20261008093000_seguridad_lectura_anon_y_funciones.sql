-- =====================================================================
-- 20261008093000_seguridad_lectura_anon_y_funciones.sql
-- SEGURIDAD - Cerrar lectura anonima sin lector + EXECUTE anonimo de 3 funciones
-- =====================================================================
-- HALLAZGO (reconocimiento de catalogos 2026-10-08, solo lectura)
--   A) 4 tablas con RLS tienen una politica SELECT para anon copiada del
--      patron antiguo de PADRON_* (que ADR-031/034 ya cerraron a USING false):
--        AGENCIAS_CERTIFICADORAS      USING true
--        ORGANIZACION_CERTIFICACIONES USING (id_organizacion IS NOT NULL)
--        ORGANIZACION_PRODUCTOS       USING (id_organizacion IS NOT NULL)
--        PARCELA_CERTIFICACIONES      USING (id_organizacion IS NOT NULL)
--      "IS NOT NULL" equivale a todas las filas de todas las organizaciones.
--      Ningun codigo del repo las lee con llave anon.
--   B) 3 funciones SECURITY DEFINER son ejecutables por anon y PUBLIC:
--        exportar_esquema_ryzos()                 (devuelve el esquema completo)
--        fn_jaula_tiene_otro_macho_activo(uuid,uuid)
--        fn_son_parientes(uuid,uuid,integer)
--      Ningun codigo del repo las llama por rpc.
--
-- QUE HACE
--   A) ALTER POLICY ... USING (false) en las 4 politicas anon (mismo criterio
--      que ADR-031/034). Si la politica no existe, avisa y sigue.
--   B) REVOKE EXECUTE FROM PUBLIC, anon en las 3 funciones y GRANT EXECUTE
--      explicito a authenticated y service_role, para no romper triggers o
--      politicas que las invoquen con una sesion authenticated.
--
-- QUE NO HACE
--   - NO toca SOCIO_CERTIFICACIONES: la exportacion CSV del padron la lee en
--     el navegador con llave anon (lib/padronCsv.js:203,1409). Cerrarla sin
--     antes mover esas lecturas a una Server Action daria 0 filas SIN error.
--   - NO toca CERTIFICACIONES_CATALOGO ni PRODUCTOS (catalogos con lector anon real).
--   - No revoca EXECUTE a authenticated en exportar_esquema_ryzos(): se decide
--     tras confirmar que nadie la usa con sesion.
--   - No toca las 9 funciones trigger (no son invocables por rpc).
--
-- ANTES DE APLICAR (el CLI lo verifica, solo lectura)
--   Que ninguna vista, funcion, politica, restriccion ni trigger dependa de
--   las 4 tablas con la llave anon, ni invoque las 3 funciones como anon.
--
-- ROLLBACK
--   ALTER POLICY <nombre> ON public.<tabla> USING (<qual previa del snapshot>);
--   GRANT EXECUTE ON FUNCTION ... TO PUBLIC, anon;
--
-- IDEMPOTENTE. Transaccional.
-- APLICACION MANUAL por Neyser en Supabase Studio. El CLI no aplica nada.
-- Redacto: Claude (Cowork). Revision de seguridad: ver docs/ESTADO_PROYECTO.md.
-- =====================================================================

BEGIN;

-- A) Politicas anon sin lector
DO $politicas$
DECLARE
  r record;
  v_qual text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('AGENCIAS_CERTIFICADORAS',      'rls_anon_select_agencias_certificadoras'),
      ('ORGANIZACION_CERTIFICACIONES', 'rls_anon_select_organizacion_certificaciones'),
      ('ORGANIZACION_PRODUCTOS',       'rls_anon_select_organizacion_productos'),
      ('PARCELA_CERTIFICACIONES',      'rls_anon_select_parcela_certificaciones')
    ) AS t(tabla, politica)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = r.tabla AND policyname = r.politica
    ) THEN
      RAISE NOTICE 'Politica % en public.% no existe: se omite', r.politica, r.tabla;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER POLICY %I ON public.%I USING (false)', r.politica, r.tabla);

    SELECT qual INTO v_qual FROM pg_policies
     WHERE schemaname = 'public' AND tablename = r.tabla AND policyname = r.politica;
    IF v_qual IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'La politica % de public.% no quedo en false (qual=%)', r.politica, r.tabla, v_qual;
    END IF;
  END LOOP;
END
$politicas$;

-- B) EXECUTE anonimo de 3 funciones SECURITY DEFINER
DO $funciones$
DECLARE
  v_firma text;
  v_fn    regprocedure;
BEGIN
  FOREACH v_firma IN ARRAY ARRAY[
    'public.exportar_esquema_ryzos()',
    'public.fn_jaula_tiene_otro_macho_activo(uuid,uuid)',
    'public.fn_son_parientes(uuid,uuid,integer)'
  ] LOOP
    v_fn := to_regprocedure(v_firma);
    IF v_fn IS NULL THEN
      RAISE NOTICE 'Funcion % no existe: se omite', v_firma;
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon aun puede ejecutar %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated perdio EXECUTE en %', v_fn;
    END IF;
  END LOOP;
END
$funciones$;

COMMIT;
