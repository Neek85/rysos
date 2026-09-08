-- Cierra el gap real confirmado en vivo durante el smoke test formal de
-- Fase D Paso 2 (specs/smoke_test_fase_d_paso2.md, AI_STATE.md
-- 2026-09-08): saveInspeccion (lib/inspeccionesActions.js) no tenía
-- ningún chequeo de rol -- el RLS real de INSPECCIONES/CAP_* (ADR-033,
-- 20260903170404_fase_c_paso2_rls_real_inspecciones_cap.sql) solo exige
-- "ID_Organizacion" = auth_org_id(), sin distinción de rol. Confirmado
-- en vivo con la cuenta demo real auditor-qc-demo@ryzos-demo.test: pudo
-- crear una inspección real sin ningún bloqueo -- la matriz de permisos
-- (specs/login_real_organizacion_rol.md §5) dice auditor_qc: Solo
-- lectura para /dashboard/inspecciones.
--
-- Mismo tipo de gap, mismo patrón de cierre, que
-- fn_enforce_padron_admin_role (20260906220000_enforce_padron_admin_trigger.sql)
-- y fn_enforce_qc_approval_roles (ADR-039): un trigger BEFORE
-- INSERT/UPDATE como autoridad real de base de datos, porque el assert
-- de aplicación (lib/inspeccionesActions.js::assertInspeccionWriteRole,
-- agregado en el mismo commit que esta migración) es bypasseable con un
-- POST/PATCH directo a PostgREST usando el access_token real de una
-- sesión auditor_qc -- confirmado que ese bypass exacto funcionaba antes
-- de esta migración.
--
-- Roles permitidos para escribir: admin, tecnico_campo (matriz §5: los
-- únicos 2 roles con "Sí" en /dashboard/inspecciones -- auditor_qc queda
-- bloqueado). auth.role() = 'authenticated' excluye naturalmente
-- service_role (ETL/Admin API/scripts) y conexiones directas de
-- postgres (auth.role() devuelve NULL sin JWT) -- sin necesidad de un OR
-- explícito de bypass, mismo criterio que fn_enforce_padron_admin_role.
--
-- BEFORE INSERT OR UPDATE OR DELETE (revisión 2026-09-08, sobre el
-- borrador original que solo cubría INSERT/UPDATE): saveInspeccion en sí
-- nunca borra INSPECCIONES directamente -- fn_guardar_inspeccion_completa
-- (SECURITY INVOKER, NO SECURITY DEFINER) hace un DELETE+INSERT interno
-- por cada una de las 6 CAP_* en la misma transacción, después del
-- INSERT/UPDATE de INSPECCIONES (20260903170404_fase_c_paso2_rls_real_inspecciones_cap.sql)
-- -- un rol bloqueado ya no llega ahí porque la transacción aborta antes.
-- Pero el mismo tipo de bypass que motivó todo este fix (un
-- POST/PATCH directo a PostgREST, sin pasar por saveInspeccion) aplica
-- igual a un DELETE directo: hoy (sin esto) solo lo bloquea el RLS de
-- organización (ADR-033), nunca de rol -- un auditor_qc con su propio
-- access_token podría borrar una fila real de cualquiera de las 7 tablas
-- de su propia organización. Se cubre DELETE en las 7 tablas por el
-- mismo motivo original, no solo defensa en profundidad hipotética.
--
-- IMPORTANTE: NEW es NULL en un trigger de DELETE -- un `RETURN NEW`
-- incondicional (como tenía el borrador original, escrito antes de
-- agregar DELETE a los CREATE TRIGGER) cancelaría EN SILENCIO todo
-- DELETE, incluso de admin/tecnico_campo, porque un BEFORE DELETE que
-- retorna NULL aborta la operación. Se agrega el mismo branch
-- `IF TG_OP = 'DELETE' THEN RETURN OLD` que ya usa
-- fn_enforce_padron_admin_role para este caso exacto.
--
-- Verificado contra pg_policies antes de escribir esto (mismo chequeo
-- que toda migración de este tipo): las 7 tablas solo tienen 2 políticas
-- PERMISSIVE cada una (rls_anon_deny_* para anon, rls_write_*_authenticated
-- para authenticated con WITH CHECK de organización, ADR-033) -- ninguna
-- otra política permisiva que pueda neutralizar este trigger en silencio.
--
-- SET search_path = public (revisión 2026-09-08): ni
-- fn_enforce_padron_admin_role ni fn_enforce_qc_approval_roles (las 2
-- referencias pedidas para este chequeo) lo tienen -- verificado, no es
-- que compartan un valor para copiar. Se agrega igual acá porque SÍ es
-- la convención real y ya establecida del proyecto para toda función
-- SECURITY DEFINER nueva (auth_role() mismo la tiene, entre varias más
-- -- ver 20260902213506_login_fase_a_identidad.sql y
-- 20260901160000_lecturas_padron_security_definer.sql).

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_enforce_inspecciones_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- IS DISTINCT FROM (no NOT IN) a propósito -- auth_role() puede
  -- devolver NULL (sesión authenticated sin fila en
  -- PERFILES_USUARIO_INTERNOS/perfil inactivo). `NULL NOT IN (...)`
  -- evalúa a NULL, no a TRUE -- un IF con NULL en plpgsql se trata como
  -- falso y NO dispara la excepción, dejando pasar en silencio una
  -- sesión sin rol válido. IS DISTINCT FROM es NULL-safe: siempre
  -- TRUE/FALSE, nunca NULL -- fail-closed real.
  IF auth.role() = 'authenticated'
     AND public.auth_role() IS DISTINCT FROM 'admin'
     AND public.auth_role() IS DISTINCT FROM 'tecnico_campo' THEN
    RAISE EXCEPTION 'Acceso denegado: Solo usuarios con rol admin o tecnico_campo pueden escribir inspecciones'
      USING ERRCODE = '42501';
  END IF;

  -- NEW es NULL en un trigger de DELETE -- sin este branch, un
  -- `RETURN NEW` incondicional cancelaría en silencio TODO DELETE (BEFORE
  -- DELETE que retorna NULL aborta la operación), incluso para
  -- admin/tecnico_campo. Mismo patrón que fn_enforce_padron_admin_role.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_inspecciones_role ON public."INSPECCIONES";
