# Plan de Ejecución — Panel de Visualización de Validación Topológica en QC

Ver spec: `specs/qc_visualization_panel_update.md`.

## Pasos

1. **Verificación previa:** confirmado que `QcTable.jsx` no existía
   (extraer, no actualizar), que `flyTo` ya funcionaba, que no hay
   colisión real de z-index en este panel (sin overlay `fixed/absolute`),
   y que "cero logs de PII" ya era cierto. Encontrado un gap real (no una
   premisa falsa): `fetchPendingRecords` no aislaba por organización.
2. `lib/eudrQcActions.js`: fetch en dos pasos en `fetchPendingRecords`
   (mismo patrón que `MapDashboard.jsx`).
3. `lib/qcTopologyValidation.js`: `describeTopologyListBadge`/
   `describeOverlapListBadge`/`describeDeforestationListBadge`.
4. `app/dashboard/qc/components/QcTable.jsx` (nuevo): lista extraída +
   3 badges por fila.
5. `app/dashboard/qc/page.jsx`: `validationResults`/`validatingKey`/
   `validationError` + `handleValidateTopology` (lifted desde
   `QcDetailEditor.jsx`), reemplaza el `.map()` inline por `<QcTable />`.
6. `app/dashboard/qc/components/QcDetailEditor.jsx`: recibe la validación
   por props en vez de estado local; botón renombrado a "Ejecutar Test
   Espacial".
7. Tests: `tests/test_eudr_qc_actions.mjs` (agrega `.limit()` al mock +
   1 test de aislamiento multi-tenant), `tests/test_qc_visualization_panel.mjs`
   (nuevo, 8 tests de los badges compactos).
8. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -v`
   (sin regresión, no se tocó Python), parar dev server + `rm -rf .next` +
   `npm run build` + `rm -rf .next` + reiniciar `npm run dev`. Smoke test
   en navegador.
9. Commit a `main`. La confirmación de push de la tarea anterior era para
   ESE lote de commits ("hacé push ahora"), no una autorización
   permanente — se pregunta de nuevo (más brevemente) antes de ejecutar
   `git push` para este commit nuevo.
