'use server'

// Helper de sesión (Fase B, specs/login_real_organizacion_rol.md) --
// primer consumidor real: specs/rbac_webgis_padron.md (RBAC de
// /dashboard/socios), que es exactamente el gating de la matriz de
// permisos (§5 del spec de login) para el que se escribió esto en
// Fase B. `'use server'` agregado acá -- ya era una función async
// pura, exportada, apta para Server Action tal cual, solo faltaba el
// directive para que un componente 'use client' pueda invocarla.
//
// Usa el cliente de SESIÓN (lib/supabase/sessionServerClient.js, llave
// `anon` + cookies reales) -- nunca Service Role Key.
// `auth.getUser()` (no `getSession()`) valida el JWT de verdad contra
// el servidor de Supabase Auth, mismo criterio que middleware.js.
//
// `organizacion`/`rol` se leen de PERFILES_USUARIO_INTERNOS (Fase A) --
// la política `rls_select_propio_perfil` ya permite que cada usuario
// lea su propia fila, así que esta consulta respeta RLS normal, no
// necesita ninguna función RPC. Degrada a `null`/`null` para cualquier
// caso sin sesión o sin perfil activo -- nunca lanza error, mismo
// criterio que `auth_org_id()`/`auth_role()` (Fase A).
//
// @returns {Promise<{userId: string|null, email: string|null, organizacion: string|null, rol: string|null}>}

import { createSessionServerClient } from '@/lib/supabase/sessionServerClient'

export async function getCurrentProfile() {
  const supabase = await createSessionServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { userId: null, email: null, organizacion: null, rol: null }
  }

  const { data: perfil } = await supabase
    .from('PERFILES_USUARIO_INTERNOS')
    .select('ID_Organizacion, rol')
    .eq('user_id', user.id)
    .eq('activo', true)
    .maybeSingle()

  return {
    userId: user.id,
    email: user.email ?? null,
    organizacion: perfil?.ID_Organizacion ?? null,
    rol: perfil?.rol ?? null,
  }
}
