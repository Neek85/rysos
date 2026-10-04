-- Migración: cierra el gap de RLS en PECUARIO_PARTOS — encontrado durante
-- el trabajo de Reemplazo/descarte (punto 8 del roadmap de la app Granja
-- Valencia), no una tarea planeada de antemano.
--
-- Hallazgo original: Claude Code CLI, recon de solo lectura (al cerrar
-- Reemplazo/descarte se detectó que un auditor_qc podía escribir en
-- PECUARIO_PARTOS, lo que haría fallar de forma confusa un parto que
-- dispara una sugerencia de reemplazo, ya restringida por rol).
-- Revisión de seguridad: Claude (Cowork), Arquitecto Senior RYZOS — gate
-- de la Sección 4.1.2, cubierto en el mismo flujo.
--
-- Problema de RLS: PECUARIO_PARTOS tenía una única política
-- rls_all_pecuario_partos, FOR ALL, TO authenticated, filtrada solo por
-- ID_Organizacion — mismo patrón "ALL sin distinguir rol" ya corregido en
-- Sanidad, Insumos, Compras y Sugerencias de reemplazo. Cualquier usuario
-- autenticado de la organización (incluido auditor_qc) podía insertar,
-- editar o borrar partos.
--
-- Decisión de negocio confirmada con Neyser (2026-10-04), mismo criterio
-- que Sugerencias de reemplazo:
--   - SELECT: abierto a los 3 roles de la organización.
--   - INSERT/UPDATE: admin + tecnico_campo (quien registra un parto en
--     campo). auditor_qc queda de solo lectura — cierra el caso real en
--     que auditor_qc podía antes escribir un parto y hacer fallar la
--     migración de Sugerencias de reemplazo (20261004120000) con un error
--     confuso en una tabla distinta a la que está mirando.
--   - DELETE: solo admin. Ya existe además una barrera de esquema previa
--     (el FK de PECUARIO_RECOLECCION_PARTOS.parto_id, ON DELETE RESTRICT
--     — nombre de constraint no confirmado, sin relevancia acá) que
--     impide borrar un parto ya recolectado en un destete — esta policy
--     no reemplaza esa barrera, se suma a ella.
--
-- Validación cruzada de organización en INSERT/UPDATE: poza_id (NOT NULL)
-- y macho_id (nullable) no se validaban contra la organización en ningún
-- lado — solo tenían la FK de existencia, sin comprobar que la poza o el
-- macho fueran de la misma organización que el parto. Se agrega acá,
-- calificando explícitamente la fila externa como
-- "PECUARIO_PARTOS"."ID_Organizacion" en los EXISTS — lección directa del
-- incidente de scoping de Compras (roadmap §2.18): una referencia sin
-- calificar dentro de un EXISTS correlacionado resuelve contra la tabla
-- del propio subquery, no contra la fila externa.
--
-- Deliberadamente NO se valida acá: madre_id — ya lo hace el trigger
-- existente trg_partos_validar_madre (BEFORE INSERT OR UPDATE, no
-- SECURITY DEFINER), que comprueba organización y sexo antes de que esta
-- policy se evalúe; duplicarlo en la policy sería redundante. Tampoco se
-- valida el sexo de macho_id (gap preexistente, no de RLS/organización —
-- fuera de alcance de esta migración, anotado en AI_STATE.md como
-- candidato a una tarea aparte).
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE POLICY.
-- Plan de reversión: DROP las 4 políticas nuevas y recrear
-- rls_all_pecuario_partos (FOR ALL, TO authenticated, USING/WITH CHECK
-- "ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role' OR
-- CURRENT_USER = 'postgres') — texto citado arriba, confirmado contra
-- pg_policies antes de escribir esta migración.

DROP POLICY IF EXISTS "rls_all_pecuario_partos" ON "PECUARIO_PARTOS";

DROP POLICY IF EXISTS "rls_select_pecuario_partos" ON "PECUARIO_PARTOS";
CREATE POLICY "rls_select_pecuario_partos"
  ON "PECUARIO_PARTOS"
  FOR SELECT
  TO authenticated
  USING (
    "ID_Organizacion" = auth_org_id()
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_insert_pecuario_partos" ON "PECUARIO_PARTOS";
CREATE POLICY "rls_insert_pecuario_partos"
  ON "PECUARIO_PARTOS"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      "ID_Organizacion" = auth_org_id()
      AND auth_role() IN ('admin', 'tecnico_campo')
      AND EXISTS (
        SELECT 1 FROM "PECUARIO_JAULAS" j
        WHERE j.id = poza_id AND j."ID_Organizacion" = "PECUARIO_PARTOS"."ID_Organizacion"
      )
      AND (macho_id IS NULL OR EXISTS (
        SELECT 1 FROM "PECUARIO_REPRODUCTORES" r
        WHERE r.id = macho_id AND r."ID_Organizacion" = "PECUARIO_PARTOS"."ID_Organizacion"
      ))
    )
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_update_pecuario_partos" ON "PECUARIO_PARTOS";
CREATE POLICY "rls_update_pecuario_partos"
  ON "PECUARIO_PARTOS"
  FOR UPDATE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() IN ('admin', 'tecnico_campo'))
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  )
  WITH CHECK (
    (
      "ID_Organizacion" = auth_org_id()
      AND auth_role() IN ('admin', 'tecnico_campo')
      AND EXISTS (
        SELECT 1 FROM "PECUARIO_JAULAS" j
        WHERE j.id = poza_id AND j."ID_Organizacion" = "PECUARIO_PARTOS"."ID_Organizacion"
      )
      AND (macho_id IS NULL OR EXISTS (
        SELECT 1 FROM "PECUARIO_REPRODUCTORES" r
        WHERE r.id = macho_id AND r."ID_Organizacion" = "PECUARIO_PARTOS"."ID_Organizacion"
      ))
    )
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_delete_pecuario_partos" ON "PECUARIO_PARTOS";
CREATE POLICY "rls_delete_pecuario_partos"
  ON "PECUARIO_PARTOS"
  FOR DELETE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );
