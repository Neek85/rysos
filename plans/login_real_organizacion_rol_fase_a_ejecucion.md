# PLAN DE EJECUCIÓN: Login Real por Organización y Rol — Fase A (capa de identidad)

## 0. Alcance exacto de esta fase
Solo la capa de identidad a nivel de base de datos: 1 tabla nueva + 1 función nueva + 1 función redefinida. **Nada de frontend, nada de `middleware.js`, nada de `INSPECCIONES`/`CAP_*`.** Debe ser inerte en comportamiento hoy — nadie tiene sesión `authenticated` real todavía (confirmado en el paso 1 de verificación: `auth_org_id()` vía `anon` devuelve `null`, sin JWT claims poblados), así que:
- Las 2 políticas nuevas de `SELECT` sobre `PERFILES_USUARIO_INTERNOS` no tienen ningún usuario real que las ejercite hoy (la tabla nace vacía).
- `auth_role()` (nueva) siempre devuelve `NULL` hoy, porque no hay filas en `PERFILES_USUARIO_INTERNOS` ni sesiones `authenticated` reales.
- `auth_org_id()` (redefinida) preserva su comportamiento actual (`NULL`) porque el `SELECT` a la tabla nueva no encuentra ninguna fila, y el fallback al claim JWT legacy sigue igual que antes (también `NULL` hoy).
- Las 6 políticas RLS que ya usan `auth_org_id()` (`ORGANIZACIONES`, `PADRON_SOCIOS`, `PADRON_PARCELAS`, `EUDR_MONITOREO`, `EUDR_INSTALACIONES`, `EUDR_USO_SUELO`) siguen deny-all para `authenticated` — cero cambio de comportamiento observable en `/dashboard/*` hoy.

## 1. Verificación previa (paso 1 del prompt, hecha antes de escribir nada)
Confirmado contra la instancia real (REST, Service Role Key + `anon`, sin conexión Postgres directa disponible en este entorno — mismo límite ya documentado desde `2026-08-25b`):
- `auth_org_id()` existe, es callable vía `anon`, devuelve `null` hoy (sin JWT claims). Su definición SQL literal se confirmó cruzando `supabase/migrations/20260816_fase3_seguridad_rls.sql` (única migración del repo que la define, sin ninguna redefinición posterior) contra el texto exacto del prompt — coincide carácter por carácter (`LANGUAGE sql STABLE`, sin `SECURITY DEFINER`, mismo `SELECT`).
- `public.auth_role()` NO existe (`PGRST202` al invocarla vía RPC).
- `public."PERFILES_USUARIO_INTERNOS"` NO existe (`PGRST205` al consultarla).
- `public."ORGANIZACIONES"."ID"` confirmado real y con las 2 filas esperadas (`COOP-AROMAS-VALLE`, `ORG-TEST-DEMO`) para el `FOREIGN KEY` de la tabla nueva.

Ningún hallazgo obligó a detenerse — el contexto que asumía el prompt sigue vigente.

## 2. Archivo de migración
`supabase/migrations/20260902213506_login_fase_a_identidad.sql` (timestamp real del momento de escritura). Contenido — mismo diseño exacto del prompt, `BEGIN`/`COMMIT`, idempotente (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, `CREATE INDEX IF NOT EXISTS`). **Orden real dentro del archivo (corregido 2 veces, ver los 2 hallazgos abajo) — tabla primero (sin políticas), funciones después, políticas al final:**
1. `CREATE TABLE IF NOT EXISTS public."PERFILES_USUARIO_INTERNOS"` + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — sin política de escritura para `authenticated`, y SIN ninguna política de `SELECT` todavía en este punto (se agregan en el paso 4).
2. `CREATE OR REPLACE FUNCTION public.auth_role()` — nueva, `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated, anon, service_role`.
3. `CREATE OR REPLACE FUNCTION public.auth_org_id()` — redefinida, mismo nombre/firma, perfil como fuente primaria + claim JWT legacy como fallback, `SECURITY DEFINER` + `REVOKE`/`GRANT` explícito nuevo (endurecimiento respecto del estado actual, no un ensanche — ver advertencia de compatibilidad abajo).
4. Las 2 políticas de `SELECT` (`rls_select_propio_perfil`, `rls_select_perfiles_admin_misma_org`), cada una con su `DROP POLICY IF EXISTS` respectivo.
5. `CREATE INDEX IF NOT EXISTS idx_perfiles_usuario_internos_org` sobre `"ID_Organizacion"` (sin columna `geometry`, no aplica índice GIST).

