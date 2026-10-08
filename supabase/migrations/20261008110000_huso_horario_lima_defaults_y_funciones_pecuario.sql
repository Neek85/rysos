-- =====================================================================
-- 20261008110000_huso_horario_lima_defaults_y_funciones_pecuario.sql
-- MIGRACION 2 de 2 - Huso horario operativo (America/Lima): defaults, funciones, 1 vista
-- =====================================================================
-- DEPENDE DE: 20261008100000_huso_horario_lima_vistas_pecuario.sql (Migracion 1),
--   que crea public.fn_hoy_operativo(). Esta migracion aborta si no existe.
--
-- PROBLEMA
--   La base corre en UTC. Entre las 19:00 y las 24:00 de Lima, CURRENT_DATE ya es
--   "manana". Tras la Migracion 1 las vistas usan la fecha de Lima, pero los
--   defaults de columnas date y 3 funciones siguen usando CURRENT_DATE (UTC): una
--   fila sin fecha explicita recibiria la fecha de manana. Aplicar esta migracion
--   poco despues de la Migracion 1.
--
-- QUE HACE (reconocimiento de catalogos 2026-10-08, solo lectura)
--   1. SET DEFAULT public.fn_hoy_operativo() en las 15 columnas date de Pecuario
--      que hoy tienen DEFAULT CURRENT_DATE (todas NOT NULL).
--   2. CREATE OR REPLACE de 3 funciones, partiendo del texto VIVO (pg_get_functiondef),
--      cambiando SOLO CURRENT_DATE por public.fn_hoy_operativo():
--        fn_cerrar_historial_macho_anterior()      plpgsql DEFINER, search_path=public
--        fn_crear_insumo_con_stock_inicial(...12)  plpgsql DEFINER, search_path=public
--        trg_resolver_retiro_macho_pendiente()     plpgsql INVOKER, sin SET
--          (conserva el HOTFIX 2026-09-26: compara con fecha_retiro_planificada)
--      CREATE OR REPLACE conserva dueno, ACL, triggers que las usan y COMMENT.
--   3. CREATE OR REPLACE VIEW vw_pecuario_retiros_macho_pendientes (unica vista
--      restante con CURRENT_DATE): mismas columnas y orden, solo cambia la fecha.
--
-- QUE NO HACE
--   - No cambia filas existentes: los defaults solo afectan inserts futuros.
--   - No toca EUDR_MONITOREO.fecha_monitoreo ni PRECIOS_PRODUCTO.vigente_desde
--     (otros modulos, default CURRENT_DATE): decision aparte.
--   - No toca las vistas SUPERADA (desinfeccion_estado, limpieza_galpon_estado):
--     usan now(), nadie las lee.
--   - No toca permisos (GRANT/REVOKE) de nada.
--
-- GUARDAS (abortan la transaccion si algo no es como en el reconocimiento)
--   - Existe fn_hoy_operativo() (Migracion 1 aplicada).
--   - Cada una de las 15 columnas es date y su default es CURRENT_DATE (o ya
--     fn_hoy_operativo(), para poder re-ejecutar).
--   - Cada funcion existe con la firma esperada y su cuerpo vivo contiene
--     CURRENT_DATE (o ya fn_hoy_operativo()); trg_resolver conserva el marcador
--     HOTFIX 2026-09-26.
--   - La vista tiene las columnas esperadas, en orden.
--
-- ROLLBACK
--   - Defaults: ALTER TABLE ... ALTER COLUMN ... SET DEFAULT CURRENT_DATE (15).
--   - Funciones y vista: CREATE OR REPLACE con el texto previo del snapshot que
--     guarda el CLI (pg_get_functiondef / pg_get_viewdef antes de aplicar).
--
-- IDEMPOTENTE. Transaccional. APLICACION MANUAL por Neyser en Supabase Studio.
-- El CLI no aplica nada. Redacto: Claude (Cowork). Revision de seguridad: ver
-- docs/ESTADO_PROYECTO.md.
-- =====================================================================

BEGIN;

SET LOCAL search_path = public;

-- ---------------------------------------------------------------------
-- 0. GUARDAS
-- ---------------------------------------------------------------------
DO $guarda$
DECLARE
  r        record;
  v_expr   text;
  v_tipo   text;
  v_src    text;
  v_cols   text;
  v_fn     regprocedure;
