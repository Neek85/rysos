# Plan de ejecución — Completar recuperación de contraseña

Ver spec: `specs/recuperacion_password.md`.

1. [x] `app/actualizar-password/page.jsx` — página nueva, cliente de sesión por cookies,
   maneja `PASSWORD_RECOVERY`, formulario nueva contraseña + confirmación,
   `supabase.auth.updateUser({ password })`, redirect a `/dashboard`.
2. [x] `app/login/page.jsx` — agregar link "¿Olvidaste tu contraseña?" +
   `resetPasswordForEmail` con `redirectTo` explícito, mensaje anti-enumeración.
3. [x] Actualizar Site URL de Supabase Auth (Dashboard, manual, fuera del repo) a
   `.../actualizar-password` — hecho por Cowork vía Claude in Chrome, no requiere migración SQL.
4. [x] `npm run build` limpio.
5. [ ] Reenviar "Send password recovery" a Eduardo y Dante (Dashboard de Supabase, manual).
6. [ ] Confirmación real del usuario: al menos uno de los dos completa el formulario y
   llega a `/dashboard` con sesión válida.
7. [ ] `docs/ESTADO_PROYECTO.md` — entrada de cierre del incidente completo (DNS + Vercel +
   Resend + SMTP + este hueco de código), atribución Claude/Cowork de punta a punta.
8. [ ] Commit + push a `staging` (nunca a `main`).

Sin gate de segunda revisión: trabajo de código nuevo (no SQL/RLS/migración/seguridad de
datos), ejecutado de punta a punta por Claude (Cowork) — cubierto por la Sección 4.1.2 del
protocolo Multi-IA.
