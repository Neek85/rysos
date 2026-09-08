// Verifica en vivo (Fase D Paso 3, specs/retirar_basic_auth_gate.md) que,
// tras retirar el gate de Basic Auth, la sesión real de Supabase Auth
// sigue siendo obligatoria para /dashboard/** -- una request sin sesión
// SIEMPRE redirige a /login, nunca deja pasar, con o sin un header
// Authorization presente (confirma que Basic Auth ya no se evalúa en
// absoluto, ni siquiera como capa opcional).
//
// Reemplaza a tests/test_dashboard_gate_session_redirect_live.mjs
// (Fase B), que verificaba el comportamiento de las 2 capas combinadas
// -- ya no aplica porque la capa de Basic Auth no existe más.
//
// Requiere el dev server real corriendo (`npm run dev`, puerto 3000 por
// defecto) -- este archivo NO lo levanta él mismo: se salta con un
// mensaje explicativo si no está disponible, nunca simula el resultado.
//
// Ejecutar con: node --test tests/test_dashboard_session_redirect_live.mjs
// (con `npm run dev` corriendo en otra terminal)

import { test } from 'node:test'
import assert from 'node:assert/strict'

const BASE_URL = process.env.DEV_SERVER_URL || 'http://localhost:3000'

let devServerUp = false
try {
  await fetch(BASE_URL, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(2000) })
  devServerUp = true
} catch {
  devServerUp = false
}

const skip = !devServerUp
  ? `No se pudo alcanzar ${BASE_URL} -- este test requiere el dev server real corriendo ("npm run dev" en otra terminal). Se salta, no simula el resultado.`
  : false

test('sin sesión y sin ningún header Authorization, /dashboard/socios redirige a /login (nunca 401, nunca deja pasar)', { skip }, async () => {
  const res = await fetch(`${BASE_URL}/dashboard/socios`, { method: 'GET', redirect: 'manual' })
  assert.ok([301, 302, 307, 308].includes(res.status), `esperaba un redirect (30x), recibí ${res.status}`)
  const location = res.headers.get('location')
  assert.ok(location, 'la respuesta de redirect debe traer un header Location')
  const locationPath = new URL(location, BASE_URL).pathname
  assert.equal(locationPath, '/login', `esperaba redirect a /login, terminó en ${locationPath}`)
})

test('un header Authorization: Basic viejo/cacheado (sin sesión real) NO otorga acceso -- confirma que Basic Auth ya no se evalúa', { skip }, async () => {
  const staleBasicAuth = Buffer.from('ryzos:cualquier-cosa-ya-no-importa').toString('base64')
  const res = await fetch(`${BASE_URL}/dashboard/socios`, {
    method: 'GET',
    redirect: 'manual',
    headers: { Authorization: `Basic ${staleBasicAuth}` },
  })
  assert.ok([301, 302, 307, 308].includes(res.status), `esperaba un redirect (30x), recibí ${res.status}`)
  const location = res.headers.get('location')
  const locationPath = new URL(location, BASE_URL).pathname
  assert.equal(locationPath, '/login', `esperaba redirect a /login, terminó en ${locationPath}`)
})

test('/login sigue siendo pública -- nunca pide sesión', { skip }, async () => {
  const res = await fetch(`${BASE_URL}/login`, { method: 'GET', redirect: 'manual' })
  assert.equal(res.status, 200, `esperaba 200 en /login sin sesión, recibí ${res.status}`)
})
