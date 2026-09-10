-- =====================================================================
-- RYZOS MODULE: VERTICAL PECUARIA (GRANJA DE CUYES - CORE MVP)
-- Corrige el diseño original (Gemini) contra el esquema real confirmado en
-- docs/schema_live.md: ORGANIZACIONES."ID" es TEXT (no uuid), y todo el
-- esquema real usa identificadores entrecomillados mixed-case.
--
-- VERIFICADO EN VIVO (2026-09-10, Claude Code CLI, contra jhtocgxlozfuzullrtol):
-- la premisa original de que PECUARIO_GALPONES/PECUARIO_JAULAS/PECUARIO_LOTES/
-- PECUARIO_PESAJE_ALIMENTACION "ya existen en producción (Granja Valencia
-- activa)" era FALSA. Confirmado por 3 vías independientes: (1) el esquema
-- OpenAPI que expone PostgREST (GET /rest/v1/ con Service Role Key) no
-- incluye ninguna de las 5 tablas (las 4 anteriores + TAREAS); (2) un GET
-- directo a cada una devuelve PGRST205 "Could not find the table"; (3)
-- ORGANIZACIONES no tiene ninguna fila "Granja Valencia" — solo existen
-- COOP-AROMAS-VALLE y ORG-TEST-DEMO. Ver specs/pecuario_cuyes_mvp.md
-- "Verificación pendiente" y docs/schema_live_pecuario.md para el detalle
-- completo y los comandos exactos usados para confirmarlo.
--
-- La migración queda escrita igual de defensiva (CREATE TABLE IF NOT EXISTS
-- + ADD COLUMN IF NOT EXISTS + chequeos information_schema antes de cada FK
-- condicional) porque sigue siendo la forma correcta de aplicarla bajo el
-- estado real: crea las 6 tablas nuevas desde cero, en el orden correcto
-- (cada FK condicional encuentra su tabla ya creada más arriba en la misma
-- transacción), sin que nadie tenga que tocar este archivo a mano.
--
-- DOS GAPS REALES QUE QUEDAN, NO SON BUGS DE ESTA MIGRACIÓN:
--   1. PECUARIO_GALPONES nunca se crea acá (solo se referencia por FK
--      condicional) — no existía ningún diseño real de sus columnas más
--      allá de "un galpón agrupa jaulas", así que inventar su estructura
--      acá sería alcance no verificado. galpon_id en PECUARIO_JAULAS queda
--      sin FK (columna suelta) hasta que exista una spec propia para esa
--      tabla — el bloque DO emite RAISE NOTICE al aplicarse, no rompe nada.
--   2. TAREAS tampoco existe — el trigger de destete lo verifica con
--      to_regclass() y no rompe el INSERT del parto si falta (RAISE
--      WARNING), pero ninguna tarea de destete se crea de verdad hasta que
--      TAREAS exista (es un módulo aparte, fuera de alcance de este MVP).
-- =====================================================================

BEGIN;

