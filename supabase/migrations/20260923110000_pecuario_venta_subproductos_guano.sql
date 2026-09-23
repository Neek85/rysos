-- =====================================================================
-- RYZOS · Pecuario Cuyes · Venta de subproductos (Guano), tabla propia,
-- separada de PECUARIO_VENTAS
-- Fecha: 2026-09-23
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (system prompt Sección 4.1.2): cubierta
-- en el mismo flujo, por haberse trabajado con Claude desde el principio.
--
-- Spec de referencia: specs/pecuario_venta_subproductos_guano.md
-- (decisión confirmada por Neyser, 2026-09-13; roadmap de Pecuario
-- 2026-09-23, ítem 1 de Nivel 1 — ver claude/roadmap_pecuario_mockup_a_backend.md
-- del proyecto de Cowork).
--
-- DECISIÓN DE ARQUITECTURA (spec §3 la dejaba abierta, se resuelve acá):
-- tabla nueva `PECUARIO_VENTAS_SUBPRODUCTOS`, NO una columna
-- `tipo_registro` sobre `PECUARIO_VENTAS`. Mismo razonamiento ya aplicado
-- y validado en `PECUARIO_COMPRAS` (spec `pecuario_compras_gastos.md` §
-- "Por qué separado de Insumos"): el guano no es una venta de animal —
-- no tiene `animal_id`/`lote_id`, no se cobra por unidad-animal
-- (`precio_unitario` × `cantidad` no aplica), no dispara
-- `fn_dar_baja_animal_por_venta()`, y su "galpón de origen" es solo
-- informativo (nunca poza/lote, a diferencia de una venta de animales).
-- Forzarlo dentro de `PECUARIO_VENTAS` habría dejado la mitad de las
-- columnas de esa tabla en NULL para cada fila de guano, y un
-- `tipo_registro` que ningún reporte financiero pidió combinar con las
-- ventas de animales en una sola consulta (la spec no lo pide en ningún
-- lado — si en el futuro Neyser pide un total financiero combinado, es
-- una vista `UNION ALL` sobre las dos tablas, no una razón para fusionar
-- los esquemas ahora).
--
-- NOTA sobre el enum `tipo_venta_cuy`: ya tiene el valor 'guano' desde la
-- migración v1 (20260910160000), de cuando el guano todavía se trataba
-- como una venta de animal más. Postgres no permite eliminar un valor de
-- enum. Ese valor queda como vestigio inerte: la spec (2026-09-13, antes
-- de esta migración) ya había retirado "Guano" de las opciones de "Tipo
-- de salida" en el simulador, y esta migración no lo reintroduce en
-- ningún lado — `PECUARIO_VENTAS_SUBPRODUCTOS` usa su propio enum nuevo
-- (`tipo_subproducto_pecuario`), no reutiliza `tipo_venta_cuy`. No se
-- agrega un CHECK que bloquee `tipo_salida='guano'` sobre
-- `PECUARIO_VENTAS` en esta migración — eso es una restricción nueva no
-- pedida por la spec y, sin verificar primero si existen filas reales
-- históricas con ese valor (posibles, de antes de la decisión del
-- 2026-09-13), podría romper datos reales. Queda como verificación
-- recomendada para la CLI antes de aplicar (ver verificación al final).
--
-- CONTEXTO: hoy "Registrar venta" no distingue qué se vende — todo pasa
-- por el flujo de animales (lote/reproductor, cantidad de animales,
-- precio por unidad). El guano es un subproducto de la crianza, no un
-- animal: se vende por saco o kg, a un precio total acordado, sin lote
-- ni reproductor asociado.
--
-- Aditiva: no toca PECUARIO_VENTAS, PECUARIO_LOTES, PECUARIO_REPRODUCTORES,
-- ni fn_dar_baja_animal_por_venta(). Idempotente.
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('public."ORGANIZACIONES"') IS NULL THEN
    RAISE EXCEPTION 'Falta ORGANIZACIONES. Esquema core no aplicado.';
  END IF;
  IF to_regclass('public."PECUARIO_GALPONES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_GALPONES (20260911090000). Corré primero v2.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Enums (ambos nuevos — no reutilizan tipo_venta_cuy/unidad_medida)
-- ---------------------------------------------------------------------

-- Solo 'guano' por ahora (spec §2.2: "queda abierto por si en el futuro
-- aparece otro subproducto, ej. pelo/pelambre, sin que eso obligue a
-- tocar el flujo de animales"). Agregar un valor nuevo más adelante es un
-- ALTER TYPE ... ADD VALUE aditivo — mismo cuidado de dos archivos/dos
-- Runs si ese valor nuevo necesitara usarse en un CHECK en el mismo
-- script (ver 20260923090000a/b_pecuario_venta_pelado_*.sql).
DO $$ BEGIN
    CREATE TYPE tipo_subproducto_pecuario AS ENUM ('guano');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Solo 'sacos'/'kg' — spec §4 deja "Toneladas" como pregunta abierta sin
-- confirmar con los técnicos todavía; no se agrega especulativamente.
DO $$ BEGIN
    CREATE TYPE unidad_venta_subproducto AS ENUM ('sacos', 'kg');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------
-- 2. PECUARIO_VENTAS_SUBPRODUCTOS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PECUARIO_VENTAS_SUBPRODUCTOS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS fecha DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS producto tipo_subproducto_pecuario NOT NULL DEFAULT 'guano';
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS cantidad NUMERIC(10,2) NOT NULL;
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS unidad unidad_venta_subproducto NOT NULL;
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS precio_total NUMERIC(10,2);
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS galpon_id UUID;
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS comprador_nombre VARCHAR(150);
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public."PECUARIO_VENTAS_SUBPRODUCTOS".galpon_id IS
  'Solo informativo (de dónde salió el guano) — spec explícita: nunca se rastrea por poza ni por lote, el guano acumulado no es atribuible a un lote específico una vez recogido.';
COMMENT ON COLUMN public."PECUARIO_VENTAS_SUBPRODUCTOS".precio_total IS
  'Un solo número acordado por el lote de venta completo, sin desglose por unidad (spec §2.2) — opcional pero recomendado, a diferencia de precio_total en PECUARIO_VENTAS que es NOT NULL.';
COMMENT ON COLUMN public."PECUARIO_VENTAS_SUBPRODUCTOS".comprador_nombre IS
  'PII de un tercero — nunca a consola/log, nunca en /trace público. Mismo criterio que PECUARIO_VENTAS.comprador_nombre.';

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD CONSTRAINT chk_ventas_subproductos_cantidad_positiva
      CHECK (cantidad > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ADD CONSTRAINT chk_ventas_subproductos_precio_no_negativo
      CHECK (precio_total IS NULL OR precio_total >= 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS"
        ADD CONSTRAINT fk_pecuario_ventas_subproductos_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS"
        ADD CONSTRAINT fk_pecuario_ventas_subproductos_galpon FOREIGN KEY (galpon_id)
        REFERENCES public."PECUARIO_GALPONES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_ventas_subproductos_org_fecha ON public."PECUARIO_VENTAS_SUBPRODUCTOS" ("ID_Organizacion", fecha);

-- ---------------------------------------------------------------------
-- 3. RLS — mismo patrón que el resto del módulo. Sin trigger: el guano
--    no da de baja ningún animal ni mueve stock de Insumos (spec §3:
--    "No requiere cambios en fn_dar_baja_animal_por_venta()").
-- ---------------------------------------------------------------------

ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_ventas_subproductos" ON public."PECUARIO_VENTAS_SUBPRODUCTOS";
CREATE POLICY "rls_all_pecuario_ventas_subproductos" ON public."PECUARIO_VENTAS_SUBPRODUCTOS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'PECUARIO_VENTAS_SUBPRODUCTOS' ORDER BY ordinal_position;
--
-- INSERT INTO "PECUARIO_VENTAS_SUBPRODUCTOS" ("ID_Organizacion", cantidad, unidad, precio_total, galpon_id, comprador_nombre)
--   VALUES ('<org de prueba>', 40, 'sacos', 80, '<galpon_id>', 'Vivero Don Pepe');
--   -- esperado: fila creada, producto default 'guano', sin animal_id/lote_id
--   -- (esas columnas no existen en esta tabla)
--
-- Debe fallar por chk_ventas_subproductos_cantidad_positiva:
-- INSERT INTO "PECUARIO_VENTAS_SUBPRODUCTOS" ("ID_Organizacion", cantidad, unidad)
--   VALUES ('<org de prueba>', 0, 'kg');
--
-- Recomendado (informativo, no bloqueante — ver nota de cabecera sobre
-- tipo_venta_cuy): confirmar si existen filas reales/históricas en
-- PECUARIO_VENTAS con tipo_salida='guano', de antes de la decisión del
-- 2026-09-13:
-- SELECT count(*) FROM "PECUARIO_VENTAS" WHERE tipo_salida = 'guano';
-- ---------------------------------------------------------------------