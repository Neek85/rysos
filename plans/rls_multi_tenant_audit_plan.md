# Plan de Ejecución — Auditoría RLS Multi-Tenant

Ver spec: `specs/rls_multi_tenant_audit.md`.

## Pasos

1. **Auditoría (hecha antes de escribir SQL):**
   - Confirmar que no existen tablas "pecuarias" (búsqueda exhaustiva en el
     repo).
   - Confirmar contra `specs/fase6_inspecciones_socioeconomicas.md` que
     `CAP_*` no tiene `ID_Organizacion` propia.
   - Confirmar contra `20260816_fase3_seguridad_rls.sql` el alcance exacto ya
     cubierto (qué tablas, qué políticas, qué función helper).
   - Confirmar contra `20260818_fix_inspecciones_rls.sql` por qué
     `INSPECCIONES`/`CAP_*`/lectura de padrón para `anon` deben quedar fuera.
   - Auditar cada vista consumida por el frontend en busca de columnas PII
     sin filtro de tenant — encontró `view_eudr_dashboard_aprobados`
     (hallazgo no solicitado, confirmado y aprobado por el usuario para
     corregir en esta misma migración).
   - Confirmar contra `app/page.jsx` que remover `socio_dni`/
     `socio_nombre_completo` de esa vista no rompe ningún consumidor real
     (el componente ni siquiera selecciona esas columnas).

2. **Migración SQL** (`supabase/migrations/20260818_rls_multi_tenant_fortification.sql`):
   - Re-asertar (idempotente) RLS + políticas `SELECT`/`FOR ALL` de
     `ORGANIZACIONES`/`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`
     usando `public.auth_org_id()` — mismo alcance que Tarea 9.1, sin
     endurecer ni aflojar nada.
   - Corregir `view_eudr_dashboard_aprobados`: `DROP VIEW` + `CREATE VIEW`
     sin `socio_dni`/`socio_nombre_completo`, con filtro
     `"ID_Organizacion" = public.auth_org_id() OR ...` en el `WHERE`.
   - No tocar `INSPECCIONES`/`CAP_*`/políticas `anon` de `PADRON_*`.

3. **Tests** (`tests/test_rls_multi_tenant.py`):
   - Estáticos: cada tabla core/agrícola/socioeconómica declarada en
     `docs/schema_live.md` tiene `ENABLE ROW LEVEL SECURITY` en algún punto
     del historial de migraciones.
   - Estáticos: las 4 tablas fortificadas tienen política `SELECT` con
     `auth_org_id()` en la migración nueva; `ORGANIZACIONES` no tiene
     política de escritura (asimetría preservada).
   - Estáticos: `view_eudr_dashboard_aprobados` en la migración nueva NO
     contiene `socio_dni` ni `socio_nombre_completo`, y SÍ contiene un filtro
     por `ID_Organizacion`.
   - Estáticos: ninguna política nueva referencia `ID_Organizacion` sobre las
     6 tablas `CAP_*` (que no la tienen).

4. **Correr suite completa**, reportar conteo real de passing/skipped (no
   asumir un número fijo).

5. **Actualizar `docs/schema_live.md`**: documentar la re-certificación de
   políticas, el fix de PII/tenant en `view_eudr_dashboard_aprobados`, y
   formalizar la sección de "riesgo aceptado por diseño" para las 9 tablas
   anon-dependientes.

6. **Commit a `main`** (sin push).
