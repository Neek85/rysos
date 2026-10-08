-- =====================================================================
-- 20261008090000_seguridad_usuarios_login_sin_acceso_cliente.sql
-- SEGURIDAD (URGENTE) - USUARIOS_LOGIN sin acceso para anon / authenticated
-- =====================================================================
-- HALLAZGO (auditoria de catalogos 2026-10-08, solo lectura, sin sondas)
--   public."USUARIOS_LOGIN" es una vista sin filtro y sin security_invoker:
--   corre como postgres sobre USUARIOS (RLS activada, no forzada). anon y
--   authenticated tienen arwdDxtm => pueden LEER, INSERTAR, ACTUALIZAR y
--   BORRAR 12 campos (DNI, telefono, email, rol, activo, firma digital).
--   La llave anon es publica (va en el bundle de la web). Gravedad: critica.
--   El repo no usa esta vista en ningun lado (JS/TS, Python, SQL, tests).
--
-- QUE HACE
--   REVOKE ALL sobre la vista para PUBLIC, anon y authenticated. Conserva
--   postgres (dueno) y service_role. Cierra lectura Y escritura.
--
-- DECISION CONFIRMADA ANTES DE APLICAR (Neyser)
--   Que nada externo (p. ej. AppSheet) acceda a USUARIOS_LOGIN con la llave
--   anon o con una sesion authenticated. Una conexion directa como postgres o
--   con service_role NO se ve afectada.
--
-- QUE NO HACE
--   No elimina la vista ni la tabla USUARIOS. No toca otras vistas (ver
--   20261008091000_seguridad_vistas_sin_escritura_cliente.sql).
--
-- ROLLBACK (reabre la fuga; solo en emergencia y sabiendolo)
--   GRANT ALL ON public."USUARIOS_LOGIN" TO anon, authenticated;
--   (el CLI guarda ademas el ACL previo exacto en el snapshot).
--
-- IDEMPOTENTE. Si la vista no existe, avisa y sigue. Transaccional.
-- APLICACION MANUAL por Neyser en Supabase Studio. El CLI no aplica nada.
-- Redacto: Claude (Cowork). Revision de seguridad: ver docs/ESTADO_PROYECTO.md.
-- =====================================================================

BEGIN;

DO $usuarios_login$
DECLARE
  v_rel regclass := to_regclass('public."USUARIOS_LOGIN"');
  v_priv text;
  v_rol  text;
BEGIN
  IF v_rel IS NULL THEN
    RAISE NOTICE 'public."USUARIOS_LOGIN" no existe: nada que revocar';
    RETURN;
  END IF;

  EXECUTE 'REVOKE ALL ON public."USUARIOS_LOGIN" FROM PUBLIC, anon, authenticated';

  -- Verificacion: ningun privilegio de tabla debe quedar para anon/authenticated
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(v_rol, v_rel, v_priv) THEN
        RAISE EXCEPTION 'USUARIOS_LOGIN aun concede % a %', v_priv, v_rol;
      END IF;
    END LOOP;
  END LOOP;
END
$usuarios_login$;

COMMIT;