BEGIN
  IF to_regprocedure('public.fn_hoy_operativo()') IS NULL THEN
    RAISE EXCEPTION 'Guarda: falta public.fn_hoy_operativo(). Aplica primero 20261008100000.';
  END IF;

  -- 15 columnas date con default CURRENT_DATE
  FOR r IN SELECT * FROM (VALUES
      ('PECUARIO_COMPRAS',              'fecha'),
      ('PECUARIO_CONTROL_SANITARIO',    'fecha'),
      ('PECUARIO_HISTORIAL_MACHOS',     'fecha_entrada'),
      ('PECUARIO_INSUMOS_MOVIMIENTOS',  'fecha'),
      ('PECUARIO_LIMPIEZA_GALPON',      'fecha'),
      ('PECUARIO_LOTES',                'fecha_destete'),
      ('PECUARIO_MORTALIDAD',           'fecha_evento'),
      ('PECUARIO_PARTOS',               'fecha_parto'),
      ('PECUARIO_PESAJES',              'fecha_pesaje'),
      ('PECUARIO_RECOLECCIONES_DESTETE','fecha_destete'),
      ('PECUARIO_SANIDAD_REGISTROS',    'fecha'),
      ('PECUARIO_TRASLADOS',            'fecha'),
      ('PECUARIO_TRATAMIENTOS',         'fecha'),
      ('PECUARIO_VENTAS',               'fecha_venta'),
      ('PECUARIO_VENTAS_SUBPRODUCTOS',  'fecha')
    ) AS t(tabla, columna)
  LOOP
    SELECT format_type(a.atttypid, a.atttypmod), pg_get_expr(d.adbin, d.adrelid)
      INTO v_tipo, v_expr
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = to_regclass(format('public.%I', r.tabla))
       AND a.attname = r.columna
       AND NOT a.attisdropped;

    IF v_tipo IS NULL THEN
      RAISE EXCEPTION 'Guarda: no existe public.%.%', r.tabla, r.columna;
    END IF;
    IF v_tipo <> 'date' THEN
      RAISE EXCEPTION 'Guarda: public.%.% no es date (es %)', r.tabla, r.columna, v_tipo;
    END IF;
    IF v_expr IS NULL OR (v_expr <> 'CURRENT_DATE' AND position('fn_hoy_operativo' IN v_expr) = 0) THEN
      RAISE EXCEPTION 'Guarda: default inesperado en public.%.%: %', r.tabla, r.columna, coalesce(v_expr, '(sin default)');
    END IF;
  END LOOP;

  -- 3 funciones: firma esperada y cuerpo vivo con CURRENT_DATE (o ya migrado)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_cerrar_historial_macho_anterior()'),
      ('public.fn_crear_insumo_con_stock_inicial(uuid,text,varchar,categoria_insumo,unidad_medida_insumo,numeric,boolean,text,timestamptz,numeric,uuid,uuid)'),
      ('public.trg_resolver_retiro_macho_pendiente()')
    ) AS t(firma)
  LOOP
    v_fn := to_regprocedure(r.firma);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'Guarda: no existe la funcion %', r.firma;
    END IF;
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn;
    IF position('CURRENT_DATE' IN v_src) = 0 AND position('fn_hoy_operativo' IN v_src) = 0 THEN
      RAISE EXCEPTION 'Guarda: el cuerpo vivo de % no contiene CURRENT_DATE ni fn_hoy_operativo (deriva)', r.firma;
    END IF;
  END LOOP;

  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = to_regprocedure('public.trg_resolver_retiro_macho_pendiente()');
  IF position('HOTFIX 2026-09-26' IN v_src) = 0 THEN
    RAISE EXCEPTION 'Guarda: trg_resolver_retiro_macho_pendiente vivo no trae el HOTFIX 2026-09-26; no se sobrescribe';
  END IF;

  -- vista retiros_macho_pendientes: columnas esperadas
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.vw_pecuario_retiros_macho_pendientes')
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM 'id,ID_Organizacion,macho_id,macho_codigo_arete,jaula_id,jaula_codigo_poza,fecha_retiro_planificada,resuelta,resuelta_en,estado' THEN
    RAISE EXCEPTION 'Guarda: deriva de esquema en vw_pecuario_retiros_macho_pendientes (%)', v_cols;
  END IF;
END
$guarda$;

-- ---------------------------------------------------------------------
-- 1. DEFAULTS de las 15 columnas date de Pecuario
-- ---------------------------------------------------------------------
ALTER TABLE public."PECUARIO_COMPRAS"               ALTER COLUMN fecha         SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO"     ALTER COLUMN fecha         SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS"      ALTER COLUMN fecha_entrada SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS"   ALTER COLUMN fecha         SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON"       ALTER COLUMN fecha         SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_LOTES"                 ALTER COLUMN fecha_destete SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_MORTALIDAD"            ALTER COLUMN fecha_evento  SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_PARTOS"                ALTER COLUMN fecha_parto   SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_PESAJES"               ALTER COLUMN fecha_pesaje  SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE" ALTER COLUMN fecha_destete SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS"     ALTER COLUMN fecha         SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_TRASLADOS"             ALTER COLUMN fecha         SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_TRATAMIENTOS"          ALTER COLUMN fecha         SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_VENTAS"                ALTER COLUMN fecha_venta   SET DEFAULT public.fn_hoy_operativo();
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS"   ALTER COLUMN fecha         SET DEFAULT public.fn_hoy_operativo();

