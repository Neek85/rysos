-- =====================================================================
-- RYZOS · Pecuario Cuyes · v4: ajustes de venta por animal + taxonomía
-- de insumos (revisión de campo sobre v1/v2, 2026-09-11)
-- =====================================================================
-- Contexto (ver specs/pecuario_identificacion_individual.md, sección
-- "Actualización 2026-09-11 — ajustes de campo v4"):
--
-- 1. PECUARIO_VENTAS (v1) modelaba el precio solo como precio_total, sin
--    precio por animal. La comercialización real es por cantidad de
--    animales, no por peso — se agrega precio_unitario y un trigger que
--    mantiene precio_total consistente con cantidad * precio_unitario
--    cuando el técnico informa el precio individual (si no lo informa,
--    p.ej. un lote con precio pactado directo, precio_total se respeta
--    tal como se envía). peso_total_kg se conserva pero pasa a ser un
--    dato referencial opcional, no la base del precio.
-- 2. PECUARIO_INSUMOS.categoria (v2, enum categoria_insumo) no distinguía
--    medicamento de vitamina (ambos caían en 'sanitario', lo que mezclaba
--    fármacos administrados al animal con desinfectantes de instalaciones)
--    y usaba 'cama' de forma muy estrecha. Se amplía el enum agregando
--    'medicamento' y 'vitamina', y se renombra 'cama' a 'material' (cubre
--    cama/viruta y otros consumibles generales). 'sanitario' se conserva
--    para desinfectantes/limpieza de instalaciones (no administrados al
--    animal) — no se fusiona con 'medicamento'.
-- 3. PECUARIO_INSUMOS.unidad_medida (v2, texto libre) pasa a un enum fijo
--    para evitar variantes ("kg"/"Kg"/"kilogramos") entre técnicos y
--    dispositivos, incorporando además unidades pequeñas (g, ml) útiles
--    para medicamentos/vitaminas dosificados en pequeñas cantidades.
--
-- Explícitamente NO se revierte a un campo "Stock Actual" editable a
-- mano (como en el AppSheet original): el stock se sigue calculando por
-- vista a partir de PECUARIO_INSUMOS_MOVIMIENTOS (ver vw_pecuario_insumos_stock
-- en 20260911090000). El "stock actual" que el técnico ve al dar de alta
-- un insumo se resuelve en la capa de aplicación (Server Action) como un
-- primer movimiento de tipo 'entrada' — no como columna en la tabla.
--
-- Idempotente: puede correrse más de una vez sin error.
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_VENTAS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_VENTAS (20260910160000). Corré primero v1.';
  END IF;
  IF to_regclass('public."PECUARIO_INSUMOS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_INSUMOS (20260911090000). Corré primero v2.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. PECUARIO_VENTAS: precio por animal
-- ---------------------------------------------------------------------

ALTER TABLE "PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(10,2);

COMMENT ON COLUMN "PECUARIO_VENTAS".precio_unitario IS
  'Precio por animal (S/). Cuando se informa, precio_total se recalcula automáticamente (cantidad * precio_unitario) vía trigger trg_calcular_precio_total_venta, para que ambos campos nunca diverjan.';

COMMENT ON COLUMN "PECUARIO_VENTAS".peso_total_kg IS
  'Dato referencial opcional (ej. control de conversión alimenticia, o ventas de guano donde sí aplica peso). La comercialización de animales es por cantidad — ver precio_unitario, no este campo.';

CREATE OR REPLACE FUNCTION fn_calcular_precio_total_venta()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.precio_unitario IS NOT NULL THEN
    NEW.precio_total := ROUND(NEW.cantidad * NEW.precio_unitario, 2);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calcular_precio_total_venta ON "PECUARIO_VENTAS";
CREATE TRIGGER trg_calcular_precio_total_venta
  BEFORE INSERT OR UPDATE ON "PECUARIO_VENTAS"
  FOR EACH ROW EXECUTE FUNCTION fn_calcular_precio_total_venta();

-- ---------------------------------------------------------------------
-- 2. categoria_insumo: agrega medicamento/vitamina, renombra cama->material
-- ---------------------------------------------------------------------

ALTER TYPE categoria_insumo ADD VALUE IF NOT EXISTS 'medicamento';
ALTER TYPE categoria_insumo ADD VALUE IF NOT EXISTS 'vitamina';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'categoria_insumo' AND e.enumlabel = 'cama'
  ) THEN
    ALTER TYPE categoria_insumo RENAME VALUE 'cama' TO 'material';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. unidad_medida: de texto libre a enum fijo
