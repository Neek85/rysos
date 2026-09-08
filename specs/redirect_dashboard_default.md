# Spec — `/dashboard` (bare) da 404 tras login/recuperación de contraseña

## 1. Contexto y motivación

Encontrado en la verificación real de `specs/recuperacion_password.md`: Basic Auth (`middleware.js`)
pasa correctamente, la sesión de Supabase Auth se crea correctamente (login normal y flujo de
`/actualizar-password` los dos), pero el usuario termina en una página 404 real de Next.js.

Causa confirmada leyendo el repo: `app/login/page.jsx` (`resolveSafeNext`, destino por defecto
cuando no hay `?next=`) y `app/actualizar-password/page.jsx` (tras `updateUser` exitoso) navegan a
`/dashboard` a secas — pero no existe `app/dashboard/page.jsx`. Las únicas rutas reales bajo
`/dashboard/` son `mapa`, `qc`, `inspecciones`, `lotes`, `socios` (confirmado con `ls`); Next.js no
tiene ningún archivo que resolver para el path exacto `/dashboard`, de ahí el 404.

No es un problema de credenciales ni de Basic Auth — las dos verificaciones de sesión (gate y
Supabase) ya estaban pasando cuando apareció este 404.

## 2. Decisión de diseño

Se agrega `app/dashboard/page.jsx`: un Server Component mínimo que hace `redirect('/dashboard/mapa')`
(API `redirect` de `next/navigation`). `/dashboard/mapa` (Mapa WebGIS) es la primera entrada del
primer grupo del sidebar (`components/layout/DashboardSidebar.jsx`, grupo "GIS & EUDR") — el
destino más natural como landing page por defecto, igual para todos los roles por ahora.

Se elige esto (un archivo de página que redirige) en vez de tocar cada call-site que navega a
`/dashboard` (`login/page.jsx`, `actualizar-password/page.jsx`, y cualquier otro que se agregue más
adelante) porque es la causa raíz: cualquier navegación futura a `/dashboard` a secas, desde
cualquier parte del código, queda resuelta sin tener que acordarse de apuntar a una subruta
específica cada vez.

Redirección por rol (ej. `tecnico_campo` → `/dashboard/inspecciones` en vez de `/dashboard/mapa`)
queda fuera de este fix — no hay lógica de rol en el layout ni en el sidebar hoy, y agregarla es una
decisión de producto aparte, no un bug a corregir.

## 3. Fuera de alcance

- No se toca RLS/SQL ni Basic Auth (`middleware.js`) — el gate y la sesión ya funcionan.
- No se agrega landing page distinta por rol.

## 4. Contrato de datos / validación

Ninguno — página de redirección pura, sin lectura de datos ni formularios.

## 5. Verificación

- `npm run build` limpio.
- Prueba manual: entrar a `/dashboard` directo (con sesión válida) y confirmar que redirige a
  `/dashboard/mapa` sin 404.
