# Plan — Revertir Aprobado a Consola QC

Ver `specs/revertir_aprobado_a_qc.md`.

1. `supabase/migrations/20260909150000_audit_logs_revertido.sql`: amplía
   el `CHECK` de `audit_logs.accion` a `('APROBADO','RECHAZADO','REVERTIDO')`.
2. `lib/qcAuditLog.js`: `AUDIT_ACCIONES` gana `'REVERTIDO'`.
3. `lib/eudrQcActions.js`: refactor `fetchPendingRecords` →
   `fetchRecordsByState` + `fetchApprovedRecords`; nueva `reopenRecord`.
4. `lib/actions/qcActions.js`: `reopenQcRecord`.
5. `app/dashboard/qc/page.jsx`: pestañas Pendientes/Aprobados,
   `loadApproved`, `handleRevert`, `logQcDecisionAudit` acepta motivo para
   `REVERTIDO` también.
6. `app/dashboard/qc/components/QcDetailEditor.jsx`: botón único de
   revertir cuando `estado_revision === 'APROBADO'`.
7. Tests: `tests/test_eudr_qc_actions.mjs` (mock) +
   `tests/test_qc_reopen_rbac_rls.py` (`@NEEDS_SUPABASE`, sesiones reales).
8. `npm run build` + suite completa.
9. Commit `feat(qc): permitir revertir un registro Aprobado a revisión`.
