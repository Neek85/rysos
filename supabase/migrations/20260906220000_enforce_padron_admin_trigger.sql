-- Cierra el bypass RLS confirmado en vivo (AI_STATE.md, 2026-09-06,
-- "Revisión de seguridad de a975a7c") -- rls_write_padron_socios/
-- rls_write_padron_parcelas (ADR-034) solo filtran por organización,
-- nunca por rol, así que assertAdminRole() (lib/actions/sociosActions.js,
-- RBAC de /dashboard/socios) es una capa 100% aplicación: un
-- tecnico_campo/auditor_qc con su propio access_token puede saltarse
-- la Server Action por completo con un PATCH directo a PostgREST y
-- mutar PADRON_SOCIOS/PADRON_PARCELAS igual. Confirmado en vivo con un
-- PATCH real bajo sesión de tecnico_campo -- 200 OK, mutación aceptada.
--
-- Mismo patrón que fn_enforce_qc_approval_roles (ADR-039): un trigger,
-- no una política RLS nueva, porque acá la condición es "todo el
-- rol", no "solo cuando cambia una columna" -- no hace falta comparar
-- OLD/NEW como en ADR-039.
--
-- DECISIÓN (confirmada con el usuario antes de escribir esto, ver
-- specs/rbac_webgis_padron.md): el prompt original pedía bloquear
-- INSERT/UPDATE/DELETE completos en AMBAS tablas para cualquier
-- no-admin. Eso habría roto una funcionalidad real y ya existente:
-- createParcela (lib/actions/sociosActions.js) también la llama
-- gisActions.js::uploadGeoSpatialFeature -- el Editor Vectorial/Carga
-- Espacial de /dashboard/qc, donde tecnico_campo SÍ debe poder crear
-- parcelas nuevas desde el campo (la matriz de permisos de
-- specs/login_real_organizacion_rol.md §5 no dice nada sobre
-- restringir esa pantalla, y esta acción fue justamente el gap que
-- ADR-036/037/038 y specs/rbac_webgis_padron.md ya dejaron documentado
-- como "createParcela deliberadamente sin chequeo de rol"). Por eso:
--   - PADRON_SOCIOS: bloquea INSERT/UPDATE/DELETE completos para
--     cualquier no-admin -- sin conflicto real, createSocio no tiene
--     ningún llamador fuera de /dashboard/socios.
--   - PADRON_PARCELAS: bloquea solo UPDATE/DELETE para no-admin --
--     INSERT queda permitido para cualquier authenticated, preservando
--     el Editor Vectorial. Esto cierra el bypass real que se probó en
--     vivo (una UPDATE directa vía REST), sin regresar una
--     funcionalidad real que nadie pidió tocar.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_enforce_padron_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- auth.role() = 'authenticated' excluye naturalmente service_role
  -- (ETL, Admin API) y conexiones directas de postgres (auth.role()
  -- devuelve NULL sin JWT) -- sin necesidad de un OR explícito de
  -- bypass, a diferencia de las políticas RLS de ADR-034/039 que sí lo
  -- necesitan porque su condición no arranca ya acotada a
  -- 'authenticated'.
  IF auth.role() = 'authenticated' AND public.auth_role() IS DISTINCT FROM 'admin' THEN
    IF NOT (TG_TABLE_NAME = 'PADRON_PARCELAS' AND TG_OP = 'INSERT') THEN
      RAISE EXCEPTION 'Acceso denegado: las modificaciones en el Padrón requieren rol admin'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_padron_socios_admin ON public."PADRON_SOCIOS";
CREATE TRIGGER trg_enforce_padron_socios_admin
  BEFORE INSERT OR UPDATE OR DELETE ON public."PADRON_SOCIOS"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_padron_admin_role();

DROP TRIGGER IF EXISTS trg_enforce_padron_parcelas_admin ON public."PADRON_PARCELAS";
CREATE TRIGGER trg_enforce_padron_parcelas_admin
  BEFORE INSERT OR UPDATE OR DELETE ON public."PADRON_PARCELAS"
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_padron_admin_role();

COMMIT;
