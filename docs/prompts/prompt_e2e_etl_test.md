# Prompt: E2E Pipeline de Ingesta ETL — Tarea 7.5

**Fecha:** 2026-08-16
**Artefactos generados:** `scripts/run_e2e_etl_test.py`, `tests/test_e2e_etl_drive.py`

## Contexto del Proyecto
System RYZOS (Next.js / Supabase PostGIS / Python)

## Objetivo de la tarea
Ejecutar la prueba End-to-End (E2E) del Pipeline de Ingesta ETL de la Tarea 7.5 creando las carpetas de Inbox/Archive, colocando un archivo `.zip` de inspección (con GeoPackage/GeoJSON y fotos en `/DCIM/`), y verificando la ingesta real hacia Supabase PostGIS (tabla `EUDR_MONITOREO`), el bucket `evidencias_eudr` de Supabase Storage y el traslado/renombrado del zip a `/RYZOS_ARCHIVE/`.

## Instrucciones paso a paso para el repositorio local

1. Asegúrate de estar posicionado en la raíz del proyecto local (`C:\EcosistemaSAAS\rysos`).
2. Crear un script de ejecución y verificación End-to-End en `scripts/run_e2e_etl_test.py` que:
   - Cree la estructura de carpetas local si no existe:
     - `temp_drive/RYZOS_INBOX/ORG-COOP-NORTE/`
     - `temp_drive/RYZOS_ARCHIVE/ORG-COOP-NORTE/`
   - Genere o reciba un paquete `.zip` de prueba (`monitoreo_campo_e2e.zip`) en la carpeta `RYZOS_INBOX/ORG-COOP-NORTE/` conteniendo un polígono espacial y una imagen en `/DCIM/foto_campo_01.jpg`.
   - Invoque la clase `DriveZipETLPipeline` de `scripts/etl_drive_to_supabase.py` pasándole las rutas de Inbox y Archive.
   - Verifique los 3 criterios de éxito del E2E:
     1. El archivo `.zip` fue movido y renombrado como `PROCESADO_YYYYMMDD_HHMMSS_monitoreo_campo_e2e.zip` dentro de `temp_drive/RYZOS_ARCHIVE/ORG-COOP-NORTE/`.
     2. Las fotos fueron extraídas e identificadas para el bucket `evidencias_eudr`.
     3. Las geometrías resultantes quedaron reproyectadas a WGS84 (EPSG:4326) con `estado_revision = 'PENDIENTE'`.
3. Crear el runner de prueba en `tests/test_e2e_etl_drive.py` y ejecutar:
   ```
   python -m pytest tests/test_e2e_etl_drive.py -v
   ```
4. Realizar commit y push a la rama `main` en GitHub:
   ```
   git add .
   git commit -m "test: E2E Drive to Supabase ETL pipeline verification script and tests"
   git push origin main
   ```

## Código / Archivos a crear o modificar
- `scripts/run_e2e_etl_test.py`
- `tests/test_e2e_etl_drive.py`
- `docs/prompts/prompt_e2e_etl_test.md`

## Notas de implementación
- `DriveZipETLPipeline` (Tarea 7.5) usa por defecto las carpetas `INBOX`/`ARCHIVE`. Este escenario E2E usa la convención `RYZOS_INBOX`/`RYZOS_ARCHIVE`; `scripts/run_e2e_etl_test.py::build_pipeline` sobreescribe `pipeline.inbox_dir` / `pipeline.archive_dir` tras la construcción, sin modificar `scripts/etl_drive_to_supabase.py`.
- El entorno local no tiene configuradas `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (credenciales *server-side*; solo existen las `NEXT_PUBLIC_*` para el frontend). Por esto:
  - El runner standalone (`python -m scripts.run_e2e_etl_test`) corre en **modo simulado** (cliente Supabase mockeado), dejando claramente impreso el aviso.
  - `tests/test_e2e_etl_drive.py` incluye una clase `TestE2ELiveSupabase` que ejecuta la ingesta real solo cuando ambas variables de entorno están presentes (`unittest.skipUnless`); en su ausencia se reporta como *skipped*, no como fallo.
- `temp_drive/` se agregó a `.gitignore` — contiene artefactos generados localmente por el runner standalone y no debe versionarse.
