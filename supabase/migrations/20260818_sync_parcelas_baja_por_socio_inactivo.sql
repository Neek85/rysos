-- SINCRONIZACIÓN PUNTUAL (no idempotente por naturaleza — es un UPDATE de
-- datos, se puede re-ejecutar sin efecto una vez aplicada, ver WHERE final):
-- marca activo = false en PADRON_PARCELAS para las parcelas cuyo socio
-- propietario (PADRON_SOCIOS.ID_Socio) esté hoy activo = false.
--
-- CONTEXTO: a partir de la baja en cascada agregada en
-- lib/actions/sociosActions.js::deactivateSocio (2026-08-18), toda baja
-- NUEVA de un socio ya desactiva sus parcelas automáticamente. Esta
-- migración es solo para sincronizar el estado de datos YA existentes
-- antes de ese cambio (socios dados de baja con el flujo viejo, que dejó
-- sus parcelas en activo = true).
--
-- ALCANCE DELIBERADAMENTE LIMITADO (decisión confirmada con el usuario):
-- solo toca parcelas cuyo ID_Socio referencia un socio real e inactivo.
-- NO toca parcelas "huérfanas" (ID_Socio que no matchea ningún
-- PADRON_SOCIOS existente) — un huérfano puede ser un ID mal tipeado en
-- vez de un socio realmente dado de baja, y desactivar automáticamente en
-- ese caso arriesgaría ocultar una parcela válida por un error de datos
-- ajeno a esta baja lógica.
--
-- Requiere supabase/migrations/20260818_padron_baja_logica.sql aplicada
-- (columna `activo` en ambas tablas).

BEGIN;

UPDATE public."PADRON_PARCELAS" AS parcela
SET activo = false
FROM public."PADRON_SOCIOS" AS socio
WHERE parcela."ID_Socio" = socio."ID_Socio"
  AND socio.activo = false
  AND parcela.activo = true;

COMMIT;
