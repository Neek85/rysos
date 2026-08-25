# ADR-025 — Investigación: por qué RLS está habilitado en `PADRON_SOCIOS`/`PADRON_PARCELAS`

- **Estado:** Investigación de solo lectura — resuelta con evidencia
  convergente, sin proponer cambios de política.
- **Fecha:** 2026-08-25
- **Migraciones:** ninguna (investigación, no cambia nada).
- **Contexto previo:** `specs/multi_organizacion_codigos_unicos.md`
  (hallazgo 6 de esa auditoría, que ya adelantaba parte de esto y motivó
  investigarlo a fondo antes de que la migración de PK toque algo
  relacionado).

## Pregunta

`CLAUDE.md` documenta: *"Row-level security policies scoped to
`authenticated`... do not apply to the frontend's real traffic, because
the frontend never authenticates."* Si eso es cierto, ¿por qué
`PADRON_SOCIOS`/`PADRON_PARCELAS` tienen RLS habilitado?

## Corrección de premisa: RLS SÍ está versionado en este repo

El prompt de esta tarea planteaba como hipótesis: *"si no aparece ningún
`CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` versionado, es la misma
situación que las tablas mismas — RLS habilitado fuera del historial de
migraciones."* Verificado con `grep` exhaustivo sobre
`supabase/migrations/*.sql`: **la condición no se cumple.** RLS en estas
dos tablas está versionado, y no en una sola migración sino en **tres**:

| Migración | Qué hace |
|---|---|
| `20260815_fase1_security_storage.sql` | `ENABLE ROW LEVEL SECURITY` + política `ryzos_all_padron_socios`/`ryzos_all_padron_parcelas` (`FOR ALL TO authenticated`, `USING/WITH CHECK ID_Organizacion = get_my_org_id()`) — versión original, Fase 1. |
| `20260816_fase3_seguridad_rls.sql` | Reemplaza las políticas anteriores por `rls_select_padron_socios`/`rls_write_padron_socios` (y el par de parcelas) — mismo scope `authenticated`, separando lectura de escritura. |
| `20260818_fix_inspecciones_rls.sql` | Agrega `rls_anon_select_padron_socios`/`rls_anon_select_padron_parcelas` — **`FOR SELECT TO anon`**, `USING ("ID_Organizacion" IS NOT NULL)` — "para habilitar el autocompletado" (comentario propio de la migración). Las políticas `rls_select_*`/`rls_write_*` de Fase 3 quedan intactas, sin tocar. |

No hay ningún objeto de esquema "fantasma" acá (a diferencia de
`vw_parcelas_web`/`vw_socios_web` en `ADR-024`, creadas fuera de este
repo) — todo el estado de RLS en estas dos tablas está en el historial de
migraciones, legible y trazable.

## La respuesta real: dos categorías de política, una muerta para tráfico real y otra viva

`CLAUDE.md` tiene razón sobre las políticas `authenticated` — pero eso no
es toda la historia:

