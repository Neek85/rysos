// Clientes Supabase de SESIÓN, server-side (Fase B del login real,
// specs/login_real_organizacion_rol.md) -- distintos a propósito de
// lib/supabaseServerClient.js (Service Role Key, bypasea RLS, usado
// por las Server Actions de escritura ya existentes -- NO TOCAR, NO
// REEMPLAZAR, propósito completamente distinto). Estos clientes usan
// la llave `anon` + la sesión real del usuario (cookies) -- respetan
// RLS como el usuario autenticado real la vería, nunca la bypasean.
//
// @supabase/ssr expone dos formas de construir el cliente server-side
// según el contexto de Next.js App Router, porque cada uno maneja
// cookies de forma distinta:
//   - Server Components/Server Actions/Route Handlers: `cookies()` de
//     `next/headers` (createSessionServerClient, este archivo).
//   - middleware.js: el objeto request/response de
//     NextRequest/NextResponse directamente -- `next/headers` no está
//     disponible en ese contexto (createSessionMiddlewareClient, este
//     archivo).
//
// Sin `getAll`/`setAll` correctos, la sesión se corrompe de formas
// difíciles de diagnosticar (logouts aleatorios, tokens no refrescados)
// -- ver el comentario de createServerClient en
// node_modules/@supabase/ssr. Se usan esos 2 métodos (no los `get`/
// `set`/`remove` viejos, deprecados en esta versión de @supabase/ssr).

import { createServerClient } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * Para Server Components, Server Actions y Route Handlers -- lee/escribe
 * cookies vía `cookies()` de `next/headers`.
 *
 * `setAll` puede fallar si se llama desde un Server Component puro (no
 * puede escribir cookies fuera de una Server Action/Route Handler) --
 * se ignora ese error a propósito: el middleware ya refresca la sesión
 * en cada request, así que un Server Component que solo LEE la sesión
 * (no la modifica) sigue funcionando bien sin poder persistir un
 * refresh de token él mismo (mismo criterio que la guía oficial de
 * Supabase para Next.js App Router).
 */
export async function createSessionServerClient() {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Llamado desde un Server Component -- no puede escribir
          // cookies, ver comentario de arriba.
        }
      },
    },
  })
}

/**
 * Para middleware.js -- lee/escribe cookies vía el request/response de
 * NextRequest/NextResponse. El caller debe crear `response` con
 * `NextResponse.next({ request })` ANTES de llamar a esta función (para
 * que las cookies reescritas por un refresh de token viajen tanto al
 * resto de la cadena de middleware -- vía `request` -- como al
 * navegador -- vía `response`).
 */
export function createSessionMiddlewareClient(request, response) {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })
}
