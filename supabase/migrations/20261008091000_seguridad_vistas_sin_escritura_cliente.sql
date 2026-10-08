-- =====================================================================
-- 20261008091000_seguridad_vistas_sin_escritura_cliente.sql
-- SEGURIDAD - Las vistas de public no aceptan escritura de anon / authenticated
-- =====================================================================
-- HALLAZGO (auditoria de catalogos 2026-10-08)
--   Los GRANT por defecto de Supabase (pg_default_acl) dan arwdDxtm a anon,
--   authenticated y service_role en toda tabla/vista nueva de public. Las
--   vistas simples de UNA tabla son auto-actualizables y corren con los
--   privilegios de su dueno (postgres), asi que una escritura a traves de la
--   vista se salta la RLS de la tabla base. Caso confirmado: 
--   vw_pecuario_lotes_etapa (sin WITH CHECK OPTION): anon puede INSERTAR y
--   authenticated puede insertar en cualquier organizacion y reasignar el
--   ID_Organizacion de filas propias.
--   Uso en el repo: NINGUNA escritura a vistas (JS/TS, Python/rest/v1, SQL,
--   tests). Las vistas solo se leen.
--
-- QUE HACE
--   Para TODA vista de public (relkind 'v'), de dueno postgres y que no
--   pertenezca a una extension (geometry_columns y similares quedan fuera):
--     REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     FROM PUBLIC, anon, authenticated.
--   NO toca SELECT: las lecturas siguen exactamente igual. NO toca postgres
--   ni service_role. Es dinamica: cubre tambien vistas que no conozco por nombre.
--   Termina con una verificacion que ABORTA la transaccion si queda alguna
--   vista con privilegios de escritura para anon/authenticated.
--
-- QUE NO HACE
--   - No cambia security_invoker (romperia el dashboard web, que lee vistas
--     con la llave anon y depende de que corran como postgres).
--   - No cubre las 4 tablas sin RLS ni las politicas permisivas de lectura
--     (tareas aparte, tras su reconocimiento).
--   - No cambia pg_default_acl: las vistas nuevas (o recreadas con DROP+CREATE)
--     vuelven a nacer con todos los permisos. Lo vigila un test de catalogo.
--   - USUARIOS_LOGIN se trata en 20261008090000 (revoca tambien la lectura).
--
-- ROLLBACK (reabre la escritura anonima; solo en emergencia)
--   Re-aplicar el ACL previo que el CLI guarda en su snapshot (relacl de cada vista).
--
-- IDEMPOTENTE (REVOKE repetible). Transaccional.
-- APLICACION MANUAL por Neyser en Supabase Studio. El CLI no aplica nada.
-- Redacto: Claude (Cowork). Revision de seguridad: ver docs/ESTADO_PROYECTO.md.
-- =====================================================================

BEGIN;

DO $vistas$
DECLARE
  r        record;
  v_priv   text;
  v_rol    text;
  v_total  integer := 0;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'v'
       AND pg_get_userbyid(c.relowner) = 'postgres'
       AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass
                AND d.objid = c.oid
                AND d.deptype = 'e')            -- excluye vistas de extensiones
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %s FROM PUBLIC, anon, authenticated',
      r.rel);
    v_total := v_total + 1;
  END LOOP;
  RAISE NOTICE 'Vistas procesadas: %', v_total;

  -- Verificacion: ninguna vista (no de extension) conserva escritura para anon/authenticated
  FOR r IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'v'
       AND pg_get_userbyid(c.relowner) = 'postgres'
       AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass
                AND d.objid = c.oid
                AND d.deptype = 'e')
  LOOP
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(v_rol, r.rel, v_priv) THEN
          RAISE EXCEPTION 'La vista % aun concede % a %', r.rel, v_priv, v_rol;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$vistas$;

COMMIT;
