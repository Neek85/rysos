-- Fase D del piloto Camino 1 (ver docs/adr/ADR-039-fase-d-qc-aprobar-
-- rechazar-roles-rls.md): approveQcRecord/rejectQcRecord
-- (lib/actions/qcActions.js) migran de Service Role Key a sesión real.
-- El RLS por organización ya existente (ADR-034,
-- rls_write_eudr_monitoreo/_uso_suelo/_instalaciones) NO distingue por
-- rol -- cualquier miembro `authenticated` de la organización (incluido
-- `tecnico_campo`) podría aprobar/rechazar un registro si solo se
-- migrara el cliente sin este trigger. Esta migración cierra ese gap
-- con un trigger BEFORE UPDATE que exige `admin`/`auditor_qc` cuando
-- estado_revision realmente cambia -- una política RLS por sí sola no
-- puede comparar OLD vs NEW de una sola columna, por eso el mecanismo
-- es un trigger, no una política nueva.
--
-- Reconocimiento hecho en vivo antes de escribir esto (no asumido del
-- prompt):
--   - public.auth_role() ya existe (creada en
--     20260902213506_login_fase_a_identidad.sql), SECURITY DEFINER,
--     devuelve PERFILES_USUARIO_INTERNOS.rol para auth.uid() -- valores
--     reales hoy: 2 admin, 1 auditor_qc, 2 tecnico_campo.
--   - NO existe ningún CHECK constraint de Postgres sobre
--     estado_revision en EUDR_MONITOREO/EUDR_USO_SUELO/EUDR_INSTALACIONES
--     (confirmado con pg_constraint) -- el contrato
--     PENDIENTE/APROBADO/RECHAZADO del prompt original es una
--     convención de aplicación (PENDING_STATE en lib/eudrQcActions.js),
--     no una restricción de esquema. Esta migración no agrega ese CHECK
--     -- fuera de alcance de esta tarea, no se pidió explícitamente
--     crearlo.
--   - Sin triggers existentes en conflicto sobre estas 3 tablas para
--     UPDATE de estado_revision (los triggers actuales son
--     trg_auto_org_* en BEFORE INSERT y trg_gis_sanitize_* en
--     BEFORE INSERT OR UPDATE OF geom/geom_inspeccion).
--
-- Bypass de service_role/postgres (agregado, no estaba en el prompt
-- original tal cual): scripts/qgis_qc_actions.py cambia estado_revision
-- vía psycopg2 dentro de QGIS Desktop (conexión directa, típicamente
-- como CURRENT_USER = 'postgres'), y scripts/etl_drive_to_supabase.py
-- (ADR-012) protege registros ya revisados pero podría en teoría
-- necesitar el mismo camino -- ambos corren fuera de una sesión de
-- Supabase Auth, así que auth_role() les devuelve NULL. Sin este
-- bypass, el trigger los bloquearía por completo. Mismo patrón exacto
-- que ya usan las 3 políticas rls_write_eudr_* (ADR-034): auth.role() =
-- 'service_role' OR current_user = 'postgres' además de la condición de
-- rol.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_enforce_qc_approval_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado_revision IS DISTINCT FROM OLD.estado_revision THEN
    IF auth.role() = 'service_role' OR current_user = 'postgres' THEN
      RETURN NEW;
    END IF;
    IF public.auth_role() IS NULL OR public.auth_role() NOT IN ('admin', 'auditor_qc') THEN
      RAISE EXCEPTION 'Acceso denegado: Solo usuarios con rol admin o auditor_qc pueden aprobar o rechazar monitoreos'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_qc_approval_roles_monitoreo ON public."EUDR_MONITOREO";
CREATE TRIGGER trg_enforce_qc_approval_roles_monitoreo
  BEFORE UPDATE ON public."EUDR_MONITOREO"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_qc_approval_roles();

DROP TRIGGER IF EXISTS trg_enforce_qc_approval_roles_uso_suelo ON public."EUDR_USO_SUELO";
CREATE TRIGGER trg_enforce_qc_approval_roles_uso_suelo
  BEFORE UPDATE ON public."EUDR_USO_SUELO"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_qc_approval_roles();

DROP TRIGGER IF EXISTS trg_enforce_qc_approval_roles_instalaciones ON public."EUDR_INSTALACIONES";
CREATE TRIGGER trg_enforce_qc_approval_roles_instalaciones
  BEFORE UPDATE ON public."EUDR_INSTALACIONES"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_qc_approval_roles();

COMMIT;