-- 1. TIPOS ENUMERADOS (idempotente)
DO $$ BEGIN
    CREATE TYPE tipo_uso_poza AS ENUM ('empadre', 'maternidad', 'recria', 'engorde', 'aislamiento');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE etapa_productiva AS ENUM ('lactancia', 'recria', 'engorde', 'reproductor');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE causa_mortalidad AS ENUM ('neumonia', 'distocia', 'aplastamiento', 'gastroenteritis', 'depredador', 'desconocido', 'otro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE tipo_venta_cuy AS ENUM ('carne', 'pie_cria', 'reproductor_saca', 'guano');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 2. PECUARIO_CONFIGURACION (tabla nueva, administrativa — sin campos offline)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_CONFIGURACION" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_CONFIGURACION" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text;
ALTER TABLE public."PECUARIO_CONFIGURACION" ADD COLUMN IF NOT EXISTS dias_lactancia_destete INT DEFAULT 14;
ALTER TABLE public."PECUARIO_CONFIGURACION" ADD COLUMN IF NOT EXISTS max_partos_madre INT DEFAULT 4;
ALTER TABLE public."PECUARIO_CONFIGURACION" ADD COLUMN IF NOT EXISTS min_promedio_crias_vivas NUMERIC(3,1) DEFAULT 2.0;
ALTER TABLE public."PECUARIO_CONFIGURACION" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_CONFIGURACION" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_CONFIGURACION"
        ADD CONSTRAINT fk_pecuario_config_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_CONFIGURACION" ADD CONSTRAINT uq_pecuario_config_org UNIQUE ("ID_Organizacion");
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 3. PECUARIO_JAULAS (tabla nueva — no existía en producción, ver nota de
-- verificación al inicio del archivo)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_JAULAS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text;
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS galpon_id UUID;
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS codigo_poza VARCHAR(50);
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS tipo_uso tipo_uso_poza DEFAULT 'empadre';
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS capacidad_max INT DEFAULT 10;
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS n_hembras_activas INT DEFAULT 7;
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS macho_codigo VARCHAR(50);
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS linea_genetica VARCHAR(50) DEFAULT 'Comercial';
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'activo';
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_JAULAS" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_JAULAS"
        ADD CONSTRAINT fk_pecuario_jaulas_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- FK a PECUARIO_GALPONES: solo si su PK real es "id" uuid (no confirmado desde esta sesión).
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'PECUARIO_GALPONES'
          AND column_name = 'id' AND data_type = 'uuid'
    ) THEN
        BEGIN
            ALTER TABLE public."PECUARIO_JAULAS"
                ADD CONSTRAINT fk_pecuario_jaulas_galpon FOREIGN KEY (galpon_id)
                REFERENCES public."PECUARIO_GALPONES"(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN null; END;
    ELSE
        RAISE NOTICE 'VERIFICAR MANUAL: no se pudo confirmar PECUARIO_GALPONES.id como uuid — FK galpon_id NO se creó, columna quedó sin restricción.';
    END IF;
END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_JAULAS" ADD CONSTRAINT uq_poza_org_codigo UNIQUE ("ID_Organizacion", codigo_poza);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 4. PECUARIO_PARTOS (tabla nueva)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_PARTOS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS poza_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS fecha_parto DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS n_vivos INT NOT NULL DEFAULT 0;
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS n_muertos INT NOT NULL DEFAULT 0;
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS peso_total_camada_g INT;
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS macho_activo_codigo VARCHAR(50);
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS madre_id UUID; -- reservado, sin FK: futura genealogía individual
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_PARTOS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public."PECUARIO_PARTOS".madre_id IS
    'Reservado para genealogía individual futura. NO es FK todavía (no existe tabla ANIMALES) — no asumir integridad referencial.';

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_PARTOS" ADD CONSTRAINT chk_partos_vivos CHECK (n_vivos >= 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_PARTOS" ADD CONSTRAINT chk_partos_muertos CHECK (n_muertos >= 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_PARTOS"
        ADD CONSTRAINT fk_pecuario_partos_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'PECUARIO_JAULAS'
          AND column_name = 'id' AND data_type = 'uuid'
    ) THEN
        BEGIN
            ALTER TABLE public."PECUARIO_PARTOS"
                ADD CONSTRAINT fk_pecuario_partos_poza FOREIGN KEY (poza_id)
                REFERENCES public."PECUARIO_JAULAS"(id) ON DELETE RESTRICT;
        EXCEPTION WHEN duplicate_object THEN null; END;
    ELSE
        RAISE NOTICE 'VERIFICAR MANUAL: FK PECUARIO_PARTOS.poza_id -> PECUARIO_JAULAS(id) NO se creó.';
    END IF;
END $$;

-- =====================================================================
-- 5. PECUARIO_LOTES (tabla nueva — no existía en producción, ver nota de
-- verificación al inicio del archivo). Incluye parto_origen_id (mejora
-- sobre el diseño original) para poder trazar un lote hasta la camada que
-- lo originó.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_LOTES" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text;
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS codigo_lote VARCHAR(50);
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS poza_actual_id UUID;
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS poza_origen_id UUID;
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS parto_origen_id UUID;
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS fecha_destete DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS cantidad_inicial INT;
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS cantidad_actual INT;
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS sexo VARCHAR(10) DEFAULT 'mixto';
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS etapa etapa_productiva DEFAULT 'recria';
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'activo';
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_LOTES" ADD CONSTRAINT chk_lotes_cant_inicial CHECK (cantidad_inicial > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_LOTES" ADD CONSTRAINT chk_lotes_cant_actual CHECK (cantidad_actual >= 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_LOTES"
        ADD CONSTRAINT fk_pecuario_lotes_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_LOTES"
        ADD CONSTRAINT fk_pecuario_lotes_parto_origen FOREIGN KEY (parto_origen_id)
        REFERENCES public."PECUARIO_PARTOS"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'PECUARIO_JAULAS'
          AND column_name = 'id' AND data_type = 'uuid'
    ) THEN
        BEGIN
            ALTER TABLE public."PECUARIO_LOTES"
                ADD CONSTRAINT fk_pecuario_lotes_poza_actual FOREIGN KEY (poza_actual_id)
                REFERENCES public."PECUARIO_JAULAS"(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN null; END;
        BEGIN
            ALTER TABLE public."PECUARIO_LOTES"
                ADD CONSTRAINT fk_pecuario_lotes_poza_origen FOREIGN KEY (poza_origen_id)
                REFERENCES public."PECUARIO_JAULAS"(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN null; END;
    ELSE
        RAISE NOTICE 'VERIFICAR MANUAL: FKs PECUARIO_LOTES.poza_actual_id/poza_origen_id -> PECUARIO_JAULAS(id) NO se crearon.';
    END IF;
END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_LOTES" ADD CONSTRAINT uq_lote_org_codigo UNIQUE ("ID_Organizacion", codigo_lote);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 6. PECUARIO_PESAJES (tabla nueva — monitoreo de crecimiento/GPD)
-- VERIFICADO (2026-09-10): PECUARIO_PESAJE_ALIMENTACION tampoco existe en
-- producción — la pregunta de "¿fusionar con la existente?" quedó resuelta
-- sola (no hay nada con qué fusionar). Se mantiene como tabla separada,
-- nombre propio, sin relación con ninguna otra.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_PESAJES" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS lote_id UUID;
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS poza_id UUID;
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS fecha_pesaje DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS animales_muestreados INT NOT NULL;
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS peso_total_muestra_g NUMERIC(10,2) NOT NULL;
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS peso_promedio_g NUMERIC(8,2)
    GENERATED ALWAYS AS (peso_total_muestra_g / NULLIF(animales_muestreados, 0)) STORED;
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS ganancia_diaria_estimada_g NUMERIC(6,2);
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_PESAJES" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_PESAJES" ADD CONSTRAINT chk_pesajes_muestreados CHECK (animales_muestreados > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_PESAJES" ADD CONSTRAINT chk_pesajes_peso CHECK (peso_total_muestra_g > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_PESAJES"
        ADD CONSTRAINT fk_pecuario_pesajes_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_PESAJES"
        ADD CONSTRAINT fk_pecuario_pesajes_lote FOREIGN KEY (lote_id)
        REFERENCES public."PECUARIO_LOTES"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 7. PECUARIO_MORTALIDAD (tabla nueva)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_MORTALIDAD" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS poza_id UUID;
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS lote_id UUID;
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS animal_id UUID; -- reservado, sin FK
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS fecha_evento DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS cantidad INT NOT NULL DEFAULT 1;
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS etapa etapa_productiva NOT NULL;
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS causa causa_mortalidad DEFAULT 'desconocido';
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS descripcion_sintomas TEXT;
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_MORTALIDAD" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public."PECUARIO_MORTALIDAD".animal_id IS
    'Reservado para genealogía individual futura. NO es FK todavía.';

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_MORTALIDAD" ADD CONSTRAINT chk_mortalidad_cantidad CHECK (cantidad > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_MORTALIDAD"
        ADD CONSTRAINT fk_pecuario_mortalidad_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_MORTALIDAD"
        ADD CONSTRAINT fk_pecuario_mortalidad_lote FOREIGN KEY (lote_id)
        REFERENCES public."PECUARIO_LOTES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 8. PECUARIO_VENTAS (tabla nueva)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_VENTAS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS lote_id UUID;
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS poza_id UUID;
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS fecha_venta DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS tipo_salida tipo_venta_cuy DEFAULT 'carne';
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS cantidad INT NOT NULL;
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS peso_total_kg NUMERIC(8,2);
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS precio_total NUMERIC(10,2) NOT NULL;
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS comprador_nombre VARCHAR(150);
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_VENTAS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public."PECUARIO_VENTAS".comprador_nombre IS
    'PII de un tercero (comprador) — nunca en console.log/print, nunca expuesto en /trace público.';

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS" ADD CONSTRAINT chk_ventas_cantidad CHECK (cantidad > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS" ADD CONSTRAINT chk_ventas_precio CHECK (precio_total >= 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS"
        ADD CONSTRAINT fk_pecuario_ventas_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_VENTAS"
        ADD CONSTRAINT fk_pecuario_ventas_lote FOREIGN KEY (lote_id)
        REFERENCES public."PECUARIO_LOTES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================================
-- 9. ÍNDICES DE RENDIMIENTO
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_pecuario_jaulas_org ON public."PECUARIO_JAULAS" ("ID_Organizacion");
CREATE INDEX IF NOT EXISTS idx_pecuario_partos_org_poza ON public."PECUARIO_PARTOS" ("ID_Organizacion", poza_id);
CREATE INDEX IF NOT EXISTS idx_pecuario_lotes_org_estado ON public."PECUARIO_LOTES" ("ID_Organizacion", estado);
CREATE INDEX IF NOT EXISTS idx_pecuario_lotes_parto_origen ON public."PECUARIO_LOTES" (parto_origen_id);
CREATE INDEX IF NOT EXISTS idx_pecuario_pesajes_org_lote ON public."PECUARIO_PESAJES" ("ID_Organizacion", lote_id);
CREATE INDEX IF NOT EXISTS idx_pecuario_mortalidad_org ON public."PECUARIO_MORTALIDAD" ("ID_Organizacion");
CREATE INDEX IF NOT EXISTS idx_pecuario_ventas_org ON public."PECUARIO_VENTAS" ("ID_Organizacion");

-- =====================================================================
-- 10. RLS — habilitación + políticas reales (a diferencia del diseño
-- original, que solo habilitaba RLS sin ninguna política). Este módulo sí
-- usa usuarios internos autenticados (tabla Sección 6 del orquestador), así
-- que estas políticas son la defensa real, no solo higiene.
-- =====================================================================
ALTER TABLE public."PECUARIO_CONFIGURACION" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_JAULAS"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_PARTOS"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_LOTES"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_PESAJES"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_MORTALIDAD"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_VENTAS"        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_configuracion" ON public."PECUARIO_CONFIGURACION";
CREATE POLICY "rls_all_pecuario_configuracion" ON public."PECUARIO_CONFIGURACION"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_jaulas" ON public."PECUARIO_JAULAS";
CREATE POLICY "rls_all_pecuario_jaulas" ON public."PECUARIO_JAULAS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_partos" ON public."PECUARIO_PARTOS";
CREATE POLICY "rls_all_pecuario_partos" ON public."PECUARIO_PARTOS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_lotes" ON public."PECUARIO_LOTES";
CREATE POLICY "rls_all_pecuario_lotes" ON public."PECUARIO_LOTES"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_pesajes" ON public."PECUARIO_PESAJES";
CREATE POLICY "rls_all_pecuario_pesajes" ON public."PECUARIO_PESAJES"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_mortalidad" ON public."PECUARIO_MORTALIDAD";
CREATE POLICY "rls_all_pecuario_mortalidad" ON public."PECUARIO_MORTALIDAD"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_ventas" ON public."PECUARIO_VENTAS";
CREATE POLICY "rls_all_pecuario_ventas" ON public."PECUARIO_VENTAS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

-- =====================================================================
-- 11. TRIGGER: crea tarea de destete al registrar un parto.
-- SECURITY DEFINER + search_path fijo (mismo patrón que auth_org_id()/
-- get_my_org_id() ya usado en el repo) para que la escritura en TAREAS no
-- dependa de que el usuario interno tenga permiso directo sobre TAREAS.
-- Verifica que TAREAS exista antes de escribir — si no existe todavía,
-- el trigger no rompe el INSERT del parto, solo emite un warning.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_crear_tarea_destete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    dias_destete INT := 14;
    codigo_poza_val VARCHAR(50);
BEGIN
    IF to_regclass('public."TAREAS"') IS NULL THEN
        RAISE WARNING 'PECUARIO_PARTOS: tabla TAREAS no existe todavía — no se creó tarea de destete para el parto %', NEW.id;
        RETURN NEW;
    END IF;

    SELECT COALESCE(dias_lactancia_destete, 14) INTO dias_destete
    FROM public."PECUARIO_CONFIGURACION"
    WHERE "ID_Organizacion" = NEW."ID_Organizacion";

    SELECT codigo_poza INTO codigo_poza_val
    FROM public."PECUARIO_JAULAS"
    WHERE id = NEW.poza_id;

    -- Columnas de TAREAS asumidas del diseño original, NO confirmadas contra
    -- el esquema real desde esta sesión (ver spec, "Verificación pendiente").
    -- Si el INSERT falla por columna inexistente, ajustar aquí tras verificar.
    INSERT INTO public."TAREAS" (
        id, "ID_Organizacion", descripcion, fecha_limite, prioridad, estado, device_id, created_at
    ) VALUES (
        gen_random_uuid(),
        NEW."ID_Organizacion",
        CONCAT('Destete programado: Poza ', COALESCE(codigo_poza_val, NEW.poza_id::text), ' (', NEW.n_vivos, ' gazapos nacidos)'),
        NEW.fecha_parto + COALESCE(dias_destete, 14),
        'alta',
        'pendiente',
        NEW.device_id,
        now()
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generar_destete_parto ON public."PECUARIO_PARTOS";
CREATE TRIGGER trg_generar_destete_parto
AFTER INSERT ON public."PECUARIO_PARTOS"
FOR EACH ROW EXECUTE FUNCTION public.fn_crear_tarea_destete();

COMMIT;
