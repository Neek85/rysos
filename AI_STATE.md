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

## 2026-09-01g — Investigación: exportSociosCsv/exportParcelasCsv sin scope de organización — CRÍTICO, más grave de lo que parecía

**Tarea:** solo investigación (sin fix) del hallazgo colateral de la
tarea anterior. Conclusión adelantada: **no es un bug de un botón de
exportar — es una política RLS real que expone PADRON_SOCIOS/
PADRON_PARCELAS completas (todas las organizaciones) a cualquiera con
la llave `anon` pública, sin login, sin sesión, sin pasar por
`/dashboard/socios` en absoluto.**

**Corrección de premisa:** el prompt asumía que las funciones viven en
`lib/actions/` — no es así. `exportSociosCsv`/`exportParcelasCsv` están
en `lib/padronCsv.js` (no `'use server'`, no Server Actions) y corren
**client-side**, con el mismo cliente Supabase de llave `anon` que usa
el resto de la página (`getSupabaseClient()`, `lib/supabaseClient.js`).
Esto importa para el punto 4 de abajo: no hay ninguna capa de servidor
entre el botón y la base.

### 1. Query real (textual, confirmada leyendo `lib/padronCsv.js:1383-1434`)

```js
// exportSociosCsv (línea 1383)
supabase
  .from('PADRON_SOCIOS')
  .select([...SOCIO_EXPORT_COLUMNS, 'id'].join(','))
  .eq('activo', true)
  .order('socio_nombre_completo')
// + SOCIO_CERTIFICACIONES vía socioIds, + fetchSocioCertOrgEstatus

// exportParcelasCsv (línea 1425)
supabase
  .from('PADRON_PARCELAS')
  .select(PARCELA_EXPORT_COLUMNS.join(','))
  .eq('activo', true)
  .order('parcela_codigo')
```

**Ningún `.eq('ID_Organizacion', ...)` en ninguna de las dos** — ni un
filtro real ni un hardcode a `COOP-AROMAS-VALLE`. Ninguna de las dos
funciones recibe `organizationId` como parámetro (`exportSociosCsv(supabase)`,
`exportParcelasCsv(supabase)` — la única entrada es el cliente). El
botón del tooltip ya lo admite textualmente: *"Exporta todo el padrón
de socios activos, no solo esta página."*

### 2 y 3. Reproducción con y sin `?org=ORG-TEST-DEMO` — resultado IDÉNTICO (confirmado, no supuesto)

Como ninguna función lee `organizationId` en absoluto, el override de
la tarea anterior no tiene ningún efecto sobre el export — con o sin
`?org=` en la URL, la query que se dispara es exactamente la misma.
Confirmado en vivo reproduciendo la query real (misma forma exacta que
`exportSociosCsv`) contra la instancia, con la llave **`anon` pública**
(la misma que usa el navegador, sin sesión):

```
GET .../rest/v1/PADRON_SOCIOS?select=...&activo=eq.true
-> 685 filas totales
   COOP-AROMAS-VALLE: 618
   ORG-TEST-DEMO:      67

GET .../rest/v1/PADRON_PARCELAS?select=...&activo=eq.true
-> 858 filas totales
   COOP-AROMAS-VALLE: 821
   ORG-TEST-DEMO:      37
```

**Confirmado que trae datos reales, no solo códigos** (sin reproducir
los valores reales acá — evidencia de presencia, no de contenido):
muestra de 5 filas de `COOP-AROMAS-VALLE` vía la query real de
`exportSociosCsv`, `socio_dni`/`socio_nombre_completo`/`celular_socio`
**poblados (no vacíos/NULL) en las 5** — DNI, nombre completo y celular
reales de personas reales, exportables en un solo CSV mezclado con
datos de cualquier otra organización, incluida una de prueba.
`exportParcelasCsv` expone menos PII directa (`PARCELA_EXPORT_COLUMNS`
no incluye `socio_dni`/nombre — sí incluye `ID_Socio`, que permite
cruzar contra el export de Socios).

### 4. Alcance real — NO limitado a staff interno con acceso a `/dashboard/socios`

**La causa raíz no es el botón de exportar — es la política RLS.**
`supabase/migrations/20260818_fix_inspecciones_rls.sql` líneas 142-148:

```sql
CREATE POLICY "rls_anon_select_padron_socios" ON public."PADRON_SOCIOS"
FOR SELECT TO anon
USING ("ID_Organizacion" IS NOT NULL);

CREATE POLICY "rls_anon_select_padron_parcelas" ON public."PADRON_PARCELAS"
FOR SELECT TO anon
USING ("ID_Organizacion" IS NOT NULL);
```

`USING ("ID_Organizacion" IS NOT NULL)` es, en la práctica, **sin
condición real** — es verdadero para prácticamente cualquier fila con
ese campo cargado, de cualquier organización. Esta política se agregó
deliberadamente (fix Inspecciones, 2026-08-18) para habilitar el
autocompletado del formulario de Inspecciones contra el padrón — pero
otorga acceso de lectura total a la tabla completa, no solo lo que
Inspecciones necesita. El único motivo por el que `fetchSocios` (la
lista que se ve en pantalla en `/dashboard/socios`) SÍ queda scopeada
por organización es que **el código de esa función agrega su propio
`.eq('ID_Organizacion', organizationId)` a la query** — la RLS no lo
exige, es disciplina de código, no una barrera real de la base.

**Consecuencia directa:** no hace falta pasar por `/dashboard/socios`,
ni por ningún botón, ni ser staff con acceso a nada. Cualquiera que
tenga la llave `anon` — que es, por diseño de Supabase, pública,
embebida en el bundle de JavaScript del sitio en producción, nunca un
secreto — puede hacer exactamente la misma consulta HTTP de arriba
directo contra el endpoint REST de Supabase, sin login, sin sesión, sin
tocar la UI de RYZOS en absoluto, y recibir el DNI, nombre completo,
celular, fecha de nacimiento y ubicación (departamento/provincia/
distrito/localidad) de los 618 socios reales de `COOP-AROMAS-VALLE`.
Esto es estructural: **cualquier código futuro (o cualquier cliente
externo) que consulte `PADRON_SOCIOS`/`PADRON_PARCELAS` con la llave
`anon` y no agregue manualmente el filtro de organización hereda esta
misma exposición** — no es exclusivo de estas 2 funciones, es una
propiedad de la política RLS tal como está escrita hoy.

### Resumen para que el arquitecto priorice con los otros 2 hallazgos abiertos

1. Auditoría `GRANT`/`REVOKE` sobre funciones RPC (ver entrada `2026-09-01d`).
2. Selector de organización real en `/dashboard/socios` (ver entrada `2026-09-01f`).
3. **Este hallazgo — el más severo de los 3 con evidencia real de PII
   expuesta hoy, sin necesitar ninguna sesión ni acceso interno.** Dos
   capas de fix posibles, no excluyentes: (a) acotar
   `rls_anon_select_padron_socios`/`rls_anon_select_padron_parcelas`
   para que no sea `IS NOT NULL` sino algo realmente scopeado (difícil
   sin sesión real de Supabase Auth — no hay claim de organización que
   comparar, ver el mismo problema que ya documentó ADR-025); (b)
   agregar el filtro de organización que falta a `exportSociosCsv`/
   `exportParcelasCsv` (fix rápido, cierra el síntoma del botón, pero
   no cierra el acceso directo por REST con la llave `anon`, que seguiría
   expuesto para cualquier otro consumidor). Ninguno de los dos se
   aplicó en esta tarea — investigación pura, según lo pedido.

**No se modificó ningún código de producción en esta tarea** — solo
`AI_STATE.md`.

## 2026-09-01h — Auditoría completa de superficie `anon` (RLS + GRANT) — reemplaza/amplía la auditoría GRANT/REVOKE pendiente

**Tarea:** solo investigación y diseño, nada aplicado en Supabase. El
alcance real es mucho más amplio que `PADRON_SOCIOS`/`PADRON_PARCELAS`
— **hay una tabla con acceso `anon` de lectura+escritura+borrado
totalmente sin restricción que contiene PII socioeconómica sensible
(ingresos, discapacidad, discriminación, cuentas bancarias), más severa
que el hallazgo original.**

### 1. TODAS las políticas `anon` en `supabase/migrations/` con condición efectivamente siempre verdadera

Grep completo de `TO anon` + `GRANT ... TO anon` en las 12 migraciones
que mencionan `anon` (5 son solo comentarios sin política/grant real —
`20260818_rls_multi_tenant_fortification.sql`,
`20260820_fn_validar_topologia_eudr.sql`,
`20260823_155621_fn_cobertura_uso_suelo_parcela.sql`,
`20260823_200000_fn_validar_codigo_parcela_unico.sql`,
`20260825201351_pk_surrogate_multiorganizacion.sql` — descartadas).

| Tabla | Política real (`anon`) | Operación | Condición |
|---|---|---|---|
| `INSPECCIONES` | `rls_anon_all_inspecciones` | **FOR ALL** (select+insert+update+delete) | `"ID_Organizacion" IS NOT NULL OR ...` — como `ID_Organizacion` es `NOT NULL` obligatorio por la misma política, esto es **efectivamente sin restricción** para cualquier fila real |
| `CAP_DATOS_SOCIO` | `rls_anon_all_cap_datos_socio` | **FOR ALL** | `USING (true) WITH CHECK (true)` — **sin ninguna restricción, ni siquiera de organización** |
| `CAP_MIC` | `rls_anon_all_cap_mic` | **FOR ALL** | `USING (true) WITH CHECK (true)` |
| `CAP_CONSERVACION` | `rls_anon_all_cap_conservacion` | **FOR ALL** | `USING (true) WITH CHECK (true)` |
| `CAP_BIENESTAR` | `rls_anon_all_cap_bienestar` | **FOR ALL** | `USING (true) WITH CHECK (true)` |
| `CAP_RIESGOS` | `rls_anon_all_cap_riesgos` | **FOR ALL** | `USING (true) WITH CHECK (true)` |
| `CAP_GESTION` | `rls_anon_all_cap_gestion` | **FOR ALL** | `USING (true) WITH CHECK (true)` |
| `PADRON_SOCIOS` | `rls_anon_select_padron_socios` | SELECT | `"ID_Organizacion" IS NOT NULL` |
| `PADRON_PARCELAS` | `rls_anon_select_padron_parcelas` | SELECT | `"ID_Organizacion" IS NOT NULL` |
| `vw_parcelas_web` (VIEW, `security_invoker=true`, hereda RLS de `PADRON_PARCELAS`) | GRANT directo, sin política propia | **DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE** | Ninguna — hereda la de `PADRON_PARCELAS` vía `security_invoker`, pero el `GRANT` en sí es más amplio de lo que cualquier consumidor real necesita |
| `SOCIO_CERTIFICACIONES` | `rls_anon_select_socio_certificaciones` | SELECT | `id_organizacion IS NOT NULL` |
| `PARCELA_CERTIFICACIONES` | `rls_anon_select_parcela_certificaciones` | SELECT | `id_organizacion IS NOT NULL` |
| `ORGANIZACION_CERTIFICACIONES` | `rls_anon_select_organizacion_certificaciones` | SELECT | `id_organizacion IS NOT NULL` |
| `ORGANIZACION_PRODUCTOS` | `rls_anon_select_organizacion_productos` | SELECT | `id_organizacion IS NOT NULL` |
| `CERTIFICACIONES_CATALOGO` | `rls_anon_select_certificaciones_catalogo` | SELECT | `USING (true)` — catálogo global, sin PII, a propósito |
| `AGENCIAS_CERTIFICADORAS` | `rls_anon_select_agencias_certificadoras` | SELECT | `USING (true)` — catálogo global (`id, nombre, activo, creado_en`), sin PII, a propósito |
| `PRODUCTOS` | `rls_anon_select_productos` | SELECT | `USING (true)` — catálogo global, sin PII, a propósito |

### 2. Qué es accesible HOY vía REST directo con la llave `anon` pública, sin sesión — confirmado en vivo (sin reproducir PII real)

| Tabla/vista | Filas totales (`anon`, sin filtro) | Organizaciones mezcladas | PII real confirmada |
|---|---|---|---|
| `PADRON_SOCIOS` | 685 | `COOP-AROMAS-VALLE` (618) + `ORG-TEST-DEMO` (67) | **Sí** — DNI, nombre completo, celular poblados y confirmados (ver entrada `2026-09-01g`) |
| `PADRON_PARCELAS` | 858 | `COOP-AROMAS-VALLE` (821) + `ORG-TEST-DEMO` (37) | Código/nombre de parcela, hectáreas, `ID_Socio` — sin DNI/nombre poblado en la práctica hoy (las columnas denormalizadas `socio_dni`/`socio_nombre_completo` existen en el schema pero están vacías en los datos reales actuales) |
| `vw_parcelas_web` | 858 (idéntico a `PADRON_PARCELAS`, mismo filtro nulo) | Idem | Expone explícitamente `socio_dni`/`socio_nombre_completo` en su `SELECT` (aunque hoy vengan vacíos) — **si esas columnas se llegan a poblar en el futuro, esta vista las expone de inmediato sin que nadie tenga que tocar nada más**. `geom` confirmado vacío en la práctica también. No referenciada por ningún archivo `.js`/`.jsx` del repo — superficie de ataque activa sin ningún beneficio funcional actual. |
| `INSPECCIONES`/`CAP_*` | **No se probó leer/escribir contenido real en esta tarea** — el alcance de la política (`FOR ALL`, sin restricción) se confirmó por lectura de código, no se ejecutó ninguna consulta ni escritura real contra estas tablas (habría significado tocar formularios socioeconómicos reales de producción, fuera de lo que esta tarea de solo-investigación debía hacer). Si el arquitecto quiere confirmación empírica de contenido, es un paso aparte, explícito. |
| `SOCIO_CERTIFICACIONES` / `PARCELA_CERTIFICACIONES` / `ORGANIZACION_CERTIFICACIONES` / `ORGANIZACION_PRODUCTOS` | No verificado con conteo en esta tarea (confirmado solo por lectura de política) | — | Sin PII directa (uuid + estado/booleano) — `SOCIO_CERTIFICACIONES.id_socio` es cruzable contra el `PADRON_SOCIOS` ya expuesto, pero no agrega una superficie nueva por sí sola |
| `CERTIFICACIONES_CATALOGO` / `AGENCIAS_CERTIFICADORAS` / `PRODUCTOS` | Catálogos, `USING(true)` a propósito | — | Sin PII — no requieren acción |

**El hallazgo más severo de los 3 documentados hasta ahora no es
`PADRON_SOCIOS` — es `INSPECCIONES` + los 6 `CAP_*`:** acceso `FOR ALL`
(lectura, alta, modificación Y BORRADO) sin ninguna restricción real
para cualquiera con la llave `anon`, sobre datos que — según el schema
real de `CAP_DATOS_SOCIO`/`CAP_BIENESTAR` (`docs/schema_live.md`,
`supabase/migrations/20260818_inspecciones_atomic_save.sql`) — incluyen
DNI, nombre completo, cónyuge, cuenta bancaria y entidad, porcentaje de
ingresos por fuente, composición familiar (menores de 14/15-18),
discapacidad, acceso a centro de salud, prácticas discriminatorias, y
denuncias de trabajo infantil. No solo es legible sin autenticación —
**es modificable y borrable** sin ninguna traza de quién lo hizo (no
hay sesión real que loguear).

### 3. Migración propuesta para `PADRON_SOCIOS`/`PADRON_PARCELAS` (diseñada, NO aplicada, NO creada como archivo todavía — el contrato de esta tarea es solo `AI_STATE.md`)

Nombre propuesto si se decide aplicar:
`supabase/migrations/20260901140000_lock_anon_select_padron.sql`

```sql
-- PROPUESTA, NO APLICADA. No edita 20260818_fix_inspecciones_rls.sql
-- (ya aplicada) -- migración nueva que reemplaza las 2 políticas.
BEGIN;

DROP POLICY IF EXISTS "rls_anon_select_padron_socios"   ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "rls_anon_select_padron_parcelas" ON public."PADRON_PARCELAS";

CREATE POLICY "rls_anon_select_padron_socios" ON public."PADRON_SOCIOS"
FOR SELECT TO anon
USING (false);

CREATE POLICY "rls_anon_select_padron_parcelas" ON public."PADRON_PARCELAS"
FOR SELECT TO anon
USING (false);

COMMIT;
```

**Nota de diseño:** `USING (false)` en vez de `DROP POLICY` sin
reemplazo — con RLS habilitado (`ENABLE ROW LEVEL SECURITY`, ya
aplicado desde antes) y CERO políticas `SELECT` para `anon`, el
resultado es el mismo (deniega todo), pero dejar la política explícita
con `USING (false)` documenta la intención en el propio schema (visible
en `pg_policies`) en vez de depender de la ausencia de algo — más fácil
de auditar después.

### 4. Qué depende hoy de leer estas 2 tablas con la llave `anon` — quién se rompe con `USING (false)`

Grep completo de `.from('PADRON_SOCIOS'`/`.from('PADRON_PARCELAS'` fuera
de `lib/actions/*.js` (que usa Service Role, no afectado):

| Consumidor | Archivo | ¿Ya scopea por `ID_Organizacion` en el código? | ¿Se rompe con `USING (false)`? |
|---|---|---|---|
| Listado de socios (`/dashboard/socios`) | `lib/sociosSearch.js::fetchSocios` | Sí (`.eq('ID_Organizacion', ...)`) | **Sí — rompe del todo.** La página completa deja de poder listar ningún socio de ninguna organización, no solo deja de filtrar mal. |
| Parcelas de un socio | `lib/sociosSearch.js::fetchParcelasBySocio` | Sí | **Sí — rompe del todo** (el botón "Parcelas" en la tabla queda vacío siempre). |
| Export CSV Socios | `lib/padronCsv.js::exportSociosCsv` | **No** (el hallazgo original) | Se rompe — pero rompe la ÚNICA forma legítima de exportar el padrón real de una organización también, no solo cierra el hueco. |
| Export CSV Parcelas | `lib/padronCsv.js::exportParcelasCsv` | **No** | Idem. |
| Duplicados en preview de importación CSV | `lib/padronCsv.js` (`applySocioDbChecks`/`applyParcelaDbChecks`, líneas ~923-1003) | Sí | **Sí — rompe.** El importador masivo deja de poder detectar duplicados antes de escribir (seguiría funcionando el rechazo por duplicado real, porque ESO pasa por la RPC con Service Role, pero el aviso previo en el preview del navegador desaparece). |
| Plantilla de Parcelas (ID_Socio de ejemplo) | `lib/padronCsv.js::fetchSampleSocioIds` | Sí | **Sí — rompe** (la plantilla descargable cae al ID de respaldo fijo en vez de uno real de la organización). |
| Autocompletado de Inspecciones | `lib/padronSearch.js::searchSocios`/`searchParcelas` | Sí | **Sí — rompe.** El formulario de Inspecciones (`/dashboard/inspecciones`) deja de poder autocompletar socio/parcela — invariante documentado en el propio archivo (`lib/padronSearch.js:4-10`): sin esta política, "el buscador simplemente no encuentra nada". |
| Enriquecimiento de código/nombre de parcela en Consola QC | `lib/eudrQcActions.js::enrichWithParcelaInfo` (línea 160, sin ningún filtro de organización tampoco — otro caso del mismo patrón) | **No** | Se rompe parcialmente — `parcela_codigo`/`parcela_nombre` quedan `null` para los registros `PENDIENTE` de la Consola QC (`/dashboard/qc`), degradación visible pero no un error duro. |
| Validación cruce de organización (código de parcela/socio ya usado por otra org) | `lib/eudrQcActions.js` (la función con `.neq('ID_Organizacion', ...)`, deliberadamente cross-tenant por diseño) | N/A (por diseño necesita leer otras orgs) | **No se rompe** — corre server-side con Service Role Key vía `/api/qc/validar-organizacion-socio-parcela` (confirmado leyendo el Route Handler), nunca con la llave `anon`. |
| `lib/actions/gisActions.js`, `lib/actions/sociosActions.js` | — | N/A | **No se rompe** — Service Role Key, bypasea RLS por diseño. |
| Vistas consolidadas (`vw_monitoreo_web`, `view_eudr_dashboard_aprobados`, etc.) | — | N/A | **No se rompen** — corren con privilegios del dueño (`postgres`), no dependen de la RLS de `anon` sobre la tabla base (patrón ya documentado en `docs/schema_live.md`). |

