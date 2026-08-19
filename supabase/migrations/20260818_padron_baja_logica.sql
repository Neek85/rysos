-- MIGRACIÓN IDEMPOTENTE: baja lógica para PADRON_SOCIOS/PADRON_PARCELAS.
--
-- CONTEXTO: /dashboard/socios pidió un botón "Eliminar / Dar de Baja".
-- Decisión confirmada con el usuario (specs/padron_web_socios.md): baja
-- LÓGICA, no DELETE físico — este padrón es compartido en vivo con otro
-- repositorio (backend-inspecciones, ver
-- docs/audits/auditoria_backend_inspecciones.md) y sus IDs pueden estar
-- referenciados desde INSPECCIONES/EUDR_MONITOREO (sin FK real que lo
-- impida) — un DELETE físico dejaría esos registros huérfanos y perdería
-- el historial. `activo` default `true` — todas las filas existentes
-- quedan activas al aplicar esta migración, sin cambio de comportamiento
-- hasta que alguien use el botón de baja nuevo.

BEGIN;

ALTER TABLE public."PADRON_SOCIOS"
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

ALTER TABLE public."PADRON_PARCELAS"
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

COMMIT;
