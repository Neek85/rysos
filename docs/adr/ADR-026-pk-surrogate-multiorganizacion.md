# ADR-026 — PK surrogate UUID + unicidad de códigos por organización en `PADRON_SOCIOS`/`PADRON_PARCELAS`

- **Estado:** Aceptado — migración escrita, código corregido, tests
  nuevos pasando. Pendiente de aplicación manual en Supabase Studio
  (mismo flujo de siempre en este repo).
- **Fecha:** 2026-08-25
- **Migraciones:** `supabase/migrations/20260825201351_pk_surrogate_multiorganizacion.sql`
- **Spec/Plan:** `specs/multi_organizacion_codigos_unicos.md` (auditoría
  del paso 2, commit `641e028`), `plans/multi_organizacion_codigos_unicos_ejecucion.md`
- **Tests:** `tests/test_pk_surrogate_multiorganizacion.py` (13 estáticos
  + 6 funcionales contra Supabase Live, auto-skip hasta aplicar la
  migración), `tests/test_pk_surrogate_code_sites.mjs` (8 estructurales)
- **Contexto previo:** `ADR-023`/`ADR-024` (adopción del padrón y
  normalización de tipo, mismo protocolo de "capturar exacto, no
  adivinar" reutilizado acá para las 2 vistas del Dashboard), `ADR-025`
  (investigación de RLS, evidencia reutilizada para confirmar que las
  políticas no dependen de la PK)

## Contexto

Confirmado en vivo (INSERT real, error `23505`): la unicidad de
`ID_Socio`/`ID_Parcela_Fija` era la Primary Key misma de cada tabla —
global entre organizaciones. La auditoría del paso 2
(`specs/multi_organizacion_codigos_unicos.md`) encontró que esto bloquea
que dos organizaciones distintas usen el mismo código de socio/parcela, y
enumeró exhaustivamente qué esquema y qué código dependían de esa
unicidad global. Esta tarea implementa el diseño ya confirmado
("opción B"): PK surrogate `id` (UUID) + `UNIQUE(ID_Organizacion,
ID_Socio/ID_Parcela_Fija)`.

Empaqueta, en una sola migración/PR, las 4 cosas que la auditoría marcó
como inseparables: (1) el cambio de PK en sí, (2) el fix de las 2 vistas
del Dashboard con `JOIN` sin filtro de organización (riesgo de fan-out),
(3) el fix de la cascada `deactivateSocio` (el sitio de código más
peligroso de la auditoría), (4) el resto de sitios de código listados.

## Re-verificación inmediatamente antes de escribir la migración

Mismo criterio que `ADR-024`: no confiar ciegamente en la auditoría
previa, aunque sea del mismo día. Re-confirmado en vivo (introspección
OpenAPI de PostgREST + REST real, Service Role Key, 2026-08-25):

- **0 filas con `ID_Organizacion` NULL** en `PADRON_SOCIOS` (7 filas
  totales) y `PADRON_PARCELAS` (11 filas totales) — mismos conteos que la
  auditoría, sin cambios.
- **`gen_random_uuid()` sigue en uso real** (`CONFIGURACION_REPORTES_ORG.id_config`,
  `METADATOS_CAMPOS.id_campo`).
- **Ninguna de las 6 políticas RLS** de `PADRON_SOCIOS`/`PADRON_PARCELAS`
  (`ryzos_all_padron_socios`/`ryzos_all_padron_parcelas` de Fase 1,
  `rls_select_padron_socios`/`rls_write_padron_socios`/
  `rls_select_padron_parcelas`/`rls_write_padron_parcelas` de Fase 3,
  `rls_anon_select_padron_socios`/`rls_anon_select_padron_parcelas`)
  referencia `ID_Socio`, `ID_Parcela_Fija`, ni ninguna constraint de PK
  en su `USING`/`WITH CHECK` — leídas línea por línea de las 3 migraciones
  que las definen, todas son puramente sobre `"ID_Organizacion"`. El
  `ALTER` de la PK no las afecta.
- **Ninguna anotación FK de PostgREST** apunta a estas dos PK desde
  `INSPECCIONES`/`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`
  — sigue sin existir ningún FK real (mismo resultado que la auditoría).
- **Ningún migration nuevo** desde el commit de la auditoría (`641e028`)
  toca `PADRON_SOCIOS`/`PADRON_PARCELAS` o las 2 vistas del Dashboard
  (confirmado con `git log`/`ls` sobre `supabase/migrations/`) — las
  definiciones capturadas siguen vigentes.

## Decisión de diseño de la migración

### 1. El nombre real de la PK vieja nunca se asumió

`PADRON_SOCIOS`/`PADRON_PARCELAS` se crearon fuera de este repo (ver
`ADR-023`) — el nombre real de su constraint de PK nunca quedó capturado
en ningún archivo. En vez de asumir la convención por defecto de Postgres
(`"PADRON_SOCIOS_pkey"`), cada bloque `DO $$` resuelve el nombre real en
vivo vía `pg_constraint`/`pg_attribute` antes de dropearlo
(`EXECUTE format('ALTER TABLE ... DROP CONSTRAINT %I', pk_name)`).

### 2. Idempotencia por columna de PK, no por nombre de constraint

Cada bloque chequea qué columna es HOY la primera columna de la PK
(`pk_col`); si ya es `id`, el bloque entero se saltea — no-op garantizado
en una segunda corrida, sin depender de nombres de constraint que
cambiarían entre la primera y la segunda ejecución.

### 3. `NOT NULL` en `ID_Organizacion`: guardado con `RAISE EXCEPTION`, no asumido

La auditoría recomendó `SET NOT NULL` junto al `UNIQUE` compuesto (un
`UNIQUE(ID_Organizacion, ID_Socio)` no protege contra duplicados si
`ID_Organizacion` es `NULL` — los `NULL` no se consideran iguales entre
sí en Postgres). Confirmado 0 filas `NULL` hoy, pero la migración no lo
asume ciegamente: verifica con un `SELECT EXISTS` y aborta con
`RAISE EXCEPTION` (deteniendo toda la transacción) si encuentra alguna,
en vez de forzar el `NOT NULL` y fallar con un error de Postgres menos
legible.

### 4. Las 2 vistas del Dashboard: `CREATE OR REPLACE VIEW`, no `DROP VIEW`

A diferencia de la migración de `hbp`/`otros_cultivo` (`ADR-024`), que
necesitó `DROP VIEW` porque `ALTER COLUMN TYPE` sí fuerza a soltar
cualquier vista dependiente — acá **no hace falta** dropear nada: cambiar
qué constraint es la PK no rompe ninguna vista que dependa de las
*columnas* `ID_Socio`/`ID_Parcela_Fija` (que no cambian de nombre ni de
tipo). `vw_monitoreo_web`/`view_eudr_dashboard_aprobados` se recrean con
`CREATE OR REPLACE VIEW`, que Postgres permite sin dropear siempre que la
lista de columnas de salida no cambie — y no cambia acá, solo se agrega
una condición al `JOIN`. Consecuencia práctica: **no hizo falta
recapturar ni reaplicar ningún `GRANT`** — `CREATE OR REPLACE VIEW`
preserva los existentes (`GRANT SELECT ... TO authenticated;`,
confirmado idéntico en las 9 redefiniciones históricas de ambas vistas)
automáticamente.

### 5. Las definiciones base de ambas vistas se copiaron exactas, no adivinadas

Mismo protocolo que destrabó `vw_parcelas_web` en `ADR-024`: se leyó el
archivo de migración vigente completo de cada vista
(`20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql`,
confirmado el más reciente vía `git log --date=iso-strict`;
`20260818_fix_dashboard_view_columns.sql`, confirmado el más reciente de
3 redefiniciones del mismo día) y se agregó **solo** la condición de
organización a cada `JOIN` — ningún otro cambio. `vw_monitoreo_web` tiene
3 `JOIN` afectados por rama (`pp`, `ps`, `ps_parcela`) × 2 ramas
(polígono/punto) = 6 puntos; `view_eudr_dashboard_aprobados` tiene 2. El
`WHERE` de `view_eudr_dashboard_aprobados`
(`m."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role'
OR current_user = 'postgres'`) queda intacto — no forma parte de este fix.

### 6. `vw_parcelas_web`/`vw_socios_web`: fuera de alcance, confirmado seguro

Ninguna de las dos hace `JOIN` (son `SELECT` planos de columnas de una
sola tabla) — no tienen el problema de fan-out y no dependen de la PK.
No se tocan.

## Fix de código — sitios corregidos

Todos los sitios listados en `specs/multi_organizacion_codigos_unicos.md`
quedaron corregidos:

- **`lib/actions/sociosActions.js`**: `assertMatchesExistingOrg`/
  `assertParcelaMatchesOrg` (genéricos, usados por `updateSocio`/
  `deactivateSocio`/`updateParcela`/`deactivateParcela`) ya no usan
  `.maybeSingle()` — pasan a traer todas las filas coincidentes y
  chequear si CUALQUIERA pertenece a otra organización, preservando el
  mensaje de error original exacto. `assertSocioExists` sí sigue usando
  `.maybeSingle()`, pero ahora filtrado por `ID_Socio` **y**
  `ID_Organizacion` juntos (organizationId ya es un dato conocido en su
  caller) — vuelve a garantizar 0-o-1 fila.
- **Escrituras**: `updateSocio`, `updateParcela`, `deactivateSocio`
  (incluida su cascada hacia `PADRON_PARCELAS` — el sitio más peligroso
  de toda la auditoría) y `deactivateParcela` ahora incluyen
  `.eq('ID_Organizacion', organizationId)` en el propio `WHERE` del
  `UPDATE`, no solo en el guard previo — defensa en profundidad real.
- **`lib/actions/gisActions.js`**: `assertSocioActivoOSinValor`/
  `assertParcelaActivaOSinValor` — mismo fix que `assertSocioExists`
  (filtro directo por ambas columnas en vez de traer todo y comparar con
  `orgIdsMatch` después). El import de `orgIdsMatch` se retiró de este
  archivo por quedar sin uso.
- **`lib/eudrQcActions.js::checkSocioParcelaOrganizacion`**: las 2
  búsquedas de conflicto (código de parcela y código de socio, que por
  diseño buscan CUALQUIER organización que use ese código, no solo la
  activa) reemplazan `.maybeSingle()` por `.neq('ID_Organizacion',
  record.ID_Organizacion).limit(1)` — encuentra directamente la primera
  fila de una organización distinta, sin depender de que solo exista una
  coincidencia total.

## Qué NO se tocó (explícito, por pedido de la tarea)

- **RLS**: ninguna política, ni `ENABLE ROW LEVEL SECURITY` nuevo — ver
  la re-verificación arriba, ninguna depende de la PK.
- **Otras tablas**: `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`/
  `INSPECCIONES`/`CAP_*` no se modifican — no tienen FK real hacia
  `PADRON_SOCIOS`/`PADRON_PARCELAS`, y sus propias columnas `ID_Socio`/
  `ID_Parcela_Fija` siguen siendo texto libre sin validar estructuralmente
  (comportamiento preexistente, fuera de alcance).
- **`vw_parcelas_web`/`vw_socios_web`**: confirmado sin riesgo, sin tocar.
- **`scripts/etl_drive_to_supabase.py::warn_socio_org_mismatch`**: ya
  toleraba múltiples filas antes de esta tarea (usa `.execute()` +
  itera `result.data or []`, nunca `.single()`) — el código Python más
  preparado de todo el repo para este cambio, confirmado en la auditoría,
  sin cambios acá.
- **`lib/sociosSearch.js::fetchSocios`/`fetchParcelasBySocio`**: ya
  corregidos en una tarea previa (commit `9779717`, hotfix
  "Multi-Tenant Estricto"), antes y de forma independiente de esta
  migración.

## Tests

- **Estáticos** (`tests/test_pk_surrogate_multiorganizacion.py`,
  `TestMigrationFileStatic`, 13 tests): estructura de la migración —
  idempotencia, columna `id`, `NOT NULL` guardado, drop dinámico de la PK
  vieja, `UNIQUE` por organización, `JOIN` scoped en ambas vistas, sin
  `DROP VIEW`/`GRANT` nuevo, sin tocar `vw_parcelas_web`/`vw_socios_web`
  ni RLS.
- **Funcionales contra Supabase Live** (`TestPkSurrogateLive`, 6 tests):
  gateados por `NEEDS_SUPABASE` **y** un auto-skip adicional si la
  columna `id` todavía no existe en `PADRON_SOCIOS` (la migración no
  aplicada) — hoy se saltan con un mensaje explícito; pasan a ejecutarse
  de verdad en cuanto el usuario la aplique en Supabase Studio. Cubren:
  coexistencia del mismo `ID_Socio` en 2 organizaciones, duplicado real
  dentro de una organización sigue bloqueado, `ID_Organizacion` `NULL`
  sigue bloqueado, `vw_monitoreo_web` sin fan-out entre organizaciones,
  la cascada de `deactivateSocio` no afecta a la organización B, y
  regresión de un lookup de una sola organización. Usan
  `ORG-TEST-PK-A`/`ORG-TEST-PK-B` (sin FK a `ORGANIZACIONES`, confirmado
  en la auditoría — no hace falta que existan ahí), con limpieza en
  `setUp`/`tearDown`.
- **Estructurales de código** (`tests/test_pk_surrogate_code_sites.mjs`,
  8 tests): confirman por texto fuente que cada sitio corregido sigue
  teniendo el filtro de organización — `sociosActions.js`/
  `gisActions.js`/`eudrQcActions.js` son `'use server'` y crean su propio
  cliente Supabase internamente (no inyectable como `sociosSearch.js`),
  así que el comportamiento real se verifica en el test funcional de
  arriba, no acá.
- **Actualizados** (regresión evitada, no introducida): 2 tests
  preexistentes (`tests/test_gis_padron_validation.mjs`,
  `tests/test_eudr_qc_actions.mjs`) asumían el patrón viejo (`orgIdsMatch`
  después de un `.maybeSingle()` sin filtrar; mock de Supabase sin
  `.neq()`) — corregidos para reflejar el nuevo comportamiento, ambos con
  una nota explicando el porqué.

Suite completa tras el fix: `node --test` 548/548, `python -m pytest`
404 passed / 2 failed (mismas 2 fallas pre-existentes no relacionadas,
`test_gis_core_sanitization.py::TestGisSanitizationLive`, confirmadas en
tareas anteriores de esta secuencia) / 6 skipped (las nuevas
`TestPkSurrogateLive`, hasta aplicar la migración), `npm run build` limpio.

## Consecuencias

- Positivo: cierra el riesgo estructural más severo de toda la secuencia
  — el fan-out silencioso en las 2 vistas del Dashboard — en la misma
  migración que lo habilita, no después.
- Positivo: la cascada `deactivateSocio`, el sitio de código más
  peligroso identificado, ya no puede afectar datos de otra organización.
- Pendiente (no verificable en este entorno): aplicar la migración
  manualmente en Supabase Studio y correr `TestPkSurrogateLive` para
  confirmación real contra la instancia viva — mismo flujo de siempre en
  este repo.
