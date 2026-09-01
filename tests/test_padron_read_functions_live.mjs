// Aislamiento RLS cruzado CONTRA LA INSTANCIA REAL para las funciones
// SECURITY DEFINER de supabase/migrations/20260901160000_lecturas_padron_security_definer.sql
// -- ver AI_STATE.md "Reemplazo SECURITY DEFINER para lecturas de
// PADRON_SOCIOS/PADRON_PARCELAS".
//
// A diferencia del resto de tests/*.mjs de este repo (que testean
// lib/sociosSearch.js/lib/padronSearch.js/lib/padronCsv.js/
// lib/eudrQcActions.js con una función SQL FALSA inyectada, ver
// tests/test_sociossearch_multitenant.mjs y hermanos), este archivo
// llama a las funciones SQL REALES contra la instancia real de
// Supabase, con la Service Role Key -- exactamente lo que pidió la
// tarea ("organización A no puede leer datos de organización B usando
// las nuevas funciones"). El aislamiento real vive DENTRO de cada
// función SQL (`WHERE ..._Organizacion = p_organizacion`) -- ningún
// test con un fake de JS puede probar eso de verdad, solo que el
// wrapper de JS pasa el parámetro correcto.
//
// GATEADO, mismo patrón que NEEDS_SUPABASE del lado de Python
// (tests/test_fase1_sdd.py y hermanos): se salta solo si faltan
// NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en el entorno, o si
// la migración 20260901160000 todavía no se aplicó (PGRST202 al probar
// la función -- exactamente el caso hoy: la tarea que escribió este
// archivo pidió explícitamente NO aplicar nada en Supabase todavía, ver
// AI_STATE.md). Empieza a correr de verdad en cuanto el arquitecto
// aplique la migración -- no hace falta tocar este archivo para eso.
//
// Ejecutar con: node --test tests/test_padron_read_functions_live.mjs

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
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const HAS_CREDENTIALS = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY)

// Organizaciones reales confirmadas en vivo (ver AI_STATE.md) -- una
// tiene padrón real, la otra el padrón sintético de la ronda de
// robustez del importador. Ninguna se modifica acá -- solo SELECT vía
// las funciones SECURITY DEFINER (nunca la tabla base).
const ORG_A = 'COOP-AROMAS-VALLE'
const ORG_B = 'ORG-TEST-DEMO'

let migrationApplied = false
let exportMigrationApplied = false
let supabase = null

if (HAS_CREDENTIALS) {
  supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  try {
    const { error } = await supabase.rpc('fn_listar_padron_socios', { p_organizacion: '__probe_no_deberia_existir__' })
    migrationApplied = !error || error.code !== 'PGRST202'
  } catch {
    migrationApplied = false
  }
  try {
    const { error } = await supabase.rpc('fn_exportar_padron_socios', { p_organizacion: '__probe_no_deberia_existir__' })
    exportMigrationApplied = !error || error.code !== 'PGRST202'
  } catch {
    exportMigrationApplied = false
  }
}

const skip = !HAS_CREDENTIALS
  ? 'NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no están en .env.local -- test Live, se salta sin credenciales (mismo patrón que NEEDS_SUPABASE en Python).'
  : !migrationApplied
    ? 'supabase/migrations/20260901160000_lecturas_padron_security_definer.sql todavía no está aplicada en la instancia real (PGRST202) -- se salta hasta que el arquitecto la aplique en Supabase Studio.'
    : false

const skipExport = !HAS_CREDENTIALS
  ? 'NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no están en .env.local -- test Live, se salta sin credenciales (mismo patrón que NEEDS_SUPABASE en Python).'
  : !exportMigrationApplied
    ? 'supabase/migrations/20260901170000_export_padron_security_definer.sql todavía no está aplicada en la instancia real (PGRST202) -- se salta hasta que el arquitecto la aplique en Supabase Studio.'
    : false

test('fn_listar_padron_socios: una llamada con p_organizacion=A nunca devuelve una fila de la organización B', { skip }, async () => {
  const { data, error } = await supabase.rpc('fn_listar_padron_socios', { p_organizacion: ORG_A, p_page_size: 1000 })
  if (error) throw error
  assert.ok(data.length > 0, `se esperaban filas reales para ${ORG_A}`)
  assert.ok(
    data.every((r) => r.ID_Organizacion === ORG_A),
    `ninguna fila debe pertenecer a otra organización que no sea ${ORG_A}`
  )
})