CREATE TRIGGER trg_enforce_inspecciones_role
  BEFORE INSERT OR UPDATE OR DELETE ON public."INSPECCIONES"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_inspecciones_role();

DROP TRIGGER IF EXISTS trg_enforce_cap_datos_socio_role ON public."CAP_DATOS_SOCIO";
CREATE TRIGGER trg_enforce_cap_datos_socio_role
  BEFORE INSERT OR UPDATE OR DELETE ON public."CAP_DATOS_SOCIO"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_inspecciones_role();

DROP TRIGGER IF EXISTS trg_enforce_cap_mic_role ON public."CAP_MIC";
CREATE TRIGGER trg_enforce_cap_mic_role
  BEFORE INSERT OR UPDATE OR DELETE ON public."CAP_MIC"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_inspecciones_role();

DROP TRIGGER IF EXISTS trg_enforce_cap_conservacion_role ON public."CAP_CONSERVACION";
CREATE TRIGGER trg_enforce_cap_conservacion_role
  BEFORE INSERT OR UPDATE OR DELETE ON public."CAP_CONSERVACION"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_inspecciones_role();

DROP TRIGGER IF EXISTS trg_enforce_cap_bienestar_role ON public."CAP_BIENESTAR";
CREATE TRIGGER trg_enforce_cap_bienestar_role
  BEFORE INSERT OR UPDATE OR DELETE ON public."CAP_BIENESTAR"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_inspecciones_role();

DROP TRIGGER IF EXISTS trg_enforce_cap_riesgos_role ON public."CAP_RIESGOS";
CREATE TRIGGER trg_enforce_cap_riesgos_role
  BEFORE INSERT OR UPDATE OR DELETE ON public."CAP_RIESGOS"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_inspecciones_role();

DROP TRIGGER IF EXISTS trg_enforce_cap_gestion_role ON public."CAP_GESTION";
CREATE TRIGGER trg_enforce_cap_gestion_role
  BEFORE INSERT OR UPDATE OR DELETE ON public."CAP_GESTION"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_inspecciones_role();

COMMIT;
