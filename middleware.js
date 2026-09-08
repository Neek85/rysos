// Fase D Paso 3 (specs/login_real_organizacion_rol.md §6) -- el gate de
// Basic Auth de contraseña compartida (parche temporal desde el primer
// deploy a producción, ver historial de este archivo) se retira acá,
// después de la verificación end-to-end completa: incidente de login
// real cerrado (Eduardo/Dante entrando con su propia cuenta, commits
// `15be571`/`f87345c`) y smoke test formal por rol 15/15 (Fase D Paso 2,
// commit `267f802`). Ver specs/retirar_basic_auth_gate.md.
//
// Gate para /dashboard/** y las rutas internas de app/api/qc/**,
// app/api/gis/** que las respaldan (Service Role Key server-side contra
// PADRON_SOCIOS/PADRON_PARCELAS/EUDR_*, nunca pensadas para ser
// alcanzables desde fuera de esas pantallas -- ver el reconocimiento de
// app/api/** en AI_STATE.md 2026-09-02). /trace/[lot_hash] y
// /api/trace/** quedan explícitamente FUERA del matcher -- es el portal
// público de trazabilidad, debe seguir accesible sin sesión.
//
// Única capa de acceso que queda: sesión real de Supabase Auth
// (auth.getUser(), NUNCA solo getSession() sin validar -- getUser()
// valida el JWT contra el servidor de Supabase Auth de verdad;
// getSession() solo lee la cookie sin verificar que siga siendo válida,
// recomendación de seguridad oficial de Supabase para middlewares).
// Fail-closed: sin sesión válida, siempre redirige a /login -- nunca
// deja pasar por defecto.
import { NextResponse } from 'next/server'
import { createSessionMiddlewareClient } from '@/lib/supabase/sessionServerClient'

export async function middleware(request) {
  const response = NextResponse.next({ request })
  const supabase = createSessionMiddlewareClient(request, response)
  const {
    data: { user: sessionUser },
  } = await supabase.auth.getUser()

  if (!sessionUser) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl, 307)
  }

  return response
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/qc/:path*', '/api/gis/:path*'],
}
