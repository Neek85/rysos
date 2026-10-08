-- =====================================================================
-- supabase/rollbacks/20261008110000_huso_horario_lima_rollback.sql
-- REABRE EL DESFASE UTC: solo para emergencia.
-- =====================================================================
-- Revierte la Migracion 2 del huso horario (America/Lima): los 15 defaults de
-- columnas date de Pecuario vuelven a CURRENT_DATE (UTC), las 3 funciones y la
-- vista vw_pecuario_retiros_macho_pendientes vuelven a su texto previo.
-- Fuente: pg_get_functiondef / pg_get_viewdef tomados en solo lectura el
-- 2026-10-07 (antes de aplicar), guardados fuera del repo en
-- ~/ryzos_scratch/huso_recon2_funciones.json y huso_recon2_vistas.json
-- (reconocimiento ~/ryzos_scratch/huso_recon2.md).
--
-- NOTAS
--   - Conserva el HOTFIX 2026-09-26 de trg_resolver_retiro_macho_pendiente (texto vivo).
--   - Idempotente. NO toca ningun GRANT/REVOKE (CREATE OR REPLACE conserva dueno y ACL).
--   - NO revierte la Migracion 1 (ver 20261008100000_huso_horario_lima_rollback.sql);
--     las funciones fn_hoy_operativo()/fn_fecha_operativa() siguen existiendo.
--   - Tras revertir, los defaults vuelven a dar la fecha de "manana" (UTC) entre las
--     19:00 y las 24:00 de Lima.
-- NO esta en supabase/migrations/ a proposito: no debe correr como migracion.
-- APLICACION MANUAL por Neyser en Supabase Studio. El CLI no aplica nada.
-- =====================================================================

BEGIN;

SET LOCAL search_path = public;

-- 1. Defaults (15)
ALTER TABLE public."PECUARIO_COMPRAS" ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO" ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ALTER COLUMN fecha_entrada SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON" ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_LOTES" ALTER COLUMN fecha_destete SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_MORTALIDAD" ALTER COLUMN fecha_evento SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_PARTOS" ALTER COLUMN fecha_parto SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_PESAJES" ALTER COLUMN fecha_pesaje SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE" ALTER COLUMN fecha_destete SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_TRASLADOS" ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_VENTAS" ALTER COLUMN fecha_venta SET DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;

-- 2. Funciones (texto previo)
-- 2.x fn_cerrar_historial_macho_anterior
CREATE OR REPLACE FUNCTION public.fn_cerrar_historial_macho_anterior()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    UPDATE public."PECUARIO_HISTORIAL_MACHOS"
    SET fecha_salida = COALESCE(NEW.fecha_entrada, CURRENT_DATE)
    WHERE jaula_id = NEW.jaula_id
      AND fecha_salida IS NULL
      AND id <> NEW.id;
    RETURN NEW;
END;
$function$;

-- 2.x fn_crear_insumo_con_stock_inicial
CREATE OR REPLACE FUNCTION public.fn_crear_insumo_con_stock_inicial(p_insumo_id uuid, p_id_organizacion text, p_nombre character varying, p_categoria categoria_insumo, p_unidad_medida unidad_medida_insumo, p_stock_minimo numeric, p_activo boolean, p_device_id text, p_created_offline_at timestamp with time zone, p_stock_inicial numeric DEFAULT NULL::numeric, p_movimiento_id uuid DEFAULT NULL::uuid, p_galpon_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- 2.x trg_resolver_retiro_macho_pendiente
CREATE OR REPLACE FUNCTION public.trg_resolver_retiro_macho_pendiente()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_fecha_salida_actual DATE;
BEGIN
  SELECT fecha_salida INTO v_fecha_salida_actual
    FROM public."PECUARIO_HISTORIAL_MACHOS" WHERE id = NEW.historial_macho_id;

  -- HOTFIX 2026-09-26: comparar contra fecha_retiro_planificada, no
  -- contra NULL (ver cabecera de este archivo) -- "sigue igual a como
  -- se creó el pendiente" es la señal real de "nadie lo reasignó".
  IF v_fecha_salida_actual = NEW.fecha_retiro_planificada THEN
    -- El macho sigue de verdad en esa jaula (no fue reasignado antes de
    -- que alguien marcara "hecho") -- se retira de verdad ahora.
    UPDATE public."PECUARIO_HISTORIAL_MACHOS"
      SET fecha_salida = CURRENT_DATE
      WHERE id = NEW.historial_macho_id;

    UPDATE public."PECUARIO_REPRODUCTORES"
      SET jaula_actual_id = NULL
      WHERE id = NEW.macho_id AND jaula_actual_id = NEW.jaula_id;
  END IF;
  -- Si v_fecha_salida_actual ya no coincide con fecha_retiro_planificada,
  -- el macho fue reasignado a otra jaula antes de resolver este
  -- pendiente -- no se toca nada de
  -- PECUARIO_HISTORIAL_MACHOS/PECUARIO_REPRODUCTORES, solo queda
  -- resuelto el pendiente (spec §6.3: "no se toca la jaula").

  RETURN NEW;
END;
$function$;

-- 3. Vista vw_pecuario_retiros_macho_pendientes (texto previo)
CREATE OR REPLACE VIEW public.vw_pecuario_retiros_macho_pendientes AS
 SELECT r.id,
    r."ID_Organizacion",
    r.macho_id,
    m.codigo_arete AS macho_codigo_arete,
    r.jaula_id,
    j.codigo_poza AS jaula_codigo_poza,
    r.fecha_retiro_planificada,
    r.resuelta,
    r.resuelta_en,
        CASE
            WHEN r.resuelta THEN 'resuelto'::text
            WHEN (r.fecha_retiro_planificada <= CURRENT_DATE) THEN 'vencido'::text
            ELSE 'programado'::text
        END AS estado
   FROM (("PECUARIO_RETIROS_MACHO_PENDIENTES" r
     JOIN "PECUARIO_REPRODUCTORES" m ON ((m.id = r.macho_id)))
     JOIN "PECUARIO_JAULAS" j ON ((j.id = r.jaula_id)))
  WHERE ((r."ID_Organizacion" = auth_org_id()) OR (auth.role() = 'service_role'::text) OR (CURRENT_USER = 'postgres'::name));

COMMIT;
