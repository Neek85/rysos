# Spec — PK surrogate UUID + unicidad de códigos por organización en `PADRON_SOCIOS`/`PADRON_PARCELAS`

- **Estado:** Auditoría completa, diseño confirmado ("opción B") — spec y
  plan de ejecución, **sin migración SQL ni cambios de código todavía**.
- **Fecha:** 2026-08-25
- **Precede a:** la migración SQL real (paso siguiente de esta secuencia,
  no incluida acá) y los cambios de código en `lib/`/`app/`/`components/`
  que este documento enumera.
- **Contexto previo:** `ADR-023` (adopción de `PADRON_SOCIOS`/
  `PADRON_PARCELAS` al historial de migraciones), `ADR-024` (normalización
  de tipo `hbp`/`otros_cultivo`, y el hallazgo de `vw_parcelas_web` como
  dependencia de esquema invisible al grep que rompió el primer intento de
  esa migración — el mismo patrón de auditoría se repite acá, ampliado a
  `pg_depend`/`pg_constraint` en vez de solo grep de código).

## Contexto y motivación

Confirmado en vivo (INSERT real, error `23505`): hoy la unicidad de
`ID_Socio` (`PADRON_SOCIOS`) y `ID_Parcela_Fija` (`PADRON_PARCELAS`) es la
Primary Key misma de cada tabla — **global entre todas las
organizaciones**, no un índice por-tenant. Una organización no puede tener
su propio `ID_Socio = "JS-00001"` si otra organización ya lo usó, aunque
sean cooperativas completamente distintas.

**Meta:** que cada organización pueda usar su propio esquema de
códigos (`ID_Socio`, `ID_Parcela_Fija`) sin colisionar con el de otra.
Diseño ya confirmado en la sesión de arquitectura ("opción B"):

1. Nueva columna `id` — `uuid PRIMARY KEY DEFAULT gen_random_uuid()` —
   reemplaza a `ID_Socio`/`ID_Parcela_Fija` como Primary Key de cada
   tabla.
2. `ID_Socio`/`ID_Parcela_Fija` dejan de ser PK, pasan a ser columnas
   normales (siguen existiendo, mismo tipo `text`, sin cambio de
   contrato de datos en sí).
3. `UNIQUE (ID_Organizacion, ID_Socio)` en `PADRON_SOCIOS`,
   `UNIQUE (ID_Organizacion, ID_Parcela_Fija)` en `PADRON_PARCELAS` —
   unicidad ahora es por-organización, no global.

**Consecuencia central de este cambio, motivo de esta auditoría:** el
schema deja de garantizar por sí mismo que `ID_Socio`/`ID_Parcela_Fija`
identifiquen una única fila. **Cualquier lugar — de esquema o de código —
que use solo esa columna sin acompañarla de `ID_Organizacion` en la misma
operación puede volverse ambiguo o devolver/afectar la fila equivocada de
otra organización.** El hallazgo de `vw_parcelas_web` en `ADR-024` (una
dependencia de esquema invisible al grep de código, que rompió esa
migración en Supabase Studio) es la razón por la que esta auditoría cubre
`pg_constraint`/`pg_depend` explícitamente, no solo `grep` sobre `lib/`.

## Metodología y limitación real de herramientas (leer antes de confiar en "ninguna dependencia encontrada")

Igual que en `ADR-024`, **este entorno de desarrollo no tiene conexión
Postgres directa** (confirmado, no asumido — mismo hallazgo documentado en
`AI_STATE.md` 2026-08-25b: sin RPC de propósito general, sin
`DATABASE_URL`/`psycopg2`, el único uso de `psycopg2` del repo corre
exclusivamente dentro de QGIS Desktop). No fue posible correr
`pg_depend`/`pg_constraint`/`pg_attrdef`/`pg_class.relrowsecurity`
directamente. Toda la evidencia de este documento viene de tres fuentes
**reales, no supuestas**:

1. **Introspección OpenAPI de PostgREST** (Service Role Key) — expone,
   para cada uno de los 44 objetos servidos por PostgREST: columnas,
   tipos, nulabilidad (`required`), PK (`<pk/>` en la descripción), FK
   (`<fk table='...' column='...'/>` en la descripción) y `DEFAULT`. Es el
   mismo mecanismo que ya destrabó el hallazgo de `vw_parcelas_web`.
