# AI_STATE.md

Registro de bloqueos encontrados por un agente (Claude Code) durante una
tarea, cuando la instrucción de esa tarea pide documentar la causa en vez
de seguir reintentando. No es un changelog general del proyecto — solo
entradas puntuales de "esto bloqueó, acá está la causa real".

> **Rotación (2026-09-04):** este archivo se recorta a los últimos
> bloqueos/diagnósticos activos — historial completo movido a
> [`docs/archive/AI_STATE_HISTORICO.md`](archive/AI_STATE_HISTORICO.md)
> (no leído por defecto). Se conservan acá 3 entradas: la nota
> permanente sobre `supabase db push`, la investigación (sin causa
> raíz determinada todavía) de las tablas centrales completamente
> vacías, y el estado más reciente.

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

## 2026-09-05 — ADR-035 cerrado: piloto de Camino 1 (Fase D Paso 2) — updateQcRecordAttributes/updateQcRecordGeometry migran a RLS por sesión real

**Cambio:** en `lib/actions/qcActions.js`, solo
`updateQcRecordAttributes`/`updateQcRecordGeometry` reemplazan
`const supabase = getSupabaseServerClient()` (Service Role Key) por
`const supabase = await createSessionServerClient()` (sesión real del
usuario, `@supabase/ssr`, respeta RLS). `approveQcRecord`/
`rejectQcRecord`/`resolveRadioContextoM`/`fetchParcelasVecinas`
quedan exactamente igual -- decisión explícita, no un paso pendiente:
aprobar/rechazar necesita distinguir `admin`/`auditor_qc` de
`tecnico_campo`, y el RLS real de ADR-034 en las 3 tablas EUDR hoy solo
distingue por organización, no por rol -- migrarlas también habría dado
a cualquier `authenticated` de la organización correcta, incluido
`tecnico_campo`, la capacidad de aprobar/rechazar sin control de rol
real. Ver
`docs/adr/ADR-035-piloto-camino-1-rls-sesion-qc-atributos-geometria.md`
para el diseño completo, incluida la razón histórica del Service Role
Key original (bug real de 2026-08: RLS `authenticated`-only bloqueaba
todo `UPDATE` desde el cliente `anon`, 0 filas siempre) y por qué ya no
aplica (Fase B dio sesión real server-side, ADR-034 dio RLS real por
organización).

**Verificación funcional real (recap, detalle completo en el ADR):**
plan original (usar una fila `PENDIENTE` real de `ORG-TEST-DEMO` y
revertir el campo al terminar) tuvo que ajustarse en el momento --
**las 3 tablas EUDR (`EUDR_MONITOREO`, `EUDR_USO_SUELO`,
`EUDR_INSTALACIONES`) resultaron completamente vacías, 0 filas cada
una**, no solo 0 `PENDIENTE`. No se inventó dato real -- se creó una
fila 100% descartable (Service Role, `ORG-TEST-DEMO`, `PENDIENTE`),
se actualizó `observaciones` con la sesión real vía `PATCH` REST
replicando exactamente el `.update().match()` de
`updateRecordAttributes`, confirmando **1 fila afectada (no 0)** --
la señal correcta de que el RLS real de `authenticated` permite la
escritura, no la bloquea -- y se borró la fila completa al terminar
(`EUDR_MONITOREO` vuelve a 0 filas).

