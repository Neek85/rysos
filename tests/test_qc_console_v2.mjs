// Pruebas de las funciones nuevas de la Consola QC 2.0
// (lib/eudrQcActions.js::updateRecordAttributes/updateRecordGeometry) — ver
// specs/gis_qc_console_v2.md. approveRecord/rejectRecord ya están cubiertas
// en tests/test_eudr_qc_actions.mjs, no se duplican acá.
//
// Mismo mock mínimo de Supabase que test_eudr_qc_actions.mjs (cada archivo
// .mjs de este proyecto es autocontenido, sin helpers compartidos).
//
// Ejecutar con: node --test tests/test_qc_console_v2.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  updateRecordAttributes,
  updateRecordGeometry,
  EUDRQcError,
  PENDING_STATE,
  EDITABLE_FIELDS,
  GEOM_COLUMN,
} from '../lib/eudrQcActions.js'

function makeFakeSupabase(tableData) {
  const store = Object.fromEntries(Object.entries(tableData).map(([k, v]) => [k, v.slice()]))
  return {
    from(table) {
      let rows = (store[table] || []).slice()
      let pendingUpdate = null
      const builder = {
        select() {
          return builder
        },
        eq(col, val) {
          rows = rows.filter((r) => r[col] === val)
          return builder
        },
        update(payload) {
          pendingUpdate = payload
          return builder
        },
        match(cond) {
          rows = rows.filter((r) => Object.entries(cond).every(([k, v]) => r[k] === v))
          if (pendingUpdate) {
            rows.forEach((r) => Object.assign(r, pendingUpdate))
            const real = store[table] || []
            rows.forEach((updated) => {
              const idx = real.findIndex((r) => r === updated)
              if (idx >= 0) real[idx] = updated
            })
          }
          return builder
        },
        then(resolve, reject) {
          Promise.resolve({ data: rows, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

function baseRecord(overrides = {}) {
  return {
    tabla_origen: 'EUDR_MONITOREO',
    id_monitoreo: 'uuid-1',
    id_origen: 'uuid-1',
    ID_Organizacion: 'COOP-JS',
    estado_revision: PENDING_STATE,
    observaciones: '',
    ...overrides,
  }
}

// ---------------------------------------------------------------
// EDITABLE_FIELDS / GEOM_COLUMN — regla de negocio real (corrige premisas
// falsas del prompt: "parcela_codigo"/"descripcion" no existen)
// ---------------------------------------------------------------

test('EDITABLE_FIELDS nunca incluye ID_Organizacion, estado_revision, ni "parcela_codigo"/"descripcion" inventados', () => {
  const allKeys = Object.values(EDITABLE_FIELDS).flatMap((fields) => fields.map((f) => f.key))
  assert.ok(!allKeys.includes('ID_Organizacion'))
  assert.ok(!allKeys.includes('estado_revision'))
  assert.ok(!allKeys.includes('parcela_codigo'))
  assert.ok(!allKeys.includes('descripcion'))
})

test('EDITABLE_FIELDS.EUDR_MONITOREO incluye observaciones (único campo de texto libre real)', () => {
  const keys = EDITABLE_FIELDS.EUDR_MONITOREO.map((f) => f.key)
  assert.deepEqual(keys.sort(), ['ID_Parcela_Fija', 'ID_Socio', 'observaciones'].sort())
})

test('GEOM_COLUMN usa geom_inspeccion para EUDR_MONITOREO y geom para las otras 2 tablas', () => {
  assert.equal(GEOM_COLUMN.EUDR_MONITOREO, 'geom_inspeccion')
  assert.equal(GEOM_COLUMN.EUDR_USO_SUELO, 'geom')
  assert.equal(GEOM_COLUMN.EUDR_INSTALACIONES, 'geom')
})

// ---------------------------------------------------------------
// updateRecordAttributes
// ---------------------------------------------------------------

test('updateRecordAttributes actualiza solo los campos whitelisted (ignora un campo fuera de EDITABLE_FIELDS)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE, observaciones: '' }],
  })
  await updateRecordAttributes(
    supabase,
    baseRecord(),
    { observaciones: 'Nota corregida', ID_Organizacion: 'OTRA-ORG-INTENTO-INYECCION', estado_revision: 'APROBADO' },
    'COOP-JS'
  )
  const row = (await supabase.from('EUDR_MONITOREO').select()).data[0]
  assert.equal(row.observaciones, 'Nota corregida')
  assert.equal(row.ID_Organizacion, 'COOP-JS') // no se pisó con el intento de inyección
  assert.equal(row.estado_revision, PENDING_STATE) // no se pisó con el intento de inyección
})

test('updateRecordAttributes actualiza id_parcela/tipo_uso para EUDR_USO_SUELO', async () => {
  const supabase = makeFakeSupabase({
    EUDR_USO_SUELO: [{ id: 13, ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE, id_parcela: 'OLD', tipo_uso: 'OLD' }],
  })
  const record = baseRecord({ tabla_origen: 'EUDR_USO_SUELO', id_origen: 13 })
  await updateRecordAttributes(supabase, record, { id_parcela: 'COOP-JS-002', tipo_uso: 'Café' }, 'COOP-JS')
  const row = (await supabase.from('EUDR_USO_SUELO').select()).data[0]
  assert.equal(row.id_parcela, 'COOP-JS-002')
  assert.equal(row.tipo_uso, 'Café')
})

test('updateRecordAttributes lanza EUDRQcError si el registro ya no está PENDIENTE', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: 'APROBADO' }],
  })
  await assert.rejects(
    () => updateRecordAttributes(supabase, baseRecord(), { observaciones: 'x' }, 'COOP-JS'),
    EUDRQcError
  )
})

