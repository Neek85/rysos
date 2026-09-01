# AI_STATE.md

Registro de bloqueos encontrados por un agente (Claude Code) durante una
tarea, cuando la instrucción de esa tarea pide documentar la causa en vez
de seguir reintentando. No es un changelog general del proyecto — solo
entradas puntuales de "esto bloqueó, acá está la causa real".

## 2026-08-25 — `npm run lint` no puede correr en este entorno (sin relación con el cambio de esta tarea)

**Tarea:** `chore(padron): adopta PADRON_SOCIOS/PADRON_PARCELAS al historial
de migraciones` (ver `specs/padron_baseline_adopcion.md`,
`docs/adr/ADR-023-backend-inspecciones-ya-no-comparte-base.md`).

**Bloqueo:** `npm run lint` (`next lint`) dispara el asistente interactivo
de primera configuración de ESLint de Next.js ("How would you like to
configure ESLint?", selección Strict/Base/Cancel) — no existe ningún
`.eslintrc*`/`eslint.config.*` commiteado en este repo, así que Next.js
asume que es la primera vez que se corre `next lint` acá y siempre pide
elegir una configuración antes de poder lintear nada.

**Por qué no se pudo resolver en esta tarea:** el prompt usa un selector
de menú con flechas (no un `readline` de texto plano) — no responde a
texto ni a `\n` enviados por stdin no interactivo (probado 2 veces:
`printf "Strict\n" | npx next lint` y `printf "\n" | npx next lint`,
ambos se quedan colgados en el mismo prompt hasta el timeout). El entorno
de este agente no tiene una terminal interactiva real (TTY) para responder
un selector de menú.

**Confirmado que no es una regresión de esta tarea:** ningún archivo
`.eslintrc*`/`eslint.config.*` aparece en el historial de git de este
repo — este bloqueo existía antes de esta tarea y seguirá existiendo hasta
que alguien corra `npm run lint` una vez desde una terminal interactiva
real (local, no un agente) y commitee la configuración resultante.

**Qué sí se verificó en su lugar:** `node --test tests/*.mjs` (536/536) y
`python -m pytest tests/ -v` (377 passed, 7 skipped, incluidos los 2 tests
nuevos gateados por `NEEDS_SUPABASE` corridos en vivo con credenciales
reales) — ambos pasan limpio. Ningún archivo `.js`/`.jsx` se tocó en esta
tarea (solo SQL, Markdown, y un test Python), así que el riesgo real de
saltarse el lint acá es bajo, pero queda documentado como gap real, no
resuelto.

## 2026-08-26 — `postgrest.exceptions.APIError: invalid input syntax for type bigint: "None"` al insertar en EUDR_USO_SUELO/EUDR_INSTALACIONES vía supabase-py — **RESUELTO el mismo día**

**Resuelto.** Causa raíz real, confirmada con evidencia (no la hipótesis de
más abajo, que quedaba corta): el error **no** ocurre en el `INSERT`
(esa entrada original decía que sí — impreciso, corregido acá) sino en
el `DELETE` de limpieza de cada test, que filtraba
`.eq("fid", row["fid"])`. `fid` es un bigint nullable sin `DEFAULT` en
ambas tablas — un `INSERT` manual (no vía ETL/QField) siempre lo deja
`NULL`, así que `row["fid"]` es Python `None`. `postgrest-py`
(`base_request_builder.py:302`, versión 2.31.0 instalada, confirmada por
`pip show postgrest`) arma el filtro con una f-string sin guardia para
`None`: `val = f"{operator}.{criteria}"` — con `criteria=None` eso
serializa literal a `fid=eq.None`. Reproducido capturando la request HTTP
real (`httpx.Client.send` parcheado): `DELETE .../EUDR_USO_SUELO?fid=eq.None`,
respuesta `400 {"code":"22P02","message":"invalid input syntax for type
bigint: \"None\""}`. No es un bug de versión de la librería ni necesita
upgrade — es uso incorrecto de `.eq()` con un valor `None` en el propio
test (para eso existe `.is_(col, "null")`, ya usado correctamente en
otro lado de la suite).

**Fix aplicado** (`tests/test_gis_core_sanitization.py`,
`fix(tests): resolver bug de postgrest-py en TestGisSanitizationLive`):
las 2 líneas de limpieza pasan de `.eq("fid", row["fid"])` a
`.eq("id", row["id"])` — `id` es la PK real de la tabla (`docs/schema_live.md`)
y siempre viene poblada en la respuesta del `INSERT`. `python -m pytest
tests/ -v` con credenciales reales: **463 passed, 0 failed, 0 skipped**
(antes: 461 passed / 2 failed). Sin cambios de dependencias.

<details>
<summary>Entrada original (2026-08-26, antes de la investigación)</summary>

**Tarea:** paso 4 multi-producto café/cacao (`specs/multi_producto_cafe_cacao.md`,
`docs/adr/ADR-028-multi-producto-cafe-cacao.md`) — verificación Live final.
Al corregir el bloqueo real de esa tarea (`tests/test_multi_producto_cafe_cacao.py`
fallaba por falta de una fila en `ORGANIZACIONES` antes de insertar en
`EUDR_MONITOREO`/`EUDR_USO_SUELO`, que tienen FK real desde
`20260821_225310_fk_id_organizacion_eudr.sql`), se aplicó el mismo fix a
`tests/test_gis_core_sanitization.py::TestGisSanitizationLive` (2 tests con
el mismo gap, mismo tipo de `INSERT`). Ahí apareció un error nuevo,
**enmascarado hasta ahora** por el `23503` de la FK que siempre ocurría
antes de llegar a este punto.

**Bloqueo (entrada original, ver corrección arriba):** `test_point_geometry_has_null_area` y
`test_small_polygon_is_flagged_not_rejected` fallan los dos con:

```
postgrest.exceptions.APIError: {'message': 'invalid input syntax for type bigint: "None"', 'code': '22P02', 'hint': None, 'details': None}
```

al hacer `.execute()` del `INSERT` en `EUDR_INSTALACIONES`/`EUDR_USO_SUELO`
respectivamente (`tests/test_gis_core_sanitization.py`, línea del
`.execute()` de cada test).

**Confirmado que NO es un problema de lógica de negocio ni del trigger de
sanitización:** el `INSERT` se comete igual en la base real pese a la
excepción del cliente — verificado con una consulta directa post-fallo:
la fila de `EUDR_USO_SUELO` insertada por
`test_small_polygon_is_flagged_not_rejected` quedó con
`area_calculada_ha: 0.0123` y `requiere_revision_area: True` (exactamente
lo que el test espera de `fn_calcular_area_ha`/`trg_gis_sanitize_eudr_uso_suelo`),
y la de `EUDR_INSTALACIONES` con `area_calculada_ha`/`requiere_revision_area`
en `NULL` (también correcto, AC4). En ambas filas, la única columna
anómala es `fid: None` (`NULL` real en la base, no el texto `"None"`) —
`fid` no tiene `DEFAULT`/identity en ninguna de las 2 tablas, así que un
`INSERT` que no lo especifica lo deja `NULL`, cosa que Postgres permite
sin problema a nivel de escritura. El error `22P02` ocurre después, en el
manejo de la respuesta del `INSERT` por parte de `postgrest-py`/`supabase-py`
(versión instalada en este entorno, ver `requirements.txt`) — no en
ningún trigger ni función de este repo.

**No investigado más a fondo, a propósito** (decisión del usuario, no
seguir): no se determinó si el `22P02` viene de un header
`Prefer`/`Range` mal formado por la librería cliente al construir la
respuesta `RETURNING *` con un `fid` nulo, de una incompatibilidad de
versión `postgrest-py`↔PostgREST del proyecto, o de otra causa —
cualquiera de las tres requeriría instrumentar la request HTTP cruda
(fuera de alcance de esta tarea).

**Cómo se destrabó el estado de la base:** cada corrida fallida deja
residuo (el cleanup del test nunca llega a ejecutarse porque la excepción
corta el test antes) — se limpiaron a mano, vía consulta directa, todas
las filas huérfanas de `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`/
`ORGANIZACIONES` con `ID_Organizacion`/`ID = 'TEST-GIS-SANITIZATION'`
generadas durante el diagnóstico. Confirmado limpio antes de cerrar esta
tarea.

**Qué falta y cómo destrabarlo:** reproducir el `INSERT` con la librería
`requests`/`httpx` cruda (sin pasar por `supabase-py`) contra el mismo
endpoint PostgREST para ver si el `22P02` sigue apareciendo — si
desaparece, confirma que es un bug de la librería cliente Python (posible
fix: pin a otra versión de `postgrest`/`supabase` en `requirements.txt`);
si persiste, el problema está del lado de PostgREST/Postgres y necesita
mirar la definición real de `fid` (`\d "EUDR_USO_SUELO"` en Supabase
Studio) para confirmar si de verdad no tiene `DEFAULT`, y si eso es
intencional o un gap de la migración original
(`20260818_gis_core_sanitization.sql` u otra anterior). No se tocó
código de producción ni ninguna migración en esta tarea — el bug es
puramente de la suite de tests contra la instancia real, no del sistema
en sí (el trigger y la escritura funcionan correctamente, confirmado
arriba).

</details>

## 2026-08-25b — No hay forma de correr SQL crudo (`pg_depend`/`pg_get_viewdef`/GRANTs) contra la instancia real desde este entorno

**Tarea:** corregir `supabase/migrations/20260825142426_normaliza_tipo_hbp_otros_cultivo.sql`
(ver `docs/adr/ADR-024-normaliza-tipo-hbp-otros-cultivo.md`, sección
"Actualización 2026-08-25b") tras el error real al aplicarla en Supabase
Studio: `cannot alter type of a column used by a view or rule — rule
_RETURN on view vw_parcelas_web depends on column hbp`.

**Bloqueo:** la tarea pide enumerar TODOS los objetos dependientes de
`PADRON_PARCELAS.hbp`/`otros_cultivo` vía `pg_depend`/`pg_rewrite`,
capturar la definición exacta de cada vista dependiente
(`pg_get_viewdef`) y sus `GRANT`s exactos. Ninguna de las tres cosas es
alcanzable desde este entorno:

- No existe ninguna función RPC de propósito general para ejecutar SQL
  arbitrario (`supabase.rpc(...)` en todo el repo son funciones puntuales:
  `fn_validar_codigo_parcela_unico`, `fn_cobertura_uso_suelo_parcela`,
  `fn_parcelas_vecinas_eudr`, `fn_sanitize_geometry`,
  `fn_guardar_inspeccion_completa`, `fn_validar_topologia_eudr` — ninguna
  acepta SQL libre).
- No hay `DATABASE_URL` ni credencial de conexión Postgres directa en
  `.env.local`, y `psycopg2` no está instalado en este entorno
  (`ModuleNotFoundError` al importarlo) ni en `requirements.txt`.
- El único uso de `psycopg2` en el repo (`scripts/qgis_qc_actions.py`,
  funciones `aprobar`/`rechazar`) corre exclusivamente dentro del entorno
  Python embebido de QGIS Desktop (`_run_in_qgis`), inalcanzable desde una
  sesión de este agente.
- Confirma explícitamente lo que `CLAUDE.md` ya documentaba ("no hay
  conexión Postgres directa disponible desde una sesión de desarrollo
  normal") — no es una regresión ni un descuido de esta tarea, es el
  mismo límite de siempre, ahora chocado en un caso donde SQL de solo
  lectura (no una migración) sería necesario.

**Qué sí se logró sin SQL crudo** (introspección OpenAPI de PostgREST +
REST real, Service Role Key y, para un chequeo puntual, anon key): de 44
objetos expuestos, solo `vw_parcelas_web` (además de `PADRON_PARCELAS`
misma) expone `hbp`/`otros_cultivo` heredados de esa tabla — coincide con
el único objeto que reportó el error real de Postgres. `PARCELAS` (tabla
Fase 6, no relacionada, columnas propias ya `numeric`) descartada como
falso positivo por nombre. `anon` confirmado con `SELECT` real sobre
`vw_parcelas_web` (HTTP 200 con fila real). Cero referencias a
`vw_parcelas_web`/`vw_socios_web` en código de este repo (grep literal).
Detalle completo en el ADR citado arriba.

**Qué falta y cómo destrabarlo:** correr en Supabase Studio → SQL Editor
el siguiente script de **solo lectura** (no modifica nada, tres
`SELECT`s) y devolver los tres resultados:

```sql
-- 1) TODOS los objetos que dependen de hbp/otros_cultivo (no solo lo ya conocido)
WITH cols AS (
  SELECT attrelid, attnum, attname
  FROM pg_attribute
  WHERE attrelid = 'public."PADRON_PARCELAS"'::regclass
    AND attname IN ('hbp', 'otros_cultivo')
    AND NOT attisdropped
)
SELECT DISTINCT
  dependent_ns.nspname AS schema,
  dependent_view.relname AS view_name,
  dependent_view.relkind AS relkind,
  cols.attname AS depends_on_column
FROM pg_depend
JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid
JOIN pg_class dependent_view ON pg_rewrite.ev_class = dependent_view.oid
JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace
JOIN cols ON pg_depend.refobjid = cols.attrelid AND pg_depend.refobjsubid = cols.attnum
ORDER BY 1, 2, 4;

-- 2) Definición EXACTA de vw_parcelas_web (ajustar el nombre si el query
--    de arriba devuelve más vistas, y repetir este SELECT por cada una)
SELECT pg_get_viewdef('public.vw_parcelas_web'::regclass, true);

-- 3) GRANTs exactos sobre vw_parcelas_web (repetir por cada vista)
SELECT grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'vw_parcelas_web'
ORDER BY grantee, privilege_type;
```

Con esos tres resultados, la migración se corrige (`DROP VIEW` → `ALTER
COLUMN` → `CREATE VIEW` con la definición exacta → `GRANT`s exactos, todo
en la misma transacción) sin adivinar ningún `JOIN`/`WHERE` ni ningún
`GRANT`. No se tocó `20260825142426_normaliza_tipo_hbp_otros_cultivo.sql`
en esta tarea — sigue en el estado que falló, a la espera de esta
evidencia.

## 2026-08-26b — Migración `20260826140000_fix_id_parcela_fija_guid_qfield.sql` lista, no aplicada (mismo límite de siempre) + 2 hallazgos reales durante la implementación

**Tarea:** implementar la migración real del diseño ya cerrado en
`specs/fix_id_parcela_fija_guid_qfield.md` (2 vistas + trigger +, agregado
el mismo día con confirmación explícita del usuario, el `LATERAL` `mon`
de `vw_monitoreo_web`).

**Bloqueo (no es un fallo, es el mismo límite documentado en la entrada
"2026-08-25b" de arriba):** esta sesión no tiene forma de ejecutar
`CREATE OR REPLACE VIEW`/`FUNCTION` contra la instancia real (sin RPC de
SQL libre, sin `DATABASE_URL`/`psycopg2`) — la migración
`supabase/migrations/20260826140000_fix_id_parcela_fija_guid_qfield.sql`
quedó escrita y verificada (tests estáticos + smoke test de los fixtures
de los tests Live contra la instancia real, sin aplicar DDL) pero
**pendiente de aplicación manual en Supabase Studio SQL Editor** por el
usuario. Los 7 tests Live nuevos en
`tests/test_fix_id_parcela_fija_guid_qfield.py` se auto-saltan
(`_migration_is_applied`) hasta que se aplique — suite completa: **472
passed, 7 skipped** (antes de esta tarea: 463 passed, 0 skipped — los 9
tests estáticos nuevos ya corren y pasan; los 7 Live nuevos son los que
suman a "skipped").

**Hallazgo 1 (corrección de premisa, encontrada verificando el repo real
antes de escribir la migración):** la spec original citó
`20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql` como la
versión vigente de `vw_monitoreo_web` para diseñar el cambio del `LATERAL`
`mon` — esa versión quedó vieja el mismo día:
`20260826120000_multi_producto_cafe_cacao.sql` (aplicada después) ya
había agregado `id_producto_predominante`/`producto_codigo`/
`producto_nombre` y condiciones `AND ..."ID_Organizacion"` en los 4 JOIN.
La migración de esta tarea parte de la versión realmente vigente —
`test_vw_monitoreo_web_preserves_multi_producto_columns_and_joins` en el
nuevo archivo de tests deja esto cubierto como regresión permanente.

**Hallazgo 2 (encontrado en vivo escribiendo los tests, cambia el perfil
de riesgo real de la 4ta pieza):** `EUDR_MONITOREO` tiene un
`UNIQUE("ID_Organizacion", "ID_Parcela_Fija", fecha_monitoreo)` real
(`eudr_monitoreo_org_parcela_fecha_key`, no documentado en ninguna
migración de este repo -- confirmado insertando 2 filas de prueba y
recibiendo `23505`). Esto hace **estructuralmente imposible** que 2 filas
de la MISMA parcela empaten en `fecha_monitoreo` -- exactamente el
escenario que motivó agregar `creado_en DESC` al `LATERAL` `mon` de
`vw_monitoreo_web` (spec sección 5.1). El cambio sigue siendo correcto y
sin riesgo (desempate inerte, nunca se activa mientras exista este
UNIQUE), pero es defensivo/de paridad de criterio, no el cierre de un bug
reproducible como las otras 3 piezas -- documentado en la spec (sección
5.1) y en el test
`test_vw_monitoreo_web_productor_no_regresiona_para_misma_parcela_con_2_visitas`,
que no puede reproducir un empate genuino por este motivo.

**Nota aparte, sobre el bullet de "plots fantasma" del prompt original:**
pide correr `buildTracesPayload()` (JS, `lib/eudrDdsExporter.js`) desde
un test -- este repo no tiene ningún framework que ejecute JS desde
pytest. `test_plots_fantasma_ya_no_se_cuentan_por_separado_regresion_dds`
replica la lógica exacta de `groupByParcela` en Python contra los datos
reales de `ORG-TEST-E2E` vía `vw_monitoreo_web` en su lugar (verifica el
efecto real del fix sobre la vista, que es la causa raíz del bug) --
verificado manualmente antes de escribir el test: 13 filas `APROBADO`
reales, 6 grupos antes del fix (confirmado, GUID crudo sin resolver), 3
esperados después (`COOP-JS-001`/`COOP-JS-003`/`COOP-JS-004`).

**Qué falta:** aplicar la migración en Supabase Studio (paso manual del
usuario) y volver a correr `python -m pytest tests/ -v` para confirmar
que los 7 tests Live pasan (no solo se saltan) contra el schema real ya
corregido.

## 2026-09-01 — Script de limpieza del padrón de COOP-AROMAS-VALLE (preparado, no aplicado)

**Tarea:** preparar (no ejecutar) un script SQL que vacíe
`PADRON_SOCIOS`/`PADRON_PARCELAS` (y tablas dependientes) de
`COOP-AROMAS-VALLE`, para recargar con un archivo de prueba de 10 filas
como parte de la ronda de robustez del importador masivo (transacción
atómica, progreso real, aviso `beforeunload`). Es limpieza deliberada,
no un error — se documenta acá por pedido explícito del prompt, no
porque haya sido un bloqueo.

**Grafo de FKs real (verificado en `information_schema` contra la
instancia real, no por grep), corrigiendo la premisa del prompt:**
`SOCIO_CERTIFICACIONES.id_socio → PADRON_SOCIOS.id` y
`PARCELA_CERTIFICACIONES.id_parcela → PADRON_PARCELAS.id` son ambas
**`ON DELETE NO ACTION`, no CASCADE** — el prompt planteaba ambas
posibilidades y pedía confirmar cuál era real. Hay que borrar las dos
tablas de certificaciones explícitamente antes que
`PADRON_SOCIOS`/`PADRON_PARCELAS`, o el DELETE final falla con violación
de FK.

**Hallazgo no documentado en `docs/schema_live.md`:** tanto
`PADRON_SOCIOS` como `PADRON_PARCELAS` tienen una columna interna `id`
(uuid) además de su clave de negocio (`ID_Socio`/`ID_Parcela_Fija`,
ambos `text`, código manual tipo `JS-00001`/`COOP-JS-001` — la única PK
que `schema_live.md` documenta hasta ahora). Los FK reales de
`SOCIO_CERTIFICACIONES`/`PARCELA_CERTIFICACIONES` apuntan a esa `id`
uuid interna, no al código de negocio. Ambas tablas de certificaciones
también tienen su propia columna `id_organizacion` (redundante con el
join real) — el script de limpieza borra vía subquery contra la FK real
(`id_socio`/`id_parcela IN (SELECT id FROM PADRON_SOCIOS/PADRON_PARCELAS
WHERE "ID_Organizacion" = ...)`) en vez de confiar solo en
`id_organizacion`, para no depender de que ese tag redundante esté
sincronizado. `docs/schema_live.md` debería actualizarse para documentar
esta columna `id` — queda pendiente, no se tocó en esta tarea (fuera de
alcance del prompt).

**Conteos reales verificados en vivo (2026-09-01, vía REST con
`SUPABASE_SERVICE_ROLE_KEY`, que bypasea RLS — no vía Supabase Studio:
el SQL Editor embebido se puso inestable en esta sesión, navegación
espuria a `/auth/users` en medio de varios intentos de tipeo largo con
muchas comillas; el editor de FK/columnas sí se corrió ahí antes de que
empezara a fallar):**
- `PADRON_SOCIOS` con `ID_Organizacion = 'COOP-AROMAS-VALLE'`: **618 filas**
- `PADRON_PARCELAS`: **821 filas**
- `SOCIO_CERTIFICACIONES` (vía FK real): **4191 filas**
- `PARCELA_CERTIFICACIONES` (vía FK real): **0 filas**
- `EUDR_MONITOREO` / `EUDR_USO_SUELO` / `EUDR_INSTALACIONES` / `INSPECCIONES`
  con `ID_Organizacion = 'COOP-AROMAS-VALLE'`: **0 filas en las 4** — no
  hay datos reales de monitoreo GIS ni de inspecciones socioeconómicas
  ligados a este org todavía, así que el punto de "frenar y avisar" del
  prompt no aplica hoy. Si al volver a correr la Sección 1 del script
  (ver abajo) alguna de estas 4 diera >0, sí hay que frenar antes de
  correr la Sección 2 — puede haber cambiado desde el 2026-09-01.

**Importante para quien lea esto después:** `COOP-AROMAS-VALLE` NO es un
dataset de prueba chico — son 618 socios + 821 parcelas + 4191
certificaciones reales (5630 filas) los que este script borra. El
usuario pidió el script para revisarlo y correrlo él mismo en Supabase
Studio (no se ejecutó de forma autónoma en ningún momento de esta
tarea) — pero la escala real quedó señalada explícitamente en la
respuesta al usuario, más allá de que el prompt lo haya enmarcado como
"volver a cargar con un archivo de prueba de 10 filas".

**Script completo:** entregado al usuario en el chat de esta tarea (3
secciones — conteos antes / DELETE transaccional / conteos después, para
correr como 3 ejecuciones separadas en el SQL Editor, porque un solo
`Run` con varios `SELECT` solo muestra el resultado del último). No se
commiteó al repo (no hay convención de `scripts/sql/` para este tipo de
limpieza ad-hoc, a diferencia de `supabase/migrations/` que es para
cambios de schema idempotentes) — copia también en el scratchpad de la
sesión, `limpieza_padron_coop_aromas_valle.sql`.

## 2026-09-01b — Organización de prueba `ORG-TEST-DEMO` (spec + generador listos, alta y carga pendientes)

**Tarea:** crear una organización de prueba aislada con padrón sintético
(10-50 socios/parcelas) para (a) validar la robustez del importador
masivo sin tocar datos reales y (b) dejar una base reutilizable para una
futura demo comercial. **`COOP-AROMAS-VALLE` no fue tocada en ningún
momento de esta tarea** — ningún archivo ni consulta de esta tarea la
referencia salvo para excluirla explícitamente.

**Corrección de premisa (confirmada con el usuario antes de escribir
código):** el prompt pedía documentar un `TIPO` nuevo (`DEMO-`/`TEST-`)
en `ADR-030`. `ADR-030` (ya existente) dice explícitamente que ese
prefijo es solo para el primer caso real de un tipo jurídico de
organización, no para datos sintéticos — agregar uno ahí habría
contradicho la decisión que la propia ADR ya tomó. El sistema ya tiene
el mecanismo correcto para esto (`ADR-008`: `es_organizacion_prueba` +
convención `ORG-TEST-*`). **`ADR-030` no se tocó.** Código elegido:
`ORG-TEST-DEMO`. Ver `specs/organizacion_prueba_robustez_importador.md`
sección 0.a para el detalle completo.

**Hallazgo colateral (fuera de alcance, no se actuó sobre esto):**
`ORG-TEST-E2E` (la fila que creó `ADR-008` para
`scripts/run_e2e_etl_test.py`) ya no existe en `ORGANIZACIONES`
(confirmado en vivo — hoy solo hay 1 fila, `COOP-AROMAS-VALLE`).
Efecto: ese script abortaría con `UnsafeOrgIdError` si se corre en modo
real hoy. No se reparó — no era parte de este pedido.

**Bloqueante real encontrado, que detiene el paso 6 del prompt original
(cargar el CSV vía el importador real):** `lib/actions/sociosActions.js::createSocio()`
(usado tanto por el alta manual como por la carga masiva CSV) llama
desde la ronda 9 de `specs/mejoras_importador_padron_masivo.md` a la RPC
`fn_crear_socio_con_certificaciones`. Confirmado en vivo vía REST
(`POST .../rpc/fn_crear_socio_con_certificaciones` → `PGRST202`, función
no encontrada): la migración que la crea,
`supabase/migrations/20260901120000_socio_creacion_atomica.sql`, sigue
**pendiente de aplicación manual en Supabase Studio**. Esto significa
que **el alta de un socio está rota en producción ahora mismo**, no solo
para esta tarea — afecta también a `COOP-AROMAS-VALLE`. La migración ya
existe, es idempotente (`CREATE OR REPLACE FUNCTION`, `BEGIN`/`COMMIT`)
y no necesita ningún cambio, solo aplicarse. Hasta que eso pase, el paso
6 (carga real + verificación de atomicidad) no se puede completar.

**Lo que sí quedó terminado y verificado en esta tarea:**
- `specs/organizacion_prueba_robustez_importador.md` — spec completa
  (alcance, fuera de alcance, criterio de "sintético", decisión de
  vincular Café Y Cacao — no solo uno, para que la demo muestre el
  soporte multi-producto de ADR-028).
- `scripts/generar_padron_sintetico.mjs` — genera `Socios.csv`/
  `Parcelas.csv` reutilizando `socioSchema`/`parcelaSchema`/
  `buildSociosCsv`/`buildParcelasCsv`/`computeNextCodes` tal cual (no
  reimplementa el contrato). Corrido en vivo con `--count 12 --seed
  test1`: 12/12 filas pasan ambos schemas, reproducibilidad confirmada
  (mismo seed → mismo hash MD5 en 2 corridas). `.gitignore` recibió una
  entrada nueva (`scratch/`) para el directorio de salida por defecto.
- **Limitación real descubierta al implementar el generador:**
  `id_producto_predominante` (la columna que decide si una parcela es
  Café o Cacao, ADR-028) **no está en `PARCELA_EXPORT_COLUMNS`** — el
  importador CSV no la soporta hoy. Las parcelas sintéticas quedan sin
  producto asignado tras la carga; para que la demo muestre ambos
  productos habría que asignarlo después vía `ParcelaFormModal.jsx` o un
  `UPDATE` aparte — documentado en el script y en la spec, no resuelto
  acá (fuera de alcance del contrato CSV vigente, que esta tarea pidió
  explícitamente reutilizar sin modificar).
- `python -m pytest tests/ -v` no aplica (ningún `.py` cambia).
  `node --test tests/*.mjs`: **677 passed, 0 failed** (sin cambios de
  comportamiento en ningún módulo existente — el generador solo
  importa funciones ya testeadas, no las modifica). `npm run lint`
  sigue sin poder correr en este entorno (prompt interactivo de
  configuración de ESLint) — mismo límite ya documentado en la entrada
  "2026-08-25" de arriba, no algo nuevo de esta tarea.
- INSERT transaccional para el alta de `ORG-TEST-DEMO` (con
  `es_organizacion_prueba = true`, vinculada a CAFE + CACAO) preparado
  siguiendo el runbook de `specs/alta_organizacion_real.md` — entregado
  al usuario en el chat para revisar y aplicar en Supabase Studio, no
  ejecutado de forma autónoma (mismo criterio que la tarea anterior y
  que el propio runbook exige explícitamente). Copia en el scratchpad de
  la sesión, `alta_org_test_demo.sql`.

**Qué falta (bloqueado en el usuario):** (1) aplicar
`20260901120000_socio_creacion_atomica.sql` en Supabase Studio — esto es
urgente independientemente de esta tarea, porque bloquea el alta de
socios en producción; (2) aplicar el INSERT de `ORG-TEST-DEMO`; (3) con
ambas cosas aplicadas, cargar `Socios.csv`/`Parcelas.csv` (generados con
`node scripts/generar_padron_sintetico.mjs`) vía `/dashboard/socios` y
documentar acá el resultado (filas válidas, atomicidad ante interrupción
deliberada, progreso real).

**Actualización 2026-09-01c:** por decisión del usuario, lo que ya
estaba verde (spec, generador, `.gitignore`, este archivo) se commiteó y
pusheó a `staging` sin esperar a que se destrabe la carga real — ver
commit `cbc6ac3`. La carga real queda para cuando el usuario aplique las
migraciones y avise.

## 2026-09-01d — Hueco de seguridad cerrado en `20260901120000_socio_creacion_atomica.sql` (aún sin aplicar)

**Tarea:** antes de que el usuario aplique la migración +el INSERT de
`ORG-TEST-DEMO` en Supabase Studio, cerrar un hueco de seguridad real
detectado en la función nueva y documentar 2 decisiones de diseño
pendientes.

**Hueco real (no hipotético):** `fn_crear_socio_con_certificaciones` se
creó sin ningún `REVOKE`/`GRANT` explícito. Postgres otorga `EXECUTE` a
`PUBLIC` por defecto en toda función nueva — sin revocarlo, la función
queda alcanzable directo vía el endpoint RPC de PostgREST con solo la
llave `anon` pública, permitiendo crear socios (con certificaciones) en
el padrón de cualquier organización sin pasar por las validaciones
multi-tenant de `lib/actions/sociosActions.js` (viven en la Server
Action, no en la base). El comentario original del archivo justificaba
la ausencia de `GRANT` comparándose con `fn_guardar_inspeccion_completa`
— comparación incorrecta: esa otra función sí tiene `GRANT EXECUTE`
explícito a `anon`/`authenticated`, deliberado, porque `INSPECCIONES`/
`CAP_*` ya son escribibles por `anon` vía RLS. `PADRON_SOCIOS` es el
caso opuesto (`anon` sin política de escritura, por diseño). Fix
aplicado en el mismo archivo, antes del `COMMIT` final:
```sql
REVOKE EXECUTE ON FUNCTION public.fn_crear_socio_con_certificaciones(text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_crear_socio_con_certificaciones(text, text, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crear_socio_con_certificaciones(text, text, jsonb, jsonb) TO service_role;
```

**Severidad real, honestamente incierta:** no se pudo confirmar en vivo
contra `pg_proc`/`information_schema.routine_privileges` si `PUBLIC` ya
viene restringido por defecto en esta instancia de Supabase (sin
conexión Postgres directa desde este entorno; las pruebas por REST con
la anon key y la Service Role Key dieron el mismo `PGRST202` para varias
funciones de prueba — PostgREST da ese mismo mensaje tanto para "no
existe" como para "existe pero sin `EXECUTE`", así que no es una señal
concluyente). Como la función NO es `SECURITY DEFINER`, si RLS en
`PADRON_SOCIOS`/`SOCIO_CERTIFICACIONES` ya deniega `INSERT` a `anon` hoy
(no hay política de escritura para ese rol), es posible que RLS por sí
sola ya bloqueara la explotación real incluso sin este fix — pero
depender solo de esa capa es frágil (ver detalle completo en
`specs/organizacion_prueba_robustez_importador.md` sección 0.d). El
`REVOKE`/`GRANT` se aplica como defensa en profundidad de todos modos.

**Hallazgo colateral más amplio, NO tocado en esta tarea:** el mismo
patrón (comentario que afirma "no se otorga a `anon`" sin ningún
`REVOKE`/`GRANT` real) aparece también en
`supabase/migrations/20260821_221221_fn_parcelas_vecinas_eudr.sql`. De
16 migraciones con funciones nuevas, solo 2 (`fn_guardar_inspeccion_completa`
y, ahora, `fn_crear_socio_con_certificaciones`) tienen `REVOKE`/`GRANT`
reales — el resto no tiene ninguno. Se recomienda una auditoría
dedicada de `GRANT`/`REVOKE` sobre todas las funciones RPC del proyecto
antes de aplicar cualquier migración pendiente nueva — no se hizo acá
porque el pedido era específicamente sobre esta migración, y tocar otras
sin que el usuario lo pida es un cambio de alcance que merece su propia
tarea.

**2 decisiones de diseño documentadas** (`specs/organizacion_prueba_robustez_importador.md`
secciones 9.a/9.b, sin cambio de código):
- **9.a:** una certificación cuyo `codigo` no matchea el catálogo activo
  se omite en silencio — a propósito, mismo criterio que
  `cert_org_estatus` (ronda 1 del importador): un mismatch individual no
  debe bloquear el alta del socio completo. No se agregó logging — el
  catálogo es estable, se evalúa telemetría solo si aparece evidencia
  real de un mismatch en producción.
- **9.b:** la atomicidad es POR FILA (un socio + certificaciones por
  invocación RPC), no de todo el archivo — el importador llama la RPC
  una vez por fila en un bucle, sin transacción que envuelva el CSV
  completo. Interrumpir la carga deja las filas ya procesadas
  commiteadas completas y el resto sin procesar, no un rollback total.
  Un reintento del archivo completo sigue siendo seguro en la práctica
  porque `ImportPadronModal.jsx` detecta y omite duplicados — pero esa
  es una propiedad del importador, no de la atomicidad de la RPC en sí.

**Verificaciones repetidas (premisas del prompt):** uuid de `CACAO`
re-confirmado con una consulta REST nueva en este momento (idéntico al
ya usado, `9f7cc233-4563-427f-a6bd-6b9b775817a9`); `ORGANIZACIONES`
sigue con una sola fila real. Grep completo de `components/`/`app/`/
`lib/`: no existe ningún validador de formato de RUC en el repo — el
placeholder `'N/A — organización sintética'` no rompe ninguna vista.

**Verificado:** `node --test tests/*.mjs` — 677 passed, 0 failed (el
cambio es solo SQL, no toca ningún módulo JS testeado). `npm run lint`
sigue sin poder correr en este entorno (mismo límite ya documentado).

**Qué falta:** el usuario/arquitecto revisa el diff del `REVOKE`/`GRANT`
y las respuestas 9.a/9.b, y solo entonces aplica la migración corregida
+ el INSERT de `ORG-TEST-DEMO` en Supabase Studio — no se aplicó nada de
forma autónoma en esta tarea.

## 2026-09-01e — BLOQUEO real: `/dashboard/socios` no puede apuntar a `ORG-TEST-DEMO` hoy — ninguna carga se intentó

**Tarea:** ejecutar la ronda de robustez del importador (carga completa,
carga interrumpida, verificación de progreso real) contra `ORG-TEST-DEMO`,
ya con la migración y el INSERT aplicados en Supabase (verificado en vivo
al empezar: `ORGANIZACIONES` tiene la fila `ORG-TEST-DEMO` con
`es_organizacion_prueba = true`, `ORGANIZACION_PRODUCTOS` confirma CAFE +
CACAO, la RPC devuelve `P0001` con Service Role Key -- error de
validación propio de la función, prueba de que existe -- y devuelve
`42501 permission denied` con la anon key -- prueba de que el
`REVOKE`/`GRANT` de la tarea anterior funciona de verdad).

**Bloqueo real, no se llegó a intentar ninguna carga:** `/dashboard/socios`
no tiene ningún selector de organización — nunca lo tuvo, es una
limitación conocida y documentada por el propio equipo, no algo roto por
esta tarea. `lib/sociosSearch.js::fetchSocios` resuelve la "organización
activa" de la página entera con un probe: la primera fila de
`PADRON_SOCIOS` con `activo = true` (sin `ORDER BY` explícito). Como
`COOP-AROMAS-VALLE` ya tiene 618 filas reales ahí, ese probe **siempre**
devuelve `COOP-AROMAS-VALLE` — nunca llega a intentar el fallback
(`resolveOrganizationId`, Server Action). Y aunque llegara: ese fallback
**excluye explícitamente `es_organizacion_prueba = true`** por diseño
(`lib/actions/organizacionesActions.js`, comentario propio: "no resuelve
un selector multi-organización, fuera de alcance de este fix" — ronda 8,
`specs/mejoras_importador_padron_masivo.md` línea ~1345). Confirmado
leyendo el código (`app/dashboard/socios/page.jsx`: `organizationId` se
fija una sola vez desde `fetchSocios`, sin ningún `<select>` ni control
para cambiarlo, y se pasa igual a `ImportPadronModal`/`SocioFormModal`/
`ParcelaFormModal` — ningún componente resuelve su propia organización
por separado) — no fue necesario ni se intentó cargar la página en el
navegador para confirmar esto, la lectura del código ya es concluyente
y coincide con lo que se vio en pantalla (618 socios listados al entrar
a `/dashboard/socios`, todos con prefijo `COOP-AROMAS-VALLE-`).

**Por qué esto no se puede evitar sin escribir código nuevo:** las 2
"salidas fáciles" quedan descartadas por las reglas explícitas de esta
tarea y las anteriores:
- Vaciar/desactivar temporalmente los socios de `COOP-AROMAS-VALLE` para
  que el probe encuentre `ORG-TEST-DEMO` en su lugar — prohibido, "NO
  toca `COOP-AROMAS-VALLE` bajo ninguna circunstancia" (spec sección 2).
- Llamar a la RPC directo (vía script, sin pasar por la UI real) para
  poder decir "se probó" — inválido para el propósito real de esta
  ronda: los 3 puntos pedidos (progreso real fila por fila, aviso
  `beforeunload`, corte limpio ante interrupción) son propiedades de
  `ImportPadronModal.jsx` en el navegador, no de la RPC en sí (la
  atomicidad de la RPC ya se verificó a nivel de diseño en la tarea
  anterior, sección 9.b) — evitar la UI real dejaría sin probar
  exactamente lo que se pidió probar.

**No se tocó código de producción para resolver esto en esta tarea** —
agregar un selector de organización (o un override temporal vía query
param) a `/dashboard/socios` es un cambio de alcance real sobre lógica
multi-tenant que se acaba de corregir por un bug de producción distinto
(ronda 8), y merece confirmación explícita del usuario antes de tocarla,
no una decisión unilateral en medio de esta tarea.

**Lo que sí se completó:** el dataset sintético para esta ronda
(`node scripts/generar_padron_sintetico.mjs --count 15 --seed ronda-robustez-1`,
15 socios + 15 parcelas, en el directorio de salida por defecto — no
commiteado, `scratch/` está en `.gitignore`). Queda listo para cargar en
cuanto se resuelva el bloqueo de arriba.

**Qué falta:** decisión del usuario sobre cómo destrabar esto (agregar
un selector de organización real a la UI, un override temporal solo
para esta prueba, u otra alternativa) antes de poder completar los
pasos 3-6 del prompt original (carga completa, carga interrumpida,
verificación de progreso real). Pasos 7-9 (documentación final,
tests/lint, commit) quedan pendientes de que la carga real se complete.

## 2026-09-01f — Ronda de robustez del importador completada contra ORG-TEST-DEMO (con override temporal de organización)

**Decisión del usuario sobre el bloqueo de la entrada anterior:**
override temporal por query param (`?org=<codigo>`), verificado
server-side contra `ORGANIZACIONES` (nunca confía en el valor crudo de
la URL), aplicado a AMBOS caminos (lectura y escritura) porque los dos
comparten la misma variable `organizationId` resuelta una sola vez en
`app/dashboard/socios/page.jsx`.

### Mecanismo agregado (TEMPORAL — ver "Qué queda pendiente" abajo)

- `lib/actions/organizacionesActions.js::resolveTestOrganizationOverride(orgId)`
  — Server Action con Service Role Key. `SELECT "ID" FROM ORGANIZACIONES
  WHERE "ID" = orgId AND es_organizacion_prueba = true`. Devuelve `null`
  si `orgId` no existe o si existe pero `es_organizacion_prueba = false`
  (cualquier organización real, incluida `COOP-AROMAS-VALLE`) — nunca
  confía en el valor crudo de la URL.
- `lib/sociosSearch.js::fetchSocios` — nuevo parámetro
  `organizationIdOverride`: si viene truthy, se usa directo y el
  probe/fallback normal se saltea por completo. `null`/`undefined`
  (default) preserva el comportamiento existente sin cambios — 2 tests
  nuevos en `tests/test_sociossearch_multitenant.mjs` cubren ambos
  casos (679 passed, 0 failed en la suite completa).
- `app/dashboard/socios/page.jsx` — lee `?org=` de `window.location.search`
  (no `useSearchParams` de `next/navigation`, para no necesitar envolver
  la página en `<Suspense>` solo por esto — ya es 100% client-side),
  lo verifica con `resolveTestOrganizationOverride`, y pasa el resultado
  a `fetchSocios`. Como `organizationId` (el mismo estado resuelto acá)
  es la MISMA prop que recibe `ImportPadronModal` para sus llamadas a
  `createSocio`/`createParcela`, el override cubre lectura Y escritura
  con un solo punto de verificación — confirmado en vivo, no solo por
  inspección de código (ver evidencia abajo).

**Verificación de la barrera de seguridad (pedido explícito del
usuario, antes de dar por buena la implementación):**
```
ID=eq.COOP-AROMAS-VALLE & es_organizacion_prueba=eq.true  -> []   (rechazado)
ID=eq.ORG-TEST-DEMO      & es_organizacion_prueba=eq.true  -> [1 fila] (aceptado)
ID=eq.FAKE-ORG-XYZ       & es_organizacion_prueba=eq.true  -> []   (rechazado)
```
Confirmado también en el navegador: `/dashboard/socios?org=ORG-TEST-DEMO`
mostró el padrón vacío real de `ORG-TEST-DEMO` (no el de
`COOP-AROMAS-VALLE`, que tiene 618 filas y sería lo que el probe normal
resuelve hoy).

### Ronda de robustez — resultado real, con evidencia de base de datos (no solo de la UI)

**Carga 1 (Socios.csv, 15 filas, sin interrupción):** `15 válida(s), 0
con error`. Confirmado en `PADRON_SOCIOS` (15 filas, `DEMO-00001`...`DEMO-00015`)
y `SOCIO_CERTIFICACIONES` (48 filas vía FK real). `COOP-AROMAS-VALLE`
sin cambios (618).

**Carga 2 (Socios.csv, 50 filas, interrumpida deliberadamente):**
- **Progreso real (punto 5 del prompt):** capturado en pantalla en 2
  momentos distintos de la misma carga — "Importando fila 20 de 50
  (40%)" y, en el intento de interrupción real, "Importando fila 35 de
  37 (95%)" en la carga de Parcelas más abajo — swatches de porcentaje
  que coinciden exactamente con `processed/total`, no un salto
  instantáneo ni un valor estático.
- **`beforeunload` (punto 4a):** al intentar navegar fuera de la página
  a mitad de la carga, la navegación fue efectivamente BLOQUEADA por un
  diálogo nativo "Leave site?" del navegador (confirmado por la
  herramienta de automatización: "Navigation was blocked by a 'Leave
  site?' dialog... the page is still open and unchanged") — recién se
  completó la interrupción real forzando el descarte de ese diálogo
  (`force: true`, "discarded a 'Leave site?' dialog — the page had
  unsaved changes that are now lost"). Un primer intento con un lote más
  chico (15 filas) NO alcanzó a capturar el diálogo porque la carga ya
  había terminado antes de que la navegación se disparara — no es que
  `beforeunload` no funcione, es que 15 llamadas RPC secuenciales contra
  la instancia real de Supabase terminan en menos de lo que tarda esta
  sesión en reaccionar; el lote de 50 sí dio la ventana necesaria.
- **Corte limpio por fila, no corrupción de archivo (punto 4b):**
  confirmado con una consulta real a `PADRON_SOCIOS` después de la
  interrupción — de las 50 filas válidas del CSV, **37 quedaron
  commiteadas** (`DEMO-00046` a `DEMO-00082`) y las **13 restantes
  simplemente no existen** (nunca se intentaron). Las 37 que sí entraron
  tienen **cero huérfanas**: se verificó contra `SOCIO_CERTIFICACIONES`
  que las 37 tienen al menos 1 fila de certificación (ninguna quedó con
  socio creado pero sin sus certificaciones) — exactamente el
  comportamito "por fila, no por archivo" documentado en la tarea
  anterior (sección 9.b de la spec). `COOP-AROMAS-VALLE` sin cambios
  (618) durante todo este proceso.

**Carga 3 (Parcelas.csv, mismo lote de 50, sin interrupción):** el CSV
generado en la carga 2 traía 37 filas cuyo `ID_Socio` sí existe (los que
entraron) y 13 cuyo `ID_Socio` NO existe (los que la interrupción dejó
afuera) — el importador los separó correctamente ("El Código de Socio
... no existe en la organización activa. Debe registrar al socio antes
de importar sus parcelas", 13 tipos de error, 1 por fila) sin que se
pidiera explícitamente probar esto, buena señal de que la validación
referencial funciona incluso contra un padrón parcialmente cargado. Las
37 válidas se confirmaron con progreso real ("Importando fila 35 de 37
(95%)") y completaron sin interrupción: **37/37 en `PADRON_PARCELAS`**
confirmado por consulta directa. `COOP-AROMAS-VALLE` sin cambios (821
parcelas) durante todo el proceso.

**Total final en `ORG-TEST-DEMO` tras toda la ronda:** 67 filas en
`PADRON_SOCIOS`, 37 en `PADRON_PARCELAS`. Desglose real de cómo se llegó
a 67 (3 cargas de socios, no 2 -- ver "Hallazgo colateral" #3 abajo para
por qué hicieron falta 3 intentos):
- Carga 1: 15 filas (`DEMO-00001`..`DEMO-00015`), sin interrupción.
- Intento de interrupción #1 (30 filas generadas, 15 válidas por el bug
  del punto 1 de abajo): las 15 válidas (`DEMO-00031`..`DEMO-00045`)
  completaron ANTES de que la navegación de interrupción llegara a
  dispararse -- terminó siendo, sin querer, una 2da carga limpia sin
  interrupción, no la prueba de interrupción real.
- Intento de interrupción #2 (50 filas, ya con el bug corregido): esta
  sí se interrumpió de verdad -- 37 de 50 quedaron commiteadas
  (`DEMO-00046`..`DEMO-00082`), 13 nunca se intentaron. Total acumulado:
  15 + 15 + 37 = 67.
- `PADRON_PARCELAS`: las 37 parcelas correspondientes a los socios que
  sí quedaron creados en el intento #2 (`DEMO-00046`..`DEMO-00082`),
  cargadas sin interrupción.

### Hallazgos colaterales encontrados en el camino (no pedidos, documentados por transparencia)

1. **Bug real en `scripts/generar_padron_sintetico.mjs`, encontrado y
   corregido en esta misma tarea:** `socio_dni`/`codigo_finca` se
   generaban con el índice LOCAL del loop (`0..count-1`), no un índice
   global que tuviera en cuenta los socios ya existentes de
   `ORG-TEST-DEMO` — a diferencia de `ID_Socio`, que sí usaba
   `computeNextCodes(existingSocioIds, ...)` correctamente. Una 2da
   corrida contra la misma organización repetía los mismos DNI/código de
   finca de la 1ra. El importador real detectó la colisión
   correctamente (la rechazó como error de fila, no la aceptó
   silenciosamente) — pero el generador no debería producir un CSV con
   ese defecto de origen. **Corregido:** el script ahora consulta
   `PADRON_SOCIOS` antes de generar y usa un `globalOffset` para
   `socio_dni`/`codigo_finca`/`localidad`, igual que ya hacía para
   `ID_Socio`. Confirmado con una corrida real después del fix (offset
   correcto, `F-0031` en vez de repetir `F-0001`).
2. **`exportSociosCsv`/`exportParcelasCsv` no respetan ningún scope de
   organización** — a diferencia de `fetchSocios` (que si tiene el
   override nuevo), esas 2 funciones (`lib/padronCsv.js`) no reciben
   `organizationId` en absoluto. Se descubrió al hacer clic por error en
   "Exportar Padrón de Parcelas" en vez de "Cargar Padrón Masivo"
   (ambos botones quedaron muy cerca en el layout tras agregar contenido
   a la página) — el CSV exportado trajo las 821 parcelas de
   `COOP-AROMAS-VALLE`, no las de `ORG-TEST-DEMO`. Sin riesgo real (es
   una descarga de solo lectura de datos ya visibles en la app, no una
   escritura ni una fuga de datos que el usuario no pudiera ver ya
   navegando la UI normal) pero es un gap real preexistente, no
   introducido por esta tarea — **no se tocó**, fuera de alcance de
   esta ronda.
3. **Los primeros 2 intentos de interrupción no capturaron el diálogo
   `beforeunload`** porque el lote (15 y luego 30 filas parcialmente
   inválidas por el bug del punto 1) terminó de importarse antes de que
   la navegación llegara a dispararse — de ahí que el total final en
   `ORG-TEST-DEMO` incluya más filas de las que un solo intento de
   interrupción explicaría. Ningún dato quedó corrupto por estos
   intentos — cada uno completó limpio (0 con error) antes de que se
   intentara la siguiente interrupción.

### Qué queda pendiente

- **El override `?org=` es TEMPORAL**, pensado solo para esta ronda de
  prueba — no es un selector de organización real (sin persistencia,
  sin UI visible, hay que conocer y escribir el código a mano en la
  URL). Un selector de organización real en `/dashboard/socios`
  (dropdown, persistido, visible en la UI) queda pendiente como tarea
  aparte, con su propio spec, para cuando haya una segunda organización
  REAL (no de prueba) o se priorice la demo comercial — decisión y
  spec nuevos, no implícitos en este mecanismo temporal.
- El hallazgo colateral 2 (export sin scope de organización) queda sin
  resolver, fuera de alcance.
- El dataset sintético final que quedó en `ORG-TEST-DEMO` (67 socios /
  37 parcelas) es intencionalmente "sucio" (resultado real de una
  interrupción deliberada + un bug de generador corregido a mitad de
  camino) — si se quiere una base de demo comercial prolija desde cero,
  regenerar con `node scripts/generar_padron_sintetico.mjs --count N
  --seed <nuevo>` contra una `ORG-TEST-DEMO` recién vaciada (o una
  organización de prueba nueva), no reutilizar este estado tal cual.
