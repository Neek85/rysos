# Spec — Login Real por Organización y Rol (Supabase Auth)

## 1. Contexto y motivación
La web de `/dashboard/*` nunca tuvo autenticación real — decisión de negocio original documentada en `CLAUDE.md`. El gate de contraseña compartida (`middleware.js`, HTTP Basic Auth, commit `47cdcbf`) resuelve la exposición pública inmediata para el primer deploy a producción, pero es una contraseña única sin noción de organización ni rol — no reemplaza el login real, que queda como este proyecto aparte, ya previsto en `RYZOS_ORQUESTADOR_V3.1.md` §1 ("si en el futuro se decide... agregarle login, eso se trata como una tarea explícita").

Este proyecto fusiona además la Fase 2, pausada, del incidente crítico de seguridad de 2026-09-01 (`INSPECCIONES`/6 `CAP_*` sin RLS real por falta de sesión) — ver `docs/adr/ADR-031-...md` y la bitácora del incidente. Esa fase estaba bloqueada exactamente por esto: no se puede cerrar RLS de escritura `anon` sin romper el formulario de Inspecciones hasta que exista una sesión real que lo reemplace. Este proyecto la desbloquea — no son dos trabajos separados.

## 2. Decisiones confirmadas con el usuario
- Autenticación: email + contraseña vía Supabase Auth (no DNI+PIN — eso es exclusivo de la app móvil del Socio).
- Roles cubiertos: `admin`, `tecnico_campo`, `auditor_qc` — nunca `socio` (la app del Socio no usa este login).
- Alcance de enforcement: a nivel de base de datos (RLS) desde el día uno, no solo gating de rutas en el frontend.
- Demo (`ORG-TEST-DEMO`): 3 cuentas, una por rol interno (`admin-demo`, `tecnico_campo-demo`, `auditor_qc-demo`), no una cuenta individual por tester.
- Roster real inicial de `COOP-AROMAS-VALLE`:

| Nombre | Email | Rol |
|---|---|---|
| Eduardo Manuel Sernaque Villalobos | neyser.maldonado@est.unj.edu.pe | admin |
| Dante Alein Lopez Castillo | dneyser5@outlook.com | tecnico_campo |

## 3. Hallazgo de arquitectura — estado real de `auth_org_id()`
`public.auth_org_id()` (autoritativa desde Tarea 9.1) hoy lee `current_setting('request.jwt.claims', true)::json->>'ID_Organizacion'`, un claim que nunca se puebla porque no existe tráfico `authenticated` real. Las 6 políticas RLS que ya la usan (`ORGANIZACIONES`, `PADRON_SOCIOS`, `PADRON_PARCELAS`, `EUDR_MONITOREO`, `EUDR_INSTALACIONES`, `EUDR_USO_SUELO`) son hoy deny-all reales para `authenticated` sin bypass de `service_role`/`postgres` — no un boquete, sino inertes.

Decisión de diseño: en vez de configurar un Custom Access Token Hook de Supabase Auth (pieza de infraestructura nueva, a mantener aparte en el dashboard de Supabase, y que exige cerrar sesión/renovar el JWT para reflejar un cambio de rol/organización), se redefine `auth_org_id()` — mismo nombre y firma, `CREATE OR REPLACE`, sin romper ningún objeto que ya la llama — para resolver la organización desde una tabla de perfiles nueva vía `auth.uid()`, con el claim JWT legacy como fallback secundario. Esto activa las 6 políticas ya declaradas el mismo día que exista login real, sin tocarlas.

## 4. Modelo de datos nuevo
Tabla `public."PERFILES_USUARIO_INTERNOS"` — ver contrato de datos en el prompt de Fase A. Vincula `auth.users.id` con `ID_Organizacion` + `rol`. Sin política de escritura para `authenticated` — el aprovisionamiento es exclusivamente server-side con Service Role Key (Fase D).

Funciones nuevas/redefinidas: `public.auth_role()` (nueva), `public.auth_org_id()` (redefinida, ver §3).

## 5. Matriz de permisos por pantalla (confirmada con el usuario)

| Pantalla | admin | tecnico_campo | auditor_qc |
|---|---|---|---|
| `/dashboard/socios` (alta/edición/export) | Sí | Solo lectura | Solo lectura |
| `/dashboard/inspecciones` | Sí | Sí (crear/editar) | Solo lectura |
| `/dashboard/qc` (aprobar/rechazar) | Sí | No | Sí |
| `/dashboard/mapa` | Sí | Sí | Sí |
| `/dashboard/lotes` (QR) | Sí | Sí | Solo lectura |

Esta matriz se implementa en 2 capas, nunca solo una: (a) gating de UI/rutas en el frontend (ocultar/deshabilitar según `auth_role()` de la sesión), y (b) políticas RLS reales en las tablas que respaldan cada pantalla — la capa (a) es UX, la capa (b) es la que de verdad impide el acceso, por la decisión confirmada de enforcement a nivel de base de datos desde el día uno.

## 6. Fases
- **Fase A** (esta): capa de identidad — tabla + funciones. Inerte en comportamiento hoy. Ver `plans/login_real_organizacion_rol_fase_a_ejecucion.md`.
- **Fase B:** login real en la web — `@supabase/ssr`, pantalla de login/logout, extensión de `middleware.js` para exigir sesión real ademinto del gate de Basic Auth existente (que se mantiene en paralelo hasta verificar todo end-to-end). Server Actions existentes empiezan a resolver organización/rol desde la sesión real en vez de solo confiar en el valor que manda el cliente.
- **Fase C (= Fase 2 del incidente de seguridad, fusionada):** cerrar RLS de `INSPECCIONES`/6 `CAP_*` (hoy `USING (true)` o sin filtro de tenant real) ahora que hay sesión real para exigir `authenticated` + `auth_org_id()`. Revisar cada Server Action que hoy usa Service Role Key por diseño (bypasea RLS) y decidir, caso por caso, si debe pasar a un cliente scopeado a la sesión del usuario en vez de Service Role, para que RLS actúe como respaldo real y no solo la validación de aplicación.
- **Fase D:** aprovisionar cuentas reales (roster de §2 + 3 demo de `ORG-TEST-DEMO`) vía script server-side con Service Role Key (nunca desde el cliente). Smoke test por rol contra las 5 pantallas de la matriz. Test de aislamiento cross-org obligatorio (una cuenta de `ORG-TEST-DEMO` nunca debe alcanzar datos de `COOP-AROMAS-VALLE` ni viceversa). Retirar `middleware.js` (Basic Auth) solo después de verificar todo lo anterior end-to-end.

## 7. Invariantes de seguridad específicos de este proyecto
- Ninguna cuenta interna puede auto-asignarse rol ni cambiar su propia organización (sin política de escritura `authenticated` sobre `PERFILES_USUARIO_INTERNOS`).
- `auth_org_id()`/`auth_role()` degradan a `NULL` para cualquier sesión sin perfil activo (`anon` incluida) — nunca deben lanzar error ni devolver un valor por defecto no-`NULL`.
- Test de aislamiento cruzado obligatorio en cada fase que toque RLS: un usuario de una organización nunca debe poder leer/escribir datos de otra: y, dentro de la misma organización, un `tecnico_campo`/`auditor_qc` nunca debe poder ejercer una acción reservada a `admin` (ver matriz §5), verificado contra la base real, no solo contra el código de la política.
- El gate de Basic Auth (`middleware.js`) se mantiene activo en paralelo durante todo el rollout — se retira solo en Fase D, después de la verificación end-to-end completa.
