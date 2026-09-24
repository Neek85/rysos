-- =====================================================================
-- RYZOS · Pecuario Cuyes · Catálogo de actividades de Sanidad configurable
-- Fecha: 2026-09-23
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (Sección 4.1.2): cubierta en el mismo
-- flujo, por haberse trabajado con Claude desde el principio.
--
-- Spec de referencia: specs/pecuario_sanidad_actividades_configurables.md
-- (decisiones confirmadas por Neyser, 2026-09-15 y 2026-09-21; roadmap de
-- Pecuario 2026-09-23, ítem 3 de Nivel 1 — ver
-- claude/roadmap_pecuario_mockup_a_backend.md del proyecto de Cowork).
--
-- DECISIÓN DE ARQUITECTURA — dos tablas, catálogo + transaccional, mismo
-- patrón ya usado para Insumos/Movimientos (pecuario_compras_gastos):
--   * PECUARIO_ACTIVIDADES_SANIDAD: catálogo por organización (nombre,
--     alcance, frecuencia_dias, activo). "activo" boolean en vez de
--     borrado físico — spec §4 pide poder desactivar sin perder historial.
--   * PECUARIO_SANIDAD_REGISTROS: un registro por vez que se ejecuta una
--     actividad, FK a la actividad del catálogo.
--
-- CAMPOS GENÉRICOS — spec §2.2: el formulario de registro es el mismo
-- para cualquier actividad (fecha, producto, responsable, observaciones),
-- sin columnas condicionales por tipo de actividad — decisión ya
-- confirmada, no una simplificación mía.
--
-- GUARDA alcance/galpon_id — spec §9 documenta un bug real del mockup
-- (guardarActividadSanidad() dejaba pasar galpon_id ausente/sobrante
-- según el alcance de la actividad, produciendo registros corruptos con
-- "undefined" en el mensaje de confirmación). Se agrega un trigger
-- (trg_validar_sanidad_registro_galpon) para que la base rechace esa
-- combinación inválida en vez de depender solo de la UI.
--
-- RLS admin-only del catálogo — spec §4: alta/edición/baja de actividad
-- debería quedar restringida al rol admin, pero la web hoy no tiene
-- sesión de Supabase Auth real (usa la llave anon, ver CLAUDE.md) — mismo
-- caveat ya documentado para Insumos (pecuario_compras_gastos.md §4). La
-- política RLS de este archivo usa el mismo patrón "mismo org" del resto
-- del esquema (no bloquea por rol, porque hoy no hay sesión de la que
-- leer un rol) — la restricción real por rol admin debe vivir en la
-- Server Action (lib/actions/) hasta que exista login real en la web, y
-- se aplicará de lleno vía RLS por rol en las apps móviles nuevas (donde
-- sí hay auth DNI+PIN/usuario interno con rol).
--
-- OFFLINE — spec §5 deja sin confirmar si esta pantalla se registra desde
-- la app de campo offline (probable). Se agregan device_id/
-- created_offline_at/synced_at igual, mismo criterio defensivo ya usado
-- en Compras/Guano/Mortalidad-fotos (columnas sin costo real si no se
-- usan).
--
-- NO SE CREA vw_sanidad_proximas (mencionada en spec §4 como "conviene")
-- — es una posibilidad, no una decisión confirmada; queda para cuando se
-- construya el Panel de indicadores (ítem 10 del roadmap) o se pida
-- explícitamente.
--
-- HALLAZGO RESUELTO ANTES DE ESCRIBIR ESTA VERSIÓN — la v2
-- (2026-09-11, ya en producción) había construido backend real para las
-- dos actividades fijas que esta spec vuelve configurables:
-- `PECUARIO_CONTROL_SANITARIO` (desinfección, sin columna de frecuencia)
-- y `PECUARIO_LIMPIEZA_GALPON` (limpieza por galpón, frecuencia en
-- `PECUARIO_GALPONES.dias_frecuencia_limpieza`), más dos vistas
-- (`vw_pecuario_desinfeccion_estado`, `vw_pecuario_limpieza_galpon_estado`).
-- Verificado en vivo antes de migrar (CLI, 2026-09-23): 0 filas reales en
-- ambas tablas para `GRANJA-VALENCIA` (Content-Range */0, ID de
-- organización confirmado, sin otro candidato) y ningún archivo de
-- `app/`/`components/`/`lib/` referencia ninguna de las dos vistas — el
-- frontend web no las consume. Con 0 filas reales, **no hace falta
-- backfill** hacia `PECUARIO_ACTIVIDADES_SANIDAD`/`PECUARIO_SANIDAD_REGISTROS`.
-- Las tablas/vistas viejas NO se eliminan en esta migración (`DROP TABLE`
-- requiere confirmación explícita fuera del flujo autónomo, Sección 5) —
-- quedan marcadas como superadas vía `COMMENT ON` (ver el final de este
-- archivo) para que quien las encuentre después sepa que ya no son la
-- fuente de verdad, sin borrar nada todavía.
--
-- NO SE SEMBRÓ ("seed") ningún catálogo inicial para GRANJA-VALENCIA —
-- la spec (§4) deja "sembrar actividades por defecto" como una
-- posibilidad sin confirmar, y el único número de frecuencia real
-- disponible (`dias_frecuencia_limpieza = 15`) no tiene equivalente
-- confirmado para Desinfección (el "cada 7 días" que usa el mockup es
-- dato de ejemplo del simulador, no un valor de negocio confirmado para
-- producción — spec §5 pide confirmarlo con los técnicos). El catálogo
-- de Granja Valencia arranca vacío; el admin lo completa desde
-- "Actividades (admin)" con los números reales cuando estén confirmados.
--
-- Aditiva. Idempotente.
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_GALPONES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_GALPONES (v2, 20260910...). Corré primero esa migración.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auth_org_id') THEN
    RAISE EXCEPTION 'Falta public.auth_org_id() (login real, Fase A). Prerrequisito de las políticas RLS de esta migración.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 0. Enum de alcance
