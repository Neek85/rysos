# Spec — Fase D Paso 3: retirar el gate de Basic Auth (`middleware.js`)

## 1. Contexto y motivación
Único paso pendiente de `specs/login_real_organizacion_rol.md` §6 (Fase D).
El gate de Basic Auth (usuario/clave compartida `ryzos`/
`DASHBOARD_GATE_PASSWORD`) fue un parche temporal desde el primer deploy a
producción (commit `47cdcbf`), mantenido en paralelo con la sesión real de
Supabase Auth durante todo el rollout (invariante §7 de la spec de login
real), a retirar "solo después de verificar todo lo anterior end-to-end"
(§6).

Esa verificación end-to-end ya está cerrada:
- Incidente de login real (Eduardo/Dante, roster real de
  COOP-AROMAS-VALLE) resuelto y confirmado en vivo por los dos usuarios
  (commits `15be571`, `f87345c`).
- Smoke test formal por rol (Fase D Paso 2, matriz de 5 pantallas × 3
  roles) en 15/15, gap real de `auditor_qc` en `/dashboard/inspecciones`
  cerrado con trigger de doble capa, commit `267f802`.

No queda ninguna verificación pendiente que bloquee este paso.

## 2. Decisión de diseño
`middleware.js` hoy hace 2 verificaciones en serie: (a) Basic Auth
(usuario/clave compartida), (b) sesión real de Supabase Auth
(`auth.getUser()`), con redirect a `/login` si falla (b). Se retira
únicamente la capa (a) — todo el bloque `GATE_USER`/`gatePassword`/
`unauthorized()`/decodificación de `Authorization: Basic` — dejando (b)
como única capa de acceso a `/dashboard/**`, `/api/qc/**`, `/api/gis/**`.
El comportamiento fail-closed no cambia: sin sesión válida, sigue
redirigiendo a `/login` (nunca deja pasar por defecto); ese código no se
toca.

El `matcher` no cambia. `/trace/[lot_hash]` y `/api/trace/**` siguen fuera
de él, sin tocar.

Se actualiza el comentario de cabecera de `app/login/page.jsx` que
todavía dice "El gate de Basic Auth (middleware.js) sigue activo en
paralelo" — ya no es cierto tras este cambio.

Se reemplaza `tests/test_dashboard_gate_session_redirect_live.mjs`
(verificaba las 2 capas combinadas, incluido un caso de "Basic Auth
incorrecto → 401" que ya no puede pasar) por
`tests/test_dashboard_session_redirect_live.mjs`, que verifica que la
sesión real sigue siendo obligatoria — con o sin un header `Authorization`
viejo/cacheado de un cliente que todavía lo mande, nunca debe otorgar
acceso.

## 3. Fuera de alcance
- No se toca `auth_org_id()`/`auth_role()` ni ninguna política RLS —
  esto es routing de aplicación, no seguridad de datos.
- No se remueve `DASHBOARD_GATE_PASSWORD` de las variables de entorno de
  Vercel — queda sin uso en el código; removerla del dashboard de Vercel
  es un paso manual de infraestructura, fuera del repo.
- No hay landing page ni redirección distinta por rol.

## 4. Contrato de datos / validación
No aplica — sin cambios de esquema, tabla, vista, función SQL, ni
contrato Zod/TS. Cambio puro de routing de aplicación en `middleware.js`.

## 5. Verificación
- `npm run build` limpio.
- `node --test tests/test_dashboard_session_redirect_live.mjs` (con
  `npm run dev` corriendo aparte): 3/3.
- Verificación en vivo contra `staging` (Vercel), después del push: entrar
  a `/dashboard/mapa` sin sesión en una ventana de incógnito — debe ir
  directo a `/login`, sin ningún prompt de Basic Auth del navegador;
  loguearse ahí y confirmar que llega al Mapa WebGIS con normalidad.

## 6. Segunda revisión
Aunque no es un cambio de SQL/RLS/migración, sí es un cambio sobre el
gate de seguridad de acceso a todo `/dashboard/**` — se trata con el
mismo rigor que la Sección 4.1.2 del protocolo Multi-IA exige para esas
categorías: se aplica y se verifica localmente, pero no se
commitea/pushea sin visto bueno explícito de Cowork.
