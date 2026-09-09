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

## 2026-09-08 — RESUELTO: Smoke test formal por rol de Fase D Paso 2 — gap real confirmado en `/dashboard/inspecciones` × `auditor_qc`

**Tarea:** `specs/smoke_test_fase_d_paso2.md` — verificar las 15
combinaciones (5 pantallas × 3 roles) contra el código real de
`lib/actions/*.js`/`lib/inspeccionesActions.js` con sesiones reales
(magic link), no contra un equivalente REST. **14/15 coinciden con la
matriz de `specs/login_real_organizacion_rol.md` §5 — 1 no coincide,
documentado acá, sin corregir (instrucción explícita: solo
diagnosticar, devolver el control antes de tocar código).**

**El gap:** `/dashboard/inspecciones`, celda `auditor_qc: Solo lectura`.
En vivo, con la cuenta demo real (`auditor-qc-demo@ryzos-demo.test`,
`ORG-TEST-DEMO`) invocando `lib/inspeccionesActions.js::saveInspeccion`
directamente (mismo código que `useInspeccionForm.js` desde el
navegador): **`PERMITIDO`** — creó una inspección real (`INSPECCIONES.ID_Inspeccion:
"7d676882-9bf5-4067-a13f-a387ece7d09b"`, fila descartable, ya borrada).
Debería haber sido bloqueado según la matriz.

**Causa raíz confirmada leyendo el código (no solo inferida):**
`saveInspeccion` no llama ningún equivalente de `assertAdminRole` — cero
chequeo de rol a nivel de aplicación. La política RLS real de
`INSPECCIONES`/`CAP_*`
(`supabase/migrations/20260903170404_fase_c_paso2_rls_real_inspecciones_cap.sql`,
ADR-033) solo exige `"ID_Organizacion" = auth_org_id()` — **ninguna
condición sobre rol**. A diferencia de `/dashboard/socios`
(`assertAdminRole` + trigger `fn_enforce_padron_admin_role`) y
`/dashboard/qc` (trigger `fn_enforce_qc_approval_roles`, `ADR-039`), este
módulo nunca recibió la migración de control de rol — quedó fuera del
alcance de `specs/rbac_webgis_padron.md` (que explícitamente lista
`/dashboard/inspecciones` como fuera de alcance) y de `ADR-039` (que solo
cubrió `/dashboard/qc`). No es una regresión de una tarea reciente — es
un hueco que nunca se cerró.

**Las otras 14 celdas, confirmadas en vivo, coinciden con la matriz:**
- `/dashboard/socios`: `admin` PERMITIDO, `tecnico_campo`/`auditor_qc`
  BLOQUEADOS (`SocioActionError: Esta acción requiere el rol admin`) —
  `assertAdminRole` + trigger de `PADRON_SOCIOS` funcionando como se
  espera.
- `/dashboard/inspecciones`: `admin`/`tecnico_campo` PERMITIDOS (correcto).
- `/dashboard/qc`: `admin`/`auditor_qc` PERMITIDOS, `tecnico_campo`
  BLOQUEADO (`42501`, mensaje del trigger de `ADR-039`) — re-confirma lo
  que `ADR-039` ya había verificado, esta vez pasando por la Server
  Action real (`approveQcRecord`), no solo el REST equivalente.
- `/dashboard/mapa`: los 3 roles leen `vw_monitoreo_web` con éxito (sin
  caso bloqueado en la matriz — los 3 son `Sí`).
- `/dashboard/lotes`: los 3 roles (y una lectura de control sin ninguna
  sesión) leen con éxito idéntico — **hallazgo aparte, no un fallo de
  matriz:** esta pantalla es 100% de solo lectura para todos hoy (sin
  ninguna mutación real, confirmado por el propio comentario del código,
  "No persiste nada"), y usa la llave `anon` sin sesión
  (`getSupabaseClient()`), así que la distinción `Sí`/`Solo lectura` de
  la matriz no tiene, hoy, ningún mecanismo que la haga cumplir ni
  romper — no hay nada que diferenciar entre los 3 roles en esta
  pantalla todavía.

