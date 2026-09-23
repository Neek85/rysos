-- =====================================================================
-- FIX — PECUARIO_COMPRAS.flete: DEFAULT 0 conflictaba con
-- chk_compras_rama_por_concepto
-- Fecha: 2026-09-22 (aplicada la primera vez el mismo día; este fix se
-- redacta el 2026-09-23, tras la verificación en vivo posterior).
-- Redactado por: Claude Code CLI — NO por Claude (Cowork). A diferencia
-- de 20260922110000_pecuario_compras_gastos.sql, esta migración NO tiene
-- cubierto el gate de segunda revisión de forma automática (system
-- prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.2) — Neyser debe darle el
-- visto bueno (o pasarla por Cowork) antes de aplicarla, igual que
-- cualquier SQL escrito por esta herramienta.
--
-- CAUSA RAÍZ (confirmada en vivo, no asumida): la migración original
-- declaró `flete NUMERIC(10,2) DEFAULT 0` sin condicionarlo a la rama.
-- chk_compras_rama_por_concepto exige `flete IS NULL` cuando
-- concepto = 'servicio_otro' — pero un INSERT que simplemente omite la
-- clave "flete" en el JSON (el comportamiento normal de un cliente que
-- solo llena los campos de su propia rama, incluido CompraSchema vía
-- Zod con `flete` opcional) recibe flete=0 por el DEFAULT de la columna,
-- no NULL. Resultado: **todo INSERT válido de concepto='servicio_otro'
-- que no mande flete:null explícito viola el CHECK (23514)** —
-- descubierto por tests/test_pecuario_compras_gastos.py
-- (test_compra_servicio_otro_no_genera_movimiento,
-- test_authenticated_session_can_write_own_org,
-- test_cross_org_read_isolation vía su fila semilla) corriendo en vivo
-- contra jhtocgxlozfuzullrtol el 2026-09-23, primera vez que la
-- migración corrió contra datos reales.
--
-- FIX: quitar el DEFAULT de la columna. No requiere backfill de filas
-- existentes con flete=0 de la rama 'insumo' (siguen siendo válidas, el
-- CHECK solo exige flete >= 0 o NULL en esa rama) ni cambia el cálculo
-- de monto_total — la columna GENERATED ya hace
-- COALESCE(flete, 0) al sumar para la rama 'insumo', así que un flete
-- NULL sigue aportando 0 correctamente sin este DEFAULT a nivel de
-- columna.
--
-- Idempotente: DROP DEFAULT sobre una columna que ya no tiene default no
-- da error.
-- =====================================================================

BEGIN;

ALTER TABLE public."PECUARIO_COMPRAS" ALTER COLUMN flete DROP DEFAULT;

COMMENT ON COLUMN public."PECUARIO_COMPRAS".flete IS
  'Opcional, solo aplica a la rama concepto=insumo (flete/transporte del insumo comprado). Sin DEFAULT a propósito: debe ser NULL para concepto=servicio_otro (chk_compras_rama_por_concepto lo exige) -- monto_total ya hace COALESCE(flete,0) al calcular, así que un flete NULL no afecta el total.';

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación rápida post-aplicación (ejecutar a mano en Studio):
--
-- INSERT INTO "PECUARIO_COMPRAS" ("ID_Organizacion", concepto, categoria_gasto, descripcion, monto_servicio)
--   VALUES ('<org de prueba>', 'servicio_otro', 'combustible', 'prueba fix flete', 50);
--   -- esperado: 201/insert exitoso, flete queda NULL (antes de este fix
--   -- fallaba con 23514 porque flete se autocompletaba a 0)
-- ---------------------------------------------------------------------
