# Plan de ejecución — Normalización de certificaciones en `PADRON_SOCIOS`/`PADRON_PARCELAS`

Ver `specs/padron_certificaciones_normalizado.md` para el diseño
completo, la auditoría de esquema/código y las preguntas abiertas. Este
documento es la secuencia concreta de pasos para la(s) tarea(s) de
implementación siguientes — **ninguno de estos pasos se ejecuta en esta
tarea**, que fue solo de auditoría.

## Orden recomendado

### 0. Prerrequisito — resolver las preguntas abiertas de la spec ANTES de escribir SQL

A diferencia de `plans/multi_organizacion_codigos_unicos_ejecucion.md`
(donde el prerrequisito era técnico — un script de diagnóstico), acá el
prerrequisito es de **decisión de producto**, no solo de evidencia:

1. Confirmar el alcance de `NORMAS` (spec, sección 1.7 y pregunta abierta
   #1) — ¿queda completamente fuera, o hay que anotar en el ADR nuevo que
   se decidió dejarla sin tocar explícitamente?
2. Decidir qué pasa con `cert_org_estatus` (pregunta abierta #2) y
   `certificaciones` (pregunta abierta #3) — sin esta decisión, el paso 3
   de la migración de datos (`ORGANIZACION_CERTIFICACIONES`/qué hacer con
   el resumen textual) no se puede escribir.
3. Confirmar si `id_agencia_certificadora` arranca `NULL` para todo el
   backfill (pregunta abierta #4) — si no es aceptable, esta tarea se
   bloquea hasta conseguir esos datos de las organizaciones reales.
4. Decidir naming de `CERTIFICACIONES_CATALOGO` vs `CAT_NORMAS.certificacion`
   (pregunta abierta #5).

### 1. Capturar la definición exacta de `vw_monitoreo_eudr_aprobado`

**No versionada en este repo** (confirmado, spec sección 1.5) — mismo
protocolo completo de `ADR-024` (no el atajo que alcanzó para
`view_eudr_dashboard_aprobados`, que sí tiene su `CREATE VIEW` en
`supabase/migrations/20260825201351_pk_surrogate_multiorganizacion.sql`):
pedir al usuario que corra un diagnóstico de solo lectura en Supabase
Studio SQL Editor (`pg_get_viewdef`, `information_schema.role_table_grants`)
y devuelva el resultado — no adivinar el `SELECT`/`JOIN` a partir de las
columnas expuestas por PostgREST.

### 2. Migración SQL — catálogos + tablas de relación

`supabase/migrations/<timestamp>_padron_certificaciones_normalizado.sql`,
idempotente (mismo estilo que `ADR-023`/`ADR-024`/`ADR-026`: `BEGIN;`/`COMMIT;`,
cada bloque con su propio chequeo de no-op). Dentro de la misma transacción:

1. `CREATE TABLE IF NOT EXISTS` para las 5 tablas nuevas (definición
   exacta en la spec, sección 2) — `CERTIFICACIONES_CATALOGO` y
   `AGENCIAS_CERTIFICADORAS` primero (las otras 3 tienen FK hacia ellas).
2. Seed de `CERTIFICACIONES_CATALOGO` — 9 filas (`INSERT ... ON CONFLICT (codigo) DO NOTHING`,
   idempotente), según la decisión del paso 0.4.
3. Backfill de `SOCIO_CERTIFICACIONES` desde las 8 columnas de
   `CERT_FLAG_FIELDS` (+ `normas_internas_17` si el paso 0.1 lo incluye) —
   un `INSERT ... SELECT` por columna, o un `UNNEST`/`CASE` único; usar
   `PADRON_SOCIOS.id` (UUID, ya existe desde `ADR-026`) para la FK, nunca
   `ID_Socio` texto.
4. `ORGANIZACION_CERTIFICACIONES`/backfill de `certificaciones`/`cert_org_estatus`
   — según la decisión del paso 0.2.
5. `DROP COLUMN` de las 8 + `certificaciones` + `cert_org_estatus` en
   `PADRON_SOCIOS` — **recién después de confirmar el backfill** (paso 6
   de este plan), nunca en la misma corrida que el `INSERT` sin verificar
   antes. Considerar separar esto en una segunda migración si el usuario
   prefiere aplicar el backfill primero y confirmar antes del `DROP`.
6. `CREATE OR REPLACE VIEW` de `view_eudr_dashboard_aprobados` (definición
   ya conocida) y el protocolo completo `DROP VIEW`/`CREATE VIEW`/`GRANT`
   de `ADR-024` para `vw_monitoreo_eudr_aprobado` (con lo capturado en el
   paso 1) y `vw_socios_web` (si se decide mantenerla, paso 0 pendiente).

### 3. ADR nuevo — siguiente número disponible tras `ADR-026`

Documentar: el diseño de las 5 tablas, las decisiones tomadas en el
paso 0 de este plan (con su razonamiento), el hallazgo de `NORMAS` y por
qué queda fuera de alcance (o no), y qué vistas se recrearon.

### 4. Cambios de código — según la tabla de la spec, sección 4

En orden de dependencia (no de severidad, a diferencia del plan de PK —
acá no hay un sitio "más peligroso", es un cambio de forma de datos
transversal):

1. `lib/validations/socios.js` — nuevo schema Zod para selección de
   certificaciones (array de `id_certificacion`, no 8 campos planos).
2. `lib/sociosSearch.js` — `fetchSocios`/`SOCIO_COLUMNS` dejan de traer
   las columnas retiradas; `filters.certFlags`/`filters.certOrgEstatus`
   se repiensan contra `SOCIO_CERTIFICACIONES` (probablemente una
   subquery `id_socio IN (SELECT id_socio FROM SOCIO_CERTIFICACIONES
   WHERE id_certificacion = ANY(...))`, a diseñar en la tarea real).
3. `components/features/socios/SocioFormModal.jsx` — UI nueva contra
   `CERTIFICACIONES_CATALOGO` (multi-select o checklist), reemplaza los 8
   `<select>` Sí/No.
4. `app/dashboard/socios/page.jsx` — columna/filtros de la tabla.
5. `lib/padronCsv.js` — `SOCIO_EXPORT_COLUMNS`/`SOCIO_FIELD_LABELS`;
   decidir cómo se representa una relación 1-a-N en un CSV plano (¿una
   columna por certificación igual que hoy, calculada desde
   `SOCIO_CERTIFICACIONES`? ¿una columna con lista separada por comas?) —
   **no resuelto en la spec, decisión de la tarea de implementación**.
6. `tests/test_socios_schema.mjs` — actualizar o retirar el test de forma
   de `CERT_FLAG_FIELDS`.
7. `lib/gisTargetTables.js` — sin cambios (confirmado en la spec, solo
   menciona el nombre en un comentario).

### 5. Tests

- `tests/test_padron_certificaciones_normalizado.py` (estático, mismo
  patrón que `tests/test_pk_surrogate_multiorganizacion.py`): confirma la
  migración — las 5 tablas con sus columnas/constraints, el seed de
  `CERTIFICACIONES_CATALOGO`, el backfill idempotente, el `DROP COLUMN`
  en el orden correcto (después del backfill, no antes).
- Tests funcionales contra Supabase Live (gateados por `NEEDS_SUPABASE` +
  auto-skip si la migración no está aplicada, mismo patrón que
  `TestPkSurrogateLive`): confirmar que el backfill produjo el número
  correcto de filas en `SOCIO_CERTIFICACIONES` (comparar contra el
  conteo real de `'Sí'` en las columnas viejas, capturado ANTES de
  aplicar — este plan debe incluir ese conteo de referencia en el ADR).
- Regresión: `node --test tests/*.mjs` completo — especial atención a
  `tests/test_padron_csv.mjs`/`tests/test_sociossearch_multitenant.mjs`,
  que asumen la forma vieja de `SOCIO_COLUMNS`/`SOCIO_EXPORT_COLUMNS`.

### 6. Build + suite completa + aplicación manual

`npm run build`, `node --test tests/*.mjs`, `python -m pytest tests/ -v`
— mismo criterio de siempre. Aplicación real de la migración en Supabase
Studio la hace el usuario manualmente. Dado que esta migración incluye un
`DROP COLUMN` (irreversible sin backup, a diferencia de las migraciones
puramente aditivas de `ADR-023`/`ADR-026`), **recomendar explícitamente
al usuario que aplique el backfill primero, verifique los conteos, y
recién después aplique el `DROP COLUMN`** — separarlo en 2 migraciones si
hace falta, no asumir que un solo `apply` está bien para un cambio
destructivo de este tamaño.

## Riesgos y mitigaciones

- **`DROP COLUMN` es irreversible** — a diferencia de todas las
  migraciones anteriores de esta secuencia (aditivas o de constraint, sin
  pérdida de datos posible salvo error del propio backfill). Mitigación:
  paso 2.5/paso 6 de este plan — backfill primero, verificación de
  conteos, `DROP COLUMN` como paso separado y explícito, nunca en la
  misma corrida sin confirmar.
- **`id_agencia_certificadora` sin fuente de datos** (spec, pregunta
  abierta #4) — si no se resuelve en el paso 0 de este plan, el backfill
  deja esa columna vacía para TODAS las filas migradas, lo cual podría no
  ser lo que el negocio espera. Mitigación: es explícitamente el primer
  punto a decidir antes de escribir código, no algo a descubrir a mitad
  de la implementación.
- **`vw_monitoreo_eudr_aprobado` no versionada** (mismo tipo de riesgo
  que rompió el primer intento de la migración de `hbp`/`otros_cultivo`
  en `ADR-024`) — mitigación: paso 1 de este plan, obligatorio antes de
  escribir la migración SQL, no después de que falle en Supabase Studio.
- **`NORMAS`** (spec, sección 1.7) — riesgo de drift de datos si algún
  día se llena de verdad y nadie concilia sus valores con
  `SOCIO_CERTIFICACIONES`. Fuera de alcance de esta migración por
  decisión explícita (pendiente de confirmar en el paso 0), pero
  documentado para que no sea una sorpresa en el futuro.
