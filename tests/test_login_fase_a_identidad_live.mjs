// Aislamiento RLS en vivo para la Fase A del login real por organización
// y rol (ver specs/login_real_organizacion_rol.md,
// plans/login_real_organizacion_rol_fase_a_ejecucion.md) -- prueba
// PERFILES_USUARIO_INTERNOS/auth_role()/auth_org_id() contra la
// instancia real, con usuarios reales de auth.users creados y borrados
// por el propio test vía la Admin API de Supabase Auth (Service Role
// Key) -- capacidad confirmada en vivo antes de escribir este archivo
// (crear/loguear/borrar un usuario desechable funcionó de punta a
// punta, ver el plan de ejecución).
//
// Mismo patrón que tests/test_padron_read_functions_live.mjs: gateado
// por HAS_CREDENTIALS + un probe propio (se salta con PGRST202 si la
// migración 20260902213506_login_fase_a_identidad.sql todavía no se
// aplicó -- vuelve a correr solo en cuanto se aplique, sin tocar este
// archivo).
//
// Los perfiles de prueba usan ID_Organizacion = 'COOP-AROMAS-VALLE' (la
// organización real) SOLO para probar el aislamiento cross-org contra
// el caso que de verdad importa -- las filas creadas viven únicamente
// en PERFILES_USUARIO_INTERNOS (tabla nueva, vacía hasta este test) y
// las identidades auth.users son enteramente sintéticas
// (`@ryzos-test.invalid`, nunca entregables). Ningún test de este
// archivo lee, escribe, ni toca PADRON_SOCIOS/PADRON_PARCELAS/
// SOCIO_CERTIFICACIONES ni ningún otro dato real de esa organización.
// Todo se borra al final de cada test (bloque finally), sin residuo.
//
// Ejecutar con: node --test tests/test_login_fase_a_identidad_live.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const HAS_CREDENTIALS = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY)

// ORG_A es de prueba (ADR-008, es_organizacion_prueba = true). ORG_B es
// la organización real -- usada acá solo como FK/etiqueta de un perfil
// sintético, nunca para tocar sus datos reales (ver cabecera).
const ORG_A = 'ORG-TEST-DEMO'
const ORG_B = 'COOP-AROMAS-VALLE'
const TEST_PASSWORD = 'RyzosTest-FaseA-2026!Aa'

let migrationApplied = false
let admin = null

if (HAS_CREDENTIALS) {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  try {
    const { error } = await admin.rpc('auth_role')
    migrationApplied = !error || error.code !== 'PGRST202'
  } catch {
    migrationApplied = false
  }
}

const skip = !HAS_CREDENTIALS
  ? 'NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY no están en .env.local -- test Live, se salta sin credenciales (mismo patrón que NEEDS_SUPABASE en Python).'
  : !migrationApplied
    ? 'supabase/migrations/20260902213506_login_fase_a_identidad.sql todavía no está aplicada en la instancia real (PGRST202) -- se salta hasta que el arquitecto la aplique en Supabase Studio.'
    : false

// ── Helpers de identidades/perfiles desechables ───────────────────────