**Hallazgo #1 (post primer intento de aplicación en Supabase Studio):** el borrador original de este archivo creaba la tabla + las 2 políticas ANTES que `auth_role()`. La política `rls_select_perfiles_admin_misma_org` referencia `public.auth_role()` en su `USING` — Postgres rechazó la migración con `42883 function public.auth_role() does not exist` al llegar a esa línea, porque la función todavía no existía en ese punto de la transacción. **Lección general, no específica de este archivo:** dentro de una misma migración/transacción, una política (o cualquier objeto) que referencia una función debe crearse DESPUÉS de esa función, aunque ambas estén en el mismo `BEGIN`/`COMMIT` — el orden de aparición en el archivo importa, no solo que todo esté "en la misma transacción". Verificado antes de corregir: el `BEGIN`/`COMMIT` hizo rollback limpio, sin nada aplicado a medias. **Fix aplicado (incompleto, ver hallazgo #2):** las 2 funciones se movieron antes de la tabla/políticas.

**Hallazgo #2 (post segundo intento real, con el fix #1 ya aplicado):** mover las funciones antes de la tabla resolvió el error de la política, pero rompió otra cosa distinta — Postgres rechazó `CREATE OR REPLACE FUNCTION public.auth_role()` con `42P01 relation "public.PERFILES_USUARIO_INTERNOS" does not exist`, en la línea del `SELECT` interno de la función. **Causa raíz real:** `auth_role()`/`auth_org_id()` son `LANGUAGE sql`, no `plpgsql` — Postgres resuelve las referencias a tablas dentro del cuerpo de una función `LANGUAGE sql` al momento de `CREATE FUNCTION` (valida el plan contra el catálogo ahí mismo), a diferencia de `plpgsql`, que resuelve nombres de forma perezosa recién en la primera ejecución real. Esto significa que el hallazgo #1 y esta restricción tiran en **direcciones opuestas** dentro del mismo archivo: la política necesita las funciones ya creadas; las funciones `LANGUAGE sql` necesitan la tabla ya creada. La única secuencia que satisface ambas restricciones a la vez es la de arriba: tabla (sin políticas) → funciones → políticas → índice. Verificado antes de corregir (de nuevo): rollback limpio, nada aplicado a medias. La tabla queda con RLS habilitada pero sin ninguna política durante el punto intermedio de la transacción (deny-all total para `authenticated`) — estado inerte y transitorio dentro de la misma transacción, nunca observable desde afuera (nadie puede leer una transacción no comiteada), y la tabla nace vacía de todas formas.

Ambos fixes: mismo contenido SQL exacto en los dos casos, solo reordenado — confirmado con `git diff` que los bloques movidos son byte-idénticos, ningún nombre/GRANT/condición de política cambiado.

**Advertencia de compatibilidad verificada (pedida explícitamente en el prompt):** `docs/schema_live.md` y la migración original (`20260816_fase3_seguridad_rls.sql`) no documentan ningún `GRANT`/`REVOKE` explícito previo sobre `auth_org_id()` — hoy tiene el default de Postgres (`EXECUTE` a `PUBLIC`, confirmado en vivo: la llamada `anon` de arriba funcionó sin `42501`). Pasar a `SECURITY DEFINER` + `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated, anon, service_role` **preserva el acceso de `anon`/`authenticated`** explícitamente (mismos roles que ya podían llamarla antes vía el grant default a `PUBLIC`) y solo cierra el acceso a cualquier otro rol de base de datos que pudiera existir — es un endurecimiento estricto, ningún consumidor actual (las 6 políticas RLS, `trg_set_id_organizacion()` vía `get_my_org_id()`) pierde acceso.

## 3. Tests nuevos
`tests/test_login_fase_a_identidad_live.mjs` — mismo patrón de `tests/test_padron_read_functions_live.mjs`: gateado por `HAS_CREDENTIALS` + un probe propio contra `auth_role`/`PERFILES_USUARIO_INTERNOS` (se salta con `PGRST202`/`PGRST205` si la migración de esta fase todavía no se aplicó, corre solo en cuanto se aplique, sin tocar este archivo).

