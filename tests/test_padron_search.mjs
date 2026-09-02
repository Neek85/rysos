// lib/padronSearch.js — autocompletado del formulario de Inspecciones (FED)
// y del editor vectorial de la Consola QC.
//
// Reescrito (2026-09-01, ver AI_STATE.md "Reemplazo SECURITY DEFINER
// para lecturas de PADRON_SOCIOS/PADRON_PARCELAS"): searchSocios/
// searchParcelas ya no consultan PADRON_SOCIOS/PADRON_PARCELAS directo
// con un cliente Supabase falso -- delegan a
// lib/actions/padronReadActions.js (Server Actions -> funciones SQL
// SECURITY DEFINER fn_buscar_padron_socios/fn_buscar_padron_parcelas).
// El filtro real (activo=true, organización, ilike) vive DENTRO de esas
// funciones SQL -- ver tests/test_padron_read_functions_live.mjs para la
// prueba contra la función real (gateada, se salta hasta que la
// migración 20260901160000 esté aplicada). Acá se inyecta un fake que
// simula el comportamiento esperado, para seguir probando que
// searchSocios/searchParcelas pasan los parámetros correctos y no
// mezclan resultados del lado de JS.
//
// Ejecutar con: node --test tests/test_padron_search.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchSocios, searchParcelas } from '../lib/padronSearch.js'

const SOCIOS_FIXTURE = [
  { ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', socio_nombre_completo: 'Juan Perez', socio_dni: '11111111', codigo_finca: 'F-1', activo: true },
  { ID_Socio: 'JS-00002', ID_Organizacion: 'COOP-JS', socio_nombre_completo: 'Juana Perez Baja', socio_dni: '22222222', codigo_finca: 'F-2', activo: false },
  { ID_Socio: 'OTRA-001', ID_Organizacion: 'OTRA-COOP', socio_nombre_completo: 'Juan Perez Otra Coop', socio_dni: '33333333', codigo_finca: 'F-3', activo: true },
]

const PARCELAS_FIXTURE = [
  { ID_Parcela_Fija: 'COOP-JS-001', ID_Organizacion: 'COOP-JS', ID_Socio: 'JS-00001', parcela_codigo: 'P-01', parcela_nombre: 'Finca Alta', activo: true },
  { ID_Parcela_Fija: 'COOP-JS-002', ID_Organizacion: 'COOP-JS', ID_Socio: 'JS-00001', parcela_codigo: 'P-02', parcela_nombre: 'Finca Baja Dada de Baja', activo: false },
]

/** Fake de fn_buscar_padron_socios -- ADR-016 (excluye activo=false) + aislamiento por organización + ilike. */
function fakeBuscarPadronSocios(organizationId, query) {
  const term = query.toLowerCase()
  const rows = SOCIOS_FIXTURE.filter(
    (r) =>
      r.ID_Organizacion === organizationId &&
      r.activo === true &&
      (r.socio_nombre_completo.toLowerCase().includes(term) || r.socio_dni.includes(term) || r.codigo_finca.toLowerCase().includes(term))
  )
  return Promise.resolve(rows)
}

/** Fake de fn_buscar_padron_parcelas -- misma lógica, para PADRON_PARCELAS. */
function fakeBuscarPadronParcelas(organizationId, socioId, query) {
  const term = (query || '').toLowerCase()
  const rows = PARCELAS_FIXTURE.filter(
    (r) =>
      r.ID_Organizacion === organizationId &&
      r.activo === true &&
      (!socioId || r.ID_Socio === socioId) &&
      (!term || term.length < 2 || r.parcela_codigo.toLowerCase().includes(term) || r.parcela_nombre.toLowerCase().includes(term))
  )
  return Promise.resolve(rows)
}

test('searchSocios excluye socios activo=false (ADR-016)', async () => {
  const result = await searchSocios('COOP-JS', 'Perez', fakeBuscarPadronSocios)
  assert.equal(result.length, 1)
  assert.equal(result[0].ID_Socio, 'JS-00001')
})

test('searchSocios no encuentra un socio inactivo aunque el término coincida exacto', async () => {
  const result = await searchSocios('COOP-JS', 'Juana Perez Baja', fakeBuscarPadronSocios)
  assert.deepEqual(result, [])
})

test('searchSocios/searchParcelas siguen aislando por organización (activo=true no reemplaza el filtro multi-tenant)', async () => {
  const result = await searchSocios('COOP-JS', 'Perez', fakeBuscarPadronSocios)
  assert.equal(result.length, 1)
  assert.equal(result[0].ID_Organizacion, 'COOP-JS')
})

test('searchSocios: sin query o con menos de 2 caracteres, devuelve vacío sin llamar a la función SQL', async () => {
  let called = false
  const buscarPadronSocios = async () => {
    called = true
    return []
  }
  assert.deepEqual(await searchSocios('COOP-JS', '', buscarPadronSocios), [])
  assert.deepEqual(await searchSocios('COOP-JS', 'a', buscarPadronSocios), [])
  assert.equal(called, false)
})

test('searchSocios: sin organizationId, devuelve vacío sin llamar a la función SQL', async () => {
  let called = false
  const buscarPadronSocios = async () => {
    called = true
    return []
  }
  assert.deepEqual(await searchSocios(null, 'Perez', buscarPadronSocios), [])
  assert.equal(called, false)
})

test('searchParcelas excluye parcelas activo=false (ADR-016)', async () => {
  const result = await searchParcelas('COOP-JS', null, '', fakeBuscarPadronParcelas)
  assert.equal(result.length, 1)
  assert.equal(result[0].ID_Parcela_Fija, 'COOP-JS-001')
})

test('searchParcelas no encuentra una parcela inactiva por código', async () => {
  const result = await searchParcelas('COOP-JS', null, 'P-02', fakeBuscarPadronParcelas)
  assert.deepEqual(result, [])
})

test('searchParcelas: sin organizationId, devuelve vacío sin llamar a la función SQL', async () => {
  let called = false
  const buscarPadronParcelas = async () => {
    called = true
    return []
  }
  assert.deepEqual(await searchParcelas(null, null, '', buscarPadronParcelas), [])
  assert.equal(called, false)
})
