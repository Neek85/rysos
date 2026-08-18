# Plan de Ejecución — Reingeniería GIS Core

Ver spec: `specs/gis_core_reengineering.md`.

## Pasos

1. **Auditoría previa (hecha antes de escribir código):**
   - Confirmar que no existe `CLAUDE.md` ni `docs/schema_live.md` en el repo.
   - Confirmar que `package.json` no tiene script `sync-schema` (solo
     `dev`/`build`/`start`/`lint`).
   - Confirmar contra `supabase/migrations/*.sql` que no hay ningún
     `CREATE INDEX ... USING GIST` existente — hallazgo real que motiva el punto
     4 de la tarea original.
   - Leer `20260816_fase2_vistas_qc.sql` y `20260815_fase1_security_storage.sql`
     para confirmar nombres reales de columnas de geometría por tabla
     (`geom_inspeccion` en `EUDR_MONITOREO`, `geom` en `EUDR_USO_SUELO` y
     `EUDR_INSTALACIONES`).

2. **Migración SQL** (`supabase/migrations/20260818_gis_core_sanitization.sql`):
   - Funciones `fn_sanitize_geometry` y `fn_calcular_area_ha`.
   - `ALTER TABLE ADD COLUMN IF NOT EXISTS` para `area_calculada_ha` /
     `requiere_revision_area` en las 3 tablas.
   - Triggers `BEFORE INSERT OR UPDATE OF <col>` por tabla.
   - Índices GiST + índice `ID_Organizacion` por tabla.
   - Todo envuelto en `BEGIN;`/`COMMIT;`, siguiendo el patrón de migraciones
     previas del proyecto.

3. **Documentar despliegue** (no ejecutar en vivo — sin credenciales en este
   entorno): dejar instrucciones explícitas en la migración y en el resumen de
   la tarea de que debe aplicarse manualmente en el SQL Editor de la instancia
   `jhtocgxlozfuzullrtol`, igual que las migraciones anteriores
   (`20260815_*`, `20260816_*`, `20260817_*`, `20260818_fix_inspecciones_rls.sql`).

4. **`docs/schema_live.md`**: snapshot manual del schema actual (tablas, vistas,
   funciones, triggers, políticas RLS, índices) derivado de leer todas las
   migraciones existentes — no un script automático, no existía antes.

5. **Tests** (`tests/test_gis_core_sanitization.py`):
   - Tests estáticos (sin credenciales, corren siempre): verifican que el
     archivo de migración existe y contiene los patrones de idempotencia
     esperados (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`,
     `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), que NO contiene
     ningún `RAISE EXCEPTION` atado a área (decisión de diseño: flag, no
     bloqueo), y que los 3 índices GiST y las 3 columnas de flag están
     presentes para las 3 tablas.
   - Tests funcionales contra Supabase Live (`@NEEDS_SUPABASE`, se saltan sin
     `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, mismo patrón que
     `tests/test_fase1_sdd.py`): validan AC1–AC5 de la spec insertando
     geometrías de prueba reales.

6. **Correr suite completa** (`python -m pytest tests/ -v`) con la ruta absoluta
   de Python del proyecto y reportar conteo de passing/skipped.

7. **Commit a `main`** (sin push — no solicitado explícitamente en esta tarea).
