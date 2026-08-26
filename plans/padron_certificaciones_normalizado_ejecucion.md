# Plan de ejecución — Normalización de certificaciones en `PADRON_SOCIOS`/`PADRON_PARCELAS`

Ver `specs/padron_certificaciones_normalizado.md` (ronda 4, contrato de
datos cerrado) para el diseño completo, la auditoría de esquema/código y
las preguntas abiertas restantes. Este documento es la secuencia
concreta de pasos para la(s) tarea(s) de implementación siguientes —
**ninguno de estos pasos se ejecuta en esta tarea**, que fue solo de
especificación.

## Orden recomendado

### 0. Prerrequisito — confirmar la interpretación de "certificación Orgánica" antes de escribir el backfill

**Única decisión de producto que sigue realmente abierta** (spec,
sección 5, pregunta #2 — las preguntas #1/#3/#4/#5 ya están resueltas):
ninguna de las 8 certificaciones del catálogo se llama literalmente
"Orgánica". La spec (sección 3.4) documenta una interpretación con
evidencia real de respaldo — el valor de `cert_org_estatus` se copia al
campo `estado` de las filas de `SOCIO_CERTIFICACIONES` que se originan
en los 5 flags de tipo orgánico (NOP USDA/UE 2018/848/COR Canadá/DS
044-2006-AG/LPO México), no en Rainforest Alliance/Comercio
Justo/Fair Trade USA — pero es una interpretación, no una lectura
inequívoca de la instrucción original. Confirmar esto explícitamente
antes de escribir el `INSERT` de backfill (paso 2.3 de este plan) — un
backfill mal interpretado acá escribe datos reales incorrectos en
`SOCIO_CERTIFICACIONES.estado`, no algo trivial de corregir después sin
volver a tocar la tabla.

### 1. Diagnóstico en vivo de `vw_monitoreo_eudr_aprobado` — preparación para la limpieza futura, no bloqueante para esta migración

**Importante — ya no es un prerrequisito de ESTA migración**: como la
sección 3 de la spec decidió que las columnas planas de `PADRON_SOCIOS`
NO se eliminan en este paso (quedan de respaldo, sin `DROP COLUMN`),
`view_eudr_dashboard_aprobados`/`vw_monitoreo_eudr_aprobado`/`vw_socios_web`
siguen leyendo esas columnas exactamente igual que hoy — **no hace falta
tocarlas ni recrearlas en la migración de esta ronda**.

Sigue siendo valioso adelantar este diagnóstico ahora, como preparación
para la futura tarea de limpieza (la que sí va a hacer el `DROP
COLUMN`), mismo protocolo que resolvió la dependencia de `vw_parcelas_web`
en `ADR-024`: pedir al usuario que corra en Supabase Studio SQL Editor
un diagnóstico de solo lectura contra `pg_depend`/`pg_rewrite`
(`pg_get_viewdef('vw_monitoreo_eudr_aprobado'::regclass, true)`,
`information_schema.role_table_grants`) y devuelva el resultado — no
adivinar el `SELECT`/`JOIN` a partir de las columnas expuestas por
PostgREST. Guardar el resultado en el ADR de esta tarea (paso 4) o en un
documento de preparación aparte, para que la tarea de limpieza futura no
tenga que repetirlo.

### 2. Migración SQL — catálogos + tablas de relación (sin `DROP COLUMN`)

`supabase/migrations/<timestamp>_padron_certificaciones_normalizado.sql`,
idempotente (mismo estilo que `ADR-023`/`ADR-024`/`ADR-026`: `BEGIN;`/`COMMIT;`,
cada bloque con su propio chequeo de no-op). Dentro de la misma
transacción — **puramente aditiva, sin tocar ninguna columna existente
de `PADRON_SOCIOS`/`PADRON_PARCELAS` ni ninguna vista**:

1. `CREATE TABLE IF NOT EXISTS` para las 5 tablas nuevas, contrato
   exacto de `specs/padron_certificaciones_normalizado.md` sección 2 —
   `CERTIFICACIONES_CATALOGO` y `AGENCIAS_CERTIFICADORAS` primero (las
   otras 3 tienen FK hacia ellas). Incluye
   `id_organizacion text NOT NULL REFERENCES "ORGANIZACIONES"("ID")` en
   `ORGANIZACION_CERTIFICACIONES` — la única FK real hacia
   `ORGANIZACIONES` de todo este bloque, instrucción explícita
   confirmada en la spec (no una decisión tomada acá).
2. Seed de `CERTIFICACIONES_CATALOGO` — **8 filas** (no 9 —
   `normas_internas_17` queda fuera, spec sección 2 punto 3),
   `INSERT ... ON CONFLICT (codigo) DO NOTHING`, idempotente. `codigo`/`nombre`
   según la tabla de la spec, sección 1.8 (`nombre` = mismo texto que
   `CERT_FLAG_FIELDS[...].label`).
3. Backfill de `SOCIO_CERTIFICACIONES` — instrucción literal de la spec
   (sección 3.4): por cada uno de los 7 socios reales × cada una de las
   8 columnas de `CERT_FLAG_FIELDS` con valor `'Sí'`, un `INSERT` con
   `id_socio` = `PADRON_SOCIOS.id` (UUID, `ADR-026`), `id_organizacion`
   = `PADRON_SOCIOS."ID_Organizacion"` del mismo socio, `id_certificacion`
   = la fila de `CERTIFICACIONES_CATALOGO` correspondiente. El campo
   `estado`: `NULL` por defecto, **salvo** en las filas originadas en los
   5 flags orgánicos (paso 0 de este plan) — ahí, `estado` =
   `PADRON_SOCIOS.cert_org_estatus` del mismo socio.
4. `ORGANIZACION_CERTIFICACIONES`/`AGENCIAS_CERTIFICADORAS`: **sin
   backfill, sin seed** — ambas nacen completamente vacías (spec,
   sección 3, puntos 2 y 3). Ningún `INSERT` para estas dos en la
   migración, más allá de la definición de la tabla.
5. `PARCELA_CERTIFICACIONES`: sin backfill — nace vacía (spec, sección
   1.4/3.5).
6. **Sin `DROP COLUMN`, sin `CREATE OR REPLACE VIEW`, sin tocar RLS** —
   decisión explícita de esta ronda (spec, sección 3): las columnas
   planas de `PADRON_SOCIOS` quedan físicamente presentes, sin uso, como
   respaldo. Esto es lo que hace innecesario el paso de vistas que sí
   era obligatorio en el plan de la ronda anterior.

### 3. ADR nuevo — siguiente número disponible tras `ADR-026`

Documentar: el contrato final de las 5 tablas (con los 2 cambios de
diseño respecto de la ronda 1: `id_agencia_certificadora` movida a
`ORGANIZACION_CERTIFICACIONES`, `PARCELA_CERTIFICACIONES` sin `estado`),
la decisión de NO hacer `DROP COLUMN` en esta migración, el resultado
del backfill (conteos reales — ver paso 5 de este plan), la
interpretación aplicada de "certificación Orgánica" (paso 0 de este
plan, con su justificación), y el resultado del diagnóstico de
`vw_monitoreo_eudr_aprobado` (paso 1) como referencia para la limpieza
futura.

### 4. Cambios de código — según la tabla de la spec, sección 4, y el diseño de columnas dinámicas de la sección 6.1

En orden de dependencia:

1. `lib/validations/socios.js` — nuevo schema Zod para selección de
   certificaciones (array de `id_certificacion`, no 8 campos planos) —
   deja de usar `CERT_FLAG_FIELDS`/`siNo`, sin borrar las columnas
   viejas del payload de lectura si algún flujo todavía las necesita
   temporalmente (las columnas siguen en la base, ver paso 2.6).
2. `lib/actions/sociosActions.js` — `createSocio`/`socioPayload` dejan
   de escribir las 8 columnas planas; agregan la creación de las filas
   de `SOCIO_CERTIFICACIONES` correspondientes (1 + N `INSERT`s en vez
   de 1) — afecta tanto al alta manual como al importador CSV
   (`ImportPadronModal.jsx::handleConfirmImport`, que llama a la misma
   función, spec sección 6).
3. `lib/sociosSearch.js` — `fetchSocios`/`SOCIO_COLUMNS` dejan de traer
   las columnas planas; `filters.certFlags`/`filters.certOrgEstatus` se
   repiensan contra `SOCIO_CERTIFICACIONES` (subquery `id_socio IN
   (SELECT id_socio FROM "SOCIO_CERTIFICACIONES" WHERE id_certificacion
   = ANY(...))`, a diseñar en la tarea real).
4. `components/features/socios/SocioFormModal.jsx` — UI nueva contra
   `CERTIFICACIONES_CATALOGO` (multi-select o checklist), reemplaza los
   8 `<select>` Sí/No.
5. `app/dashboard/socios/page.jsx` — columna/filtros de la tabla.
6. `lib/padronCsv.js` — implementa el diseño cerrado de la spec, sección
   6.1:
   - `SOCIO_EXPORT_COLUMNS`/plantilla pasan de 8 columnas fijas a
     **una columna dinámica por cada fila `activo = true` de
     `CERTIFICACIONES_CATALOGO`** (consulta en vivo al generar,
     mismo patrón que `fetchExistingCodes`/`fetchSampleSocioIds` ya
     usan hoy para otros datos dinámicos de la plantilla).
   - El encabezado de cada columna dinámica es
     `CERTIFICACIONES_CATALOGO.nombre` (no `codigo`) — mismo criterio
     que ya usan las columnas fijas hoy (`labels?.[col] || col` en
     `arrayToCsv`).
   - `normalizeRowKeys`/el flujo de validación: **cualquier columna del
     CSV subido que no matchee (case-insensitive) un `nombre` de
     `CERTIFICACIONES_CATALOGO` con `activo = true`, ni ninguna de las
     columnas técnicas fijas restantes, debe rechazar el archivo
     completo con un error explícito citando el nombre de columna no
     reconocida** — comportamiento nuevo, hoy (`normalizeRowKeys`) una
     columna sin match se deja pasar en silencio.
   - Formato de celda por certificación: a decidir en esta tarea (spec,
     sección 6.1, sin cerrar) — probablemente mismo contrato
     `'Sí'`/`'No'`/vacío que hoy, pero confirmarlo contra el nuevo
     `socioSchema`.
7. `tests/test_socios_schema.mjs` — actualizar o retirar el test de
   forma de `CERT_FLAG_FIELDS`.
8. `lib/gisTargetTables.js` — sin cambios (confirmado en la spec, solo
   menciona el nombre en un comentario).

### 5. Tests

- `tests/test_padron_certificaciones_normalizado.py` (estático, mismo
  patrón que `tests/test_pk_surrogate_multiorganizacion.py`): confirma
  la migración — las 5 tablas con sus columnas/constraints exactas
  (incluida la FK real `ORGANIZACION_CERTIFICACIONES.id_organizacion ->
  ORGANIZACIONES("ID")`, y la AUSENCIA de FK en
  `SOCIO_CERTIFICACIONES.id_organizacion`/`PARCELA_CERTIFICACIONES.id_organizacion`,
  que son denormalizadas a propósito), el seed de 8 filas (no 9) en
  `CERTIFICACIONES_CATALOGO`, el backfill idempotente, **la ausencia de
  cualquier `DROP COLUMN` en el archivo** (regresión real a proteger:
  esta migración es puramente aditiva por decisión explícita).
- Tests funcionales contra Supabase Live (gateados por `NEEDS_SUPABASE` +
  auto-skip si la migración no está aplicada, mismo patrón que
  `TestPkSurrogateLive`): confirmar que el backfill produjo el número
  correcto de filas en `SOCIO_CERTIFICACIONES` (comparar contra el
  conteo real de `'Sí'` en las columnas viejas, capturado ANTES de
  aplicar — incluir ese conteo de referencia en el ADR del paso 3) y que
  las filas originadas en los 5 flags orgánicos tienen `estado` igual al
  `cert_org_estatus` real del socio.
- Regresión: `node --test tests/*.mjs` completo — especial atención a
  `tests/test_padron_csv.mjs`/`tests/test_sociossearch_multitenant.mjs`,
  que asumen la forma vieja de `SOCIO_COLUMNS`/`SOCIO_EXPORT_COLUMNS`, y
  a un test nuevo para el rechazo explícito de columnas CSV no
  reconocidas (paso 4.6 de este plan).

### 6. Build + suite completa + aplicación manual

`npm run build`, `node --test tests/*.mjs`, `python -m pytest tests/ -v`
— mismo criterio de siempre. Aplicación real de la migración en Supabase
Studio la hace el usuario manualmente. A diferencia del plan de la ronda
anterior, esta migración **no incluye ningún paso destructivo** (sin
`DROP COLUMN`, sin `CREATE OR REPLACE VIEW`) — es segura de aplicar de
una sola vez, sin necesidad de separarla en 2 pasadas.

## Riesgos y mitigaciones

- **La interpretación de "certificación Orgánica" para el campo `estado`
  del backfill** (paso 0 de este plan) es la única decisión de producto
  real que sigue abierta — un backfill con la interpretación equivocada
  escribe datos incorrectos en `SOCIO_CERTIFICACIONES`, una tabla nueva
  sin ningún otro dato de referencia con el que contrastar el error más
  tarde. Mitigación: confirmar explícitamente antes de escribir el
  `INSERT`, no asumir la interpretación de la spec como definitiva.
- **`ORGANIZACION_CERTIFICACIONES`/`AGENCIAS_CERTIFICADORAS` nacen
  completamente vacías** — sin ningún dato hasta que alguien las cargue
  manualmente. No es un riesgo técnico, pero sí un hueco de producto real
  (ninguna organización tiene certificaciones/agencias registradas el
  día que se aplique esta migración) — fuera del alcance de este plan
  resolverlo, pero vale la pena que el usuario lo sepa antes de aplicar.
- **`vw_monitoreo_eudr_aprobado` no versionada** — ya no bloquea esta
  migración (paso 1 de este plan), pero sigue siendo un riesgo real para
  la futura tarea de limpieza que sí va a hacer el `DROP COLUMN`.
  Mitigación: adelantar el diagnóstico ahora igual, para no repetir el
  error que rompió el primer intento de la migración de
  `hbp`/`otros_cultivo` en `ADR-024`.
- **`NORMAS`** (spec, sección 1.7) — riesgo de drift de datos si algún
  día se llena de verdad y nadie concilia sus valores con
  `SOCIO_CERTIFICACIONES`. Fuera de alcance por decisión explícita ya
  confirmada (spec, sección 5, pregunta #1), documentado para que no sea
  una sorpresa en el futuro.
