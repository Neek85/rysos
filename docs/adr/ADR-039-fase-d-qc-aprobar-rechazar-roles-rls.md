# ADR-039 — Fase D: aprobar/rechazar en la Consola QC migran a sesión real, con control de rol en Postgres

- **Estado:** Implementado — migración aplicada, código migrado,
  verificación funcional real hecha contra producción, commiteado y
  pusheado a `staging`.
- **Migraciones:**
  `supabase/migrations/20260904190000_fase_d_qc_roles_rls.sql` (nueva,
  este ADR) — aplicada.
- **Código:** `lib/actions/qcActions.js` — `approveQcRecord`/
  `rejectQcRecord` cambian de cliente (`getSupabaseServerClient` →
  `createSessionServerClient`). `fetchParcelasVecinas` sigue con
  Service Role Key, sin tocar — fuera de alcance de esta tarea.
- **Tests:** ninguno nuevo — verificación funcional real contra
  producción, con 3 sesiones reales de rol distinto, sobre una fila
  descartable creada y borrada dentro de la misma verificación.
- **Contexto previo:** `ADR-034` (RLS real por organización de las 3
  tablas EUDR); `ADR-035` (mismo patrón de migración para
  `updateQcRecordAttributes`/`updateQcRecordGeometry`, que dejó
  explícitamente pendiente `approveQcRecord`/`rejectQcRecord` "falta
  diferenciar por rol, no solo por organización" — este ADR cierra
  justamente ese pendiente); `20260902213506_login_fase_a_identidad.sql`
  (`auth_role()`, `PERFILES_USUARIO_INTERNOS.rol`, ya existentes).

## Correcciones a la premisa del prompt original, verificadas antes de escribir código

1. **Número de ADR:** el prompt pedía
   `docs/adr/ADR-038-fase-d-qc-aprobar-rechazar-roles-rls.md`, pero
   `ADR-038` ya existe (Fase A.3 de este mismo piloto, `gisActions.js`,
   commiteado horas antes en esta misma sesión). Se usa `ADR-039`, el
   siguiente número real libre (confirmado por listado de archivos, no
   asumido).
2. **Timestamp de la migración:** el prompt pedía
   `20260906000000_fase_d_qc_roles_rls.sql` — dos días adelante de la
   fecha real de hoy (2026-09-04) y de la última migración real
   (`20260904174237`). Se usa `20260904190000` para mantener el orden
   cronológico real del repo.
3. **No existe ningún `CHECK` constraint de Postgres sobre
   `estado_revision`** en `EUDR_MONITOREO`/`EUDR_USO_SUELO`/
   `EUDR_INSTALACIONES` (confirmado con `pg_constraint` en vivo, no
   asumido) — el contrato `PENDIENTE`/`APROBADO`/`RECHAZADO` que
   describía el prompt es una convención de aplicación
   (`PENDING_STATE` en `lib/eudrQcActions.js`), no una restricción de
   esquema. Esta migración no agrega ese `CHECK` — no se pidió
   explícitamente crearlo, y no hacía falta para el mecanismo de
   control de rol (el trigger no depende de que el valor esté
   restringido por constraint, solo compara `OLD`/`NEW`).