2. **Consultas REST reales de solo lectura** contra la instancia viva
   (conteos, filtros `is.null`, comparación de columnas fila-a-fila).
3. **Historial completo de `supabase/migrations/*.sql`** — grep exhaustivo
   de las 21 migraciones que tocan `PADRON_SOCIOS`/`PADRON_PARCELAS`,
   confirmando el orden real de aplicación vía `git log` (no solo el
   nombre del archivo) para identificar cuál definición de cada vista
   redefinida más de una vez es la vigente hoy.

**Lo que esto NO cubre** (gap real, ver "Preguntas abiertas" al final):
funciones o reglas que no estén expuestas por PostgREST ni declaradas en
una migración de este repo, y cualquier objeto creado directamente en
Supabase Studio sin dejar rastro en el historial de migraciones (como
pasó con `vw_parcelas_web` mismo, y con `PADRON_SOCIOS`/`PADRON_PARCELAS`
antes de `ADR-023`). La recomendación concreta para la tarea de
implementación (no esta) es correr el mismo tipo de script de diagnóstico
de solo lectura contra `pg_depend`/`pg_constraint` que destrabó
`vw_parcelas_web` en `AI_STATE.md`, **antes** de escribir la migración SQL
real, no después de que falle.

## Hallazgos de la auditoría de esquema

### 1. FKs reales apuntando a estas dos PK — ninguna encontrada

Vía las anotaciones `<fk table='...' column='...'/>` que PostgREST agrega
automáticamente a cada columna con FK real (mismo mecanismo que reveló
`PARCELAS.ID_Inspeccion → INSPECCIONES.ID_Inspeccion`), se revisaron
`INSPECCIONES`, `EUDR_MONITOREO`, `EUDR_USO_SUELO`, `EUDR_INSTALACIONES`
(las 4 tablas que sí tienen columnas `ID_Socio`/`ID_Parcela_Fija`, por
`docs/schema_live.md`/`ADR-007`): **ninguna anotación FK hacia
`PADRON_SOCIOS`/`PADRON_PARCELAS`.** Coincide exactamente con lo que
`ADR-002`/`ADR-007` ya documentaban ("sin FK real"). No hay ningún FK que
la migración necesite migrar a la nueva columna `id` — el cambio de PK no
rompe ninguna FK real porque no existe ninguna.

*Caveat:* esta técnica solo ve columnas de tablas que PostgREST expone
(prácticamente todo el esquema `public` de este proyecto, confirmado por
los 44 objetos listados). No cubriría una FK desde un objeto no expuesto.

### 2. Vistas dependientes — 4 encontradas, 2 de ellas con un riesgo estructural real

| Vista | Depende de | Definición vigente | Riesgo tras el cambio de PK |
|---|---|---|---|
| `vw_parcelas_web` | Columnas de `PADRON_PARCELAS` (sin JOIN) | `supabase/migrations/20260825142426_normaliza_tipo_hbp_otros_cultivo.sql` (recreada en la tarea anterior) | Ninguno — `SELECT` plano de columnas, ninguna es la PK ni depende de su unicidad. Sigue funcionando igual. |
| `vw_socios_web` | Columna `ID_Socio` de `PADRON_SOCIOS` (confirmado por introspección — no expone `hbp`/`otros_cultivo`, sí expone `normas_internas_17`) | No versionada en ningún migration (mismo caso que `vw_parcelas_web` antes del hallazgo de `ADR-024` — creada fuera de este repo) | Ninguno estructural — expone `ID_Socio` como columna simple, no como PK. Candidata a agregar la nueva columna `id` si algún consumidor la necesita (ninguno conocido hoy, ver más abajo). |
| **`vw_monitoreo_web`** | `LEFT JOIN PADRON_PARCELAS pp ON src."ID_Parcela_Fija" = pp."ID_Parcela_Fija"` y `LEFT JOIN PADRON_SOCIOS ps ON ps."ID_Socio" = COALESCE(src.productor, mon.productor)` — **sin `ID_Organizacion` en el `JOIN`** | `supabase/migrations/20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql` (confirmado el más reciente vía `git log --date=iso-strict`, 2026-08-19T22:54:32) | **Alto.** Es la única vista que lee el Dashboard (`components/gis/MapDashboard.jsx`, ver `CLAUDE.md`). Una vez que dos organizaciones compartan un `ID_Parcela_Fija`/`ID_Socio`, el `LEFT JOIN` hace fan-out: cada fila de `EUDR_MONITOREO` puede emparejar con **más de una** fila de `PADRON_PARCELAS`/`PADRON_SOCIOS` (una por organización que use ese código), duplicando filas en el dashboard o mostrando `parcela_nombre`/`socio_nombre_completo` de la organización equivocada. |
| **`view_eudr_dashboard_aprobados`** | `LEFT JOIN PADRON_PARCELAS p ON m."ID_Parcela_Fija" = p."ID_Parcela_Fija"` y `LEFT JOIN PADRON_SOCIOS s ON m."ID_Socio" = s."ID_Socio"` — mismo patrón, **sin `ID_Organizacion`** | `supabase/migrations/20260818_fix_dashboard_view_columns.sql` (confirmado el más reciente de 3 redefiniciones del mismo día vía `git log --date=iso-strict`: `20260815_fix_rls_policies.sql` 08-15 → `20260818_rls_multi_tenant_fortification.sql` 08-18T15:57 → `20260818_fix_dashboard_view_columns.sql` 08-18T19:44) | **Alto.** Usada por `app/page.jsx` (`CLAUDE.md`). Mismo riesgo de fan-out que `vw_monitoreo_web`. |

