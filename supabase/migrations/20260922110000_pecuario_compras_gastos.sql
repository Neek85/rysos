-- =====================================================================
-- RYZOS · Pecuario Cuyes · Compras/gastos de la granja (separado del
-- kardex de Insumos)
-- Fecha: 2026-09-22
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (system prompt Sección 4.1.2): cubierta
-- en el mismo flujo, por haberse trabajado con Claude desde el principio.
--
-- Spec de referencia: specs/pecuario_compras_gastos.md (decisión
-- confirmada por Neyser, 2026-09-13; auditoría del simulador versión 36,
-- 2026-09-21).
--
-- CONTEXTO: hoy "comprar un insumo" y "registrar cualquier otro gasto de
-- la granja" (combustible, mantenimiento, servicio veterinario, mano de
-- obra) no tienen tabla propia. La compra de un insumo se registraba
-- únicamente como un movimiento de tipo 'entrada' en
-- PECUARIO_INSUMOS_MOVIMIENTOS — sin precio, sin proveedor, sin
-- comprobante — y un gasto que no tiene insumo de stock asociado (ej.
-- combustible) no tenía dónde ir en absoluto.
--
-- DISEÑO: una tabla nueva PECUARIO_COMPRAS con dos "formas" mutuamente
-- excluyentes según concepto_compra ('insumo' | 'servicio_otro'),
-- reforzadas con un CHECK (igual criterio que ya usan
-- MortalidadRegistroSchema/VentaRegistroSchema vía XOR en
-- lib/validators/pecuario.ts). Cuando concepto = 'insumo', un trigger
-- AFTER INSERT genera automáticamente el movimiento de 'entrada'
-- correspondiente en PECUARIO_INSUMOS_MOVIMIENTOS — un solo punto de
-- captura para el técnico, sin duplicar el registro y sin poder
-- desincronizar el stock (mismo patrón ya usado por
-- fn_descontar_insumo_tratamiento en
-- 20260911140000_pecuario_identificacion_individual.sql).
--
-- GAP DE GRANULARIDAD, DOCUMENTADO A PROPÓSITO: PECUARIO_COMPRAS guarda
-- galpon_id (destino de la compra, a nivel de galpón) pero
-- PECUARIO_INSUMOS_MOVIMIENTOS solo tiene poza_id/lote_id (no
-- galpon_id) — el movimiento generado automáticamente por esta migración
-- queda con poza_id/lote_id en NULL. No se agranda el esquema de
-- Movimientos para resolver esto acá: el kardex de Insumos ya funciona
-- así hoy (el detalle por poza/lote es opcional, ver
-- pecuario_compras_gastos.md §3.3), y mezclar "a qué galpón entró" con
-- "a qué poza/lote se le imputó" son preguntas distintas.
--
-- monto_total es una columna GENERATED (no un trigger): para concepto =
-- 'insumo' es costo_insumo + flete; para 'servicio_otro' es
-- monto_servicio directo. Mismo patrón ya usado por
-- PECUARIO_PESAJES.peso_promedio_g (v1) — una expresión inmutable
-- (sin CURRENT_DATE ni función volátil) sí puede ser GENERATED.
--
-- Aditiva: no toca PECUARIO_INSUMOS_MOVIMIENTOS ni ninguna tabla
-- existente salvo por el INSERT que dispara el trigger. Idempotente.
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_INSUMOS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_INSUMOS (20260911090000). Corré primero v2.';
  END IF;
  IF to_regclass('public."PECUARIO_INSUMOS_MOVIMIENTOS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_INSUMOS_MOVIMIENTOS (20260911090000). Corré primero v2.';
  END IF;
  IF to_regclass('public."PECUARIO_GALPONES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_GALPONES (20260911090000). Corré primero v2.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE concepto_compra AS ENUM ('insumo', 'servicio_otro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE categoria_gasto_compra AS ENUM
      ('combustible', 'mantenimiento_reparaciones', 'servicio_veterinario_tecnico', 'mano_obra', 'otro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------
-- 2. PECUARIO_COMPRAS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PECUARIO_COMPRAS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS fecha DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS proveedor VARCHAR(150);
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS concepto concepto_compra NOT NULL;
-- Rama "servicio_otro"
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS categoria_gasto categoria_gasto_compra;
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS descripcion TEXT;
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS monto_servicio NUMERIC(10,2);
-- Rama "insumo"
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS insumo_id UUID;
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS cantidad NUMERIC(10,2);
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS galpon_id UUID;
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS costo_insumo NUMERIC(10,2);
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS flete NUMERIC(10,2) DEFAULT 0;
-- Comunes
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS comprobante VARCHAR(100);
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- monto_total: generado, nunca divergente del dato fuente de cada rama.
-- No puede agregarse con ADD COLUMN IF NOT EXISTS junto a las demás
-- (depende de columnas creadas arriba en esta misma corrida), se agrega
-- en un paso aparte, también idempotente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'PECUARIO_COMPRAS' AND column_name = 'monto_total'
  ) THEN
    ALTER TABLE public."PECUARIO_COMPRAS" ADD COLUMN monto_total NUMERIC(10,2)
      GENERATED ALWAYS AS (
        CASE
          WHEN concepto = 'insumo' THEN COALESCE(costo_insumo, 0) + COALESCE(flete, 0)
          ELSE COALESCE(monto_servicio, 0)
        END
      ) STORED;
  END IF;
END $$;

COMMENT ON COLUMN public."PECUARIO_COMPRAS".monto_total IS
  'Calculado: costo_insumo + flete cuando concepto=insumo, monto_servicio cuando concepto=servicio_otro. Nunca se escribe a mano.';
COMMENT ON COLUMN public."PECUARIO_COMPRAS".galpon_id IS
  'Destino a nivel de galpón, solo informativo — PECUARIO_INSUMOS_MOVIMIENTOS no tiene columna de galpón (solo poza_id/lote_id), así que el movimiento que genera esta compra no hereda este dato. Ver comentario de cabecera de esta migración.';

-- Consistencia por rama: mismo criterio XOR que MortalidadRegistroSchema/
-- VentaRegistroSchema en lib/validators/pecuario.ts.
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_COMPRAS" ADD CONSTRAINT chk_compras_rama_por_concepto CHECK (
      (concepto = 'insumo'
        AND insumo_id IS NOT NULL AND cantidad IS NOT NULL AND cantidad > 0
        AND galpon_id IS NOT NULL AND costo_insumo IS NOT NULL AND costo_insumo >= 0
        AND (flete IS NULL OR flete >= 0)
        AND categoria_gasto IS NULL AND descripcion IS NULL AND monto_servicio IS NULL)
      OR
      (concepto = 'servicio_otro'
        AND categoria_gasto IS NOT NULL AND descripcion IS NOT NULL
        AND monto_servicio IS NOT NULL AND monto_servicio >= 0
        AND insumo_id IS NULL AND cantidad IS NULL AND galpon_id IS NULL
        AND costo_insumo IS NULL AND flete IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_COMPRAS"
        ADD CONSTRAINT fk_pecuario_compras_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_COMPRAS"
        ADD CONSTRAINT fk_pecuario_compras_insumo FOREIGN KEY (insumo_id)
        REFERENCES public."PECUARIO_INSUMOS"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_COMPRAS"
        ADD CONSTRAINT fk_pecuario_compras_galpon FOREIGN KEY (galpon_id)
        REFERENCES public."PECUARIO_GALPONES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_compras_org_fecha ON public."PECUARIO_COMPRAS" ("ID_Organizacion", fecha);
CREATE INDEX IF NOT EXISTS idx_pecuario_compras_insumo ON public."PECUARIO_COMPRAS" (insumo_id);

-- ---------------------------------------------------------------------
-- 3. Trigger: compra de insumo -> genera su entrada en el kardex
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_compra_genera_entrada_insumo()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.concepto = 'insumo' THEN
    INSERT INTO public."PECUARIO_INSUMOS_MOVIMIENTOS"
      (id, "ID_Organizacion", insumo_id, tipo_movimiento, cantidad, fecha, observaciones, device_id, created_offline_at)
    VALUES
      (gen_random_uuid(), NEW."ID_Organizacion", NEW.insumo_id, 'entrada', NEW.cantidad, NEW.fecha,
       'Generado automáticamente por compra ' || NEW.id, NEW.device_id, NEW.created_offline_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compra_genera_entrada_insumo ON public."PECUARIO_COMPRAS";
CREATE TRIGGER trg_compra_genera_entrada_insumo
  AFTER INSERT ON public."PECUARIO_COMPRAS"
  FOR EACH ROW EXECUTE FUNCTION fn_compra_genera_entrada_insumo();

-- ---------------------------------------------------------------------
-- 4. RLS — mismo patrón que el resto del módulo
-- ---------------------------------------------------------------------

ALTER TABLE public."PECUARIO_COMPRAS" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_compras" ON public."PECUARIO_COMPRAS";
CREATE POLICY "rls_all_pecuario_compras" ON public."PECUARIO_COMPRAS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

-- NOTA (pendiente, fuera de alcance de esta migración): la restricción
-- "solo admin puede dar de alta un insumo nuevo en el catálogo"
-- (pecuario_compras_gastos.md §3.1) es sobre PECUARIO_INSUMOS, no sobre
-- esta tabla, y hoy la web no tiene sesión de Supabase Auth real (usa la
-- llave anon) — esa restricción debe aplicarse en la Server Action
-- correspondiente (lib/actions/), no solo confiar en RLS. Ver
-- pecuario_compras_gastos.md §4/§5.

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'PECUARIO_COMPRAS' ORDER BY ordinal_position;
--
-- INSERT INTO "PECUARIO_COMPRAS" ("ID_Organizacion", concepto, insumo_id, cantidad, galpon_id, costo_insumo, flete)
--   VALUES ('<org de prueba>', 'insumo', '<insumo_id>', 75, '<galpon_id>', 150, 10);
--   -- esperado: monto_total = 160.00, y una fila nueva en
--   -- PECUARIO_INSUMOS_MOVIMIENTOS (tipo_movimiento='entrada', cantidad=75)
-- ---------------------------------------------------------------------
