# Spec — Validación en Lote + Traza de Auditoría de Decisiones QC

## Contexto y corrección de premisas (verificado antes de implementar)

- **`accion` no puede ser `'MONITOREO_APROBADO'/'MONITOREO_OBSERVADO'`.**
  Dos problemas: (1) no existe un estado/acción "OBSERVADO" — confirmado
  ya 2 veces en esta sesión (`specs/gis_qc_console_v2.md`): los 3 estados
  reales son `PENDIENTE`/`APROBADO`/`RECHAZADO`; (2) la Consola QC decide
  sobre 3 tablas (`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`),
  no solo `EUDR_MONITOREO` — un `accion` con el nombre de tabla incrustado
  necesitaría 6 valores. Se usa `accion` genérico
  (`'APROBADO'`/`'RECHAZADO'`) + una columna `tabla_origen` separada (ya
  presente en la tabla) para el dato de qué tabla.
- **`entidad_id (UUID del registro EUDR_MONITOREO)` — mismo error ya
  corregido en `fn_validar_topologia_eudr`:** `id_origen` no es UUID
  nativo para `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` (ver
  `docs/schema_live.md`). Columna `text`.
- **"Registro obligatorio/inmutable" — dos afirmaciones distintas, cada
  una tratada con su rigor real:**
  - *Inmutable* se implementa de verdad: un trigger `BEFORE UPDATE OR
    DELETE` en `audit_logs` rechaza cualquier intento de modificar/borrar
    una fila ya escrita, para **cualquier rol** (los triggers no
    distinguen privilegio, a diferencia de RLS) — incluido el propio
    Service Role Key que la escribe.
  - *Obligatorio* se interpreta como "se intenta en cada decisión, nunca
    se omite silenciosamente" — **no** como una transacción atómica única
    junto al `UPDATE` de `estado_revision`. Implementarlo atómico habría
    exigido reemplazar `approveRecord`/`rejectRecord`
    (`lib/eudrQcActions.js`) por RPCs nuevas, invalidando los 8 tests
    reales que ya las cubren tal como están. Se aplica el mismo criterio
    ya aceptado en esta sesión para `qc_validation_audit_log`
    (`app/api/qc/validate-spatial/route.js`: "best-effort, no bloquea la
    respuesta si falla") — la llamada a `/api/qc/audit-log` se hace
    siempre después de una decisión exitosa, con manejo de error
    silencioso, nunca condicionalmente omitida.
- **`QcDetailEditor.jsx` no necesitó ningún cambio.** Está en la lista de
  archivos del prompt, pero tras revisar el flujo, la llamada a
  `/api/qc/audit-log` se dispara desde `page.jsx::handleDecision` (que ya
  orquesta `approveRecord`/`rejectRecord`) — `QcDetailEditor.jsx` solo
  llama a `onApprove`/`onReject` (props ya existentes, sin cambios). No se
  tocó el archivo.

## Diseño

- **`supabase/migrations/20260820_audit_logs.sql`**: tabla `audit_logs`
  (`"ID_Organizacion" text`, `accion text CHECK IN ('APROBADO','RECHAZADO')`,
  `tabla_origen text CHECK IN (...)`, `entidad_id text`, `detalles jsonb`,
  `created_at`) + trigger de inmutabilidad + RLS habilitada sin políticas
  (solo Service Role Key).
- **`lib/qcAuditLog.js`** (nuevo): `AUDIT_ACCIONES`/`AUDIT_TABLAS` +
  `validateAuditLogRequest(body)` — lógica pura, testeable.
- **`app/api/qc/audit-log/route.js`** (nuevo): Service Role Key, valida +
  inserta.
- **`app/dashboard/qc/page.jsx`**: `logQcDecisionAudit(record, accion,
  organizationId, motivo)` — se llama justo después de un
  `approveRecord`/`rejectRecord` exitoso en `handleDecision`. `detalles`
  incluye el último resultado de `validationResults[record.key]` (si el
  operador corrió "Ejecutar Test Espacial" antes de decidir) + el motivo
  de rechazo — nunca datos de `PADRON_SOCIOS`.
- **`lib/qcTopologyValidation.js`**: `filterBatchValidatableRecords(records)`
  (nuevo) — mismo whitelist que ya usa el endpoint
  (`TOPOLOGY_VALIDATABLE_TABLES`), reutilizado para no disparar llamadas
  que el servidor rechazaría igual.
- **`app/dashboard/qc/components/QcTable.jsx`**: botón "Validar Todos
  PENDIENTES (N)" + barra de progreso. Llama a `onValidateTopology`
  (el mismo `handleValidateTopology` que ya usa el panel de detalle, pasado
  como prop) **secuencialmente** (no `Promise.all`) — cada corrida ya es
  una consulta real de solapamiento contra todo lo `APROBADO` de la
  organización; lanzar todas a la vez multiplicaría la carga sin necesidad
  real. Un registro que falla no detiene el resto del lote
  (`handleValidateTopology` ya atrapa sus propios errores).

## Criterios de aceptación

- AC1: Ningún `accion` insertado en `audit_logs` es distinto de
  `'APROBADO'`/`'RECHAZADO'`.
- AC2: `audit_logs` rechaza cualquier `UPDATE`/`DELETE`, para cualquier rol.
- AC3: "Validar Todos PENDIENTES" nunca incluye un registro
  `EUDR_INSTALACIONES`.
- AC4: `npm run build` compila sin errores.
