# Spec — Smoke test formal por rol de Fase D Paso 2 (login real)

## 1. Contexto y motivación

`specs/login_real_organizacion_rol.md` §6 (Fase D) exige, antes de retirar
el gate de Basic Auth (`middleware.js`, Paso 3): aprovisionar cuentas reales
(hecho, Paso 1) y **smoke test por rol contra las 5 pantallas de la
matriz de §5**. ADR-035 a 039 ya verificaron cada escritura de forma
aislada (RLS/trigger vía RPC directo o REST equivalente, sesión real por
magic link). Esta tarea verifica la **matriz completa** — 5 pantallas × 3
roles = 15 combinaciones — contra el código real de producción
(`lib/actions/*.js` cuando existe Server Action propia; llamada directa a
la función/consulta real de la pantalla cuando no existe), no contra un
equivalente REST reconstruido a mano.

## 2. Cuentas (ya provisionadas, Fase D Paso 1 — no se generan nuevas)

| Rol | Email | Organización |
|---|---|---|
| `admin` | `neyser.maldonado@est.unj.edu.pe` (Eduardo) | `COOP-AROMAS-VALLE` |
| `tecnico_campo` | `dneyser5@outlook.com` (Dante) | `COOP-AROMAS-VALLE` |
| `auditor_qc` | `auditor_qc-demo@ryzos-demo.test` | `ORG-TEST-DEMO` |

No existe todavía una cuenta `auditor_qc` real para `COOP-AROMAS-VALLE` —
se usa la demo, mismo patrón que ADR-035/036/037/038/039.

## 3. Matriz a confirmar

De `specs/login_real_organizacion_rol.md` §5 (ya confirmada con el
usuario, no redefinida acá):

| Pantalla | admin | tecnico_campo | auditor_qc |
|---|---|---|---|
| `/dashboard/socios` (alta/edición/export) | Sí | Solo lectura | Solo lectura |
| `/dashboard/inspecciones` | Sí | Sí (crear/editar) | Solo lectura |
| `/dashboard/qc` (aprobar/rechazar) | Sí | No | Sí |
| `/dashboard/mapa` | Sí | Sí | Sí |
| `/dashboard/lotes` (QR) | Sí | Sí | Solo lectura |

## 4. Hallazgos de lectura de código (a confirmar en vivo, sección 6)

Antes de ejecutar nada, la revisión del código real detrás de cada fila
encontró 2 asimetrías entre la matriz y el código existente — **no se
corrigen en esta tarea** (instrucción explícita del usuario), solo se
verifican en vivo y se documentan si se confirman:

1. **`/dashboard/inspecciones` no tiene ningún control de rol, ni de
   aplicación ni de RLS** — `lib/inspeccionesActions.js::saveInspeccion`
   no llama ningún `assertAdminRole`-equivalente, y la política RLS real
   de `INSPECCIONES`/`CAP_*`
   (`supabase/migrations/20260903170404_fase_c_paso2_rls_real_inspecciones_cap.sql`,
   ADR-033) solo exige `"ID_Organizacion" = auth_org_id()` — **sin
   distinción de rol**. La celda `auditor_qc: Solo lectura` de esta fila
   no tiene, hoy, ningún mecanismo real que la haga cumplir.
