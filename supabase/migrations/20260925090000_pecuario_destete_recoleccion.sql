-- =====================================================================
-- RYZOS · Pecuario Cuyes · Destete real: recolección semanal +
-- conformación de lotes por sexo (2 fases persistentes)
-- Fecha: 2026-09-25
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (Sección 4.1.2): cubierta en el mismo
-- flujo, por haberse trabajado con Claude desde el principio.
--
-- Spec de referencia: specs/pecuario_destete_recoleccion_semanal.md
-- (decisiones confirmadas por Neyser, 2026-09-13; roadmap de Pecuario,
-- ítem 6 de Nivel 2 -- ver claude/roadmap_pecuario_mockup_a_backend.md
-- del proyecto de Cowork).
--
-- PROBLEMA DE FONDO QUE RESUELVE (spec §9.4, dejado pendiente
-- explícitamente en el simulador): el flujo real tiene DOS fases
-- separadas en el tiempo -- recolección (Paso 1, sin sexar) y
-- conformación de lotes (Paso 2, repetible, sexado) -- y el simulador
-- solo podía guardar ese estado intermedio en memoria del navegador
-- (`poolDestete`/`lotesDesteteFormados`), perdiéndolo al cerrar la app o
-- cambiar de dispositivo. Esta migración lo vuelve un registro real.
--
-- HALLAZGO PROPIO (encontrado cruzando esta spec contra la migración de
-- Población, 20260924110000, ANTES de escribir esta) -- la vista
-- `vw_pecuario_lactancia_restante` de esa migración calculaba
-- "destetado" mirando `PECUARIO_LOTES.parto_origen_id` (un lote = un
-- solo parto de origen). Pero el flujo real de Destete AGRUPA varios
-- partos sin sexar antes de crear ningún lote (spec §1/§4: "no se sabe
-- qué gazapo vino de qué madre una vez mezclados") -- un lote real de
-- esta pantalla casi nunca tiene un único parto de origen, así que
-- `parto_origen_id` habría quedado NULL siempre y la lactancia real
-- NUNCA hubiera bajado en esa vista una vez construida esta pantalla.
-- Además, el corte real de "ya no está en lactancia" ocurre en la
-- RECOLECCIÓN (Paso 1 -- los gazapos salen físicamente de la poza de
-- maternidad ahí, spec §3.8 de la spec de Población: "los gazapos ya
-- salieron físicamente de lactancia, aunque todavía no estén separados
-- por sexo en lotes"), no en la conformación del lote (Paso 2, que puede
-- pasar días después). Por eso esta migración REEMPLAZA el cálculo de
-- `vw_pecuario_lactancia_restante` (CREATE OR REPLACE, mismo nombre de
-- columna `cantidad_destetada` para no romper las 2 vistas que ya
-- dependen de ella -- `vw_pecuario_ocupacion_poza`/
-- `vw_pecuario_poblacion_resumen`, evita un DROP CASCADE -- aunque el
-- nombre ya no describe 100% lo que mide, se documenta acá) para que
-- sume desde `PECUARIO_RECOLECCION_PARTOS` (nueva, ver abajo) en vez de
-- `PECUARIO_LOTES.parto_origen_id`. `parto_origen_id` sigue existiendo
-- en el esquema (no se toca), simplemente el flujo real de Destete no lo
-- usa -- la trazabilidad hacia los partos de origen de un lote real pasa
-- por `PECUARIO_RECOLECCION_PARTOS`, de forma agregada/proporcional
-- (varios partos por recolección), tal como la propia spec (§4) admite
-- que es lo único posible una vez mezclados los gazapos.
--
-- DECISIÓN DE ARQUITECTURA:
--   1. `PECUARIO_RECOLECCIONES_DESTETE` -- fila ancla por ronda de
--      recolección (fecha, organización). Inmutable tras crearse (nunca
--      se hace UPDATE) -- todos los números derivados (recolectado,
--      asignado, pendiente, abierta/cerrada) se calculan en la vista
--      `vw_pecuario_recolecciones_destete` de abajo, nunca se guardan
--      como contador replicado (evita que se desincronicen).
--   2. `PECUARIO_RECOLECCION_PARTOS` -- qué partos entraron en cada
--      recolección y cuánto de cada uno (`cantidad_incluida`, SIEMPRE
--      calculada por el trigger desde `vw_pecuario_lactancia_restante`
--      en el momento del insert -- nunca se confía en lo que mande el
--      cliente, mismo criterio que `origen_jaula_id` en Traslado). Un
--      parto solo puede recolectarse una vez en total (`UNIQUE(parto_id)`
--      -- no por recolección, GLOBAL): se recolecta completo o nada,
--      igual que describe la spec (checklist de partos completos, no
--      hay recolección parcial de un mismo parto).
--   3. `PECUARIO_LOTES.recoleccion_origen_id` (columna nueva, nullable)
--      -- el lote real que arma el Paso 2. El trigger
--      `trg_conformar_lote_destete` (BEFORE INSERT en PECUARIO_LOTES,
--      pero SOLO actúa cuando `recoleccion_origen_id IS NOT NULL` -- no
--      afecta ningún otro flujo que inserte en PECUARIO_LOTES, como el
--      traslado parcial de 20260924100000) valida que la cantidad pedida
--      no supere el remanente real de la recolección (calculado en vivo,
--      igual que el punto 2) y que la poza destino sea de la misma
--      organización.
--   4. `vw_pecuario_recolecciones_destete` -- reemplaza
--      `poolDestete`/`lotesDesteteFormados` del simulador: cantidad
--      recolectada, asignada, pendiente y estado ('abierta'/'cerrada',
--      100% calculado) por recolección. Resuelve de raíz el hallazgo de
--      la spec §9 (el remanente ahora sobrevive a cerrar la app o
--      cambiar de dispositivo, porque es una fila real, no una variable
--      en memoria).
--
-- SEXO OBLIGATORIO SIN "MIXTO" (spec §3, Paso 2): `PECUARIO_LOTES.sexo`
-- sigue siendo texto libre (no enum, columna ya existente) porque otros
-- flujos de creación de lotes sí pueden necesitar 'mixto' -- se agrega un
-- CHECK acotado SOLO a lotes de este flujo
-- (`recoleccion_origen_id IS NULL OR sexo IN ('macho','hembra')`), sin
-- afectar ningún otro camino que ya inserte en PECUARIO_LOTES.
--
-- SOBRE EL BUG DEL SIMULADOR §8 ("Conformar un lote" podía sobrescribir
-- un lote existente): ese bug es estructuralmente imposible acá -- un
-- INSERT real con `uq_lote_org_codigo` (UNIQUE, ya existe desde v1)
-- rechaza un código duplicado en vez de sobrescribir en silencio: el
-- simulador solo podía tener ese bug porque usaba un objeto JS indexado
-- por código como "base de datos". No hace falta ninguna protección
-- nueva acá.
--
-- PESAJE OPCIONAL AL CONFORMAR (spec §3, "Pesaje al destete"): usa
-- `PECUARIO_PESAJES` ya existente (v1) sin cambios de esquema -- el
-- Server Action hace 2 inserts secuenciales (lote, y si se cargó pesaje,
-- un segundo insert en PECUARIO_PESAJES con `lote_id` = id del lote
-- recién creado, mismo `id` que ya generó el cliente) -- no se ata con
-- un trigger porque es opcional y ortogonal a la bitácora de la
-- recolección; no hace falta que sea atómico con el insert del lote.
--
-- FUERA DE ALCANCE A PROPÓSITO (spec §3.1/§4/§9.4, decisión de negocio
-- sin confirmar, no bug):
--   - La tarjeta "una sola alerta por semana con día central sugerido"
--     (spec §3.1) -- sigue sin definirse cómo se agruparía la ventana de
--     fechas. Esta migración no genera ninguna TAREA nueva.
--   - Si el sistema real debe bloquear una recolección nueva mientras
--     otra sigue con remanente (como hace el simulador desde la v54, spec
--     §9.2) -- spec §9.4 lo deja explícitamente pendiente de confirmar
--     con los técnicos. NO se agrega ningún constraint que lo bloquee acá
--     -- varias recoleccion abiertas en simultáneo son técnicamente
--     posibles con este esquema hasta que se decida lo contrario.
--   - HALLAZGO SEÑALADO, NO CORREGIDO ACÁ: el trigger
--     `fn_crear_tarea_destete` (v1, 20260910160000) todavía crea una
--     TAREA por CADA parto con vencimiento fijo a los "+14 días" -- la
--     spec confirma explícitamente (§2.1) que la fecha de destete real
--     es flexible, NO un cálculo automático de 14 días, y que la tarea
--     real debería ser por semana, no por parto. Ese trigger sigue
--     activo y ahora contradice una decisión de negocio ya confirmada.
--     No se toca en esta migración (cambiar/desactivar un trigger en
--     producción está fuera del alcance pedido -- "construir Destete" --
--     y no está claro si algo del lado de la app ya depende de esas
--     TAREAS) -- queda señalado para que se decida aparte.
--
-- Aditiva. Idempotente.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_PARTOS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_PARTOS (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_LOTES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_LOTES (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_JAULAS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_JAULAS (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public.vw_pecuario_lactancia_restante') IS NULL THEN
    RAISE EXCEPTION 'Falta vw_pecuario_lactancia_restante (20260924110000_pecuario_poblacion_vistas.sql). Corré primero esa migración -- esta la reemplaza (CREATE OR REPLACE) y depende de que ya exista.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auth_org_id') THEN
    RAISE EXCEPTION 'Falta public.auth_org_id() (login real, Fase A). Prerrequisito de las políticas RLS/vistas de esta migración.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. PECUARIO_RECOLECCIONES_DESTETE
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PECUARIO_RECOLECCIONES_DESTETE" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE" ADD COLUMN IF NOT EXISTS fecha_destete DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE"
        ADD CONSTRAINT fk_recolecciones_destete_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_recolecciones_destete_org_fecha ON public."PECUARIO_RECOLECCIONES_DESTETE" ("ID_Organizacion", fecha_destete DESC);

-- ---------------------------------------------------------------------
-- 2. PECUARIO_RECOLECCION_PARTOS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PECUARIO_RECOLECCION_PARTOS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS" ADD COLUMN IF NOT EXISTS recoleccion_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS" ADD COLUMN IF NOT EXISTS parto_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS" ADD COLUMN IF NOT EXISTS cantidad_incluida INTEGER;
ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public."PECUARIO_RECOLECCION_PARTOS".cantidad_incluida IS
  'Calculado siempre por trg_recoleccion_partos_validar desde vw_pecuario_lactancia_restante en el momento del insert -- lo que mande el cliente en este campo se ignora, nunca se confía como fuente de verdad.';

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS"
        ADD CONSTRAINT fk_recoleccion_partos_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS"
        ADD CONSTRAINT fk_recoleccion_partos_recoleccion FOREIGN KEY (recoleccion_id)
        REFERENCES public."PECUARIO_RECOLECCIONES_DESTETE"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS"
        ADD CONSTRAINT fk_recoleccion_partos_parto FOREIGN KEY (parto_id)
        REFERENCES public."PECUARIO_PARTOS"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS" ADD CONSTRAINT uq_recoleccion_partos_parto UNIQUE (parto_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS" ADD CONSTRAINT chk_recoleccion_partos_cantidad CHECK (cantidad_incluida > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_recoleccion_partos_recoleccion ON public."PECUARIO_RECOLECCION_PARTOS" (recoleccion_id);

-- Trigger: cantidad_incluida SIEMPRE calculada server-side, nunca del cliente.
CREATE OR REPLACE FUNCTION public.trg_recoleccion_partos_validar()
RETURNS TRIGGER AS $$
DECLARE
  v_org_recoleccion TEXT;
  v_org_parto TEXT;
  v_restante INT;
BEGIN
  SELECT "ID_Organizacion" INTO v_org_recoleccion
    FROM public."PECUARIO_RECOLECCIONES_DESTETE" WHERE id = NEW.recoleccion_id;
  IF v_org_recoleccion IS DISTINCT FROM NEW."ID_Organizacion" THEN
    RAISE EXCEPTION 'recoleccion_id no pertenece a la organización %.', NEW."ID_Organizacion";
  END IF;

  SELECT "ID_Organizacion", cantidad_restante INTO v_org_parto, v_restante
    FROM public.vw_pecuario_lactancia_restante WHERE parto_id = NEW.parto_id;

  IF v_org_parto IS NULL THEN
    RAISE EXCEPTION 'El parto % no tiene lactancia pendiente de recolectar (ya fue recolectado por completo, o no existe).', NEW.parto_id;
  END IF;
  IF v_org_parto IS DISTINCT FROM NEW."ID_Organizacion" THEN
    RAISE EXCEPTION 'parto_id no pertenece a la organización %.', NEW."ID_Organizacion";
  END IF;

  NEW.cantidad_incluida := v_restante;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recoleccion_partos_validar ON public."PECUARIO_RECOLECCION_PARTOS";
CREATE TRIGGER trg_recoleccion_partos_validar
  BEFORE INSERT ON public."PECUARIO_RECOLECCION_PARTOS"
  FOR EACH ROW EXECUTE FUNCTION public.trg_recoleccion_partos_validar();

ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS"    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_recolecciones_destete" ON public."PECUARIO_RECOLECCIONES_DESTETE";
CREATE POLICY "rls_all_pecuario_recolecciones_destete" ON public."PECUARIO_RECOLECCIONES_DESTETE"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

DROP POLICY IF EXISTS "rls_all_pecuario_recoleccion_partos" ON public."PECUARIO_RECOLECCION_PARTOS";
CREATE POLICY "rls_all_pecuario_recoleccion_partos" ON public."PECUARIO_RECOLECCION_PARTOS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

-- ---------------------------------------------------------------------
-- 3. PECUARIO_LOTES.recoleccion_origen_id + CHECK de sexo + trigger de
--    conformación (solo actúa si recoleccion_origen_id IS NOT NULL)
-- ---------------------------------------------------------------------

ALTER TABLE public."PECUARIO_LOTES" ADD COLUMN IF NOT EXISTS recoleccion_origen_id UUID;

COMMENT ON COLUMN public."PECUARIO_LOTES".recoleccion_origen_id IS
  'Recolección de destete que originó este lote (specs/pecuario_destete_recoleccion_semanal.md) -- NULL para lotes que vienen de otros flujos (traslado parcial, alta manual). La trazabilidad hacia los partos de origen es agregada/proporcional vía PECUARIO_RECOLECCION_PARTOS, no un único parto_origen_id (varios partos se mezclan sin sexar antes de conformar el lote).';

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_LOTES"
        ADD CONSTRAINT fk_lotes_recoleccion_origen FOREIGN KEY (recoleccion_origen_id)
        REFERENCES public."PECUARIO_RECOLECCIONES_DESTETE"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_LOTES" ADD CONSTRAINT chk_lotes_destete_sexo_definido CHECK (
        recoleccion_origen_id IS NULL OR sexo IN ('macho', 'hembra')
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_lotes_recoleccion_origen ON public."PECUARIO_LOTES" (recoleccion_origen_id);

CREATE OR REPLACE FUNCTION public.trg_conformar_lote_destete()
RETURNS TRIGGER AS $$
DECLARE
  v_org_recoleccion TEXT;
  v_org_poza TEXT;
  v_recolectado INT;
  v_asignado INT;
  v_disponible INT;
BEGIN
  IF NEW.recoleccion_origen_id IS NULL THEN
    RETURN NEW; -- lote de cualquier otro flujo (traslado, alta manual) -- este trigger no aplica
  END IF;

  SELECT "ID_Organizacion" INTO v_org_recoleccion
    FROM public."PECUARIO_RECOLECCIONES_DESTETE" WHERE id = NEW.recoleccion_origen_id
    FOR UPDATE;
  IF v_org_recoleccion IS DISTINCT FROM NEW."ID_Organizacion" THEN
    RAISE EXCEPTION 'recoleccion_origen_id no pertenece a la organización %.', NEW."ID_Organizacion";
  END IF;

  SELECT "ID_Organizacion" INTO v_org_poza FROM public."PECUARIO_JAULAS" WHERE id = NEW.poza_actual_id;
  IF v_org_poza IS DISTINCT FROM NEW."ID_Organizacion" THEN
    RAISE EXCEPTION 'poza_actual_id no pertenece a la organización %.', NEW."ID_Organizacion";
  END IF;

  SELECT COALESCE(SUM(cantidad_incluida), 0) INTO v_recolectado
    FROM public."PECUARIO_RECOLECCION_PARTOS" WHERE recoleccion_id = NEW.recoleccion_origen_id;

  SELECT COALESCE(SUM(cantidad_inicial), 0) INTO v_asignado
    FROM public."PECUARIO_LOTES" WHERE recoleccion_origen_id = NEW.recoleccion_origen_id;

  v_disponible := v_recolectado - v_asignado;

  IF NEW.cantidad_inicial > v_disponible THEN
    RAISE EXCEPTION 'La cantidad del lote (%) supera el remanente disponible de la recolección (%).', NEW.cantidad_inicial, v_disponible;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lotes_conformar_destete ON public."PECUARIO_LOTES";
CREATE TRIGGER trg_lotes_conformar_destete
  BEFORE INSERT ON public."PECUARIO_LOTES"
  FOR EACH ROW EXECUTE FUNCTION public.trg_conformar_lote_destete();

-- ---------------------------------------------------------------------
-- 4. vw_pecuario_lactancia_restante -- REEMPLAZADA (mismo nombre de
--    columna cantidad_destetada, cálculo nuevo, ver nota arriba)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_lactancia_restante AS
SELECT
    p.id AS parto_id,
    p."ID_Organizacion",
    p.poza_id,
    p.fecha_parto,
    p.n_vivos,
    COALESCE(SUM(rp.cantidad_incluida), 0)::int AS cantidad_destetada,
    GREATEST(p.n_vivos - COALESCE(SUM(rp.cantidad_incluida), 0), 0)::int AS cantidad_restante
FROM public."PECUARIO_PARTOS" p
LEFT JOIN public."PECUARIO_RECOLECCION_PARTOS" rp ON rp.parto_id = p.id
WHERE (p."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
GROUP BY p.id, p."ID_Organizacion", p.poza_id, p.fecha_parto, p.n_vivos
HAVING p.n_vivos - COALESCE(SUM(rp.cantidad_incluida), 0) > 0;

COMMENT ON VIEW public.vw_pecuario_lactancia_restante IS
'Camadas todavía en lactancia. REEMPLAZADA 2026-09-25 (20260925090000_pecuario_destete_recoleccion.sql): antes sumaba PECUARIO_LOTES.parto_origen_id (20260924110000); ahora suma PECUARIO_RECOLECCION_PARTOS.cantidad_incluida, porque el corte real de "ya no está en lactancia" es la RECOLECCIÓN (Paso 1 de Destete), no la conformación del lote (Paso 2, que puede pasar días después y agrupa varios partos sin atribución individual). Columna cantidad_destetada mantiene su nombre por compatibilidad con vw_pecuario_ocupacion_poza/vw_pecuario_poblacion_resumen, que la consumen sin cambios.';

-- ---------------------------------------------------------------------
-- 5. vw_pecuario_recolecciones_destete -- reemplaza poolDestete/
--    lotesDesteteFormados (estado en memoria del simulador)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_recolecciones_destete AS
SELECT
    r.id,
    r."ID_Organizacion",
    r.fecha_destete,
    COALESCE(rp.total_recolectado, 0)::int AS cantidad_recolectada,
    COALESCE(lo.total_asignado, 0)::int AS cantidad_asignada,
    GREATEST(COALESCE(rp.total_recolectado, 0) - COALESCE(lo.total_asignado, 0), 0)::int AS cantidad_pendiente,
    CASE
        WHEN COALESCE(rp.total_recolectado, 0) - COALESCE(lo.total_asignado, 0) <= 0 THEN 'cerrada'
        ELSE 'abierta'
    END AS estado
FROM public."PECUARIO_RECOLECCIONES_DESTETE" r
LEFT JOIN (
    SELECT recoleccion_id, SUM(cantidad_incluida) AS total_recolectado
    FROM public."PECUARIO_RECOLECCION_PARTOS"
    GROUP BY recoleccion_id
) rp ON rp.recoleccion_id = r.id
LEFT JOIN (
    SELECT recoleccion_origen_id, SUM(cantidad_inicial) AS total_asignado
    FROM public."PECUARIO_LOTES"
    WHERE recoleccion_origen_id IS NOT NULL
    GROUP BY recoleccion_origen_id
) lo ON lo.recoleccion_origen_id = r.id
WHERE (r."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_recolecciones_destete IS
'Estado real de cada ronda de recolección de destete -- recolectado/asignado/pendiente/estado, 100% calculado (nunca un contador replicado). Reemplaza poolDestete/lotesDesteteFormados (estado en memoria del navegador del simulador, spec §9.4) -- el remanente ahora sobrevive a cerrar la app o cambiar de dispositivo.';

GRANT SELECT ON public.vw_pecuario_recolecciones_destete TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT * FROM vw_pecuario_recolecciones_destete WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
--
-- Caso de control -- con un parto real de GRANJA-VALENCIA con n_vivos=N:
--   1. INSERT en PECUARIO_RECOLECCIONES_DESTETE (fecha_destete = hoy).
--   2. INSERT en PECUARIO_RECOLECCION_PARTOS (recoleccion_id, parto_id) --
--      NO mandar cantidad_incluida, o mandar cualquier valor: el trigger
--      lo pisa con N. Confirmar que vw_pecuario_lactancia_restante ya no
--      lista ese parto (cantidad_restante llegó a 0).
--   3. Confirmar vw_pecuario_recolecciones_destete: cantidad_recolectada=N,
--      cantidad_pendiente=N, estado='abierta'.
--   4. INSERT en PECUARIO_LOTES con recoleccion_origen_id apuntando a esa
--      recolección, sexo='macho', cantidad_inicial < N (parcial) --
--      confirmar que cantidad_pendiente bajó esa cantidad y estado sigue
--      'abierta'.
--   5. Repetir el INSERT en PECUARIO_LOTES hasta agotar el remanente --
--      confirmar que vw_pecuario_recolecciones_destete.estado pasa solo a
--      'cerrada' (sin ningún UPDATE manual).
--   6. Debe fallar: INSERT en PECUARIO_LOTES con recoleccion_origen_id de
--      una recolección ya cerrada (remanente 0), o con cantidad_inicial
--      mayor al remanente real.
--   7. Debe fallar: INSERT en PECUARIO_LOTES con recoleccion_origen_id
--      válido pero sexo='mixto' (CHECK chk_lotes_destete_sexo_definido).
--   8. Debe fallar: INSERT en PECUARIO_RECOLECCION_PARTOS con el mismo
--      parto_id dos veces (UNIQUE uq_recoleccion_partos_parto).
-- ---------------------------------------------------------------------
