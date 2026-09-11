-- =====================================================================
-- RYZOS MODULE: VERTICAL PECUARIA — SANIDAD RECURRENTE + INSUMOS (v2)
--
-- RECONSTRUCCIÓN A POSTERIORI (2026-09-11, Claude Code CLI) — este archivo
-- NO es el original: el original nunca llegó a guardarse en este repo (no
-- está en el working tree, ni en el historial de git, ni en ningún stash
-- — confirmado antes de escribir esto). El usuario aplicó la v2 real
-- manualmente en Supabase Studio (desde una sesión de Claude Cowork que no
-- llegó a commitear el archivo) antes de que esta sesión pudiera
-- verificarla. Este archivo se reconstruyó DESPUÉS de la aplicación real,
-- columna por columna, contra el esquema OpenAPI de PostgREST en vivo
-- (GET {SUPABASE_URL}/rest/v1/ con Service Role Key) — no se adivinó
-- ningún nombre de columna, tipo, default ni valor de enum; todos están
-- confirmados contra `jhtocgxlozfuzullrtol` tal como quedaron aplicados.
--
-- Lo que SÍ se pudo confirmar en vivo: columnas exactas + tipos + defaults
-- + valores de los 2 enums nuevos (vía el campo "enum" del OpenAPI) + que
-- las 5 tablas tienen RLS activo y bloquean `anon` (GET con anon key → 200
-- con lista vacía en las 5).
-- Lo que NO se pudo confirmar por REST (PostgREST no expone pg_constraint/
-- pg_policies): nombres exactos de constraints/políticas/índices. Los de
-- abajo siguen el mismo patrón usado en 20260910160000_pecuario_cuyes_core.sql
-- (nombres `fk_pecuario_<tabla>_<col>`, política `rls_all_pecuario_<tabla>`)
-- — si el original aplicado usó nombres distintos, los `DO $$ ... EXCEPTION
-- WHEN duplicate_object` de abajo son no-op silencioso donde ya exista algo
-- equivalente, y agregan el nombre de este archivo donde no — no hay riesgo
-- de romper nada, en el peor caso queda un constraint/política duplicado
-- con otro nombre. Ver specs/pecuario_identificacion_individual.md
-- ("CORRECCIÓN 2026-09-11") para el detalle completo de este hallazgo.
--
-- Alcance (specs/pecuario_identificacion_individual.md, sección "Veredicto
-- general sobre el app donante"): sanidad recurrente (desinfección de
-- galpón, distinta de un tratamiento veterinario puntual — eso es v3,
-- PECUARIO_TRATAMIENTOS) + kardex de insumos (alimento/sanitario/cama/
-- equipo), con movimientos de entrada/salida. PECUARIO_GALPONES es la
-- tabla que v1 dejó pendiente (referenciada por FK condicional desde
-- PECUARIO_JAULAS.galpon_id, nunca creada en v1 — ver el gap documentado
-- en specs/pecuario_cuyes_mvp.md).
-- =====================================================================

BEGIN;

