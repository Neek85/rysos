-- Migración: Cierra el gap real de RLS en Insumos (app móvil Granja Valencia),
-- agrega el campo galpon_id a los movimientos de stock (requerido por el
-- mockup, ausente en el esquema original), y agrega una función
-- SECURITY DEFINER para dar de alta un insumo con stock inicial de forma
-- atómica (el insumo y su movimiento de entrada quedan en una sola
-- transacción).
--
-- Hallazgo original: Claude Code CLI, 2026-10-01, recon de la pantalla
-- Insumos (punto 7 del roadmap, segunda de 3 pantallas tras Sanidad).
-- Revisión de seguridad: Claude (Cowork), Arquitecto Senior RYZOS,
-- 2026-10-01 — gate de la Sección 4.1.2 del documento maestro, cubierto en
-- el mismo flujo (tarea redactada y revisada por Claude).
--
-- Problema de RLS: PECUARIO_INSUMOS y PECUARIO_INSUMOS_MOVIMIENTOS tenían
-- una única política `ALL` filtrada solo por ID_Organizacion, sin distinguir
-- rol — mismo patrón ya corregido en Sanidad (ver
-- 20260930202402_fix_rls_sanidad_por_rol.sql). Cualquier usuario autenticado
-- de la organización podía escribir el catálogo de insumos, pese a que el
-- mockup asume "solo admin crea insumos". A diferencia de Sanidad, este
-- gap se cierra ANTES de construir la pantalla, no después.
--
-- Decisión de negocio confirmada con Neyser (2026-10-01):
--   - PECUARIO_INSUMOS (catálogo): solo admin puede INSERT/UPDATE/DELETE.
--     Mismo criterio que PECUARIO_CONFIGURACION y PECUARIO_ACTIVIDADES_SANIDAD.
--   - PECUARIO_INSUMOS_MOVIMIENTOS (entradas/salidas de stock): admin y
--     tecnico_campo pueden INSERT (quien registra consumo/reposición en
--     campo). UPDATE/DELETE quedan reservados a admin.
--   - SELECT abierto a cualquier rol autenticado de la organización en
--     ambas tablas.
--   - Stock negativo: sin guard en la base, solo aviso en la interfaz —
--     mismo criterio que ya usa el proyecto para la advertencia de
--     Consanguinidad (banner, nunca bloqueo).
--   - Galpón en movimientos: columna nueva (no se deriva de poza_id, porque
--     un movimiento puede no tener poza asociada: ej. alimento repartido a
--     todo el galpón sin pesar por poza).
--   - Alta de insumo con stock inicial: función SECURITY DEFINER para que
--     el insert del insumo y el de su movimiento de entrada inicial queden
--     en una sola transacción, evitando un insumo huérfano si el segundo
--     insert fallara.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS antes de
-- cada CREATE POLICY, CREATE OR REPLACE FUNCTION.
-- Plan de reversión:
--   1. DROP FUNCTION IF EXISTS fn_crear_insumo_con_stock_inicial;
--   2. Recrear las 2 políticas originales `rls_all_...` (ALL, sin
--      distinción de rol) con el texto citado en el comentario "Problema"
--      de arriba como referencia exacta de qué había antes.
--   3. ALTER TABLE "PECUARIO_INSUMOS_MOVIMIENTOS" DROP COLUMN IF EXISTS galpon_id;
--      (solo seguro si no se cargó ningún dato real todavía en esa columna
--      — confirmar antes de ejecutar este paso de reversión).

-- ============================================================
-- 1. Columna galpon_id en movimientos (requerida por el mockup)
-- ============================================================

ALTER TABLE "PECUARIO_INSUMOS_MOVIMIENTOS"
  ADD COLUMN IF NOT EXISTS galpon_id uuid REFERENCES "PECUARIO_GALPONES"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pecuario_insumos_movimientos_galpon_id
  ON "PECUARIO_INSUMOS_MOVIMIENTOS" (galpon_id);

-- ============================================================
-- 2. PECUARIO_INSUMOS (catálogo — solo admin escribe)
-- ============================================================

DROP POLICY IF EXISTS "rls_all_pecuario_insumos" ON "PECUARIO_INSUMOS";

