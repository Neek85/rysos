-- =====================================================================
-- RYZOS · Pecuario Cuyes · Venta de cuy pelado (beneficiado): precio por
-- kg o por animal + Rendimiento de carcasa
-- Fecha: 2026-09-23
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (system prompt Sección 4.1.2): cubierta
-- en el mismo flujo, por haberse trabajado con Claude desde el principio.
--
-- Spec de referencia: specs/pecuario_venta_pelado_beneficiado.md
-- (decisiones confirmadas por Neyser, 2026-09-13 y Ronda 46, 2026-09-22 —
-- ver también specs/pecuario_panel_indicadores.md §2.27).
--
-- CONTEXTO: "Registrar venta" hoy asume que toda venta de animales se
-- cobra por animal (PECUARIO_VENTAS.precio_unitario, migración v4). Eso
-- no sirve para cuy pelado (beneficiado): a veces se cobra por kilogramo
-- de carcasa, a veces por animal — el técnico elige, venta por venta.
-- Además, Ronda 46 (2026-09-22) agregó una segunda pieza sobre el mismo
-- flujo: para "Rendimiento de carcasa" (peso pelado / peso vivo) hace
-- falta capturar el peso vivo puntual de esa venta.
--
-- NO CAMBIA el flujo de baja de población: fn_dar_baja_animal_por_venta()
-- (v3) sigue dependiendo solo de animal_id/lote_id, no de base_precio —
-- esta migración no la toca.
--
-- precio_total sigue siendo el resultado de un trigger (no una columna
-- generada), porque ya lo era desde v4 (fn_calcular_precio_total_venta)
-- y tiene dos ramas mutuamente excluyentes según base_precio — se
-- extiende esa misma función en vez de crear una nueva, para no dejar
-- dos triggers que puedan pisarse.
--
-- rendimiento_carcasa_pct SÍ es una columna GENERATED (peso_total_kg /
-- peso_vivo_pre_beneficio_kg, ambas columnas ya existentes/nuevas de esta
-- tabla, expresión inmutable) — esto es, además, el "historial real de
-- ventas" que specs/pecuario_venta_pelado_beneficiado.md §6.4 dejaba como
-- posible paso futuro: PECUARIO_VENTAS ya es una tabla real (a diferencia
-- del simulador, que no persiste nada de esto), así que agregar la
-- columna acá la deja disponible de una — no hace falta una tabla nueva.
--
-- Aditiva: no toca PECUARIO_REPRODUCTORES, PECUARIO_LOTES, ni el trigger
-- de baja de población. Idempotente.
-- =====================================================================
--
-- NOTA (agregada por Claude Code CLI, no en la redacción original de
-- Cowork): se envuelve el archivo en BEGIN;/COMMIT; -- todas las demás
-- migraciones de este repo lo hacen (ver CLAUDE.md) y esta no traía el
-- wrapper. Sin riesgo funcional acá: ALTER TYPE ... ADD VALUE IF NOT
-- EXISTS es transaccional desde PG12, y esta migración no usa el valor
-- nuevo ('pelado_beneficiado') dentro del mismo script (la restricción
-- real de Postgres es no *usar* un enum value nuevo en la misma
-- transacción que lo agrega, no el ALTER TYPE en sí).
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_VENTAS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_VENTAS (20260910160000). Corré primero v1.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_calcular_precio_total_venta') THEN
    RAISE EXCEPTION 'Falta fn_calcular_precio_total_venta (20260911180000). Corré primero v4.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------

ALTER TYPE tipo_venta_cuy ADD VALUE IF NOT EXISTS 'pelado_beneficiado';

DO $$ BEGIN
    CREATE TYPE base_precio_venta AS ENUM ('por_animal', 'por_kg');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------
-- 2. Columnas nuevas en PECUARIO_VENTAS
-- ---------------------------------------------------------------------

ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS base_precio base_precio_venta NOT NULL DEFAULT 'por_animal';
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS precio_kg NUMERIC(10,2);
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS peso_vivo_pre_beneficio_kg NUMERIC(8,2);

COMMENT ON COLUMN public."PECUARIO_VENTAS".base_precio IS
  'Solo relevante cuando tipo_salida=pelado_beneficiado. por_animal (default) mantiene el comportamiento de siempre (precio_unitario * cantidad, ver fn_calcular_precio_total_venta). por_kg usa peso_total_kg * precio_kg. Para los otros 3 tipos de salida siempre es por_animal (chk_ventas_base_precio_coherente).';