test('fn_listar_padron_socios: A y B devuelven conjuntos de ID_Socio disjuntos (aislamiento cruzado real, no solo "no está vacío")', { skip }, async () => {
  const [{ data: rowsA, error: errA }, { data: rowsB, error: errB }] = await Promise.all([
    supabase.rpc('fn_listar_padron_socios', { p_organizacion: ORG_A, p_page_size: 1000 }),
    supabase.rpc('fn_listar_padron_socios', { p_organizacion: ORG_B, p_page_size: 1000 }),
  ])
  if (errA) throw errA
  if (errB) throw errB
  const idsA = new Set(rowsA.map((r) => r.ID_Socio))
  const idsB = new Set(rowsB.map((r) => r.ID_Socio))
  const interseccion = [...idsA].filter((id) => idsB.has(id))
  assert.deepEqual(interseccion, [], 'ID_Socio de la organización A no debe aparecer en el resultado de B, ni viceversa')
})

test('fn_listar_padron_socios: p_organizacion inexistente devuelve vacío, no un error ni "todo"', { skip }, async () => {
  const { data, error } = await supabase.rpc('fn_listar_padron_socios', { p_organizacion: '__ORG_QUE_NO_EXISTE__', p_page_size: 10 })
  if (error) throw error
  assert.deepEqual(data, [])
})

test('fn_listar_padron_parcelas_por_socio: nunca devuelve una parcela de otra organización aunque el ID_Socio exista en ambas (colisión de código)', { skip }, async () => {
  const { data: sociosA, error: errA } = await supabase.rpc('fn_listar_padron_socios', { p_organizacion: ORG_A, p_page_size: 1 })
  if (errA) throw errA
  if (!sociosA?.length) return // sin datos reales para probar esta combinación puntual, no es un fallo del aislamiento
  const socioId = sociosA[0].ID_Socio

  const [{ data: parcelasOrgA, error: e1 }, { data: parcelasOrgB, error: e2 }] = await Promise.all([
    supabase.rpc('fn_listar_padron_parcelas_por_socio', { p_organizacion: ORG_A, p_socio_id: socioId }),
    supabase.rpc('fn_listar_padron_parcelas_por_socio', { p_organizacion: ORG_B, p_socio_id: socioId }),
  ])
  if (e1) throw e1
  if (e2) throw e2
  assert.ok(
    parcelasOrgB.every((r) => r.ID_Organizacion === ORG_B),
    'pedir las parcelas de un ID_Socio de la organización A, pasando p_organizacion=B, nunca debe devolver filas de A'
  )
  assert.ok(parcelasOrgA.every((r) => r.ID_Organizacion === ORG_A))
})

test('fn_padron_socios_existentes: un ID_Socio real de la organización A no aparece como "existente" al consultar con p_organizacion=B', { skip }, async () => {
  const { data: sociosA, error: errA } = await supabase.rpc('fn_listar_padron_socios', { p_organizacion: ORG_A, p_page_size: 1 })
  if (errA) throw errA
  if (!sociosA?.length) return
  const socioId = sociosA[0].ID_Socio

  const { data, error } = await supabase.rpc('fn_padron_socios_existentes', {
    p_organizacion: ORG_B,
    p_id_socios: [socioId],
    p_dnis: [],
    p_codigos_finca: [],
  })
  if (error) throw error
  assert.deepEqual(data, [], `un ID_Socio real de ${ORG_A} no debe reportarse como existente al consultar ${ORG_B}`)
})

test('EXECUTE de fn_listar_padron_socios está revocado para anon (confirma el REVOKE/GRANT de la migración, no solo que la función existe)', { skip }, async () => {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anonKey) return
  const anonClient = createClient(SUPABASE_URL, anonKey)
  const { error } = await anonClient.rpc('fn_listar_padron_socios', { p_organizacion: ORG_A })
  assert.ok(error, 'la llave anon nunca debe poder ejecutar esta función')
  assert.equal(error.code, '42501', `se esperaba "permission denied" (42501), no "${error.code}"`)
})

