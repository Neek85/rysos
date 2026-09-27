-- =====================================================================
-- Pecuario Cuyes — Reglas configurables de reemplazo/descarte (ítem 8)
-- Spec: specs/pecuario_reglas_reemplazo_reproductoras.md
--
-- Decisiones confirmadas por Neyser (2026-09-20, spec §2) y (2026-09-27,
-- resolución de §4 de la spec, ver más abajo):
-- 1. Modo de acción: sugerencia, nunca automático. Ningún trigger de esta
--    migración cambia PECUARIO_REPRODUCTORES.proposito por sí solo — solo
--    reacciona a la acción explícita "Confirmar descarte" (ver punto 6).
-- 2. Camada chica: CUALQUIERA de los dos primeros partos, no ambos.
-- 3. Solo cuenta nacidas vivas (n_vivos), nunca n_muertos (mortinatos).
-- 4. Alcance: solo cuando madre_id está identificado (identificación
--    individual activa) — igual que fn_son_parientes() (v3, 2026-09-11).
-- 5. §4 de la spec resuelta: PECUARIO_CONFIGURACION.min_promedio_crias_vivas
--    se renombra — el nombre sugería un promedio, pero la regla real es un
--    umbral por-parto individual. Nada en el código la consumía todavía
--    (confirmado por grep en todo el repo antes de escribir esta
--    migración), así que el rename es seguro.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. Rename de columna (resolución de la spec §4, decisión de Neyser
--    2026-09-27) — idempotente.
-- =====================================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'PECUARIO_CONFIGURACION'
          AND column_name = 'min_promedio_crias_vivas'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'PECUARIO_CONFIGURACION'
          AND column_name = 'min_crias_vivas_parto_temprano'
    ) THEN
        ALTER TABLE public."PECUARIO_CONFIGURACION"
            RENAME COLUMN min_promedio_crias_vivas TO min_crias_vivas_parto_temprano;
    END IF;
END $$;

COMMENT ON COLUMN public."PECUARIO_CONFIGURACION".min_crias_vivas_parto_temprano IS
    'Umbral mínimo de crías NACIDAS VIVAS en el 1er O 2do parto (valor individual, no promedio) para disparar sugerencia de reemplazo. Renombrada desde min_promedio_crias_vivas (v1, 2026-09-10) el 2026-09-27 — el nombre original sugería un promedio entre partos; la regla confirmada por Neyser (2026-09-20, specs/pecuario_reglas_reemplazo_reproductoras.md §2.2) es sobre el valor de cualquiera de los dos primeros partos por separado.';

