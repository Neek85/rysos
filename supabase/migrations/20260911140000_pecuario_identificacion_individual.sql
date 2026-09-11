-- =====================================================================
-- RYZOS MODULE: VERTICAL PECUARIA — IDENTIFICACIÓN INDIVIDUAL (v3)
-- Overlay opcional sobre el manejo poblacional (v1) + sanidad/insumos (v2).
-- Ver specs/pecuario_identificacion_individual.md para el análisis completo
-- (rescate del diseño previo en AppSheet "CuyManager SaaS V1", inconcluso) y
-- las decisiones de producto que definen este alcance.
--
-- Depende de:
--   - 20260910160000_pecuario_cuyes_core.sql (v1, aplicada y verificada en
--     vivo 2026-09-10)
--   - 20260911090000_pecuario_sanidad_insumos.sql (v2 — PECUARIO_GALPONES,
--     PECUARIO_INSUMOS/PECUARIO_INSUMOS_MOVIMIENTOS)
-- Por eso el preflight de abajo EXIGE que v2 ya esté aplicada antes de
-- continuar — evita un fallo a mitad de migración si se corre fuera de
-- orden. Decisión de negocio confirmada: v2 y v3 se aplican juntas, en ese
-- orden, en la misma sesión.
--
-- No rompe nada de v1/v2: todo es CREATE TABLE nuevo o ADD COLUMN IF NOT
-- EXISTS con default NULL. Una organización que nunca activa el modo
-- individual no ve ninguna diferencia funcional.
--
-- Activación por organización: dato en ORGANIZACIONES."Config" (JSON), no
-- requiere columna nueva — ej. Config->'pecuario'->>'identificacion_individual'
-- = 'true'. Fuera del alcance de esta migración (es un valor, no un cambio
-- de esquema); lo agrega la app/admin al activar el módulo para un tenant.
-- =====================================================================

BEGIN;

-- 0. PREFLIGHT: exige v2 ya aplicada (PECUARIO_GALPONES, PECUARIO_INSUMOS).
DO $$ BEGIN
    IF to_regclass('public."PECUARIO_GALPONES"') IS NULL THEN
        RAISE EXCEPTION 'PECUARIO_GALPONES no existe. Aplicar primero 20260911090000_pecuario_sanidad_insumos.sql (v2) antes de esta migración (v3).';
    END IF;
    IF to_regclass('public."PECUARIO_INSUMOS"') IS NULL THEN
        RAISE EXCEPTION 'PECUARIO_INSUMOS no existe. Aplicar primero v2 antes de esta migración (v3).';
    END IF;
    IF to_regclass('public."PECUARIO_JAULAS"') IS NULL THEN
        RAISE EXCEPTION 'PECUARIO_JAULAS no existe. Aplicar primero v1 y v2 antes de esta migración (v3).';
    END IF;
END $$;

