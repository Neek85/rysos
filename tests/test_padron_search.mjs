// lib/padronSearch.js — autocompletado del formulario de Inspecciones (FED).
// ADR-016: excluye socios/parcelas dados de baja (activo=false) — antes de
// esta tarea, un socio/parcela ya inactivo seguía siendo seleccionable al
// crear una inspección NUEVA. Sin cobertura previa (archivo nuevo).
//
// Ejecutar con: node --test tests/test_padron_search.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchSocios, searchParcelas } from '../lib/padronSearch.js'

/**
 * Mock mínimo: registra cada `.eq(col, val)` encadenado para poder
 * verificar que `activo`/`true` está entre las condiciones aplicadas,
 * además de simular el filtrado real de la tabla en memoria.
 */
function makeFakeSupabase(tableData) {
  const store = tableData
  return {
    from(table) {
      let rows = (store[table] || []).slice()
      const applied = []
      const builder = {
        select() {
          return builder
        },
        eq(col, val) {
          applied.push([col, val])
          rows = rows.filter((r) => r[col] === val)
          return builder
        },
        or(expr) {
          // Simula ilike OR: cualquier campo mencionado que incluya el término.
          const term = expr.match(/%(.*?)%/)?.[1]?.toLowerCase() ?? ''
          const fields = [...expr.matchAll(/(\w+)\.ilike/g)].map((m) => m[1])
          rows = rows.filter((r) => fields.some((f) => (r[f] || '').toLowerCase().includes(term)))
          return builder
        },
        limit() {
          return builder
        },
        then(resolve, reject) {
          Promise.resolve({ data: rows, error: null, _applied: applied }).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

const SOCIOS_FIXTURE = [
  { ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', socio_nombre_completo: 'Juan Perez', socio_dni: '11111111', codigo_finca: 'F-1', activo: true },
  { ID_Socio: 'JS-00002', ID_Organizacion: 'COOP-JS', socio_nombre_completo: 'Juana Perez Baja', socio_dni: '22222222', codigo_finca: 'F-2', activo: false },
]

const PARCELAS_FIXTURE = [
  { ID_Parcela_Fija: 'COOP-JS-001', ID_Organizacion: 'COOP-JS', ID_Socio: 'JS-00001', parcela_codigo: 'P-01', parcela_nombre: 'Finca Alta', activo: true },
  { ID_Parcela_Fija: 'COOP-JS-002', ID_Organizacion: 'COOP-JS', ID_Socio: 'JS-00001', parcela_codigo: 'P-02', parcela_nombre: 'Finca Baja Dada de Baja', activo: false },
]

test('searchSocios excluye socios activo=false (ADR-016)', async () => {
  const supabase = makeFakeSupabase({ PADRON_SOCIOS: SOCIOS_FIXTURE })
  const result = await searchSocios(supabase, 'COOP-JS', 'Perez')
  assert.equal(result.length, 1)
  assert.equal(result[0].ID_Socio, 'JS-00001')
})

test('searchSocios no encuentra un socio inactivo aunque el término coincida exacto (verificación directa del gap real cerrado)', async () => {
  const supabase = makeFakeSupabase({ PADRON_SOCIOS: SOCIOS_FIXTURE })
  const result = await searchSocios(supabase, 'COOP-JS', 'Juana Perez Baja')
  assert.deepEqual(result, [])
})

test('searchParcelas excluye parcelas activo=false (ADR-016)', async () => {
  const supabase = makeFakeSupabase({ PADRON_PARCELAS: PARCELAS_FIXTURE })
  const result = await searchParcelas(supabase, 'COOP-JS', null, '')
  assert.equal(result.length, 1)
  assert.equal(result[0].ID_Parcela_Fija, 'COOP-JS-001')
})

test('searchParcelas no encuentra una parcela inactiva por código (verificación directa del gap real cerrado)', async () => {
  const supabase = makeFakeSupabase({ PADRON_PARCELAS: PARCELAS_FIXTURE })
  const result = await searchParcelas(supabase, 'COOP-JS', null, 'P-02')
  assert.deepEqual(result, [])
})

test('searchSocios/searchParcelas siguen aislando por organización (activo=true no reemplaza el filtro multi-tenant)', async () => {
  const fixture = [
    ...SOCIOS_FIXTURE,
    { ID_Socio: 'OTRA-001', ID_Organizacion: 'OTRA-COOP', socio_nombre_completo: 'Juan Perez Otra Coop', socio_dni: '33333333', codigo_finca: 'F-3', activo: true },
  ]
  const supabase = makeFakeSupabase({ PADRON_SOCIOS: fixture })
  const result = await searchSocios(supabase, 'COOP-JS', 'Perez')
  assert.equal(result.length, 1)
  assert.equal(result[0].ID_Organizacion, 'COOP-JS')
})
