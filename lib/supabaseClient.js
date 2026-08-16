import { createClient } from '@supabase/supabase-js'

let _client = null

function getClient() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  }
  return _client
}

// Proxy lazy: createClient se llama solo cuando se usa, no al importar el módulo.
export const supabase = new Proxy(
  {},
  { get: (_, prop) => getClient()[prop] }
)
