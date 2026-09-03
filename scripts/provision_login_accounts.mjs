// Aprovisiona las cuentas iniciales del login real por organización y rol
// (Fase D, specs/login_real_organizacion_rol.md §6) -- roster real de
// COOP-AROMAS-VALLE (invitación por email) + 3 cuentas demo de
// ORG-TEST-DEMO (email+contraseña generada). Crea/confirma cada
// auth.users y upsertea su fila en PERFILES_USUARIO_INTERNOS (Fase A,
// 20260902213506_login_fase_a_identidad.sql) con Service Role Key --
// esa tabla no tiene política de escritura para `authenticated`, el
// aprovisionamiento es exclusivamente server-side, a propósito (ningún
// usuario interno puede auto-asignarse rol ni cambiar de organización).
//
// Uso: node scripts/provision_login_accounts.mjs
// (nunca importado desde app/ -- ejecución manual únicamente)
//
// Requiere NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en
// .env.local, igual que el resto de scripts server-side del repo.
//
// Idempotente: correrlo 2 veces seguidas no duplica nada -- antes de
// invitar/crear un auth.users se busca por email (no existe
// `getUserByEmail` estable en el SDK, así que se pagina
// `admin.listUsers()`); el upsert de PERFILES_USUARIO_INTERNOS usa
// `onConflict: 'user_id'`.
//
// Contraseñas: SOLO se imprimen por consola al final de la corrida,
// nunca se escriben a ningún archivo (ni siquiera temporal) ni se
// registran en ningún log persistente -- ver el bloque final.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

// ── .env.local (sin dependencia de dotenv, no está instalado) ─────────
function loadEnvLocal() {
  const path = join(REPO_ROOT, '.env.local')
  if (!existsSync(path)) {
    throw new Error('.env.local no existe -- necesario para NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.')
  }
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

// ── Contrato de datos (Zod) ────────────────────────────────────────────
const RolInterno = z.enum(['admin', 'tecnico_campo', 'auditor_qc'])

const CuentaAProvisionar = z.object({
  email: z.string().email(),
  nombre_completo: z.string().min(1),
  rol: RolInterno,
  id_organizacion: z.string().min(1),
  modo: z.enum(['invite', 'password']),
})

const CUENTAS = [
  {
    email: 'neyser.maldonado@est.unj.edu.pe',
    nombre_completo: 'Eduardo Manuel Sernaque Villalobos',
    rol: 'admin',
    id_organizacion: 'COOP-AROMAS-VALLE',
    modo: 'invite',
  },
  {
    email: 'dneyser5@outlook.com',
    nombre_completo: 'Dante Alein Lopez Castillo',
    rol: 'tecnico_campo',
    id_organizacion: 'COOP-AROMAS-VALLE',
    modo: 'invite',
  },
  {
    email: 'admin-demo@ryzos-demo.test',
    nombre_completo: 'Demo Admin',
    rol: 'admin',
    id_organizacion: 'ORG-TEST-DEMO',
    modo: 'password',
  },
  {
    email: 'tecnico-campo-demo@ryzos-demo.test',
    nombre_completo: 'Demo Técnico de Campo',
    rol: 'tecnico_campo',
    id_organizacion: 'ORG-TEST-DEMO',
    modo: 'password',
  },
  {
    email: 'auditor-qc-demo@ryzos-demo.test',
    nombre_completo: 'Demo Auditor QC',
    rol: 'auditor_qc',
    id_organizacion: 'ORG-TEST-DEMO',
    modo: 'password',
  },
].map((c) => CuentaAProvisionar.parse(c))

// ── Buscar un auth.users existente por email (sin getUserByEmail) ─────
async function findUserByEmail(supabaseAdmin, email) {
  const target = email.toLowerCase()
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`listUsers() falló (page ${page}): ${error.message}`)
    const match = data.users.find((u) => (u.email || '').toLowerCase() === target)
    if (match) return match
    if (data.users.length < perPage) return null
  }
}