-- ---------------------------------------------------------------------

DO $$
BEGIN
  CREATE TYPE unidad_medida_insumo AS ENUM ('kg', 'g', 'litro', 'ml', 'unidad', 'saco_50kg', 'saco_40kg');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- vw_pecuario_insumos_stock (20260911090000) lee unidad_medida — Postgres no
-- deja cambiar el tipo de una columna mientras una vista depende de ella.
-- Se borra acá y se recrea idéntica al final de este bloque, una vez
-- convertida la columna.
DROP VIEW IF EXISTS public.vw_pecuario_insumos_stock;

DO $$
DECLARE
  v_udt_name text;
BEGIN
  SELECT udt_name INTO v_udt_name
  FROM information_schema.columns
  WHERE table_name = 'PECUARIO_INSUMOS' AND column_name = 'unidad_medida';

  IF v_udt_name IS DISTINCT FROM 'unidad_medida_insumo' THEN
    ALTER TABLE "PECUARIO_INSUMOS" ALTER COLUMN unidad_medida DROP DEFAULT;

    EXECUTE $sql$
      ALTER TABLE "PECUARIO_INSUMOS"
        ALTER COLUMN unidad_medida TYPE unidad_medida_insumo
        USING (
          CASE lower(trim(unidad_medida))
            WHEN 'kg' THEN 'kg'
            WHEN 'kilo' THEN 'kg'
            WHEN 'kilogramo' THEN 'kg'
            WHEN 'kilogramos' THEN 'kg'
            WHEN 'g' THEN 'g'
            WHEN 'gr' THEN 'g'
            WHEN 'gramo' THEN 'g'
            WHEN 'gramos' THEN 'g'
            WHEN 'l' THEN 'litro'
            WHEN 'litro' THEN 'litro'
            WHEN 'litros' THEN 'litro'
            WHEN 'ml' THEN 'ml'
            WHEN 'mililitro' THEN 'ml'
            WHEN 'mililitros' THEN 'ml'
            WHEN 'unidad' THEN 'unidad'
            WHEN 'unidades' THEN 'unidad'
            WHEN 'u' THEN 'unidad'
            WHEN 'saco_50kg' THEN 'saco_50kg'
            WHEN 'saco 50kg' THEN 'saco_50kg'
            WHEN 'saco de 50kg' THEN 'saco_50kg'
            WHEN 'saco_40kg' THEN 'saco_40kg'
            WHEN 'saco 40kg' THEN 'saco_40kg'
            WHEN 'saco de 40kg' THEN 'saco_40kg'
            ELSE 'unidad'
          END
        )::unidad_medida_insumo
    $sql$;

    ALTER TABLE "PECUARIO_INSUMOS" ALTER COLUMN unidad_medida SET DEFAULT 'unidad'::unidad_medida_insumo;
  END IF;
END $$;

-- Recreación idéntica a la definición original (20260911090000) — solo
-- cambia el tipo subyacente de unidad_medida, la vista en sí no cambia.
CREATE OR REPLACE VIEW public.vw_pecuario_insumos_stock AS
SELECT
    i.id AS insumo_id,
    i."ID_Organizacion",
    i.nombre,
    i.categoria,
    i.unidad_medida,
    i.stock_minimo,
    COALESCE(SUM(CASE WHEN m.tipo_movimiento = 'entrada' THEN m.cantidad ELSE -m.cantidad END), 0) AS stock_actual
FROM public."PECUARIO_INSUMOS" i
LEFT JOIN public."PECUARIO_INSUMOS_MOVIMIENTOS" m ON m.insumo_id = i.id
WHERE (i."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
GROUP BY i.id, i."ID_Organizacion", i.nombre, i.categoria, i.unidad_medida, i.stock_minimo;

GRANT SELECT ON public.vw_pecuario_insumos_stock TO authenticated;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--   WHERE t.typname = 'categoria_insumo' ORDER BY e.enumsortorder;
--   -- esperado: alimento, sanitario, equipo, otro, medicamento, vitamina, material
--
-- SELECT column_name, udt_name FROM information_schema.columns
--   WHERE table_name = 'PECUARIO_INSUMOS' AND column_name = 'unidad_medida';
--   -- esperado: unidad_medida_insumo
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'PECUARIO_VENTAS' AND column_name = 'precio_unitario';
-- ---------------------------------------------------------------------
