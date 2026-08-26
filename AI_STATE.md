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
