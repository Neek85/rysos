// Aislamiento cruzado de lib/sociosSearch.js — hotfix 2026-08-25
// ("Multi-Tenant Estricto", docs/RYZOS_ORQUESTADOR_V3.1.md sección 5).
//
// A diferencia del resto de tests/*.mjs de este repo (que solo verifican
// texto/estructura de archivos), acá se llama a las funciones EXPORTADAS
// reales (fetchSocios/fetchParcelasBySocio) contra un cliente Supabase
// falso -- no una consulta de solo-lectura contra un objeto estático, sino
// el mismo objeto `supabase` que la app inyecta, con un query builder
// mínimo que replica el subconjunto real de la API encadenada
// (.from/.select/.eq/.order/.range/.limit, awaitable como el real
// PostgrestFilterBuilder) y filtra filas fake exactamente como lo haría
// Postgres+RLS. Esto prueba el comportamiento real de aislamiento, no solo
// que el texto fuente contenga ".eq('ID_Organizacion', ...)" en algún lado.
//
// Ejecutar con: node --test tests/test_sociossearch_multitenant.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchSocios, fetchParcelasBySocio } from '../lib/sociosSearch.js'

/**
 * Cliente Supabase falso mínimo: cada tabla es un array de filas. Soporta
 * el subconjunto de la API encadenada que sociosSearch.js realmente usa.
 * El objeto builder es "thenable" (implementa .then), igual que el
 * PostgrestFilterBuilder real de supabase-js, así que `await` funciona
 * exactamente igual que contra un cliente real.
 */
function createFakeSupabase(tables) {
  return {
    from(table) {
      const state = { table, eqFilters: [], orFilter: null, limit: null, range: null, withCount: false }
      const builder = {
        select(_cols, opts) {
          state.withCount = opts?.count === 'exact'
          return builder
        },
        eq(col, val) {
          state.eqFilters.push([col, val])
          return builder
        },
        or() {
          // No usado por los tests de este archivo -- basta con no romper la cadena.
          return builder
        },
        order() {
          return builder
        },
        range(from, to) {
          state.range = [from, to]
          return builder
        },
        limit(n) {
          state.limit = n
          return builder
        },
        then(resolve) {
          let rows = (tables[state.table] ?? []).filter((row) =>
            state.eqFilters.every(([col, val]) => row[col] === val)
          )
          const count = rows.length
          if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1)
          if (state.limit != null) rows = rows.slice(0, state.limit)
          resolve({ data: rows, error: null, count: state.withCount ? count : null })
        },
      }
      return builder
    },
  }
}

const SOCIOS_FAKE = [
  { ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', activo: true, socio_nombre_completo: 'Socio Org A' },
  { ID_Socio: 'ND-00001', ID_Organizacion: 'COOP-ND', activo: true, socio_nombre_completo: 'Socio Org B' },
]

const PARCELAS_FAKE = [
  { ID_Parcela_Fija: 'P-A-1', ID_Organizacion: 'COOP-JS', ID_Socio: 'JS-00001', activo: true, parcela_codigo: 'A1' },
  { ID_Parcela_Fija: 'P-B-1', ID_Organizacion: 'COOP-ND', ID_Socio: 'JS-00001', activo: true, parcela_codigo: 'B1' },
]

test('fetchSocios: nunca devuelve un socio de otra organización (probe + query ya scopeados)', async () => {
  const supabase = createFakeSupabase({ PADRON_SOCIOS: SOCIOS_FAKE })
  const { rows } = await fetchSocios(supabase, {})
  assert.equal(rows.length, 1, 'debe resolver una sola organización (la primera del probe) y traer solo sus filas')
  assert.equal(rows[0].ID_Organizacion, 'COOP-JS')
  assert.ok(
    rows.every((r) => r.ID_Organizacion === rows[0].ID_Organizacion),
    'ninguna fila de otra organización debe colarse en el resultado'
  )
})

test('fetchSocios: con 0 socios activos, devuelve vacío sin lanzar (probe sin resultados)', async () => {
  const supabase = createFakeSupabase({ PADRON_SOCIOS: [] })
  const { rows, total } = await fetchSocios(supabase, {})
  assert.deepEqual(rows, [])
  assert.equal(total, 0)
})

test('fetchParcelasBySocio: un ID_Socio que existe en DOS organizaciones (mismo código, distinto tenant tras la migración de PK) nunca mezcla las parcelas de la organización equivocada', async () => {
  const supabase = createFakeSupabase({ PADRON_PARCELAS: PARCELAS_FAKE })
  const rowsOrgA = await fetchParcelasBySocio(supabase, 'JS-00001', 'COOP-JS')
  const rowsOrgB = await fetchParcelasBySocio(supabase, 'JS-00001', 'COOP-ND')

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

test('fetchParcelasBySocio: sin organizationId, devuelve vacío en vez de traer todas las organizaciones', async () => {
  const supabase = createFakeSupabase({ PADRON_PARCELAS: PARCELAS_FAKE })
  const rows = await fetchParcelasBySocio(supabase, 'JS-00001', undefined)
  assert.deepEqual(rows, [], 'sin organizationId no hay forma segura de scopear -- debe devolver vacío, no todo')
})