COMMENT ON COLUMN public."PECUARIO_VENTAS".peso_vivo_pre_beneficio_kg IS
  'Peso vivo del animal antes del beneficio, capturado puntualmente en ventas tipo pelado_beneficiado (Ronda 46, 2026-09-22, specs/pecuario_panel_indicadores.md §2.27) — base de rendimiento_carcasa_pct. Opcional: no bloquea el guardado si el técnico no lo carga (mismo criterio que el resto del módulo, no bloquear captura offline por un dato faltante).';

-- rendimiento_carcasa_pct: generado, no se agrega junto a las demás por
-- la misma razón que monto_total en PECUARIO_COMPRAS (depende de
-- columnas creadas arriba en esta misma corrida).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'PECUARIO_VENTAS' AND column_name = 'rendimiento_carcasa_pct'
  ) THEN
    ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN rendimiento_carcasa_pct NUMERIC(5,1)
      GENERATED ALWAYS AS (
        CASE
          WHEN peso_total_kg IS NOT NULL AND peso_vivo_pre_beneficio_kg IS NOT NULL AND peso_vivo_pre_beneficio_kg > 0
            THEN ROUND((peso_total_kg / peso_vivo_pre_beneficio_kg) * 100, 1)
          ELSE NULL
        END
      ) STORED;
  END IF;
END $$;

COMMENT ON COLUMN public."PECUARIO_VENTAS".rendimiento_carcasa_pct IS
  'Calculado: peso_total_kg / peso_vivo_pre_beneficio_kg * 100. NULL cuando falta cualquiera de los dos datos (no bloquea, ver comentario de peso_vivo_pre_beneficio_kg).';

-- ---------------------------------------------------------------------
-- 3. Consistencia: base_precio solo "por_kg" con tipo_salida=pelado, y
--    cuando es "por_kg" exige peso+precio (mismo criterio de la spec:
--    "Peso total pelado (kg)" y "Precio por kilogramo" pasan a ser el
--    dato principal, ya no opcional).
-- ---------------------------------------------------------------------

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS" ADD CONSTRAINT chk_ventas_base_precio_coherente CHECK (
      (base_precio = 'por_animal' AND precio_kg IS NULL)
      OR
      (base_precio = 'por_kg' AND tipo_salida = 'pelado_beneficiado'
        AND peso_total_kg IS NOT NULL AND precio_kg IS NOT NULL AND precio_kg >= 0)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------
-- 4. fn_calcular_precio_total_venta(): se extiende (no se reemplaza el
--    nombre) con la rama por_kg, evaluada primero. La rama existente
--    (precio_unitario * cantidad, v4) sigue intacta para toda venta que
--    no sea por_kg — ninguna fila existente cambia de comportamiento.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_calcular_precio_total_venta()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.base_precio = 'por_kg' AND NEW.peso_total_kg IS NOT NULL AND NEW.precio_kg IS NOT NULL THEN
    NEW.precio_total := ROUND(NEW.peso_total_kg * NEW.precio_kg, 2);
  ELSIF NEW.precio_unitario IS NOT NULL THEN
    NEW.precio_total := ROUND(NEW.cantidad * NEW.precio_unitario, 2);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- El trigger trg_calcular_precio_total_venta (v4) ya apunta a esta misma
-- función por nombre — CREATE OR REPLACE alcanza, no hace falta recrear
-- el trigger.

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--   WHERE t.typname = 'tipo_venta_cuy' ORDER BY e.enumsortorder;
--   -- esperado: carne, pie_cria, reproductor_saca, guano, pelado_beneficiado
--
-- Por kg (venta poblacional de lote, ejemplo):
-- INSERT INTO "PECUARIO_VENTAS" ("ID_Organizacion", lote_id, tipo_salida, cantidad, base_precio, peso_total_kg, precio_kg, peso_vivo_pre_beneficio_kg)
--   VALUES ('<org de prueba>', '<lote_id>', 'pelado_beneficiado', 1, 'por_kg', 9, 22, 15);
--   -- esperado: precio_total = 198.00, rendimiento_carcasa_pct = 60.0
--
-- Por animal, sin cambios respecto a v4:
-- INSERT INTO "PECUARIO_VENTAS" ("ID_Organizacion", lote_id, tipo_salida, cantidad, precio_unitario)
--   VALUES ('<org de prueba>', '<lote_id>', 'carne', 12, 18);
--   -- esperado: precio_total = 216.00 (sin cambio de comportamiento)
--
-- Debe fallar por chk_ventas_base_precio_coherente:
-- INSERT INTO "PECUARIO_VENTAS" ("ID_Organizacion", lote_id, tipo_salida, cantidad, base_precio, precio_kg)
--   VALUES ('<org de prueba>', '<lote_id>', 'carne', 5, 'por_kg', 20);
--   -- base_precio=por_kg con tipo_salida != pelado_beneficiado
-- ---------------------------------------------------------------------