DROP POLICY IF EXISTS "rls_select_pecuario_insumos" ON "PECUARIO_INSUMOS";
CREATE POLICY "rls_select_pecuario_insumos"
  ON "PECUARIO_INSUMOS"
  FOR SELECT
  TO authenticated
  USING (
    "ID_Organizacion" = auth_org_id()
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_insert_pecuario_insumos" ON "PECUARIO_INSUMOS";
CREATE POLICY "rls_insert_pecuario_insumos"
  ON "PECUARIO_INSUMOS"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_update_pecuario_insumos" ON "PECUARIO_INSUMOS";
CREATE POLICY "rls_update_pecuario_insumos"
  ON "PECUARIO_INSUMOS"
  FOR UPDATE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  )
  WITH CHECK (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_delete_pecuario_insumos" ON "PECUARIO_INSUMOS";
CREATE POLICY "rls_delete_pecuario_insumos"
  ON "PECUARIO_INSUMOS"
  FOR DELETE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

-- ============================================================
-- 3. PECUARIO_INSUMOS_MOVIMIENTOS (admin + tecnico_campo insertan,
-- solo admin corrige/borra)
-- ============================================================

DROP POLICY IF EXISTS "rls_all_pecuario_insumos_movimientos" ON "PECUARIO_INSUMOS_MOVIMIENTOS";

DROP POLICY IF EXISTS "rls_select_pecuario_insumos_movimientos" ON "PECUARIO_INSUMOS_MOVIMIENTOS";
CREATE POLICY "rls_select_pecuario_insumos_movimientos"
  ON "PECUARIO_INSUMOS_MOVIMIENTOS"
  FOR SELECT
  TO authenticated
  USING (
    "ID_Organizacion" = auth_org_id()
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_insert_pecuario_insumos_movimientos" ON "PECUARIO_INSUMOS_MOVIMIENTOS";
CREATE POLICY "rls_insert_pecuario_insumos_movimientos"
  ON "PECUARIO_INSUMOS_MOVIMIENTOS"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ("ID_Organizacion" = auth_org_id() AND auth_role() IN ('admin', 'tecnico_campo'))
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_update_pecuario_insumos_movimientos" ON "PECUARIO_INSUMOS_MOVIMIENTOS";
CREATE POLICY "rls_update_pecuario_insumos_movimientos"
  ON "PECUARIO_INSUMOS_MOVIMIENTOS"
  FOR UPDATE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  )
  WITH CHECK (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_delete_pecuario_insumos_movimientos" ON "PECUARIO_INSUMOS_MOVIMIENTOS";
CREATE POLICY "rls_delete_pecuario_insumos_movimientos"
  ON "PECUARIO_INSUMOS_MOVIMIENTOS"
  FOR DELETE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

-- ============================================================
-- 4. Alta atómica de insumo + movimiento de entrada inicial
-- ============================================================
-- SECURITY DEFINER: bypassa RLS por diseño, así que valida organización y
-- rol explícitamente adentro (mismo patrón defensivo que otros
-- SECURITY DEFINER del proyecto, ej. fn_compra_genera_entrada_insumo).
-- p_insumo_id y p_movimiento_id son UUID v4 generados en el cliente (mismo
-- contrato que toda escritura offline-first del proyecto).

CREATE OR REPLACE FUNCTION fn_crear_insumo_con_stock_inicial(
  p_insumo_id uuid,
  p_id_organizacion text,
  p_nombre varchar,
  p_categoria categoria_insumo,
  p_unidad_medida unidad_medida_insumo,
  p_stock_minimo numeric,
  p_activo boolean,
  p_device_id text,
  p_created_offline_at timestamptz,
  p_stock_inicial numeric DEFAULT NULL,
  p_movimiento_id uuid DEFAULT NULL,
  p_galpon_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR CURRENT_USER = 'postgres') THEN
    IF p_id_organizacion IS DISTINCT FROM auth_org_id() THEN
      RAISE EXCEPTION 'No autorizado: organización no coincide con la sesión autenticada';
    END IF;
    IF auth_role() <> 'admin' THEN
      RAISE EXCEPTION 'No autorizado: solo admin puede crear insumos';
    END IF;
  END IF;

  IF p_stock_inicial IS NOT NULL AND p_stock_inicial > 0 AND p_movimiento_id IS NULL THEN
    RAISE EXCEPTION 'p_movimiento_id es obligatorio cuando se especifica stock_inicial > 0';
  END IF;

  INSERT INTO "PECUARIO_INSUMOS" (
    id, "ID_Organizacion", nombre, categoria, unidad_medida, stock_minimo, activo,
    device_id, created_offline_at
  ) VALUES (
    p_insumo_id, p_id_organizacion, p_nombre, p_categoria, p_unidad_medida, p_stock_minimo, p_activo,
    p_device_id, p_created_offline_at
  );

  IF p_stock_inicial IS NOT NULL AND p_stock_inicial > 0 THEN
    INSERT INTO "PECUARIO_INSUMOS_MOVIMIENTOS" (
      id, "ID_Organizacion", insumo_id, tipo_movimiento, cantidad, fecha, galpon_id,
      observaciones, device_id, created_offline_at
    ) VALUES (
      p_movimiento_id, p_id_organizacion, p_insumo_id, 'entrada', p_stock_inicial, CURRENT_DATE, p_galpon_id,
      'Stock inicial al dar de alta el insumo', p_device_id, p_created_offline_at
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_crear_insumo_con_stock_inicial TO authenticated;
