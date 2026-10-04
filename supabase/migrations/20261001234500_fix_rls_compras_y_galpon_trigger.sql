-- Migración: Cierra el gap de RLS en Compras + agrega galpon_id a las
-- entradas de stock que genera automáticamente una compra de tipo insumo.
--
-- Hallazgo original: Claude Code CLI, recon de la pantalla Compras (punto
-- 7 del roadmap, tercera y última de 3 pantallas, tras Sanidad e Insumos).
-- Revisión de seguridad: Claude (Cowork), Arquitecto Senior RYZOS — gate
-- de la Sección 4.1.2, cubierto en el mismo flujo.
--
-- Problema de RLS: PECUARIO_COMPRAS tenía una única política ALL filtrada
-- solo por ID_Organizacion, sin distinguir rol — mismo patrón ya
-- corregido en Sanidad e Insumos. Cualquier usuario autenticado de la
-- organización (incluido auditor_qc) podía crear, editar o borrar
-- compras, que son datos de costos y proveedores.
--
-- Decisión de negocio confirmada con Neyser: solo admin puede
-- INSERT/UPDATE/DELETE. SELECT abierto a los 3 roles de la organización
-- (admin, tecnico_campo, auditor_qc — el auditor necesita verlas para su
-- trabajo). El INSERT/UPDATE valida además que insumo_id y galpon_id
-- (cuando se especifican) pertenezcan a la misma organización — gap
-- preexistente que Insumos ya había dejado documentado sin cerrar para
-- esta tabla específicamente, cerrado acá de una vez con la nueva policy.
--
-- Problema de esquema: el trigger trg_compra_genera_entrada_insumo (AFTER
-- INSERT, FOR EACH ROW) no copiaba NEW.galpon_id a la entrada de stock que
-- genera — la columna no existía cuando se escribió el trigger original.
-- Cuerpo real confirmado contra pg_get_functiondef antes de corregirlo
-- (ver sección 2 más abajo).
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE POLICY,
-- CREATE OR REPLACE FUNCTION para el trigger.
-- Plan de reversión:
--   1. Recrear la política original rls_all_pecuario_compras (ALL, sin
--      distinción de rol) con el texto citado en el comentario "Problema
--      de RLS" de arriba.
--   2. CREATE OR REPLACE FUNCTION fn_compra_genera_entrada_insumo con el
--      cuerpo original (sin galpon_id en el INSERT), confirmado contra
--      pg_get_functiondef el 2026-10-04, citado íntegro en la sección 2.
--
-- Corrección aplicada antes de cualquier commit (hallada por la CLI en su
-- propia relectura, probada empíricamente contra PERFILES_USUARIO_INTERNOS
-- y PECUARIO_GALPONES antes de aceptar el fix): dentro de un EXISTS
-- correlacionado en dos cláusulas WITH CHECK, la referencia sin calificar
-- "ID_Organizacion" resuelve contra la tabla del subquery (i/g), no contra
-- la fila externa de PECUARIO_COMPRAS, dejando la validación cruzada de
-- organización como una tautología siempre verdadera. Se calificó la fila
-- externa explícitamente como "PECUARIO_COMPRAS"."ID_Organizacion" en las
-- 4 ocurrencias (INSERT y UPDATE, insumo_id y galpon_id).

-- ============================================================
-- 1. PECUARIO_COMPRAS (solo admin escribe, los 3 roles leen)
-- ============================================================

DROP POLICY IF EXISTS "rls_all_pecuario_compras" ON "PECUARIO_COMPRAS";

DROP POLICY IF EXISTS "rls_select_pecuario_compras" ON "PECUARIO_COMPRAS";
CREATE POLICY "rls_select_pecuario_compras"
  ON "PECUARIO_COMPRAS"
  FOR SELECT
  TO authenticated
  USING (
    "ID_Organizacion" = auth_org_id()
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_insert_pecuario_compras" ON "PECUARIO_COMPRAS";
CREATE POLICY "rls_insert_pecuario_compras"
  ON "PECUARIO_COMPRAS"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      "ID_Organizacion" = auth_org_id()
      AND auth_role() = 'admin'
      AND (insumo_id IS NULL OR EXISTS (
        SELECT 1 FROM "PECUARIO_INSUMOS" i
        WHERE i.id = insumo_id AND i."ID_Organizacion" = "PECUARIO_COMPRAS"."ID_Organizacion"
      ))
      AND (galpon_id IS NULL OR EXISTS (
        SELECT 1 FROM "PECUARIO_GALPONES" g
        WHERE g.id = galpon_id AND g."ID_Organizacion" = "PECUARIO_COMPRAS"."ID_Organizacion"
      ))
    )
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_update_pecuario_compras" ON "PECUARIO_COMPRAS";
CREATE POLICY "rls_update_pecuario_compras"
  ON "PECUARIO_COMPRAS"
  FOR UPDATE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  )
  WITH CHECK (
    (
      "ID_Organizacion" = auth_org_id()
      AND auth_role() = 'admin'
      AND (insumo_id IS NULL OR EXISTS (
        SELECT 1 FROM "PECUARIO_INSUMOS" i
        WHERE i.id = insumo_id AND i."ID_Organizacion" = "PECUARIO_COMPRAS"."ID_Organizacion"
      ))
      AND (galpon_id IS NULL OR EXISTS (
        SELECT 1 FROM "PECUARIO_GALPONES" g
        WHERE g.id = galpon_id AND g."ID_Organizacion" = "PECUARIO_COMPRAS"."ID_Organizacion"
      ))
    )
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_delete_pecuario_compras" ON "PECUARIO_COMPRAS";
CREATE POLICY "rls_delete_pecuario_compras"
  ON "PECUARIO_COMPRAS"
  FOR DELETE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

-- ============================================================
-- 2. Trigger: copiar galpon_id en la entrada automática de stock
-- ============================================================
-- Cuerpo original confirmado contra pg_get_functiondef antes de escribir
-- esto (no se redactó de memoria). Único cambio: se agrega galpon_id a
-- la lista de columnas y NEW.galpon_id a los valores del INSERT — nada
-- más se toca, incluido el literal exacto del texto de observaciones.
-- NEW.galpon_id es NOT NULL en la rama insumo (constraint
-- chk_compras_rama_por_concepto), así que se copia sin condición.
-- El trigger solo dispara en AFTER INSERT (no UPDATE/DELETE), así que
-- editar o borrar una compra después no corrige ni revierte la entrada
-- generada — comportamiento preexistente, sin cambios acá. Sin backfill
-- necesario: 0 compras existentes hoy.

CREATE OR REPLACE FUNCTION public.fn_compra_genera_entrada_insumo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.concepto = 'insumo' THEN
    INSERT INTO public."PECUARIO_INSUMOS_MOVIMIENTOS"
      (id, "ID_Organizacion", insumo_id, tipo_movimiento, cantidad, fecha, galpon_id, observaciones, device_id, created_offline_at)
    VALUES
      (gen_random_uuid(), NEW."ID_Organizacion", NEW.insumo_id, 'entrada', NEW.cantidad, NEW.fecha, NEW.galpon_id,
       'Generado automáticamente por compra ' || NEW.id, NEW.device_id, NEW.created_offline_at);
  END IF;
  RETURN NEW;
END;
$function$
;