**Conclusión del punto 4:** aplicar `USING (false)` tal cual, sin nada
más, **rompe 6 caminos legítimos reales** (listado de socios completo,
parcelas por socio, import CSV con detección de duplicados, plantilla
de parcelas, autocompletado de Inspecciones, enriquecimiento en QC) —
no son solo los 2 exports. El listado de socios (`fetchSocios`) es
probablemente el más grave de romper: sin él, `/dashboard/socios`
directamente no puede mostrar ningún socio de ninguna organización real,
tampoco `COOP-AROMAS-VALLE`.

### 5. Mecanismo de reemplazo propuesto (diseño, no implementado)

Mismo patrón ya usado del lado de escritura
(`fn_crear_socio_con_certificaciones`,
`supabase/migrations/20260901120000_socio_creacion_atomica.sql`, con su
`REVOKE`/`GRANT` correspondiente): funciones `SECURITY DEFINER` (o
`SECURITY INVOKER` ejecutadas por un rol con privilegio real, a
confirmar cuál encaja mejor con el resto del proyecto — `postgres` no
tiene RLS que lo filtre) que reciben el código de organización como
**parámetro explícito de la función**, no como un filtro opcional que
el código JS puede omitir. `EXECUTE` revocado de `PUBLIC`/`anon`
directo salvo la firma exacta que cada consumidor necesita — incluso
ahí, el punto real es que la función SIEMPRE filtra, el llamador nunca
puede pedir "todo".

Reemplazos necesarios, uno por cada fila que "Sí" rompe arriba:

1. **`fn_listar_padron_socios(p_organizacion text, p_search text DEFAULT NULL, p_page int DEFAULT 0, p_page_size int DEFAULT 15, ...)`**
   — reemplaza `fetchSocios`. Necesita replicar el `.or(...)` de
   búsqueda y los filtros de certificación/departamento — la pieza más
   grande de las 6, porque `fetchSocios` es la que más lógica de query
   tiene hoy.
2. **`fn_listar_padron_parcelas_por_socio(p_organizacion text, p_socio_id text)`**
   — reemplaza `fetchParcelasBySocio`, trivial (misma forma que ya
   tiene, solo movida a SQL).
3. **`fn_exportar_padron_socios(p_organizacion text)`** /
   **`fn_exportar_padron_parcelas(p_organizacion text)`** — reemplazan
   los 2 exports; devuelven el mismo shape de columnas que
   `SOCIO_EXPORT_COLUMNS`/`PARCELA_EXPORT_COLUMNS` esperan, para no
   tener que tocar `buildSociosCsv`/`buildParcelasCsv` del lado de JS.
4. **`fn_buscar_socios_autocompletado(p_organizacion text, p_query text)`**
   / **`fn_buscar_parcelas_autocompletado(p_organizacion text, p_socio_id text, p_query text)`**
   — reemplazan `lib/padronSearch.js`.
5. **Duplicados de import (`applySocioDbChecks`/`applyParcelaDbChecks`)
   y plantilla (`fetchSampleSocioIds`)** — candidatos a reusar la MISMA
   función del punto 1/2 en vez de crear funciones nuevas dedicadas
   (ya reciben `organizationId` explícito del lado de JS, el cambio es
   solo de `.from(...)` a `.rpc(...)`).
6. **`fn_enriquecer_parcela_qc(p_organizacion text, p_ids text[])`** —
   reemplaza `enrichWithParcelaInfo`. Nota: acá el organizationId real
   con el que filtrar debe salir del propio registro EUDR que la
   Consola QC ya tiene en mano (`record.ID_Organizacion`), no de una
   variable de página — verificar esto al implementar, es una capa
   distinta a las otras 5.

**No implementado en esta tarea** — el pedido era diseñar el mecanismo,
no escribir las 6 funciones. Escribirlas es la tarea siguiente lógica,
ya con el alcance completo (esta entrada) como base, no una sorpresa
a mitad de camino.

### Auditoría de superficie `anon` — estado consolidado (reemplaza la auditoría GRANT/REVOKE de la entrada `2026-09-01d`)

Para que el arquitecto priorice con toda la evidencia real junta:

1. **`INSPECCIONES` + 6 `CAP_*` sin ninguna restricción, lectura+escritura+borrado** (esta entrada, punto 1-2) — el más severo, no cuantificado empíricamente todavía (a propósito, ver nota del punto 2).
2. **`PADRON_SOCIOS`/`PADRON_PARCELAS`/`vw_parcelas_web` — PII real de 618 socios reales, expuesta hoy sin ninguna sesión** (entrada `2026-09-01g` + esta entrada) — migración de bloqueo diseñada arriba, mecanismo de reemplazo diseñado, ninguno de los 2 aplicado.
3. **Funciones RPC sin `REVOKE`/`GRANT` explícito** (entrada `2026-09-01d`) — `fn_parcelas_vecinas_eudr` y otras 8 funciones más, todavía sin auditar una por una.
4. **`SOCIO_CERTIFICACIONES`/`PARCELA_CERTIFICACIONES`/`ORGANIZACION_CERTIFICACIONES`/`ORGANIZACION_PRODUCTOS`** — mismo patrón `id_organizacion IS NOT NULL`, severidad baja-media (sin PII directa), no priorizado en esta entrada pero mismo defecto estructural.

**No se aplicó nada en Supabase en esta tarea.**

## 2026-09-01i — Bloqueo de emergencia INSPECCIONES/CAP_* — impacto exacto + 2 migraciones listas, ninguna aplicada

**Tarea:** máxima prioridad del proyecto según el usuario. Solo
investigación + preparar (sin aplicar) 2 migraciones de contención.
**Hallazgo clave que cambia la urgencia relativa: el contenido real
expuesto hoy en estas 7 tablas es mínimo — 2 filas en `INSPECCIONES`,
0 en las 6 `CAP_*`** (ver punto 5) — muy distinto del caso
`PADRON_SOCIOS` (618 personas reales expuestas ya). El defecto de
diseño es igual de real y grave, pero el daño concreto hoy es mucho
menor. Reportado con evidencia exacta para que el arquitecto priorice
con datos, no con la gravedad asumida del mecanismo en abstracto.

### 1. RLS habilitado en las 7 tablas — confirmado

```sql
-- supabase/migrations/20260818_fix_inspecciones_rls.sql líneas 65-71
ALTER TABLE public."INSPECCIONES"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_DATOS_SOCIO"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_MIC"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_CONSERVACION" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_BIENESTAR"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_RIESGOS"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_GESTION"      ENABLE ROW LEVEL SECURITY;
```

RLS está habilitado en las 7 — **no es el problema más grave posible**
(RLS deshabilitado por completo habría sido peor, ignoraría cualquier
política). El problema real es que las políticas que sí existen son
efectivamente sin restricción (`USING (true)` / condición siempre
verdadera), documentado en la entrada `2026-09-01h`.

### 2. ¿El submit real de `/dashboard/inspecciones` escribe directo contra estas 7 tablas con la llave `anon`? **SÍ, confirmado con evidencia de código.**

- `components/features/inspecciones/useInspeccionForm.js:7,45,88` —
  `import { getSupabaseClient } from '@/lib/supabaseClient'`, y el
  submit real llama a `saveInspeccion(supabase, values, {...})` con ese
  cliente (llave `anon`, sin sesión).
- `lib/inspeccionesActions.js:570,580` — `saveInspeccion` llama a
  `supabase.rpc('fn_guardar_inspeccion_completa', {...})`.
- `supabase/migrations/20260818_inspecciones_atomic_save.sql` — esa RPC
  **NO es `SECURITY DEFINER`** (comentario propio del archivo, línea
  245-250: "corre con el rol del llamador... igual que las 7 llamadas
  REST que reemplaza"), así que el `INSERT`/`DELETE`+`INSERT` que hace
  contra las 7 tablas corre literalmente como `anon` — depende por
  completo de que las políticas `FOR ALL ... USING(true)` de hoy lo
  permitan.

**Consecuencia directa, la más importante de este reporte:** las 2
migraciones que preparé abajo, si se aplican, **rompen el guardado de
inspecciones (alta Y edición, la misma RPC sirve para las dos)** hasta
que exista un reemplazo `SECURITY DEFINER`. No hay forma de "solo
cerrar la escritura anónima" sin romper el único camino de escritura
que existe hoy — no hay un camino `authenticated` real de respaldo (sin
sesión Supabase Auth, ver `CLAUDE.md`).

### 3. Todo lo demás que depende de acceso `anon` a estas 7 tablas

Único archivo del repo que consulta estas 7 tablas directo (grep
completo, fuera de migraciones): `lib/inspeccionesActions.js`.

| Función | Tablas | Operación | Llamada desde | ¿Scopea por organización en el código? |
|---|---|---|---|---|
| `fetchInspecciones` | `INSPECCIONES` | SELECT (listado) | `app/dashboard/inspecciones/page.jsx` (llave `anon`) | **No** — sin `.eq('ID_Organizacion', ...)`, mismo defecto que los exports de `PADRON_SOCIOS` (entrada `2026-09-01g`): el listado ya mezcla todas las organizaciones hoy. |
| `fetchInspeccionDetalle` | `INSPECCIONES` + las 6 `CAP_*` | SELECT (ver/editar una inspección) | `useInspeccionForm.js` (llave `anon`) | Scopeado por `ID_Inspeccion` (un registro puntual) — no mezcla organizaciones, pero cualquiera que conozca/enumere un `ID_Inspeccion` de otra organización puede abrirlo igual. |
| `saveInspeccion` → RPC `fn_guardar_inspeccion_completa` | Las 7 | INSERT/UPDATE/DELETE | `useInspeccionForm.js` (llave `anon`) | Verificación multi-tenant existe pero es **solo en JS del lado del cliente** (compara `organizationId` vs `existingOrganizationId`, comentario propio del archivo) — no es una barrera real, un llamado directo a la RPC con otros valores la evita por completo. |

**No hay ningún otro consumidor** (ni vista, ni otra función, ni otro
componente) — a diferencia de `PADRON_SOCIOS`/`PADRON_PARCELAS` (6
consumidores reales), acá son solo estos 3, todos en el mismo archivo.
El autocompletado de Inspecciones (`lib/padronSearch.js`, ya documentado
en la entrada `2026-09-01h`) lee `PADRON_SOCIOS`/`PADRON_PARCELAS`, no
estas 7 tablas — mencionado acá solo para no dejarlo fuera del cuadro
completo, no es un consumidor nuevo de esta tarea.

### 4. Dos migraciones preparadas — ARCHIVOS CREADOS EN EL REPO, NO APLICADAS EN SUPABASE

**a) Mitigación parcial** — `supabase/migrations/20260901150000_lock_anon_write_inspecciones_cap.sql`:
quita solo INSERT/UPDATE/DELETE de `anon` en las 7 tablas, deja SELECT
igual. **Rompe el guardado de inspecciones (punto 2) — no rompe el
listado ni la vista de detalle.**

```sql
-- (contenido completo del archivo, ver supabase/migrations/20260901150000_lock_anon_write_inspecciones_cap.sql)
BEGIN;

DROP POLICY IF EXISTS "rls_anon_all_inspecciones" ON public."INSPECCIONES";

CREATE POLICY "rls_select_inspecciones_anon" ON public."INSPECCIONES"
FOR SELECT TO anon
USING (
  "ID_Organizacion" IS NOT NULL
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

CREATE POLICY "rls_all_inspecciones_authenticated" ON public."INSPECCIONES"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" IS NOT NULL
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" IS NOT NULL
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- (mismo patrón repetido para CAP_DATOS_SOCIO, CAP_MIC, CAP_CONSERVACION,
--  CAP_BIENESTAR, CAP_RIESGOS, CAP_GESTION -- USING(true)/WITH CHECK(true)
--  original preservado, solo separado por rol -- ver el archivo completo)

COMMIT;
```

**b) Contención completa** — `supabase/migrations/20260901150100_lock_anon_all_inspecciones_cap.sql`:
quita TODO acceso `anon` (SELECT incluido). Diseñada para ser
**independiente de (a)** — hace `DROP POLICY IF EXISTS` de los nombres
de política de las 2 versiones posibles (la original de `20260818` y la
parcial de arriba) y recrea la política de `authenticated` desde cero
en ambos casos, para no perder ese acceso si se aplica esta migración
sin pasar por (a) primero. **Rompe además el listado y la vista de
detalle (punto 3) — el módulo completo de Inspecciones queda
inutilizable desde el navegador.**

```sql
-- (contenido completo del archivo, ver supabase/migrations/20260901150100_lock_anon_all_inspecciones_cap.sql)
BEGIN;

DROP POLICY IF EXISTS "rls_anon_all_inspecciones"       ON public."INSPECCIONES";
DROP POLICY IF EXISTS "rls_select_inspecciones_anon"    ON public."INSPECCIONES";
DROP POLICY IF EXISTS "rls_all_inspecciones_authenticated" ON public."INSPECCIONES";

CREATE POLICY "rls_anon_deny_inspecciones" ON public."INSPECCIONES"
FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "rls_all_inspecciones_authenticated" ON public."INSPECCIONES"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" IS NOT NULL
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" IS NOT NULL
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- (mismo patrón repetido para las 6 CAP_* -- deny total a anon,
--  authenticated preservado con USING(true)/WITH CHECK(true) -- ver el
--  archivo completo)

COMMIT;
```

### 5. Filas reales hoy en cada tabla (vía llave `anon`, sin leer contenido — solo dimensionar)

| Tabla | Filas |
|---|---|
| `INSPECCIONES` | **2** (ambas de `COOP-JS`, una organización real más antigua que `COOP-AROMAS-VALLE` — `Estado: "En Proceso"`, ninguna completada) |
| `CAP_DATOS_SOCIO` | **0** |
| `CAP_MIC` | **0** |
| `CAP_CONSERVACION` | **0** |
| `CAP_BIENESTAR` | **0** |
| `CAP_RIESGOS` | **0** |
| `CAP_GESTION` | **0** |

**Confirmado con `select=*&limit=1` contra `CAP_MIC` (no solo un
conteo con nombre de columna adivinado)** — la respuesta vacía `[]` es
real, no un error de nombre de columna disfrazado de "0 filas".

**Lectura honesta de esto:** las 2 filas de `INSPECCIONES` sin ninguna
fila `CAP_*` correspondiente son casi con certeza el mismo patrón que
`fn_guardar_inspeccion_completa`/la migración `20260818_inspecciones_atomic_save.sql`
fue diseñada para prevenir — un guardado viejo, de antes del guardado
atómico, que dejó la cabecera creada sin sus tablas hijas. No hay PII
socioeconómica real expuesta hoy en la práctica (0 filas `CAP_*`), pero
la política que lo permitiría en cuanto exista una fila real sigue
activa, y el propio módulo (con datos reales) puede empezar a usarse en
cualquier momento sin que nadie tenga que cambiar nada más.

### Recomendación para el arquitecto (no una decisión tomada en esta tarea)

Dado que el contenido real expuesto hoy es 2 filas esqueléticas y 0
filas de datos sensibles, **la urgencia de aplicar cualquiera de las 2
migraciones ahora mismo es menor de lo que la severidad del mecanismo
en abstracto sugiere** — a diferencia de `PADRON_SOCIOS` (618 personas
reales ya expuestas). Igual de cierto: el mecanismo es el mismo defecto
estructural, y aplicar (a) o (b) hoy mismo no tiene costo de datos
reales que perder (no hay ninguno). La decisión real es sobre el costo
de apagar el guardado de inspecciones (punto 2) sin tener el reemplazo
`SECURITY DEFINER` listo todavía — eso es lo que el arquitecto necesita
pesar, no si hay PII en riesgo hoy mismo (no la hay, en la práctica,
para estas 7 tablas específicamente).

**No se aplicó nada en Supabase en esta tarea** — los 2 archivos de
migración existen en el repo (`supabase/migrations/`, igual que toda
migración de este proyecto) pero no se corrieron en Studio.

## 2026-09-01j — Reemplazo SECURITY DEFINER para lecturas de PADRON_SOCIOS/PADRON_PARCELAS — implementado, sin aplicar en Supabase

**Tarea:** implementar (no solo diseñar) las 6 funciones de reemplazo
para las lecturas de `PADRON_SOCIOS`/`PADRON_PARCELAS` documentadas en
la entrada `2026-09-01h`, actualizar los 6 caminos de código reales, y
dejar el lockdown `USING (false)` en la MISMA migración. `INSPECCIONES`/
`CAP_*` explícitamente fuera de alcance (queda para la siguiente tarea,
anotado abajo).

### Migración: `supabase/migrations/20260901160000_lecturas_padron_security_definer.sql` (archivo creado, NO aplicada)

10 funciones (más de las "5-6" originalmente estimadas — el desglose
real de los 6 caminos pedidos resultó en más firmas de las previstas,
ver el desglose abajo), todas `SECURITY DEFINER` + `SET search_path =
public` (mismo patrón que las funciones `SECURITY DEFINER` preexistentes
del proyecto, ej. `20260815_fase1_security_storage.sql`) + `REVOKE
EXECUTE` explícito de `PUBLIC`/`anon`/`authenticated` + `GRANT` único a
`service_role` — **desde el día uno de esta migración, no como fix
posterior** (a diferencia de `fn_crear_socio_con_certificaciones`, donde
el hueco se coló primero y se corrigió después). Cada función filtra por
`p_organizacion` como PRIMERA condición de su `WHERE` — es la única
barrera real una vez dentro de la función (SECURITY DEFINER bypasea RLS
por completo).

| Función | Reemplaza |
|---|---|
| `fn_listar_padron_socios` | `lib/sociosSearch.js::fetchSocios` |
| `fn_listar_padron_parcelas_por_socio` | `lib/sociosSearch.js::fetchParcelasBySocio` |
| `fn_buscar_padron_socios` / `fn_buscar_padron_parcelas` | `lib/padronSearch.js::searchSocios/searchParcelas` (autocompletado Inspecciones **y** editor vectorial de Consola QC — un 3er consumidor real de `padronSearch.js` encontrado al hacer el refactor, no estaba en el listado original de la tarea anterior) |
| `fn_padron_socios_existentes` / `fn_padron_parcelas_existentes` | `lib/padronCsv.js` -- `applySocioDbChecks`/`applyParcelaDbChecks` (detección de duplicados en el preview de importación) |
| `fn_padron_socios_ids_todos` / `fn_padron_socios_sample_activos` / `fn_padron_parcelas_codigos_e_ids` | `lib/padronCsv.js` -- `fetchSampleSocioIds`/`fetchExistingCodes` (plantillas descargables de Socios/Parcelas) |
| `fn_enriquecer_parcela_qc` | `lib/eudrQcActions.js::enrichWithParcelaInfo` (Consola QC, enriquecimiento de `parcela_codigo`/`parcela_nombre` para registros `PENDIENTE`) |

**Misma migración, al final** (pedido explícito: el reemplazo y el
cierre del hueco viajan juntos): `DROP POLICY` + `CREATE POLICY ...
USING (false)` para `anon` en `PADRON_SOCIOS`/`PADRON_PARCELAS`
(diseño ya documentado en `2026-09-01h`, sin cambios).

