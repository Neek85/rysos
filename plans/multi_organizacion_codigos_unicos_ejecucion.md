# Plan de ejecución — PK surrogate UUID + unicidad por organización

Ver `specs/multi_organizacion_codigos_unicos.md` para el diseño completo,
la auditoría de esquema/código y las preguntas abiertas. Este documento es
la secuencia concreta de pasos para la(s) tarea(s) de implementación
siguientes — **ninguno de estos pasos se ejecuta en esta tarea**, que fue
solo de auditoría.

## Orden recomendado

### 0. Prerrequisito — cerrar la pregunta abierta #1 antes de escribir SQL

Correr un script de diagnóstico de solo lectura contra `pg_depend`/
`pg_constraint`/`pg_rewrite` (mismo patrón que destrabó `vw_parcelas_web`
en `ADR-024`/`AI_STATE.md` 2026-08-25b) para `PADRON_SOCIOS.ID_Socio` y
`PADRON_PARCELAS.ID_Parcela_Fija` **y también contra la constraint de PK
misma** (no solo las columnas — una vista podría depender de la PK vía
`REFERENCES` sin seleccionar la columna directamente, aunque la auditoría
de esta spec no encontró ningún FK real). Confirmar que la lista de 4
vistas de la spec (`vw_parcelas_web`, `vw_socios_web`, `vw_monitoreo_web`,
`view_eudr_dashboard_aprobados`) es completa antes de continuar. Si
aparece algo nuevo, no adivinar su definición — mismo criterio que
`ADR-024`: pedir `pg_get_viewdef`/`GRANT`s exactos.

### 1. Migración SQL — cambio de PK y unicidad por organización

`supabase/migrations/<timestamp>_multi_organizacion_codigos_unicos.sql`,
idempotente (mismo estilo que `ADR-023`/`ADR-024`: envuelto en
`BEGIN;`/`COMMIT;`, con un chequeo previo que hace no-op una segunda
corrida si `id` ya existe como PK). Dentro de la misma transacción:

1. `DROP VIEW` de las 4 vistas dependientes confirmadas (con su
   definición exacta guardada de antemano, igual que `ADR-024`).
2. `PADRON_SOCIOS`: `ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid()`
   → `DROP CONSTRAINT` de la PK vieja (`ID_Socio`) → `ADD PRIMARY KEY
   (id)` → `ADD CONSTRAINT UNIQUE (ID_Organizacion, ID_Socio)`.
3. Mismo patrón para `PADRON_PARCELAS` con `ID_Parcela_Fija`.
4. Decidir explícitamente (no asumir) si se agrega
   `ALTER COLUMN "ID_Organizacion" SET NOT NULL` en ambas tablas — la
   spec confirmó 0 filas NULL hoy, así que es seguro de aplicar, pero es
   una decisión de esta tarea, documentarla en el ADR correspondiente.
5. `CREATE VIEW` de las 4 vistas — para `vw_monitoreo_web` y
   `view_eudr_dashboard_aprobados`, **el `JOIN` debe agregar
   `AND ... "ID_Organizacion" = ...`** (la corrección estructural
   encontrada en la spec, sección "Vistas dependientes") — no es
   opcional, es la razón por la que estas dos vistas están en la lista de
   "riesgo alto".
6. Reaplicar los `GRANT`s exactos de cada vista recreada (capturados en
   el paso 0/diagnóstico).

### 2. ADR nuevo — siguiente número disponible tras `ADR-024`

Documentar: el diseño (`id` UUID + `UNIQUE` compuesto), la decisión sobre
`NOT NULL` en `ID_Organizacion`, el fix de `JOIN` en las 2 vistas de
riesgo alto, y una referencia a esta spec/plan.

### 3. Cambios de código — en el orden de severidad de la spec

1. **Primero, el hallazgo estructural más severo**: `lib/sociosSearch.js`
   (`fetchSocios` — agregar filtro por `ID_Organizacion`;
   `fetchParcelasBySocio` — agregar parámetro `organizationId`) y su
   callsite `components/features/socios/ParcelaFormModal.jsx:146`
   (pasar `socio.ID_Organizacion`). Este es un gap *ya existente* que la
   spec documenta, no introducido por esta migración — corregirlo acá
   evita que dejen de tener sentido el resto de los fixes de esta lista.
