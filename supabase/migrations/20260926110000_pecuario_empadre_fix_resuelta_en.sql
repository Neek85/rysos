-- =====================================================================
-- RYZOS · Pecuario Cuyes · Hotfix #2: auto-completar resuelta_en al
-- resolver un retiro pendiente de macho
-- Fecha: 2026-09-26
--
-- BUG (confirmado con un UPDATE real, ver AI_STATE.md): 20260926090000
-- agrega `CHECK chk_retiros_macho_resuelta_coherente
-- ((NOT resuelta AND resuelta_en IS NULL) OR (resuelta AND resuelta_en
-- IS NOT NULL))` en PECUARIO_RETIROS_MACHO_PENDIENTES, pero nada en esa
-- migración pone `resuelta_en` cuando `resuelta` pasa a `true` --
-- `trg_resolver_retiro_macho_pendiente` es AFTER UPDATE (corre después
-- de que el CHECK ya evaluó la fila nueva) y de todos modos nunca toca
-- ese campo en su cuerpo. Resultado: todo `UPDATE ... SET resuelta =
-- true` que no mande `resuelta_en` a mano ("Marcar hecho" real, sin
-- que el cliente calcule esa fecha) viola el CHECK y falla con
-- `23514`. No hay precedente de este patrón resuelta/resuelta_en en
-- ningún otro archivo del repo -- es la primera vez que aparece.
--
-- DECISIÓN (Neyser, 2026-09-26): trigger BEFORE UPDATE nuevo que
-- calcula `resuelta_en` server-side -- mismo criterio "nunca confiar
-- en el cliente para un campo calculado" que ya usa el resto de este
-- esquema (ej. `cantidad_incluida` en
-- 20260925090000_pecuario_destete_recoleccion.sql). Simétrico en
-- ambas direcciones (aunque hoy no hay ningún flujo real que revierta
-- `resuelta` a `false`, se cubre para que el CHECK nunca pueda
-- romperse desde este trigger): al pasar a `true` pone `now()`; al
-- volver a `false` lo limpia a `NULL`.
--
-- No modifica 20260926090000/20260926100000 -- trigger nuevo, aparte,
-- sobre la misma tabla. `trg_resolver_retiro_macho_pendiente` (AFTER
-- UPDATE, ya existente) no se toca -- sigue disparando con el mismo
-- WHEN, sin depender de este trigger nuevo.
--
-- Aditiva. Idempotente.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_RETIROS_MACHO_PENDIENTES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_RETIROS_MACHO_PENDIENTES (20260926090000...). Corré primero esa migración.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_retiro_macho_resuelta_en()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.resuelta AND NOT OLD.resuelta THEN
    NEW.resuelta_en := now();
  ELSIF NOT NEW.resuelta AND OLD.resuelta THEN
    NEW.resuelta_en := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_retiro_macho_resuelta_en ON public."PECUARIO_RETIROS_MACHO_PENDIENTES";
CREATE TRIGGER trg_retiro_macho_resuelta_en
  BEFORE UPDATE ON public."PECUARIO_RETIROS_MACHO_PENDIENTES"
  FOR EACH ROW
  WHEN (NEW.resuelta IS DISTINCT FROM OLD.resuelta)
  EXECUTE FUNCTION public.trg_retiro_macho_resuelta_en();

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- Con una fila real de PECUARIO_RETIROS_MACHO_PENDIENTES (resuelta=false):
--   UPDATE "PECUARIO_RETIROS_MACHO_PENDIENTES" SET resuelta = true WHERE id = '<id>';
-- Antes de este hotfix fallaba con
-- "violates check constraint chk_retiros_macho_resuelta_coherente" --
-- después de este hotfix debe actualizar sin error, con resuelta_en =
-- el momento del UPDATE.
-- ---------------------------------------------------------------------
