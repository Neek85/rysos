-- =====================================================================
-- 20261008092000_seguridad_tablas_sin_rls_sin_acceso_cliente.sql
-- SEGURIDAD - Tablas sin RLS: activar RLS y quitar acceso a anon/authenticated
-- =====================================================================
-- HALLAZGO (reconocimiento de catalogos 2026-10-08, solo lectura)
--   4 tablas de public tienen RLS desactivada, sin politicas, y anon +
--   authenticated con arwdDxtm (todos los permisos):
--     CONFIGURACION_REPORTES_ORG (3 filas, por organizacion)
--     MENU_APP                   (9 filas)
--     METADATOS_CAMPOS           (450 filas, logica de formularios)
--     spatial_ref_sys            (8500 filas; extension PostGIS, dueno supabase_admin)
--   Nada del repo (web, app Expo, scripts, tests, migraciones) las lee ni las
--   escribe: son remanentes de AppSheet / repo backend-inspecciones.
--
-- QUE HACE
--   1) CONFIGURACION_REPORTES_ORG, MENU_APP, METADATOS_CAMPOS:
--        REVOKE ALL FROM PUBLIC, anon, authenticated;
--        ENABLE ROW LEVEL SECURITY (sin politicas => denegacion total a clientes).
--      postgres (dueno) y service_role (BYPASSRLS) siguen funcionando.
--   2) spatial_ref_sys (BEST EFFORT): intenta quitar INSERT/UPDATE/DELETE/
--      TRUNCATE/REFERENCES/TRIGGER a anon y authenticated. NO toca SELECT
--      (ST_Transform lo necesita; PUBLIC ya tiene SELECT). Como la tabla es de
--      supabase_admin y postgres no es miembro de ese rol, es probable que
--      PostgreSQL emita un WARNING y no cambie nada. En ese caso la migracion
--      NO aborta: emite un WARNING y queda pendiente (ver ADR: Supabase
--      support o mover la extension). Nunca se hace una sonda de escritura.
--
-- DECISION CONFIRMADA ANTES DE APLICAR (Neyser)
--   Que AppSheet / backend-inspecciones u otra herramienta externa NO lean ni
--   escriban estas 3 tablas con la llave anon ni con una sesion authenticated.
--   Una conexion directa como postgres o con service_role NO se ve afectada.
--
-- ROLLBACK (reabre la fuga; solo en emergencia)
--   ALTER TABLE ... DISABLE ROW LEVEL SECURITY;
--   GRANT ALL ON ... TO anon, authenticated;
--   (el CLI guarda el ACL previo exacto en su snapshot).
--
-- IDEMPOTENTE. Transaccional.
-- APLICACION MANUAL por Neyser en Supabase Studio. El CLI no aplica nada.
-- Redacto: Claude (Cowork). Revision de seguridad: ver docs/ESTADO_PROYECTO.md.
-- =====================================================================

BEGIN;

DO $tablas$
DECLARE
  v_tabla text;
  v_rel   regclass;
  v_priv  text;
  v_rol   text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['CONFIGURACION_REPORTES_ORG', 'MENU_APP', 'METADATOS_CAMPOS'] LOOP
    v_rel := to_regclass(format('public.%I', v_tabla));
    IF v_rel IS NULL THEN
      RAISE NOTICE 'public.% no existe: se omite', v_tabla;
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v_tabla);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tabla);

    -- Verificacion
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) THEN
      RAISE EXCEPTION 'public.% sigue sin RLS', v_tabla;
    END IF;
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(v_rol, v_rel, v_priv) THEN
          RAISE EXCEPTION 'public.% aun concede % a %', v_tabla, v_priv, v_rol;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$tablas$;

-- spatial_ref_sys: mejor esfuerzo, NUNCA aborta la migracion
DO $srs$
DECLARE
  v_rel   regclass := to_regclass('public.spatial_ref_sys');
  v_priv  text;
  v_rol   text;
  v_abierto text := '';
BEGIN
  IF v_rel IS NULL THEN
    RAISE NOTICE 'public.spatial_ref_sys no existe: se omite';
    RETURN;
  END IF;

  BEGIN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.spatial_ref_sys FROM anon, authenticated';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'spatial_ref_sys: sin privilegios para revocar (dueno supabase_admin)';
  END;

  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(v_rol, v_rel, v_priv) THEN
        v_abierto := v_abierto || v_rol || ':' || v_priv || ' ';
      END IF;
    END LOOP;
  END LOOP;

  IF v_abierto <> '' THEN
    RAISE WARNING 'spatial_ref_sys SIGUE con escritura abierta (%). Pendiente: Supabase support o accion como supabase_admin. Esta migracion NO falla por esto.', trim(v_abierto);
  ELSE
    RAISE NOTICE 'spatial_ref_sys: escritura cerrada para anon y authenticated';
  END IF;
END
$srs$;

COMMIT;