**Metodología (detalle completo en `specs/smoke_test_fase_d_paso2.md`
§5):** sesiones reales por magic link (Admin API `generate_link` +
`/auth/v1/verify`), filas descartables (creadas con Service Role Key,
borradas al final — confirmado `0` filas restantes en las 3 tablas
tocadas). Server Actions (`updateSocio`, `approveQcRecord`) invocadas
dentro de un Route Handler temporal (`app/api/smoke-test-fase-d-temp/route.js`,
creado y borrado en esta misma tarea, **nunca commiteado** — necesario
porque `createSessionServerClient()` depende de `cookies()` de
`next/headers`, solo disponible dentro de un request real de Next.js).

**2 hallazgos incidentales, no relacionados con la matriz, encontrados
mientras se armaba el harness:**
1. El prompt original decía `auditor_qc-demo@ryzos-demo.test` (guion
   bajo entre `auditor` y `qc`) — la cuenta real provisionada es
   `auditor-qc-demo@ryzos-demo.test` (guion medio, confirmado contra
   `PERFILES_USUARIO_INTERNOS`/`auth.users` en vivo). El primer intento
   con el email del prompt **creó sin querer un usuario nuevo real** en
   `auth.users` (`generate_link` auto-provisiona si el email no existe) —
   sin fila en `PERFILES_USUARIO_INTERNOS`, inofensivo pero es basura.
   **Pendiente: el usuario decide si se borra** (`DELETE
   /auth/v1/admin/users/c9565bfa-18c6-43f7-89be-65189b928dec`) — el
   intento de borrarlo fue bloqueado por el clasificador de auto-mode
   (acción destructiva sobre una cuenta real), correctamente.
2. Bug real, menor, en `public.fn_validar_codigo_parcela_unico`
   (`supabase/migrations/20260823_210000_fn_validar_codigo_parcela_unico_contexto_legible.sql`
   línea 38): usa `v_geom IS NULL` como proxy de "el registro no existe"
   (`RAISE EXCEPTION 'Registro % (EUDR_MONITOREO) no encontrado.'`), pero
   `geom_inspeccion` puede ser `NULL` en un registro real que sí existe
   (confirmado insertando uno) — la función confunde "sin geometría
   capturada" con "fila inexistente". No bloqueó esta verificación
   (se le dio geometría a las filas descartables para evitarlo), pero
   afectaría en producción a cualquier registro real de
   `EUDR_MONITOREO`/QField sin `geom_inspeccion` cargado todavía al
   pasar por la Consola QC.
   **RESUELTO (2026-09-09):** migración
   `supabase/migrations/20260909130000_fix_fn_validar_codigo_parcela_unico_found.sql`
   -- reemplaza `IF v_geom IS NULL THEN` por `IF NOT FOUND THEN`
   inmediatamente después del `SELECT ... INTO`, sin cambiar firma, umbral
   ni el resto de la lógica. **Reproducido en vivo antes de escribir el
   fix** (no solo inferido del hallazgo anterior): un `INSERT` real en
   `EUDR_MONITOREO` (fila descartable, `geom_inspeccion` NULL) seguido de
   una llamada real a `fn_validar_codigo_parcela_unico` contra la
   instancia real (todavía con la función vieja desplegada) devolvió el
   mismo `P0001`/"no encontrado" exacto, confirmando que el bug sigue
   activo en producción hoy. `tests/test_fn_validar_codigo_parcela_unico_found.py`
   agrega esa misma reproducción como test (`@NEEDS_SUPABASE`) — hasta que
   la migración se aplique manualmente en Supabase Studio, ese test
   **se salta con motivo explícito** (no falla en rojo permanente),
   mismo criterio que `_migration_is_applied` en
   `tests/test_fix_id_parcela_fija_guid_qfield.py`. Fila descartable
   limpiada, 0 residuos confirmados.
   **Chequeo relacionado, no un bug:** se verificó también en vivo si
   `fn_aprobar_monitoreo_nueva_parcela` (migración del mismo día,
   `20260909120000_...sql`) tiene el mismo problema en su propio guard
   (`IF r_monitoreo IS NULL THEN`, sobre una variable `RECORD`, no
   variables escalares sueltas) -- **no lo tiene**: con una fila real
   insertada con varias columnas NULL (incluida `area_calculada_ha`), la
   RPC procesó la fila correctamente en vez de reportarla como "no
   encontrada". En PL/pgSQL, un `RECORD` poblado por `SELECT ... INTO`
   solo queda NULL cuando la consulta no devuelve ninguna fila (0 filas)
   -- a diferencia de variables escalares sueltas, donde cada una puede
   ser NULL de forma independiente aunque la fila sí exista. Sin cambios
   necesarios ahí.

