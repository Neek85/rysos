// Verifica en vivo (Fase B, specs/login_real_organizacion_rol.md) que
// pasar Basic Auth correcto SIN sesión real de Supabase Auth NUNCA deja
// pasar a una ruta protegida -- debe redirigir a /login, nunca 200 ni
// dejar pasar solo con el gate de contraseña compartida.
//
// Requiere el dev server real corriendo (`npm run dev`, puerto 3000 por
// defecto) -- este archivo NO lo levanta él mismo (mismo criterio que
// los tests Live de Supabase de este repo, que tampoco levantan la
// instancia: se salta con un mensaje explicativo si no está disponible,
// nunca simula el resultado).
//
// Ejecutar con: node --test tests/test_dashboard_gate_session_redirect_live.mjs
// (con `npm run dev` corriendo en otra terminal, y DASHBOARD_GATE_PASSWORD
// configurada en .env.local)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvLocal() {
  const envPath = path.join(ROOT, '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvLocal()

const BASE_URL = process.env.DEV_SERVER_URL || 'http://localhost:3000'
const GATE_PASSWORD = process.env.DASHBOARD_GATE_PASSWORD

let devServerUp = false
try {
  await fetch(BASE_URL, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(2000) })
  devServerUp = true
} catch {
  devServerUp = false
}

const skip = !devServerUp
  ? `No se pudo alcanzar ${BASE_URL} -- este test requiere el dev server real corriendo ("npm run dev" en otra terminal). Se salta, no simula el resultado.`
  : !GATE_PASSWORD
    ? 'DASHBOARD_GATE_PASSWORD no está en .env.local -- no se puede construir el header de Basic Auth real. Se salta.'
    : false

test('Basic Auth correcto SIN sesión de Supabase Auth redirige a /login, nunca deja pasar a una ruta protegida', { skip }, async () => {
  const basicAuth = Buffer.from(`ryzos:${GATE_PASSWORD}`).toString('base64')
  const res = await fetch(`${BASE_URL}/dashboard/socios`, {
    method: 'GET',
    redirect: 'manual',
    headers: { Authorization: `Basic ${basicAuth}` },
  })

  assert.ok([301, 302, 307, 308].includes(res.status), `esperaba un redirect (30x), recibí ${res.status}`)
  const location = res.headers.get('location')
  assert.ok(location, 'la respuesta de redirect debe traer un header Location')
  const locationPath = new URL(location, BASE_URL).pathname
  assert.equal(locationPath, '/login', `esperaba redirect a /login, terminó en ${locationPath}`)
})

test('Basic Auth incorrecto sigue devolviendo 401 (no se rompió con el cambio de Fase B)', { skip }, async () => {
  const basicAuth = Buffer.from('ryzos:contraseña-incorrecta-a-proposito').toString('base64')
  const res = await fetch(`${BASE_URL}/dashboard/socios`, {
    method: 'GET',
    redirect: 'manual',
    headers: { Authorization: `Basic ${basicAuth}` },
  })
  assert.equal(res.status, 401, `esperaba 401 con Basic Auth incorrecto, recibí ${res.status}`)
})
