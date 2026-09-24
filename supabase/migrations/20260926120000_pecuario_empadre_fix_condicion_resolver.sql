-- =====================================================================
-- RYZOS · Pecuario Cuyes · Hotfix #3: condición correcta para cerrar
-- el historial al resolver un retiro pendiente de macho
-- Fecha: 2026-09-26
--
-- BUG (confirmado con una prueba manual completa, ver AI_STATE.md):
-- `trg_resolver_retiro_macho_pendiente` (20260926090000) decide si
-- cerrar de verdad `PECUARIO_HISTORIAL_MACHOS` con
-- `IF v_fecha_salida_actual IS NULL THEN ...`. Pero un
-- `PECUARIO_RETIROS_MACHO_PENDIENTES` solo se crea cuando
-- `NEW.fecha_salida IS NOT NULL` al insertar
-- (`trg_historial_macho_efectos`, punto (c)) -- así que para
-- CUALQUIER fila con un pendiente asociado, `fecha_salida` nunca puede
-- ser `NULL` en el momento de resolver. La condición es código muerto:
-- siempre toma la rama implícita de "no hacer nada" -- "Marcar hecho"
-- devuelve `200 OK` pero no cierra `fecha_salida` a `CURRENT_DATE` ni
-- limpia `PECUARIO_REPRODUCTORES.jaula_actual_id`. El macho queda
-- registrado en esa jaula para siempre, en silencio (sin ningún error
-- visible -- el más grave de los 3 hallazgos de esta migración,
-- justamente porque no truena).
--
-- CAUSA RAÍZ: la intención real del `IF` era distinguir "todavía
-- activo, nadie lo reasignó" de "ya reasignado antes de resolver el
-- pendiente" (`trg_historial_macho_efectos` punto (a) sobrescribe
-- `fecha_salida` con la `fecha_entrada` del nuevo insert cuando
-- reasignan el macho). La señal correcta para esa distinción no es
-- "`fecha_salida IS NULL`" (nunca aplica), sino comparar el
-- `fecha_salida` ACTUAL contra `fecha_retiro_planificada` -- la copia
-- que `PECUARIO_RETIROS_MACHO_PENDIENTES` guarda al crearse el
-- pendiente (`trg_historial_macho_efectos`, mismo punto (c)): si
-- siguen siendo iguales, nadie lo tocó desde entonces → cerrar de
-- verdad ahora; si ya son distintas, es porque ya se sobrescribió por
-- una reasignación → no tocar nada, solo resolver el pendiente (mismo
-- comportamiento ya correcto hoy para ese caso, sin cambios).
--
-- DECISIÓN (Neyser, 2026-09-26): cambiar solo la condición del `IF`,
-- mismo cuerpo de las 2 ramas ya escrito. No modifica
-- 20260926090000/20260926100000/20260926110000.
--
-- Aditiva. Idempotente.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_resolver_retiro_macho_pendiente') THEN
    RAISE EXCEPTION 'Falta public.trg_resolver_retiro_macho_pendiente() (20260926090000...). Corré primero esa migración -- este hotfix la reemplaza (CREATE OR REPLACE) y depende de que ya exista.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_resolver_retiro_macho_pendiente()
RETURNS TRIGGER AS $$
DECLARE
  v_fecha_salida_actual DATE;
BEGIN
  SELECT fecha_salida INTO v_fecha_salida_actual
    FROM public."PECUARIO_HISTORIAL_MACHOS" WHERE id = NEW.historial_macho_id;

  -- HOTFIX 2026-09-26: comparar contra fecha_retiro_planificada, no
  -- contra NULL (ver cabecera de este archivo) -- "sigue igual a como
  -- se creó el pendiente" es la señal real de "nadie lo reasignó".
  IF v_fecha_salida_actual = NEW.fecha_retiro_planificada THEN
    -- El macho sigue de verdad en esa jaula (no fue reasignado antes de
    -- que alguien marcara "hecho") -- se retira de verdad ahora.
    UPDATE public."PECUARIO_HISTORIAL_MACHOS"
      SET fecha_salida = CURRENT_DATE
      WHERE id = NEW.historial_macho_id;

    UPDATE public."PECUARIO_REPRODUCTORES"
      SET jaula_actual_id = NULL
      WHERE id = NEW.macho_id AND jaula_actual_id = NEW.jaula_id;
  END IF;
  -- Si v_fecha_salida_actual ya no coincide con fecha_retiro_planificada,
  -- el macho fue reasignado a otra jaula antes de resolver este
  -- pendiente -- no se toca nada de
  -- PECUARIO_HISTORIAL_MACHOS/PECUARIO_REPRODUCTORES, solo queda
  -- resuelto el pendiente (spec §6.3: "no se toca la jaula").

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- Con un macho y una jaula reales de GRANJA-VALENCIA:
--   1. INSERT en PECUARIO_HISTORIAL_MACHOS con fecha_salida = hoy+10.
--   2. UPDATE el pendiente creado SET resuelta = true.
-- Antes de este hotfix, PECUARIO_HISTORIAL_MACHOS.fecha_salida seguía
-- en hoy+10 y PECUARIO_REPRODUCTORES.jaula_actual_id seguía apuntando
-- a esa jaula (silencioso, sin error) -- después de este hotfix,
-- fecha_salida debe quedar en hoy y jaula_actual_id debe quedar NULL.
-- ---------------------------------------------------------------------
