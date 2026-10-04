-- Migración: cierra el gap de RLS en PECUARIO_SUGERENCIAS_REEMPLAZO —
-- punto 8 del roadmap de la app Granja Valencia (Reemplazo/descarte).
--
-- Hallazgo original: Claude Code CLI, recon de solo lectura (punto 8 del
-- roadmap, único pendiente de ese punto — la Consanguinidad ya quedó
-- resuelta dentro de Empadre y Alta de reproductor).
-- Revisión de seguridad: Claude (Cowork), Arquitecto Senior RYZOS — gate
-- de la Sección 4.1.2, cubierto en el mismo flujo (misma IA redacta y
-- revisa).
--
-- Problema de RLS: PECUARIO_SUGERENCIAS_REEMPLAZO tenía una única
-- política rls_all_pecuario_sugerencias_reemplazo, FOR ALL, filtrada solo
-- por ID_Organizacion, con TO public (no TO authenticated como el resto
-- de las tablas pecuarias — diferencia de patrón detectada en el recon,
-- inofensiva en la práctica porque auth_org_id() es NULL para anon, pero
-- corregida acá de paso). Mismo patrón "ALL sin distinguir rol" ya
-- encontrado y corregido en Sanidad, Insumos y Compras. Cualquier usuario
-- autenticado de la organización podía insertar, editar o borrar
-- sugerencias — incluido reasignar reproductor_id o motivo a una fila ya
-- existente, no solo cambiar su estado.
--
-- Decisión de negocio confirmada con Neyser (2026-10-04):
--   - SELECT: abierto a los 3 roles de la organización (admin,
--     tecnico_campo, auditor_qc) — el auditor necesita verlas.
--   - INSERT: admin + tecnico_campo. Las sugerencias las crea SIEMPRE el
--     trigger trg_partos_evaluar_sugerencia_reemplazo (AFTER INSERT ON
--     PECUARIO_PARTOS, no es SECURITY DEFINER, corre con los permisos de
--     quien registra el parto) — nunca un INSERT manual desde esta
--     pantalla. Como la pantalla de Partos la pueden usar admin y
--     tecnico_campo, el INSERT disparado por el trigger tiene que poder
--     pasar para esos mismos dos roles o se rompería el registro normal
--     de un parto.
--   - UPDATE: admin + tecnico_campo pueden confirmar/ignorar (decisión:
--     "el técnico" del propio mockup, misma lógica que Sanidad). La RLS
--     por sí sola no puede impedir que ese UPDATE cambie columnas que no
--     sean estado (una política no compara la fila vieja contra la
--     nueva en una sola expresión) — se agrega un trigger BEFORE UPDATE
--     dedicado (sección 2) para esa parte.
--   - DELETE: solo admin (consistente con el resto de tablas pecuarias,
--     sin caso de uso real desde la app para los otros roles).
--
-- Fuera de alcance deliberado: no se toca la RLS de PECUARIO_REPRODUCTORES.
-- El trigger trg_sugerencia_reemplazo_confirmar_descarte (AFTER UPDATE,
-- no SECURITY DEFINER) hace UPDATE PECUARIO_REPRODUCTORES SET
-- proposito='descarte' cuando se confirma una sugerencia — corre con los
-- permisos de quien confirma. Esa tabla sigue hoy con el patrón "ALL sin
-- distinguir rol" (nunca cerrado en ningún punto anterior del roadmap),
-- así que el UPDATE disparado por este flujo funciona igual para
-- tecnico_campo sin ningún cambio adicional acá. Cerrar la RLS de
-- PECUARIO_REPRODUCTORES, si se decide hacer, es una tarea aparte.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE POLICY,
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER, CREATE OR REPLACE FUNCTION.
-- Plan de reversión:
--   1. DROP las 4 políticas nuevas (sección 1) y recrear
--      rls_all_pecuario_sugerencias_reemplazo (FOR ALL, TO public,
--      USING ID_Organizacion = auth_org_id()) — texto citado en el
--      comentario "Problema de RLS" de arriba.
--   2. DROP TRIGGER trg_sugerencia_reemplazo_bloquear_cambio_campos y
--      DROP FUNCTION fn_sugerencia_reemplazo_bloquear_cambio_campos
--      (sección 2) — sin reemplazo, la tabla vuelve a permitir cambiar
--      cualquier columna en un UPDATE (sigue protegida por las políticas
--      de rol de la sección 1 si no se revierte el punto 1 también).