**Esto es el hallazgo estructural más importante de toda la auditoría.**
Ambas vistas (`vw_monitoreo_web`, `view_eudr_dashboard_aprobados`) deben
agregar `AND pp."ID_Organizacion" = src."ID_Organizacion"` (o el alias que
corresponda) a su `JOIN`, **como parte de la misma migración que cambia la
PK** — no es opcional ni puede quedar para después, porque el fan-out
recién se activa cuando existan dos organizaciones con el mismo código, lo
cual la migración de PK habilita explícitamente.

### 3. Triggers — 2 encontrados, no afectados por el cambio de PK en sí

`trg_auto_org_padron_socios`/`trg_auto_org_padron_parcelas`
(`BEFORE INSERT`, función `public.trg_set_id_organizacion()`,
`supabase/migrations/20260815_fix_rls_policies.sql`): si
`NEW."ID_Organizacion"` viene `NULL` o `''`, lo rellena con
`public.get_my_org_id()` (claim JWT). Operan sobre la columna
`ID_Organizacion`, no sobre la PK ni sobre `ID_Socio`/`ID_Parcela_Fija` —
**no requieren cambios** por el cambio de PK en sí. Sí son la explicación
real de por qué `ID_Organizacion` es nullable en el schema hoy (protegido
por trigger con fallback, no por `NOT NULL`) — ver hallazgo 4.

### 4. Filas con `ID_Organizacion` NULL hoy — ninguna, pero el schema no lo impide

Verificado en vivo (REST real, `ID_Organizacion=is.null`, Service Role
Key, 2026-08-25): **0 filas** en `PADRON_SOCIOS` y **0 filas** en
`PADRON_PARCELAS` (de 7 y 11 filas totales respectivamente — mismos
conteos base de `ADR-023`). `ID_Organizacion` **no está en el `required`**
de ninguna de las dos tablas por introspección OpenAPI — es decir, es
nullable a nivel de schema. Su protección hoy es exclusivamente el
trigger `trg_set_id_organizacion` (hallazgo 3), que solo actúa en
`INSERT`, nunca en `UPDATE`, y que rellena con `get_my_org_id()` — una
función basada en claim JWT que, según `CLAUDE.md`, nunca tiene un valor
real en este proyecto (no hay sesión de Supabase Auth), así que en la
práctica ese fallback nunca dispara con un valor útil; el valor real
siempre lo pone explícitamente el código de la app (`ID_Organizacion:
organizationId` en `createSocio`/`createParcela`, `sociosActions.js`).

**Recomendación para la migración de implementación (no esta tarea):**
agregar `ALTER COLUMN "ID_Organizacion" SET NOT NULL` junto con el nuevo
`UNIQUE (ID_Organizacion, ID_Socio)` — un `UNIQUE` compuesto **no**
protege contra duplicados si `ID_Organizacion` es `NULL` (los `NULL` no se
consideran iguales entre sí en una constraint `UNIQUE` de Postgres,
así que dos filas con `ID_Organizacion = NULL` y el mismo `ID_Socio`
pasarían el `UNIQUE` sin error). Sin filas `NULL` hoy, el `SET NOT NULL`
sería seguro de aplicar, pero es una decisión explícita a confirmar en la
tarea de implementación, no un hecho ya decidido acá.