Casos (todos contra la instancia real, con usuarios `auth.users` de prueba creados/limpiados por el propio test vía la Admin API de Supabase Auth con la Service Role Key — `POST/DELETE {SUPABASE_URL}/auth/v1/admin/users`, la única forma de crear usuarios reales de `auth.users` disponible desde este entorno sin acceso a Postgres directo):
1. Aislamiento cross-org: usuario con perfil en `ORG-TEST-DEMO` no puede leer un perfil de `COOP-AROMAS-VALLE`.
2. Aislamiento por rol dentro de la misma org: un `tecnico_campo` no puede leer el perfil de otro usuario de su propia organización (solo `admin` puede).
3. Degradación a `NULL`, no error: `auth_org_id()`/`auth_role()` devuelven `NULL` para una sesión `anon` (sin perfil).

Capacidad de crear/loguear/borrar usuarios reales de `auth.users` desde este entorno **confirmada en vivo antes de escribir el test** (Admin API de Supabase Auth, Service Role Key): `POST /auth/v1/admin/users` (crear, HTTP 200), `POST /auth/v1/token?grant_type=password` (login real, devuelve un `access_token` de sesión `authenticated` genuino — es lo que permite probar RLS de verdad, no simulado), `DELETE /auth/v1/admin/users/{id}` (borrar, HTTP 200) — probado con 1 usuario desechable (`probe-capability-check@ryzos-test.invalid`), creado y borrado en el acto, sin dejar residuo.

**Corrección sobre el borrador anterior de este plan:** el caso 1 (aislamiento cross-org) exige por definición un perfil real en `COOP-AROMAS-VALLE` para intentar leerlo desde una sesión de `ORG-TEST-DEMO` — no alcanza con 2 usuarios en la misma org. Se crean 2 identidades `auth.users` enteramente sintéticas (emails `@ryzos-test.invalid`, nunca entregables), una con perfil `ID_Organizacion = 'ORG-TEST-DEMO'` y otra con perfil `ID_Organizacion = 'COOP-AROMAS-VALLE'` — el FK apunta a la organización real (única forma válida de probar el aislamiento contra el caso real que importa), pero la fila creada vive únicamente en la tabla nueva `PERFILES_USUARIO_INTERNOS` (vacía hasta este test) y no toca, lee, ni escribe ninguna fila de `PADRON_SOCIOS`/`PADRON_PARCELAS`/`SOCIO_CERTIFICACIONES` ni ningún otro dato real de `COOP-AROMAS-VALLE`. Ambos perfiles y ambas identidades `auth.users` se borran al final del test (bloque `finally`), para no dejar residuo en la instancia real.

## 4. Criterio de éxito
- [ ] Los 3 tests de `tests/test_login_fase_a_identidad_live.mjs` pasan contra la instancia real una vez aplicada la migración.
- [ ] `npm run build` + `npm run lint` sin errores (mismos 8 warnings preexistentes, sin hallazgos nuevos — este cambio no toca ningún archivo `.js`/`.jsx` de `app/`/`components/`/`lib/actions/`).
- [ ] Cero cambio de comportamiento observable en `/dashboard/*` hoy (nadie tiene sesión `authenticated` real todavía — confirmado por diseño en la Sección 0, no solo supuesto).
- [ ] `docs/schema_live.md` documenta la tabla + las 2 funciones, marcadas explícitamente como inertes hoy.

## 5. Plan de Rollback
La migración es puramente aditiva sobre objetos nuevos, excepto la redefinición de `auth_org_id()` (mismo nombre/firma, `CREATE OR REPLACE` — no requiere `DROP`+`CREATE`, el `RETURNS text` no cambia). Rollback si hiciera falta:
```sql
DROP TABLE IF EXISTS public."PERFILES_USUARIO_INTERNOS";
DROP FUNCTION IF EXISTS public.auth_role();
-- Restaurar auth_org_id() a la versión sin SECURITY DEFINER (ver 20260816_fase3_seguridad_rls.sql):
CREATE OR REPLACE FUNCTION public.auth_org_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'ID_Organizacion', '')::text;
$$;
```
No se aplica nada de esto de forma autónoma — igual que el resto del incidente/proyecto, la migración se entrega para revisión y aplicación manual en Supabase Studio.
