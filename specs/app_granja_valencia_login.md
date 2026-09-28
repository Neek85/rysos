# Spec — App Granja Valencia: Pantalla de Login

> Adaptación al cliente Expo/React Native del patrón real ya implementado
> en `app/login/page.jsx` (Fase B, `specs/login_real_organizacion_rol.md`)
> y `lib/auth/getCurrentProfile.js`. No es un flujo nuevo de auth — es el
> mismo mecanismo (`PERFILES_USUARIO_INTERNOS` + Supabase Auth
> `signInWithPassword`) consumido desde un cliente nativo en vez de Next.js.

## 1. Alcance

**Incluido en v1:**
- Formulario email + contraseña.
- `supabase.auth.signInWithPassword({ email, password })`.
- Mensaje de error genérico en credenciales inválidas (ver §4 — mismo
  criterio anti-enumeración que la web).
- Navegación a Dashboard/Población tras login exitoso.
- Persistencia de sesión entre aperturas de la app (AsyncStorage).

**Fuera de alcance en v1 (decisión confirmada, 2026-09-28):**
- "¿Olvidaste tu contraseña?" — con una sola cuenta real activa hoy, el
  reset se hace manualmente (Supabase Studio o
  `scripts/provision_login_accounts.mjs`), mismo criterio de "paso
  supervisado" que la provisión de cuentas. Se revisita si la app llega a
  tener más de un usuario real.
- Cualquier lógica condicional por rol (`admin` vs `tecnico_campo` vs
  `auditor_qc`) — hoy Granja Valencia solo tiene cuentas `admin`. El único
  precedente real en la web (`isAdmin = rol === 'admin'` en
  `app/dashboard/socios/page.jsx` y `ParcelaFormModal.jsx`) es puramente de
  UX (ocultar controles de escritura), con el chequeo real siempre
  server-side — se replica ese patrón el día que haga falta, no antes.
- `?next=` / redirección post-login configurable — no aplica a una app
  nativa sin URLs de navegador. Tras un login exitoso se navega siempre a
  Dashboard/Población.

## 2. Diferencias deliberadas contra el patrón web

| Web (`app/login/page.jsx`) | App Granja Valencia | Motivo |
|---|---|---|
| Cliente Supabase con cookies (`getSupabaseBrowserClient`, Next.js) | Cliente Supabase con `AsyncStorage` (`@react-native-async-storage/async-storage`) | RN no tiene cookies de navegador — es el storage adapter estándar recomendado por Supabase para RN |
| `window.location.href = resolveSafeNext(...)` (full reload, para que `middleware.js` vea la cookie) | `navigation.replace('Dashboard')` (React Navigation) | No hay `middleware.js` ni SSR en Expo — la sesión vive en el cliente vía Supabase JS |
| Botón "¿Olvidaste tu contraseña?" | No existe en v1 | Ver §1, fuera de alcance |
| Validación nativa HTML (`required`, `type="email"`) | Validación Zod antes de llamar a Supabase (ver §3) | No hay validación HTML5 en RN — contrato explícito, consistente con la regla de contratos Zod obligatorios para trabajo nuevo |

Se mantiene igual (sin cambios respecto a la web):
- El mensaje de error SIEMPRE genérico ("Email o contraseña incorrectos.")
  sin distinguir "no existe" de "contraseña incorrecta" — mismo criterio
  anti-enumeración de Fase B; aplica igual acá (cualquiera con el APK/IPA
  puede intentar logins).
- `supabase.auth.signInWithPassword` como único mecanismo — ninguna capa
  intermedia, ninguna Server Action (no existen en esta app, confirmado en
  §0.4 del roadmap).

## 3. Contrato de datos (Zod) — nuevo, propio de la app

No existe un contrato Zod para el login en el repo web (la página usa
validación nativa HTML únicamente). Este es un contrato NUEVO, propio de
`apps/granja-valencia/` — no se comparte con la web porque la web no lo
tiene y no se le va a agregar (código existente, fuera de alcance).

`apps/granja-valencia/lib/validations/auth.ts`:
```ts
import { z } from 'zod'

export const LoginFormSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido.'),
  password: z.string().min(1, 'La contraseña es obligatoria.'),
})

export type LoginFormValues = z.infer<typeof LoginFormSchema>
```