// ════════════════════════════════════════════════════════════════════
// fn_exportar_padron_socios / fn_exportar_padron_parcelas -- restauran
// exportSociosCsv/exportParcelasCsv (lib/padronCsv.js), ver AI_STATE.md
// "Restaurar exportSociosCsv/exportParcelasCsv". Migración separada
// (20260901170000), probe/skip propios (exportMigrationApplied).
// ════════════════════════════════════════════════════════════════════

test('fn_exportar_padron_socios: A y B devuelven conjuntos de id disjuntos (aislamiento cruzado real)', { skip: skipExport }, async () => {
  const [{ data: rowsA, error: errA }, { data: rowsB, error: errB }] = await Promise.all([
    supabase.rpc('fn_exportar_padron_socios', { p_organizacion: ORG_A }),
    supabase.rpc('fn_exportar_padron_socios', { p_organizacion: ORG_B }),
  ])
  if (errA) throw errA
  if (errB) throw errB
  assert.ok(rowsA.length > 0, `se esperaban filas reales para ${ORG_A}`)
  assert.ok(
    rowsA.every((r) => r.ID_Organizacion === ORG_A),
    `ninguna fila debe pertenecer a otra organización que no sea ${ORG_A}`
  )
  const idsA = new Set(rowsA.map((r) => r.id))
  const idsB = new Set(rowsB.map((r) => r.id))
  const interseccion = [...idsA].filter((id) => idsB.has(id))
  assert.deepEqual(interseccion, [], 'id de la organización A no debe aparecer en el resultado de B, ni viceversa')
})

test('fn_exportar_padron_socios: p_organizacion inexistente devuelve vacío, no un error ni "todo"', { skip: skipExport }, async () => {
  const { data, error } = await supabase.rpc('fn_exportar_padron_socios', { p_organizacion: '__ORG_QUE_NO_EXISTE__' })
  if (error) throw error
  assert.deepEqual(data, [])
})

test('EXECUTE de fn_exportar_padron_socios está revocado para anon', { skip: skipExport }, async () => {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anonKey) return
  const anonClient = createClient(SUPABASE_URL, anonKey)
  const { error } = await anonClient.rpc('fn_exportar_padron_socios', { p_organizacion: ORG_A })
  assert.ok(error, 'la llave anon nunca debe poder ejecutar esta función')
  assert.equal(error.code, '42501', `se esperaba "permission denied" (42501), no "${error.code}"`)
})

test('fn_exportar_padron_parcelas: A y B devuelven conjuntos de ID_Parcela_Fija disjuntos (aislamiento cruzado real)', { skip: skipExport }, async () => {
  const [{ data: rowsA, error: errA }, { data: rowsB, error: errB }] = await Promise.all([
    supabase.rpc('fn_exportar_padron_parcelas', { p_organizacion: ORG_A }),
    supabase.rpc('fn_exportar_padron_parcelas', { p_organizacion: ORG_B }),
  ])
  if (errA) throw errA
  if (errB) throw errB
  assert.ok(
    rowsA.every((r) => r.ID_Organizacion === ORG_A),
    `ninguna fila debe pertenecer a otra organización que no sea ${ORG_A}`
  )
  const idsA = new Set(rowsA.map((r) => r.ID_Parcela_Fija))
  const idsB = new Set(rowsB.map((r) => r.ID_Parcela_Fija))
  const interseccion = [...idsA].filter((id) => idsB.has(id))
  assert.deepEqual(interseccion, [], 'ID_Parcela_Fija de la organización A no debe aparecer en el resultado de B, ni viceversa')
})

test('fn_exportar_padron_parcelas: p_organizacion inexistente devuelve vacío, no un error ni "todo"', { skip: skipExport }, async () => {
  const { data, error } = await supabase.rpc('fn_exportar_padron_parcelas', { p_organizacion: '__ORG_QUE_NO_EXISTE__' })
  if (error) throw error
  assert.deepEqual(data, [])
})

test('EXECUTE de fn_exportar_padron_parcelas está revocado para anon', { skip: skipExport }, async () => {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anonKey) return
  const anonClient = createClient(SUPABASE_URL, anonKey)
  const { error } = await anonClient.rpc('fn_exportar_padron_parcelas', { p_organizacion: ORG_A })
  assert.ok(error, 'la llave anon nunca debe poder ejecutar esta función')
  assert.equal(error.code, '42501', `se esperaba "permission denied" (42501), no "${error.code}"`)
})
