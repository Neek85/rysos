-- =====================================================================
-- RYZOS · Pecuario Cuyes · Traslado interno entre pozas/jaulas
-- Fecha: 2026-09-24
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (Sección 4.1.2): cubierta en el mismo
-- flujo, por haberse trabajado con Claude desde el principio.
--
-- Spec de referencia: specs/pecuario_traslado_interno.md (decisiones
-- confirmadas por Neyser, 2026-09-13/14; roadmap de Pecuario, ítem 4 de
-- Nivel 1 — ver claude/roadmap_pecuario_mockup_a_backend.md del proyecto
-- de Cowork).
--
-- HALLAZGO DE ESQUEMA (verificado contra las migraciones ya aplicadas,
-- 20260910160000/20260911140000, antes de escribir esta) — "poza" y
-- "jaula" en el diseño real NO son tablas distintas: ambas son
-- PECUARIO_JAULAS (columna tipo_uso distingue empadre/maternidad de
-- recria/engorde/aislamiento). PECUARIO_LOTES.poza_actual_id y
-- PECUARIO_REPRODUCTORES.jaula_actual_id apuntan las dos a
-- PECUARIO_JAULAS(id). Por eso esta migración usa un solo par de columnas
-- (origen_jaula_id/destino_jaula_id) en vez de duplicar
-- poza_origen_id/jaula_origen_id como sugería la spec (§4) — misma tabla
-- de todos modos, evita una columna vacía según el tipo de traslado.
--
-- DECISIÓN DE ARQUITECTURA — una tabla de auditoría/registro
-- (PECUARIO_TRASLADOS) + un trigger BEFORE INSERT
-- (trg_procesar_traslado) que aplica el efecto real:
--   * tipo_origen='lote', alcance='completo': actualiza
--     PECUARIO_LOTES.poza_actual_id del lote existente. No crea filas.
--   * tipo_origen='lote', alcance='parcial': crea una fila nueva en
--     PECUARIO_LOTES (poza destino, cantidad trasladada, mismo
--     parto_origen_id/sexo/etapa/estado que el lote origen para no perder
--     trazabilidad) y descuenta esa cantidad de cantidad_actual del lote
--     origen — el lote origen sigue existiendo con el resto (spec §4).
--     El id del lote nuevo lo fija el propio trigger en
--     NEW.lote_nuevo_id (por eso esta es una tabla BEFORE INSERT: permite
--     completar la fila antes de escribirla).
--   * tipo_origen='reproductor': actualiza
--     PECUARIO_REPRODUCTORES.jaula_actual_id directamente — spec §4 dice
--     explícitamente que no hace falta un trigger separado si la
--     transacción actualiza ambas tablas junto con el registro de
--     historial; acá el registro de historial (PECUARIO_TRASLADOS) Y la
--     actualización pasan en la misma transacción porque los hace el
--     mismo trigger.
--
-- INTEGRIDAD — origen_jaula_id NO se confía al cliente: el trigger lo
-- sobreescribe siempre leyendo la poza_actual_id/jaula_actual_id real del
-- lote/animal en el momento del insert, para que el registro de auditoría
-- no dependa de que el cliente haya mandado el dato correcto (mismo
-- espíritu que otros triggers de este módulo que no confían en el
-- cliente para datos derivables del servidor). También valida
-- multi-tenant estricto (Sección 5): lote/animal/destino deben pertenecer
-- a la misma ID_Organizacion que el traslado, si no, RAISE EXCEPTION.
--
-- LO QUE EL CONTRATO ZOD (lib/validations/pecuario.ts) NO INCLUYE A
-- PROPÓSITO: origen_jaula_id y lote_nuevo_id son campos que el propio
-- trigger calcula — el cliente nunca los manda, así que no forman parte
-- del schema de entrada.
--
-- OFFLINE — spec §5 deja sin confirmar si esta pantalla se usa desde la
-- app de campo offline (probable). Se agregan device_id/
-- created_offline_at/synced_at igual, mismo criterio defensivo ya usado
-- en el resto del módulo (columnas sin costo real si no se usan).
--
-- NO IMPLEMENTADO A PROPÓSITO (fuera de alcance de esta migración,
-- spec §4 los deja como posible mejora, no decisión): mostrar el
-- historial de traslados en ficha-lote/ficha-reproductor — la tabla ya
-- queda lista para esa consulta (índices por lote_id/animal_id), pero no
-- se construye ninguna vista/UI para eso acá.
--
-- NOTA (agregada por Claude Code CLI, no en la redacción original de
-- Cowork): se envuelve el archivo en BEGIN;/COMMIT; -- todas las demás
-- migraciones de este repo lo hacen (ver CLAUDE.md). Sin riesgo
-- funcional: los 3 enums de este archivo son CREATE TYPE nuevos (no
-- ALTER TYPE ADD VALUE sobre un tipo existente), así que no aplica la
-- restricción de "unsafe use of new value of enum type" que sí forzó
-- partir en 2 archivos la migración de venta pelado
-- (20260923090000a/b) -- un tipo recién creado sí puede usarse en la
-- misma transacción que lo crea.
--
-- OBSERVACIÓN PARA LA REVISIÓN MANUAL (Claude Code CLI, no cambia nada
-- de lo redactado por Cowork -- columnas/constraints/nombres intactos,
-- solo se señala para que Neyser lo vea antes de aplicar): ningún CHECK
-- de esta tabla exige lote_nuevo_id IS NULL cuando alcance='completo'
-- (o cuando tipo_origen='reproductor' sí lo exige, vía
-- chk_traslados_alcance_solo_lote, pero el caso 'lote'+'completo' queda
-- sin ese mismo cierre). El trigger nunca lo escribe en esas ramas, así
-- que en la práctica queda NULL de todos modos -- pero un INSERT que
-- mande explícitamente un lote_nuevo_id ajeno junto con alcance=
-- 'completo' no lo rechazaría a nivel de base. No se agregó un CHECK
-- nuevo para cerrar esto (habría sido cambiar el contenido pedido
-- textualmente) -- queda para que se decida en la revisión.
--
-- Aditiva. Idempotente.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_LOTES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_LOTES (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_JAULAS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_JAULAS (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_REPRODUCTORES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_REPRODUCTORES (v3, 20260911140000...). Corré primero esa migración.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auth_org_id') THEN
    RAISE EXCEPTION 'Falta public.auth_org_id() (login real, Fase A). Prerrequisito de las políticas RLS de esta migración.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 0. Enums
-- ---------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE tipo_origen_traslado AS ENUM ('lote', 'reproductor');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE alcance_traslado_lote AS ENUM ('completo', 'parcial');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE motivo_traslado_pecuario AS ENUM ('enfermedad_aislamiento', 'recomposicion_poza', 'sobrepoblacion', 'otro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------
-- 1. PECUARIO_TRASLADOS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PECUARIO_TRASLADOS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS fecha DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS tipo_origen tipo_origen_traslado NOT NULL;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS lote_id UUID;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS animal_id UUID;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS origen_jaula_id UUID;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS destino_jaula_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS alcance alcance_traslado_lote;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS cantidad INTEGER;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS codigo_lote_nuevo VARCHAR(50);
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS lote_nuevo_id UUID;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS motivo_traslado motivo_traslado_pecuario NOT NULL;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_TRASLADOS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public."PECUARIO_TRASLADOS".origen_jaula_id IS
  'Calculado por trg_procesar_traslado a partir del estado real del lote/animal al momento del insert -- lo que mande el cliente en este campo se ignora, nunca se confía como fuente de verdad de auditoría.';
COMMENT ON COLUMN public."PECUARIO_TRASLADOS".lote_nuevo_id IS
  'Solo cuando alcance = parcial. Lo fija trg_procesar_traslado al crear el lote nuevo -- el cliente nunca lo manda.';

-- FKs
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRASLADOS"
        ADD CONSTRAINT fk_traslados_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRASLADOS"
        ADD CONSTRAINT fk_traslados_lote FOREIGN KEY (lote_id)
        REFERENCES public."PECUARIO_LOTES"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRASLADOS"
        ADD CONSTRAINT fk_traslados_animal FOREIGN KEY (animal_id)
        REFERENCES public."PECUARIO_REPRODUCTORES"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRASLADOS"
        ADD CONSTRAINT fk_traslados_origen_jaula FOREIGN KEY (origen_jaula_id)
        REFERENCES public."PECUARIO_JAULAS"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRASLADOS"
        ADD CONSTRAINT fk_traslados_destino_jaula FOREIGN KEY (destino_jaula_id)
        REFERENCES public."PECUARIO_JAULAS"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRASLADOS"
        ADD CONSTRAINT fk_traslados_lote_nuevo FOREIGN KEY (lote_nuevo_id)
        REFERENCES public."PECUARIO_LOTES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Consistencia dentro de la misma fila (no requiere trigger, todo está
-- en la propia tabla) -- CHECK corre DESPUÉS del trigger BEFORE INSERT,
-- así que ya ve origen_jaula_id/lote_nuevo_id ya completados por él.
DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRASLADOS" ADD CONSTRAINT chk_traslados_tipo_origen_coherente CHECK (
        (tipo_origen = 'lote' AND lote_id IS NOT NULL AND animal_id IS NULL)
        OR
        (tipo_origen = 'reproductor' AND animal_id IS NOT NULL AND lote_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRASLADOS" ADD CONSTRAINT chk_traslados_alcance_solo_lote CHECK (
        (tipo_origen = 'lote' AND alcance IS NOT NULL)
        OR
        (tipo_origen = 'reproductor' AND alcance IS NULL AND cantidad IS NULL AND codigo_lote_nuevo IS NULL AND lote_nuevo_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRASLADOS" ADD CONSTRAINT chk_traslados_parcial_requiere_datos CHECK (
        (alcance = 'parcial' AND cantidad IS NOT NULL AND cantidad > 0 AND codigo_lote_nuevo IS NOT NULL)
        OR
        (alcance = 'completo' AND cantidad IS NULL AND codigo_lote_nuevo IS NULL)
        OR
        (alcance IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_TRASLADOS" ADD CONSTRAINT chk_traslados_origen_destino_distintos CHECK (
        origen_jaula_id IS DISTINCT FROM destino_jaula_id
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_traslados_org_fecha ON public."PECUARIO_TRASLADOS" ("ID_Organizacion", fecha DESC);
CREATE INDEX IF NOT EXISTS idx_pecuario_traslados_lote ON public."PECUARIO_TRASLADOS" (lote_id);
CREATE INDEX IF NOT EXISTS idx_pecuario_traslados_animal ON public."PECUARIO_TRASLADOS" (animal_id);

-- ---------------------------------------------------------------------
-- 2. Trigger BEFORE INSERT — aplica el efecto real del traslado
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_procesar_traslado()
RETURNS TRIGGER AS $$
DECLARE
  v_cantidad_actual INT;
  v_org_lote TEXT;
  v_org_animal TEXT;
  v_org_destino TEXT;
  v_lote_nuevo_id UUID;
BEGIN
  -- Multi-tenant estricto (Sección 5): destino debe ser de la misma org.
  SELECT "ID_Organizacion" INTO v_org_destino FROM public."PECUARIO_JAULAS" WHERE id = NEW.destino_jaula_id;
  IF v_org_destino IS DISTINCT FROM NEW."ID_Organizacion" THEN
    RAISE EXCEPTION 'destino_jaula_id no pertenece a la organización %.', NEW."ID_Organizacion";
  END IF;

  IF NEW.tipo_origen = 'lote' THEN
    SELECT "ID_Organizacion", cantidad_actual, poza_actual_id
      INTO v_org_lote, v_cantidad_actual, NEW.origen_jaula_id
      FROM public."PECUARIO_LOTES" WHERE id = NEW.lote_id
      FOR UPDATE;

    IF v_org_lote IS DISTINCT FROM NEW."ID_Organizacion" THEN
      RAISE EXCEPTION 'lote_id no pertenece a la organización %.', NEW."ID_Organizacion";
    END IF;

    IF NEW.alcance = 'parcial' THEN
      IF NEW.cantidad > v_cantidad_actual THEN
        RAISE EXCEPTION 'La cantidad a trasladar (%) supera la cantidad actual del lote origen (%).', NEW.cantidad, v_cantidad_actual;
      END IF;

      INSERT INTO public."PECUARIO_LOTES" (
        "ID_Organizacion", codigo_lote, poza_actual_id, parto_origen_id,
        cantidad_inicial, cantidad_actual, sexo, etapa, estado
      )
      SELECT "ID_Organizacion", NEW.codigo_lote_nuevo, NEW.destino_jaula_id, parto_origen_id,
             NEW.cantidad, NEW.cantidad, sexo, etapa, estado
      FROM public."PECUARIO_LOTES" WHERE id = NEW.lote_id
      RETURNING id INTO v_lote_nuevo_id;

      UPDATE public."PECUARIO_LOTES"
        SET cantidad_actual = cantidad_actual - NEW.cantidad, updated_at = now()
        WHERE id = NEW.lote_id;

      NEW.lote_nuevo_id := v_lote_nuevo_id;

    ELSIF NEW.alcance = 'completo' THEN
      UPDATE public."PECUARIO_LOTES"
        SET poza_actual_id = NEW.destino_jaula_id, updated_at = now()
        WHERE id = NEW.lote_id;
    END IF;

  ELSIF NEW.tipo_origen = 'reproductor' THEN
    SELECT "ID_Organizacion", jaula_actual_id
      INTO v_org_animal, NEW.origen_jaula_id
      FROM public."PECUARIO_REPRODUCTORES" WHERE id = NEW.animal_id
      FOR UPDATE;

    IF v_org_animal IS DISTINCT FROM NEW."ID_Organizacion" THEN
      RAISE EXCEPTION 'animal_id no pertenece a la organización %.', NEW."ID_Organizacion";
    END IF;

    UPDATE public."PECUARIO_REPRODUCTORES"
      SET jaula_actual_id = NEW.destino_jaula_id, updated_at = now()
      WHERE id = NEW.animal_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_traslados_procesar ON public."PECUARIO_TRASLADOS";
CREATE TRIGGER trg_traslados_procesar
  BEFORE INSERT ON public."PECUARIO_TRASLADOS"
  FOR EACH ROW EXECUTE FUNCTION public.trg_procesar_traslado();

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public."PECUARIO_TRASLADOS" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_traslados" ON public."PECUARIO_TRASLADOS";
CREATE POLICY "rls_all_pecuario_traslados" ON public."PECUARIO_TRASLADOS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'PECUARIO_TRASLADOS' ORDER BY ordinal_position;
--
-- Traslado completo (lote existente cambia de poza, sin fila nueva):
-- INSERT INTO "PECUARIO_TRASLADOS" ("ID_Organizacion", tipo_origen, lote_id, destino_jaula_id, alcance, motivo_traslado)
--   VALUES ('<org de prueba>', 'lote', '<lote_id>', '<jaula destino>', 'completo', 'recomposicion_poza');
--   -- esperado: PECUARIO_LOTES.poza_actual_id del lote_id pasa a ser destino_jaula_id
--
-- Traslado parcial (crea lote nuevo, descuenta el origen):
-- INSERT INTO "PECUARIO_TRASLADOS" ("ID_Organizacion", tipo_origen, lote_id, destino_jaula_id, alcance, cantidad, codigo_lote_nuevo, motivo_traslado)
--   VALUES ('<org de prueba>', 'lote', '<lote_id>', '<jaula destino>', 'parcial', 5, 'L-SPLIT-001', 'sobrepoblacion');
--   -- esperado: fila nueva en PECUARIO_LOTES (cantidad_actual=5, poza=destino), lote_id origen baja 5 en cantidad_actual,
--   -- lote_nuevo_id del registro de traslado queda con el id del lote nuevo
--
-- Debe fallar (cantidad mayor a la disponible):
-- INSERT INTO "PECUARIO_TRASLADOS" ("ID_Organizacion", tipo_origen, lote_id, destino_jaula_id, alcance, cantidad, codigo_lote_nuevo, motivo_traslado)
--   VALUES ('<org de prueba>', 'lote', '<lote_id>', '<jaula destino>', 'parcial', 999999, 'L-SPLIT-002', 'sobrepoblacion');
--
-- Debe fallar (origen y destino iguales, chk_traslados_origen_destino_distintos):
-- INSERT INTO "PECUARIO_TRASLADOS" ("ID_Organizacion", tipo_origen, lote_id, destino_jaula_id, alcance, motivo_traslado)
--   VALUES ('<org de prueba>', 'lote', '<lote_id>', '<misma jaula donde ya está el lote>', 'completo', 'otro');
--
-- Traslado de reproductor:
-- INSERT INTO "PECUARIO_TRASLADOS" ("ID_Organizacion", tipo_origen, animal_id, destino_jaula_id, motivo_traslado)
--   VALUES ('<org de prueba>', 'reproductor', '<animal_id>', '<jaula destino>', 'enfermedad_aislamiento');
--   -- esperado: PECUARIO_REPRODUCTORES.jaula_actual_id del animal_id pasa a ser destino_jaula_id
-- ---------------------------------------------------------------------
