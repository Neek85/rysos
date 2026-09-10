# Plan — Motor de Pre-Validación Satelital: ANP + deforestación real

Ver `specs/motor_prevalidacion_satelital_anp_bosque.md` para el diseño y
las correcciones de premisa (en particular: partir de la versión de
agosto 22 de `fn_validar_topologia_eudr`, no la de agosto 20, y no
duplicar `scripts/ingest_forest_cover.py`).

1. `supabase/migrations/20260909000000_anp_y_deforestacion_real.sql`:
   `EUDR_AREAS_PROTEGIDAS` + índice GiST + RLS; `CREATE TABLE IF NOT
   EXISTS EUDR_COBERTURA_BOSCOSA_2020` (por si la de agosto sigue sin
   aplicarse); `fn_evaluar_deforestacion_eudr`/`fn_evaluar_anp_eudr`;
   `CREATE OR REPLACE FUNCTION fn_validar_topologia_eudr` sobre la base de
   agosto 22 (con `contenido_en_parcela_propia`).
2. `scripts/ingest_anp_layer.py`: nuevo, mismo patrón que
   `scripts/ingest_forest_cover.py` (GeoPandas, reproyección 4326,
   `ST_MakeValid`, lotes, Service Role Key desde env), idempotente por
   `dataset_version`.
3. `scripts/ingest_forest_cover.py`: agrega la misma idempotencia por
   `dataset_version` (no se duplica el script).
4. `lib/qcTopologyValidation.js`: `describeAnpBadge`.
5. `app/dashboard/qc/components/QcDetailEditor.jsx`: badge de ANP junto
   al de deforestación.
6. `tests/test_motor_prevalidacion_satelital_anp_bosque.py`
   (`@NEEDS_SUPABASE`, skip si la migración no está aplicada — mismo
   patrón que `tests/test_fn_validar_codigo_parcela_unico_found.py`).
7. Correr los tests + `node --test tests/*.mjs` + `npm run build`.
8. Commit `feat(gis): motor real de anp y deforestacion linea base eudr conectado a fn_validar_topologia_eudr`, push a `staging`.