4. **Bypass de `service_role`/`postgres` agregado al trigger, no
   estaba en la redacción literal del prompt:** `scripts/qgis_qc_actions.py`
   cambia `estado_revision` (aprobar/rechazar/revertir) vía `psycopg2`
   dentro de QGIS Desktop — una conexión directa a Postgres, fuera de
   toda sesión de Supabase Auth, así que `auth_role()` le devolvería
   `NULL` siempre. Sin este bypass, el trigger nuevo habría bloqueado
   por completo el flujo de aprobación desde QGIS Desktop (el otro path
   real de aprobación que ya existía antes de este ADR, documentado en
   `lib/eudrQcActions.js`: "mismo formato de sufijo que
   `scripts/qgis_qc_actions.py`"). Se agregó exactamente la misma
   condición que ya usan las 3 políticas `rls_write_eudr_*` de
   `ADR-034`: `auth.role() = 'service_role' OR current_user = 'postgres'`.
   `public.auth_role()` ya existía y ya estaba `GRANT EXECUTE`d a
   `authenticated`/`anon`/`service_role` — no hizo falta ningún cambio
   ahí.

## Por qué un trigger y no una política RLS nueva

Una política RLS (`USING`/`WITH CHECK`) evalúa la fila en un solo
momento — no tiene forma nativa de comparar el valor **anterior** de
una columna contra el **nuevo** para un `UPDATE` puntual sin acoplar
esa lógica a una función que además reciba el valor viejo, lo cual ya
es, en la práctica, un trigger. Un trigger `BEFORE UPDATE` sí tiene
`OLD`/`NEW` de forma nativa, así que es el mecanismo correcto para
"solo bloquear cuando `estado_revision` realmente cambia" — un
`UPDATE` que toca otras columnas sin tocar `estado_revision` (por
ejemplo `updateQcRecordAttributes`) no dispara el chequeo de rol en
absoluto, `NEW.estado_revision IS DISTINCT FROM OLD.estado_revision`
es `false` para esos casos.

## Qué cambió, exactamente

`public.fn_enforce_qc_approval_roles()` (trigger `BEFORE UPDATE` en las
3 tablas EUDR): si `estado_revision` cambia, exige
`auth_role() IN ('admin', 'auditor_qc')` (o el bypass de
`service_role`/`postgres` de arriba) — si no, `RAISE EXCEPTION` con
`ERRCODE = '42501'`, el mismo código que ya usa Postgres para una
violación de RLS real, mensaje explícito
("Acceso denegado: Solo usuarios con rol admin o auditor_qc pueden
aprobar o rechazar monitoreos").

`lib/actions/qcActions.js`: `approveQcRecord`/`rejectQcRecord` pasan de
`getSupabaseServerClient()` a `await createSessionServerClient()` — con
esto, **las 4 escrituras de la Consola QC
(`approveQcRecord`/`rejectQcRecord`/`updateQcRecordAttributes`/
`updateQcRecordGeometry`) corren bajo sesión real**, cero funciones con
Service Role Key en este archivo salvo `fetchParcelasVecinas` (una
lectura vía RPC, fuera de alcance, sin tocar).

## Verificación funcional real

3 sesiones `authenticated` reales, obtenidas vía magic link (Admin API
`generate_link` + `/auth/v1/verify`, sin resetear contraseña, sin
exponer ningún `access_token` completo) — mismo mecanismo que
`ADR-035`–`038`: `auditor-qc-demo@ryzos-demo.test`/
`tecnico-campo-demo@ryzos-demo.test`/`admin-demo@ryzos-demo.test`
(las 3 en `ORG-TEST-DEMO`) y `neyser.maldonado@est.unj.edu.pe` (`admin`
en `COOP-AROMAS-VALLE`, para el intento cruzado). Cada paso llama
exactamente la misma consulta REST (`PATCH` con `.match()` equivalente)
que `approveRecord`/`rejectRecord` ejecutan internamente.

1. **Setup:** fila descartable `PENDIENTE` en `EUDR_MONITOREO`
   (`ORG-TEST-DEMO`, `tecnico_responsable: "TEST-ADR039"`) creada con
   Service Role Key.
2. **Test A (rol autorizado, `auditor_qc`, misma organización):**
   `PATCH estado_revision=APROBADO` → **`200`**, 1 fila devuelta,
   `estado_revision: "APROBADO"`. Reset a `PENDIENTE` con Service Role
   Key para el siguiente paso.
3. **Test B (rol NO autorizado, `tecnico_campo`, misma organización):**
   mismo `PATCH` → **`403`**,
   `{"code":"42501","message":"Acceso denegado: Solo usuarios con rol
   admin o auditor_qc pueden aprobar o rechazar monitoreos"}` — el
   mensaje exacto del trigger, un error real de Postgres, no "0 filas".
   Confirmado con una lectura aparte (Service Role Key) que la fila
   real siguió en `PENDIENTE` — nada se guardó.
4. **Test C (aislamiento multi-tenant, `admin` de OTRA organización):**
   sesión de `COOP-AROMAS-VALLE` contra un registro real de
   `ORG-TEST-DEMO` → **`200`, `[]` (0 filas)** — RLS por organización
   (`ADR-034`) bloquea antes de que el trigger de rol siquiera aplique;
   `auth_role()` de esa sesión sí es `admin`, pero la fila es invisible
   por organización primero. Confirmado que la fila real no cambió.
5. **Test A2 (segundo rol autorizado, `admin`, misma organización):**
   sesión `admin-demo` → `PATCH estado_revision=RECHAZADO` → **`200`**,
   1 fila devuelta, `estado_revision: "RECHAZADO"` — confirma que
   ambos roles autorizados (`admin` y `auditor_qc`) funcionan, no solo
   uno.
6. **Limpieza:** fila descartable borrada con Service Role Key.
   Confirmado `0` filas restantes en `EUDR_MONITOREO` después.

`npm run build`/`npm run lint`: limpios, mismos warnings preexistentes
en archivos no tocados por esta tarea, 0 errores, mismas 19 rutas.

## Qué queda fuera

`updateQcRecordAttributes`/`updateQcRecordGeometry` (ya migradas en
`ADR-035`) no pasan por este trigger para su propio `UPDATE` de
atributos/geometría — solo lo dispararían si ese `UPDATE` tocara
`estado_revision`, y ninguna de las dos lo hace (ver
`lib/eudrQcActions.js`, ambas mantienen `estado_revision = PENDIENTE`
sin tocarlo). `fetchParcelasVecinas` sigue con Service Role Key —
lectura, no escritura de `estado_revision`, sin relación con este ADR.
