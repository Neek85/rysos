# Spec — Revertir un registro Aprobado a la Consola QC

## Objetivo

Permitir que un registro `APROBADO` (`EUDR_MONITOREO`/`EUDR_USO_SUELO`/
`EUDR_INSTALACIONES`) vuelva a `PENDIENTE` desde la Consola QC
(`/dashboard/qc`), para poder ajustarlo (atributos/geometría) y volver a
decidir sobre él — sin tocar `PADRON_PARCELAS` bajo ninguna circunstancia
(confirmado con el usuario: la fila del padrón, una vez creada, es
independiente del ciclo de revisión del monitoreo que la originó).

## Verificado antes de escribir código

- **`fn_enforce_qc_approval_roles` (ADR-039) ya cubre este `UPDATE`** —
  dispara con `IF NEW.estado_revision IS DISTINCT FROM OLD.estado_revision`,
  sin importar la dirección del cambio. **Confirmado en vivo** (no solo
  leído): con una fila descartable `APROBADO` real en `ORG-TEST-DEMO`, una
  sesión real `tecnico_campo` intentando `PATCH estado_revision=PENDIENTE`
  recibió `403`/`42501`; una sesión real `auditor_qc` completó el mismo
  `PATCH` con `200`. Sin migración nueva para esto.
- **`audit_logs.accion` tiene un `CHECK (accion IN ('APROBADO', 'RECHAZADO'))`**
  a nivel de columna (`supabase/migrations/20260820_audit_logs.sql`) — el
  prompt original pedía `accion='REVERTIDO'` sin prever que ese valor
  choca con el `CHECK` real. Requiere una migración que amplíe la lista
  (no una política RLS — `audit_logs` sigue sin políticas para
  `anon`/`authenticated`, solo el Service Role Key la escribe vía
  `/api/qc/audit-log`, sin cambios ahí).
- **Corrección de firma:** el prompt proponía
  `reopenQcRecord(tablaOrigen, registroId, organizationId, motivo?) =>
  Promise<{ok:true}|{ok:false,error}>` — no coincide con el patrón real
  de `approveQcRecord`/`rejectQcRecord` (`lib/actions/qcActions.js`), que
  reciben el **registro completo** (lo necesitan `resolveUpdateTarget`/
  `assertSameOrganization`) y **lanzan** `EUDRQcError` en vez de devolver
  `{ok:false,error}` — el `catch` de `page.jsx` ya espera eso. Se sigue el
  patrón real: `reopenQcRecord(record, organizationId)`.
- **`motivo` no se persiste en ninguna columna.** A diferencia de
  `rejectRecord` (que anexa el motivo a `observaciones` y por eso lo exige
  no vacío), revertir no escribe `observaciones` — el motivo, si se dio,
  solo viaja al log de auditoría (`detalles.motivo`). Por eso
  `reopenRecord`/`reopenQcRecord` no reciben `motivo` como parámetro; el
  log de auditoría (que ya vive en `page.jsx`, separado de la Server
  Action, igual que para Aprobar/Rechazar) lo agrega aparte.
- **`reopenRecord` no repite los guards de `approveRecord`**
  (`assertSinConflictoDeParcela`/`assertSocioParcelaMismaOrganizacion`):
  revertir es precisamente la vía para ir a corregir ese tipo de problema
  — no debe quedar bloqueado por él.

## Diseño

- `lib/eudrQcActions.js::reopenRecord(supabase, record, organizationId)`:
  mismo patrón exacto que `approveRecord`/`rejectRecord` — `UPDATE
  estado_revision = 'PENDIENTE'` con `.match({ ...match, ID_Organizacion,
  estado_revision: 'APROBADO' })`; `0` filas afectadas lanza
  `EUDRQcError` explícito (nunca un `UPDATE` silencioso).
- `lib/actions/qcActions.js::reopenQcRecord(record, organizationId)`:
  `createSessionServerClient()` + `reopenRecord` — mismo patrón que
  `approveQcRecord`.
- `lib/eudrQcActions.js::fetchApprovedRecords`: mismo fetch que
  `fetchPendingRecords` pero `estado_revision = 'APROBADO'` — ambas ahora
  comparten `fetchRecordsByState(supabase, estado, opts)` (refactor sin
  cambio de comportamiento para `fetchPendingRecords`, ya cubierto por los
  tests existentes).
- `app/dashboard/qc/page.jsx`: pestañas "Pendientes"/"Aprobados"
  (`viewMode`, ortogonal al filtro de tabla `TODOS/Monitoreos/...` que ya
  existía) — reemplaza el único `useEffect(loadPending, [])` por una carga
  que depende de `viewMode`.
- `QcDetailEditor.jsx`: si `record.estado_revision === 'APROBADO'`, la fila
  de botones muestra solo "↩ Revertir a Revisión" en vez de
  Aprobar/Rechazar.
- `lib/qcAuditLog.js::AUDIT_ACCIONES` gana `'REVERTIDO'`; migración
  `supabase/migrations/20260909150000_audit_logs_revertido.sql` amplía el
  `CHECK` de la columna.

## Tests

- `tests/test_eudr_qc_actions.mjs`: `reopenRecord` (mock) — revierte
  `APROBADO→PENDIENTE`, lanza si ya no está `APROBADO`, aislamiento
  multi-tenant, nunca toca `observaciones`/`PADRON_PARCELAS`,
  `fetchApprovedRecords` reusa `fetchRecordsByState` igual que
  `fetchPendingRecords`.
- `tests/test_qc_reopen_rbac_rls.py` (`@NEEDS_SUPABASE`, mismo patrón que
  `tests/test_padron_rbac_rls.py`): sesión real `tecnico_campo` bloqueada
  (`42501`), sesión real `auditor_qc` permitida, aislamiento cruzado
  Organización A / Organización B con sesiones reales de cada una.