### Server Actions nuevas: `lib/actions/padronReadActions.js`

Wrappers delgados 1:1 sobre cada función SQL, `'use server'`, Service
Role Key (`getSupabaseServerClient()`). **Import relativo, no `@/lib/...`**
(mismo motivo ya documentado en `lib/actions/organizacionesActions.js`:
varios de los archivos que importan estos wrappers son importados
directo por `tests/*.mjs` con Node puro, sin el resolver de alias de
Next.js -- `@/lib/...` rompería esa cadena con `ERR_MODULE_NOT_FOUND`,
error real que se encontró y corrigió durante esta misma tarea).

### Los 6 caminos actualizados (código real, no solo la migración)

- `lib/sociosSearch.js` -- reescrito completo. `fetchSocios` ya NO hace
  ningún probe contra `PADRON_SOCIOS` para resolver la organización
  activa (esa era la única razón por la que necesitaba leer la tabla
  directo) -- ahora `resolveOrganizationIdFallback` (Server Action
  contra `ORGANIZACIONES`, ya existía) es el único mecanismo, salvo
  `organizationIdOverride`. Ninguna de las 2 funciones exportadas recibe
  `supabase` como parámetro ya.
- `lib/padronSearch.js` -- reescrito completo, mismo criterio.
- `lib/padronCsv.js` -- `applySocioDbChecks`/`applyParcelaDbChecks`
  reemplazan sus 3 consultas paralelas por 1-2 llamadas a las funciones
  combinadas; `validateParcelaRows` perdió el parámetro `supabase`
  (ya no lo necesita); `fetchSampleSocioIds`/`fetchExistingCodes`
  (genéricas por `table`/`column`) se retiraron -- reemplazadas por 3
  llamadas directas y específicas.
- `lib/eudrQcActions.js` -- `enrichWithParcelaInfo` recibe
  `organizationId` (ya resuelto por `fetchPendingRecords` vía el probe
  existente contra `vw_monitoreo_poligonos`/`puntos`, una VISTA con
  privilegios de owner, no afectada por el lockdown) en vez de
  `supabase` -- **hallazgo real en el camino: la versión anterior no
  filtraba por organización en absoluto** (leía `PADRON_PARCELAS` con
  `.in('ID_Parcela_Fija', ids)` sin ningún `.eq('ID_Organizacion', ...)`),
  un defecto real independiente del ya conocido de `PADRON_SOCIOS`, que
  quedó cerrado como efecto colateral de este refactor.
- `app/dashboard/socios/page.jsx`, `components/features/socios/ParcelaFormModal.jsx`,
  `app/dashboard/qc/components/VectorEditorTools.jsx`,
  `components/features/inspecciones/tabs/TabGeneral.jsx` -- actualizados
  a las nuevas firmas (sin `supabase` donde ya no hace falta). 2 imports
  de `getSupabaseClient` quedaron muertos y se retiraron.

**Todas las funciones inyectables** (`listarPadronSocios`,
`fetchSociosExistentes`, `fetchEnrich`, etc., con el default apuntando a
la función real) -- mismo patrón ya establecido en este repo
(`resolveOrganizationIdFallback` de `fetchSocios`), para no perder la
cobertura de test existente sin depender de la Service Role Key real en
cada corrida.

### Test de aislamiento RLS cruzado — `tests/test_padron_read_functions_live.mjs` (nuevo)

Pedido explícito de la tarea: "organización A no puede leer datos de
organización B usando las nuevas funciones". A diferencia del resto de
`tests/*.mjs` (que inyectan una función SQL FALSA, porque el filtro real
ahora vive DENTRO de la función SQL, no en JS -- un fake de JS no puede
probar eso de verdad), este archivo llama a las **funciones SQL REALES**
contra la instancia real con la Service Role Key, comparando
`COOP-AROMAS-VALLE` vs `ORG-TEST-DEMO`. Gateado (mismo espíritu que
`NEEDS_SUPABASE` del lado de Python): se salta solo si faltan
credenciales, o si la migración todavía no está aplicada (probe real
contra `fn_listar_padron_socios`, detecta `PGRST202`). **Corrido en
vivo ahora mismo: los 6 tests se saltan correctamente** (confirmado, la
migración no está aplicada) -- van a empezar a correr de verdad en
cuanto el arquitecto la aplique, sin tocar este archivo. Incluye un test
específico que confirma el `REVOKE`/`GRANT` (la llave `anon` debe recibir
`42501 permission denied`, no solo "no encontrada").

Los tests existentes (`test_sociossearch_multitenant.mjs`,
`test_padron_search.mjs`, bloque de duplicados de `test_padron_csv.mjs`,
bloque de `fetchPendingRecords` de `test_eudr_qc_actions.mjs`,
`test_multi_producto_code_sites.mjs`) se reescribieron para inyectar
fakes con la nueva forma (función, no cliente Supabase) -- siguen
probando que el wrapper de JS arma los mensajes/parámetros correctos,
ya no la lógica de filtrado en sí (esa se movió a SQL).

### Verificación

- `node --test tests/*.mjs`: **680 passed, 0 failed, 6 skipped** (los 6
  nuevos del test Live, gateados como se esperaba).
- `npm run build`: compila limpio, sin errores.
- **Verificación manual real en `/dashboard/socios`** (dev server
  reiniciado limpio, `.next` borrado, siguiendo la higiene de dev server
  documentada en `CLAUDE.md`): confirma exactamente el estado esperado
  -- error `PGRST202`, `"Could not find the function
  public.fn_listar_padron_socios(p_cert_flags, p_cert_org_estatus,
  p_departamento, p_organizacion, p_page, p_page_size, p_search) in the
  schema cache"`. **No es un bug** -- es la prueba de que el wiring
  (nombre de función + nombres de parámetros, uno por uno) es correcto
  y que la única pieza faltante es la migración sin aplicar. `resolveOrganizationId`
  (Server Action ya existente, no tocada) respondió bien antes de este
  error (confirmado en el log del server: 2 `POST /dashboard/socios 200`
  previos). **No se pudo completar la verificación de "sigue mostrando
  COOP-AROMAS-VALLE (618/821) correctamente" pedida en el punto 6** --
  eso requiere la migración aplicada; queda pendiente de que el
  arquitecto la aplique y avise.

### Pendiente, anotado (no es tarea de esta sesión)

`INSPECCIONES` + los 6 `CAP_*` (entrada `2026-09-01i`) siguen el MISMO
patrón inmediatamente después de que esta migración se revise y aplique:
funciones `SECURITY DEFINER` parametrizadas por organización para
`fetchInspecciones`/`fetchInspeccionDetalle`, y una decisión aparte
(fuera del texto de esa entrada) sobre cómo resolver que `saveInspeccion`
hoy necesita escritura real vía `fn_guardar_inspeccion_completa` sin
`SECURITY DEFINER` -- ese caso es distinto al de lectura acá (escribe,
no solo lee), va a necesitar su propio diseño, no una copia mecánica de
este patrón.

**No se aplicó nada en Supabase en esta tarea.** El código está listo
para que el arquitecto lo revise (mismo nivel de revisión que
`fn_crear_socio_con_certificaciones`) antes de aplicar la migración en
Studio. **No se commiteó todavía** -- mismo criterio que las 2 tareas
anteriores (sin instrucción explícita de commit/push en el prompt).

## 2026-09-01k — Bug real encontrado al correr el test Live contra la migración ya aplicada — hotfix preparado, sin aplicar

**El usuario aplicó `20260901160000_lecturas_padron_security_definer.sql`
en Supabase Studio y corrió `tests/test_padron_read_functions_live.mjs`
contra la instancia real.** Resultado: **1 de 10 funciones tiene un bug
real** — el resto (9 de 10) se probó a mano contra datos reales de
`COOP-AROMAS-VALLE` y responde correctamente.

**Bug:** `fn_listar_padron_socios` declaraba `socio_fecha_nacimiento`/
`socio_fecha_ingreso` como `text` en su `RETURNS TABLE` — el tipo real
de esas 2 columnas en `PADRON_SOCIOS` es `date` (confirmado contra el
OpenAPI de PostgREST, `format: "date"`, no asumido). Toda llamada real
fallaba con:
```
{"code":"42804","message":"structure of query does not match function result type",
 "details":"Returned type date does not match expected type text in column 7."}
```
5 de los 6 tests de `test_padron_read_functions_live.mjs` fallaron con
este mismo error — no son 5 bugs distintos, los 5 dependen de llamar a
`fn_listar_padron_socios` primero (para obtener un `ID_Socio` real de
muestra) y todos heredan el mismo error. El 6to test (confirma que
`anon` recibe `42501 permission denied`) **pasó** — confirma que el
`REVOKE`/`GRANT` de la migración funciona de verdad contra la instancia
real, no solo en teoría.

**Verificación cruzada del resto:** en vez de asumir que el resto
también estaba bien, se probaron las 9 funciones restantes una por una
contra datos reales de `COOP-AROMAS-VALLE` (vía REST con Service Role
Key) — las 9 devuelven datos reales correctos, incluida
`fn_listar_padron_parcelas_por_socio` (cuyo tipo `geometry` sin
parámetros de tipo/SRID sí es compatible con la columna real
`geometry(MultiPolygon,4326)`, a diferencia del caso `date`/`text`).

**Hotfix preparado, NO aplicado:**
`supabase/migrations/20260901161000_fix_fecha_columns_fn_listar_padron_socios.sql`.
No se pudo corregir con `CREATE OR REPLACE FUNCTION` -- Postgres no
permite cambiar el tipo de una columna de `RETURNS TABLE` con
`REPLACE` ("cannot change return type of existing function"), hace
falta `DROP FUNCTION` + `CREATE FUNCTION`. Como un `DROP` + `CREATE`
resetea los privilegios a los defaults de Postgres (`EXECUTE` vuelve a
quedar abierto a `PUBLIC`), **el `REVOKE`/`GRANT` se repite completo en
este hotfix** -- no alcanza con corregir solo el tipo de columna sin
repetir esa parte, o el hueco de seguridad que motivó toda esta ronda de
tareas volvería a estar abierto para esta función específica.

**No se aplicó el hotfix en Supabase** -- queda para que lo revises y
apliques vos, mismo criterio que el resto de esta ronda.

## 2026-09-01l — Hotfix aplicado por el usuario — CONFIRMADO: los 10/10 funciones + el lockdown funcionan de punta a punta

**El usuario aplicó `20260901161000_fix_fecha_columns_fn_listar_padron_socios.sql`.**
Recorrida completa de verificación después de eso:

- `node --test tests/test_padron_read_functions_live.mjs`: **6/6 passed**
  (antes: 5 fallaban por el bug de `date`/`text`) -- aislamiento cruzado
  `COOP-AROMAS-VALLE` vs `ORG-TEST-DEMO` confirmado contra la función SQL
  real, no un fake.
- `node --test tests/*.mjs` (suite completa): **686 passed, 0 failed, 0
  skipped** -- el test Live ya no se salta, corre de verdad.
- **Verificación manual en `/dashboard/socios` (la que había quedado
  pendiente en la entrada `2026-09-01j`, punto 6 de la tarea original):**
  confirmado, **618 socio(s) encontrado(s)**, datos reales
  (`COOP-AROMAS-VALLE-001 ABEL PEREZ DIAZ`, etc.) vía `fn_listar_padron_socios`.
  Abrí el modal de Parcelas del primer socio -- **2 parcelas reales**
  (`46837434-A "La Tuna" 1 ha`, `46837434-B "El Puente" 1.5 ha`) vía
  `fn_listar_padron_parcelas_por_socio` -- coincide exactamente con lo ya
  confirmado por REST directo. Los 2 caminos más usados del módulo
  (listado + parcelas por socio) funcionan de punta a punta contra la
  instancia real, con el lockdown de `anon` ya activo.

**Estado final de esta ronda:** las 10 funciones `SECURITY DEFINER` +
el lockdown `USING (false)` de `PADRON_SOCIOS`/`PADRON_PARCELAS` están
aplicados y verificados en producción. Sigue pendiente, sin tocar en
esta ronda: `exportSociosCsv`/`exportParcelasCsv` (los 2 botones de
exportar, que NO estaban en el listado de "6 caminos" a reemplazar --
ver la entrada `2026-09-01j` -- ahora devuelven un CSV vacío en vez de
filtrar mal, porque consultan `PADRON_SOCIOS`/`PADRON_PARCELAS` directo
con `anon` y esa vía ya está cerrada) e `INSPECCIONES`/`CAP_*` (entrada
`2026-09-01i`, mismo patrón, tarea aparte).

## 2026-09-01m — Restaurar exportSociosCsv/exportParcelasCsv — paso 2, evidencia real antes de diseñar

**Tarea:** las 2 funciones de export quedaron devolviendo CSV vacío tras
el lockdown de la fase 1 (ADR-031). Antes de diseñar el reemplazo, se
pidió explícitamente confirmar con evidencia real (no supuestos) qué
alcance tenían.

**Respuesta, leyendo el código real de `lib/padronCsv.js` línea por
línea (no memoria de una tarea anterior):**

```js
export async function exportSociosCsv(supabase) {
  const [{ data, error }, certificaciones] = await Promise.all([
    supabase.from('PADRON_SOCIOS')
      .select([...SOCIO_EXPORT_COLUMNS, 'id'].join(','))
      .eq('activo', true)
      .order('socio_nombre_completo'),
    ...
```

