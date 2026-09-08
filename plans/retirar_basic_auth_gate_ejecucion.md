# Plan de ejecución — Fase D Paso 3 (retirar Basic Auth)

Ver spec: `specs/retirar_basic_auth_gate.md`.

1. [x] `middleware.js` — remover la capa de Basic Auth, dejar solo la
   verificación de sesión real de Supabase Auth. `matcher` sin cambios.
2. [x] `app/login/page.jsx` — corregir el comentario de cabecera que
   menciona el gate de Basic Auth como activo.
3. [x] Borrar `tests/test_dashboard_gate_session_redirect_live.mjs`;
   crear `tests/test_dashboard_session_redirect_live.mjs`.
4. [x] `npm run build` limpio.
5. [x] `node --test tests/test_dashboard_session_redirect_live.mjs` —
   3/3 (con `npm run dev` corriendo aparte).
6. [x] Reportar a Cowork el diff completo de los archivos tocados
   (contenido literal, no resumen) — sin commitear ni pushear todavía.
7. [x] (Tras visto bueno de Cowork) commit + push a `staging` (`e16e897`).
8. [x] Confirmación real: entrar a `/dashboard/mapa` en `staging` sin
   sesión (ventana de incógnito) — debe ir directo a `/login`, sin ningún
   prompt de Basic Auth del navegador; loguearse y confirmar que llega
   al Mapa WebGIS. Hecho por Cowork vía navegador contra `staging`
   (no localhost): sin sesión redirige a `/login` (con o sin un header
   `Authorization: Basic` viejo), con sesión carga el Mapa WebGIS con
   normalidad, sin ningún prompt de Basic Auth en ningún caso.
9. [x] (Paso separado, después de 8) `docs/ESTADO_PROYECTO.md` —
   entrada de cierre de Fase D completa (Pasos 1, 2 y 3), mismo patrón
   que el cierre del incidente de login (commit `167c214`).
