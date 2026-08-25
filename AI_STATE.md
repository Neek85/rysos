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
