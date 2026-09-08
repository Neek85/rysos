# Spec — Completar el flujo de recuperación de contraseña (Supabase Auth)

## 1. Contexto y motivación

Hallazgo real durante el smoke test de Fase D (`claude/diseno_padron_certificaciones_multiproducto.md`,
sección "Login real"): al enviar "Send password recovery" desde el Dashboard de Supabase para
Eduardo (`admin`, `COOP-AROMAS-VALLE`), el link del correo funciona (Supabase valida el token,
`auth.users.last_sign_in_at` se actualiza), pero el usuario termina en `/` — `app/page.jsx`, el
dashboard EUDR público — sin ningún formulario para fijar la contraseña nueva.

Diagnóstico confirmado leyendo el repo (`staging`), no solo observado en el navegador:

- El Site URL de Supabase Auth (`https://rysos-git-staging-neek85s-projects.vercel.app`, sin path)
  es el destino por defecto de cualquier redirect que no especifique uno propio y coincidente con
  la allow-list — y el botón "Send password recovery" del Dashboard de Supabase **no** permite pasar
  un `redirectTo` custom: siempre usa el Site URL vigente al momento del envío.
- `app/page.jsx` usa `getSupabaseClient()` (`lib/supabaseClient.js`, `createClient` de
  `@supabase/supabase-js` sin opciones — sesión en `localStorage` del navegador). Al cargar con el
  hash `#access_token=...&type=recovery&refresh_token=...` en la URL, ese cliente completa el
  intercambio de token automáticamente (`detectSessionInUrl` es `true` por defecto) — de ahí que
  Supabase registre el sign-in — pero la sesión resultante vive solo en `localStorage`, nunca en
  cookies.
- `middleware.js` (gate de `/dashboard/**`) valida sesión vía `createSessionMiddlewareClient`
  (`@supabase/ssr`, cookies) — no tiene forma de ver una sesión guardada en `localStorage`. El
  usuario queda con una sesión "real" ante Supabase pero inutilizable para entrar a `/dashboard`, y
  sin haber llamado nunca `supabase.auth.updateUser({ password })`, tampoco con una contraseña
  nueva conocida para loguearse por el flujo normal.

No es un problema de SMTP/dominio (ya resueltos, ver `docs/ESTADO_PROYECTO.md` — Resend
entregó ambos correos, confirmado "Delivered"). Es un hueco de código: nunca se construyó la
pantalla que completa este flujo, porque el roster real (Eduardo/Dante) nunca había llegado tan
lejos hasta ahora — las 3 cuentas demo de Fase D Paso 1 se activaron por Admin API
(`createUser` con contraseña fija), no por este camino.

## 2. Decisión de diseño

Página nueva `app/actualizar-password/page.jsx`, pública (fuera del matcher de `middleware.js`,
mismo criterio que `/login`), que:

1. Usa `getSupabaseBrowserClient()` (`lib/supabase/browserClient.js`, cookies) — no
   `getSupabaseClient()` — para que la sesión resultante del intercambio de token sea la misma que
   `middleware.js` puede validar.
2. Escucha `onAuthStateChange` para el evento `PASSWORD_RECOVERY` (y revisa la sesión ya activa al
   montar, por si el evento ya disparó antes del primer render) para saber si hay una sesión de
   recuperación válida. Si no la hay (link vencido/ya usado/URL visitada directamente), muestra un
   mensaje de error sin formulario — nunca un formulario "vacío" que fallaría recién al enviar.
3. Formulario de dos campos (nueva contraseña + confirmación), validación en cliente (coinciden,
   mínimo 6 caracteres — el mínimo real configurado en este proyecto de Supabase Auth) y el error de
   Supabase se muestra tal cual si la validación de servidor es más estricta.
4. Envía `supabase.auth.updateUser({ password })`. Éxito → navegación completa (no
   `router.push`) a `/dashboard`, mismo patrón que `app/login/page.jsx`, para que la próxima
   request llegue a `middleware.js` con la cookie ya escrita.

Sirve para dos casos, no solo recovery: una invitación (`inviteUserByEmail`) también deja al
usuario en una sesión de "recuperación" hasta que fija su contraseña inicial — mismo código,
mismo destino.

### Site URL

Se actualiza el Site URL de Supabase Auth de
`https://rysos-git-staging-neek85s-projects.vercel.app` a
`https://rysos-git-staging-neek85s-projects.vercel.app/actualizar-password` — es el único destino
que puede alcanzar el botón "Send password recovery"/"Send confirmation email" del Dashboard, que
no acepta `redirectTo` propio. Sin este cambio, la página nueva nunca se alcanza desde ese botón.
No afecta el login normal (usa `resolveSafeNext`/navegación cliente, no el Site URL de Supabase).

### Self-service real (mejora incluida, no solo el desbloqueo puntual)

`app/login/page.jsx` gana un link "¿Olvidaste tu contraseña?" que llama
`supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/actualizar-password` })`
usando el cliente de sesión (`getSupabaseBrowserClient`) — este sí acepta `redirectTo` explícito,
así que funciona sin depender del Site URL incluso si cambia en el futuro (p. ej. al migrar a
`ryzosagri.com`). Mensaje de confirmación genérico ("si el correo existe, se envió un enlace") —
mismo criterio anti-enumeración ya aplicado en el login (Fase B).

## 3. Fuera de alcance

- No se toca RLS/SQL — página 100% cliente sobre Supabase Auth, sin escritura a tablas propias.
- No se retira `middleware.js` (Basic Auth) — sigue siendo Fase D Paso 3, sin relación con esto.
- No se migra esta página a `ryzosagri.com` como Site URL todavía — ese dominio se deja para cuando
  se decida el corte real de dominio de producción (fuera de este spec).

## 4. Contrato de datos / validación

Sin Zod — este trabajo no expone datos personales de un socio ni es una de las superficies nuevas
alcanzadas por la decisión de alcance de Zod/TS documentada en `CLAUDE.md` (apps móviles +
superficies nuevas de datos de socio). Validación en JS plano, mismo estilo que
`app/login/page.jsx`:

```js
// nueva contraseña, confirmación
{ password: string (min 6), confirmPassword: string }
// error si no coinciden o si password.length < 6, antes de llamar a Supabase
```

## 5. Verificación

- `npm run build` limpio (no hay `npm test` real en este repo, ver `CLAUDE.md`).
- Prueba manual: reenviar "Send password recovery" a Eduardo y Dante desde el Dashboard de
  Supabase (ya con el Site URL actualizado) y confirmar en Resend (`resend.com/emails`) que el
  nuevo correo se entrega — luego que cada uno complete el formulario y llegue a `/dashboard`.
