# ADR-013 — audit_logs conectado a la Consola QC: verificación en vivo y corrección de premisa

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-23
- **Código tocado:** `app/dashboard/qc/page.jsx` (`logQcDecisionAudit` — un solo
  campo agregado a `detalles`, ver más abajo). Ningún otro archivo cambió.
- **Tests:** ninguno nuevo (sin cambio de lógica pura que lo justifique); se
  corrió la suite completa existente para confirmar que nada se rompió.

## Precondición (confirmada en vivo antes de escribir nada)

El prompt de esta tarea asumía `audit_logs` "ya aplicada en la instancia
real". Una consulta REST directa con el Service Role Key confirmó lo
contrario: `PGRST205: Could not find the table 'public.audit_logs'` —
exactamente el mismo hallazgo ya documentado en ADR-012. Se pausó la tarea y
se le pidió al usuario aplicar `supabase/migrations/20260820_audit_logs.sql`
en Supabase Studio antes de continuar. Tras confirmar que la aplicó, una
segunda consulta REST confirmó `audit_logs` existe (`select * limit 5` → `[]`,
0 filas, sin error) — recién ahí se retomó la tarea.

## Corrección de premisa mayor: la conexión ya existía

El prompt pedía "conectar audit_logs a las 4 Server Actions reales", con la
premisa implícita de que hacía falta escribir el `INSERT` desde cero. Antes
de escribir código, se localizaron las 4 Server Actions
(`lib/eudrQcActions.js::approveRecord/rejectRecord/updateRecordAttributes/updateRecordGeometry`,
invocadas server-side vía `lib/actions/qcActions.js` con el Service Role Key)
para pegar el código real — y ese paso reveló que **la conexión ya estaba
completamente implementada**, en una tarea anterior de esta misma línea de
trabajo (no capturada en la memoria de sesión disponible para esta tarea,
pero documentada de punta a punta en `specs/qc_batch_audit_trail.md`,
presente en el repo):

- `lib/qcAuditLog.js` — `AUDIT_ACCIONES = ['APROBADO', 'RECHAZADO']`,
  `AUDIT_TABLAS` (las 3 tablas EUDR_*), `validateAuditLogRequest(body)`
  (lógica pura, sin efectos de lado).
- `app/api/qc/audit-log/route.js` — Route Handler que valida con lo anterior
  e inserta con el Service Role Key.
- `app/dashboard/qc/page.jsx::logQcDecisionAudit(record, accion,
  organizationId, motivoTexto)` — se llama justo después de que
  `approveRecord`/`rejectRecord` confirman el `UPDATE` (dentro de
  `handleDecision`), con `fetch('/api/qc/audit-log', ...)`.
- `tests/test_qc_batch_audit.mjs` — 11 tests ya cubrían
  `validateAuditLogRequest`/`filterBatchValidatableRecords`, con esta nota
  explícita en su cabecera: *"Sin test de integración contra Supabase real:
  audit_logs ... sigue sin aplicarse en la instancia real."* — coincide
  exactamente con el hallazgo de ADR-012: el código estaba listo, la tabla
  nunca se creó.

**Se había empezado a escribir, por error, una segunda vía de inserción**
dentro de `lib/eudrQcActions.js::approveRecord/rejectRecord` (un
`recordAuditLog()` nuevo, con tests nuevos en `test_eudr_qc_actions.mjs`)
antes de encontrar `app/api/qc/audit-log/route.js` durante `npm run build`
(apareció en la tabla de rutas). Al confirmar que `page.jsx` ya llama a ese
endpoint después de cada decisión, ese cambio habría producido **una fila
duplicada por decisión** (una desde `logQcDecisionAudit`, otra desde el
`INSERT` nuevo dentro de la función pura). Se revirtió por completo
(`git checkout -- lib/eudrQcActions.js tests/test_eudr_qc_actions.mjs`) antes
de que llegara a un commit.

## Las 3 preguntas del prompt, ya resueltas por el diseño original

El prompt pedía decidir y documentar 3 cosas que, verificado contra
`specs/qc_batch_audit_trail.md`, ya tenían una decisión tomada — se
confirma y se mantiene cada una, en vez de redecidir desde cero:

1. **¿Abortar o continuar si el `INSERT` a `audit_logs` falla?** Ya decidido:
   **continuar** (best-effort). `logQcDecisionAudit` envuelve el `fetch` en
   `try/catch` con manejo silencioso — un fallo de auditoría nunca revierte
   ni bloquea la decisión real, que ya se confirmó contra la tabla base
   antes de llamarse. Mismo criterio ya aceptado en esta sesión para
   `qc_validation_audit_log` (`app/api/qc/validate-spatial/route.js`).
   Justificación que se mantiene: implementarlo atómico (transacción única
   con el `UPDATE` de `estado_revision`) habría exigido reemplazar
   `approveRecord`/`rejectRecord` por RPCs nuevas, invalidando los tests
   reales que ya las cubren tal como están — y el costo de una fila de
   auditoría perdida es mucho menor que el de bloquear el flujo de QC por un
   problema en una tabla secundaria.
2. **¿Extender a `updateRecordAttributes`/`updateRecordGeometry`?** Ya
   decidido: **no**. `AUDIT_ACCIONES`/el `CHECK` de la migración solo
   admiten `'APROBADO'`/`'RECHAZADO'` — ampliarlo exigiría una migración
   nueva. Se mantiene esta decisión en esta tarea: `audit_logs` nace
   explícitamente para trazar **decisiones** (Aprobar/Rechazar), que es
   también el alcance exacto del incidente que motivó ADR-012 (un
   `estado_revision` revertido, no un atributo/geometría editado). Si en el
   futuro se pide auditar también las correcciones de atributos/geometría
   previas a la decisión, es una tarea de seguimiento explícita — necesita
   ampliar el `CHECK` de `accion` (o una tabla/columna separada) y probablemente
   capturar el diff (valor anterior → nuevo), no solo el hecho de que hubo un cambio.