-- =====================================================================
-- 2. Enums nuevos (idempotente).
-- =====================================================================
DO $$ BEGIN
    CREATE TYPE motivo_sugerencia_reemplazo AS ENUM ('max_partos_alcanzado', 'camada_chica_parto_temprano');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE estado_sugerencia_reemplazo AS ENUM ('pendiente', 'confirmada', 'ignorada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- 3. PECUARIO_SUGERENCIAS_REEMPLAZO (tabla nueva) — persiste las
--    sugerencias en vez de recalcular todo en cada carga de pantalla
--    (spec §5), con estado pendiente/confirmada/ignorada por reproductora
--    y auditoría de cuándo se decidió.
--
--    Nota de diseño (divergencia menor respecto al mockup, documentada,
--    igual criterio que Empadre/Traslado): el mockup evalúa un solo
--    motivo por reproductora (`evaluarSugerenciaDescarte()` corta en el
--    primero que aplica). Acá cada motivo es independiente — UNIQUE
--    (reproductor_id, motivo) — así que una misma reproductora puede
--    tener sugerencias simultáneas por motivos distintos (ej. alcanzó el
--    máximo de partos Y tuvo una camada chica en su 2do parto). Es un
--    superconjunto estrictamente más informativo para el técnico; no
--    contradice ninguna decisión de negocio de la spec, que nunca discute
--    el caso de dos motivos a la vez.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."PECUARIO_SUGERENCIAS_REEMPLAZO" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO" ADD COLUMN IF NOT EXISTS reproductor_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO" ADD COLUMN IF NOT EXISTS parto_id UUID; -- el parto que disparó la sugerencia (auditoría; nullable por si algún día se evalúa en lote)
ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO" ADD COLUMN IF NOT EXISTS motivo motivo_sugerencia_reemplazo NOT NULL;
ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO" ADD COLUMN IF NOT EXISTS detalle TEXT NOT NULL;
ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO" ADD COLUMN IF NOT EXISTS estado estado_sugerencia_reemplazo NOT NULL DEFAULT 'pendiente';
ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO" ADD COLUMN IF NOT EXISTS creada_en TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO" ADD COLUMN IF NOT EXISTS resuelta_en TIMESTAMPTZ;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO"
        ADD CONSTRAINT fk_sugerencia_reemplazo_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO"
        ADD CONSTRAINT fk_sugerencia_reemplazo_reproductor FOREIGN KEY (reproductor_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO"
        ADD CONSTRAINT fk_sugerencia_reemplazo_parto FOREIGN KEY (parto_id)
        REFERENCES public."PECUARIO_PARTOS"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO"
        ADD CONSTRAINT uq_sugerencia_reemplazo_reproductor_motivo UNIQUE (reproductor_id, motivo);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Lección de disciplina aplicada (roadmap, nota de proceso 2026-09-26,
-- punto 2 — "para cada CHECK nuevo, trazar explícitamente qué
-- INSERT/UPDATE real lo satisface"): resuelta_en se calcula SIEMPRE por
-- el trigger de la sección 5, nunca se le pide al cliente — mismo criterio
-- que cantidad_incluida (Destete), origen_jaula_id (Traslado) y
-- resuelta_en de PECUARIO_RETIROS_MACHO_PENDIENTES (Empadre, hotfix #2).
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO"
        ADD CONSTRAINT chk_sugerencia_reemplazo_resuelta_coherente
        CHECK (
            (estado = 'pendiente' AND resuelta_en IS NULL)
            OR (estado IN ('confirmada', 'ignorada') AND resuelta_en IS NOT NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_sugerencia_reemplazo_org ON public."PECUARIO_SUGERENCIAS_REEMPLAZO" ("ID_Organizacion");
CREATE INDEX IF NOT EXISTS idx_sugerencia_reemplazo_reproductor ON public."PECUARIO_SUGERENCIAS_REEMPLAZO" (reproductor_id);
CREATE INDEX IF NOT EXISTS idx_sugerencia_reemplazo_estado ON public."PECUARIO_SUGERENCIAS_REEMPLAZO" (estado) WHERE estado = 'pendiente';

-- =====================================================================
-- 4. FK PECUARIO_PARTOS.madre_id -> PECUARIO_REPRODUCTORES(id) — hoy
--    "reservado, sin FK" (comentario de la migración v1, 2026-09-10).
--    Prerequisito de la spec §5. Guardado (no bloqueante) igual que el
--    patrón ya usado en v1 para PECUARIO_PARTOS.poza_id (línea ~151 de
--    20260910160000): si hay datos huérfanos (madre_id que no existe en
--    PECUARIO_REPRODUCTORES), NO se rompe la migración — se deja
--    constancia con RAISE NOTICE para revisión manual, en vez de fallar
--    en medio de una migración que trae más cosas nuevas.
-- =====================================================================
DO $$ BEGIN
    BEGIN
        ALTER TABLE public."PECUARIO_PARTOS"
            ADD CONSTRAINT fk_pecuario_partos_madre FOREIGN KEY (madre_id)
            REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE SET NULL;
    EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN foreign_key_violation OR invalid_foreign_key THEN
            RAISE NOTICE 'VERIFICAR MANUAL: FK PECUARIO_PARTOS.madre_id -> PECUARIO_REPRODUCTORES(id) NO se creó — hay madre_id huérfanos. Correr: SELECT id, madre_id FROM "PECUARIO_PARTOS" WHERE madre_id IS NOT NULL AND madre_id NOT IN (SELECT id FROM "PECUARIO_REPRODUCTORES");';
    END;
END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_partos_madre ON public."PECUARIO_PARTOS" (madre_id) WHERE madre_id IS NOT NULL;

-- Validación multi-tenant + sexo del madre_id, mismo criterio que
-- trg_historial_macho_validar (Empadre): un dato cruzado de organización
-- o de sexo nunca debe poder guardarse, sin importar qué mande el cliente.
CREATE OR REPLACE FUNCTION public.trg_partos_validar_madre()
RETURNS TRIGGER AS $$
DECLARE
    v_org_madre text;
    v_sexo_madre sexo_cuy;
BEGIN
    IF NEW.madre_id IS NOT NULL THEN
        SELECT "ID_Organizacion", sexo INTO v_org_madre, v_sexo_madre
        FROM public."PECUARIO_REPRODUCTORES" WHERE id = NEW.madre_id;

        IF v_org_madre IS NULL THEN
            RAISE EXCEPTION 'madre_id % no existe en PECUARIO_REPRODUCTORES', NEW.madre_id;
        END IF;
        IF v_org_madre <> NEW."ID_Organizacion" THEN
            RAISE EXCEPTION 'madre_id % pertenece a otra organización', NEW.madre_id;
        END IF;
        IF v_sexo_madre <> 'hembra' THEN
            RAISE EXCEPTION 'madre_id % no es hembra (sexo=%)', NEW.madre_id, v_sexo_madre;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_partos_validar_madre ON public."PECUARIO_PARTOS";
CREATE TRIGGER trg_partos_validar_madre
    BEFORE INSERT OR UPDATE ON public."PECUARIO_PARTOS"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_partos_validar_madre();

-- =====================================================================
-- 5. resuelta_en calculado por trigger, nunca por el cliente.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trg_sugerencia_reemplazo_resuelta_en()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.estado IN ('confirmada', 'ignorada') AND OLD.estado = 'pendiente' THEN
        NEW.resuelta_en := now();
    ELSIF NEW.estado = 'pendiente' AND OLD.estado IN ('confirmada', 'ignorada') THEN
        NEW.resuelta_en := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sugerencia_reemplazo_resuelta_en ON public."PECUARIO_SUGERENCIAS_REEMPLAZO";
CREATE TRIGGER trg_sugerencia_reemplazo_resuelta_en
    BEFORE UPDATE ON public."PECUARIO_SUGERENCIAS_REEMPLAZO"
    FOR EACH ROW
    WHEN (NEW.estado IS DISTINCT FROM OLD.estado)
    EXECUTE FUNCTION public.trg_sugerencia_reemplazo_resuelta_en();

-- =====================================================================
-- 6. "Confirmar descarte" — único disparador permitido de
--    PECUARIO_REPRODUCTORES.proposito='descarte' por esta funcionalidad
--    (spec §5: "solo disparado por la acción explícita... nunca por un
--    trigger automático sobre PECUARIO_PARTOS"). Este trigger reacciona
--    a la propia acción explícita del técnico/admin (el UPDATE a
--    estado='confirmada'), no a ningún evento de PECUARIO_PARTOS — es
--    la contraparte por el lado de "efectos" del mismo patrón ya usado
--    en trg_historial_macho_efectos (Empadre).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trg_sugerencia_reemplazo_confirmar_descarte()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.estado = 'confirmada' AND OLD.estado <> 'confirmada' THEN
        UPDATE public."PECUARIO_REPRODUCTORES"
            SET proposito = 'descarte'
            WHERE id = NEW.reproductor_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sugerencia_reemplazo_confirmar_descarte ON public."PECUARIO_SUGERENCIAS_REEMPLAZO";
CREATE TRIGGER trg_sugerencia_reemplazo_confirmar_descarte
    AFTER UPDATE ON public."PECUARIO_SUGERENCIAS_REEMPLAZO"
    FOR EACH ROW
    WHEN (NEW.estado = 'confirmada' AND OLD.estado IS DISTINCT FROM NEW.estado)
    EXECUTE FUNCTION public.trg_sugerencia_reemplazo_confirmar_descarte();

-- =====================================================================
-- 7. Motor de reglas — reevalúa cada vez que se registra un parto de una
--    reproductora identificada (spec §3.4). Solo corre cuando
--    NEW.madre_id IS NOT NULL, lo que ya implica identificación
--    individual activa (spec §2.4) sin necesidad de volver a leer
--    Config — evita repetir el bug de tipo de columna del ítem 7
--    (Config es text, no jsonb; esta migración no lo toca en absoluto).
--    ON CONFLICT DO NOTHING implementa "una sugerencia ignorada/confirmada
--    nunca reaparece" (spec §5) — el registro de la primera detección
--    queda inmutable, coherente con Auditoría Inmutable de RYZOS.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trg_partos_evaluar_sugerencia_reemplazo()
RETURNS TRIGGER AS $$
DECLARE
    v_max_partos INT;
    v_min_crias INT;
    v_total_partos INT;
    v_primeros RECORD;
BEGIN
    IF NEW.madre_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT max_partos_madre, min_crias_vivas_parto_temprano
      INTO v_max_partos, v_min_crias
      FROM public."PECUARIO_CONFIGURACION"
      WHERE "ID_Organizacion" = NEW."ID_Organizacion";

    IF v_max_partos IS NULL THEN
        v_max_partos := 4; -- default de columna, por si la org no tiene fila propia todavía
    END IF;
    IF v_min_crias IS NULL THEN
        v_min_crias := 2;
    END IF;

    -- Regla 1: máximo de partos alcanzado (spec §3.2.1)
    SELECT count(*) INTO v_total_partos
      FROM public."PECUARIO_PARTOS" WHERE madre_id = NEW.madre_id;

    IF v_total_partos >= v_max_partos THEN
        INSERT INTO public."PECUARIO_SUGERENCIAS_REEMPLAZO"
            ("ID_Organizacion", reproductor_id, parto_id, motivo, detalle)
        VALUES (
            NEW."ID_Organizacion", NEW.madre_id, NEW.id, 'max_partos_alcanzado',
            format('%s partos registrados — alcanzó el máximo configurado (%s)', v_total_partos, v_max_partos)
        )
        ON CONFLICT (reproductor_id, motivo) DO NOTHING;
    END IF;

    -- Regla 2: camada chica en el 1er O 2do parto (spec §3.2.2, §2.2/§2.3
    -- — cualquiera de los dos, solo nacidas vivas)
    FOR v_primeros IN
        SELECT n_vivos, row_number() OVER (ORDER BY fecha_parto, created_at) AS num_parto
        FROM public."PECUARIO_PARTOS"
        WHERE madre_id = NEW.madre_id
        ORDER BY fecha_parto, created_at
        LIMIT 2
    LOOP
        IF v_primeros.n_vivos < v_min_crias THEN
            INSERT INTO public."PECUARIO_SUGERENCIAS_REEMPLAZO"
                ("ID_Organizacion", reproductor_id, parto_id, motivo, detalle)
            VALUES (
                NEW."ID_Organizacion", NEW.madre_id, NEW.id, 'camada_chica_parto_temprano',
                format('%s cría(s) viva(s) en su parto #%s — menos que el mínimo configurado (%s)', v_primeros.n_vivos, v_primeros.num_parto, v_min_crias)
            )
            ON CONFLICT (reproductor_id, motivo) DO NOTHING;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_partos_evaluar_sugerencia_reemplazo ON public."PECUARIO_PARTOS";
CREATE TRIGGER trg_partos_evaluar_sugerencia_reemplazo
    AFTER INSERT ON public."PECUARIO_PARTOS"
    FOR EACH ROW
    WHEN (NEW.madre_id IS NOT NULL)
    EXECUTE FUNCTION public.trg_partos_evaluar_sugerencia_reemplazo();

-- =====================================================================
-- 8. Vista para "Alertas" en Inicio y ficha del reproductor — mismo
--    patrón de seguridad que el resto (view con privilegios de dueño,
--    filtro de org escrito a mano).
-- =====================================================================
CREATE OR REPLACE VIEW public.vw_pecuario_sugerencias_reemplazo AS
SELECT
    s.id,
    s."ID_Organizacion",
    s.reproductor_id,
    r.codigo_arete,
    r.jaula_actual_id,
    s.parto_id,
    s.motivo,
    s.detalle,
    s.estado,
    s.creada_en,
    s.resuelta_en
FROM public."PECUARIO_SUGERENCIAS_REEMPLAZO" s
JOIN public."PECUARIO_REPRODUCTORES" r ON r.id = s.reproductor_id
WHERE (s."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

GRANT SELECT ON public.vw_pecuario_sugerencias_reemplazo TO authenticated;

-- =====================================================================
-- 9. RLS — habilitación + política, mismo patrón de siempre.
-- =====================================================================
ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_sugerencias_reemplazo" ON public."PECUARIO_SUGERENCIAS_REEMPLAZO";
CREATE POLICY "rls_all_pecuario_sugerencias_reemplazo" ON public."PECUARIO_SUGERENCIAS_REEMPLAZO"
FOR ALL
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMIT;