**Estado:** RESUELTO (2026-09-08, mismo día). Fix de 2 capas, mismo
patrón que `fn_enforce_padron_admin_role`:

1. **Aplicación:** `lib/inspeccionesActions.js::assertInspeccionWriteRole`
   (nuevo, exige `auth_role() IN ('admin', 'tecnico_campo')`,
   `InspeccionError` si no) — llamado al inicio de `saveInspeccion`.
   Extraje `resolveAuthRole(supabase)` a `lib/auth/resolveAuthRole.js`
   (compartido con `assertAdminRole` de `sociosActions.js`, que ahora lo
   reusa) para no duplicar la llamada RPC — cada dominio sigue con su
   propio tipo de error.
2. **Base de datos (autoridad real):**
   `supabase/migrations/20260908150000_enforce_inspecciones_role_trigger.sql`
   — trigger `fn_enforce_inspecciones_role()` (`BEFORE INSERT OR UPDATE`)
   en `INSPECCIONES` + las 6 `CAP_*`. **Corrección propia antes de
   aplicar:** el primer borrador usaba `auth_role() NOT IN ('admin',
   'tecnico_campo')` — bug de fail-open real, no hipotético: con
   `auth_role() IS NULL` (sesión `authenticated` sin fila en
   `PERFILES_USUARIO_INTERNOS`), `NULL NOT IN (...)` evalúa a `NULL`, y
   un `IF` con `NULL` en plpgsql se trata como falso — el trigger NO
   habría bloqueado una sesión sin rol válido. Corregido a
   `IS DISTINCT FROM` (NULL-safe, mismo patrón que
   `fn_enforce_padron_admin_role`) antes de aplicar nada. Verificado
   contra `pg_policies` (vía `supabase db query --linked`, no
   `db push`): las 7 tablas solo tienen 2 políticas PERMISSIVE cada una
   (ADR-033), ninguna otra que neutralice el trigger.

**Verificado en vivo con las 3 cuentas reales pedidas** (Eduardo=admin,
Dante=tecnico_campo, `auditor-qc-demo`=auditor_qc — la cuenta real,
guion medio), fila descartable en `COOP-AROMAS-VALLE`/`ORG-TEST-DEMO`,
limpieza confirmada:
- `admin` → `200`, inspección creada.
- `tecnico_campo` → `200`, inspección creada.
- `auditor_qc` → **`403`, `{"code":"42501","message":"Acceso denegado:
  Solo usuarios con rol admin o tecnico_campo pueden escribir
  inspecciones"}`** — el bypass real que este hallazgo documentó ya no
  funciona.

**Test de integración automatizado:** `tests/test_inspecciones_rbac_rls.py`
(nuevo, mismo patrón `NEEDS_SUPABASE` que `test_padron_rbac_rls.py`) —
4/4 pasando con credenciales reales inyectadas (admin/tecnico_campo
permitidos, auditor_qc bloqueado, aislamiento cross-org intacto).
`tests/test_padron_rbac_rls.py` — 5/5, sin regresión por el refactor de
`assertAdminRole`. `npm run build`/`npm run lint` limpios, sin cambios
de tamaño de ruta. Suite completa: `python -m pytest tests/ -v` 455
passed/45 skipped, 1 fallo preexistente sin relación
(`test_socio_creacion_atomica.py`, migración distinta); `node --test
tests/*.mjs` 9 fallos preexistentes sin relación (`ParcelaFormModal.jsx`,
`gisActions.js`, ETL — documentado en `CLAUDE.md` que estos `.mjs` no
están wired a CI, drift ya conocido).

