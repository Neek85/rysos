# Plan de ejecución — `/dashboard` (bare) 404

Ver spec: `specs/redirect_dashboard_default.md`.

1. [x] `app/dashboard/page.jsx` — Server Component, `redirect('/dashboard/mapa')`.
2. [x] `npm run build` limpio.
3. [ ] Commit + push a `staging` (nunca a `main`).
4. [ ] Confirmación real: Eduardo o Dante entra a `/dashboard` con sesión válida y llega al Mapa
   WebGIS sin 404.

Sin gate de segunda revisión: página de redirección pura, sin SQL/RLS/seguridad — cubierto por la
Sección 4.1.2 del protocolo Multi-IA.