**Hallazgo abierto, sin causa determinada -- distinto del caso ya
documentado de `INSPECCIONES`:** las 3 tablas EUDR están vacías para
**todas** las organizaciones (no solo `ORG-TEST-DEMO`), confirmado con
`SELECT count(*)` sin filtro de organización sobre las 3 tablas. Es el
mismo síntoma general ("tabla central completamente vacía, sin causa
clara") que `INSPECCIONES` (`2026-09-03f`/`g`), pero ahora extendido a
3 tablas más, con datos que en teoría deberían tener contenido real
(monitoreos EUDR de `COOP-AROMAS-VALLE`, no solo de prueba). No se
investigó la causa en esta tarea -- fuera de alcance del piloto, mismo
límite de entorno ya documentado (sin acceso a backups/logs de
Supabase desde acá). Queda pendiente de que el arquitecto decida si
amerita revisar Point-in-Time Recovery/Database Logs en Supabase
Studio, igual que se recomendó para `INSPECCIONES`.

**`npm run build`:** limpio -- mismos 3 warnings preexistentes de
ESLint, 0 errores, mismas 19 rutas.

## 2026-09-06 — Revisión de seguridad de `a975a7c` (RBAC Padrón de Socios): `assertAdminRole()` NO tiene respaldo de RLS -- bypass real confirmado en vivo, contra `PADRON_SOCIOS`/`PADRON_PARCELAS`

**Contexto:** revisión de seguridad pedida sobre el commit `a975a7c`
(RBAC de `/dashboard/socios`, ver `specs/rbac_webgis_padron.md`), bajo
el protocolo de segunda revisión Multi-IA de `CLAUDE.md` §1. La tarea
pedía confirmar que `assertAdminRole()` "impida el bypass de roles
mediante manipulaciones de payload directo en Server Actions".

**Lo que SÍ está confirmado y es correcto:** `assertAdminRole()` no
lee ningún campo del `payload`/`values` que manda el cliente -- resuelve
el rol exclusivamente vía `supabase.rpc('auth_role')`, que a su vez lee
`PERFILES_USUARIO_INTERNOS` server-side por `auth.uid()` (JWT validado).
No existe ninguna forma de falsificar el rol inyectando un campo
`rol`/`role` en el payload de `createSocio`/`updateSocio`/
`updateParcela`/`deactivateSocio`/`deactivateParcela` -- confirmado
leyendo el código, la función nunca toca `values`/`socioId`/
`organizationId` para decidir el rol.

**Hallazgo real (no lo que pedía confirmar la tarea, pero es el riesgo
que de verdad importa): `assertAdminRole()` es una capa 100%
aplicación, sin ningún respaldo de RLS.** `rls_write_padron_socios`/
`rls_write_padron_parcelas` (`ADR-034`, reconfirmadas en vivo con
`pg_policies` en esta misma revisión) son:
```
"ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role' OR CURRENT_USER = 'postgres'
```
-- **scopeadas solo por organización, sin ninguna condición de rol.**
Esto significa que `assertAdminRole()` protege el camino de
`createSocio`/`updateSocio`/etc. (las Server Actions), pero **no
protege la tabla misma**: cualquier sesión `authenticated` de la
organización correcta -- incluido `tecnico_campo`/`auditor_qc`, los 2
roles que esta misma tarea de RBAC quiso volver "Solo lectura" -- puede
seguir escribiendo `PADRON_SOCIOS`/`PADRON_PARCELAS` con una llamada
REST directa a PostgREST, sin pasar por ninguna Server Action ni por
`assertAdminRole()` en absoluto.

**Confirmado en vivo, no en teoría** (sesión real de
`tecnico-campo-demo@ryzos-demo.test`, fila descartable en
`ORG-TEST-DEMO`, borrada al terminar):
```
PATCH {SUPABASE_URL}/rest/v1/PADRON_SOCIOS?ID_Socio=eq.<descartable>
Authorization: Bearer <access_token real de tecnico_campo>
body: {"socio_nombre_completo": "MUTADO POR TECNICO_CAMPO SIN PASAR POR assertAdminRole"}

-> 200 OK, fila mutada con el nuevo valor.
```
Ese mismo cambio, si hubiera pasado por `updateSocio()`, habría sido
rechazado con `SocioActionError: "Esta acción requiere el rol admin."`
-- la diferencia es exclusivamente si el atacante (o un usuario
`tecnico_campo` legítimo con curiosidad técnica) pasa por la UI/Server
Action o no.

**Comparación con el precedente ya resuelto en este mismo proyecto:**
`ADR-039` cerró exactamente este mismo tipo de gap para
`approveQcRecord`/`rejectQcRecord` (aprobar/rechazar en la Consola QC)
con un trigger real de Postgres (`fn_enforce_qc_approval_roles`,
`BEFORE UPDATE` en las 3 tablas EUDR, exige `admin`/`auditor_qc` vía
`auth_role()` cuando `estado_revision` cambia). Esta tarea de RBAC de
Padrón de Socios **no replicó ese patrón** -- se quedó en la capa de
aplicación únicamente, inconsistente con el criterio ya establecido en
`ADR-039` para el mismo tipo de riesgo.

**Severidad:** media -- no es explotable por `anon` ni entre
organizaciones (RLS por organización sigue intacta, confirmado en la
misma consulta), y requiere que quien lo explote ya sea un usuario
interno autenticado de la organización correcta. Pero dentro de esa
organización, cualquier `tecnico_campo`/`auditor_qc` con acceso a su
propio `access_token` (visible en cualquier herramienta de red del
navegador) puede saltarse por completo la restricción "Solo lectura"
que esta misma tarea de RBAC dijo implementar -- el objetivo de negocio
de la tarea (`specs/rbac_webgis_padron.md`, matriz de
`specs/login_real_organizacion_rol.md` §5) queda solo parcialmente
cumplido.

**No se corrigió en esta revisión -- es una tarea de seguridad/SQL
aparte, no una verificación.** Cerrarlo bien requeriría una migración
nueva: un trigger `BEFORE UPDATE`/`BEFORE INSERT` sobre
`PADRON_SOCIOS`/`PADRON_PARCELAS` que exija `auth_role() = 'admin'`
(mismo patrón que `fn_enforce_qc_approval_roles` de `ADR-039`, con el
mismo bypass `service_role`/`postgres` que ya usa esa función para no
romper flujos batch/ETL existentes) -- o, alternativa más simple,
extender la propia política `rls_write_padron_socios`/
`rls_write_padron_parcelas` para exigir rol directamente en el
`WITH CHECK`. Cualquiera de las 2 rutas es una decisión de diseño de
seguridad real (qué exactamente debe poder seguir escribiendo
`service_role`/ETL/scripts existentes sin romperse) que le corresponde
confirmar al arquitecto antes de escribir la migración, no algo para
decidir unilateralmente dentro de una tarea de revisión.

**Resto de la revisión, sin hallazgos:** `node --test
tests/test_trace_public.mjs` (10/10), `python -m pytest
tests/test_tarea14_trazabilidad.py` (25/25) -- sin regresión, ninguno
de los 2 toca nada relacionado con este commit. `npm run build`/`npm
run lint` limpios, mismas 19 rutas, mismos warnings preexistentes. No
se encontró ningún problema en `lib/auth/getCurrentProfile.js` (el
`'use server'` nuevo no cambia su lógica, solo la hace invocable desde
cliente) ni en el gating de UI de `app/dashboard/socios/page.jsx`
(confirmado que `userRole` inicia en `null` y se trata como no-admin
mientras carga, fail-closed).

### RESUELTO (2026-09-06/07) — ver `supabase/migrations/20260906220000_enforce_padron_admin_trigger.sql`

Trigger `fn_enforce_padron_admin_role()` (mismo patrón que
`fn_enforce_qc_approval_roles`, `ADR-039`) en `PADRON_SOCIOS`/
`PADRON_PARCELAS`, aplicado y verificado en vivo. **Decisión de diseño
confirmada con el usuario antes de aplicar la migración** (el prompt
original pedía bloquear `INSERT` también en `PADRON_PARCELAS`, lo que
habría roto `createParcela` vía `gisActions.js::uploadGeoSpatialFeature`
— el Editor Vectorial de `/dashboard/qc`, donde `tecnico_campo`
legítimamente crea parcelas nuevas desde el campo): `PADRON_SOCIOS`
bloquea `INSERT`/`UPDATE`/`DELETE` completos para no-admin;
`PADRON_PARCELAS` bloquea solo `UPDATE`/`DELETE`, `INSERT` queda
abierto a cualquier `authenticated`.

**Verificado en vivo** (sesiones reales `tecnico-campo-demo`/
`admin-demo`, filas descartables, `ORG-TEST-DEMO`):
- `tecnico_campo` `PATCH` directo a `PADRON_SOCIOS` (el bypass exacto
  de este hallazgo) → **`403`, `42501`, bloqueado**.
- `admin` `PATCH` sobre el mismo socio → **`200`, sigue funcionando**.
- `tecnico_campo` `POST` (INSERT) a `PADRON_PARCELAS` → **`201`, sigue
  funcionando** (Editor Vectorial preservado).
- `tecnico_campo` `PATCH`/`DELETE` sobre esa misma parcela → **`403`,
  `42501`, bloqueado** en ambos.

**Test de integración automatizado:** `tests/test_padron_rbac_rls.py`
(nuevo, patrón `NEEDS_SUPABASE` de `tests/test_fase1_sdd.py`, extendido
con `SUPABASE_ANON_KEY` para simular sesión real vía magic link) — 5/5
pasando, corrido con credenciales reales inyectadas (se omite
automáticamente sin ellas, mismo criterio que el resto de los tests
`NEEDS_SUPABASE`, no wired a CI). Confirmado `0` filas de prueba
restantes en ambas tablas después.

**Estado:** cerrado. `assertAdminRole()` ahora tiene respaldo real de
RLS/trigger — ya no es una capa 100% aplicación bypasseable con una
llamada directa a PostgREST.