### 5. `gen_random_uuid()` — confirmado disponible, ya en uso real

No fue necesario verificar la extensión `pgcrypto`/versión de Postgres por
SQL crudo: **ya existe evidencia directa en el schema real** —
`CONFIGURACION_REPORTES_ORG.id_config` y `METADATOS_CAMPOS.id_campo`
(ambas del módulo de reportes, Fase 6) ya tienen `DEFAULT
gen_random_uuid()` funcionando en la instancia real hoy (confirmado por
introspección OpenAPI — un `DEFAULT` solo puede quedar registrado así si
la función resolvió correctamente al crear la columna). `uuid-ossp`
también está disponible por separado (`EUDR_MONITOREO.id_monitoreo` usa
`extensions.uuid_generate_v4()`), pero `gen_random_uuid()` específicamente
— la función que pide el diseño confirmado — ya es utilizable sin ninguna
extensión ni migración adicional.

### 6. RLS — confirmado habilitado, con matiz sobre la advertencia de Studio

`ALTER TABLE public."PADRON_SOCIOS"/"PADRON_PARCELAS" ENABLE ROW LEVEL
SECURITY` aparece en **3 migraciones distintas** del historial
(`20260815_fase1_security_storage.sql`, `20260816_fase3_seguridad_rls.sql`,
`20260818_fix_inspecciones_rls.sql`), con políticas activas hoy:
`rls_select_padron_socios`/`rls_write_padron_socios` (scope
`authenticated`, `USING ("ID_Organizacion" = public.get_my_org_id())`) y
`rls_anon_select_padron_socios`/`rls_anon_select_padron_parcelas` (scope
`anon`, **`USING ("ID_Organizacion" IS NOT NULL)`** — nótese: exige
no-nulo, **no** exige igualdad a una organización específica, porque
`anon` nunca tiene un JWT claim real que comparar). Análogo para
`PADRON_PARCELAS`.

La advertencia que el usuario reportó en Supabase Studio al correr la
migración base (`20260825183000_baseline_padron_socios_parcelas.sql`) es
casi seguro sobre el propio `CREATE TABLE IF NOT EXISTS` — el linter de
Studio no distingue "esta tabla ya existe con RLS habilitado hace tiempo"
de "esta sentencia SQL no incluye ninguna cláusula RLS" y advierte sobre
el texto del SQL, no sobre el estado real de la tabla. **Esto es una
inferencia, no una confirmación directa** — ver "Preguntas abiertas".

## Auditoría de código de aplicación

Alcance: `lib/`, `app/`, `components/` — `grep` confirma que ningún
`.jsx` de `components/`/`app/` consulta Supabase directamente (arquitectura
ya establecida de Server Actions + hooks en páginas `'use client'`, ver
`CLAUDE.md`); todo el acceso a datos vive en `lib/`.

### Ya correctamente scopeados por organización — no requieren cambio

- `lib/padronSearch.js` (`searchSocios`, `searchParcelas`) — `.eq('ID_Organizacion', organizationId)` antes de cualquier otro filtro.
- `lib/actions/sociosActions.js`: `assertDniNotDuplicated`, `assertCodigoFincaNotDuplicated`, `assertParcelaCodigoNotDuplicated` — las 3 ya incluyen `.eq('ID_Organizacion', organizationId)`.
- `lib/actions/sociosActions.js`: `createSocio` (línea 276-278), `createParcela` (línea 372-377) — `INSERT` con `ID_Organizacion: organizationId` explícito; dependen de que el nuevo `UNIQUE(ID_Organizacion, ID_Socio/ID_Parcela_Fija)` siga lanzando `23505` en duplicado (lo hace, es el comportamiento estándar de Postgres para cualquier constraint único) — `friendlyDuplicateError` ya chequea `error.code === '23505'` de forma genérica, no atado al nombre de la constraint vieja, así que sigue funcionando sin cambios.
- `lib/actions/gisActions.js`: `resolveQfieldRelationId` (línea 138-142) — `.eq('ID_Parcela_Fija', idParcelaFija).eq('ID_Organizacion', organizationId)` ya combinados. **Este es el patrón modelo a replicar** en los sitios de la sección siguiente.
- `lib/padronCsv.js`: `applySocioDbChecks`/`applyParcelaDbChecks`/`fetchExistingCodes` — las 6 consultas que tocan `PADRON_SOCIOS`/`PADRON_PARCELAS` ya filtran por `.eq('ID_Organizacion', organizationId)` antes del `.in(...)`. **Confirmado (punto 7 del prompt): no existe ningún `.upsert()` en todo el repo** (`grep` literal, cero resultados) — la carga masiva del CSV escribe fila por fila vía `createSocio`/`updateSocio`/`createParcela`/`updateParcela` (ya auditados arriba), no un `upsert` con `onConflict` implícito sobre la PK vieja. No hay ningún `onConflict` que reescribir.
- `scripts/etl_drive_to_supabase.py::warn_socio_org_mismatch` — fuera del alcance literal de `lib/`/`app/`/`components/` del prompt, pero encontrado en el mismo grep amplio y vale la pena confirmar: usa `.execute()` y itera `result.data or []` (nunca `.single()`), ya tolera 0, 1 o más filas devueltas — **sigue funcionando correctamente sin cambios** tras el cambio de PK. Es, además, código *ya diseñado* para el caso de códigos duplicados entre organizaciones (su propio docstring lo documenta como el gap que resuelve ADR-020) — el más preparado de todo el repo para este cambio.