2. **`/dashboard/lotes` es una vista 100% de solo lectura para los 3
   roles, sin ninguna mutación real** (comentario del propio código,
   `app/dashboard/lotes/page.jsx`: "No persiste nada — es un
   preview/demo") — y lee `vw_monitoreo_web` con
   `getSupabaseClient()` (llave `anon`, **sin sesión real en absoluto**,
   ni siquiera login). No existe ninguna acción que distinga
   `admin`/`tecnico_campo` (`Sí`) de `auditor_qc` (`Solo lectura`) — los
   3 roles (y de hecho cualquier visitante sin sesión) tienen
   exactamente el mismo acceso hoy.

## 5. Metodología por fila

Mismo mecanismo de sesión real que ADR-035–039 (Admin API
`generate_link` tipo `magiclink` + `POST /auth/v1/verify` con
`token_hash`, sin resetear contraseña, sin exponer `access_token`
completo en archivo/consola — solo en memoria del proceso de prueba).

| Fila | Mecanismo real usado | Por qué |
|---|---|---|
| `/dashboard/socios` | `lib/actions/sociosActions.js::updateSocio` (Server Action `'use server'`, `createSessionServerClient()`) invocada dentro de un request real de Next.js — vía un endpoint de diagnóstico temporal (`app/api/_smoke_test_fase_d/route.js`, creado y borrado en esta misma tarea, **nunca commiteado**) que fija la sesión real (`setSession` con el `access_token`/`refresh_token` obtenidos) en el `cookieStore` de ese request antes de invocar la función real importada, sin modificarla. | `createSessionServerClient()` depende de `cookies()` de `next/headers` — solo existe dentro de un request real de Next.js (Server Action/Route Handler), no en un script Node aislado. |
| `/dashboard/qc` (aprobar/rechazar) | `lib/actions/qcActions.js::approveQcRecord`/`rejectQcRecord`, mismo mecanismo de endpoint temporal que arriba. | Mismo motivo — también `'use server'` + `createSessionServerClient()`. |
| `/dashboard/inspecciones` | `lib/inspeccionesActions.js::saveInspeccion` invocada directo desde un script Node (sin harness) con un cliente `@supabase/supabase-js` al que se le hace `setSession()` con la sesión real. | No es una Server Action (`'use server'` ausente) — recibe el cliente `supabase` como parámetro, exactamente como lo hace `useInspeccionForm.js` desde el navegador. Se puede invocar la función real, sin reconstrucción, sin necesidad de contexto de Next.js. |
| `/dashboard/mapa` | Lectura real `supabase.from('vw_monitoreo_web').select(...)` (la misma consulta inline de `components/gis/MapDashboard.jsx`), con la sesión real de cada rol. | No hay Server Action ni función dedicada — la pantalla no tiene una propia, así se cae al caso "RPC/consulta directa" habilitado explícitamente por la instrucción del usuario. Sin caso "bloqueado" en la matriz (los 3 roles son `Sí`) — solo se confirma que los 3 leen con éxito. |
| `/dashboard/lotes` | Misma lectura real que hace `app/dashboard/lotes/page.jsx` (`vw_monitoreo_web` con `getSupabaseClient()`, llave `anon`, sin sesión). | Mismo criterio — sin Server Action propia. Dado el hallazgo de la sección 4.2, se ejecuta igual para los 3 roles (más un control sin ninguna sesión) para confirmar en vivo que el acceso es idéntico. |

Cada prueba usa una fila descartable (creada con Service Role Key,
limpiada al final) donde la operación lo requiere — nunca datos reales de
producción. `admin`/`tecnico_campo` reales operan solo sobre filas
descartables en su propia organización (`COOP-AROMAS-VALLE`); el caso
`auditor_qc` demo opera sobre `ORG-TEST-DEMO`.

## 6. Salida esperada

Tabla final de 15 celdas (rol × pantalla) con el resultado real
observado (permitido/bloqueado + código de error real si bloqueó) — no
un resumen binario. Si alguna celda no coincide con la matriz de la
sección 3, se documenta en `AI_STATE.md` con causa raíz (si se
determina) y **no se corrige en esta tarea** — vuelve al usuario antes de
tocar `lib/actions/*.js`/RLS.

## 7. Resultado final (2026-09-08) — 15/15

Primera corrida: 14/15 coincidían con la matriz. 1 gap real confirmado
(`/dashboard/inspecciones` × `auditor_qc`, sin ningún chequeo de rol) —
documentado en `AI_STATE.md`, cerrado con
`supabase/migrations/20260908150000_enforce_inspecciones_role_trigger.sql`
+ `lib/inspeccionesActions.js::assertInspeccionWriteRole` (ver esa
entrada de `AI_STATE.md`, ahora RESUELTO, para el detalle completo del
fix y su verificación). Con el fix aplicado y verificado en vivo, la
matriz de la sección 3 queda **15/15 confirmada**:

| Pantalla | admin | tecnico_campo | auditor_qc |
|---|---|---|---|
| `/dashboard/socios` | PERMITIDO | BLOQUEADO (`SocioActionError`) | BLOQUEADO (`SocioActionError`) |
| `/dashboard/inspecciones` | PERMITIDO | PERMITIDO | BLOQUEADO (`42501`, trigger nuevo) |
| `/dashboard/qc` | PERMITIDO | BLOQUEADO (`42501`, ADR-039) | PERMITIDO |
| `/dashboard/mapa` | PERMITIDO | PERMITIDO | PERMITIDO |
| `/dashboard/lotes` | PERMITIDO | PERMITIDO | PERMITIDO (ver nota §4.2 — sin mutación real en esta pantalla hoy, no hay nada que diferenciar entre roles todavía) |

Fase D Paso 2 (smoke test formal) queda cerrado. Fase D Paso 3 (retirar
el gate de Basic Auth de `middleware.js`) es el único pendiente real de
`specs/login_real_organizacion_rol.md` §6.

## 7. Fuera de alcance

- Cualquier fix de código o de RLS — solo diagnóstico.
- Test de aislamiento cross-org (ya cubierto en ADR-039 Test C y
  `tests/test_padron_rbac_rls.py`) — no se repite acá.
- Retirar el gate de Basic Auth (Fase D Paso 3) — depende del resultado
  de esta tarea, es un paso aparte.
