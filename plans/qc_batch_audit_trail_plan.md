# Plan de Ejecución — Validación en Lote + Traza de Auditoría QC

Ver spec: `specs/qc_batch_audit_trail.md`.

## Pasos

1. **Verificación previa:** confirmado que "OBSERVADO" sigue sin existir
   (tercera vez en la sesión); que `entidad_id` no es UUID nativo para 2
   de las 3 tablas; que "inmutable" y "obligatorio" son 2 afirmaciones
   distintas — la primera se implementa de verdad (trigger), la segunda
   se interpreta como "best-effort, mismo criterio ya aceptado para
   qc_validation_audit_log" en vez de una reescritura de
   approveRecord/rejectRecord que rompería 8 tests existentes.
2. `supabase/migrations/20260820_audit_logs.sql`: tabla + trigger de
   inmutabilidad + RLS sin políticas.
3. `lib/qcAuditLog.js`: `AUDIT_ACCIONES`/`AUDIT_TABLAS`/
   `validateAuditLogRequest`.
4. `app/api/qc/audit-log/route.js`: Service Role Key, valida + inserta.
5. `app/dashboard/qc/page.jsx`: `logQcDecisionAudit`, llamada desde
   `handleDecision` tras un approve/reject exitoso.
6. `lib/qcTopologyValidation.js`: `filterBatchValidatableRecords`.
7. `app/dashboard/qc/components/QcTable.jsx`: botón "Validar Todos
   PENDIENTES" + barra de progreso, secuencial.
8. `QcDetailEditor.jsx`: revisado, sin cambios necesarios (documentado
   por qué).
9. `tests/test_qc_batch_audit.mjs`: 14 tests (`validateAuditLogRequest` +
   `filterBatchValidatableRecords`).
10. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -v`
    (sin regresión), parar dev server + `rm -rf .next` + `npm run build` +
    `rm -rf .next` + reiniciar `npm run dev`. Smoke test en navegador.
11. Commit a `main`. Push: se confirma con el usuario antes de ejecutar
    (cada push se re-confirma, no hay autorización permanente).
