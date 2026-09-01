// Aislamiento cruzado de lib/sociosSearch.js — hotfix 2026-08-25
// ("Multi-Tenant Estricto", docs/RYZOS_ORQUESTADOR_V3.1.md sección 5).
//
// Reescrito (2026-09-01, ver AI_STATE.md "Reemplazo SECURITY DEFINER
// para lecturas de PADRON_SOCIOS/PADRON_PARCELAS"): antes fetchSocios/
// fetchParcelasBySocio consultaban PADRON_SOCIOS/PADRON_PARCELAS directo
// con un cliente Supabase falso que replicaba el query builder
// encadenado (.from/.select/.eq/...). Ahora delegan a
// lib/actions/padronReadActions.js (Server Actions -> funciones SQL
// SECURITY DEFINER) -- el filtro real por organización vive DENTRO de
// esas funciones SQL, no en JS, así que ya no es algo que un test de
// Node pueda ejercitar directo sin una conexión real a Postgres. Este
// archivo ahora inyecta una función fake `listarPadronSocios`/
// `listarParcelasPorSocio` (mismo criterio que ya usa
// `resolveOrganizationIdFallback`) que simula el comportamiento
// ESPERADO de la función SQL real (filtra por organización) para seguir
// probando que fetchSocios/fetchParcelasBySocio pasan el parámetro
// correcto y nunca mezclan el resultado de dos organizaciones del lado
// de JS.
//
// La prueba de aislamiento CONTRA LA FUNCIÓN SQL REAL vive en
// tests/test_padron_read_functions_live.mjs (gateada por
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY + que la migración
// 20260901160000 ya esté aplicada -- se salta sola hasta entonces,
// mismo patrón que el resto de tests "Live" del repo).
//
// Ejecutar con: node --test tests/test_sociossearch_multitenant.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchSocios, fetchParcelasBySocio } from '../lib/sociosSearch.js'