-- ============================================================
-- 1. RLS por rol (SELECT abierto, INSERT/UPDATE admin+tecnico_campo,
--    DELETE solo admin)
-- ============================================================

DROP POLICY IF EXISTS "rls_all_pecuario_sugerencias_reemplazo" ON "PECUARIO_SUGERENCIAS_REEMPLAZO";

DROP POLICY IF EXISTS "rls_select_pecuario_sugerencias_reemplazo" ON "PECUARIO_SUGERENCIAS_REEMPLAZO";
CREATE POLICY "rls_select_pecuario_sugerencias_reemplazo"
  ON "PECUARIO_SUGERENCIAS_REEMPLAZO"
  FOR SELECT
  TO authenticated
  USING (
    "ID_Organizacion" = auth_org_id()
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "rls_insert_pecuario_sugerencias_reemplazo" ON "PECUARIO_SUGERENCIAS_REEMPLAZO";
CREATE POLICY "rls_insert_pecuario_sugerencias_reemplazo"
  ON "PECUARIO_SUGERENCIAS_REEMPLAZO"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      "ID_Organizacion" = auth_org_id()
      AND auth_role() IN ('admin', 'tecnico_campo')
    )
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "rls_update_pecuario_sugerencias_reemplazo" ON "PECUARIO_SUGERENCIAS_REEMPLAZO";
CREATE POLICY "rls_update_pecuario_sugerencias_reemplazo"
  ON "PECUARIO_SUGERENCIAS_REEMPLAZO"
  FOR UPDATE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() IN ('admin', 'tecnico_campo'))
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    ("ID_Organizacion" = auth_org_id() AND auth_role() IN ('admin', 'tecnico_campo'))
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "rls_delete_pecuario_sugerencias_reemplazo" ON "PECUARIO_SUGERENCIAS_REEMPLAZO";
CREATE POLICY "rls_delete_pecuario_sugerencias_reemplazo"
  ON "PECUARIO_SUGERENCIAS_REEMPLAZO"
  FOR DELETE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
  );

-- ============================================================
-- 2. Trigger: un UPDATE solo puede tocar estado (nunca
--    reproductor_id/motivo/parto_id/detalle/ID_Organizacion/creada_en)
-- ============================================================
-- resuelta_en queda deliberadamente fuera de esta lista — la pone
-- trg_sugerencia_reemplazo_resuelta_en (BEFORE UPDATE ya existente, sin
-- tocar acá) cuando estado cambia. Bypass de service_role para
-- correcciones administrativas legítimas (scripts/migraciones futuras),
-- nunca CURRENT_USER = 'postgres' — este trigger no es SECURITY DEFINER,
-- así que CURRENT_USER ya refleja a quien realmente ejecuta el UPDATE,
-- pero se evita ese patrón de todos modos para no repetir la ambigüedad
-- que causó el incidente de Insumos (ver roadmap §2.17).

CREATE OR REPLACE FUNCTION fn_sugerencia_reemplazo_bloquear_cambio_campos()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.reproductor_id IS DISTINCT FROM OLD.reproductor_id
     OR NEW.motivo IS DISTINCT FROM OLD.motivo
     OR NEW.parto_id IS DISTINCT FROM OLD.parto_id
     OR NEW.detalle IS DISTINCT FROM OLD.detalle
     OR NEW."ID_Organizacion" IS DISTINCT FROM OLD."ID_Organizacion"
     OR NEW.creada_en IS DISTINCT FROM OLD.creada_en
  THEN
    RAISE EXCEPTION 'Solo se puede modificar el estado de una sugerencia de reemplazo, no sus demás columnas';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sugerencia_reemplazo_bloquear_cambio_campos ON "PECUARIO_SUGERENCIAS_REEMPLAZO";
CREATE TRIGGER trg_sugerencia_reemplazo_bloquear_cambio_campos
  BEFORE UPDATE ON "PECUARIO_SUGERENCIAS_REEMPLAZO"
  FOR EACH ROW
  EXECUTE FUNCTION fn_sugerencia_reemplazo_bloquear_cambio_campos();
