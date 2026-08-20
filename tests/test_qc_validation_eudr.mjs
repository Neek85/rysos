// Pruebas de lib/qcTopologyValidation.js — validación de request del
// endpoint POST /api/qc/validate-spatial (botón "Validar Topología & EUDR"
// en /dashboard/qc). Ver specs/qc_topological_eudr_validation.md.
//
// No prueba fn_validar_topologia_eudr (SQL/PostGIS, sin DB real en este
// entorno) ni el Route Handler completo (supabase.rpc real) — mismo
// criterio que el resto de los tests .mjs del proyecto: se separa la
// lógica pura para poder probarla sin infraestructura.
//
// Ejecutar con: node --test tests/test_qc_validation_eudr.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateTopologyRequest, TOPOLOGY_VALIDATABLE_TABLES } from '../lib/qcTopologyValidation.js'

test('TOPOLOGY_VALIDATABLE_TABLES incluye EUDR_MONITOREO y EUDR_USO_SUELO, nunca EUDR_INSTALACIONES', () => {
  assert.deepEqual(TOPOLOGY_VALIDATABLE_TABLES.sort(), ['EUDR_MONITOREO', 'EUDR_USO_SUELO'])
})

test('validateTopologyRequest acepta EUDR_MONITOREO con registro_id', () => {
  const result = validateTopologyRequest({ tabla_origen: 'EUDR_MONITOREO', registro_id: 'uuid-1' })
  assert.deepEqual(result, { valid: true, tablaOrigen: 'EUDR_MONITOREO', registroId: 'uuid-1' })
})

test('validateTopologyRequest acepta EUDR_USO_SUELO con registro_id', () => {
  const result = validateTopologyRequest({ tabla_origen: 'EUDR_USO_SUELO', registro_id: '13' })
  assert.equal(result.valid, true)
})

test('validateTopologyRequest rechaza EUDR_INSTALACIONES (siempre puntual, sin topología de área)', () => {
  const result = validateTopologyRequest({ tabla_origen: 'EUDR_INSTALACIONES', registro_id: '4' })
  assert.equal(result.valid, false)
  assert.match(result.error, /EUDR_INSTALACIONES/)
})

test('validateTopologyRequest rechaza una tabla desconocida', () => {
  const result = validateTopologyRequest({ tabla_origen: 'PADRON_PARCELAS', registro_id: '1' })
  assert.equal(result.valid, false)
})

test('validateTopologyRequest rechaza si falta registro_id', () => {
  const result = validateTopologyRequest({ tabla_origen: 'EUDR_MONITOREO' })
  assert.equal(result.valid, false)
})

test('validateTopologyRequest rechaza un registro_id vacío', () => {
  const result = validateTopologyRequest({ tabla_origen: 'EUDR_MONITOREO', registro_id: '' })
  assert.equal(result.valid, false)
})

test('validateTopologyRequest no lanza con body null/undefined', () => {
  assert.equal(validateTopologyRequest(null).valid, false)
  assert.equal(validateTopologyRequest(undefined).valid, false)
})