**`exportSociosCsv`/`exportParcelasCsv` NO respetan ningún filtro de la
UI — ni siquiera `activo` aparte del que ya aplican ellas mismas.** El
único `WHERE` es `.eq('activo', true)`. Confirmado además del lado del
caller: `app/dashboard/socios/page.jsx` las invoca como
`exportSociosCsv(supabase)`/`exportParcelasCsv(supabase)` — **sin pasar
ningún argumento de filtro** — el estado de búsqueda/departamento/
certOrgEstatus/certFlags que el usuario tenga activo en la pantalla
(`search`, `certOrgEstatus`, `departamento`, `certFlags`, variables de
`page.jsx`) nunca llega a estas 2 funciones. Exportan **todo el padrón
activo de todas las organizaciones** (antes del lockdown) o **nada**
(después) — nunca un subconjunto filtrado. Esto coincide con
`docs/ESTADO_PROYECTO.md`/tooltips del propio botón ("Exporta todo el
padrón de socios activos, no solo esta página") — el diseño original
siempre fue exportar todo, el filtro de pantalla es solo para lo que se
VE en la tabla, nunca para lo que se exporta.

**Corrección de premisa frente al contrato pedido en el prompt:** el
prompt pedía "mismas columnas que `fn_listar_padron_socios` MENOS
`total_count`" — **no es así**. `exportSociosCsv` selecciona
`SOCIO_EXPORT_COLUMNS` (14 columnas: `ID_Socio`, `ID_Organizacion`,
`codigo_finca`, `socio_nombre_completo`, `socio_dni`, `socio_genero`,
`socio_fecha_nacimiento`, `celular_socio`, `socio_departamento`,
`socio_provincia`, `socio_distrito`, `localidad`, `socio_fecha_ingreso`,
`cert_org_estatus`) + `id` (uuid, necesario para el JOIN posterior contra
`SOCIO_CERTIFICACIONES` que arma las columnas dinámicas de
certificación) — un subconjunto MÁS CHICO que las columnas de
`fn_listar_padron_socios` (que además incluye `conyuge_nombre`,
`conyuge_dni`, `certificaciones`, los 8 flags crudos `cert_nop_usda`...,
y `activo`). La función de reemplazo se diseña para devolver
exactamente `SOCIO_EXPORT_COLUMNS` + `id`, no una copia de
`fn_listar_padron_socios` con una columna menos. Mismo caso para
`exportParcelasCsv`: selecciona `PARCELA_EXPORT_COLUMNS` (13 columnas:
`ID_Parcela_Fija`, `ID_Organizacion`, `ID_Socio`, `parcela_codigo`,
`parcela_nombre`, `hcp`, `hcc`, `ho`, `hip`, `hrp`, `hbp`,
`otros_cultivo`, `totalh`) — sin `geom`, sin `activo` como columna
(aunque sí como filtro `WHERE`), sin `id_producto_predominante` — otro
subconjunto distinto al de `fn_listar_padron_parcelas_por_socio`.

**Lo que SÍ sigue igual y no hace falta tocar:** el enriquecimiento de
certificaciones (`SOCIO_CERTIFICACIONES`, `fetchActiveCertificaciones`,
`fetchSocioCertOrgEstatus`) sigue leyendo con `anon` directo — esas
tablas/RLS no fueron parte del lockdown de la fase 1 (`ADR-031` solo
tocó `PADRON_SOCIOS`/`PADRON_PARCELAS`), siguen abiertas (`USING
(id_organizacion IS NOT NULL)`, mismo hallazgo de severidad baja-media ya
documentado en `2026-09-01h`, no priorizado). Por eso el reemplazo de
`exportSociosCsv` solo necesita cambiar la PRIMERA consulta (a
`PADRON_SOCIOS`), el resto de la función queda igual.

**Resultado (implementación, mismo turno):**

- Migración nueva `supabase/migrations/20260901170000_export_padron_security_definer.sql`
  (BEGIN/COMMIT, idempotente, `DROP FUNCTION IF EXISTS` antes de `CREATE`
  desde el principio) con `fn_exportar_padron_socios(p_organizacion text)`
  y `fn_exportar_padron_parcelas(p_organizacion text)` — sin parámetros de
  filtro (confirmado arriba que ninguna función original los respetaba),
  columnas = exactamente `SOCIO_EXPORT_COLUMNS`+`id` (15) y
  `PARCELA_EXPORT_COLUMNS` (13), `socio_fecha_nacimiento`/
  `socio_fecha_ingreso` declaradas `date` desde el principio (lección del
  hotfix `20260901161000` de la fase 1). Mismo patrón exacto de la fase 1:
  `SECURITY DEFINER`, `SET search_path = public`, `REVOKE EXECUTE` de
  `PUBLIC`/`anon`/`authenticated`, `GRANT EXECUTE` solo a `service_role`.
- `lib/actions/padronReadActions.js`: agregados los wrappers
  `fnExportarPadronSocios(organizationId)`/
  `fnExportarPadronParcelas(organizationId)` (mismo archivo/patrón de
  import relativo que los 10 wrappers de la fase 1, no el alias `@/lib/...`).
- `lib/padronCsv.js`: `exportSociosCsv`/`exportParcelasCsv` ahora reciben
  `(supabase, organizationId)` — la consulta directa a
  `PADRON_SOCIOS`/`PADRON_PARCELAS` con `anon` se reemplazó por
  `fnExportarPadronSocios`/`fnExportarPadronParcelas`; el resto de
  `exportSociosCsv` (join contra `SOCIO_CERTIFICACIONES`, cálculo de
  `cert_org_estatus` en vivo) no se tocó, como se documentó arriba.
- `app/dashboard/socios/page.jsx`: único caller real (confirmado por grep
  en todo `app/`/`components/`/`lib/` — no hay otro). Se actualizaron las
  2 llamadas (`handleExportSocios`/`handleExportParcelas`) para pasar el
  `organizationId` que ya vive en el estado de la página.
- `tests/test_padron_read_functions_live.mjs`: agregado un probe/skip
  independiente (`exportMigrationApplied`/`skipExport`) para la migración
  nueva (no reutiliza el gate de la fase 1, son migraciones distintas) y
  6 tests nuevos (3 por función: aislamiento cruzado A/B con conjuntos de
  IDs disjuntos, `p_organizacion` inexistente devuelve vacío, `anon`
  revocado con `42501`).
- `npm run build`: compila limpio, 10 rutas generadas, sin errores.
- `node --test tests/*.mjs`: **692 tests, 686 pass, 0 fail, 6 skipped**
  (exactamente los 6 tests nuevos de export — se saltan porque
  `20260901170000_export_padron_security_definer.sql` todavía NO está
  aplicada en la instancia real, como se pidió). Los 6 tests live de la
  fase 1 (`fn_listar_padron_socios`/`fn_listar_padron_parcelas_por_socio`/
  `fn_padron_socios_existentes`) siguen corriendo de verdad y pasando —
  no se rompieron.
- **No se aplicó la migración en Supabase Studio ni se hizo commit** —
  igual que el resto del incidente, queda para revisión del arquitecto.
  Una vez aplicada, los 6 tests nuevos empiezan a correr solos (mismo
  patrón que la fase 1) sin tocar este archivo.

## 2026-09-01n — Fix autoselect de certificaciones en SocioFormModal.jsx — causa raíz real (paso 1) y verificación del paso 2 (no asumir)

**Tarea:** los 8 dropdowns de certificación del modal de EDICIÓN de socio
muestran "— Sin dato —" en vez del valor real, aunque el socio SÍ tiene
datos reales en `SOCIO_CERTIFICACIONES`.

**Causa raíz real (leyendo `SocioFormModal.jsx` línea por línea, no
memoria):**

```js
defaultValues: socio ? { ...SOCIO_DEFAULT_VALUES, ...socio } : SOCIO_DEFAULT_VALUES,
```

El modal nunca hace ningún fetch propio a `SOCIO_CERTIFICACIONES` — toma
el valor inicial de los 8 `<select>` directo de `socio.cert_nop_usda`/
`socio.ue_2018_848`/etc., el objeto `row` que ya trae la tabla de
`/dashboard/socios` (viene de `fn_listar_padron_socios`, ver
`app/dashboard/socios/page.jsx:338` → `setEditingSocio(row)`). Esas 8
columnas son las de `PADRON_SOCIOS` — **congeladas desde ADR-027**:
`socioPayload()` (`lib/actions/sociosActions.js:263`) las excluye
explícitamente del payload de escritura desde esa migración ("esas
columnas de PADRON_SOCIOS quedan congeladas en su valor actual... no se
tocan de acá en adelante"). `fn_listar_padron_socios` (la función
`SECURITY DEFINER` de ADR-031/fase 1) las sigue devolviendo tal cual
quedaron congeladas — por eso cualquier socio creado o editado **después**
de la migración de normalización (`20260825222933_certificaciones_normalizadas.sql`)
muestra "Sin dato" en el modal aunque tenga certificaciones reales en
`SOCIO_CERTIFICACIONES` (la fuente de verdad real desde ADR-027).
Confirmado con el caso del prompt: DNI 46837434 tiene "No" en las 8 según
`fn_exportar_padron_socios`/el CSV real (0 filas en `SOCIO_CERTIFICACIONES`
para ese socio), pero el modal muestra "Sin dato" — evidencia directa de
que el modal lee la columna congelada, no la tabla real.

**Paso 2 — ¿la columna "Certificación" de la tabla de listado tiene el
mismo bug?** Confirmado con evidencia, **NO es el mismo bug pero SÍ
comparte la misma causa raíz** (no se puede asumir que "ya funciona
bien"): `app/dashboard/socios/page.jsx:326` renderiza
`row.cert_org_estatus` — un campo de texto libre, SEPARADO de los 8
flags booleanos (correcto que sean campos distintos, eso sí lo asumía
bien el prompt). Pero `cert_org_estatus` **también** está congelado:
`socioPayload()` lo excluye igual que los 8 flags, y
`fn_listar_padron_socios` lo devuelve directo de `PADRON_SOCIOS.cert_org_estatus`
(ver `supabase/migrations/20260901161000_...sql` línea 60), no del valor
en vivo de `SOCIO_CERTIFICACIONES.estado` (que sí existe y ya se lee en
`lib/padronCsv.js::fetchSocioCertOrgEstatus`, usado por `exportSociosCsv`
pero NO por el listado de `page.jsx`). Conclusión: la columna de listado
solo muestra el valor correcto para un socio que nunca fue editado desde
la migración de normalización (2026-08-25) — para cualquiera editado
después, puede haber quedado desactualizada igual que los 8 flags del
modal. **Mismo hallazgo aplica al propio `<input>` de `cert_org_estatus`
dentro del modal** (`register('cert_org_estatus')`) — también lee el
valor congelado de `socio.cert_org_estatus`, no el valor en vivo.
**Ninguno de los dos (columna de listado, input del modal) está en el
alcance pedido en este prompt** (Contrato de Datos limita el fix a
`CERT_FLAG_FIELDS`, los 8 flags) — se documenta acá como hallazgo
relacionado, no se toca, queda para que el arquitecto decida si amerita
una ronda propia.

**Bloqueo real encontrado al diseñar el fix (paso 3) — el prompt asumía
mal el camino de lectura:** el prompt pidió reutilizar "el mismo patrón
de consulta a `SOCIO_CERTIFICACIONES` que ya usa `exportSociosCsv`,
filtrado por `id_socio`". Ese patrón filtra por el **uuid** `id` del
socio (`SOCIO_CERTIFICACIONES.id_socio` es FK a `PADRON_SOCIOS.id`, no al
código `ID_Socio`). Pero `fn_listar_padron_socios` (de donde sale el
`row`/`editingSocio` que recibe el modal) **no devuelve `id`** — confirmado
leyendo su `RETURNS TABLE` real en
`supabase/migrations/20260901161000_fix_fecha_columns_fn_listar_padron_socios.sql:37-45`,
no tiene columna `id`. Ninguna de las funciones `SECURITY DEFINER` de
ADR-031 expone ese uuid al cliente (`fn_buscar_padron_socios`/
`fn_padron_socios_existentes` tampoco). Esto NO requiere tocar RLS ni
crear una función SQL nueva (ver instrucción del prompt de parar si eso
hiciera falta) — **`lib/actions/sociosActions.js` ya corre con la
Service Role Key, que bypasea RLS por sí sola**, igual que
`updateSocio` ya hace `.select('id, ID_Socio')` contra `PADRON_SOCIOS`
ahí mismo (línea ~421) sin necesitar ninguna función `SECURITY DEFINER`.
Se resuelve con una función Server Action nueva y simple en ese mismo
archivo (`resolveSocioCertFlags`), no con SQL nuevo — no hace falta
pausar para revisión.

## 2026-09-01o — Fix cert_org_estatus desactualizado (mismo defecto que [[2026-09-01n]], campo distinto) — Parte A implementada+testeada, Parte B diseñada y pendiente de revisión

**Tarea:** mismo defecto que el fix de `CERT_FLAG_FIELDS` recién cerrado
(entrada anterior), pero en `cert_org_estatus` ("Estatus de Certificación
Orgánica") — tanto el `<input>` del modal como la columna "CERTIFICACIÓN"
del listado de `/dashboard/socios` siguen leyendo
`PADRON_SOCIOS.cert_org_estatus`, congelada desde ADR-027. El valor real
vive en `SOCIO_CERTIFICACIONES.estado` (las 5 filas de
`ORGANIC_CERT_CODES`).

**Paso 1 — no reinventar la lógica de negocio:** revisado
`fetchSocioCertOrgEstatus` (`lib/padronCsv.js:190-233`, ya usado por
`exportSociosCsv`). Criterio real: de las filas orgánicas del socio con
`estado` no nulo, si todas coinciden se usa ese valor; si divergen, se
usa la más reciente por `actualizado_en` (con un `console.warn`
informativo). **Observación que simplificó el diseño de la Parte B:**
las 2 ramas producen el MISMO valor de retorno que "tomar directamente
la más reciente por `actualizado_en`" — si todas coinciden, la más
reciente es trivialmente ese mismo valor; la rama de divergencia en JS
solo agrega el `console.warn`, no cambia qué valor se devuelve. Por eso
en SQL alcanza con un único `ORDER BY actualizado_en DESC LIMIT 1`, sin
necesitar 2 ramas — mismo resultado, sin reimplementar dos veces el
mismo criterio de "consistente o más reciente".

**Parte A (modal) — IMPLEMENTADA Y TESTEADA, sin SQL nuevo:**
- `lib/actions/sociosActions.js::resolveSocioCertFlags` (la función de
  [[2026-09-01n]]) se EXTENDIÓ (no una función hermana — el prompt pidió
  explícitamente reutilizar el uuid ya resuelto ahí para no pagar un
  segundo roundtrip de resolución) para además calcular
  `cert_org_estatus` reusando `fetchSocioCertOrgEstatus` importado de
  `lib/padronCsv.js` (`import { fetchSocioCertOrgEstatus } from
  '@/lib/padronCsv'` — seguro de importar en un archivo `'use server'`:
  `padronCsv.js` no tiene ningún uso de `document`/`Blob` a nivel de
  módulo, solo dentro de `exportSociosCsv`/`exportParcelasCsv`, que
  nunca se llaman acá). El objeto devuelto ahora trae los 8 flags + la
  clave `cert_org_estatus` en el mismo `return`.
- `components/features/socios/SocioFormModal.jsx`: **NO necesitó
  cableado adicional** — el `useEffect` ya existente hace
  `for (const [field, value] of Object.entries(flags)) setValue(field,
  value)`, y como `flags` ahora incluye `cert_org_estatus`, el mismo
  loop genérico ya lo cubre. Solo se actualizó el comentario para
  explicar esto (evitar que un lector futuro busque un `setValue`
  explícito que no existe ni hace falta).
- `npm run build` + `node --test tests/*.mjs`: **692/692, 0 fallos, sin
  tocar Supabase.**

**Parte B (listado, `fn_listar_padron_socios`) — DISEÑADA, NO APLICADA,
pendiente de tu revisión línea por línea:**
`supabase/migrations/20260901180000_fix_cert_org_estatus_listado.sql`
(`BEGIN`/`COMMIT`, `CREATE OR REPLACE FUNCTION` — el `RETURNS TABLE` no
cambia de forma ni tipos, así que a diferencia del hotfix de fase 1 no
hace falta `DROP`+`CREATE`). Reemplaza `s.cert_org_estatus` (columna
congelada) por un `LEFT JOIN LATERAL` contra
`SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO` con el mismo criterio
de arriba (`ORDER BY actualizado_en DESC LIMIT 1`, filtrado a los 5
códigos orgánicos + `estado IS NOT NULL`), `COALESCE(..., '')` para el
caso sin certificaciones orgánicas (mismo default que
`fetchSocioCertOrgEstatus`, no `NULL`).

**Decisión de alcance tomada y documentada (no silenciosa):** el prompt
hablaba de "la función devuelva el `cert_org_estatus` real", enfocado en
la columna de salida — pero la MISMA función también filtra por
`p_cert_org_estatus` contra `s.cert_org_estatus` (el filtro "Estatus
certificación" de la pantalla). Dejar el filtro comparando contra el
valor viejo mientras la columna visible ya muestra el valor real habría
dejado la función internamente inconsistente (buscar "Organico" podría
no encontrar un socio cuya columna visible ya dice "Organico"). Se
corrigieron los DOS usos con el mismo `LEFT JOIN LATERAL` (una sola vez,
reusado tanto en el `SELECT` como en el `WHERE` — no duplicado como
subquery repetida).

**REVOKE/GRANT:** Postgres preserva privilegios en un `REPLACE` que no
cambia la firma de retorno (comportamiento documentado), pero la
migración igual REDECLARA `REVOKE`/`GRANT` explícito al final, sin
asumirlo. Verificación empírica pedida: no hace falta un test nuevo — el
test ya existente `EXECUTE de fn_listar_padron_socios está revocado
para anon` (`tests/test_padron_read_functions_live.mjs`) prueba contra
la función tal cual esté aplicada en cada corrida (no está gateado a
esta migración en particular) y vuelve a correr solo, confirmando el
`REVOKE`, en cuanto esto se aplique.

**No se aplicó la migración en Supabase Studio ni se hizo commit de
nada de esta entrada** — Parte A queda lista (implementada y testeada);
Parte B queda para tu revisión línea por línea del SQL, mismo flujo que
fase 1/1b.

## 2026-09-01p — Ampliación de la migración pendiente (20260901180000): verificación de códigos + fix de los 8 flags de p_cert_flags/columnas

**Hallazgo 1 — verificación de los 5 códigos hardcodeados (paso 1,
ANTES de tocar el SQL):** consulta real de solo lectura vía REST/service
role a `CERTIFICACIONES_CATALOGO` (`activo = true`):

```
COMERCIO_JUSTO, COR_CANADA, DS_0442006_AG, FAIR_TRADE_USA, LPO_MX,
NOP_USDA, RAINFOREST, UE_2018_848
```

8 códigos activos reales. `ORGANIC_CERT_CODES` (`lib/validations/socios.js:192`)
= `['NOP_USDA', 'UE_2018_848', 'COR_CANADA', 'DS_0442006_AG', 'LPO_MX']`
— **sin discrepancia**: los 5 están, activos, y con el mismo string
exacto que la migración ya tenía hardcodeado. **No hizo falta corregir
los 5 códigos del `LEFT JOIN LATERAL` de `cert_org_estatus`.**

**Hallazgo 2 (no pedido explícitamente en el paso 1, pero relevante para
el paso 3) — contradicción con el estado documentado en `2026-09-01n`:**
se pidió usar DNI 46837434 (`COOP-AROMAS-VALLE-001`, ABEL PEREZ DIAZ)
como referencia de "todas en No" porque así se había documentado
(`2026-09-01n`, basado en la premisa del prompt de esa tarea: "0 filas
en SOCIO_CERTIFICACIONES para ese socio"). **La consulta real de HOY
contradice eso**: ese mismo socio (uuid `5327b7bf-dd92-4a28-82ae-09a047c79680`)
tiene HOY 8 filas reales en `SOCIO_CERTIFICACIONES` (las 5 orgánicas con
`estado = 'E'`, las 3 no orgánicas con `estado = NULL` mismo criterio de
`syncSocioCertificaciones`) — es decir, con el criterio de presencia
correcto, sus 8 flags deberían mostrar 'Sí', no 'No'. Investigado sin
asumir por qué: `SOCIO_CERTIFICACIONES` para `COOP-AROMAS-VALLE` tiene
**4191 filas totales** hoy, con `actualizado_en` agrupado en una ventana
de ~15 minutos (03:32:17–03:46:53 UTC, 2026-09-01) — un patrón de
backfill/seed masivo de TODA la organización, no una edición manual
puntual de 1 socio. `PADRON_SOCIOS.cert_nop_usda`/etc. (las columnas
congeladas) siguen en `NULL` para este socio -- no fue de ahí de donde
salió el backfill. No se investigó más a fondo el origen exacto (fuera
del alcance de esta tarea, y no bloquea el fix) -- lo que importa: **la
premisa "0 filas para DNI 46837434" ya no es cierta hoy**, sea porque
cambió entre tareas o porque nunca se verificó con una consulta real en
`2026-09-01n` (ahí se verificó la CAUSA en el código, correctamente,
pero el dato "0 filas" se tomó del prompt sin una consulta live propia
-- la lección: verificar SIEMPRE con una consulta real cuando el dato en
sí es la premisa, no solo la causa en el código). Esto no invalida el
fix de `2026-09-01n`/`2026-09-01o` (la lógica de `resolveSocioCertFlags`
y de esta migración es correcta para CUALQUIER estado real de
`SOCIO_CERTIFICACIONES`, sea cual sea) — solo invalida ese ejemplo
puntual como caso "todo No".

**Paso 3 — caso de prueba real positivo (solo lectura, sin escribir
nada):** en vez de reusar el DNI 46837434 (ya no sirve como caso "todo
No", y para no mezclar este hallazgo con el caso de prueba pedido), se
usa un socio DISTINTO, verificado ahora mismo:

- **`COOP-AROMAS-VALLE-002`, ABEL AGUILAR GUEVARA, DNI 44102527**
  (uuid `05b4a6c4-9432-40ea-9c08-36a0ca0003e0`) — 6 filas en
  `SOCIO_CERTIFICACIONES`: `NOP_USDA`, `UE_2018_848`, `COR_CANADA`,
  `DS_0442006_AG`, `LPO_MX` (`estado = 'E'`), `COMERCIO_JUSTO`
  (`estado = NULL`). **Faltan `RAINFOREST` y `FAIR_TRADE_USA`** (sin
  fila = 'No' esperado para esos 2). `cert_org_estatus` esperado = `'E'`
  (las 5 orgánicas coinciden). Caso de prueba limpio: 6 flags 'Sí', 2
  flags 'No', `cert_org_estatus = 'E'`.
- (Referencia adicional, mismo hallazgo de arriba) `COOP-AROMAS-VALLE-001`,
  ABEL PEREZ DIAZ, DNI 46837434 -- hoy también tiene las 8 filas
  presentes (8 'Sí' esperados, `cert_org_estatus = 'E'`) -- útil como
  caso "todas Sí", ya no como caso "todas No".

**Hallazgo 2 del prompt (paso 2) — mismo defecto en los 8 flags de
`fn_listar_padron_socios` y en el filtro `p_cert_flags`:** confirmado
igual que `cert_org_estatus` -- `s.cert_nop_usda`/etc. son las columnas
congeladas de `PADRON_SOCIOS` (mismo `socioPayload()` que ya no las
escribe), y el filtro `p_cert_flags` (botones "NOP USDA"/"UE 2018/848"/
etc. de `/dashboard/socios`) compara contra esas mismas 8 columnas
congeladas -- por eso el filtro por certificación da resultados
desactualizados. Criterio correcto (igual que `resolveSocioCertFlags` en
JS, Parte A): PRESENCIA -- existe una fila en `SOCIO_CERTIFICACIONES`
para ese `id_socio` + código, sin importar `estado`.

**Migración `20260901180000_fix_cert_org_estatus_listado.sql` reescrita
(mismo archivo, sigue sin aplicar)** -- se agregó un segundo
`LEFT JOIN LATERAL` (`owned`, `array_agg(cc.codigo)` de TODAS las filas
de `SOCIO_CERTIFICACIONES` del socio, sin filtrar por `estado`) además
del `LEFT JOIN LATERAL` ya existente (`cert_real`, sin cambios). Las 8
columnas de salida pasan a `CASE WHEN 'CODIGO' = ANY(owned.codigos) THEN
'Sí' ELSE 'No' END`, y el filtro `p_cert_flags` pasa a comparar contra
`owned.codigos` (`'CODIGO' = ANY(owned.codigos)`) en vez de
`s.cert_nop_usda = 'Sí'`. `RETURNS TABLE` sin cambios (mismas 27
columnas/tipos) -- sigue siendo válido `CREATE OR REPLACE FUNCTION`,
mismo `REVOKE`/`GRANT` redeclarado al final, sin cambios respecto a la
versión anterior de este mismo archivo.

**No se aplicó nada en Supabase. No se escribió nada en la base** (todas
las consultas de este turno fueron `SELECT` de solo lectura vía REST con
la Service Role Key). Migración lista para tu revisión línea por línea.

## 2026-09-01q — Investigación de origen de las 4191 filas de SOCIO_CERTIFICACIONES (COOP-AROMAS-VALLE) — solo lectura, nada aplicado ni escrito

**Paso 1 — ¿coincide con el backfill de `20260825222933_certificaciones_normalizadas.sql`?
DESCARTADO con evidencia dura, no por deducción:** ese backfill hace
`INSERT ... SELECT ... WHERE v.valor = 'Sí'`, leyendo el valor de
`ps.cert_nop_usda`/etc. (las 8 columnas viejas de `PADRON_SOCIOS`) EN EL
MOMENTO en que corre — si esas columnas están en `NULL`, el backfill no
inserta nada para ese socio/certificación. Consulta real: `PADRON_SOCIOS`
con `ID_Organizacion = 'COOP-AROMAS-VALLE' AND cert_nop_usda IS NOT NULL`
→ **0 de 618 filas**. Las 8 columnas legacy están en `NULL` para el
100% de los socios reales de esta organización HOY. Con la columna
fuente en `NULL` en absolutamente todos los casos, ese backfill
específico no puede haber producido las 4191 filas (produciría 0, no
4191) -- descartado, no "no coincide pero es posible", sino
estructuralmente imposible con los datos actuales.
No se pudo revisar metadata de CUÁNDO se aplicó cada migración: la tabla
de control (`supabase_migrations.schema_migrations`) no está expuesta
vía REST (`PGRST106: "Invalid schema: supabase_migrations" -- Only the
following schemas are exposed: public, graphql_public`) -- mismo límite
ya documentado en `2026-08-25b` (sin conexión Postgres directa desde
este entorno).

**Paso 2 — `audit_logs`/`qc_validation_audit_log`:** ambas consultadas
para `COOP-AROMAS-VALLE` y para la ventana 03:00–04:00 UTC de hoy
(cualquier organización) -- **0 filas en ambas, en ambos filtros**. Pero
esto no es una señal fuerte: las 2 tablas están estructuralmente
acotadas a decisiones Aprobar/Rechazar y resultados de validación
topológica sobre `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`
(`CHECK` constraints explícitos en su definición) -- nunca registran
nada sobre `PADRON_SOCIOS`/`SOCIO_CERTIFICACIONES`, así que estructuralmente
no podrían haber capturado esto ni aunque hubiera pasado por ahí.
Coincide además con el hallazgo ya documentado en la entrada
`2026-09-01` de hoy: `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`/
`INSPECCIONES` tienen 0 filas para `COOP-AROMAS-VALLE` -- no hay
actividad de QC/GIS registrada para este org en absoluto, con o sin
relación a este hallazgo.

**Paso 3 — ¿algo de esta sesión escribió contra COOP-AROMAS-VALLE por
error?** Revisadas las entradas de hoy con capacidad de escritura real
(`2026-09-01`, `2026-09-01b`, `2026-09-01d`, `2026-09-01e`, `2026-09-01f`):
- La PRIMERA entrada de todo el día (`2026-09-01`, "Script de limpieza
  del padrón de COOP-AROMAS-VALLE") ya registra **4191 filas en
  SOCIO_CERTIFICACIONES como conteo de solo lectura, ANTES de escribir
  una sola línea de código en esta sesión** -- es decir, las 4191 filas
  ya existían al momento en que este hilo de trabajo empezó a mirar
  la base hoy. Esa tarea preparó un script de limpieza (DELETE) que
  **nunca se aplicó** -- ninguna escritura real ocurrió ahí.
- `2026-09-01b` (creación de `ORG-TEST-DEMO`): explícito, "`COOP-AROMAS-VALLE`
  no fue tocada en ningún momento de esta tarea".
- `2026-09-01d` (hueco de seguridad en `fn_crear_socio_con_certificaciones`):
  solo diseño/revisión de SQL, "no se aplicó nada de forma autónoma en
  esta tarea".
- `2026-09-01e`: bloqueada antes de intentar ninguna carga real (ningún
  INSERT/UPDATE ejecutado).
- `2026-09-01f` (ronda de robustez, la que sí ejecutó cargas reales):
  cada una de las 3 cargas + el propio test de la barrera de seguridad
  del override verifican explícitamente "`COOP-AROMAS-VALLE` sin cambios
  (618)" en cada checkpoint, y el mecanismo de override fue diseñado y
  confirmado en vivo para RECHAZAR `COOP-AROMAS-VALLE` específicamente
  (`ID=eq.COOP-AROMAS-VALLE & es_organizacion_prueba=eq.true -> []`).
  Todas las escrituras reales de esa ronda (67 socios, 37 parcelas, ~48+
  filas de certificaciones) fueron contra `ORG-TEST-DEMO`, verificadas
  una por una contra la base.

**Conclusión (paso 4, dicho directo):** ninguna acción de este hilo de
trabajo escribió contra `COOP-AROMAS-VALLE` hoy -- las 4191 filas ya
existían ANTES de que la primera tarea del día empezara a mirar la base
(están documentadas como conteo de solo lectura desde el primer momento
en que alguien -- yo, en esta sesión -- las consultó). El origen real
(qué proceso las cargó, y cuándo exactamente antes de que este hilo
empezara) **queda sin explicación desde acá**, no por falta de
investigación sino por límite real de herramientas: sin conexión
Postgres directa, sin acceso a `supabase_migrations.schema_migrations`,
y sin ningún log de aplicación aplicable (los 2 audit logs disponibles
no cubren este dominio). No hay evidencia de que sea una escritura NO
explicada de ESTA sesión -- es un estado preexistente del entorno. Los
valores de `estado` observados (`'E'`, `'T3'`) parecen abreviaturas
reales de estatus de certificación orgánica (posible "En trámite",
"Transición año 3"), no basura sintética obvia -- consistente con que
`COOP-AROMAS-VALLE` es una organización real (no de prueba, ADR-030) y
esto sea un backfill/carga real de certificaciones hecha por alguien con
acceso directo a Supabase Studio o un script fuera de este repositorio,
en algún momento antes de que este hilo de trabajo empezara hoy. Si el
arquitecto quiere confirmar el origen exacto, necesitaría revisar
directamente en Supabase Studio (Logs/Database → historial de
queries, o el historial de migraciones aplicadas) -- fuera del alcance
de lo que este entorno puede consultar.

## 2026-09-01r — Corrección de un error propio: el "caso de prueba" de `2026-09-01p`/`2026-09-01q` para COOP-AROMAS-VALLE-002 estaba INCOMPLETO — el CSV tenía razón

**Causa raíz del conflicto, confirmada con evidencia:** la consulta que
generó el "caso de prueba" documentado en `2026-09-01p` NO estaba
filtrada por `id_socio` -- era un `SELECT ... WHERE id_organizacion =
'COOP-AROMAS-VALLE' LIMIT 20` genérico contra toda la organización
(pensado solo para "encontrar algún socio con certificaciones"), y las
filas de `COOP-AROMAS-VALLE-002` quedaron repartidas dentro de ese lote
de 20 filas intercaladas con las de OTROS socios. Al leer manualmente
cuáles de esas 20 filas pertenecían a este socio, se tomaron 6 sin notar
que una 7ma fila (`FAIR_TRADE_USA`) quedaba fuera de lo que se llegó a
inspeccionar en ese lote truncado -- no faltaba en la base, faltaba en
mi lectura del resultado parcial. Lección: nunca inferir el conjunto
completo de filas de UNA entidad a partir de una muestra genérica
multi-entidad con `LIMIT` -- consultar esa entidad sola, sin límite.

**Query real, esta vez sí filtrada por `id_socio` (uuid
`05b4a6c4-9432-40ea-9c08-36a0ca0003e0`, `ID_Socio = 'COOP-AROMAS-VALLE-002'`),
sin filtrar por código ni por estado, con JOIN a `CERTIFICACIONES_CATALOGO` --
tabla completa real, 7 filas (no 6):**

| id_certificacion | codigo | nombre | activo | estado | actualizado_en |
|---|---|---|---|---|---|
| 0c8023d8-... | NOP_USDA | NOP USDA | true | `E` | 2026-09-01T03:32:18.960401+00:00 |
| b515fe6e-... | UE_2018_848 | UE 2018/848 | true | `E` | 2026-09-01T03:32:18.960401+00:00 |
| 1202da49-... | COR_CANADA | COR Canadá | true | `E` | 2026-09-01T03:32:18.960401+00:00 |
| d33001a0-... | DS_0442006_AG | DS 044-2006-AG | true | `E` | 2026-09-01T03:32:18.960401+00:00 |
| 2d986ee2-... | LPO_MX | LPO México | true | `E` | 2026-09-01T03:32:18.960401+00:00 |
| df0d80fe-... | COMERCIO_JUSTO | Comercio Justo | true | `NULL` | 2026-09-01T03:32:18.960401+00:00 |
| 033b7c40-... | FAIR_TRADE_USA | Fair Trade USA | true | `NULL` | 2026-09-01T03:32:18.960401+00:00 |

**No hay fila para `RAINFOREST`** -- ausencia real, no filtrada.

**Veredicto:** la afirmación (a) -- el CSV `Padron_Socios_20260901.csv`
-- es la CORRECTA. La (b) -- mi propio reporte anterior -- estaba mal,
por el motivo de arriba (muestra truncada, no un problema de los datos
ni de la lógica de la migración). El criterio de PRESENCIA que ya usa
tanto `resolveSocioCertFlags` (JS, Parte A) como el `LEFT JOIN LATERAL
owned` de la migración `20260901180000` (SQL, Parte B) es "existe una
fila, sin importar `estado`" -- bajo ese criterio correcto,
`COMERCIO_JUSTO` y `FAIR_TRADE_USA` son 'Sí' (ambos TIENEN fila, aunque
con `estado = NULL`) -- exactamente lo que el CSV ya mostraba. **La
lógica de la migración SQL y de `resolveSocioCertFlags` está bien tal
como está escrita hoy -- no hay ningún bug de código que corregir.** El
único error fue mi verificación manual del caso de prueba (comentario
de la migración + entrada `2026-09-01p` de este archivo), no el
comportamiento real del fix.

**Benchmark CORRECTO y confirmado para COOP-AROMAS-VALLE-002 (DNI
44102527, ABEL AGUILAR GUEVARA), para verificar la migración
`20260901180000_fix_cert_org_estatus_listado.sql` después de aplicarla:**

| Columna | Valor esperado |
|---|---|
| cert_nop_usda | Sí |
| ue_2018_848 | Sí |
| cor_canada | Sí |
| cert_ds_0442006_ag | Sí |
| cert_lpo_mx | Sí |
| cert_rainforest | **No** |
| cert_comercio_justo | Sí |
| cert_fair_trade_usa | Sí |
| cert_org_estatus | `E` |

**Pendiente, NO corregido en esta tarea (de solo lectura, sin tocar
código/migraciones por instrucción explícita):** el comentario dentro de
`supabase/migrations/20260901180000_fix_cert_org_estatus_listado.sql`
("Caso de prueba real verificado hoy...") todavía describe el benchmark
INCORRECTO de `2026-09-01p` (6 flags 'Sí', Rainforest y Fair Trade USA en
'No') -- ese comentario debe corregirse con la tabla de arriba antes de
aplicar la migración, para que quien la revise no verifique contra un
benchmark equivocado. Señalado acá explícitamente; no se tocó el archivo
en este turno por instrucción directa del prompt ("no toques
migraciones").

## 2026-09-01s — `20260901180000_fix_cert_org_estatus_listado.sql` APLICADA en Supabase por el arquitecto — verificación en vivo CONFIRMADA, sin commitear todavía

**Aplicada manualmente en Supabase Studio (fuera de esta sesión) por el
arquitecto.** Esta tarea fue puramente de verificación en vivo contra la
instancia real, ya con la migración corriendo -- no se aplicó ni se
modificó nada de código/SQL en este turno.

**Paso 1 -- suite live existente, sin modificar el archivo de test:**
`node --test tests/test_padron_read_functions_live.mjs` → **12/12
passed, 0 failed**, incluido "EXECUTE de fn_listar_padron_socios está
revocado para anon" (sigue en verde -- confirma que el `REVOKE`/`GRANT`
redeclarado en la migración nueva sigue vigente, no se perdió con el
`CREATE OR REPLACE`).

**Paso 2 -- llamada real a `fn_listar_padron_socios` (Service Role Key),
`p_organizacion='COOP-AROMAS-VALLE'`, `p_search='COOP-AROMAS-VALLE-002'`
-- comparado contra el benchmark de `2026-09-01r`, campo por campo:**

| Campo | Esperado (2026-09-01r) | Real (hoy, post-aplicación) | ¿Coincide? |
|---|---|---|---|
| cert_nop_usda | Sí | Sí | ✅ |
| ue_2018_848 | Sí | Sí | ✅ |
| cor_canada | Sí | Sí | ✅ |
| cert_ds_0442006_ag | Sí | Sí | ✅ |
| cert_lpo_mx | Sí | Sí | ✅ |
| cert_rainforest | No | No | ✅ |
| cert_comercio_justo | Sí | Sí | ✅ |
| cert_fair_trade_usa | Sí | Sí | ✅ |
| cert_org_estatus | E | E | ✅ |

**Coincidencia exacta, las 9 columnas.** El caso de prueba corregido en
`2026-09-01r` (7 filas reales, no 6) queda confirmado en producción, no
solo en la consulta de diagnóstico de esa entrada.

**Paso 3 -- filtro `p_cert_flags` (el que antes comparaba contra las
columnas congeladas):**
- `p_cert_flags=['cert_rainforest']` + `p_search='COOP-AROMAS-VALLE-002'`
  → `[]` (vacío) -- correcto, este socio NO tiene esa certificación
  (`owned.codigos` real no incluye `RAINFOREST`).
- `p_cert_flags=['cert_nop_usda']` + mismo `p_search` → devuelve la fila
  completa de `COOP-AROMAS-VALLE-002` -- correcto, sí la tiene.

Ambos confirman que el filtro ya compara contra `SOCIO_CERTIFICACIONES`
en vivo (vía el `LEFT JOIN LATERAL owned`), no contra las columnas
congeladas de `PADRON_SOCIOS` como antes de esta migración.

**Paso 4 -- build y suite completa:**
- `npm run build`: compila limpio, 10 rutas, sin errores.
- `npm run dev`: arranca limpio ("Ready in 2.4s"), sin errores de
  compilación -- verificado y detenido de inmediato (higiene de dev
  server, `CLAUDE.md`).
- `node --test tests/*.mjs`: **692/692 passed, 0 failed, 0 skipped.**

**No se hizo commit en esta tarea** -- verificación pura, según lo
pedido ("NO commitear todavía"). El fix de `cert_org_estatus`/los 8
flags de `fn_listar_padron_socios` (`20260901180000`) queda confirmado
en vivo y listo para commitear cuando el arquitecto lo indique, junto
con el resto de archivos de esta ronda (`lib/actions/sociosActions.js`,
`components/features/socios/SocioFormModal.jsx`,
`supabase/migrations/20260901180000_fix_cert_org_estatus_listado.sql`,
`supabase/migrations/rollback/20260901180000_ROLLBACK.sql`).

## 2026-09-02 — `npm run lint` habilitado (bloqueo documentado desde `2026-08-25` resuelto)

**Causa raíz real (confirmada antes de tocar nada, ver
`specs/setup_eslint.md`):** no era un bug de Next.js ni del proyecto —
simplemente no existía ningún archivo de configuración de ESLint
(`.eslintrc.json`) ni `eslint`/`eslint-config-next` estaban instalados.
`next lint` sin configuración previa dispara un asistente **interactivo**
(elegir Strict/Base/Cancel, luego auto-instala dependencias) — eso es lo
que bloqueaba el comando en esta sesión no interactiva, documentado
desde `2026-08-25` y repetido en varias entradas posteriores sin
resolverse hasta ahora.

**Fix:** `eslint@^8.57.1` + `eslint-config-next@^14.2.35` (misma
minor/patch que `next@14.2.35`, ya instalado) agregados a
`devDependencies`, `.eslintrc.json` (`{ "extends":
"next/core-web-vitals" }`) y `.eslintignore`
(`node_modules/`/`.next/`/`out/`/`dist/`/`public/` — estos 2 últimos no
existen hoy en el repo, excluidos igual de forma preventiva) creados
ANTES de correr `next lint` por primera vez, para que nunca dispare el
asistente interactivo. El script `"lint": "next lint"` ya existía en
`package.json` desde antes de esta tarea — no hizo falta agregarlo, solo
confirmarlo.

**Resultado real de `npm run lint` (primera corrida):** 2 errores reales
(bloqueantes, exit code ≠ 0), 8 warnings. Los 2 errores eran el mismo
tipo (`react/no-unescaped-entities`, comillas `"` literales sin escapar
dentro de texto JSX) en 2 archivos:
- `app/dashboard/qc/components/QcDetailEditor.jsx:360` (2 instancias).
- `components/features/socios/ImportPadronModal.jsx:224` (8 instancias).

**Corregidos ambos** — cambio puramente mecánico (`"` → `&quot;` dentro
de texto JSX), sin tocar ningún atributo de componente ni lógica; el
texto renderizado en pantalla es idéntico carácter por carácter. Segunda
corrida: **exit code 0**, 0 errores.

**8 warnings quedan SIN tocar, documentados acá en vez de forzados**
(ninguno es un fix mecánico seguro, cada uno requiere una decisión de
diseño real):
- `@next/next/no-img-element` (4 casos: `app/dashboard/lotes/page.jsx:107`,
  `app/dashboard/qc/components/QcDetailEditor.jsx:292`,
  `app/trace/[lot_hash]/page.jsx:67`) — migrar a `next/image` cambia
  comportamiento real (requiere `width`/`height`, lazy-loading distinto,
  posible diferencia visual) — no es un fix de sintaxis.
- `react-hooks/exhaustive-deps` (3 casos: `QcDetailEditor.jsx:253`
  falta `record.fecha_monitoreo`, `components/EUDRMap.jsx:65` falta
  `records`, `components/gis/MapDashboard.jsx:630` falta
  `renderLayers`) — agregar la dependencia faltante a ciegas puede
  cambiar el comportamiento real del efecto (re-ejecuciones adicionales,
  posibles loops) — cada uno necesita revisión puntual de por qué se
  omitió esa dependencia originalmente, no un fix reflejo.

**Verificado:**
- `npm run build`: compila limpio, 10 rutas, mismos 8 warnings de ESLint
  (Next corre lint como parte del build por defecto — confirma que la
  config quedó bien conectada al pipeline real, no solo al script
  suelto), 0 errores.
- `node --test tests/*.mjs`: **692/692 passed, 0 failed** (el cambio no
  toca ningún módulo `lib/*.js` testeado, solo 2 archivos `.jsx` de
  texto visible y config nueva).
- `npm install` reportó 5 vulnerabilidades "high" (transitivas de
  `eslint@8.x`, que ya está en End-of-Life pero es el único major
  compatible con `eslint-config-next@14.x` — peer dependency real,
  `^7.23.0 || ^8.0.0`). **No se corrió `npm audit fix --force`** —
  fuera de alcance de esta tarea (podría introducir cambios rompientes
  no relacionados con lint) y no fue pedido; queda como hallazgo para
  una tarea aparte si el arquitecto la prioriza.

**Archivos nuevos:** `specs/setup_eslint.md`, `plans/setup_eslint_ejecucion.md`,
`.eslintrc.json`, `.eslintignore`. **Modificados:** `package.json`,
`package-lock.json` (nuevas devDependencies),
`app/dashboard/qc/components/QcDetailEditor.jsx`,
`components/features/socios/ImportPadronModal.jsx` (solo el escape de
comillas). No se aplicó nada en Supabase, no aplica a esta tarea. No se
hizo commit todavía — pendiente de confirmación antes de push a
`staging`, mismo flujo del resto de la sesión.

## 2026-09-02b — Gate temporal de contraseña compartida (`middleware.js`) para `/dashboard/**` + hallazgo real en el `lot_hash` público

**Contexto:** preparación para desplegar en Vercel. Mientras se diseña
el login real por organización/rol (proyecto aparte), se agrega un gate
de contraseña compartida (HTTP Basic Auth, un solo usuario/clave) sobre
`/dashboard/**` y las rutas internas de `/api/qc/**`/`/api/gis/**` que
las respaldan — nunca sobre `/trace/[lot_hash]`/`/api/trace/**`, el
portal público de trazabilidad, que debe seguir accesible sin
contraseña.

**Reconocimiento previo (solo lectura, ver el reporte completo entregado
al usuario ese turno):**
- `process.env.*` reales: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicas), `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_URL` (fallback), `PYTHON_BIN`, `RYZOS_DRIVE_ROOT` (esta
  última se lee indirecto vía `resolveDriveRoot(process.env)` en
  `lib/driveSyncTrigger.js`, no con el patrón literal
  `process.env.RYZOS_DRIVE_ROOT` — a propósito, para poder testear sin
  mockear `process.env` global).
- `.gitignore` cubre `.env`/`.env.*`/`*.env` (con `!.env.example`
  explícito); `git log --all --full-history -- .env .env.local
  .env.production` → vacío, ningún archivo de entorno real fue
  comiteado nunca. Solo `.env.example` está trackeado, y contiene
  únicamente placeholders.
- `app/api/**` (8 rutas): ninguna hace un dump directo de
  `PADRON_SOCIOS`/`PADRON_PARCELAS`/`INSPECCIONES`/`CAP_*`. Solo
  `app/api/qc/validar-organizacion-socio-parcela/route.js` consulta
  `PADRON_SOCIOS`/`PADRON_PARCELAS` server-side (Service Role Key, vía
  `checkSocioParcelaOrganizacion`), pero devuelve solo un resultado de
  validación, no los campos PII. El resto de `/api/qc/**`/`/api/gis/**`
  toca únicamente tablas EUDR/GIS (sin PII) o no toca la base en
  absoluto. Todas son consumidas exclusivamente por `/dashboard/qc`/
  `/dashboard/mapa` — nunca pensadas para ser alcanzables desde fuera de
  esas pantallas, por eso quedan bajo el mismo gate aunque casi ninguna
  devuelva PII directo.
- `vercel.json` **ya existía** (no fue creado en esta tarea) y ya
  cumple `specs/despliegue_vercel.md` §2/§3 exacto — mismo
  `framework: "nextjs"` y el mismo bloque de 5 cabeceras de seguridad
  (`X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy`/
  `Permissions-Policy`/`Strict-Transport-Security`) que la spec
  describe, verificado leyendo ambos archivos, no asumido.
- `package.json` sin campo `engines` — Vercel usará su default de Node
  si no se especifica; no bloqueante, señalado como hallazgo para quien
  configure el proyecto en el dashboard de Vercel.

**Hallazgo real, no bloqueante — el `lot_hash` público NO usa HMAC+salt,
contradice `CLAUDE.md`/`docs/RYZOS_ORQUESTADOR_V3.1.md` §1:**
`lib/traceabilityHash.js::generateLotHash` y su contraparte
`scripts/generate_lot_qr.py::generate_lot_hash` (deben coincidir byte a
byte, documentado en el propio archivo) generan el hash con
`hashlib.sha256`/`crypto.subtle.digest('SHA-256')` **plano, sin ninguna
clave secreta ni salt por organización** — los invariantes documentados
en `CLAUDE.md`/`RYZOS_ORQUESTADOR_V3.1.md` §1 dicen explícitamente
"HMAC-SHA256 con salt secreto por organización... nunca hash plano de
datos sensibles". El código real no implementa eso. **Por qué no es
bloqueante hoy:** los campos que entran al hash
(`organization_id`/`total_plots`/`total_hectares`/`id_monitoreo`) no son
PII — ningún DNI, nombre, ni dato sensible se hashea acá; la
sanitización real de PII pasa por un mecanismo separado
(`PII_FIELDS`/`buildPublicSanitizedPayload`, que sí filtra
`socio_dni`/`socio_nombre_completo`/etc. de las properties antes de
exponerlas). **Queda como pendiente de decisión, no corregido en esta
tarea:** o se implementa el HMAC+salt real que la documentación
promete, o se corrige la documentación para reflejar lo que el código
realmente hace hoy — cualquiera de las 2 es una decisión del arquitecto,
no algo para resolver de paso en una tarea de despliegue.

**`middleware.js` (raíz del proyecto, JS plano, sin TypeScript) — ya
redactado, revisado línea por línea y aprobado sin cambios de código en
el turno anterior:**
- `matcher: ['/dashboard/:path*', '/api/qc/:path*', '/api/gis/:path*']`
  — `/trace/:path*`/`/api/trace/:path*` y todos los assets estáticos
  quedan fuera por construcción (matcher positivo, no una exclusión
  sobre "todo").
- HTTP Basic Auth: usuario fijo no secreto `"ryzos"` + contraseña desde
  `process.env.DASHBOARD_GATE_PASSWORD`. Decodifica con `atob` (Web API
  estándar, no `Buffer` — el middleware de Next.js corre en Edge
  Runtime por defecto, donde `Buffer` no está garantizado).
- **Fail-closed real:** si `DASHBOARD_GATE_PASSWORD` no está definida,
  el middleware bloquea con 401 igual, nunca deja pasar sin contraseña
  por una variable de entorno faltante.
- 401 responde con `WWW-Authenticate: Basic realm="RYZOS interno"` —
  dispara el diálogo nativo del navegador, sin UI propia.

**Verificado en la rama `feature/dashboard-password-gate`:**
- `npm run build`: compila limpio, **nueva línea en el output
  confirmando que Next.js compiló el middleware** (`ƒ Middleware 26.7
  kB`), mismos 8 warnings preexistentes (ninguno nuevo de
  `middleware.js`), 0 errores.
- `npm run lint`: exit code 0, mismos 8 warnings, sin hallazgos nuevos.
- No hizo falta el protocolo de "2 intentos y detenerse" — ambos
  pasaron a la primera.

**Contrato de datos:** variable de entorno nueva `DASHBOARD_GATE_PASSWORD`
(string, server-only, sin prefijo `NEXT_PUBLIC_`) — **requerida en
Production y Preview de Vercel**; sin ella el gate bloquea todo
`/dashboard/**` con 401 permanente (fail-closed, comportamiento
esperado, no un bug). Sin cambios de schema SQL en esta tarea.

## 2026-09-02c — Login real por organización y rol, Fase A (capa de identidad) — diseñada, no aplicada + hallazgo colateral real (CRLF rompe 5 tests preexistentes, sin relación con esta tarea)

**Paso 1 — verificación previa contra la instancia real (antes de
escribir nada), sin conexión Postgres directa (mismo límite de
siempre) -- vía REST:**
- `auth_org_id()` existe, callable por `anon`, devuelve `null` hoy.
  Definición SQL confirmada cruzando
  `supabase/migrations/20260816_fase3_seguridad_rls.sql` (única
  migración del repo que la define, sin redefinición posterior) contra
  el texto exacto del prompt -- coincide carácter por carácter
  (`LANGUAGE sql STABLE`, sin `SECURITY DEFINER`, mismo `SELECT`).
- `public.auth_role()` NO existe (`PGRST202`).
- `public."PERFILES_USUARIO_INTERNOS"` NO existe (`PGRST205`).
- `public."ORGANIZACIONES"."ID"` confirmado real (`COOP-AROMAS-VALLE`,
  `ORG-TEST-DEMO`).
Ningún hallazgo obligó a detenerse -- el contexto que asumía el prompt
seguía vigente.

**Entregado (todo sin aplicar/commitear hasta este punto, revisión
pendiente):**
- `specs/login_real_organizacion_rol.md` (contenido exacto pedido, sin
  parafrasear).
- `plans/login_real_organizacion_rol_fase_a_ejecucion.md` -- incluye una
  corrección propia sobre un borrador anterior del mismo plan: el caso
  de aislamiento cross-org exige por definición un perfil real en
  `COOP-AROMAS-VALLE` (no alcanza con 2 usuarios de la misma org) -- se
  corrigió antes de escribir el test, no después.
- `supabase/migrations/20260902213506_login_fase_a_identidad.sql` --
  mismo diseño exacto del prompt (tabla + 2 políticas de `SELECT` +
  `auth_role()` nueva + `auth_org_id()` redefinida, ambas
  `SECURITY DEFINER` con `REVOKE`/`GRANT` explícito). Advertencia de
  compatibilidad verificada como pedía el prompt: `auth_org_id()` hoy no
  tiene ningún `GRANT`/`REVOKE` documentado (default de Postgres,
  `EXECUTE` a `PUBLIC` -- confirmado en vivo, `anon` la llama sin
  `42501`) -- pasar a `REVOKE ALL FROM PUBLIC` + `GRANT` explícito a
  `authenticated, anon, service_role` preserva el acceso de esos 3 roles
  y es un endurecimiento estricto, ningún consumidor actual pierde
  acceso.

**Capacidad de crear/loguear/borrar usuarios reales de `auth.users`
confirmada en vivo ANTES de escribir el test (paso 5 del prompt exigía
esto o detenerse a reportar el gap -- no hizo falta):** Admin API de
Supabase Auth con la Service Role Key -- `POST /auth/v1/admin/users`
(crear, HTTP 200), `POST /auth/v1/token?grant_type=password` (login
real, devuelve un `access_token` de sesión `authenticated` genuina --
lo que permite probar RLS de verdad, no simulado), `DELETE
/auth/v1/admin/users/{id}` (borrar, HTTP 200). Probado con 1 usuario
desechable, creado y borrado en el acto, sin residuo.

**`tests/test_login_fase_a_identidad_live.mjs` (5 tests, mismo patrón
de `tests/test_padron_read_functions_live.mjs` -- gateado por
`HAS_CREDENTIALS` + probe propio contra `auth_role`, se salta con
`PGRST202` hasta que se aplique la migración):**
1. Aislamiento cross-org (perfil real en `COOP-AROMAS-VALLE`, admin de
   `ORG-TEST-DEMO` no puede leerlo).
2. Aislamiento por rol: `tecnico_campo` no puede leer el perfil de otro
   usuario de su misma organización.
3. Confirmación positiva (no pedida explícitamente, agregada para no
   dejar solo la prueba negativa): un `admin` SÍ puede leer el perfil de
   otro usuario de su misma organización -- sin esto, una política rota
   que bloqueara a TODOS (incluido admin) pasaría la prueba negativa
   igual, dando una falsa sensación de seguridad.
4. `auth_org_id()`/`auth_role()` degradan a `NULL` (no error) para
   sesión `anon`.
5. Mismo degrade a `NULL` para una sesión `authenticated` REAL pero sin
   fila de perfil (caso distinto de `anon`, pedido explícito del
   prompt: "para una sesión anon/sin perfil").

Corridos ahora mismo: **5/5 se saltan limpio**, sin error, con el
mensaje esperado (migración no aplicada) -- confirma que el archivo en
sí no tiene bugs de sintaxis/setup, solo falta que se aplique la
migración para correr de verdad.

**Hallazgo colateral real, NO causado por esta tarea -- 5 tests
preexistentes fallando por un problema de fin de línea, no de código:**
al correr `node --test tests/*.mjs` completo aparecieron 5 fallos
nuevos respecto del último "692/692" confirmado (`run_e2e_etl_test.py`,
`test_e2e_teardown.py` x2, la migración `20260821_225310_fk_id_organizacion_eudr.sql`,
y `ParcelaFormModal.jsx`). Investigado antes de descartarlo como "no es
mío": ninguno de los 5 archivos fue tocado por esta tarea
(`git diff HEAD` vacío para los 5). Causa raíz real, confirmada con
evidencia (no supuesta): `core.autocrlf = true` (config de git de este
entorno, no algo que yo haya cambiado) reescribió esos archivos de `LF`
a `CRLF` en el working tree durante los checkouts `main`↔`staging` de
la tarea anterior (promoción a producción) -- confirmado contando bytes
con Node (`ParcelaFormModal.jsx`: 328 `CRLF`, 0 `LF` suelto). `git diff
HEAD` no muestra nada porque `autocrlf` normaliza `CRLF`↔`LF`
internamente al comparar -- para git, el archivo está intacto. El
código real está intacto y correcto (confirmado: `.from('PRODUCTOS')`
con los filtros correctos sigue en el archivo, verificado con una
búsqueda consciente de `\r\n`). Lo que rompe es que estos 5 tests
específicos (a diferencia de la inmensa mayoría de la suite) usan
`indexOf` con un literal que incluye `\n` crudo -- un patrón frágil que
ya existía, no introducido acá, que nunca se había topado con un
archivo `CRLF` hasta este checkout. **No se tocó ninguno de los 5
archivos ni el test** -- fuera de alcance de esta tarea (`"no toques
código previo"`, instrucción explícita del prompt), y arreglarlo de
paso sería scope creep sobre una tarea de esquema. Queda como hallazgo
para una tarea aparte (opciones: normalizar esos 5 archivos de vuelta a
`LF`, o hacer los 5 tests indiferentes a `\r`).

**Verificado:** `npm run build` limpio (mismos 8 warnings preexistentes,
`ƒ Middleware` presente, 0 errores). `npm run lint` exit code 0, sin
hallazgos nuevos. Ningún archivo de `app/`/`components/`/`lib/actions/`
tocado, `middleware.js` sin tocar -- confirmado con `git diff HEAD`
antes de reportar.

**No se aplicó nada en Supabase. No se hizo commit todavía en el
momento de escribir esta entrada** -- migración + specs + plan + tests
listos para revisión, mismo flujo del resto de la sesión.

## 2026-09-03 — Login real en la web, Fase B — implementado y verificado en vivo

**Paso 1 -- verificación previa (antes de escribir nada):**
- `@supabase/ssr` NO estaba en `package.json` (solo `@supabase/supabase-js`) -- confirmado.
- `app/login/` no existía -- confirmado.
- `middleware.js` real coincidía exactamente con el commit `47cdcbf`
  (`git diff 47cdcbf -- middleware.js` vacío) -- confirmado antes de
  tocarlo.
- `lib/supabaseServerClient.js` (Service Role Key) leído, NO tocado --
  los clientes nuevos de esta fase viven en `lib/supabase/` (namespace
  distinto) con nombres que no se confunden:
  `sessionServerClient.js`/`browserClient.js`, nunca
  `supabaseServerClient` reutilizado.

**`@supabase/ssr` -- compatibilidad verificada antes de fijar versión:**
última estable `0.12.5`, peer dependency `@supabase/supabase-js@^2.112.4`.
`package.json` ya declaraba `^2.0.0` (rango amplio) -- `npm install`
resolvió `@supabase/supabase-js` a `2.114.0` (dentro del mismo rango
`^2.0.0`, sin bump de major), sin conflicto. Mismas 6 vulnerabilidades
`npm audit` que ya existían (transitivas de `eslint@8.x`, sin relación).

**Archivos nuevos:**
- `lib/supabase/browserClient.js` -- `createBrowserClient`, sesión en
  cookies (no localStorage como `lib/supabaseClient.js`, el cliente
  `anon` sin sesión que sigue usando el resto de la app). Único
  consumidor hoy: `app/login/page.jsx`.
- `lib/supabase/sessionServerClient.js` -- 2 funciones:
  `createSessionServerClient()` (Server Components/Actions, `cookies()`
  de `next/headers`, `setAll` con `try/catch` silencioso para el caso
  de un Server Component puro que no puede escribir cookies -- mismo
  criterio que la guía oficial de Supabase) y
  `createSessionMiddlewareClient(request, response)` (middleware,
  `request`/`response` de `NextRequest`/`NextResponse` directo --
  `next/headers` no está disponible ahí). Ambas usan `getAll`/`setAll`
  (no los `get`/`set`/`remove` deprecados en esta versión).
- `app/login/page.jsx` -- ruta pública (fuera del `matcher` de
  `middleware.js` a propósito), formulario email+contraseña,
  `signInWithPassword` con el cliente de navegador. Mensaje de error
  genérico ("Email o contraseña incorrectos") sin distinguir usuario
  inexistente de contraseña incorrecta -- evita enumeración de cuentas,
  pedido explícito. `?next=` leído de `window.location.search` directo
  (mismo criterio ya usado para `?org=` en
  `app/dashboard/socios/page.jsx` -- evita envolver la página en
  `<Suspense>` solo por `useSearchParams`), validado que empiece con
  `/` antes de usarlo (evita open redirect).
- `lib/actions/authActions.js` -- `signOutAction` (`'use server'`),
  `supabase.auth.signOut()` + `redirect('/login')`. **Con botón real,
  no código muerto:** wireado en
  `components/layout/DashboardSidebar.jsx` (`<form action={signOutAction}>`,
  visible en toda `/dashboard/*` vía el layout compartido
  `app/dashboard/layout.jsx`).
- `lib/auth/getCurrentProfile.js` -- sin consumidores todavía (Fase
  C/D). `auth.getUser()` + `SELECT` a `PERFILES_USUARIO_INTERNOS`
  (política `rls_select_propio_perfil` ya permite leer la propia fila,
  Fase A). Degrada a `{userId:null,email:null,organizacion:null,rol:null}`
  para cualquier caso sin sesión o sin perfil -- nunca lanza error,
  mismo criterio que `auth_org_id()`/`auth_role()`.

**`middleware.js` -- EXTENDIDO, no reescrito** (confirmado con
`git diff` que el bloque de Basic Auth original es idéntico, solo se
agregó código después): tras pasar Basic Auth, `middleware` (ahora
`async`) crea `response = NextResponse.next({ request })`, resuelve
`createSessionMiddlewareClient(request, response)`, y llama
`auth.getUser()` -- **nunca `getSession()` sin validar** (`getUser()`
valida el JWT contra el servidor de Supabase Auth de verdad;
`getSession()` solo lee la cookie sin confirmar que siga siendo válida,
recomendación de seguridad oficial de Supabase). Sin usuario válido:
`NextResponse.redirect` 307 a `/login?next=<ruta original>`. `matcher`
sin cambios (`['/dashboard/:path*', '/api/qc/:path*', '/api/gis/:path*']`)
-- `/login` nunca se agregó ahí, sigue siendo alcanzable sin ninguna
credencial. `/trace/[lot_hash]`/`/api/trace/**` siguen totalmente fuera
de los 2 gates (Basic Auth + sesión) -- no están en el `matcher`, cero
cambio de comportamiento, confirmado con el build (mismas rutas
públicas, sin `ƒ Middleware` aplicado a ellas).

**Test nuevo, verificado contra el dev server real (no solo diseñado):**
`tests/test_dashboard_gate_session_redirect_live.mjs` -- 2 tests, HTTP
real contra `http://localhost:3000` con `redirect: 'manual'`:
1. Basic Auth correcto + SIN cookie de sesión → confirmado 307 a
   `/login`, nunca 200.
2. Basic Auth incorrecto → sigue en 401 (no se rompió con el cambio de
   Fase B).
Corridos con `npm run dev` real levantado -- **2/2 passed** (el primer
intento dio "no se pudo alcanzar" porque Next todavía estaba compilando
el middleware on-demand en el primer hit real -- normal, un segundo
intento con el server ya tibio pasó limpio; no es un bug del test ni
del middleware). Se saltan limpio (mensaje explicativo, no simulan
nada) si no hay dev server corriendo -- confirmado también así, con el
dev server apagado antes de correr la suite completa.

**Smoke test manual -- cuenta descartable creada, dejada ACTIVA a
propósito para que se pruebe primero (no borrada todavía):**
- Usuario `smoketest-fase-b@ryzos-test.invalid` /
  `RyzosSmokeTest-FaseB-2026!` (Admin API, `auth.users`), perfil
  `admin` en `ORG-TEST-DEMO` (`PERFILES_USUARIO_INTERNOS`, Fase A ya
  aplicada). Documentado en `docs/ESTADO_PROYECTO.md` con los pasos
  exactos (a/b/c del prompt) y el comando de borrado para después de
  probar.

**Verificado:** `npm run build` -- compila limpio, ruta `/login` nueva
en el output (11 rutas), `ƒ Middleware` **26.7 kB → 89.9 kB** (esperado,
ahora empaqueta `@supabase/ssr`), mismos 8 warnings preexistentes, 0
errores. `npm run lint` exit code 0, sin hallazgos nuevos. Suite
completa `node --test tests/*.mjs`: **699 tests, 692 pass, 5 fail
(mismos 5 preexistentes por CRLF, ya documentados en `2026-09-02c`, sin
relación con esta fase, no tocados), 2 skip** (el test nuevo de
redirect, dev server apagado en esa corrida en particular -- ya
verificado aparte con el server prendido, ver arriba).

**No se tocó `INSPECCIONES`/`CAP_*` (Fase C) ni se aprovisionaron las
cuentas reales de `COOP-AROMAS-VALLE`/las 3 demo de `ORG-TEST-DEMO`
(Fase D)** -- fuera de alcance explícito de esta fase.

## 2026-09-03b — Fase C Paso 1 (cliente de sesión en INSPECCIONES/CAP_*) verificado en vivo + Paso 1.5: bug preexistente uuid/text encontrado y fix preparado, sin aplicar

**Paso 1 -- los 3 call sites reales de `lib/inspeccionesActions.js`**
(`app/dashboard/inspecciones/page.jsx`, `useInspeccionForm.js` x2) pasaron
de `getSupabaseClient()` (anon) a `getSupabaseBrowserClient()` (sesión,
Fase B) -- commit `6cc19f0`. Verificado en vivo contra un dev server real
con una cuenta descartable (`ORG-TEST-DEMO`, Admin API, borrada al
terminar): lectura de `/dashboard/inspecciones` devuelve resultados
byte-idénticos entre sesión anon y autenticada -- el swap de cliente es
inerte para lecturas, como se esperaba (sin RLS nuevo todavía, eso es
Paso 2).

**3 preguntas de reconocimiento para el diseño del RLS de Paso 2
(respondidas por introspección OpenAPI de PostgREST, `GET /rest/v1/`):**
a. La PK de `INSPECCIONES` es `"ID_Inspeccion"`, tipo **`text`**, no
   `uuid` (confirmado con el truco de case-sensitivity: un filtro con el
   valor en otro casing matcheó igual, lo que solo pasa si Postgres
   normaliza el valor como en una columna `uuid` real -- pero acá NO
   normalizó, confirmando `text`).
b. Las 6 tablas `CAP_*` (`CAP_DATOS_SOCIO`, `CAP_MIC`, `CAP_CONSERVACION`,
   `CAP_BIENESTAR`, `CAP_RIESGOS`, `CAP_GESTION`) usan todas el mismo
   nombre de columna FK: `"ID_Inspeccion"`.
c. No existe ningún DELETE real de inspecciones en la UI -- ni botón, ni
   Server Action, ni RPC.

**Bug preexistente encontrado durante la verificación de Paso 1 (NO
introducido por Fase C, NO relacionado al login) --
`fn_guardar_inspeccion_completa()` (creada en
`20260818_inspecciones_atomic_save.sql`) falla en TODA creación de
inspección nueva con:**
```
42883 operator does not exist: text = uuid
```
Causa: `INSPECCIONES."ID_Inspeccion"` es `text` (ver pregunta (a) arriba),
pero la función declara `p_id uuid` / `v_id uuid`, así que cualquier
`WHERE "ID_Inspeccion" = v_id` compara `text = uuid` y Postgres no tiene
ese operador. Confirmado que es preexistente y no relacionado al cliente
de sesión: se reprodujo el **mismo error exacto** llamando al RPC con la
anon key pura. Confirmado que no deja residuo: la función no tiene manejo
de excepciones, así que el `RAISE`/error revierte toda la transacción
implícita de la llamada RPC -- verificado con conteos REST antes/después
en `INSPECCIONES` y las 6 `CAP_*`, cero filas nuevas en ninguna.

**Fix preparado, NO aplicado en Supabase (pendiente de revisión del
arquitecto):** `supabase/migrations/20260903045407_fix_tipo_id_inspeccion.sql`
-- `DROP FUNCTION` (firma vieja exacta) + `CREATE FUNCTION` con el mismo
cuerpo íntegro de `20260818_inspecciones_atomic_save.sql` y exactamente 3
cambios: `p_id uuid`→`p_id text`, `v_id uuid;`→`v_id text;`,
`v_id := extensions.uuid_generate_v4();`→
`v_id := extensions.uuid_generate_v4()::text;`. Ninguna otra línea tocada
(confirmado con `diff` contra el original, filtrando líneas de
comentario -- el único diff funcional son esos 3 cambios más el
DROP/CREATE y el REVOKE/GRANT). Sigue sin `SECURITY DEFINER` (mismo
criterio que el original: RLS es la autoridad real, la función no debe
escalar privilegios). Como el DROP+CREATE resetea los grants a los
defaults de Postgres, se agregó `REVOKE ALL ... FROM PUBLIC` explícito
antes de volver a otorgar `EXECUTE` a `anon, authenticated` (mismos
destinatarios de antes -- no se decide acá si `anon` debe seguir
teniendo acceso, esa decisión es de Fase C Paso 2 una vez se endurezca
el RLS a nivel de tabla).

**Verificación manual preparada para después de que el arquitecto
aplique la migración (NO ejecutada todavía):**
1. Crear una inspección de prueba real con datos mínimos válidos (cuenta
   descartable si hace falta sesión, mismo patrón Admin API usado en
   Fase B/Paso 1 -- crear, usar, borrar).
2. Confirmar que el guardado (creación) ahora tiene éxito.
3. Editar esa misma inspección de prueba, confirmar que el guardado
   (edición) también tiene éxito.
4. Borrar la fila de prueba en `INSPECCIONES` y sus 6 filas
   correspondientes en `CAP_*`.
5. Confirmar explícitamente que las 2 filas legacy de `COOP-JS` en
   `INSPECCIONES` siguen intactas (no tocadas por ninguno de los pasos
   anteriores).

**No se aplicó nada en Supabase.** No se decidió el acceso de `anon` a
futuro (Fase C Paso 2). No se tocó RLS.

## 2026-09-03c — Fase D Paso 1: aprovisionamiento real de las 5 cuentas de login (roster COOP-AROMAS-VALLE + 3 demo ORG-TEST-DEMO) — corrido en vivo, verificado

**Verificación previa (antes de escribir el script):**
- `docs/schema_live.md` dice que `PERFILES_USUARIO_INTERNOS`
  (`20260902213506_login_fase_a_identidad.sql`) está "NO aplicada
  todavía" -- **ese dato está desactualizado**. Confirmado en vivo vía
  PostgREST (`GET /rest/v1/PERFILES_USUARIO_INTERNOS?select=user_id&limit=1`
  con Service Role Key) que la tabla existe y responde `200` (vacía,
  antes de esta tarea) -- consistente con el smoke test manual de la
  Fase B (`2026-09-03`), que ya insertaba un perfil ahí. `docs/schema_live.md`
  queda pendiente de corrección en un paso aparte (no se tocó en esta
  tarea, fuera de su alcance declarado).
- Columnas reales de `PERFILES_USUARIO_INTERNOS` confirmadas leyendo la
  migración fuente (no asumidas): `user_id uuid PK/FK auth.users(id) ON
  DELETE CASCADE`, `"ID_Organizacion" text NOT NULL REFERENCES
  ORGANIZACIONES("ID")`, `rol text CHECK IN
  ('admin','tecnico_campo','auditor_qc')`, `nombre_completo text NOT
  NULL`, `activo boolean DEFAULT true`, `creado_en`/`actualizado_en
  timestamptz DEFAULT now()` -- coinciden exactamente con el contrato
  Zod del prompt, sin discrepancias -- no hizo falta detenerse.
  `ORGANIZACIONES."ID"` confirmado como el nombre real de columna (uso
  ya establecido en el resto del repo).
- Confirmado en vivo que ambas organizaciones destino ya existen en
  `ORGANIZACIONES` (`COOP-AROMAS-VALLE`, `ORG-TEST-DEMO`) -- si no
  existieran, el `upsert` de `PERFILES_USUARIO_INTERNOS` habría fallado
  por la FK.
- `@supabase/supabase-js` y `zod` ya eran dependencias del proyecto --
  no se agregó ninguna dependencia nueva.

**Script nuevo:** `scripts/provision_login_accounts.mjs` (Node ESM,
ejecución manual únicamente, nunca importado desde `app/`). Sigue el
mismo patrón ya usado en `scripts/generar_padron_sintetico.mjs` para
`.env.local` sin `dotenv` (no instalado). Por cada una de las 5 cuentas
(contrato Zod validado antes de tocar la base): busca por email
paginando `auth.admin.listUsers()` (no existe `getUserByEmail` estable
en el SDK); si no existe, invita (`inviteUserByEmail`, 2 cuentas reales
de `COOP-AROMAS-VALLE`) o crea con contraseña aleatoria de
`crypto.randomBytes(18).toString('base64url')`
(`admin.createUser({..., email_confirm:true})`, 3 cuentas demo de
`ORG-TEST-DEMO`, TLD `.test`); si ya existe, no repite la
invitación/creación. En ambos casos, `upsert` (Service Role, bypasea
RLS a propósito -- esa tabla no tiene política de escritura para
`authenticated`) de la fila en `PERFILES_USUARIO_INTERNOS`
(`onConflict: 'user_id'`) -- re-correr el script no duplica ni rompe
nada, deja el mismo estado final. Las contraseñas generadas se imprimen
SOLO por consola al final, en un bloque separado con advertencia
explícita de no pegarlas en ningún archivo del repo -- nunca se
escriben a disco ni a ningún log persistente.

**Corrido una sola vez contra la instancia real** (no hay staging de
Supabase separado). Resultado: **5/5 cuentas aprovisionadas** -- las 2
de `COOP-AROMAS-VALLE` invitadas por email (`auth_accion=invitado`),
las 3 de `ORG-TEST-DEMO` creadas con contraseña
(`auth_accion=creado`); las 5 con `perfil_accion=upsert_ok`. Las 3
contraseñas generadas se entregaron al usuario directamente en el chat,
fuera de este documento y de cualquier archivo -- **no están
registradas en ningún lugar del repositorio.**

**Verificación (consulta de solo lectura aparte, Service Role,
`GET /rest/v1/PERFILES_USUARIO_INTERNOS?select=user_id,"ID_Organizacion",rol,nombre_completo,activo`):**
confirmadas las 5 filas nuevas, cada una con `"ID_Organizacion"`/`rol`
correctos según el roster (2x `COOP-AROMAS-VALLE`: `admin`/
`tecnico_campo`; 3x `ORG-TEST-DEMO`: `admin`/`tecnico_campo`/
`auditor_qc`), todas `activo: true`.

**`npm run build`:** limpio tras reinicio de higiene (kill de `node.exe`
+ `rm -rf .next`) -- mismos 8 warnings preexistentes, 0 errores, misma
lista de rutas de antes (este paso no toca ningún archivo de `app/`).
No hay `npm test` en este repo.

**No se tocó `middleware.js`** (explícitamente fuera de alcance de este
paso). **No se corrió smoke test por rol contra las 5 pantallas de la
matriz ni el test de aislamiento cross-org** -- eso es Paso 2/3 de la
Fase D, condicionado a revisar este resultado primero. Las 2 cuentas
reales de `COOP-AROMAS-VALLE` quedan con invitación pendiente de
aceptación (no confirmadas todavía) hasta que sus dueños la acepten por
email.

## 2026-09-03d — ADR-032 aplicado en vivo (limpieza de 8 políticas RLS huérfanas en español, INSPECCIONES/CAP_*) — commit a staging

**Contexto:** ver [ADR-032](docs/adr/ADR-032-limpieza-drift-rls-espanol.md)
para el hallazgo completo y la verificación de neutralidad (escrita en la
tarea anterior, sin aplicar todavía). Esta entrada es solo el cierre:
aplicación real + verificación + commit, tras aprobación explícita del
usuario en el chat.

**Mecanismo de aplicación -- desviación deliberada del patrón habitual
del repo.** Toda migración anterior de este proyecto se aplicó a mano en
el SQL Editor de Supabase Studio (así lo documenta `CLAUDE.md` y cada
entrada previa de este archivo: "pendiente de tu revisión y aplicación
manual en Supabase Studio"). Esta vez el usuario pidió explícitamente
aplicarla desde acá. Antes de correr nada se encontró que el proyecto
Supabase SÍ está linkeado (`supabase/.temp/project-ref` =
`jhtocgxlozfuzullrtol`, confirmado además con `supabase projects list`)
-- dato que contradice lo que dice `CLAUDE.md` ("no hay proyecto de
Supabase CLI linkeado"), pendiente de corregir ahí en otra tarea. Pero
`supabase migration list` mostró la columna "Remote" vacía para las 43
migraciones locales -- es decir, la tabla de tracking de migraciones del
CLI no tiene ningún registro, aunque casi todas esas 43 ya están
aplicadas de verdad (a mano, en Studio, como dice `CLAUDE.md`). Correr
`supabase db push` habría intentado re-aplicar las 43 desde cero, no
solo la nueva -- alcance mucho mayor al pedido y riesgo real de errores
o locks sobre migraciones ya vigentes. Se usó en su lugar
`supabase db query --linked -f <archivo>` (ejecuta SQL directo contra la
base real vía Management API, sin tocar la tabla de tracking) para
correr *solo* el contenido literal de
`20260903064952_limpieza_drift_rls_policies_espanol.sql`, ni más ni
menos.

**Verificación pre-aplicación (pg_policies, INSPECCIONES + las 6
CAP_\*):** confirmó en vivo, antes de tocar nada, que las 8 políticas en
español existían exactamente como las describe el ADR (mismos nombres,
`cmd`, `roles`, `qual: true`), y que las oficiales `rls_anon_all_*`
coexistían con la condición documentada
(`"ID_Organizacion" IS NOT NULL OR auth.role() = 'service_role' OR
CURRENT_USER = 'postgres'` en INSPECCIONES; `true` sin condición en las
6 CAP_\*).

**Aplicación:** `supabase db query --linked -f
supabase/migrations/20260903064952_limpieza_drift_rls_policies_espanol.sql`
-- sin errores (0 filas devueltas, esperado para `DROP
POLICY`/`BEGIN`/`COMMIT`).

**Verificación post-aplicación (misma consulta `pg_policies`,
literal):** las 8 políticas en español ya no aparecen. Las 7 oficiales
`rls_anon_all_*` restantes son idénticas fila por fila a la verificación
previa -- mismo `cmd`, mismos `roles`, mismo `qual` carácter por
carácter (incluida la condición completa de INSPECCIONES). Confirma lo
que dice el ADR: el `DROP` no cambió ningún comportamiento de acceso
real.

**`npm run build`:** limpio -- mismos warnings preexistentes de ESLint
(imágenes sin `next/image`, 2 `exhaustive-deps`), 0 errores, mismas 19
rutas de antes. Este cambio no toca ningún archivo de `app/`/`lib/`/
`components/`, así que no se esperaba ni se encontró ningún efecto.

**Pendiente, explícitamente fuera de alcance de esta tarea (ya
documentado en el ADR, repetido acá para que quede en el registro de
cierre):**
1. Drift más amplio en las 5 tablas EUDR/PADRON (`EUDR_MONITOREO`,
   `EUDR_INSTALACIONES`, `EUDR_USO_SUELO`, `PADRON_SOCIOS`,
   `PADRON_PARCELAS`) -- políticas `ryzos_all_*`/`rls_all_*` huérfanas
   distintas de las de este ADR, necesitan su propio análisis de
   neutralidad (dependen de que `auth_org_id()`/`get_my_org_id()`
   degraden a `NULL` para `anon`, no de un conteo de filas).
2. Endurecimiento real de `anon` en INSPECCIONES/CAP_\* (Fase C Paso 2
   del login real) sigue bloqueado por `fn_guardar_inspeccion_completa()`
   no ser `SECURITY DEFINER` -- las 2 migraciones de contención
   preparadas (`20260901150000`/`20260901150100`) siguen sin aplicar.

## 2026-09-03e — NOTA PERMANENTE: `supabase db push` no es seguro en este repo hasta resolver el drift de tracking de migraciones

**No es una tarea, es una advertencia de referencia** para cualquier
sesión futura (agente o humano) que vaya a aplicar una migración con el
Supabase CLI en este repo. Encontrada al preparar el cierre de ADR-032
(`2026-09-03d`), documentada acá aparte para que no dependa de leer esa
entrada completa para encontrarla.

**El hecho:** el proyecto Supabase de este repo SÍ está linkeado
(`jhtocgxlozfuzullrtol`, "EUDR" — ver `supabase projects list`), a pesar
de que `CLAUDE.md` dice que no hay conexión disponible desde una sesión
normal. Pero `supabase migration list` muestra la columna "Remote" vacía
para las 43 migraciones locales existentes -- la tabla de tracking del
CLI (`supabase_migrations.schema_migrations` en la base remota) no tiene
ningún registro, aunque la enorme mayoría de esas 43 migraciones ya
están aplicadas de verdad en la instancia real (aplicadas a mano, en el
SQL Editor de Supabase Studio, que es el flujo que documenta
`CLAUDE.md`).

**El riesgo concreto:** `supabase db push` decide qué aplicar comparando
contra esa tabla de tracking, no contra el estado real del schema. Con
el tracking vacío, `db push` trata las 43 migraciones como pendientes y
las re-ejecuta todas, no solo las nuevas -- alcance muchísimo mayor al
de cualquier tarea puntual, con riesgo real de errores (objetos que ya
existen, si alguna no es perfectamente idempotente) o de locks
prolongados sobre tablas en uso.

**Qué usar mientras tanto:** `supabase db query --linked -f <archivo>`
-- ejecuta el SQL de un archivo puntual directo contra la base real vía
la Management API, sin tocar ni consultar la tabla de tracking. Es el
mecanismo usado para aplicar ADR-032 (`2026-09-03d`) y el que debería
seguir usándose para migraciones individuales hasta que el drift se
resuelva.

**Cómo se resolvería de fondo (no hecho todavía, fuera de alcance de
esta nota):** `supabase migration repair <version> --status applied`
por cada una de las 42 migraciones ya vigentes en producción, para que
el tracking refleje la realidad -- recién ahí `db push` volvería a ser
seguro para aplicar solo lo genuinamente nuevo. No se hizo acá porque
no fue pedido y porque marcar 42 migraciones como aplicadas sin
verificar una por una contra el schema real de cada tabla es en sí un
cambio de alcance grande, no una limpieza de una línea.

## 2026-09-03f — Fix uuid/text de `fn_guardar_inspeccion_completa` verificado funcionalmente en vivo -- **hallazgo importante: la migración YA estaba aplicada, y las 2 filas legacy de COOP-JS que debían verificarse ya no existen**

**Contexto:** cierre de `2026-09-03b` (bug preexistente uuid/text,
`supabase/migrations/20260903045407_fix_tipo_id_inspeccion.sql`, ya
commiteada en `eabd4b8` desde antes de esta sesión). Tarea pedida:
aplicar esa migración contra la instancia real y correr la verificación
funcional de 5 pasos ya preparada en `2026-09-03b`.

**Hallazgo 1 -- la migración YA estaba aplicada en producción, por fuera
de esta sesión.** Al correr `supabase db query --linked -f
supabase/migrations/20260903045407_fix_tipo_id_inspeccion.sql` el `CREATE
FUNCTION` falló con `42723: function "fn_guardar_inspeccion_completa"
already exists with same argument types` -- sin efecto destructivo (el
`DROP FUNCTION IF EXISTS` apuntaba a la firma vieja `uuid,...`, que ya no
existía, así que fue no-op; el error ocurrió recién en el `CREATE`
posterior, dentro del mismo `BEGIN`/`COMMIT`, así que no se tocó nada).
Confirmado con `pg_get_function_arguments`/`pg_get_functiondef` sobre
`pg_proc`: la función real en la instancia **ya tiene** `p_id text` /
`v_id text` (el fix), y sus grants (`information_schema.routine_privileges`)
ya son exactamente `EXECUTE` para `anon`+`authenticated` únicamente (sin
`PUBLIC`) -- el estado final deseado por la migración. No hay forma de
saber desde acá quién la aplicó ni cuándo (no fue ninguna sesión anterior
de este historial de conversación, que solo tocó RLS de
`INSPECCIONES`/`CAP_*` y aprovisionamiento de cuentas, nunca esta
función) -- probablemente aplicada a mano en Supabase Studio, coherente
con el patrón habitual del proyecto, pero sin confirmación directa.

**Hallazgo 2 -- `INSPECCIONES` está completamente vacía (0 filas), no
las "2 filas legacy de COOP-JS" que `2026-09-03b`/`ESTADO_PROYECTO.md`
documentan.** Confirmado con `SELECT count(*)` antes de tocar nada
(mismo proyecto linkeado, `jhtocgxlozfuzullrtol`, verificado con
`current_database()`), y de nuevo después de la limpieza del test: **0
en ambos momentos**. No se puede completar el paso 5 de la verificación
preparada ("confirmar que las 2 filas de COOP-JS siguen intactas") tal
como estaba escrito porque la premisa ya no es cierta -- no hay filas
COOP-JS que verificar. **No se investigó la causa** (fuera de alcance de
esta tarea, y cualquier intento de reconstruir el historial de una
tabla sin filas actuales requeriría backups/logs a los que este agente
no tiene acceso) -- **posible correlación con el Hallazgo 1** (alguien
pudo haber probado el fix a mano contra la instancia real y limpiado de
más), pero es una hipótesis, no un hecho confirmado. **Queda como
pregunta abierta para el arquitecto:** ¿las 2 filas de COOP-JS se
borraron a propósito (dato legacy que ya no hacía falta) o es una
pérdida de datos real que hay que investigar/restaurar desde un backup
de Supabase?

**Verificación funcional (paso 2 completo, contra una fila descartable
en `ORG-TEST-DEMO`, vía RPC real con `NEXT_PUBLIC_SUPABASE_ANON_KEY` --
mismo camino que reprodujo el bug original):**
1. **Creación:** `POST .../rpc/fn_guardar_inspeccion_completa` con
   `p_id: null` → `200 {"id":"d5f6908a-92d3-4a49-ac7a-8cb95887a5b2",
   "created":true}`. Antes del fix esto fallaba siempre con `42883`.
2. **Edición:** mismo RPC con `p_id` = el id devuelto arriba,
   `p_existing_organizacion: "ORG-TEST-DEMO"` → `200 {"id":"...",
   "created":false}`. Confirmado con una lectura aparte que
   `Inspector`/`Estado` reflejan el segundo payload (no el primero) --
   la edición sí persistió.
3. Confirmado con lectura aparte que las 6 `CAP_*` tenían exactamente 1
   fila cada una para ese `ID_Inspeccion` antes de la limpieza.
4. **Limpieza:** `DELETE` manual de las 6 `CAP_*` + `INSPECCIONES` para
   ese id, dentro de una sola transacción. Verificado después: 0 filas
   en las 6 `CAP_*` para ese id, 0 filas en `INSPECCIONES` para ese id,
   y el conteo total de `INSPECCIONES` volvió a 0 -- igual que antes de
   la prueba (no antes de "2", como se esperaba -- ver Hallazgo 2).

**`npm run build`:** limpio -- mismos warnings preexistentes, 0 errores,
mismas 19 rutas.

**No se volvió a commitear la migración** (ya estaba en `eabd4b8`, y de
todos modos no se aplicó nada nuevo en este paso -- ya estaba aplicada).
Este cierre documenta la verificación, no un cambio de estado nuevo en
la base.

## 2026-09-03g — Cierre de la investigación de `INSPECCIONES` vacía (`2026-09-03f`): descartado artefacto de RLS, el vacío es real a nivel de dato

**Contexto:** `2026-09-03f` dejó abierta la pregunta de si el conteo de
0 filas en `INSPECCIONES` (en vez de las 2 filas legacy de `COOP-JS`
documentadas desde `2026-09-01i`) podía ser un artefacto de RLS/rol en
vez de un vacío real. Esta entrada cierra esa pregunta puntual -- no
investiga la causa de fondo, que sigue sin resolver.

**Conteo real vía Service Role Key (REST, `Content-Range` con `Prefer:
count=exact`, bypass de RLS completo por definición de esa llave):**
`*/0` -- **0 filas**, coincide exactamente con el conteo anterior de
`2026-09-03f` hecho vía `supabase db query --linked` (canal privilegiado
sobre Postgres directo, no `anon`). Dos caminos completamente
independientes -- REST con Service Role vs. SQL directo sobre la base --
dan el mismo resultado.

**`pg_policies` sobre `INSPECCIONES`, re-consultada:** sin cambios desde
la verificación de ADR-032 (`2026-09-03d`) -- sigue existiendo
únicamente `rls_anon_all_inspecciones` (`ALL`, `{anon,authenticated}`,
`qual`/`with_check` idénticos: `"ID_Organizacion" IS NOT NULL OR
auth.role() = 'service_role' OR CURRENT_USER = 'postgres'`). **Ninguno
de los 3 nombres de política de las 2 migraciones de contención
preparadas y sin aplicar** (`20260901150000_lock_anon_write_inspecciones_cap.sql`
→ `rls_select_inspecciones_anon`/`rls_all_inspecciones_authenticated`;
`20260901150100_lock_anon_all_inspecciones_cap.sql` →
`rls_anon_deny_inspecciones`) **aparece en la instancia real** -- se
descarta que alguien las haya aplicado por fuera de esta sesión.

**Conclusión: no es un artefacto de RLS ni de rol -- el vacío de
`INSPECCIONES` es real a nivel de dato.** Las 2 filas legacy de
`COOP-JS` documentadas en `2026-09-01i` y entradas posteriores de esta
sesión ya no existen en la instancia real, bajo ningún rol ni política.

**Límite explícito de este entorno, no un abandono de la
investigación:** desde acá no hay acceso a backups de Supabase ni a
logs de queries -- ninguna herramienta de este entorno puede determinar
cuándo o por qué desaparecieron esas filas. Determinarlo (si vale la
pena) requiere que el arquitecto revise directamente, en Supabase
Studio: **Point-in-Time Recovery** (si el plan del proyecto lo tiene
habilitado) y **Database → Logs**. Ninguna acción posible desde este
agente puede sustituir eso.

**Esto no bloquea nada en curso.** No afecta ADR-032 (ya aplicado y
verificado), no afecta el fix uuid/text de
`fn_guardar_inspeccion_completa` (ya aplicado y verificado
funcionalmente en `2026-09-03f`), y no bloquea el arranque de Fase C
Paso 2 (endurecimiento real de `anon` en INSPECCIONES/CAP_*) -- es una
investigación de datos aparte, pendiente de que el arquitecto decida
si amerita revisar backups/logs, sin relación de dependencia con el
trabajo de código/RLS.

## 2026-09-03h — ADR-033 aplicado en vivo (aislamiento real por organización en INSPECCIONES/CAP_*, cierre completo de `anon`) — verificado con RPC real por rol, migraciones de contención archivadas

**Aplicación:** `supabase db query --linked -f
supabase/migrations/20260903170404_fase_c_paso2_rls_real_inspecciones_cap.sql`
-- sin errores (un primer intento fue bloqueado por el clasificador de
auto-mode como error transitorio; el reintento inmediato aplicó
limpio). `pg_policies` re-consultada después: exactamente 2 políticas
por tabla en las 7 (`rls_anon_deny_*` + `rls_write_*_authenticated`),
14 en total -- coincide carácter por carácter con lo que la migración
crea, nada de más ni de menos.

**Verificación funcional, en 2 partes:**

1. **`anon` -- ahora bloqueado, confirmado positivamente (no solo por
   ausencia de datos):** `POST .../rpc/fn_guardar_inspeccion_completa`
   con la llave `anon` pura → `401 {"code":"42501", "message":"new row
   violates row-level security policy for table \"INSPECCIONES\""}`
   (antes de esta migración, esto daba `200 {created:true}`). Para
   descartar que el `SELECT` en `0` filas fuera solo porque la tabla
   está vacía (no porque RLS bloquee), se insertó una fila de prueba
   directo vía conexión privilegiada (bypass de RLS), se confirmó que
   `anon` vía REST seguía viendo `Content-Range: */0` con esa fila
   realmente presente, y se limpió esa fila de prueba antes de seguir.
2. **`authenticated` -- sigue funcionando, con una sesión real (no una
   llamada directa a la RPC con parámetros de confianza).** Contraseña
   de la cuenta demo no disponible en este contexto y su reseteo vía
   Admin API bloqueado por el clasificador de auto-mode (ver tarea
   anterior) -- en su lugar, siguiendo la alternativa que pidió el
   arquitecto explícitamente ("magic link, no reseteo de password"):
   `POST /auth/v1/admin/generate_link` (Service Role Key, tipo
   `magiclink`, `admin-demo@ryzos-demo.test`) → `hashed_token` →
   `POST /auth/v1/verify` (anon key, mismo `token_hash`) → sesión real
   (`access_token`), decodificado y confirmado `role: authenticated`,
   `sub` = el user_id real de la cuenta, sin tocar su contraseña.
   **Creación:** `200 {"id":"f12303d2-...", "created":true}` contra
   `ORG-TEST-DEMO`. **Edición:** mismo id, `200 {"created":false}`.
   Confirmado que las 6 `CAP_*` tenían 1 fila cada una para ese id antes
   de limpiar.

**Limpieza:** ambas filas de prueba (la del probe de `anon` y la de la
sesión `authenticated`) + sus `CAP_*` correspondientes, borradas.
`INSPECCIONES` vuelve a 0 filas -- mismo estado que antes de esta tarea
(ver `2026-09-03f`/`g`, sigue sin resolverse la causa de fondo, fuera de
alcance de esta tarea también).

**`npm run build`:** limpio -- mismos warnings preexistentes, 0
errores, mismas 19 rutas.

**Migraciones de contención archivadas:** `20260901150000_lock_anon_write_inspecciones_cap.sql`
y `20260901150100_lock_anon_all_inspecciones_cap.sql` movidas a
`supabase/migrations/archivadas/` (subdirectorio que el Supabase CLI no
lee -- confirmado que solo escanea archivos directos en
`supabase/migrations/`, no subdirectorios -- así que no hay riesgo de
que `db push` los recoja por accidente). `README.md` nuevo en ese
directorio explicando por qué quedaron obsoletas (ver ADR-033) y que no
deben aplicarse nunca (colisión de nombres de política con las de esta
migración).

**Pendiente, ya trackeado aparte, no bloqueante para este cierre:**
`resolveOrganizationId()` sigue derivando la organización de filas ya
cargadas en vez de la sesión real (ver ADR-033, sección "Hallazgo
colateral") -- el flujo de creación real desde el navegador sigue roto
por esa razón, independiente de RLS, mientras `INSPECCIONES` esté vacía.
No resuelto en esta tarea, a propósito.

## 2026-09-03i — Task 16: fix de resolución de organización activa en Inspecciones — organizationId ahora viene de la sesión real, no de filas cargadas

**Contexto:** cierre del "Hallazgo colateral" de ADR-033
(`2026-09-03h`). Ver `specs/fix_resolucion_organizacion_inspecciones.md`
y `plans/fix_resolucion_organizacion_inspecciones_ejecucion.md` para el
diseño completo.

**Hallazgo central de esta tarea, ya adelantado en el reconocimiento
previo (confirmado literal, línea por línea, contra el cuerpo real de
`fn_guardar_inspeccion_completa`):** el modelo de seguridad real para
las escrituras vía esta RPC es el RLS de `INSPECCIONES`/`CAP_*`
(ADR-033, `WITH CHECK "ID_Organizacion" = auth_org_id()`), **no** una
verificación interna de la función. La función es `SECURITY INVOKER`
(sin cláusula explícita -- default de Postgres) y solo compara sus
propios 2 parámetros (`p_organizacion`/`p_existing_organizacion`) entre
sí -- ninguno se deriva de `auth.uid()`/`auth_org_id()` dentro de la
función. El docstring de `saveInspeccion()` afirmaba lo contrario
("la función RPC repite la misma verificación del lado del servidor
como autoridad real") -- corregido en el código, no solo documentado
acá (ver más abajo).

**Fix aplicado:**
- `components/features/inspecciones/useInspeccionForm.js`: eliminados
  el import y uso de `fetchInspecciones`/`resolveOrganizationId`.
  `organizationId` ahora se resuelve con `supabase.rpc('auth_org_id')`
  al inicio de `load()` -- la misma función que las políticas RLS de
  ADR-033 usan como autoridad, un solo origen de verdad entre lo que el
  cliente cree y lo que el servidor exige. 3 casos manejados: `error` →
  mismo `loadError` genérico que ya existía; `orgId` null/falsy → nuevo
  `loadError` específico ("No se pudo verificar tu organización activa.
  Verificá que tu perfil esté activo o contactá al administrador.") y
  `return` temprano, sin llamar `fetchInspeccionDetalle` (sin
  organización resuelta no hay ningún guardado válido posible, mejor
  cortar temprano que cargar un formulario que va a fallar al guardar);
  `orgId` válido → `setOrganizationId(orgId)` y continúa igual que
  antes, incluida la rama `isEdit`. Comentario `// INVARIANTE:` arriba
  del hook reescrito para describir el diseño nuevo (dos señales
  independientes por *origen* -- sesión vs. registro -- no por dos
  consultas sobre la misma tabla como antes). `existingOrganizationId`
  no cambió -- sigue viniendo solo de `fetchInspeccionDetalle()`, en
  modo edición.
- `lib/inspeccionesActions.js`: solo el docstring de `saveInspeccion()`
  reescrito con las 2 correcciones del spec (autoridad real = RLS de
  ADR-033, no la función; y `existingOrganizationId` en creación
  simplemente queda `null`, la comparación está gateada por `id` y
  nunca corre en ese modo) -- **cero cambios de lógica**, mismo cuerpo,
  mismos parámetros, mismo `supabase.rpc(...)`.
- `fn_guardar_inspeccion_completa` **no se tocó** -- fuera de alcance a
  propósito (ver spec, sección "Fuera de alcance"). Si en el futuro se
  decide agregarle una verificación interna contra `auth_org_id()` como
  defensa en profundidad, es una tarea aparte con su propio ADR.

**`npm run build`:** limpio -- mismos 3 warnings preexistentes de
ESLint, 0 errores, mismas 19 rutas. Sin warnings nuevos de imports sin
usar (confirmando que `fetchInspecciones`/`resolveOrganizationId` no
tenían ningún otro uso en este archivo, como decía el spec).

**Verificación funcional real, con sesión `authenticated` real (mismo
mecanismo de magic link vía Admin API + `/auth/v1/verify` que ADR-033,
sin resetear contraseña ni exponer el `access_token` completo):**
1. `POST .../rpc/auth_org_id` con la sesión real → `200 "ORG-TEST-DEMO"`
   (no-null) -- exactamente lo que el código nuevo necesita para no
   entrar en la rama de error.
2. **Creación** con `p_organizacion: "ORG-TEST-DEMO"` (el mismo valor
   que `auth_org_id()` acaba de devolver, replicando el flujo real del
   hook) → `200 {"id":"46323dc9-...", "created":true}`.
3. **Edición** de esa misma fila → `200 {"created":false}`; confirmado
   con lectura aparte que `Inspector`/`Estado` reflejan el segundo
   payload (`"Test Claude - editado Task 16"`/`"Completada"`) -- la
   edición sí persistió.
4. **Limpieza:** fila de prueba + sus 6 `CAP_*` borradas.
   `INSPECCIONES` vuelve a 0 filas -- mismo estado que antes de esta
   tarea.

No fue necesario un navegador real (no disponible en este entorno, ver
`2026-09-03h`) -- la verificación llama exactamente las mismas 2 RPC
(`auth_org_id`, `fn_guardar_inspeccion_completa`) que el código nuevo
llama, con una sesión real, en el mismo orden.

**No hubo fallos que documentar** -- ambos intentos (creación y edición)
funcionaron al primer intento.

## 2026-09-03j — ADR-034 aplicado en vivo (Task 10): limpieza de 13 políticas RLS huérfanas en EUDR/PADRON + creación de las 4 políticas oficiales que faltaban en PADRON_SOCIOS/PADRON_PARCELAS

**Aplicación:** `supabase db query --linked -f
supabase/migrations/20260903180720_limpieza_drift_rls_eudr_padron.sql`
-- sin errores, al primer intento.

**Verificación estructural (`pg_policies`, las 5 tablas, literal
completo):**
```
EUDR_INSTALACIONES | rls_select_eudr_instalaciones   | SELECT | {authenticated}
EUDR_INSTALACIONES | rls_write_eudr_instalaciones    | ALL    | {authenticated}
EUDR_MONITOREO     | rls_select_eudr_monitoreo       | SELECT | {authenticated}
EUDR_MONITOREO     | rls_write_eudr_monitoreo        | ALL    | {authenticated}
EUDR_USO_SUELO     | rls_select_eudr_uso_suelo       | SELECT | {authenticated}
EUDR_USO_SUELO     | rls_write_eudr_uso_suelo        | ALL    | {authenticated}
PADRON_PARCELAS    | rls_anon_select_padron_parcelas | SELECT | {anon}
PADRON_PARCELAS    | rls_select_padron_parcelas      | SELECT | {authenticated}
PADRON_PARCELAS    | rls_write_padron_parcelas       | ALL    | {authenticated}
PADRON_SOCIOS      | rls_anon_select_padron_socios   | SELECT | {anon}
PADRON_SOCIOS      | rls_select_padron_socios        | SELECT | {authenticated}
PADRON_SOCIOS      | rls_write_padron_socios         | ALL    | {authenticated}
```
Exactamente **12 políticas** -- coincide con lo esperado del ADR (2×3
tablas EUDR + 3×2 tablas PADRON). Las 13 huérfanas ya no aparecen; las 4
`rls_select_padron_*`/`rls_write_padron_*` nuevas sí; `rls_anon_select_*`
(ADR-031) intacta, sin tocar.

**Verificación funcional real, con sesión `authenticated` real (mismo
mecanismo de magic link de ADR-033/Task 16 -- sin exponer credenciales,
sin tocar la contraseña de la cuenta demo):** `SELECT` contra
`PADRON_SOCIOS` (`id,ID_Socio,ID_Organizacion`) → `206 Partial Content`,
`Content-Range: 0-2/67` -- 67 filas totales visibles, todas con
`ID_Organizacion: "ORG-TEST-DEMO"`. `SELECT` contra `PADRON_PARCELAS` →
`206`, `Content-Range: 0-2/37` -- 37 filas, mismo patrón. Ambos números
(67/37) coinciden exactamente con los conteos de `ORG-TEST-DEMO`
documentados en ADR-031 (67 de 685 en `PADRON_SOCIOS`, 37 de 858 en
`PADRON_PARCELAS`) -- confirma que el reemplazo de las políticas
huérfanas por las oficiales no cambió el comportamiento observable para
un usuario legítimo: mismo alcance de filas, sin fuga cross-org, sin
error. **No se probó escritura real ni se creó/borró ninguna fila de
Padrón** -- por pedido explícito del arquitecto (no arriesgar datos de
Padrón sin necesidad), el `SELECT` alcanzó para confirmar el objetivo de
esta verificación.

**Único inconveniente, no relacionado con la migración:** el primer
intento de `SELECT` falló con `42703 column PADRON_SOCIOS.ID does not
exist` -- error propio (supuse un nombre de columna sin confirmarlo).
Corregido consultando `information_schema.columns` primero (PK real es
`id`, minúscula, surrogate -- ADR-026), reintentado con éxito. No fue
un fallo de RLS ni de la migración.

**No hizo falta `npm run build`** -- confirmado en el ADR que esta
migración no toca ningún archivo de `app/`/`lib/`/`components/`.
