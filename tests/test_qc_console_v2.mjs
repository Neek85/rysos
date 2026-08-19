// Pruebas de las 2 funciones nuevas de la Consola QC 2.0
// (updateRecordAttributes/updateRecordGeometry, lib/eudrQcActions.js) — ver
// specs/gis_qc_console_v2.md. Mock idéntico al de test_eudr_qc_actions.mjs
// (duplicado a propósito, mismo criterio que el resto de los tests .mjs del
// proyecto: cada archivo es autocontenido).
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
        in(col, vals) {
          rows = rows.filter((r) => vals.includes(r[col]))
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
// updateRecordAttributes
// ---------------------------------------------------------------

test('EDITABLE_FIELDS no incluye parcela_codigo/descripcion (no existen en las tablas EUDR_*)', () => {
  const allKeys = Object.values(EDITABLE_FIELDS).flat().map((f) => f.key)
  assert.ok(!allKeys.includes('parcela_codigo'))
  assert.ok(!allKeys.includes('descripcion'))
})

test('updateRecordAttributes persiste el campo editable real en el store (verificado releyendo)', async () => {
  const tableData = {
    EUDR_MONITOREO: [
      { id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE, observaciones: '' },
    ],
  }
  const supabase = makeFakeSupabase(tableData)
  await updateRecordAttributes(supabase, baseRecord(), { observaciones: 'Corregido' }, 'COOP-JS')

  const rows = await supabase.from('EUDR_MONITOREO').select()
  assert.equal(rows.data[0].observaciones, 'Corregido')
})

test('updateRecordAttributes ignora un campo fuera de EDITABLE_FIELDS aunque venga en el payload del cliente', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [
      { id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE, observaciones: '' },
    ],
  })
  await updateRecordAttributes(
    supabase,
    baseRecord(),
    { observaciones: 'OK', ID_Organizacion: 'OTRA-COOP', estado_revision: 'APROBADO' },
    'COOP-JS'
  )
  const rows = await supabase.from('EUDR_MONITOREO').select()
  // ID_Organizacion/estado_revision del payload del cliente nunca se escriben.
  assert.equal(rows.data[0].ID_Organizacion, 'COOP-JS')
  assert.equal(rows.data[0].estado_revision, PENDING_STATE)
})

test('updateRecordAttributes lanza EUDRQcError si el payload no tiene ningún campo editable', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }],
  })
  await assert.rejects(
    () => updateRecordAttributes(supabase, baseRecord(), { columna_inexistente: 'x' }, 'COOP-JS'),
    EUDRQcError
  )
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

test('updateRecordAttributes rechaza si el registro no pertenece a la organización activa (multi-tenant)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'OTRA-COOP', estado_revision: PENDING_STATE }],
  })
  const record = baseRecord({ ID_Organizacion: 'OTRA-COOP' })
  await assert.rejects(
    () => updateRecordAttributes(supabase, record, { observaciones: 'x' }, 'COOP-JS'),
    EUDRQcError
  )
})

test('updateRecordAttributes usa id_origen (no registro_id) para EUDR_USO_SUELO, igual que approveRecord', async () => {
  const supabase = makeFakeSupabase({
    EUDR_USO_SUELO: [{ id: 13, ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE, tipo_uso: 'CULTIVO' }],
  })
  const record = baseRecord({ tabla_origen: 'EUDR_USO_SUELO', id_origen: 13 })
  await updateRecordAttributes(supabase, record, { tipo_uso: 'PASTIZAL' }, 'COOP-JS')
  const rows = await supabase.from('EUDR_USO_SUELO').select()
  assert.equal(rows.data[0].tipo_uso, 'PASTIZAL')
})

// ---------------------------------------------------------------
// updateRecordGeometry
// ---------------------------------------------------------------

test('GEOM_COLUMN usa geom_inspeccion para EUDR_MONITOREO y geom para las otras dos tablas', () => {
  assert.equal(GEOM_COLUMN.EUDR_MONITOREO, 'geom_inspeccion')
  assert.equal(GEOM_COLUMN.EUDR_USO_SUELO, 'geom')
  assert.equal(GEOM_COLUMN.EUDR_INSTALACIONES, 'geom')
})

test('updateRecordGeometry escribe WKT en geom_inspeccion para EUDR_MONITOREO', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }],
  })
  const geometry = { type: 'Point', coordinates: [-77.5, -6.5] }
  await updateRecordGeometry(supabase, baseRecord(), geometry, 'COOP-JS')
  const rows = await supabase.from('EUDR_MONITOREO').select()
  assert.equal(rows.data[0].geom_inspeccion, 'POINT(-77.5 -6.5)')
  assert.equal(rows.data[0].geom, undefined) // nunca escribe en la columna equivocada
})

test('updateRecordGeometry escribe WKT en geom (no geom_inspeccion) para EUDR_USO_SUELO', async () => {
  const supabase = makeFakeSupabase({
    EUDR_USO_SUELO: [{ id: 13, ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }],
  })
  const record = baseRecord({ tabla_origen: 'EUDR_USO_SUELO', id_origen: 13 })
  const geometry = {
    type: 'Polygon',
    coordinates: [
      [
        [-77.5, -6.5],
        [-77.5, -6.4],
        [-77.4, -6.4],
        [-77.5, -6.5],
      ],
    ],
  }
  await updateRecordGeometry(supabase, record, geometry, 'COOP-JS')
  const rows = await supabase.from('EUDR_USO_SUELO').select()
  assert.ok(rows.data[0].geom.startsWith('POLYGON('))
  assert.equal(rows.data[0].geom_inspeccion, undefined)
})

test('updateRecordGeometry lanza EUDRQcError con geometría null/vacía, sin intentar el UPDATE', async () => {
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

test('updateRecordGeometry rechaza si el registro no pertenece a la organización activa (multi-tenant)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'OTRA-COOP', estado_revision: PENDING_STATE }],
  })
  const record = baseRecord({ ID_Organizacion: 'OTRA-COOP' })
  const geometry = { type: 'Point', coordinates: [-77.5, -6.5] }
  await assert.rejects(() => updateRecordGeometry(supabase, record, geometry, 'COOP-JS'), EUDRQcError)
})

test('updateRecordGeometry rechaza un registro EUDR_INSTALACIONES sin id_origen con el mismo mensaje de gap que approveRecord', async () => {
  const supabase = makeFakeSupabase({
    EUDR_INSTALACIONES: [{ id: 4, ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }],
  })
  const record = baseRecord({ tabla_origen: 'EUDR_INSTALACIONES', id_origen: undefined })
  const geometry = { type: 'Point', coordinates: [-77.5, -6.5] }
  await assert.rejects(
    () => updateRecordGeometry(supabase, record, geometry, 'COOP-JS'),
    (err) => err instanceof EUDRQcError && err.message.includes('20260819_fix_vw_monitoreo_puntos_id_origen.sql')
  )
})
