# PLAN DE EJECUCIÓN: Opción A - Paso a Staging & CI/CD

## 1. Pasos de Desarrollo
1. **Especificación e Invariantes** (`specs/opcion_a_despliegue_staging.md`): Requisitos de pipeline e infraestructura.
2. **`requirements.txt`**: Declara dependencias de Python para CI y reproducibilidad local.
3. **Workflow GitHub Actions** (`.github/workflows/test_and_deploy.yml`):
   - Job `test-suite` en `ubuntu-latest`.
   - Instala dependencias geoespaciales (`geopandas`, `shapely`) y de aplicación (`supabase`, `reportlab`, `qrcode[pil]`).
   - Ejecuta `pytest tests/ -v` y falla el pipeline si algún test falla.
4. **Script de Verificación** (`scripts/verify_staging_health.py`):
   - Comprueba presencia de `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
   - Si las credenciales están disponibles, verifica conectividad Supabase y existencia de buckets privados.
   - Imprime reporte de salud con estado `OK` / `PENDIENTE` por componente.
5. **Validación Local**: `python -m pytest tests/ -v` — debe pasar los 168 tests antes del push.

## 2. Secuencia de Despliegue a Supabase Live
1. Aplicar migración en SQL Editor: `supabase/migrations/20260815_fix_rls_policies.sql`.
2. Crear buckets privados: `evidencias_eudr`, `evidence-photos`, `dossier-pdfs`.
3. Configurar GitHub Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Push a `main` → GitHub Actions ejecuta la suite y despliega si todos los tests pasan.
5. Ejecutar `python scripts/verify_staging_health.py` para confirmar salud del entorno.
