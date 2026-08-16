# SPEC: Despliegue e Infraestructura a Staging / Supabase Live (Opción A)

## 1. Objetivo
Elevar los scripts validados a una instancia viva en Supabase (Staging), garantizando aislamiento RLS, seguridad air-gapped en buckets de almacenamiento y ejecución automatizada de la suite de tests mediante GitHub Actions en cada push o pull request hacia `main`/`master`.

## 2. Invariantes de Infraestructura
- **Idempotencia de Migraciones:** Toda política RLS aplicada debe usar `DROP POLICY IF EXISTS` (ya garantizado en `20260815_fix_rls_policies.sql`).
- **Acceso Air-Gapped en Buckets:** Los buckets `evidence-photos`, `evidencias_eudr` y `dossier-pdfs` deben ser privados (`public = false`), requiriendo Signed URLs para su visualización.
- **Integración Continua:** Ningún cambio puede fusionarse a `main`/`master` sin que la suite completa de tests sea aprobada en GitHub Actions.
- **Secrets en CI:** Las credenciales de Supabase se inyectan exclusivamente como GitHub Secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) — nunca hardcodeadas en el repositorio.

## 3. Criterios de Aceptación
- [ ] `.github/workflows/test_and_deploy.yml` ejecuta `pytest tests/` en cada `push`/`PR` a `main`.
- [ ] `scripts/verify_staging_health.py` reporta el estado de las variables de entorno y buckets requeridos.
- [ ] `requirements.txt` declara todas las dependencias para reproducibilidad en CI y entornos locales.
- [ ] `python -m pytest tests/ -v` pasa localmente sin errores previo al push.
