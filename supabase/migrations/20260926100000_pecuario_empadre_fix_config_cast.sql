-- =====================================================================
-- RYZOS · Pecuario Cuyes · Hotfix: cast de ORGANIZACIONES."Config" en
-- trg_historial_macho_validar
-- Fecha: 2026-09-26
--
-- BUG (confirmado, ver AI_STATE.md y docs/schema_live_pecuario.md v13):
-- 20260926090000_pecuario_empadre_asignacion_macho.sql (ya aplicada en
-- producción antes de esta migración) usa
-- "Config"->'pecuario'->>'sistema_cria' dentro de
-- trg_historial_macho_validar. ORGANIZACIONES."Config" es `text`, no
-- `jsonb` -- confirmado dos veces por catálogo
-- (information_schema.columns y pg_attribute/pg_type). El operador
-- `->` no existe para `text`, así que Postgres tira
-- `ERROR 42883: operator does not exist: text -> unknown` en TODO
-- insert a PECUARIO_HISTORIAL_MACHOS que llegue a esa línea --
-- "Asignar macho a jaula" quedó roto en producción para todas las
-- organizaciones, en cualquier modo (continuo o controlado).
--
-- DECISIÓN (Neyser, 2026-09-26): cast puntual y mínimo en el trigger,
-- no un ALTER de la columna -- de las 2 opciones planteadas
-- (cast puntual vs. corregir el tipo real de la columna a nivel de
-- esquema, que también arreglaría de raíz lib/actions/qcActions.js::
-- resolveRadioContextoM, que ya asumía Config como objeto sin que
-- nadie lo notara porque JS no revienta con optional chaining sobre un
-- string), se eligió la de menor alcance. La columna sigue siendo
-- `text` después de este hotfix -- ese hallazgo más amplio queda
-- señalado, no resuelto acá.
--
-- Seguridad del cast confirmada antes de escribir esto (lectura, no
-- destructivo): las 3 organizaciones reales existentes hoy tienen
-- "Config" IS NULL -- `NULL::text::jsonb` es NULL, sin excepción. Si en
-- el futuro alguna organización llega a tener un valor de Config que
-- no sea JSON válido, este cast fallaría en tiempo de inserción para
-- esa fila -- riesgo aceptado explícitamente al elegir la opción
-- mínima en vez de corregir el tipo de columna.
--
-- CREATE OR REPLACE FUNCTION -- reemplaza el cuerpo completo de la
-- función, sin tocar la firma ni el trigger que ya la referencia
-- (mismo patrón que cualquier otra migración de este repo que
-- reemplaza una función existente). Nada más cambia respecto a
-- 20260926090000 -- ni nombres de columnas, ni otros triggers, ni la
-- tabla/vista nuevas.
--
-- Aditiva. Idempotente.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_historial_macho_validar') THEN
    RAISE EXCEPTION 'Falta public.trg_historial_macho_validar() (20260926090000_pecuario_empadre_asignacion_macho.sql). Corré primero esa migración -- este hotfix la reemplaza (CREATE OR REPLACE) y depende de que ya exista.';
  END IF;
END $$;

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

  -- HOTFIX 2026-09-26: "Config" es `text`, no `jsonb` -- cast explícito
  -- antes de usar el operador `->` (ver cabecera de este archivo).
  SELECT COALESCE(("Config")::jsonb->'pecuario'->>'sistema_cria', 'continuo') INTO v_sistema_cria
    FROM public."ORGANIZACIONES" WHERE "ID" = NEW."ID_Organizacion";
  IF v_sistema_cria = 'controlado' AND NEW.fecha_salida IS NULL THEN
    RAISE EXCEPTION 'La organización % usa empadre controlado: fecha_salida es obligatoria al asignar un macho.', NEW."ID_Organizacion";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- Con un macho y una jaula reales de GRANJA-VALENCIA (Config IS NULL
-- hoy, confirmado):
--   INSERT INTO "PECUARIO_HISTORIAL_MACHOS" ("ID_Organizacion", macho_id, jaula_id)
--   VALUES ('GRANJA-VALENCIA', '<macho_id real>', '<jaula_id real>');
-- Antes de este hotfix fallaba con "operator does not exist: text -> unknown"
-- en TODO insert legítimo -- después de este hotfix debe insertar sin error.
-- ---------------------------------------------------------------------
