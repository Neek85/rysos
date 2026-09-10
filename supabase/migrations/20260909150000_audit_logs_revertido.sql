-- MIGRACIÓN IDEMPOTENTE: amplía audit_logs.accion para admitir
-- 'REVERTIDO' (specs/revertir_aprobado_a_qc.md) -- revertir un registro
-- APROBADO de vuelta a PENDIENTE desde la Consola QC también deja traza
-- en audit_logs, mismo patrón best-effort que APROBADO/RECHAZADO
-- (app/api/qc/audit-log/route.js, sin cambios ahí -- solo el valor
-- permitido de `accion`).
--
-- No es un cambio de RLS/seguridad: audit_logs sigue sin políticas para
-- anon/authenticated (solo el Service Role Key la escribe) -- esto solo
-- ensancha un CHECK constraint de columna.

BEGIN;

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_accion_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_accion_check
    CHECK (accion IN ('APROBADO', 'RECHAZADO', 'REVERTIDO'));

COMMIT;
