// Cliente Supabase de SESIÓN para el navegador (Fase B del login real,
// specs/login_real_organizacion_rol.md) -- distinto a proposito de
// lib/supabaseClient.js (el cliente `anon` sin sesión que ya usa el
// resto de la app para leer/escribir el padrón vía Server Actions).
// `createBrowserClient` (no `createClient` de @supabase/supabase-js)
// persiste la sesión en COOKIES en vez de localStorage -- necesario
// para que el servidor (middleware.js, Server Components/Actions vía
// lib/supabase/sessionServerClient.js) pueda leer la misma sesión que
// el navegador ya tiene.
//
// Uso: solo desde componentes 'use client' que necesiten manejar la
// sesión real (hoy, únicamente app/login/page.jsx). No reemplaza
// getSupabaseClient() -- ese cliente sigue siendo el que usa el resto
// de /dashboard/* para leer datos (RLS todavía deny-all para
// `authenticated`, ver ADR-031 -- eso lo cierra la Fase C).

import { createBrowserClient } from '@supabase/ssr'

let browserSessionClientInstance = null

export function getSupabaseBrowserClient() {
  if (browserSessionClientInstance) return browserSessionClientInstance

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  browserSessionClientInstance = createBrowserClient(url, anonKey)
  return browserSessionClientInstance
}