### Sitios a modificar — lecturas con `.maybeSingle()` que pueden lanzar error con múltiples filas

Con `UNIQUE(ID_Organizacion, ID_Socio)` en vez de PK global, dos
organizaciones pueden compartir el mismo `ID_Socio`/`ID_Parcela_Fija`. Un
`.eq('ID_Socio', x).maybeSingle()` sin `.eq('ID_Organizacion', ...)` deja
de devolver 0-o-1 filas garantizado — con 2+ filas, Postgrest-js lanza un
error (`PGRST116`, "multiple (or no) rows returned") en vez de fallar
silenciosamente. Hay que decidir, sitio por sitio, si agregar el filtro de
organización (cuando ya se conoce) o cambiar `.maybeSingle()` por una
lista y decidir qué hacer con más de una coincidencia:

- `lib/eudrQcActions.js:383` — dentro de la detección de conflicto de
  código de parcela (`ID_Parcela_Fija` sin filtro de org — es
  intencional hoy, busca CUALQUIER organización que ya use ese código
  para reportar el conflicto; con el nuevo diseño, "cualquier
  organización" ya no es ambiguo por definición — hay que decidir si
  reportar todas las coincidentes o solo la primera).
- `lib/eudrQcActions.js:409` — mismo patrón para `ID_Socio`.
- `lib/actions/sociosActions.js:44-48` (`assertMatchesExistingOrg`,
  genérico — usado por `updateSocio` línea 300, `deactivateSocio` línea
  442) — mismo riesgo de `.maybeSingle()`.
- `lib/actions/sociosActions.js:73-77` (`assertParcelaMatchesOrg`, rama
  parcela) y línea 84-87 (rama socio de respaldo dentro de la misma
  función) — mismo patrón.
- `lib/actions/sociosActions.js:217-220` (`assertSocioExists`) — mismo
  patrón.
- `lib/actions/gisActions.js:69-72` (`assertSocioActivoOSinValor`) y
  línea 87-90 (`assertParcelaActivaOSinValor`) — mismo patrón.

### Sitios a modificar — escrituras (`UPDATE`) sin `ID_Organizacion` en el propio `WHERE`