async function createTestUser(prefix) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ryzos-test.invalid`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (error) throw error
  return { id: data.user.id, email }
}

async function deleteTestUser(userId) {
  if (!userId) return
  // ON DELETE CASCADE en PERFILES_USUARIO_INTERNOS.user_id ya limpia el
  // perfil solo, pero se borra explícito primero por las dudas (p.ej. si
  // este archivo corre contra una versión futura sin el CASCADE).
  await admin.from('PERFILES_USUARIO_INTERNOS').delete().eq('user_id', userId).then(
    () => {},
    () => {}
  )
  await admin.auth.admin.deleteUser(userId).then(
    () => {},
    () => {}
  )
}

async function createProfile({ userId, organizacion, rol, nombre }) {
  const { error } = await admin.from('PERFILES_USUARIO_INTERNOS').insert({
    user_id: userId,
    ID_Organizacion: organizacion,
    rol,
    nombre_completo: nombre,
  })
  if (error) throw error
}

async function signInAsClient(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error) throw error
  return client
}

// ── Tests ──────────────────────────────────────────────────────────────

test('aislamiento cross-org: un usuario con perfil en ORG-TEST-DEMO no puede leer el perfil de un usuario de COOP-AROMAS-VALLE', { skip }, async () => {
  const userA = await createTestUser('fasea-orga')
  const userB = await createTestUser('fasea-orgb')
  try {
    await createProfile({ userId: userA.id, organizacion: ORG_A, rol: 'admin', nombre: 'Test A (ORG-TEST-DEMO)' })
    await createProfile({ userId: userB.id, organizacion: ORG_B, rol: 'admin', nombre: 'Test B (COOP-AROMAS-VALLE, fila desechable)' })

    const clientA = await signInAsClient(userA.email)
    const { data, error } = await clientA.from('PERFILES_USUARIO_INTERNOS').select('*').eq('user_id', userB.id)
    if (error) throw error
    assert.deepEqual(data, [], 'un admin de ORG-TEST-DEMO nunca debe poder leer un perfil de COOP-AROMAS-VALLE, ni siendo admin')
  } finally {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  }
})

test('aislamiento por rol: un tecnico_campo no puede leer el perfil de otro usuario de su misma organización', { skip }, async () => {
  const userTecnico = await createTestUser('fasea-tecnico')
  const userOtro = await createTestUser('fasea-otro-mismaorg')
  try {
    await createProfile({ userId: userTecnico.id, organizacion: ORG_A, rol: 'tecnico_campo', nombre: 'Test Técnico (ORG-TEST-DEMO)' })
    await createProfile({ userId: userOtro.id, organizacion: ORG_A, rol: 'auditor_qc', nombre: 'Test Otro usuario (ORG-TEST-DEMO)' })

    const clientTecnico = await signInAsClient(userTecnico.email)
    const { data, error } = await clientTecnico.from('PERFILES_USUARIO_INTERNOS').select('*').eq('user_id', userOtro.id)
    if (error) throw error
    assert.deepEqual(data, [], 'un tecnico_campo no debe poder leer el perfil de otro usuario, aunque sea de su misma organización -- eso es exclusivo de admin')
  } finally {
    await deleteTestUser(userTecnico.id)
    await deleteTestUser(userOtro.id)
  }
})

test('confirmación positiva: un admin SÍ puede leer el perfil de otro usuario de su misma organización (evita el falso positivo de "todo bloqueado")', { skip }, async () => {
  const userAdmin = await createTestUser('fasea-admin-mismaorg')
  const userOtro = await createTestUser('fasea-otro-para-admin')
  try {
    await createProfile({ userId: userAdmin.id, organizacion: ORG_A, rol: 'admin', nombre: 'Test Admin (ORG-TEST-DEMO)' })
    await createProfile({ userId: userOtro.id, organizacion: ORG_A, rol: 'tecnico_campo', nombre: 'Test Otro usuario para admin (ORG-TEST-DEMO)' })

    const clientAdmin = await signInAsClient(userAdmin.email)
    const { data, error } = await clientAdmin.from('PERFILES_USUARIO_INTERNOS').select('*').eq('user_id', userOtro.id)
    if (error) throw error
    assert.equal(data.length, 1, 'un admin SÍ debe poder leer el perfil de otro usuario de su propia organización')
    assert.equal(data[0].user_id, userOtro.id)
  } finally {
    await deleteTestUser(userAdmin.id)
    await deleteTestUser(userOtro.id)
  }
})

test('auth_org_id()/auth_role() devuelven NULL (no error) para una sesión anon, sin JWT', { skip }, async () => {
  const anonClient = createClient(SUPABASE_URL, ANON_KEY)
  const { data: orgId, error: orgErr } = await anonClient.rpc('auth_org_id')
  if (orgErr) throw orgErr
  assert.equal(orgId, null, 'auth_org_id() debe degradar a NULL para anon, nunca lanzar error')

  const { data: rol, error: rolErr } = await anonClient.rpc('auth_role')
  if (rolErr) throw rolErr
  assert.equal(rol, null, 'auth_role() debe degradar a NULL para anon, nunca lanzar error')
})

test('auth_org_id()/auth_role() devuelven NULL (no error) para una sesión authenticated real SIN perfil en PERFILES_USUARIO_INTERNOS', { skip }, async () => {
  const userSinPerfil = await createTestUser('fasea-sin-perfil')
  try {
    const client = await signInAsClient(userSinPerfil.email)
    const { data: orgId, error: orgErr } = await client.rpc('auth_org_id')
    if (orgErr) throw orgErr
    assert.equal(orgId, null, 'auth_org_id() debe degradar a NULL para un authenticated real sin fila de perfil')

    const { data: rol, error: rolErr } = await client.rpc('auth_role')
    if (rolErr) throw rolErr
    assert.equal(rol, null, 'auth_role() debe degradar a NULL para un authenticated real sin fila de perfil')
  } finally {
    await deleteTestUser(userSinPerfil.id)
  }
})
