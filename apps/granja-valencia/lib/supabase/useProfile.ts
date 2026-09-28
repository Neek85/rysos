import { useEffect, useState } from 'react'
import { supabase } from './client'
import { useSession } from './useSession'

export function useProfile() {
  const { session } = useSession()
  const [organizacion, setOrganizacion] = useState<string | null>(null)
  const [rol, setRol] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.user) {
      setOrganizacion(null)
      setRol(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    supabase
      .from('PERFILES_USUARIO_INTERNOS')
      .select('ID_Organizacion, rol')
      .eq('user_id', session.user.id)
      .eq('activo', true)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setOrganizacion(data?.ID_Organizacion ?? null)
        setRol(data?.rol ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [session?.user?.id])

  return { organizacion, rol, loading }
}