**Cuenta huérfana del hallazgo original** (`auditor_qc-demo@ryzos-demo.test`,
guion bajo, creada sin querer por un `generate_link` con el email
incorrecto del prompt original) — borrada:
`user_id c9565bfa-18c6-43f7-89be-65189b928dec`, `DELETE
/auth/v1/admin/users/...` → `200`.

**Bug incidental en `fn_validar_codigo_parcela_unico` (mencionado en la
entrada original de este hallazgo) — sigue sin corregir, fuera de
alcance de este fix** (es de la Consola QC / `EUDR_MONITOREO`, no de
`INSPECCIONES`).

Fase D Paso 2 (smoke test formal por rol) queda **cerrado** — matriz
15/15, ver `specs/smoke_test_fase_d_paso2.md` §7. Fase D Paso 3 (retirar
el gate de Basic Auth de `middleware.js`) es el único pendiente real de
`specs/login_real_organizacion_rol.md` §6.

**Revisión de seguridad del usuario (2026-09-08, mismo día, antes de dar
el visto bueno final) — 2 ajustes, ambos aplicados y reverificados en
vivo:**
1. `SET search_path = public` agregado a `fn_enforce_inspecciones_role()`
   — verificado que ni `fn_enforce_padron_admin_role` ni
   `fn_enforce_qc_approval_roles` (las 2 referencias pedidas) lo tienen
   realmente (premisa del pedido no exacta, corregida antes de copiar
   nada) — se agrega igual porque es la convención real del proyecto
   (`auth_role()` y otras funciones `SECURITY DEFINER` sí la tienen).
2. Los 7 `CREATE TRIGGER` pasan de `BEFORE INSERT OR UPDATE` a
   `BEFORE INSERT OR UPDATE OR DELETE` — cierra el mismo tipo de bypass
   (un `DELETE` directo por PostgREST, antes solo bloqueado por RLS de
   organización, nunca por rol). **Encontré y corregí un bug propio
   introducido por este mismo cambio antes de aplicarlo:** `NEW` es
   `NULL` en un trigger de `DELETE` -- el `RETURN NEW` incondicional que
   ya tenía la función habría cancelado en silencio TODO `DELETE`,
   incluso de `admin`/`tecnico_campo`, porque un `BEFORE DELETE` que
   retorna `NULL` aborta la operación. Agregado el mismo branch
   `IF TG_OP = 'DELETE' THEN RETURN OLD` que ya usa
   `fn_enforce_padron_admin_role`.

Migración reaplicada completa contra la base enlazada (`supabase db
query --linked`, `CREATE OR REPLACE`/`DROP TRIGGER IF EXISTS` --
idempotente). Test suite ampliada a 6 casos
(`tests/test_inspecciones_rbac_rls.py`): los 4 originales + `auditor_qc`
bloqueado en `DELETE` directo contra `CAP_MIC` + `admin` permitido en el
mismo `DELETE` (regresión del branch `TG_OP = 'DELETE'` nuevo) — **6/6
pasando** contra la versión corregida.

**Migración creada, aplicada contra la base enlazada y verificada en
vivo, pero NO commiteada/pusheada todavía** — a la espera del visto
bueno explícito del usuario antes de `git commit`/`git push` (gate de
segunda revisión, `docs/RYZOS_ORQUESTADOR_V3.1.md` §4.1: tarea de
SQL/RLS/seguridad).

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

### HALLAZGO (2026-09-08) — fuga de PII en `/dashboard/socios`: cualquier cuenta veía el padrón real de COOP-AROMAS-VALLE

**Confirmado en vivo por el usuario** (captura de la cuenta demo en
`ryzosagri.com/dashboard/socios`): 618 socios, nombre completo + DNI,
todos con código `COOP-AROMAS-VALLE-XXX` — la cooperativa real, no
`ORG-TEST-DEMO`.

**Causa raíz:** `lib/sociosSearch.js::fetchSocios` usaba
`resolveOrganizationId()` (`lib/actions/organizacionesActions.js`) como
fallback por defecto — esa función resolvía "la organización real más
antigua" (`ORGANIZACIONES` ordenada por `creado_en`, excluyendo
`es_organizacion_prueba = true`), **sin mirar la sesión en absoluto**.
Tenía sentido cuando se escribió
(`specs/mejoras_importador_padron_masivo.md` ronda 8, antes de que
existiera login real) porque no había ninguna sesión de la cual partir.
Pero el login real por organización/rol
(`specs/login_real_organizacion_rol.md`, Fases A-D, cerrado y en
producción desde antes de este hallazgo) nunca actualizó esta única
resolución para usar esa sesión — quedó huérfana, ignorando por completo
quién estaba autenticado.

