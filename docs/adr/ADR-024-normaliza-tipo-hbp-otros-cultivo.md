# ADR-024 — Normaliza el tipo de `PADRON_PARCELAS.hbp`/`otros_cultivo` a `numeric`

- **Estado:** Aceptado y corregido (ver "Actualización 2026-08-25b/c" al
  final) — falló en Supabase Studio por una dependencia de vista no
  detectada en la verificación original (`vw_parcelas_web`); corregida con
  evidencia real capturada en vivo por el usuario (`pg_depend`/
  `pg_get_viewdef`/`GRANT`s), no una suposición. Pendiente de aplicación
  manual.
- **Fecha:** 2026-08-25
- **Migraciones:** `supabase/migrations/20260825142426_normaliza_tipo_hbp_otros_cultivo.sql`
  (pendiente de aplicación manual en Supabase Studio, como toda migración
  de este repo — **intentada y fallida** una vez, ver actualización abajo)
- **Spec:** este ADR (hallazgo puntual, sin spec/plan independientes — ver
  contexto en `specs/padron_baseline_adopcion.md`)
- **Tests:** `tests/test_padron_baseline_adopcion.py` (actualizado),
  `python -m pytest tests/`

## Contexto

`ADR-023`/`specs/padron_baseline_adopcion.md` (commit `6ff1daf`) adoptó
`PADRON_SOCIOS`/`PADRON_PARCELAS` al historial de migraciones capturando
el schema real vía introspección OpenAPI de PostgREST, y documentó — sin
corregir, por contrato explícito de esa tarea ("cero cambios de
comportamiento") — que `PADRON_PARCELAS.hbp` y `PADRON_PARCELAS.otros_cultivo`
son `text` en la instancia real, mientras que el resto de las columnas de
hectáreas de la misma tabla (`hcp`, `hcc`, `ho`, `hip`, `hrp`) son
`numeric`. Confirmado visualmente en Supabase Studio y, de nuevo, en vivo
acá vía el mismo endpoint OpenAPI inmediatamente antes de escribir esta
migración.

`lib/validations/socios.js` ya trata `hbp`/`otros_cultivo` como numéricas
(`HECTARE_FIELDS`, coerción con `nonNegativeNum`) desde siempre — el
schema real nunca coincidió con lo que la aplicación asume. No es una
inconsistencia introducida hoy; es una que ya existía y recién se hizo
visible al introspeccionar el schema real por primera vez.

## Verificación de solo lectura antes de alterar el tipo

Antes de escribir la migración, se consultó `PADRON_PARCELAS` completa (11
filas — mismo conteo base que `ADR-023`, no solo las visibles en el Table
Editor) vía REST con Service Role Key, `select=ID_Parcela_Fija,hbp,otros_cultivo`:

| Valor encontrado | Filas |
|---|---|
| `NULL` | 3 |
| `'0'` | 6 |
| `'1'` | 2 |

Ningún string vacío, ningún separador decimal con coma, ningún texto no
numérico. Las 11 filas castean limpio a `numeric` sin pérdida de
información. No fue necesario detenerse a reportar valores problemáticos
— el camino feliz del prompt original.

## Decisión

`ALTER COLUMN ... TYPE numeric USING NULLIF(TRIM(x), '')::numeric` para
ambas columnas, cada uno envuelto en un chequeo idempotente contra
`information_schema.columns` (no-op si la columna ya es `numeric` — cubre
una segunda ejecución accidental del archivo). El `USING` con
`NULLIF(TRIM(x), '')` convierte un string vacío o solo-espacios en `NULL`
en vez de tumbar la migración con un error de cast — no se activó con los
datos actuales, pero deja la migración segura ante una fila futura, en
cualquier entorno donde se aplique, que sí tenga uno.

No se toca ninguna otra columna de la tabla, ni `PADRON_SOCIOS`.

## Qué NO cambia

- **Contrato del frontend:** ninguno. `lib/validations/socios.js` ya
  esperaba `numeric` — este cambio elimina la discrepancia entre lo que la
  app asume y lo que la base realmente tenía, no introduce una nueva
  asunción.
- **La migración base de `ADR-023`:** no se reescribe
  `20260825183000_baseline_padron_socios_parcelas.sql` para que declare
  `hbp`/`otros_cultivo` como `numeric` desde el principio — esa migración
  documenta fielmente lo que la tabla era en ese momento (`text`); esta
  migración nueva es la que efectivamente cambia el tipo, en orden, como
  un paso separado y explícito.
- **Aplicación real contra producción:** como toda migración de este
  repo, este archivo solo queda preparado y versionado — la aplicación
  manual en Supabase Studio la hace el usuario.

## Consecuencias

- Positivo: el schema real ahora coincide con lo que la aplicación
  siempre asumió — cierra la discrepancia documentada en `ADR-023` en vez
  de dejarla como deuda permanente.
- Positivo: la migración es segura de re-ejecutar (chequeo de tipo previo
  a cada `ALTER COLUMN`) y segura ante datos sucios futuros (`NULLIF(TRIM(...))`),
  aunque los datos actuales no lo requirieran.
- Pendiente (no verificable en este entorno): confirmar tras la
  aplicación manual que `hbp`/`otros_cultivo` reportan `numeric` en una
  nueva consulta OpenAPI, y que `/dashboard/socios` sigue funcionando
  igual (mismo patrón de verificación post-aplicación que `ADR-023`).

## Actualización (2026-08-25b) — falla real al aplicar, dependencia de vista no detectada

Al correr la migración en Supabase Studio, falló:

```
cannot alter type of a column used by a view or rule
DETAIL: rule _RETURN on view vw_parcelas_web depends on column hbp
```

La verificación original de esta ADR fue de **datos** (¿castean limpio los
valores?), no de **objetos dependientes del schema** (¿algo más además de
la tabla referencia esta columna?) — un gap real en el alcance de la
verificación previa, no un dato que se pasó por alto teniéndolo disponible.

### Evidencia reunida en vivo (Service Role Key, PostgREST)

No es posible ejecutar SQL arbitrario (`pg_depend`/`pg_get_viewdef`/
`information_schema.role_table_grants`) contra la instancia real desde
este entorno de desarrollo — confirmado explícitamente, no asumido:
`CLAUDE.md` ya documenta "no hay conexión Postgres directa disponible
desde una sesión de desarrollo normal"; se verificó además que no existe
ninguna función RPC de propósito general para ejecutar SQL (todas las
`supabase.rpc(...)` del repo son funciones puntuales:
`fn_validar_codigo_parcela_unico`, `fn_cobertura_uso_suelo_parcela`,
etc.), que no hay `DATABASE_URL` ni `psycopg2` instalado/configurado para
este entorno, y que el único uso de `psycopg2` en el repo
(`scripts/qgis_qc_actions.py`) corre exclusivamente dentro del entorno
Python embebido de QGIS Desktop, no invocable desde acá.

Ante ese límite real de herramientas, se maximizó la evidencia obtenible
sin SQL crudo, vía introspección OpenAPI de PostgREST (mismo mecanismo
que `ADR-023`) y consultas REST reales de solo lectura:

1. **De los 44 objetos expuestos por PostgREST** (`PADRON_PARCELAS`,
   vistas `vw_*`, tablas del módulo Fase 6, catálogos, etc.), **solo dos
   exponen `hbp` y `otros_cultivo` heredados de `PADRON_PARCELAS`:**
   `PADRON_PARCELAS` misma y `vw_parcelas_web` — coincide exactamente con
   el único objeto que Postgres reportó en el error.
2. **`PARCELAS`** (sin `PADRON_` — tabla distinta, no una vista) también
   expone columnas `hbp`/`otros_cultivo`, pero son **columnas propias, ya
   `numeric`**, de una tabla base no relacionada — FK a
   `INSPECCIONES.ID_Inspeccion`, con el resto de columnas del formulario
   extenso de la ficha de inspección (erosión, colindantes, renovación,
   etc.), el módulo Fase 6. Coincidencia de nombre, no dependencia real
   sobre `PADRON_PARCELAS`. Se descarta explícitamente como falso
   positivo.
3. **`vw_socios_web`** también existe y está expuesta, pero no expone
   `hbp` ni `otros_cultivo` — no depende de estas columnas.
4. **`anon` tiene `SELECT` real sobre `vw_parcelas_web`** (confirmado con
   una consulta REST real usando la anon key, no solo introspección:
   HTTP 200, fila real devuelta) — el mismo mecanismo de acceso que usa
   el frontend en producción (`CLAUDE.md`: "anon key only").
5. **Ningún archivo `.js`/`.jsx`/`.py`/`.sql` de este repo referencia
   `vw_parcelas_web` ni `vw_socios_web`** (grep literal, cero resultados)
   — el impacto de romper `vw_parcelas_web` sobre el código de *este*
   repo es nulo; el riesgo real es sobre cualquier consumidor externo
   desconocido que tenga la anon key (pública en el bundle del frontend)
   y la use directamente, posiblemente un remanente de cuando
   `backend-inspecciones` compartía esta base (ver `ADR-023`) — no
   confirmado, fuera de alcance investigarlo acá.

### Lo que falta y por qué no se adivina

No se pudo obtener (requiere SQL crudo, sin acceso desde este entorno):
la definición exacta de `vw_parcelas_web` (`pg_get_viewdef`), el listado
completo de objetos dependientes vía `pg_depend`/`pg_rewrite` (que sí
detectaría dependientes no expuestos por PostgREST — reglas, vistas sin
grant, u otros objetos invisibles a la introspección OpenAPI), y el
listado exacto de `GRANT`s sobre `vw_parcelas_web` más allá de "`anon`
puede leerla" (confirmado por prueba directa, no por catálogo).

Escribir un `CREATE VIEW` adivinando el `SELECT`/joins exactos a partir
solo de las columnas visibles arriesgaría recrear la vista con lógica
distinta a la real (un `JOIN` diferente, un `WHERE` faltante, un
`ORDER BY` perdido) de forma silenciosa — el tipo de error que no se
detecta hasta mucho después. Por eso esta tarea se detiene acá en vez de
corregir la migración con una definición no verificada, siguiendo la
instrucción explícita del prompt de este paso ("si no logras evidencia
clara... detente y documenta"). Ver `AI_STATE.md` para el bloqueo
detallado y el script de diagnóstico de solo lectura preparado para que
el usuario lo corra en Supabase Studio SQL Editor y devuelva el
resultado — con eso, la migración se corrige con la definición exacta.

## Actualización (2026-08-25c) — corrección aplicada con la evidencia real

El usuario corrió el script de diagnóstico de la sección anterior en
Supabase Studio SQL Editor y confirmó: `vw_parcelas_web` es la **única**
dependencia real de `hbp`/`otros_cultivo` (coincide con lo ya inferido por
introspección OpenAPI en la actualización anterior — ningún objeto
adicional invisible a PostgREST apareció en `pg_depend`), definida con
`WITH (security_invoker = true)`, un `SELECT` plano de 19 columnas de
`PADRON_PARCELAS` (sin joins, sin `WHERE`, sin columnas calculadas —
confirmado de forma independiente antes de escribir el archivo: los 19
nombres y tipos de columna expuestos por `vw_parcelas_web` vía
introspección OpenAPI coinciden exactamente, uno a uno, con los 19 de
`PADRON_PARCELAS`), y con `GRANT`s completos —
`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`REFERENCES`/`TRIGGER`/`TRUNCATE` — a
`anon`, `authenticated` **y** `service_role`.

La migración quedó reescrita: todo el bloque (`DROP VIEW IF EXISTS` →
ambos `ALTER COLUMN ... TYPE numeric` → `CREATE VIEW ... WITH
(security_invoker = true)` con la definición exacta capturada → los 3
`GRANT` exactos) envuelto en un único chequeo de idempotencia contra
`information_schema.columns` (a diferencia de la primera versión, que
tenía un chequeo independiente por columna) — una segunda corrida es
no-op completo: no recrea la vista ni reaplica `GRANT`s si `hbp` ya es
`numeric`.

### Dos hallazgos que quedan fuera de alcance de esta tarea

1. **`vw_parcelas_web` es `security_invoker = true` y no tiene ninguna
   referencia en el código de este repo** (confirmado por grep literal en
   la actualización anterior). Es casi seguro un remanente de cuando
   `backend-inspecciones` compartía esta base de datos en vivo (ver
   `ADR-023`) — pero eso no está confirmado, solo es la explicación más
   probable dado que ningún consumidor de este repo la usa. No se
   investiga ni se elimina acá; sacar una vista que un sistema externo
   desconocido pudiera seguir consultando sin confirmar primero que
   nadie depende de ella sería una acción destructiva no autorizada por
   esta tarea.
2. **`anon` y `authenticated` tienen `INSERT`/`UPDATE`/`DELETE`/
   `TRUNCATE` sobre `vw_parcelas_web`, no solo `SELECT`.** Con
   `security_invoker = true`, estos privilegios sobre la vista sí pueden
   ejecutar escritura real contra `PADRON_PARCELAS` con la clave anon
   pública (sujeta a las políticas RLS reales de la tabla base, que según
   `CLAUDE.md` solo conceden `SELECT` a `anon`/`authenticated` en el
   padrón — las escrituras van por Server Actions con Service Role Key).
   Si esas políticas RLS de base son correctas, este `GRANT` de escritura
   sobre la vista queda inerte en la práctica (RLS bloquea el `INSERT`/
   `UPDATE`/`DELETE` real); si hay algún hueco en esas políticas, la vista
   sería una superficie de ataque directa con la clave anon pública, sin
   pasar por ninguna validación de `sociosActions.js`. Esta migración
   **reaplica los `GRANT`s exactos tal cual existen hoy** (no reduce
   privilegios sin que sea una decisión explícita aparte, fuera del
   alcance de "cero cambios de comportamiento" de esta tarea) — queda
   anotado acá como un ítem de revisión de seguridad independiente,
   pendiente, no resuelto en esta ADR.
