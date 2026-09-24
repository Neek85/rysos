-- =====================================================================
-- RYZOS · Pecuario Cuyes · Empadre: "Asignar macho a jaula" real
-- (empadre continuo vs. controlado) + retiro pendiente persistente
-- Fecha: 2026-09-26
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (Sección 4.1.2): cubierta en el mismo
-- flujo, por haberse trabajado con Claude desde el principio.
--
-- Spec de referencia: specs/pecuario_sistema_empadre.md (decisiones
-- confirmadas por Neyser, 2026-09-13; roadmap de Pecuario, ítem 7 de
-- Nivel 3 -- ver claude/roadmap_pecuario_mockup_a_backend.md del
-- proyecto de Cowork).
--
-- HALLAZGO DE ESQUEMA #1, resuelto antes de escribir esta migración: la
-- propia spec (§4.1, "Para el backend") propone el nombre de config
-- `pecuario.identificacion_individual_activa` -- pero ese valor YA
-- EXISTE, aplicado desde 2026-09-11 (20260911140000_pecuario_
-- identificacion_individual.sql), bajo otro nombre:
-- Config->'pecuario'->>'identificacion_individual'. Esta migración NO
-- crea esa clave (ni ninguna otra en Config -- son valores, no columnas,
-- fuera de alcance de una migración de esquema, tal como ya aclaraba esa
-- misma migración de 2026-09-11). Se documenta acá para que la app/CLI
-- use el nombre real, no el propuesto en la spec, al leer el interruptor.
-- `pecuario.sistema_cria` ('continuo'|'controlado') sí es una clave
-- nueva (no existía) -- tampoco requiere columna, la lee el trigger de
-- abajo directo del JSON, con 'continuo' como default cuando la
-- organización todavía no la seteó (ninguna la tiene seteada hoy).
--
-- HALLAZGO DE ESQUEMA #2: `PECUARIO_JAULAS.macho_codigo` (texto libre,
-- v1, 20260910160000) es un mecanismo COMPLETAMENTE APARTE -- la forma
-- poblacional (sin identificación individual) de anotar a mano qué
-- macho está en una poza, sin historial ni FK. Esta migración no la
-- toca ni la sincroniza: el flujo real de Empadre que se construye acá
-- (`PECUARIO_HISTORIAL_MACHOS` + `PECUARIO_REPRODUCTORES.jaula_actual_id`)
-- solo aplica cuando el módulo de identificación individual está
-- activo (spec §4.1: el tile "Empadre" ni siquiera aparece si está
-- desactivado) -- son dos sistemas paralelos que nunca se mezclan, tal
-- como confirma el resto del esquema.
--
-- DECISIÓN DE ARQUITECTURA:
--   1. Nueva tabla `PECUARIO_RETIROS_MACHO_PENDIENTES` -- reemplaza
--      `RETIROS_MACHO_PENDIENTES` (estado en memoria del simulador,
--      spec §6.3/§6.4) por un registro real, visible en Alertas hasta
--      resolverse. Deliberadamente NO se fusiona con la futura tabla de
--      revisiones sanitarias post-parto
--      (`pecuario_reglas_reemplazo_reproductoras.md` §8.4) -- esa spec
--      deja la fusión explícitamente "no se decide ahora", igual que
--      esta (spec §6.4); se construye separada, con su propio origen
--      (dispara desde Empadre, no desde un catálogo configurable),
--      mismo criterio que ya se usó para separar Sanidad de Guano.
--   2. `PECUARIO_HISTORIAL_MACHOS` (v3, ya existe) sigue siendo la
--      fuente de verdad de "qué macho está en qué jaula, y desde
--      cuándo" -- no se le agrega ninguna columna. Dos triggers nuevos
--      encadenan el resto:
--      - `trg_historial_macho_validar` (BEFORE INSERT): aislamiento
--        multi-tenant (macho, jaula y el propio insert deben ser de la
--        misma organización), `macho_id` debe ser sexo='macho' (esta
--        tabla es literalmente "historial de machos"), y -- la regla de
--        negocio central de esta spec -- si
--        `Config->'pecuario'->>'sistema_cria' = 'controlado'` para esa
--        organización, `fecha_salida` es obligatoria en el insert (spec
--        §2.2: "Controlado: fecha_salida se exige en el momento de
--        asignar, no después"). Nunca se confía en que el cliente ya
--        validó esto en el formulario -- mismo criterio que el resto
--        del esquema.
--      - `trg_historial_macho_efectos` (AFTER INSERT): (a) cierra
--        cualquier asignación previa TODAVÍA ABIERTA de ese MISMO macho
--        en otra jaula (`fecha_salida = NEW.fecha_entrada`) -- el
--        trigger ya existente `trg_cerrar_historial_macho_anterior`
--        (v3) solo cierra la asignación anterior de la MISMA jaula (otro
--        macho que la ocupaba antes), nunca la del macho que se está
--        moviendo -- así que sin este agregado, un macho reasignado de
--        una jaula a otra dejaba su entrada vieja abierta para siempre.
--        (b) sincroniza `PECUARIO_REPRODUCTORES.jaula_actual_id =
--        NEW.jaula_id` -- nunca se toca `PECUARIO_REPRODUCTORES.
--        fecha_salida` acá, esa columna significa "el animal salió de
--        la granja" (mortalidad/venta), no tiene relación con un cambio
--        de jaula. (c) si `NEW.fecha_salida IS NOT NULL` (venga de modo
--        controlado, o de un técnico en modo continuo que igual quiso
--        anotar una fecha planificada -- ver nota de diseño más abajo),
--        crea la fila de `PECUARIO_RETIROS_MACHO_PENDIENTES` -- nunca
--        se le pide al cliente que inserte esa fila aparte.
--      - `trg_resolver_retiro_macho_pendiente` (AFTER UPDATE en
--        PECUARIO_RETIROS_MACHO_PENDIENTES, cuando `resuelta` pasa de
--        false a true -- "Marcar hecho" del simulador, spec §6.3):
--        busca la fila de PECUARIO_HISTORIAL_MACHOS referenciada; si
--        sigue con `fecha_salida IS NULL` (el macho no fue reasignado a
--        otra jaula mientras tanto -- lo habría cerrado (a) de arriba),
--        la cierra de verdad (`fecha_salida = CURRENT_DATE`) y limpia
--        `PECUARIO_REPRODUCTORES.jaula_actual_id` (solo si todavía
--        apunta a esa misma jaula, chequeo extra de seguridad). Si ya
--        estaba cerrada (reasignado antes de que alguien marcara
--        "hecho"), NO TOCA la jaula -- solo resuelve el pendiente --
--        replica el comportamiento exacto ya verificado en el
--        simulador (§6.3: "si el macho ya fue reasignado... no se toca
--        la jaula").
--
-- NOTA DE DISEÑO (divergencia menor, documentada, respecto al mockup):
-- el simulador crea el pendiente solo cuando el INTERRUPTOR global de
-- la organización es "controlado" (`guardarAsignacionMacho()`, spec
-- §6.3). Acá el trigger crea el pendiente cuando `fecha_salida IS NOT
-- NULL` en el insert, sin importar el modo -- que es un superconjunto
-- estrictamente más útil: en modo controlado fecha_salida siempre viene
-- (obligatoria por el trigger de validación), así que el resultado es
-- idéntico; en modo continuo, si un técnico igual decide anotar una
-- fecha de retiro planificada (dato opcional, sigue permitido, spec
-- §2.2), tiene sentido recordárselo también en vez de perder ese dato.
-- Si Neyser prefiere el criterio literal del mockup (pendiente SOLO en
-- modo controlado, ignorar fecha_salida opcional en modo continuo), es
-- un cambio de una condición en `trg_historial_macho_efectos`, avisar.
--
-- FUERA DE ALCANCE A PROPÓSITO:
--   - No se restringe `jaula_id` a `tipo_uso IN ('empadre','maternidad')`
--     a nivel de base -- la spec no lo pide como regla de negocio (el
--     filtro de ese tipo en el simulador era solo una ayuda de UI para
--     qué chips mostrar, corregido como bug de selector en spec §9 de
--     `pecuario_reglas_reemplazo_reproductoras.md`, no como validación).
--     Si se confirma que debe ser una regla dura, es un CHECK/trigger
--     aparte, no asumido acá.
--   - No se restringe que `macho_id` esté `estado='activo'` -- no
--     pedido explícitamente; posible mejora futura, señalada, no
--     construida.
--   - No se fusiona con la futura tabla de revisiones sanitarias post-
--     parto -- ver decisión de arquitectura punto 1.
--
-- Aditiva. Idempotente.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_REPRODUCTORES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_REPRODUCTORES (v3, 20260911140000...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_HISTORIAL_MACHOS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_HISTORIAL_MACHOS (v3, 20260911140000...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_JAULAS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_JAULAS (v1, 20260910160000...). Corré primero esa migración.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auth_org_id') THEN
    RAISE EXCEPTION 'Falta public.auth_org_id() (login real, Fase A). Prerrequisito de las políticas RLS/vistas de esta migración.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. PECUARIO_RETIROS_MACHO_PENDIENTES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PECUARIO_RETIROS_MACHO_PENDIENTES" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD COLUMN IF NOT EXISTS historial_macho_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD COLUMN IF NOT EXISTS macho_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD COLUMN IF NOT EXISTS jaula_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD COLUMN IF NOT EXISTS fecha_retiro_planificada DATE NOT NULL;
ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD COLUMN IF NOT EXISTS resuelta BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD COLUMN IF NOT EXISTS resuelta_en TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD COLUMN IF NOT EXISTS resuelta_device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public."PECUARIO_RETIROS_MACHO_PENDIENTES".fecha_retiro_planificada IS
  'Copiada de PECUARIO_HISTORIAL_MACHOS.fecha_salida al momento de crear el pendiente (trg_historial_macho_efectos) -- informativa, la fuente de verdad de si el macho sigue ahí de verdad sigue siendo PECUARIO_HISTORIAL_MACHOS.fecha_salida IS NULL.';

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES"
        ADD CONSTRAINT fk_retiros_macho_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES"
        ADD CONSTRAINT fk_retiros_macho_historial FOREIGN KEY (historial_macho_id)
        REFERENCES public."PECUARIO_HISTORIAL_MACHOS"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES"
        ADD CONSTRAINT fk_retiros_macho_macho FOREIGN KEY (macho_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES"
        ADD CONSTRAINT fk_retiros_macho_jaula FOREIGN KEY (jaula_id)
        REFERENCES public."PECUARIO_JAULAS"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD CONSTRAINT uq_retiros_macho_historial UNIQUE (historial_macho_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ADD CONSTRAINT chk_retiros_macho_resuelta_coherente CHECK (
        (NOT resuelta AND resuelta_en IS NULL) OR (resuelta AND resuelta_en IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_retiros_macho_org_pendientes ON public."PECUARIO_RETIROS_MACHO_PENDIENTES" ("ID_Organizacion") WHERE NOT resuelta;
CREATE INDEX IF NOT EXISTS idx_retiros_macho_macho ON public."PECUARIO_RETIROS_MACHO_PENDIENTES" (macho_id);

ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_retiros_macho_pendientes" ON public."PECUARIO_RETIROS_MACHO_PENDIENTES";
CREATE POLICY "rls_all_pecuario_retiros_macho_pendientes" ON public."PECUARIO_RETIROS_MACHO_PENDIENTES"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

-- ---------------------------------------------------------------------
-- 2. Triggers sobre PECUARIO_HISTORIAL_MACHOS (tabla ya existe, v3 --
--    no se le agrega ninguna columna, solo comportamiento nuevo)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_historial_macho_validar()
RETURNS TRIGGER AS $$
DECLARE
  v_org_macho TEXT;
  v_sexo_macho sexo_cuy;
  v_org_jaula TEXT;
  v_sistema_cria TEXT;
BEGIN
  SELECT "ID_Organizacion", sexo INTO v_org_macho, v_sexo_macho
    FROM public."PECUARIO_REPRODUCTORES" WHERE id = NEW.macho_id;
  IF v_org_macho IS DISTINCT FROM NEW."ID_Organizacion" THEN
    RAISE EXCEPTION 'macho_id no pertenece a la organización %.', NEW."ID_Organizacion";
  END IF;
  IF v_sexo_macho IS DISTINCT FROM 'macho' THEN
    RAISE EXCEPTION 'macho_id (%) no es un reproductor de sexo macho.', NEW.macho_id;
  END IF;

  SELECT "ID_Organizacion" INTO v_org_jaula FROM public."PECUARIO_JAULAS" WHERE id = NEW.jaula_id;
  IF v_org_jaula IS DISTINCT FROM NEW."ID_Organizacion" THEN
    RAISE EXCEPTION 'jaula_id no pertenece a la organización %.', NEW."ID_Organizacion";
  END IF;

  SELECT COALESCE("Config"->'pecuario'->>'sistema_cria', 'continuo') INTO v_sistema_cria
    FROM public."ORGANIZACIONES" WHERE "ID" = NEW."ID_Organizacion";
  IF v_sistema_cria = 'controlado' AND NEW.fecha_salida IS NULL THEN
    RAISE EXCEPTION 'La organización % usa empadre controlado: fecha_salida es obligatoria al asignar un macho.', NEW."ID_Organizacion";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historial_macho_validar ON public."PECUARIO_HISTORIAL_MACHOS";
CREATE TRIGGER trg_historial_macho_validar
  BEFORE INSERT ON public."PECUARIO_HISTORIAL_MACHOS"
  FOR EACH ROW EXECUTE FUNCTION public.trg_historial_macho_validar();

CREATE OR REPLACE FUNCTION public.trg_historial_macho_efectos()
RETURNS TRIGGER AS $$
BEGIN
  -- (a) cierra cualquier asignación previa todavía abierta de este MISMO
  -- macho en OTRA jaula -- trg_cerrar_historial_macho_anterior (v3) solo
  -- cubre "otro macho, misma jaula", no este caso.
  UPDATE public."PECUARIO_HISTORIAL_MACHOS"
    SET fecha_salida = NEW.fecha_entrada
    WHERE macho_id = NEW.macho_id
      AND fecha_salida IS NULL
      AND id <> NEW.id;

  -- (b) sincroniza la jaula actual del reproductor. Nunca se toca
  -- PECUARIO_REPRODUCTORES.fecha_salida acá -- esa columna es "el
  -- animal salió de la granja" (mortalidad/venta), no tiene relación
  -- con un cambio de jaula.
  UPDATE public."PECUARIO_REPRODUCTORES"
    SET jaula_actual_id = NEW.jaula_id
    WHERE id = NEW.macho_id;

  -- (c) si vino con fecha de retiro planificada, crea el pendiente real
  -- -- nunca se le pide al cliente que lo inserte aparte (ver nota de
  -- diseño en la cabecera sobre por qué no se condiciona al modo acá).
  IF NEW.fecha_salida IS NOT NULL THEN
    INSERT INTO public."PECUARIO_RETIROS_MACHO_PENDIENTES"
      ("ID_Organizacion", historial_macho_id, macho_id, jaula_id, fecha_retiro_planificada, device_id)
    VALUES
      (NEW."ID_Organizacion", NEW.id, NEW.macho_id, NEW.jaula_id, NEW.fecha_salida, NEW.device_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historial_macho_efectos ON public."PECUARIO_HISTORIAL_MACHOS";
CREATE TRIGGER trg_historial_macho_efectos
  AFTER INSERT ON public."PECUARIO_HISTORIAL_MACHOS"
  FOR EACH ROW EXECUTE FUNCTION public.trg_historial_macho_efectos();

-- ---------------------------------------------------------------------
-- 3. "Marcar hecho" -- resolver un retiro pendiente
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_resolver_retiro_macho_pendiente()
RETURNS TRIGGER AS $$
DECLARE
  v_fecha_salida_actual DATE;
BEGIN
  SELECT fecha_salida INTO v_fecha_salida_actual
    FROM public."PECUARIO_HISTORIAL_MACHOS" WHERE id = NEW.historial_macho_id;

  IF v_fecha_salida_actual IS NULL THEN
    -- El macho sigue de verdad en esa jaula (no fue reasignado antes de
    -- que alguien marcara "hecho") -- se retira de verdad ahora.
    UPDATE public."PECUARIO_HISTORIAL_MACHOS"
      SET fecha_salida = CURRENT_DATE
      WHERE id = NEW.historial_macho_id;

    UPDATE public."PECUARIO_REPRODUCTORES"
      SET jaula_actual_id = NULL
      WHERE id = NEW.macho_id AND jaula_actual_id = NEW.jaula_id;
  END IF;
  -- Si v_fecha_salida_actual ya no es NULL, el macho fue reasignado a
  -- otra jaula antes de resolver este pendiente -- no se toca nada de
  -- PECUARIO_HISTORIAL_MACHOS/PECUARIO_REPRODUCTORES, solo queda
  -- resuelto el pendiente (spec §6.3: "no se toca la jaula").

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resolver_retiro_macho_pendiente ON public."PECUARIO_RETIROS_MACHO_PENDIENTES";
CREATE TRIGGER trg_resolver_retiro_macho_pendiente
  AFTER UPDATE ON public."PECUARIO_RETIROS_MACHO_PENDIENTES"
  FOR EACH ROW
  WHEN (NOT OLD.resuelta AND NEW.resuelta)
  EXECUTE FUNCTION public.trg_resolver_retiro_macho_pendiente();

-- ---------------------------------------------------------------------
-- 4. vw_pecuario_retiros_macho_pendientes -- reemplaza
--    RETIROS_MACHO_PENDIENTES (estado en memoria del simulador)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_retiros_macho_pendientes AS
SELECT
    r.id,
    r."ID_Organizacion",
    r.macho_id,
    m.codigo_arete AS macho_codigo_arete,
    r.jaula_id,
    j.codigo_poza AS jaula_codigo_poza,
    r.fecha_retiro_planificada,
    r.resuelta,
    r.resuelta_en,
    CASE
        WHEN r.resuelta THEN 'resuelto'
        WHEN r.fecha_retiro_planificada <= CURRENT_DATE THEN 'vencido'
        ELSE 'programado'
    END AS estado
FROM public."PECUARIO_RETIROS_MACHO_PENDIENTES" r
JOIN public."PECUARIO_REPRODUCTORES" m ON m.id = r.macho_id
JOIN public."PECUARIO_JAULAS" j ON j.id = r.jaula_id
WHERE (r."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_retiros_macho_pendientes IS
'Reemplaza RETIROS_MACHO_PENDIENTES (estado en memoria del navegador del simulador, spec pecuario_sistema_empadre.md §6.3) -- "estado" calculado (vencido/programado/resuelto), nunca guardado. Alertas en Inicio filtra estado <> ''resuelto''; tono danger cuando estado=''vencido''.';

GRANT SELECT ON public.vw_pecuario_retiros_macho_pendientes TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT * FROM vw_pecuario_retiros_macho_pendientes WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
--
-- Caso de control -- con un macho y 2 jaulas reales de GRANJA-VALENCIA:
--   1. INSERT en PECUARIO_HISTORIAL_MACHOS (macho_id, jaula_id=J1,
--      fecha_salida=NULL) -- confirmar que PECUARIO_REPRODUCTORES.
--      jaula_actual_id del macho quedó en J1, y que NO se creó ninguna
--      fila en PECUARIO_RETIROS_MACHO_PENDIENTES (fecha_salida NULL).
--   2. INSERT en PECUARIO_HISTORIAL_MACHOS (mismo macho_id, jaula_id=J2,
--      fecha_salida=hoy+10) -- confirmar: (a) la fila del paso 1 quedó
--      con fecha_salida = hoy (cerrada por trg_historial_macho_efectos);
--      (b) PECUARIO_REPRODUCTORES.jaula_actual_id del macho ahora es J2;
--      (c) se creó una fila en PECUARIO_RETIROS_MACHO_PENDIENTES con
--      fecha_retiro_planificada = hoy+10, resuelta=false.
--   3. UPDATE esa fila de PECUARIO_RETIROS_MACHO_PENDIENTES SET
--      resuelta=true -- confirmar: (a) PECUARIO_HISTORIAL_MACHOS de J2
--      quedó con fecha_salida = hoy; (b) PECUARIO_REPRODUCTORES.
--      jaula_actual_id del macho quedó en NULL; (c) vw_pecuario_
--      retiros_macho_pendientes.estado = 'resuelto' para esa fila.
--   4. Debe fallar: INSERT en PECUARIO_HISTORIAL_MACHOS con macho_id de
--      una hembra (chk sexo).
--   5. Debe fallar: INSERT en PECUARIO_HISTORIAL_MACHOS con jaula_id de
--      otra organización.
--   6. Con la organización en modo 'controlado'
--      (UPDATE ORGANIZACIONES SET "Config" = jsonb_set(COALESCE("Config",
--      '{}'), '{pecuario,sistema_cria}', '"controlado"') WHERE "ID" =
--      'GRANJA-VALENCIA' -- revertir después del test), debe fallar un
--      INSERT en PECUARIO_HISTORIAL_MACHOS sin fecha_salida.
-- ---------------------------------------------------------------------
