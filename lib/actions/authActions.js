'use server'

// Server Action de logout (Fase B, specs/login_real_organizacion_rol.md).
// Usa el cliente de SESIÓN (lib/supabase/sessionServerClient.js, llave
// `anon` + cookies reales) -- nunca el cliente de Service Role Key
// (lib/supabaseServerClient.js, usado por las Server Actions de
// escritura del padrón, propósito completamente distinto).
//
// Disparada desde components/layout/DashboardSidebar.jsx (botón
// "Cerrar sesión", visible en toda /dashboard/* vía el layout
// compartido) -- ver app/dashboard/layout.jsx.

import { redirect } from 'next/navigation'
import { createSessionServerClient } from '@/lib/supabase/sessionServerClient'

export async function signOutAction() {
  const supabase = await createSessionServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
