-- Migración: Cierra el gap real de RLS en Sanidad (app móvil Granja Valencia)
-- Hallazgo original: Claude Code CLI, 2026-09-30, documentado en AI_STATE.md
-- y specs/app_granja_valencia_sanidad.md. Revisión de seguridad: Claude (Cowork),
-- Arquitecto Senior RYZOS, 2026-10-01 — gate de la Sección 4.1.2 del documento
-- maestro, cubierto en el mismo flujo (tarea redactada y revisada por Claude).
--
-- Problema: ambas tablas tenían una única política `ALL` que solo filtraba por
-- ID_Organizacion, sin distinguir rol. Cualquier usuario autenticado de la
-- organización (no solo admin) podía insertar/editar/borrar el catálogo de
-- actividades de sanidad, pese a que la UI oculta esa pantalla a no-admin
-- (una ocultación de interfaz no es una barrera de seguridad real).
--
-- Decisión de negocio confirmada con Neyser (2026-10-01):
--   - PECUARIO_ACTIVIDADES_SANIDAD (catálogo/config): solo admin puede
--     INSERT/UPDATE/DELETE. Mismo criterio que PECUARIO_CONFIGURACION.
--   - PECUARIO_SANIDAD_REGISTROS (ejecuciones en campo): admin y
--     tecnico_campo pueden INSERT (quien aplica la actividad en campo).
--     UPDATE/DELETE quedan reservados a admin (corrección de errores).
--   - SELECT abierto a cualquier rol autenticado de la organización en
--     ambas tablas (admin, tecnico_campo, auditor_qc) — necesario para que
--     el selector de "Registrar" lea el catálogo, y para que auditor_qc
--     pueda revisar el historial sin necesitar permisos de escritura.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE POLICY.
-- Plan de reversión: recrear la política original `rls_all_...` (ALL, sin
-- distinción de rol) con DROP POLICY IF EXISTS + CREATE POLICY de las 2
-- políticas que esta migración reemplaza, usando el texto citado en el
-- comentario "Problema" de arriba como referencia exacta de qué había antes.

-- ============================================================
-- PECUARIO_ACTIVIDADES_SANIDAD (catálogo — solo admin escribe)
-- ============================================================

DROP POLICY IF EXISTS "rls_all_pecuario_actividades_sanidad" ON "PECUARIO_ACTIVIDADES_SANIDAD";

DROP POLICY IF EXISTS "rls_select_pecuario_actividades_sanidad" ON "PECUARIO_ACTIVIDADES_SANIDAD";
CREATE POLICY "rls_select_pecuario_actividades_sanidad"
  ON "PECUARIO_ACTIVIDADES_SANIDAD"
  FOR SELECT
  TO authenticated
  USING (
    "ID_Organizacion" = auth_org_id()
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_insert_pecuario_actividades_sanidad" ON "PECUARIO_ACTIVIDADES_SANIDAD";
CREATE POLICY "rls_insert_pecuario_actividades_sanidad"
  ON "PECUARIO_ACTIVIDADES_SANIDAD"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_update_pecuario_actividades_sanidad" ON "PECUARIO_ACTIVIDADES_SANIDAD";
CREATE POLICY "rls_update_pecuario_actividades_sanidad"
  ON "PECUARIO_ACTIVIDADES_SANIDAD"
  FOR UPDATE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  )
  WITH CHECK (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_delete_pecuario_actividades_sanidad" ON "PECUARIO_ACTIVIDADES_SANIDAD";
CREATE POLICY "rls_delete_pecuario_actividades_sanidad"
  ON "PECUARIO_ACTIVIDADES_SANIDAD"
  FOR DELETE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

-- ============================================================
-- PECUARIO_SANIDAD_REGISTROS (admin + tecnico_campo insertan,
-- solo admin corrige/borra)
-- ============================================================

DROP POLICY IF EXISTS "rls_all_pecuario_sanidad_registros" ON "PECUARIO_SANIDAD_REGISTROS";

DROP POLICY IF EXISTS "rls_select_pecuario_sanidad_registros" ON "PECUARIO_SANIDAD_REGISTROS";
CREATE POLICY "rls_select_pecuario_sanidad_registros"
  ON "PECUARIO_SANIDAD_REGISTROS"
  FOR SELECT
  TO authenticated
  USING (
    "ID_Organizacion" = auth_org_id()
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_insert_pecuario_sanidad_registros" ON "PECUARIO_SANIDAD_REGISTROS";
CREATE POLICY "rls_insert_pecuario_sanidad_registros"
  ON "PECUARIO_SANIDAD_REGISTROS"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ("ID_Organizacion" = auth_org_id() AND auth_role() IN ('admin', 'tecnico_campo'))
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_update_pecuario_sanidad_registros" ON "PECUARIO_SANIDAD_REGISTROS";
CREATE POLICY "rls_update_pecuario_sanidad_registros"
  ON "PECUARIO_SANIDAD_REGISTROS"
  FOR UPDATE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  )
  WITH CHECK (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );

DROP POLICY IF EXISTS "rls_delete_pecuario_sanidad_registros" ON "PECUARIO_SANIDAD_REGISTROS";
CREATE POLICY "rls_delete_pecuario_sanidad_registros"
  ON "PECUARIO_SANIDAD_REGISTROS"
  FOR DELETE
  TO authenticated
  USING (
    ("ID_Organizacion" = auth_org_id() AND auth_role() = 'admin')
    OR auth.role() = 'service_role'
    OR CURRENT_USER = 'postgres'
  );