3. **¿Qué se puede/no se puede registrar sobre "quién"?** Esto SÍ tenía un
   gap real: `detalles` no llevaba ningún campo de procedencia. Se agregó
   `origen: 'consola_qc_web'` a `detalles` en `logQcDecisionAudit` — el único
   dato honesto disponible: no hay sesión de Supabase Auth en este frontend
   (anon key sin sesión, ver el gotcha de RLS en `CLAUDE.md`), así que no
   existe un usuario/sesión real que registrar. `origen` sirve además para
   diferenciar esta vía de decisión de `scripts/qgis_qc_actions.py` (el otro
   flujo real que escribe `estado_revision`) — que hoy **no** inserta en
   `audit_logs` en absoluto (fuera de alcance de este ADR y de ADR-012: ese
   script sigue además con la columna rota `actualizado_en`, documentado en
   ADR-012). Si en el futuro se agrega Auth real, `origen` puede
   evolucionar a un identificador de usuario real sin romper el esquema de
   `detalles` (es `jsonb`, no columnas fijas).

## Verificación en vivo (no solo revisar el código)

1. **Aprobar un registro real** a través del botón real "✓ Aprobar" en
   `/dashboard/qc`: `b12677bd-6b88-58da-90a4-3b50b164b539` (COOP-JS-004,
   2026-08-16). Confirmado vía React fiber (mismo método que ADR-012, para
   no confundir dos cards con el mismo nombre de parcela en la lista) antes
   de clickear.
2. **Rechazar un registro real** con motivo real, mismo flujo:
   `10425cbd-3d3e-51c3-b529-3a05c5610282` (COOP-JS-003, 2026-08-19), motivo
   `"Verificacion ADR-013: prueba real de audit_logs conectado a
   rejectRecord."`.
3. **Filas reales en `audit_logs` tras ambas acciones** (vía REST,
   Service Role Key):
   ```json
   {"id": 1, "ID_Organizacion": "ORG-TEST-E2E", "accion": "APROBADO",
    "tabla_origen": "EUDR_MONITOREO",
    "entidad_id": "b12677bd-6b88-58da-90a4-3b50b164b539",
    "detalles": {"motivo": null, "origen": "consola_qc_web", "validacion": null}}
   {"id": 2, "ID_Organizacion": "ORG-TEST-E2E", "accion": "RECHAZADO",
    "tabla_origen": "EUDR_MONITOREO",
    "entidad_id": "10425cbd-3d3e-51c3-b529-3a05c5610282",
    "detalles": {"motivo": "Verificacion ADR-013: ...", "origen": "consola_qc_web", "validacion": null}}
   ```
   Confirmado también que las 2 filas de `EUDR_MONITOREO` quedaron en el
   estado correcto (`APROBADO`/`RECHAZADO`, con el motivo anexado a
   `observaciones` en el caso rechazado).
4. **Trigger de inmutabilidad, probado de verdad, no solo leído:** con el
   mismo Service Role Key que puede insertar (el único rol con permiso),
   se intentó `UPDATE audit_logs SET accion='APROBADO' WHERE id=2` y
   `DELETE FROM audit_logs WHERE id=1` directo por REST. Ambos rechazados:
   ```
   UPDATE → P0001: "audit_logs es de solo inserción — UPDATE no está permitido sobre filas existentes."
   DELETE → P0001: "audit_logs es de solo inserción — DELETE no está permitido sobre filas existentes."
   ```
   Las 2 filas siguen intactas tras ambos intentos — confirma AC2 de
   `specs/qc_batch_audit_trail.md` en la instancia real, no solo en el SQL
   de la migración.

**Nota sobre los datos de la verificación:** las 2 filas de `audit_logs`
creadas en el paso 3 (`id=1`/`id=2`) **no se pueden borrar** — es
exactamente el comportamiento correcto del trigger de inmutabilidad, probado
en el paso 4. Quedan permanentemente en la tabla como las 2 primeras
entradas reales de auditoría, sobre registros reales de `ORG-TEST-E2E` (el
organización de prueba ya usada en toda esta sesión) — no un fixture
descartable aparte.

## Resultado de la suite completa

`node --test tests/*.mjs`: 444 passed (sin tests nuevos — el único cambio de
código es un campo agregado a un objeto `detalles` ya existente, sin lógica
nueva que justifique un test dedicado; se corrió la suite completa para
confirmar que nada se rompió). `python -m pytest tests/ -v --tb=short`:
358 passed, 5 skipped (sin cambios Python en esta tarea). `npm run build`
compila limpio.

## Fuera de alcance de esta tarea (a propósito)

- **`scripts/qgis_qc_actions.py` no escribe `audit_logs`** — sigue siendo un
  flujo de decisión real (QGIS Desktop) sin ningún rastro de auditoría, y
  además con la columna rota `actualizado_en` ya documentada en ADR-012. No
  se tocó (el prompt pedía específicamente "las 4 Server Actions reales de
  la Consola QC").
- **Ampliar `audit_logs` a `updateRecordAttributes`/`updateRecordGeometry`**
  — ver la decisión 2 arriba; requiere una migración nueva si se pide como
  tarea de seguimiento explícita.
- **`origen` como identificador de usuario real** — bloqueado en la
  ausencia de Supabase Auth en este frontend, no en esta tarea.