Nota: esto valida SOLO forma (email bien formado, password no vacía) antes
de llamar a Supabase — nunca reemplaza el mensaje de error genérico de
`signInWithPassword` (ver §2), que sigue siendo la única fuente de verdad
sobre si las credenciales son correctas.

## 4. Cliente Supabase para RN

Nueva dependencia: `@react-native-async-storage/async-storage` (y
`react-native-url-polyfill`, requisito conocido de `@supabase/supabase-js`
en RN — confirmar versión exacta contra la doc oficial de Supabase para RN,
no de memoria).

`apps/granja-valencia/lib/supabase/client.ts`:
```ts
import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
```

## 5. Pantalla de Login

1. Inputs controlados: email, password (React state — para 2 campos no se
   justifica `react-hook-form` todavía; se evalúa si otra pantalla lo
   necesita más adelante).
2. Al tocar "Ingresar": validar con `LoginFormSchema.safeParse()` — si
   falla, mostrar el primer error de forma, nunca llamar a Supabase con
   datos mal formados.
3. Si la forma es válida: `supabase.auth.signInWithPassword(...)`.
   - Error → mensaje SIEMPRE genérico ("Email o contraseña incorrectos."),
     sin importar el código de error real de Supabase.
   - Éxito → navegar a Dashboard/Población (si esa pantalla no existe
     todavía, navegar a un stub temporal hasta que se construya).
4. Loading state mientras la llamada está en curso (botón deshabilitado).
5. Sin "¿Olvidaste tu contraseña?" (§1).

### 5.1. Bootstrap de sesión al abrir la app (2026-09-28, fix real)

**Hallazgo de Neyser en dispositivo real:** login exitoso, pero al cerrar
la app completamente y reabrirla vuelve a pedir credenciales en vez de ir
directo al Dashboard/stub. Diagnóstico confirmado por la CLI: la
configuración de `client.ts` (§4) ya persistía la sesión correctamente en
`AsyncStorage` desde el primer commit, sin cambios — el problema real era
que **nada la consultaba al arrancar la app**. `_layout.tsx` montaba el
`Stack` directo con `index` (Login) siempre como pantalla visible, sin
ninguna llamada a `supabase.auth.getSession()` (confirmado por grep
exhaustivo de `getSession`/`onAuthStateChange` en `src/` y `lib/`: cero
resultados antes de este fix).

**Fix — `apps/granja-valencia/lib/supabase/useSession.ts`** (hook nuevo):
al montar, `supabase.auth.getSession()` resuelve lo que haya en
`AsyncStorage` (con un `isLoading` mientras responde);
`supabase.auth.onAuthStateChange()` mantiene el estado sincronizado
después (login exitoso, refresh o expiración del token con la app
abierta).

**`_layout.tsx`** usa ese hook y reemplaza el `Stack` fijo por el patrón
oficial de Expo Router para rutas protegidas
(`Stack.Protected`, https://docs.expo.dev/router/advanced/authentication/):
mientras `isLoading`, se muestra un `ActivityIndicator` de pantalla
completa en vez del `Stack`; resuelto, `index` (Login) solo es alcanzable
sin sesión y `dashboard-stub` solo con sesión — el guard redirige solo
cuando la sesión cambia (login exitoso incluido), así que la pantalla de
Login (§5) YA NO navega manualmente a `/dashboard-stub` tras
`signInWithPassword` (se quitó ese `router.replace` — sería redundante/
racy contra el guard).

## 6. Pruebas

## 6. Pruebas

- Unit: `LoginFormSchema` — casos válidos e inválidos (email malformado,
  password vacía). Requiere agregar `jest`+`jest-expo` mínimo (no existe
  ningún runner de test en `apps/granja-valencia/` todavía).
- Manual en dispositivo/emulador real (gate de UX del roadmap, no solo
  compilar): login exitoso con la cuenta real de Neyser
  (`dneyser5@gmail.com`), login fallido con contraseña incorrecta
  (confirmar mensaje genérico), cierre y reapertura de la app (confirmar
  que la sesión persiste vía AsyncStorage).

## 7. Estado

EN DISEÑO (2026-09-28) — a crear en el repo, luego implementar.