1. **Políticas `authenticated`** (`rls_select_padron_socios`/
   `rls_write_padron_socios` y su par de parcelas, Fase 3) — `USING
   ("ID_Organizacion" = public.get_my_org_id())`, dependen de un claim JWT
   real. Como el frontend nunca autentica (`CLAUDE.md`: "anon key only —
   no hay sesión de Supabase Auth"), `get_my_org_id()` nunca resuelve a un
   valor útil en tráfico real — estas políticas son, en la práctica,
   código muerto para el tráfico real del frontend. Coincide exactamente
   con lo que documenta `CLAUDE.md`.
2. **Política `anon`** (`rls_anon_select_padron_socios`/
   `rls_anon_select_padron_parcelas`, agregada 3 días después,
   específicamente para el autocompletado del formulario de Inspecciones)
   — `USING ("ID_Organizacion" IS NOT NULL)`. Esta política **sí** aplica
   al tráfico real, porque el frontend consulta con la `anon` key
   directamente (`lib/sociosSearch.js`, `lib/padronSearch.js`).

**RLS está habilitado (`ENABLE ROW LEVEL SECURITY`) porque es un
prerrequisito de Postgres para que CUALQUIER política tenga efecto —
incluida la política `anon`, que sí es real.** No es que se habilitó RLS
"por las dudas" o quedó de una implementación abandonada: es
infraestructura necesaria para la única política que hoy protege datos
reales en estas dos tablas específicas.

## Verificación empírica (REST directo, anon key, sin pasar por las vistas)

Confirmado en vivo, 2026-08-25, consultando las tablas base directamente
(no `vw_parcelas_web`/`vw_socios_web`):

```
GET /rest/v1/PADRON_SOCIOS?select=ID_Socio,ID_Organizacion&limit=3   (anon key)
→ Content-Range: 0-2/7

GET /rest/v1/PADRON_PARCELAS?select=ID_Parcela_Fija,ID_Organizacion&limit=3   (anon key)
→ Content-Range: 0-2/11
```

`anon` devuelve **7 de 7** filas de `PADRON_SOCIOS` y **11 de 11** de
`PADRON_PARCELAS` — el mismo total que devuelve `service_role`
(verificado en la misma corrida). Esto es exactamente lo que la política
`USING ("ID_Organizacion" IS NOT NULL)` predice: como ninguna de las filas
reales tiene `ID_Organizacion` nulo (confirmado también en
`specs/multi_organizacion_codigos_unicos.md`, hallazgo 4), la política no
filtra nada hoy — pero si existiera una fila con `ID_Organizacion = NULL`,
esa fila específica quedaría invisible para `anon` (y el `INSERT`
correspondiente sería rechazado por la misma política en su forma `WITH
CHECK`, si la tuviera — **no verificado**, ver "Qué queda sin confirmar").

No se probó escritura (`INSERT`/`UPDATE`/`DELETE`) con la anon key contra
las tablas base — sería una acción real, no de solo lectura, fuera del
alcance de esta investigación. Por texto de migración, `anon` no tiene
ninguna política `FOR ALL`/`FOR INSERT`/`FOR UPDATE`/`FOR DELETE` en
`PADRON_SOCIOS`/`PADRON_PARCELAS` (a diferencia de `INSPECCIONES`/`CAP_*`,
que sí tienen `FOR ALL TO anon, authenticated USING (true)` en la misma
migración) — la escritura del padrón queda, por diseño, exclusiva de los
Server Actions con Service Role Key (`lib/actions/sociosActions.js`, que
bypasea RLS por completo), consistente con lo que ya documentaba
`CLAUDE.md` sobre el módulo Padrón.

## Qué queda sin confirmar (no se adivina, no se ejecuta SQL crudo)

No hizo falta preparar una consulta contra `pg_policies` para el usuario
esta vez — la evidencia de texto de migración (3 migraciones, políticas
completas y legibles) y la evidencia empírica (conteos REST reales)
convergen sin contradicción, a diferencia del caso de `vw_parcelas_web` en
`ADR-024`, donde no existía ningún rastro en el repo. Sí queda sin
confirmar, por ser una acción de escritura real y no de solo lectura:

- Que la política `WITH CHECK` (si `anon` tuviera alguna política de
  escritura, que por texto de migración no tiene) efectivamente rechace
  un `ID_Organizacion = NULL`. Irrelevante en la práctica hoy porque
  `anon` no tiene ningún camino de escritura hacia estas dos tablas.

## Consecuencias

- No se propone ningún cambio de política — esta tarea es puramente de
  entendimiento, tal como se pidió.
- Relevante para la migración de PK pendiente
  (`specs/multi_organizacion_codigos_unicos.md`): la política `anon`
  (`USING ("ID_Organizacion" IS NOT NULL)`) no depende de la PK ni de
  `ID_Socio`/`ID_Parcela_Fija` — no requiere ningún cambio cuando se
  aplique esa migración.
- Aclara una imprecisión latente en cómo se venía citando el "RLS gotcha"
  de `CLAUDE.md` en tareas anteriores de esta sesión: esa nota es correcta
  para las políticas `authenticated`, pero no es una afirmación general de
  que "RLS no importa" en estas tablas — la política `anon` sí protege
  tráfico real hoy (aunque hoy no filtre ninguna fila, porque no hay
  ninguna con `ID_Organizacion` nulo).
