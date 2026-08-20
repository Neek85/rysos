-- MIGRACIÓN IDEMPOTENTE: audit_logs — traza inmutable de decisiones de la
-- Consola QC (Aprobar/Rechazar). Ver specs/qc_batch_audit_trail.md.
--
-- CORRECCIÓN DE PREMISAS (verificado antes de escribir código):
-- 1. No existe un estado/acción "OBSERVADO" — confirmado ya 2 veces en
--    esta serie de tareas (specs/gis_qc_console_v2.md): los 3 estados
--    reales de estado_revision son PENDIENTE/APROBADO/RECHAZADO. Se usa
--    'RECHAZADO' (no 'OBSERVADO') como el valor real de `accion`.
-- 2. `accion = 'MONITOREO_APROBADO'/'MONITOREO_OBSERVADO'` asume que solo
--    se decide sobre EUDR_MONITOREO — la Consola QC decide sobre 3 tablas
--    (EUDR_MONITOREO/EUDR_USO_SUELO/EUDR_INSTALACIONES). En vez de un
--    `accion` con el nombre de tabla incrustado (que obligaría a 6
--    valores: MONITOREO_APROBADO/USO_SUELO_APROBADO/..., un valor por
--    combinación), `accion` queda genérico ('APROBADO'/'RECHAZADO') y
--    `tabla_origen` (columna separada, ya en esta tabla) carga el dato de
--    qué tabla — mismo criterio ya aplicado en qc_validation_audit_log.
-- 3. `entidad_id (UUID del registro EUDR_MONITOREO)` — igual que en
--    fn_validar_topologia_eudr, `id_origen` no es UUID nativo para
--    EUDR_USO_SUELO/EUDR_INSTALACIONES (ver docs/schema_live.md). Columna
--    `text`, no `uuid`.
-- 4. "Registro inmutable" se implementa de verdad, no solo de palabra: un
--    trigger BEFORE UPDATE OR DELETE rechaza cualquier intento de
--    modificar/borrar una fila ya escrita — corre para CUALQUIER rol,
--    incluido el Service Role Key (los triggers no distinguen por
--    privilegio de rol, a diferencia de RLS).
-- 5. "Registro obligatorio" en el sentido de "se intenta en cada decisión,
--    nunca se omite silenciosamente" — NO se implementa como una
--    transacción atómica única con el UPDATE de estado_revision (eso
--    exigiría reemplazar approveRecord/rejectRecord, que ya tienen 8
--    tests reales cubriéndolos tal como están, por RPCs nuevas). Mismo
--    criterio ya aceptado en esta sesión para qc_validation_audit_log
--    ("best-effort, no bloquea la respuesta si falla") — ver
--    specs/qc_batch_audit_trail.md para el detalle completo de esta
--    decisión de alcance.

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ID_Organizacion" text NOT NULL,
    accion            text NOT NULL CHECK (accion IN ('APROBADO', 'RECHAZADO')),
    tabla_origen      text NOT NULL CHECK (tabla_origen IN ('EUDR_MONITOREO', 'EUDR_USO_SUELO', 'EUDR_INSTALACIONES')),
    entidad_id        text NOT NULL,
    -- Contexto técnico de la decisión (validez topológica, % de
    -- solapamiento, motivo de rechazo) — NUNCA productor/nombre/DNI/
    -- teléfono, ver app/api/qc/audit-log/route.js.
    detalles          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_logs IS
    'Traza inmutable de decisiones Aprobar/Rechazar de la Consola QC — ver specs/qc_batch_audit_trail.md. INSERT-only: un trigger rechaza UPDATE/DELETE para cualquier rol.';

CREATE INDEX IF NOT EXISTS idx_audit_logs_entidad
    ON public.audit_logs (tabla_origen, entidad_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_organizacion
    ON public.audit_logs ("ID_Organizacion");

-- Inmutabilidad real: ningún rol (ni siquiera el Service Role Key) puede
-- modificar o borrar una fila ya escrita.
CREATE OR REPLACE FUNCTION public.fn_prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs es de solo inserción — % no está permitido sobre filas existentes.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_audit_log_mutation();

-- RLS habilitada, sin políticas — mismo patrón que qc_validation_audit_log:
-- solo el Service Role Key (app/api/qc/audit-log/route.js) la toca.
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

COMMIT;
