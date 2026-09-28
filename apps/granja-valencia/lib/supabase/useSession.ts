// Bootstrap de sesión al arrancar la app (fix del hallazgo de Neyser:
// la sesión SÍ persistía en AsyncStorage -- ver client.ts, sin cambios --
// pero nada la consultaba al reabrir la app, así que siempre se mostraba
// el Login de nuevo). getSession() resuelve lo que haya en AsyncStorage;
// onAuthStateChange mantiene el estado sincronizado después (refresh o
// expiración del token con la app abierta).
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './client'

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setIsLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  return { session, isLoading }
}
