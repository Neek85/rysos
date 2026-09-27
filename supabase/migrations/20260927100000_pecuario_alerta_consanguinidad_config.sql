-- =====================================================================
-- RYZOS MODULE: VERTICAL PECUARIA — ALERTA DE CONSANGUINIDAD EN EMPADRE
-- Item 9 del roadmap Pecuario (mockup -> backend). Ver
-- specs/pecuario_alerta_consanguinidad_empadre.md §10 para el diseño
-- completo y las decisiones de arquitectura de esta migración.
--
-- No crea lógica de consanguinidad nueva: fn_son_parientes() ya existe en
-- producción desde 20260911140000_pecuario_identificacion_individual.sql
-- (v3, sección 7) — este ítem la conecta a la UI real de Empadre/Alta y
-- agrega lo que faltaba: configuración por organización, el chequeo de
-- "jaula ya ocupada" (spec §9, sin función equivalente hoy), y el campo
-- de auditoría para la confirmación explícita del técnico.
--
-- Se mantiene, por diseño (mismo criterio ya documentado en el comentario
-- de fn_son_parientes()): ADVERTENCIA en la app, NUNCA bloqueo duro de
-- base de datos — ningún CHECK/trigger de esta migración impide un
-- INSERT/UPDATE por consanguinidad o por jaula ocupada. La doble
-- validación (si algún día se construye la app real) vive fuera de este
-- repo, no en SQL.
--
-- Perfil de riesgo bajo: solo ADD COLUMN IF NOT EXISTS (todas con
-- default, ninguna NOT NULL sin default) y una función nueva. Sin rename,
-- sin CHECK nuevo, sin FK nueva, sin trigger nuevo.
-- =====================================================================

BEGIN;

-- 0. PREFLIGHT: exige que las tablas involucradas ya existan.
DO $$ BEGIN
    IF to_regclass('public."PECUARIO_REPRODUCTORES"') IS NULL THEN
        RAISE EXCEPTION 'PECUARIO_REPRODUCTORES no existe. Aplicar primero v3 (20260911140000) antes de esta migración.';
    END IF;
    IF to_regclass('public."PECUARIO_CONFIGURACION"') IS NULL THEN
        RAISE EXCEPTION 'PECUARIO_CONFIGURACION no existe. Aplicar primero v1 (20260910160000) antes de esta migración.';
    END IF;
    IF to_regclass('public."PECUARIO_HISTORIAL_MACHOS"') IS NULL THEN
        RAISE EXCEPTION 'PECUARIO_HISTORIAL_MACHOS no existe. Aplicar primero v3 (20260911140000) antes de esta migración.';
    END IF;
END $$;

-- =====================================================================
-- 1. Configuración por organización — dos columnas nuevas, mismo patrón
-- que max_partos_madre/min_crias_vivas_parto_temprano (ítem 8). Default
-- true/3, igual al default de fn_son_parientes(generaciones INT DEFAULT
-- 3) — spec §3.
-- =====================================================================
ALTER TABLE public."PECUARIO_CONFIGURACION" ADD COLUMN IF NOT EXISTS alerta_consanguinidad_activa BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public."PECUARIO_CONFIGURACION" ADD COLUMN IF NOT EXISTS generaciones_consanguinidad INT NOT NULL DEFAULT 3;

COMMENT ON COLUMN public."PECUARIO_CONFIGURACION".alerta_consanguinidad_activa IS
    'Item 9 (2026-09-27): activa/desactiva la advertencia de consanguinidad al asignar un macho a una jaula (Empadre) o al dar de alta un reproductor ya en una jaula (Alta). Advertencia siempre no bloqueante — ver fn_son_parientes().';
COMMENT ON COLUMN public."PECUARIO_CONFIGURACION".generaciones_consanguinidad IS
    'Item 9 (2026-09-27): generaciones hacia atrás a revisar en fn_son_parientes(). Default 3, igual al default de la función.';

-- =====================================================================
-- 2. Auditoría de la confirmación del técnico — una sola columna genérica
-- (no una por motivo): el banner real (spec §9.1, Ronda 27) combina
-- consanguinidad + "jaula ya ocupada" en un único checkbox de
-- confirmación, así que un único booleano por registro alcanza y evita
-- inventar una distinción que la propia UI ya decidió no hacer.
-- =====================================================================
ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS advertencia_confirmada BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS advertencia_confirmada BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public."PECUARIO_HISTORIAL_MACHOS".advertencia_confirmada IS
    'Item 9 (2026-09-27): true si el técnico confirmó explícitamente el banner de advertencia (consanguinidad y/o jaula ya ocupada) al asignar este macho a esta jaula. false si no aplicó ninguna advertencia o si nunca se confirmó.';
COMMENT ON COLUMN public."PECUARIO_REPRODUCTORES".advertencia_confirmada IS
    'Item 9 (2026-09-27): mismo criterio que PECUARIO_HISTORIAL_MACHOS.advertencia_confirmada, aplicado al alta de un reproductor ya asignado a una jaula desde el momento de creación.';

-- =====================================================================
-- 3. fn_jaula_tiene_otro_macho_activo — chequeo de "jaula ya ocupada"
-- (spec §9, Ronda 27). No existía función equivalente.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_jaula_tiene_otro_macho_activo(p_jaula_id UUID, p_macho_id_excluir UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public."PECUARIO_REPRODUCTORES"
        WHERE jaula_actual_id = p_jaula_id
          AND sexo = 'macho'
          AND estado = 'activo'
          AND (p_macho_id_excluir IS NULL OR id <> p_macho_id_excluir)
    );
$$;

COMMENT ON FUNCTION public.fn_jaula_tiene_otro_macho_activo IS
    'Item 9 (2026-09-27): true si la jaula ya tiene un macho activo distinto del excluido. Mismo criterio no bloqueante que fn_son_parientes().';

COMMIT;
