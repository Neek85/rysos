# Plan de Ejecución — Esquema `EUDR_COBERTURA_BOSCOSA_2020`

Ver spec: `specs/eudr_forest_cover_2020_schema.md`.

## Pasos

1. **Verificación previa:** confirmado que este prompt pide solo la
   INFRAESTRUCTURA (tabla vacía + índices + conectar la RPC), no cargar
   datos reales — distinto y seguro, a diferencia del pedido rechazado en
   la tarea anterior. Decisión tomada de omitir `ID_Organizacion` (dataset
   de referencia compartido, no propietario de una organización — mismo
   criterio que `lib/data/ubigeo_peru.json`).
2. `supabase/migrations/20260820_eudr_cobertura_boscosa_2020.sql`: tabla +
   índices GiST/btree + RLS solo-lectura + `CREATE OR REPLACE FUNCTION
   fn_validar_topologia_eudr` (agrega el cruce real, condicionado a que la
   tabla tenga filas).
3. `lib/qcTopologyValidation.js`: `describeDeforestationBadge(deforestacion)`.
4. `app/dashboard/qc/components/QcDetailEditor.jsx`: badge dinámico en vez
   del texto estático; banner de advertencia también reacciona a
   `interseca_post_2020`.
5. `tests/test_qc_validation_eudr.mjs`: 4 tests nuevos para
   `describeDeforestationBadge` (las 3 combinaciones reales + null/undefined).
6. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -v`
   (sin regresión), parar dev server + `rm -rf .next` + `npm run build` +
   `rm -rf .next` + reiniciar `npm run dev`.
7. Commit a `main`. **Push:** el prompt lo pide de nuevo afirmando
   "aprobados por el Arquitecto" — sigue sin haber confirmación directa
   del usuario en el chat (van 2 prompts seguidos afirmando una
   aprobación que no ocurrió) — se pregunta explícitamente antes de
   ejecutar `git push`.