2. **Escrituras sin scope de organización** (la lista de mayor riesgo de
   la spec): agregar `.eq('ID_Organizacion', organizationId)` al `WHERE`
   real de cada `UPDATE` en `lib/actions/sociosActions.js` — `updateSocio`
   (línea ~307), `updateParcela` (~406), `deactivateSocio` (~447 y la
   cascada de la línea ~460, la más peligrosa de toda la auditoría),
   `deactivateParcela` (~479).
3. **Guards con `.maybeSingle()`** — reescribir
   `assertMatchesExistingOrg`/`assertParcelaMatchesOrg`/`assertSocioExists`
   (`lib/actions/sociosActions.js`) y
   `assertSocioActivoOSinValor`/`assertParcelaActivaOSinValor`
   (`lib/actions/gisActions.js`) para filtrar por `ID_Organizacion` cuando
   ya se conoce (la mayoría de los callers ya tienen `organizationId`
   disponible), en vez de depender de que `.maybeSingle()` nunca vea más
   de una fila.
4. **Detección de conflictos entre organizaciones**
   (`lib/eudrQcActions.js:383` y `:409`) — decidir el comportamiento con
   evidencia de la spec: antes, "cualquier organización que use este
   código" era necesariamente 0 o 1 fila; ahora puede ser varias. Definir
   si se reportan todas o solo la primera coincidencia.
5. Confirmar que `createSocio`/`createParcela` (ya scopeados, sin cambio
   de código) siguen devolviendo el mensaje de error amigable esperado
   tras el cambio de constraint — `friendlyDuplicateError` ya chequea
   `error.code === '23505'` de forma genérica, debería seguir funcionando
   sin cambios, pero verificarlo con una prueba real (paso 5 abajo).

### 4. Tests

- `tests/test_multi_organizacion_codigos_unicos.py` (estático, mismo
  patrón que `tests/test_padron_baseline_adopcion.py`/
  `tests/test_normaliza_tipo_hbp_otros_cultivo.py`): confirma la
  migración — `id` como nueva PK, `UNIQUE` compuesto presente, el `JOIN`
  corregido en las 2 vistas de riesgo alto (buscar el patrón
  `AND ... "ID_Organizacion"` dentro del bloque `CREATE VIEW`), GRANTs
  reaplicados.
- `tests/test_socios_schema.mjs`/`tests/test_padron_csv.mjs` (Node,
  existentes) — correr y confirmar que ningún test asume la PK vieja
  implícitamente.
- Prueba manual/E2E con datos de prueba (`ORG-TEST-E2E` + una segunda org
  de prueba nueva) creando el MISMO `ID_Socio`/`ID_Parcela_Fija` en ambas
  — confirmar que el `UNIQUE` compuesto lo permite, que
  `/dashboard/socios` no los mezcla tras el fix de `fetchSocios`, y que
  `vw_monitoreo_web`/`view_eudr_dashboard_aprobados` no hacen fan-out.
  Limpiar los datos de prueba al final (mismo criterio de siempre:
  conteos antes/después).

### 5. Build + suite completa + aplicación manual

`npm run build`, `node --test tests/*.mjs`, `python -m pytest tests/ -v`
— mismo criterio de siempre. Aplicación real de la migración en Supabase
Studio la hace el usuario manualmente, mismo flujo establecido en todo
este proyecto.

## Riesgos y mitigaciones

- **El riesgo más alto de todo este cambio es el fan-out silencioso en
  `vw_monitoreo_web`/`view_eudr_dashboard_aprobados`** si el `JOIN` no se
  corrige en la misma migración — a diferencia de un error de código, un
  `JOIN` sin filtro de organización no falla, **produce datos
  incorrectos silenciosamente** (filas duplicadas o del socio/parcela
  equivocado). Mitigación: el paso 1.5 de este plan lo trata como
  obligatorio, no opcional, y el paso 4 incluye una prueba manual
  específica para esto con dos organizaciones reales compartiendo un
  código.
- **Cascada de `deactivateSocio` hacia `PADRON_PARCELAS`
  (`sociosActions.js:460`)** sin scope de organización es el sitio de
  código de mayor riesgo — un error acá desactiva datos reales de otra
  organización, no solo devuelve una fila incorrecta. Mitigación: primero
  en la lista de escrituras a corregir (paso 3.2), con su propia prueba
  manual explícita.
- **No se puede garantizar con esta auditoría que no exista ningún otro
  objeto de esquema no versionado** (pregunta abierta #1 de la spec).
  Mitigación: paso 0 de este plan, obligatorio antes de escribir la
  migración SQL real — no repetir el error de la migración de `ADR-024`
  que se descubrió recién al fallar en producción.
