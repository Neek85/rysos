// Cliente Supabase con la Service Role Key — SOLO para uso server-side
// (Server Actions / Route Handlers). NUNCA importar este archivo desde un
// componente 'use client' ni desde ningún módulo que termine en el bundle
// del navegador: la Service Role Key bypasea RLS por completo.
//
// Se usa en vez de abrir políticas RLS `anon` de escritura sobre
// PADRON_SOCIOS/PADRON_PARCELAS (padrón maestro, PII real, compartido en
// vivo con otro repositorio) — decisión confirmada con el usuario, ver
// specs/padron_web_socios.md. El aislamiento multi-tenant que normalmente
// daría RLS pasa a ser responsabilidad explícita del código que use este
// cliente (ver lib/actions/sociosActions.js).
//
// Requiere la variable de entorno SUPABASE_SERVICE_ROLE_KEY (sin prefijo
// NEXT_PUBLIC_ — a propósito, para que Next.js nunca la incluya en el
// bundle del cliente). No configurada por defecto en este proyecto — las
// Server Actions que dependen de este cliente fallan con un mensaje claro
// hasta que se agregue en .env.local (desarrollo) y en las variables de
// entorno del despliegue real (producción).

import { createClient } from '@supabase/supabase-js'

let serverClientInstance = null

export function getSupabaseServerClient() {
  if (serverClientInstance) return serverClientInstance

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY no está configurada. Agrégala a .env.local ' +
        '(y a las variables de entorno del despliegue real) para habilitar ' +
        'la escritura del Padrón de Socios/Parcelas — ver specs/padron_web_socios.md.'
    )
  }

  serverClientInstance = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return serverClientInstance
}