const SOCIOS_FAKE = [
  { ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', activo: true, socio_nombre_completo: 'Socio Org A', total_count: 1 },
  { ID_Socio: 'ND-00001', ID_Organizacion: 'COOP-ND', activo: true, socio_nombre_completo: 'Socio Org B', total_count: 1 },
]

const PARCELAS_FAKE = [
  { ID_Parcela_Fija: 'P-A-1', ID_Organizacion: 'COOP-JS', ID_Socio: 'JS-00001', activo: true, parcela_codigo: 'A1' },
  { ID_Parcela_Fija: 'P-B-1', ID_Organizacion: 'COOP-ND', ID_Socio: 'JS-00001', activo: true, parcela_codigo: 'B1' },
]

/** Fake de fn_listar_padron_socios -- filtra por organización, igual que se espera de la función SQL real. */
function fakeListarPadronSocios(organizationId) {
  const rows = SOCIOS_FAKE.filter((r) => r.ID_Organizacion === organizationId)
  return Promise.resolve(rows)
}

/** Fake de fn_listar_padron_parcelas_por_socio -- filtra por organización + socio. */
function fakeListarParcelasPorSocio(organizationId, socioId) {
  const rows = PARCELAS_FAKE.filter((r) => r.ID_Organizacion === organizationId && r.ID_Socio === socioId)
  return Promise.resolve(rows)
}

test('fetchSocios: nunca devuelve un socio de otra organización (la función SQL filtra, fetchSocios no agrega ninguna fila propia)', async () => {
  const resolveOrganizationIdFallback = async () => 'COOP-JS'
  const { rows, organizationId } = await fetchSocios({
    resolveOrganizationIdFallback,
    listarPadronSocios: fakeListarPadronSocios,
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].ID_Organizacion, 'COOP-JS')
  assert.equal(organizationId, 'COOP-JS')
  assert.equal(rows[0].total_count, undefined, 'total_count debe despojarse de cada fila antes de devolverla (es un detalle interno de paginación)')
})

test('fetchSocios: sin organización resuelta (fallback devuelve null), devuelve rows: [] y organizationId: null sin llamar a listarPadronSocios', async () => {
  const resolveOrganizationIdFallback = async () => null
  let called = false
  const listarPadronSocios = async () => {
    called = true
    return []
  }
  const { rows, total, organizationId } = await fetchSocios({ resolveOrganizationIdFallback, listarPadronSocios })
  assert.deepEqual(rows, [])
  assert.equal(total, 0)
  assert.equal(organizationId, null)
  assert.equal(called, false, 'sin organización no hay ninguna razón para llamar a la función SQL')
})

// ---------------------------------------------------------------
// Ronda de robustez del importador contra ORG-TEST-DEMO (2026-09-01f,
// ver AI_STATE.md) -- organizationIdOverride TEMPORAL para poder apuntar
// /dashboard/socios a una organización de prueba distinta de la que el
// fallback normal resolvería.
// ---------------------------------------------------------------

test('fetchSocios: con organizationIdOverride, usa ese valor directo y NUNCA llama a resolveOrganizationIdFallback', async () => {
  let fallbackCalled = false
  const resolveOrganizationIdFallback = async () => {
    fallbackCalled = true
    return 'NO-DEBERIA-USARSE'
  }
  const { rows, organizationId } = await fetchSocios({
    resolveOrganizationIdFallback,
    organizationIdOverride: 'ORG-TEST-DEMO',
    listarPadronSocios: fakeListarPadronSocios,
  })
  assert.equal(organizationId, 'ORG-TEST-DEMO')
  assert.equal(fallbackCalled, false, 'con override no hace falta resolver nada')
  assert.deepEqual(rows, [], 'ORG-TEST-DEMO no tiene filas en el fake -- el override no debe traer filas de COOP-JS/COOP-ND')
})

test('fetchSocios: organizationIdOverride null/undefined preserva el comportamiento normal (usa el fallback)', async () => {
  const resolveOrganizationIdFallback = async () => 'COOP-JS'
  const { organizationId } = await fetchSocios({
    resolveOrganizationIdFallback,
    organizationIdOverride: null,
    listarPadronSocios: fakeListarPadronSocios,
  })
  assert.equal(organizationId, 'COOP-JS', 'sin override, sigue resolviendo por el fallback normal')
})

test('fetchParcelasBySocio: un ID_Socio que existe en DOS organizaciones (mismo código, distinto tenant) nunca mezcla las parcelas de la organización equivocada', async () => {
  const rowsOrgA = await fetchParcelasBySocio('JS-00001', 'COOP-JS', fakeListarParcelasPorSocio)
  const rowsOrgB = await fetchParcelasBySocio('JS-00001', 'COOP-ND', fakeListarParcelasPorSocio)

  assert.equal(rowsOrgA.length, 1)
  assert.equal(rowsOrgA[0].ID_Parcela_Fija, 'P-A-1')
  assert.equal(rowsOrgB.length, 1)
  assert.equal(rowsOrgB[0].ID_Parcela_Fija, 'P-B-1')

  const idsFromA = rowsOrgA.map((r) => r.ID_Parcela_Fija)
  const idsFromB = rowsOrgB.map((r) => r.ID_Parcela_Fija)
  assert.ok(
    idsFromA.every((id) => !idsFromB.includes(id)),
    'una llamada scoped a la Organización A no debe devolver ninguna parcela de la Organización B'
  )
})

test('fetchParcelasBySocio: sin organizationId, devuelve vacío sin llamar a la función SQL', async () => {
  let called = false
  const listarParcelasPorSocio = async () => {
    called = true
    return []
  }
  const rows = await fetchParcelasBySocio('JS-00001', undefined, listarParcelasPorSocio)
  assert.deepEqual(rows, [], 'sin organizationId no hay forma segura de scopear -- debe devolver vacío, no todo')
  assert.equal(called, false)
})
