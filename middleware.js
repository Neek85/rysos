// Gate temporal de contraseña compartida para /dashboard/** y las rutas
// internas de app/api/qc/**, app/api/gis/** que las respaldan (Service
// Role Key server-side contra PADRON_SOCIOS/PADRON_PARCELAS/EUDR_*,
// nunca pensadas para ser alcanzables desde fuera de esas pantallas —
// ver el reconocimiento de app/api/** en AI_STATE.md 2026-09-02).
// /trace/[lot_hash] y /api/trace/** quedan explícitamente FUERA del
// matcher — es el portal público de trazabilidad, debe seguir
// accesible sin contraseña.
//
// Esto es un parche temporal (HTTP Basic Auth, un solo usuario/clave
// compartida) mientras se diseña el login real por organización/rol
// como proyecto aparte — no reemplaza ese trabajo, solo evita que
// /dashboard/** quede abierto al público general mientras tanto.
//
// Fail-closed: si DASHBOARD_GATE_PASSWORD no está definida en el
// entorno, el gate BLOQUEA igual (nunca deja pasar sin contraseña por
// una variable de entorno faltante).
import { NextResponse } from 'next/server'

const GATE_USER = 'ryzos'

function unauthorized() {
  return new NextResponse('Autenticación requerida.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="RYZOS interno"' },
  })
}

export function middleware(request) {
  const gatePassword = process.env.DASHBOARD_GATE_PASSWORD
  if (!gatePassword) {
    return unauthorized()
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return unauthorized()
  }

  let decoded
  try {
    decoded = atob(authHeader.slice('Basic '.length))
  } catch {
    return unauthorized()
  }

  const separatorIndex = decoded.indexOf(':')
  const user = separatorIndex === -1 ? decoded : decoded.slice(0, separatorIndex)
  const password = separatorIndex === -1 ? '' : decoded.slice(separatorIndex + 1)

  if (user !== GATE_USER || password !== gatePassword) {
    return unauthorized()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/qc/:path*', '/api/gis/:path*'],
}