-- ---------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE alcance_actividad_sanidad AS ENUM ('granja', 'galpon');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------
-- 1. PECUARIO_ACTIVIDADES_SANIDAD (catálogo)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PECUARIO_ACTIVIDADES_SANIDAD" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_ACTIVIDADES_SANIDAD" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_ACTIVIDADES_SANIDAD" ADD COLUMN IF NOT EXISTS nombre VARCHAR(100) NOT NULL;
ALTER TABLE public."PECUARIO_ACTIVIDADES_SANIDAD" ADD COLUMN IF NOT EXISTS alcance alcance_actividad_sanidad NOT NULL;
ALTER TABLE public."PECUARIO_ACTIVIDADES_SANIDAD" ADD COLUMN IF NOT EXISTS frecuencia_dias INTEGER NOT NULL;
ALTER TABLE public."PECUARIO_ACTIVIDADES_SANIDAD" ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public."PECUARIO_ACTIVIDADES_SANIDAD" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_ACTIVIDADES_SANIDAD"
        ADD CONSTRAINT fk_actividades_sanidad_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_ACTIVIDADES_SANIDAD"
        ADD CONSTRAINT chk_actividades_sanidad_frecuencia_positiva CHECK (frecuencia_dias > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_actividades_sanidad_org ON public."PECUARIO_ACTIVIDADES_SANIDAD" ("ID_Organizacion");

ALTER TABLE public."PECUARIO_ACTIVIDADES_SANIDAD" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_actividades_sanidad" ON public."PECUARIO_ACTIVIDADES_SANIDAD";
CREATE POLICY "rls_all_pecuario_actividades_sanidad" ON public."PECUARIO_ACTIVIDADES_SANIDAD"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

-- ---------------------------------------------------------------------
-- 2. PECUARIO_SANIDAD_REGISTROS (transaccional)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PECUARIO_SANIDAD_REGISTROS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS actividad_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS galpon_id UUID;
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS fecha DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS producto_usado VARCHAR(150);
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS responsable VARCHAR(150);
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS observaciones TEXT;
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public."PECUARIO_SANIDAD_REGISTROS".responsable IS
  'Nombre de la persona responsable del registro — dato interno, nunca expuesto en /trace/[lot_hash] ni en ninguna vista pública.';

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS"
        ADD CONSTRAINT fk_sanidad_registros_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS"
        ADD CONSTRAINT fk_sanidad_registros_actividad FOREIGN KEY (actividad_id)
        REFERENCES public."PECUARIO_ACTIVIDADES_SANIDAD"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS"
        ADD CONSTRAINT fk_sanidad_registros_galpon FOREIGN KEY (galpon_id)
        REFERENCES public."PECUARIO_GALPONES"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_sanidad_registros_org_fecha ON public."PECUARIO_SANIDAD_REGISTROS" ("ID_Organizacion", fecha DESC);
CREATE INDEX IF NOT EXISTS idx_pecuario_sanidad_registros_actividad ON public."PECUARIO_SANIDAD_REGISTROS" (actividad_id);

-- ---------------------------------------------------------------------
-- 2.1. Guarda: galpon_id obligatorio/prohibido según el alcance de la
--      actividad — spec §9 documenta el bug real de esto en el mockup.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_validar_sanidad_registro_galpon()
RETURNS TRIGGER AS $$
DECLARE
  v_alcance alcance_actividad_sanidad;
BEGIN
  SELECT alcance INTO v_alcance FROM public."PECUARIO_ACTIVIDADES_SANIDAD" WHERE id = NEW.actividad_id;

  IF v_alcance = 'galpon' AND NEW.galpon_id IS NULL THEN
    RAISE EXCEPTION 'Esta actividad es de alcance "por galpón": galpon_id es obligatorio.';
  END IF;

  IF v_alcance = 'granja' AND NEW.galpon_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta actividad es de alcance "toda la granja": no debe tener galpon_id.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sanidad_registros_validar_galpon ON public."PECUARIO_SANIDAD_REGISTROS";
CREATE TRIGGER trg_sanidad_registros_validar_galpon
  BEFORE INSERT OR UPDATE ON public."PECUARIO_SANIDAD_REGISTROS"
  FOR EACH ROW EXECUTE FUNCTION public.trg_validar_sanidad_registro_galpon();

ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_sanidad_registros" ON public."PECUARIO_SANIDAD_REGISTROS";
CREATE POLICY "rls_all_pecuario_sanidad_registros" ON public."PECUARIO_SANIDAD_REGISTROS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

-- ---------------------------------------------------------------------
-- 3. Marcar como superadas (NO se eliminan) las tablas/vistas fijas de
--    v2 que este catálogo configurable reemplaza conceptualmente.
--    Confirmado 0 filas reales para GRANJA-VALENCIA antes de este paso
--    (ver nota de cabecera). Ningún DROP — Sección 5 lo exige fuera del
--    flujo autónomo.
-- ---------------------------------------------------------------------

COMMENT ON TABLE public."PECUARIO_CONTROL_SANITARIO" IS
  'SUPERADA (2026-09-23) por PECUARIO_ACTIVIDADES_SANIDAD + PECUARIO_SANIDAD_REGISTROS (actividad "Desinfección general" o equivalente, alcance granja). Confirmado 0 filas reales para GRANJA-VALENCIA al momento del cambio — no requirió backfill. No usar para escritura nueva. No eliminada (requiere confirmación explícita aparte, ver Sección 5 del documento maestro).';

COMMENT ON TABLE public."PECUARIO_LIMPIEZA_GALPON" IS
  'SUPERADA (2026-09-23) por PECUARIO_ACTIVIDADES_SANIDAD + PECUARIO_SANIDAD_REGISTROS (actividad "Limpieza de galpón" o equivalente, alcance galpon). Confirmado 0 filas reales para GRANJA-VALENCIA al momento del cambio — no requirió backfill. No usar para escritura nueva. No eliminada (requiere confirmación explícita aparte, ver Sección 5 del documento maestro).';

DO $$ BEGIN
  IF to_regclass('public.vw_pecuario_desinfeccion_estado') IS NOT NULL THEN
    COMMENT ON VIEW public.vw_pecuario_desinfeccion_estado IS
      'SUPERADA (2026-09-23) — ver PECUARIO_ACTIVIDADES_SANIDAD/PECUARIO_SANIDAD_REGISTROS. Confirmado sin referencias en app/components/lib del frontend web al momento del cambio.';
  END IF;
  IF to_regclass('public.vw_pecuario_limpieza_galpon_estado') IS NOT NULL THEN
    COMMENT ON VIEW public.vw_pecuario_limpieza_galpon_estado IS
      'SUPERADA (2026-09-23) — ver PECUARIO_ACTIVIDADES_SANIDAD/PECUARIO_SANIDAD_REGISTROS. Confirmado sin referencias en app/components/lib del frontend web al momento del cambio.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'PECUARIO_ACTIVIDADES_SANIDAD' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'PECUARIO_SANIDAD_REGISTROS' ORDER BY ordinal_position;
--
-- INSERT INTO "PECUARIO_ACTIVIDADES_SANIDAD" ("ID_Organizacion", nombre, alcance, frecuencia_dias)
--   VALUES ('<org de prueba>', 'Desinfección general', 'granja', 7)
--   RETURNING id;
--
-- Con el id devuelto arriba, para una actividad "granja":
-- INSERT INTO "PECUARIO_SANIDAD_REGISTROS" ("ID_Organizacion", actividad_id, fecha)
--   VALUES ('<org de prueba>', '<id de arriba>', CURRENT_DATE);
--   -- esperado: fila creada (galpon_id NULL, alcance granja: correcto)
--
-- Debe fallar por trg_sanidad_registros_validar_galpon (alcance granja + galpon_id presente):
-- INSERT INTO "PECUARIO_SANIDAD_REGISTROS" ("ID_Organizacion", actividad_id, fecha, galpon_id)
--   VALUES ('<org de prueba>', '<id de arriba>', CURRENT_DATE, '<un galpon_id real>');
--
-- Debe fallar también en el sentido inverso: crear una actividad 'galpon'
-- y registrar SIN galpon_id — probar ambos sentidos de la guarda.
-- ---------------------------------------------------------------------