-- 1. ENUMS NUEVOS (idempotente)
DO $$ BEGIN
    CREATE TYPE sexo_cuy AS ENUM ('macho', 'hembra');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE proposito_animal AS ENUM ('reproductor', 'engorde', 'reemplazo', 'descarte');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE estado_animal AS ENUM ('activo', 'vendido', 'muerto', 'enfermo');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE alcance_tratamiento AS ENUM ('galpon', 'lote', 'individual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE tipo_tratamiento_sanitario AS ENUM ('preventivo', 'curativo', 'vitaminas');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 2. PECUARIO_REPRODUCTORES — solo hembras/machos identificados
-- individualmente (no se pone arete a cada cuy de engorde). Rescata la idea
-- del app donante ("animales"), corrigiendo su modelo de consanguinidad
-- (ver función fn_son_parientes más abajo) y sin heredar su multi-tenant
-- débil (capa de aplicación solamente) — acá RLS real desde el día uno.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_REPRODUCTORES" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS codigo_arete VARCHAR(50) NOT NULL;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS sexo sexo_cuy NOT NULL;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS raza VARCHAR(50);
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS madre_id UUID;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS padre_id UUID;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS jaula_actual_id UUID;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS proposito proposito_animal NOT NULL DEFAULT 'reproductor';
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS estado estado_animal NOT NULL DEFAULT 'activo';
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS fecha_salida DATE;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS foto_url TEXT;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS notas TEXT;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_REPRODUCTORES"
        ADD CONSTRAINT fk_pecuario_reproductores_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_REPRODUCTORES"
        ADD CONSTRAINT fk_pecuario_reproductores_madre FOREIGN KEY (madre_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_REPRODUCTORES"
        ADD CONSTRAINT fk_pecuario_reproductores_padre FOREIGN KEY (padre_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_REPRODUCTORES"
        ADD CONSTRAINT fk_pecuario_reproductores_jaula FOREIGN KEY (jaula_actual_id)
        REFERENCES public."PECUARIO_JAULAS"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD CONSTRAINT uq_reproductor_org_arete UNIQUE ("ID_Organizacion", codigo_arete);
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_reproductores_org ON public."PECUARIO_REPRODUCTORES" ("ID_Organizacion");
CREATE INDEX IF NOT EXISTS idx_pecuario_reproductores_jaula ON public."PECUARIO_REPRODUCTORES" (jaula_actual_id);
CREATE INDEX IF NOT EXISTS idx_pecuario_reproductores_madre ON public."PECUARIO_REPRODUCTORES" (madre_id);
CREATE INDEX IF NOT EXISTS idx_pecuario_reproductores_padre ON public."PECUARIO_REPRODUCTORES" (padre_id);

-- =====================================================================
-- 3. PECUARIO_HISTORIAL_MACHOS — auditoría de rotación de machos por jaula.
-- A diferencia del app donante, fecha_salida NO tiene default TODAY() (ese
-- fue un bug real detectado en su diseño: dejaba cada asignación "cerrada"
-- desde el momento en que se creaba). Queda NULL hasta que el macho sale de
-- verdad; el trigger de abajo cierra automáticamente el registro anterior.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_HISTORIAL_MACHOS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS macho_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS jaula_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS fecha_entrada DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS fecha_salida DATE;
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS"
        ADD CONSTRAINT fk_pecuario_historial_machos_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS"
        ADD CONSTRAINT fk_pecuario_historial_machos_macho FOREIGN KEY (macho_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS"
        ADD CONSTRAINT fk_pecuario_historial_machos_jaula FOREIGN KEY (jaula_id)
        REFERENCES public."PECUARIO_JAULAS"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_historial_machos_org ON public."PECUARIO_HISTORIAL_MACHOS" ("ID_Organizacion");
CREATE INDEX IF NOT EXISTS idx_pecuario_historial_machos_jaula_activo ON public."PECUARIO_HISTORIAL_MACHOS" (jaula_id) WHERE fecha_salida IS NULL;

-- Trigger: al asignar un macho nuevo a una jaula, cierra automáticamente
-- cualquier asignación anterior de esa misma jaula que siguiera abierta.
CREATE OR REPLACE FUNCTION public.fn_cerrar_historial_macho_anterior()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public."PECUARIO_HISTORIAL_MACHOS"
    SET fecha_salida = COALESCE(NEW.fecha_entrada, CURRENT_DATE)
    WHERE jaula_id = NEW.jaula_id
      AND fecha_salida IS NULL
      AND id <> NEW.id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cerrar_historial_macho_anterior ON public."PECUARIO_HISTORIAL_MACHOS";
CREATE TRIGGER trg_cerrar_historial_macho_anterior
AFTER INSERT ON public."PECUARIO_HISTORIAL_MACHOS"
FOR EACH ROW EXECUTE FUNCTION public.fn_cerrar_historial_macho_anterior();

-- =====================================================================
-- 4. Columnas nuevas en tablas existentes (no rompen nada — ADD COLUMN IF
-- NOT EXISTS, default NULL, no se toca ninguna columna ya usada por v1/v2).
-- =====================================================================

-- PECUARIO_PARTOS: FK real al macho (complementa, no reemplaza,
-- macho_activo_codigo de v1 que sigue existiendo como texto libre).
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS macho_id UUID;
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_PARTOS"
        ADD CONSTRAINT fk_pecuario_partos_macho FOREIGN KEY (macho_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
COMMENT ON COLUMN public."PECUARIO_PARTOS".macho_id IS
    'v3: FK real al padre identificado (cuando el modo de identificación individual está activo). madre_id (v1, reservada sin FK) se activa como FK real más abajo.';

-- PECUARIO_PARTOS.madre_id ya existía reservada desde v1 sin FK — se
-- convierte en FK real ahora que PECUARIO_REPRODUCTORES existe.
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_PARTOS"
        ADD CONSTRAINT fk_pecuario_partos_madre FOREIGN KEY (madre_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- PECUARIO_MORTALIDAD.animal_id ya existía reservada desde v1 sin FK — se
-- convierte en FK real. Se agrega el CHECK "individual XOR poblacional":
-- si animal_id está lleno, lote_id/poza_id deben estar vacíos, y viceversa
-- debe haber al menos uno de lote_id/poza_id si animal_id está vacío. Esto
-- corrige a propósito un hueco real detectado en el app donante (permitía
-- dejar los tres campos sin ninguna restricción cruzada).
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_MORTALIDAD"
        ADD CONSTRAINT fk_pecuario_mortalidad_animal FOREIGN KEY (animal_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_MORTALIDAD" ADD CONSTRAINT chk_mortalidad_individual_xor_poblacional
        CHECK (
            (animal_id IS NOT NULL AND lote_id IS NULL AND poza_id IS NULL)
            OR
            (animal_id IS NULL AND (lote_id IS NOT NULL OR poza_id IS NOT NULL))
        );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- PECUARIO_VENTAS: columna nueva animal_id (no existía en v1 — el diseño
-- original solo contemplaba venta por lote). Mismo criterio "exactamente
-- uno" que mortalidad, aquí entre animal_id y lote_id (poza_id queda como
-- dato de contexto opcional, no participa del CHECK).
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS animal_id UUID;
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS"
        ADD CONSTRAINT fk_pecuario_ventas_animal FOREIGN KEY (animal_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS" ADD CONSTRAINT chk_ventas_individual_xor_lote
        CHECK (
            (animal_id IS NOT NULL AND lote_id IS NULL)
            OR
            (animal_id IS NULL AND lote_id IS NOT NULL)
        );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 5. PECUARIO_TRATAMIENTOS — tratamientos veterinarios puntuales, con
-- alcance (galpón/lote/individual). Distinto de PECUARIO_CONTROL_SANITARIO
-- (v2, desinfección recurrente y siempre a nivel de organización) — se
-- separan a propósito, decisión de producto confirmada, porque tienen
-- frecuencia y forma muy distintas: uno es programado y periódico, el otro
-- es puntual por diagnóstico. Rescata el patrón de "alcance" del app
-- donante (el más limpio de sus tres variantes de tabla dual-modo), con el
-- CHECK que ese app nunca tuvo.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_TRATAMIENTOS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS alcance alcance_tratamiento NOT NULL;
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS galpon_id UUID;
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS lote_id UUID;
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS animal_id UUID;
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS fecha DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS tipo_tratamiento tipo_tratamiento_sanitario NOT NULL DEFAULT 'preventivo';
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS diagnostico TEXT;
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS insumo_id UUID;
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS cantidad_dosis NUMERIC(10,2);
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS costo_estimado NUMERIC(10,2);
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRATAMIENTOS"
        ADD CONSTRAINT fk_pecuario_tratamientos_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRATAMIENTOS"
        ADD CONSTRAINT fk_pecuario_tratamientos_galpon FOREIGN KEY (galpon_id)
        REFERENCES public."PECUARIO_GALPONES"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRATAMIENTOS"
        ADD CONSTRAINT fk_pecuario_tratamientos_lote FOREIGN KEY (lote_id)
        REFERENCES public."PECUARIO_LOTES"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRATAMIENTOS"
        ADD CONSTRAINT fk_pecuario_tratamientos_animal FOREIGN KEY (animal_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRATAMIENTOS"
        ADD CONSTRAINT fk_pecuario_tratamientos_insumo FOREIGN KEY (insumo_id)
        REFERENCES public."PECUARIO_INSUMOS"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Exactamente un target según el alcance declarado — el propio app donante
-- nunca forzó esto (su Valid_If comparaba dominios que no correspondían) y
-- se detectó como una inconsistencia real en el análisis previo.
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD CONSTRAINT chk_tratamientos_alcance_target
        CHECK (
            (alcance = 'galpon'     AND galpon_id IS NOT NULL AND lote_id IS NULL     AND animal_id IS NULL)
            OR (alcance = 'lote'       AND lote_id IS NOT NULL   AND galpon_id IS NULL   AND animal_id IS NULL)
            OR (alcance = 'individual' AND animal_id IS NOT NULL AND galpon_id IS NULL   AND lote_id IS NULL)
        );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRATAMIENTOS" ADD CONSTRAINT chk_tratamientos_dosis CHECK (cantidad_dosis IS NULL OR cantidad_dosis > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_tratamientos_org_fecha ON public."PECUARIO_TRATAMIENTOS" ("ID_Organizacion", fecha);

-- Trigger: descuenta del kardex de insumos al registrar un tratamiento que
-- consume un insumo (idea rescatada del bot "Descontar Medicina del Stock"
-- del app donante — esa parte de su diseño sí estaba bien armada).
CREATE OR REPLACE FUNCTION public.fn_descontar_insumo_tratamiento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.insumo_id IS NOT NULL AND NEW.cantidad_dosis IS NOT NULL AND NEW.cantidad_dosis > 0 THEN
        INSERT INTO public."PECUARIO_INSUMOS_MOVIMIENTOS" (
            id, "ID_Organizacion", insumo_id, tipo_movimiento, cantidad, fecha,
            lote_id, observaciones, device_id, created_at
        ) VALUES (
            gen_random_uuid(),
            NEW."ID_Organizacion",
            NEW.insumo_id,
            'salida',
            NEW.cantidad_dosis,
            NEW.fecha,
            CASE WHEN NEW.alcance = 'lote' THEN NEW.lote_id ELSE NULL END,
            CONCAT('Tratamiento ', NEW.tipo_tratamiento, ' — alcance: ', NEW.alcance),
            NEW.device_id,
            now()
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_descontar_insumo_tratamiento ON public."PECUARIO_TRATAMIENTOS";
CREATE TRIGGER trg_descontar_insumo_tratamiento
AFTER INSERT ON public."PECUARIO_TRATAMIENTOS"
FOR EACH ROW EXECUTE FUNCTION public.fn_descontar_insumo_tratamiento();

-- =====================================================================
-- 6. Triggers de baja automática — versión CORREGIDA del bot "Auto-Baja
-- Mortalidad" del app donante. Ese bot encadenaba dos acciones invertidas
-- y terminaba marcando "Vendido" cualquier muerte; acá es una sola
-- operación directa y correcta por evento.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_dar_baja_animal_por_mortalidad()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.animal_id IS NOT NULL THEN
        UPDATE public."PECUARIO_REPRODUCTORES"
        SET estado = 'muerto',
            jaula_actual_id = NULL,
            fecha_salida = NEW.fecha_evento,
            updated_at = now()
        WHERE id = NEW.animal_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dar_baja_animal_por_mortalidad ON public."PECUARIO_MORTALIDAD";
CREATE TRIGGER trg_dar_baja_animal_por_mortalidad
AFTER INSERT ON public."PECUARIO_MORTALIDAD"
FOR EACH ROW EXECUTE FUNCTION public.fn_dar_baja_animal_por_mortalidad();

CREATE OR REPLACE FUNCTION public.fn_dar_baja_animal_por_venta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.animal_id IS NOT NULL THEN
        UPDATE public."PECUARIO_REPRODUCTORES"
        SET estado = 'vendido',
            jaula_actual_id = NULL,
            fecha_salida = NEW.fecha_venta,
            updated_at = now()
        WHERE id = NEW.animal_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dar_baja_animal_por_venta ON public."PECUARIO_VENTAS";
CREATE TRIGGER trg_dar_baja_animal_por_venta
AFTER INSERT ON public."PECUARIO_VENTAS"
FOR EACH ROW EXECUTE FUNCTION public.fn_dar_baja_animal_por_venta();

-- =====================================================================
-- 7. Consanguinidad — reemplaza el "ancestros_string" + CONTAINS() del app
-- donante (frágil: un UUID puede aparecer como substring de otro) por una
-- función recursiva real. Validación en la app antes de asignar un macho a
-- una jaula, NO como CHECK/trigger bloqueante en la base — un bloqueo duro
-- en la base rompería la escritura offline si el dato llega desordenado al
-- sincronizar; la app sí debe impedir la asignación en el momento.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_son_parientes(animal_a UUID, animal_b UUID, generaciones INT DEFAULT 3)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH RECURSIVE ancestros_a AS (
        SELECT id, madre_id, padre_id, 0 AS gen
        FROM public."PECUARIO_REPRODUCTORES"
        WHERE id = animal_a
        UNION ALL
        SELECT r.id, r.madre_id, r.padre_id, a.gen + 1
        FROM public."PECUARIO_REPRODUCTORES" r
        JOIN ancestros_a a ON r.id = a.madre_id OR r.id = a.padre_id
        WHERE a.gen < generaciones
    ),
    ancestros_b AS (
        SELECT id, madre_id, padre_id, 0 AS gen
        FROM public."PECUARIO_REPRODUCTORES"
        WHERE id = animal_b
        UNION ALL
        SELECT r.id, r.madre_id, r.padre_id, b.gen + 1
        FROM public."PECUARIO_REPRODUCTORES" r
        JOIN ancestros_b b ON r.id = b.madre_id OR r.id = b.padre_id
        WHERE b.gen < generaciones
    )
    SELECT EXISTS (
        SELECT 1 FROM ancestros_a WHERE id = animal_b
        UNION
        SELECT 1 FROM ancestros_b WHERE id = animal_a
        UNION
        SELECT 1 FROM ancestros_a aa JOIN ancestros_b bb ON aa.id = bb.id AND aa.id NOT IN (animal_a, animal_b)
    );
$$;

-- =====================================================================
-- 8. RLS — habilitación + políticas reales, mismo patrón que v1/v2.
-- =====================================================================
ALTER TABLE public."PECUARIO_REPRODUCTORES"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_TRATAMIENTOS"     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_reproductores" ON public."PECUARIO_REPRODUCTORES";
CREATE POLICY "rls_all_pecuario_reproductores" ON public."PECUARIO_REPRODUCTORES"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_historial_machos" ON public."PECUARIO_HISTORIAL_MACHOS";
CREATE POLICY "rls_all_pecuario_historial_machos" ON public."PECUARIO_HISTORIAL_MACHOS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_tratamientos" ON public."PECUARIO_TRATAMIENTOS";
CREATE POLICY "rls_all_pecuario_tratamientos" ON public."PECUARIO_TRATAMIENTOS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMIT;