async function provisionCuenta(supabaseAdmin, cuenta) {
  const resultado = {
    email: cuenta.email,
    rol: cuenta.rol,
    id_organizacion: cuenta.id_organizacion,
    modo: cuenta.modo,
    user_id: null,
    auth_accion: null, // 'invitado' | 'creado' | 'ya_existia'
    password_generada: null,
    perfil_accion: null, // 'upsert_ok'
  }

  const existente = await findUserByEmail(supabaseAdmin, cuenta.email)

  if (existente) {
    resultado.user_id = existente.id
    resultado.auth_accion = 'ya_existia'
  } else if (cuenta.modo === 'invite') {
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(cuenta.email, {
      data: { nombre_completo: cuenta.nombre_completo, rol: cuenta.rol },
    })
    if (error) throw new Error(`inviteUserByEmail(${cuenta.email}) falló: ${error.message}`)
    resultado.user_id = data.user.id
    resultado.auth_accion = 'invitado'
  } else {
    const password = crypto.randomBytes(18).toString('base64url')
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: cuenta.email,
      password,
      email_confirm: true,
      user_metadata: { nombre_completo: cuenta.nombre_completo, rol: cuenta.rol },
    })
    if (error) throw new Error(`createUser(${cuenta.email}) falló: ${error.message}`)
    resultado.user_id = data.user.id
    resultado.auth_accion = 'creado'
    resultado.password_generada = password
  }

  const { error: upsertError } = await supabaseAdmin
    .from('PERFILES_USUARIO_INTERNOS')
    .upsert(
      {
        user_id: resultado.user_id,
        ID_Organizacion: cuenta.id_organizacion,
        rol: cuenta.rol,
        nombre_completo: cuenta.nombre_completo,
        activo: true,
      },
      { onConflict: 'user_id' }
    )
  if (upsertError) throw new Error(`upsert de PERFILES_USUARIO_INTERNOS para ${cuenta.email} falló: ${upsertError.message}`)
  resultado.perfil_accion = 'upsert_ok'

  return resultado
}

async function main() {
  loadEnvLocal()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local.')
  }

  const supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`Aprovisionando ${CUENTAS.length} cuentas...\n`)

  const resultados = []
  for (const cuenta of CUENTAS) {
    const r = await provisionCuenta(supabaseAdmin, cuenta)
    resultados.push(r)
    console.log(
      `- ${r.email} (${r.rol} @ ${r.id_organizacion}): auth=${r.auth_accion}, perfil=${r.perfil_accion}, user_id=${r.user_id}`
    )
  }

  console.log('\nResumen:')
  console.table(
    resultados.map((r) => ({
      email: r.email,
      rol: r.rol,
      id_organizacion: r.id_organizacion,
      auth_accion: r.auth_accion,
      perfil_accion: r.perfil_accion,
      user_id: r.user_id,
    }))
  )

  const nuevasPasswords = resultados.filter((r) => r.password_generada)
  if (nuevasPasswords.length > 0) {
    console.log('\n' + '='.repeat(72))
    console.log('CONTRASEÑAS NUEVAS GENERADAS EN ESTA CORRIDA -- SOLO PARA USO')
    console.log('INMEDIATO / GESTOR DE CONTRASEÑAS.')
    console.log('NO pegar esto en ningún archivo del repo (código, docs, commits,')
    console.log('ESTADO_PROYECTO.md, AI_STATE.md, etc.) ni en ningún log persistente.')
    console.log('='.repeat(72))
    for (const r of nuevasPasswords) {
      console.log(`  ${r.email} -> ${r.password_generada}`)
    }
    console.log('='.repeat(72))
  } else {
    console.log('\n(Ninguna cuenta nueva por contraseña en esta corrida -- todas ya existían.)')
  }
}

main().catch((err) => {
  console.error('\nError durante el aprovisionamiento:', err.message)
  process.exitCode = 1
})
