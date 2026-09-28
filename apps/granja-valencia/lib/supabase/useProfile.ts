import { useEffect, useState } from 'react'
import { supabase } from './client'
import { useSession } from './useSession'

export function useProfile() {
  const { session } = useSession()
  const [organizacion, setOrganizacion] = useState<string | null>(null)
  const [nombreOrganizacion, setNombreOrganizacion] = useState<string | null>(null)
  const [rol, setRol] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.user) {
      setOrganizacion(null)
      setNombreOrganizacion(null)
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
      .then(async ({ data }) => {
        if (cancelled) return
        const idOrganizacion = data?.ID_Organizacion ?? null
        setOrganizacion(idOrganizacion)
        setRol(data?.rol ?? null)

        if (!idOrganizacion) {
          setNombreOrganizacion(null)
          setLoading(false)
          return
        }

        // La PK real de ORGANIZACIONES es "ID", no "ID_Organizacion" --
        // confirmado en docs/schema_live_core.md y en vivo (no repetir
        // la confusión ya corregida antes en esta app).
        const { data: org } = await supabase
          .from('ORGANIZACIONES')
          .select('Nombre_Organizacion')
          .eq('ID', idOrganizacion)
          .maybeSingle()
        if (cancelled) return
        setNombreOrganizacion(org?.Nombre_Organizacion ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [session?.user?.id])

  return { organizacion, nombreOrganizacion, rol, loading }
}