**Por qué las ESCRITURAS nunca estuvieron expuestas:** `createSocio`/
`updateSocio`/`deactivateSocio` siempre tomaron `ID_Organizacion` del
registro real que se está editando (`editingSocio.ID_Organizacion` en
`app/dashboard/socios/page.jsx`), nunca de esta resolución; y
`fn_enforce_padron_admin_role` (`ADR-039`, ver arriba) exige rol `admin`
vía RLS del lado de Postgres para cualquier escritura. Era un gap de
**lectura únicamente**.

**Por qué no lo agarró el test suite existente:**
`tests/test_sociossearch_multitenant.mjs` siempre inyectó su propio
`resolveOrganizationIdFallback` fake en cada test — el default real
(`resolveOrganizationId`) nunca se ejercitó fuera de la app real.

**Fix:** `resolveOrganizationId()` retirada por completo (confirmado sin
ningún otro caller en el repo — era el único fallback default de
`fetchSocios`). Nueva `resolveSessionOrganizationId()` (mismo archivo)
resuelve por sesión real — mismo patrón y misma tabla que
`lib/auth/getCurrentProfile.js` (`PERFILES_USUARIO_INTERNOS`, filtrado
por `user_id` + `activo`, `auth.getUser()` para validar el JWT de
verdad). Fail-closed a `null` (sin sesión o sin perfil activo →
`fetchSocios` devuelve `rows: []`, ya cubierto por un test existente).
`resolveTestOrganizationOverride()` no se tocó.

**Test nuevo:** `tests/test_resolve_session_organization_id.mjs` — no
puede ejercitar una sesión real fuera del runtime de Next
(`createSessionServerClient` depende de `next/headers`, confirmado que
no existe fuera de una request real de Next: `node -e
"import('next/headers')"` → `Cannot find module`). Prueba en cambio lo
que sí hace falta para esta regresión específica: (1)
`resolveOrganizationId` ya no es un export; (2)
`resolveSessionOrganizationId` existe; (3) llamar a
`resolveSessionOrganizationId()`, o a `fetchSocios()` **sin ningún
fallback inyectado**, rechaza específicamente por `next/headers` — antes
del fix, esa misma llamada habría resuelto silenciosamente a
`COOP-AROMAS-VALLE` vía Service Role Key sin tocar `next/headers` en
ningún momento, así que el nuevo rechazo prueba que el default cambió de
verdad. El aislamiento cruzado en sí (`fetchSocios` nunca mezcla filas de
dos organizaciones) ya estaba cubierto por
`tests/test_sociossearch_multitenant.mjs` con el fallback inyectado —
sigue pasando sin cambios (11/11).

**Verificación de regresión:** `node --test tests/*.mjs` — 681/685 pasan
tanto antes como después de este fix (los 4 fallos son preexistentes,
confirmados corriendo la suite completa con `git stash` sobre el mismo
`origin/staging`: `lib/actions/gisActions.js` (validación EUDR_*),
`QcConsoleMap.jsx`/`ADR-022`, `EUDR_USO_SUELO`, `ParcelaFormModal` — sin
relación con `organizacionesActions.js`/`sociosSearch.js`). Antes del
fix, la misma suite con el nuevo archivo de test presente daba 8 fallos
(los 4 preexistentes + los 4 de este archivo, que fallan a propósito
contra el código viejo). `npm run build`/`npm run lint` limpios, mismas
rutas, mismos warnings preexistentes.

**No se aplicó ningún merge a `main` en esta sesión.** Commit a
`staging` únicamente — queda pendiente de revisión y de la decisión de
merge del usuario, mismo criterio que el resto de cambios de este tipo
(Sección 4.1 del protocolo Multi-IA, revisión ya cubierta por tratarse
de Claude/Cowork de punta a punta, pero el merge a producción sigue
siendo un paso manual aparte).