test('updateRecordAttributes rechaza si el registro no pertenece a la organización activa', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'OTRA-COOP', estado_revision: PENDING_STATE }],
  })
  const record = baseRecord({ ID_Organizacion: 'OTRA-COOP' })
  await assert.rejects(() => updateRecordAttributes(supabase, record, { observaciones: 'x' }, 'COOP-JS'), EUDRQcError)
})

test('updateRecordAttributes lanza si no hay ningún campo válido en el payload', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }],
  })
  await assert.rejects(
    () => updateRecordAttributes(supabase, baseRecord(), { campo_inexistente: 'x' }, 'COOP-JS'),
    EUDRQcError
  )
})

// ---------------------------------------------------------------
// updateRecordGeometry
// ---------------------------------------------------------------

test('updateRecordGeometry convierte GeoJSON a WKT y escribe en geom_inspeccion para EUDR_MONITOREO', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE, geom_inspeccion: null }],
  })
  const geometry = { type: 'Point', coordinates: [-77.5, -6.5] }
  await updateRecordGeometry(supabase, baseRecord(), geometry, 'COOP-JS')
  const row = (await supabase.from('EUDR_MONITOREO').select()).data[0]
  assert.equal(row.geom_inspeccion, 'POINT(-77.5 -6.5)')
})

test('updateRecordGeometry escribe en geom (no geom_inspeccion) para EUDR_USO_SUELO', async () => {
  const supabase = makeFakeSupabase({
    EUDR_USO_SUELO: [{ id: 13, ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE, geom: null }],
  })
  const record = baseRecord({ tabla_origen: 'EUDR_USO_SUELO', id_origen: 13 })
  const geometry = {
    type: 'Polygon',
    coordinates: [[[-77.5, -6.5], [-77.4, -6.5], [-77.4, -6.4], [-77.5, -6.5]]],
  }
  await updateRecordGeometry(supabase, record, geometry, 'COOP-JS')
  const row = (await supabase.from('EUDR_USO_SUELO').select()).data[0]
  assert.equal(row.geom, 'POLYGON((-77.5 -6.5, -77.4 -6.5, -77.4 -6.4, -77.5 -6.5))')
})

test('updateRecordGeometry lanza EUDRQcError con geometría nula', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }],
  })
  await assert.rejects(() => updateRecordGeometry(supabase, baseRecord(), null, 'COOP-JS'), EUDRQcError)
})

test('updateRecordGeometry lanza EUDRQcError si el registro ya no está PENDIENTE', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: 'RECHAZADO' }],
  })
  const geometry = { type: 'Point', coordinates: [-77.5, -6.5] }
  await assert.rejects(() => updateRecordGeometry(supabase, baseRecord(), geometry, 'COOP-JS'), EUDRQcError)
})

test('updateRecordGeometry rechaza sin id_origen (no intenta el UPDATE) — ver ADR-015: no es un gap de migración, es defensa en profundidad', async () => {
  const supabase = makeFakeSupabase({ EUDR_INSTALACIONES: [{ id: 4, ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }] })
  const record = baseRecord({ tabla_origen: 'EUDR_INSTALACIONES', id_origen: undefined })
  const geometry = { type: 'Point', coordinates: [-77.5, -6.5] }
  await assert.rejects(
    () => updateRecordGeometry(supabase, record, geometry, 'COOP-JS'),
    (err) => err instanceof EUDRQcError && err.message.includes('id_origen ausente')
  )
})
