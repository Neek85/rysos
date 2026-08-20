# Plan de Ejecución — Validación Topológica bajo Demanda en QC

Ver spec: `specs/qc_topological_eudr_validation.md`.

## Pasos

1. **Verificación previa:** confirmado que no hay tabla/fuente real de
   cobertura boscosa (`EUDR_COBERTURA_BOSCOSA_2020` no existe,
   `scripts/satellite_prevalidation.py` recibe los datos como parámetro,
   nunca los lee de una tabla propia). Pausado con `AskUserQuestion` —
   usuario confirmó "solo topología por ahora". Confirmado que
   `fn_calcular_area_ha()` ya existe (geodésica, vía trigger) — se
   reutiliza en vez de reimplementar con `ST_Transform(...,32717)`.
   Confirmado que `ID_Organizacion` es `text`, no `uuid`. Confirmado (de
   nuevo) que no se hizo push — el paso 1 del prompt asumía un acuerdo
   que no ocurrió.
2. `supabase/migrations/20260820_fn_validar_topologia_eudr.sql`:
   `qc_validation_audit_log` (tabla nueva, sin PII) +
   `fn_validar_topologia_eudr(p_tabla_origen text, p_registro_id text)`.
3. `lib/qcTopologyValidation.js`: `TOPOLOGY_VALIDATABLE_TABLES` +
   `validateTopologyRequest(body)`.
4. `app/api/qc/validate-spatial/route.js`: `runtime='nodejs'`, usa
   `lib/supabaseServerClient.js` (Service Role Key) para invocar la RPC +
   insertar auditoría (best-effort).
5. `app/dashboard/qc/components/QcDetailEditor.jsx`: botón + badges +
   banner de advertencia no bloqueante.
6. `tests/test_qc_validation_eudr.mjs`: cobertura de
   `validateTopologyRequest` (8 tests).
7. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -v`
   (sin regresión), parar dev server + `rm -rf .next` + `npm run build` +
   `rm -rf .next` + reiniciar `npm run dev`. Smoke test en navegador.
8. Commit a `main` — **sin push** (pendiente confirmación directa del
   usuario, separada de esta tarea).