-- ---------------------------------------------------------------------
-- 2. FUNCIONES (texto vivo; solo cambia CURRENT_DATE => public.fn_hoy_operativo())
-- ---------------------------------------------------------------------

-- 2.1 fn_cerrar_historial_macho_anterior
CREATE OR REPLACE FUNCTION public.fn_cerrar_historial_macho_anterior()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
    UPDATE public."PECUARIO_HISTORIAL_MACHOS"
    SET fecha_salida = COALESCE(NEW.fecha_entrada, public.fn_hoy_operativo())
    WHERE jaula_id = NEW.jaula_id
      AND fecha_salida IS NULL
      AND id <> NEW.id;
    RETURN NEW;
END;
$fn$;

-- 2.2 fn_crear_insumo_con_stock_inicial
CREATE OR REPLACE FUNCTION public.fn_crear_insumo_con_stock_inicial(p_insumo_id uuid, p_id_organizacion text, p_nombre character varying, p_categoria categoria_insumo, p_unidad_medida unidad_medida_insumo, p_stock_minimo numeric, p_activo boolean, p_device_id text, p_created_offline_at timestamp with time zone, p_stock_inicial numeric DEFAULT NULL::numeric, p_movimiento_id uuid DEFAULT NULL::uuid, p_galpon_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
      p_movimiento_id, p_id_organizacion, p_insumo_id, 'entrada', p_stock_inicial, public.fn_hoy_operativo(), p_galpon_id,
      'Stock inicial al dar de alta el insumo', p_device_id, p_created_offline_at
    );
  END IF;
END;
$fn$;

-- 2.3 trg_resolver_retiro_macho_pendiente (conserva el HOTFIX 2026-09-26 vivo)
CREATE OR REPLACE FUNCTION public.trg_resolver_retiro_macho_pendiente()
 RETURNS trigger
 LANGUAGE plpgsql
AS $fn$
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
      SET fecha_salida = public.fn_hoy_operativo()
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
$fn$;

-- ---------------------------------------------------------------------
-- 3. VISTA vw_pecuario_retiros_macho_pendientes
-- ---------------------------------------------------------------------
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
            WHEN (r.fecha_retiro_planificada <= public.fn_hoy_operativo()) THEN 'vencido'::text
            ELSE 'programado'::text
        END AS estado
   FROM (("PECUARIO_RETIROS_MACHO_PENDIENTES" r
     JOIN "PECUARIO_REPRODUCTORES" m ON ((m.id = r.macho_id)))
     JOIN "PECUARIO_JAULAS" j ON ((j.id = r.jaula_id)))
  WHERE ((r."ID_Organizacion" = auth_org_id()) OR (auth.role() = 'service_role'::text) OR (CURRENT_USER = 'postgres'::name));

-- ---------------------------------------------------------------------
-- 4. VERIFICACION FINAL (aborta si algo quedo con CURRENT_DATE)
-- ---------------------------------------------------------------------
DO $verif$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_attrdef d
    JOIN pg_class c ON c.oid = d.adrelid
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname LIKE 'PECUARIO\_%'
     AND pg_get_expr(d.adbin, d.adrelid) = 'CURRENT_DATE';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Quedan % defaults CURRENT_DATE en tablas PECUARIO_*', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_proc
   WHERE oid IN (
           to_regprocedure('public.fn_cerrar_historial_macho_anterior()'),
           to_regprocedure('public.fn_crear_insumo_con_stock_inicial(uuid,text,varchar,categoria_insumo,unidad_medida_insumo,numeric,boolean,text,timestamptz,numeric,uuid,uuid)'),
           to_regprocedure('public.trg_resolver_retiro_macho_pendiente()'))
     AND position('CURRENT_DATE' IN prosrc) > 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Quedan % funciones con CURRENT_DATE', v_n;
  END IF;

  IF position('CURRENT_DATE' IN pg_get_viewdef('public.vw_pecuario_retiros_macho_pendientes'::regclass)) > 0 THEN
    RAISE EXCEPTION 'vw_pecuario_retiros_macho_pendientes aun usa CURRENT_DATE';
  END IF;
END
$verif$;

COMMIT;