-- 1. ENUMS NUEVOS (idempotente) — valores confirmados en vivo vía OpenAPI.
DO $$ BEGIN
    CREATE TYPE categoria_insumo AS ENUM ('alimento', 'sanitario', 'cama', 'equipo', 'otro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE tipo_movimiento_insumo AS ENUM ('entrada', 'salida');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 2. PECUARIO_GALPONES — tabla nueva. v1 la referenciaba por FK condicional
-- desde PECUARIO_JAULAS.galpon_id sin crearla (gap documentado en v1); acá
-- se crea de verdad.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_GALPONES" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_GALPONES" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_GALPONES" ADD COLUMN IF NOT EXISTS codigo_galpon VARCHAR(50) NOT NULL;
ALTER TABLE public."PECUARIO_GALPONES" ADD COLUMN IF NOT EXISTS nombre VARCHAR(150);
ALTER TABLE public."PECUARIO_GALPONES" ADD COLUMN IF NOT EXISTS capacidad_pozas INT;
ALTER TABLE public."PECUARIO_GALPONES" ADD COLUMN IF NOT EXISTS dias_frecuencia_limpieza INT DEFAULT 15;
ALTER TABLE public."PECUARIO_GALPONES" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_GALPONES" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_GALPONES" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_GALPONES" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_GALPONES" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_GALPONES"
        ADD CONSTRAINT fk_pecuario_galpones_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_GALPONES" ADD CONSTRAINT uq_galpon_org_codigo UNIQUE ("ID_Organizacion", codigo_galpon);
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_galpones_org ON public."PECUARIO_GALPONES" ("ID_Organizacion");

-- Ahora que PECUARIO_GALPONES existe, cierra el gap que v1 dejó abierto:
-- PECUARIO_JAULAS.galpon_id queda con FK real (antes solo emitía RAISE
-- NOTICE porque la tabla destino no existía todavía en ese momento).
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_JAULAS"
        ADD CONSTRAINT fk_pecuario_jaulas_galpon FOREIGN KEY (galpon_id)
        REFERENCES public."PECUARIO_GALPONES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 3. PECUARIO_CONTROL_SANITARIO — desinfección recurrente, siempre a nivel
-- de organización (no de galpón/lote/individual — eso es PECUARIO_TRATAMIENTOS,
-- v3). Distinto de un tratamiento veterinario puntual por diagnóstico.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_CONTROL_SANITARIO" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO" ADD COLUMN IF NOT EXISTS fecha DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO" ADD COLUMN IF NOT EXISTS producto_usado VARCHAR(150);
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO" ADD COLUMN IF NOT EXISTS responsable VARCHAR(150);
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO" ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_CONTROL_SANITARIO"
        ADD CONSTRAINT fk_pecuario_control_sanitario_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_control_sanitario_org_fecha ON public."PECUARIO_CONTROL_SANITARIO" ("ID_Organizacion", fecha);

-- =====================================================================
-- 4. PECUARIO_LIMPIEZA_GALPON — limpieza recurrente por galpón (distinta de
-- PECUARIO_CONTROL_SANITARIO, que es a nivel de organización).
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_LIMPIEZA_GALPON" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON" ADD COLUMN IF NOT EXISTS galpon_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON" ADD COLUMN IF NOT EXISTS fecha DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON" ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON"
        ADD CONSTRAINT fk_pecuario_limpieza_galpon_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON"
        ADD CONSTRAINT fk_pecuario_limpieza_galpon_galpon FOREIGN KEY (galpon_id)
        REFERENCES public."PECUARIO_GALPONES"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_limpieza_galpon_org_fecha ON public."PECUARIO_LIMPIEZA_GALPON" ("ID_Organizacion", fecha);

-- =====================================================================
-- 5. PECUARIO_INSUMOS — kardex de insumos (alimento/sanitario/cama/equipo).
-- Sin columna de stock actual denormalizada: el stock se deriva sumando
-- PECUARIO_INSUMOS_MOVIMIENTOS (entrada - salida), no se guarda aparte.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_INSUMOS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_INSUMOS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_INSUMOS" ADD COLUMN IF NOT EXISTS nombre VARCHAR(150) NOT NULL;
ALTER TABLE public."PECUARIO_INSUMOS" ADD COLUMN IF NOT EXISTS categoria categoria_insumo NOT NULL DEFAULT 'otro';
ALTER TABLE public."PECUARIO_INSUMOS" ADD COLUMN IF NOT EXISTS unidad_medida VARCHAR(20) NOT NULL DEFAULT 'unidad';
ALTER TABLE public."PECUARIO_INSUMOS" ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC;
ALTER TABLE public."PECUARIO_INSUMOS" ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public."PECUARIO_INSUMOS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_INSUMOS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_INSUMOS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_INSUMOS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_INSUMOS"
        ADD CONSTRAINT fk_pecuario_insumos_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_insumos_org ON public."PECUARIO_INSUMOS" ("ID_Organizacion");

-- =====================================================================
-- 6. PECUARIO_INSUMOS_MOVIMIENTOS — kardex de entradas/salidas. v3
-- (fn_descontar_insumo_tratamiento) inserta acá directamente al registrar
-- un tratamiento que consume un insumo.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_INSUMOS_MOVIMIENTOS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS insumo_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS tipo_movimiento tipo_movimiento_insumo NOT NULL;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS cantidad NUMERIC NOT NULL;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS fecha DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS poza_id UUID;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS lote_id UUID;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS"
        ADD CONSTRAINT fk_pecuario_insumos_mov_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS"
        ADD CONSTRAINT fk_pecuario_insumos_mov_insumo FOREIGN KEY (insumo_id)
        REFERENCES public."PECUARIO_INSUMOS"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS"
        ADD CONSTRAINT fk_pecuario_insumos_mov_lote FOREIGN KEY (lote_id)
        REFERENCES public."PECUARIO_LOTES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS"
        ADD CONSTRAINT fk_pecuario_insumos_mov_poza FOREIGN KEY (poza_id)
        REFERENCES public."PECUARIO_JAULAS"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS" ADD CONSTRAINT chk_insumos_mov_cantidad CHECK (cantidad > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_insumos_mov_org_insumo ON public."PECUARIO_INSUMOS_MOVIMIENTOS" ("ID_Organizacion", insumo_id);

-- =====================================================================
-- 6b. vw_pecuario_insumos_stock — CORRECCIÓN (2026-09-11, Claude Code CLI,
-- verificado en vivo): esta vista existe realmente en la instancia real
-- desde la v2 original (la que el usuario aplicó, no esta reconstrucción)
-- pero se había omitido en la primera versión de este archivo — no se
-- descubrió hasta la tarea de v4
-- (20260911180000_pecuario_ventas_insumos_ajustes.sql), que la referencia
-- como "ya existente desde 20260911090000" para poder hacer
-- DROP VIEW/CREATE OR REPLACE alrededor del cambio de tipo de
-- unidad_medida. Agregada acá para que este archivo represente la v2 real
-- completa. Definición confirmada en vivo (columnas vía OpenAPI de
-- PostgREST: insumo_id/ID_Organizacion/nombre/categoria/unidad_medida/
-- stock_minimo/stock_actual) y verbatim contra la que v4 recrea.
-- =====================================================================
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

-- =====================================================================
-- 7. RLS — habilitación + políticas reales, mismo patrón que v1.
-- =====================================================================
ALTER TABLE public."PECUARIO_GALPONES"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_CONTROL_SANITARIO"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_LIMPIEZA_GALPON"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_INSUMOS"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_INSUMOS_MOVIMIENTOS"   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_galpones" ON public."PECUARIO_GALPONES";
CREATE POLICY "rls_all_pecuario_galpones" ON public."PECUARIO_GALPONES"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_control_sanitario" ON public."PECUARIO_CONTROL_SANITARIO";
CREATE POLICY "rls_all_pecuario_control_sanitario" ON public."PECUARIO_CONTROL_SANITARIO"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_limpieza_galpon" ON public."PECUARIO_LIMPIEZA_GALPON";
CREATE POLICY "rls_all_pecuario_limpieza_galpon" ON public."PECUARIO_LIMPIEZA_GALPON"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_insumos" ON public."PECUARIO_INSUMOS";
CREATE POLICY "rls_all_pecuario_insumos" ON public."PECUARIO_INSUMOS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_insumos_movimientos" ON public."PECUARIO_INSUMOS_MOVIMIENTOS";
CREATE POLICY "rls_all_pecuario_insumos_movimientos" ON public."PECUARIO_INSUMOS_MOVIMIENTOS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMIT;
