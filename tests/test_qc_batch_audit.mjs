// Pruebas de la validación en lote (QcTable.jsx) y la traza de auditoría
// de decisiones (app/api/qc/audit-log) — ver
// specs/qc_batch_audit_trail.md.
//
// Sin test de integración contra Supabase real: audit_logs (como
// qc_validation_audit_log/EUDR_COBERTURA_BOSCOSA_2020 antes) sigue sin
// aplicarse en la instancia real. Se cubre la lógica pura de
// lib/qcAuditLog.js (validación del request) y
// lib/qcTopologyValidation.js::filterBatchValidatableRecords (qué
// registros entran al lote) — mismo criterio de separación pura/efectos
// de lado ya usado en toda esta serie de tareas.
//
// Ejecutar con: node --test tests/test_qc_batch_audit.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAuditLogRequest, AUDIT_ACCIONES, AUDIT_TABLAS } from '../lib/qcAuditLog.js'
import { filterBatchValidatableRecords } from '../lib/qcTopologyValidation.js'

// ---------------------------------------------------------------
// validateAuditLogRequest
// ---------------------------------------------------------------

test('AUDIT_ACCIONES es APROBADO/RECHAZADO — nunca "OBSERVADO" (no existe ese estado, ver specs/gis_qc_console_v2.md)', () => {
  assert.deepEqual(AUDIT_ACCIONES.sort(), ['APROBADO', 'RECHAZADO'])
})

test('AUDIT_TABLAS cubre las 3 tablas EUDR_* (no solo EUDR_MONITOREO)', () => {
  assert.deepEqual(AUDIT_TABLAS.sort(), ['EUDR_INSTALACIONES', 'EUDR_MONITOREO', 'EUDR_USO_SUELO'])
})

test('validateAuditLogRequest acepta un payload completo y válido', () => {
  const result = validateAuditLogRequest({
    ID_Organizacion: 'COOP-JS',
    accion: 'APROBADO',
    tabla_origen: 'EUDR_MONITOREO',
    entidad_id: 'uuid-1',
    detalles: { es_valido: true },
  })
  assert.equal(result.valid, true)
  assert.deepEqual(result.payload, {
    ID_Organizacion: 'COOP-JS',
    accion: 'APROBADO',
    tabla_origen: 'EUDR_MONITOREO',
    entidad_id: 'uuid-1',
    detalles: { es_valido: true },
  })
})

test('validateAuditLogRequest acepta sin `detalles` (default a objeto vacío)', () => {
  const result = validateAuditLogRequest({
    ID_Organizacion: 'COOP-JS',
    accion: 'RECHAZADO',
    tabla_origen: 'EUDR_USO_SUELO',
    entidad_id: '13',
  })
  assert.equal(result.valid, true)
  assert.deepEqual(result.payload.detalles, {})
})

test('validateAuditLogRequest rechaza accion "OBSERVADO" (no existe)', () => {
  const result = validateAuditLogRequest({
    ID_Organizacion: 'COOP-JS',
    accion: 'OBSERVADO',
    tabla_origen: 'EUDR_MONITOREO',
    entidad_id: 'uuid-1',
  })
  assert.equal(result.valid, false)
})

test('validateAuditLogRequest rechaza sin ID_Organizacion', () => {
  const result = validateAuditLogRequest({
    accion: 'APROBADO',
    tabla_origen: 'EUDR_MONITOREO',
    entidad_id: 'uuid-1',
  })
  assert.equal(result.valid, false)
})

test('validateAuditLogRequest rechaza una tabla_origen desconocida', () => {
  const result = validateAuditLogRequest({
    ID_Organizacion: 'COOP-JS',
    accion: 'APROBADO',
    tabla_origen: 'PADRON_PARCELAS',
    entidad_id: 'uuid-1',
  })
  assert.equal(result.valid, false)
})

test('validateAuditLogRequest rechaza sin entidad_id', () => {
  const result = validateAuditLogRequest({
    ID_Organizacion: 'COOP-JS',
    accion: 'APROBADO',
    tabla_origen: 'EUDR_MONITOREO',
  })
  assert.equal(result.valid, false)
})

test('validateAuditLogRequest rechaza `detalles` que no sea un objeto plano (ej. un array)', () => {
  const result = validateAuditLogRequest({
    ID_Organizacion: 'COOP-JS',
    accion: 'APROBADO',
    tabla_origen: 'EUDR_MONITOREO',
    entidad_id: 'uuid-1',
    detalles: [1, 2, 3],
  })
  assert.equal(result.valid, false)
})

test('validateAuditLogRequest no lanza con body null/undefined', () => {
  assert.equal(validateAuditLogRequest(null).valid, false)
  assert.equal(validateAuditLogRequest(undefined).valid, false)
})

// ---------------------------------------------------------------
// filterBatchValidatableRecords — "Validar Todos PENDIENTES" (QcTable.jsx)
// ---------------------------------------------------------------

test('filterBatchValidatableRecords incluye EUDR_MONITOREO/EUDR_USO_SUELO', () => {
  const records = [
    { key: 'a', tabla_origen: 'EUDR_MONITOREO' },
    { key: 'b', tabla_origen: 'EUDR_USO_SUELO' },
  ]
  const eligible = filterBatchValidatableRecords(records)
  assert.equal(eligible.length, 2)
})

test('filterBatchValidatableRecords excluye EUDR_INSTALACIONES (el endpoint la rechaza igual, siempre puntual)', () => {
  const records = [
    { key: 'a', tabla_origen: 'EUDR_MONITOREO' },
    { key: 'b', tabla_origen: 'EUDR_INSTALACIONES' },
  ]
  const eligible = filterBatchValidatableRecords(records)
  assert.equal(eligible.length, 1)
  assert.equal(eligible[0].key, 'a')
})

test('filterBatchValidatableRecords devuelve [] con una lista vacía o null/undefined, sin lanzar', () => {
  assert.deepEqual(filterBatchValidatableRecords([]), [])
  assert.deepEqual(filterBatchValidatableRecords(null), [])
  assert.deepEqual(filterBatchValidatableRecords(undefined), [])
})