Más severo que los anteriores: estas sentencias `UPDATE` dependen
**enteramente** de que el guard (`assertMatchesExistingOrg`/
`assertParcelaMatchesOrg`, ya listados arriba) haya lanzado antes de
llegar acá. Incluso si el guard queda correctamente reescrito para el
nuevo diseño, el propio `.update(...).eq('ID_Socio', x)` **sin**
`.eq('ID_Organizacion', ...)** coincide con TODAS las filas de todas las
organizaciones que compartan ese código — no solo con la de la
organización activa. Es defensa en profundidad real, no redundancia:

- `lib/actions/sociosActions.js:304-307` (`updateSocio`).
- `lib/actions/sociosActions.js:403-406` (`updateParcela`).
- `lib/actions/sociosActions.js:444-447` (`deactivateSocio`).
- **`lib/actions/sociosActions.js:457-460`** (`deactivateSocio`, cascada a
  `PADRON_PARCELAS`) — `.update({activo:false}).eq('ID_Socio', socioId)`
  sin filtro de organización. **El más peligroso de toda la lista**: dar
  de baja un socio en la organización A desactivaría también las parcelas
  de cualquier socio con el mismo `ID_Socio` en la organización B.
- `lib/actions/sociosActions.js:476-479` (`deactivateParcela`).

### Hallazgo estructural adicional, fuera del listado literal de `.eq()` pero encontrado en la misma auditoría de código — el más importante junto con las vistas

`lib/sociosSearch.js::fetchSocios` (línea 28-58, la consulta que alimenta
la tabla principal de `/dashboard/socios`) **no filtra por
`ID_Organizacion` en absoluto**. Esto **ya está documentado como un gap
conocido** en un comentario del propio `app/dashboard/socios/page.jsx`
(líneas 38-48): *"esta tabla no filtra por ID_Organizacion... la página
puede mostrar socios de más de una organización a la vez"* — con RLS anon
actual (`USING ("ID_Organizacion" IS NOT NULL)`, sin igualdad), esto ya
mezcla organizaciones **hoy**, en cualquier entorno con más de una
organización de prueba (`COOP-JS`, `COOP-ND`, `ORG-TEST-E2E` existen
simultáneamente en este momento). Con PK global, esa mezcla era solo una
UI confusa — cada `ID_Socio` seguía siendo único, sin colisión real de
datos. **Tras el cambio de PK, dos filas con el mismo `ID_Socio` de dos
organizaciones distintas aparecerían ambas en esta misma lista sin forma
de distinguirlas por el código solo** (aunque `ID_Organizacion` sí viene
en `SOCIO_COLUMNS` y podría mostrarse/usarse para desambiguar en la UI).

Consecuencia directa: `components/features/socios/ParcelaFormModal.jsx:146`
llama `fetchParcelasBySocio(supabase, socio.ID_Socio)` — **sin**
`socio.ID_Organizacion`, pese a que ese campo ya está disponible en el
objeto `socio` cargado (mismo patrón que el propio comentario de la
página ya recomienda seguir para edición/baja). `fetchParcelasBySocio`
(`lib/sociosSearch.js:65-76`) tendría que aceptar y filtrar por
`organizationId`.

Esta tarea **no corrige** `fetchSocios`/`fetchParcelasBySocio` — solo lo
documenta como el hallazgo de código más severo, porque el gap ya existe
hoy (no lo introduce esta migración) pero el cambio de PK lo convierte de
"UI confusa" a "datos de la organización equivocada mostrados/afectados".
Se recomienda resolverlo en la misma tarea de implementación que agrega
el `id` UUID, no dejarlo para después — ver plan de ejecución.

## Preguntas abiertas (sin evidencia clara — no asumidas)

1. **Objetos no expuestos por PostgREST ni versionados en este repo**
   (funciones, reglas, u otra vista creada directamente en Studio sin
   dejar rastro — como pasó con `vw_parcelas_web`/`vw_socios_web` antes
   de esta auditoría). No verificable desde este entorno sin SQL crudo.
   **Antes de escribir la migración SQL real** (tarea siguiente, no
   esta), correr un script de diagnóstico de solo lectura tipo
   `pg_depend`/`pg_constraint` contra `ID_Socio`/`ID_Parcela_Fija` y la
   constraint de PK misma, mismo patrón que destrabó `ADR-024` — no
   confiar solo en esta auditoría basada en PostgREST/migraciones.
2. **Causa exacta de la advertencia de RLS de Supabase Studio** al correr
   la migración base — inferido (probablemente sobre el propio `CREATE
   TABLE IF NOT EXISTS` sin cláusula RLS inline), no confirmado
   directamente contra el texto real de la advertencia.
3. **Consumidores externos de `vw_parcelas_web`/`vw_socios_web`** fuera de
   este repo — ya señalado como no confirmado en `ADR-024`, sigue sin
   resolverse acá; no bloquea este spec porque ninguna de las dos vistas
   tiene el problema de fan-out (no hacen `JOIN`).
4. **Si `vw_socios_web` necesita exponer la nueva columna `id`** — ningún
   consumidor conocido de esta vista existe en el código de este repo
   (mismo hallazgo que `vw_parcelas_web` en `ADR-024`: cero referencias
   vía grep literal), así que no hay un requisito conocido, pero tampoco
   se puede descartar un consumidor externo.
