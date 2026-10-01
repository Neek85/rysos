-- Migración: Corrige la guarda de organización/rol de
-- fn_crear_insumo_con_stock_inicial, que NUNCA se ejecutaba.
--
-- Hallazgo: tests/test_pecuario_insumos_rls_y_rpc.py (Claude Code CLI,
-- 2026-10-01), contra la función ya aplicada de
-- 20261001223000_fix_rls_insumos_y_galpon_movimientos.sql. Tres casos fallaron
-- porque la RPC aceptaba lo que debía rechazar (HTTP 204 en vez de 400):
-- tecnico_campo, auditor_qc y un admin pasando la organización de OTRA
-- organización. Además una llamada con la anon key llegó hasta el INSERT.
-- Revisión de seguridad: Claude (Cowork), Arquitecto Senior RYZOS, 2026-10-01 —
-- gate de la Sección 4.1.2 del documento maestro, cubierto en el mismo flujo
-- (tarea redactada y revisada por Claude).
--
-- Causa raíz: la guarda original era
--   IF NOT (auth.role() = 'service_role' OR CURRENT_USER = 'postgres') THEN
-- En una función SECURITY DEFINER, CURRENT_USER es el DUEÑO de la función
-- (postgres), no quien la llama. Por eso `CURRENT_USER = 'postgres'` era
-- verdadero para cualquier llamador, y todo el bloque de validación se saltaba.
--
-- Por qué el patrón de RLS no aplica dentro de una función: en una policy RLS,
-- CURRENT_USER es el rol con el que corre la consulta (authenticated, anon,
-- service_role o postgres), y `OR CURRENT_USER = 'postgres'` solo deja pasar a
-- conexiones directas como postgres (p. ej. el SQL Editor de Studio). Dentro de
-- una función SECURITY DEFINER esa misma expresión pierde ese significado,
-- porque el contexto de ejecución ya cambió al dueño. La identidad real del
-- llamador sigue disponible en el JWT de la request, que es lo que leen
-- auth.role(), auth_org_id() y auth_role().
--
-- Corrección: el único bypass es auth.role() = 'service_role' (JWT de la
-- request). Cualquier otro llamador (authenticated, anon, o una conexión directa
-- sin JWT donde auth.role() es NULL) pasa por la validación de organización y
-- rol. Efecto colateral aceptado: ejecutar la función desde el SQL Editor como
-- postgres, sin JWT, ahora se rechaza (auth_org_id() es NULL); para sembrar
-- datos a mano se usa la service_role key o los INSERT directos.
--
-- Esta migración reemplaza solo el cuerpo (mismo nombre y misma firma). Los
-- permisos de EXECUTE no cambian acá: ver
-- 20261001230000_revoke_execute_publico_insumos.sql, que sigue siendo necesaria
-- (defensa en profundidad) y es independiente de esta.
--
-- Idempotente: CREATE OR REPLACE FUNCTION.
-- Plan de reversión: volver a aplicar la definición de
-- 20261001223000_fix_rls_insumos_y_galpon_movimientos.sql (sección 4) — solo si
-- hubiera una razón real; esa versión deja la RPC sin guarda efectiva.

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
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_id_organizacion IS DISTINCT FROM auth_org_id() THEN
      RAISE EXCEPTION 'No autorizado: organización no coincide con la sesión autenticada';
    END IF;
    IF auth_role() IS DISTINCT FROM 'admin' THEN
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
    IF p_galpon_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM "PECUARIO_GALPONES" g
        WHERE g.id = p_galpon_id AND g."ID_Organizacion" = p_id_organizacion
      ) THEN
        RAISE EXCEPTION 'El galpón indicado no pertenece a la organización';
      END IF;
    END IF;

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
