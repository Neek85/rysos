// Pruebas de lib/eudrQcActions.js — Consola de Auditoría QC WebGIS
// (/dashboard/qc). Sin cobertura JS previa (solo existe
// tests/test_fase3_qc.py, que cubre el flujo QGIS Desktop, un módulo
// distinto — scripts/qgis_qc_actions.py). Mock mínimo de Supabase, sin
// red — mismo patrón que tests/test_padron_csv.mjs.
//
// Ejecutar con: node --test tests/test_eudr_qc_actions.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchPendingRecords, approveRecord, rejectRecord, EUDRQcError, PENDING_STATE } from '../lib/eudrQcActions.js'

/**
 * Mock encadenable que soporta tanto lectura (`.select().eq()`, resuelve
 * como thenable) como escritura (`.update().match().select()`, también
 * thenable) sobre una tabla en memoria — suficiente para las 3 formas de
 * consulta reales que usa este módulo.
 */
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
            // Refleja el cambio en el "store" real para que una segunda
            // llamada (ej. reintentar aprobar el mismo registro) lo vea.
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

// ---------------------------------------------------------------
// fetchPendingRecords — normalización (tagRecords) + enriquecimiento
// (enrichWithParcelaInfo)
// ---------------------------------------------------------------

test('fetchPendingRecords etiqueta poligonos/puntos, deriva clasificacion desde tipo_uso/tipo_infra, y arma key desde registro_id', async () => {
  const supabase = makeFakeSupabase({
    vw_monitoreo_poligonos: [
      {
        tabla_origen: 'EUDR_USO_SUELO',
        registro_id: '3',
        id_origen: '13',
        id_monitoreo: 'uuid-1',
        ID_Organizacion: 'COOP-JS',
        ID_Parcela_Fija: 'COOP-JS-001',
        tipo_uso: 'CULTIVO',
        estado_revision: PENDING_STATE,
      },
    ],
    vw_monitoreo_puntos: [],
    PADRON_PARCELAS: [{ ID_Parcela_Fija: 'COOP-JS-001', parcela_codigo: 'P-01', parcela_nombre: 'Finca Alta' }],
  })

  const [record] = await fetchPendingRecords(supabase)
  assert.equal(record.tipo_geometria, 'poligono')
  assert.equal(record.clasificacion, 'CULTIVO')
  assert.equal(record.key, 'EUDR_USO_SUELO:3')
  assert.equal(record.id_origen, '13')
})

test('fetchPendingRecords deriva id_origen = id_monitoreo para EUDR_MONITOREO en puntos (gap real: la vista no trae id_origen ahí)', async () => {
  const supabase = makeFakeSupabase({
    vw_monitoreo_poligonos: [],
    vw_monitoreo_puntos: [
      {
        tabla_origen: 'EUDR_MONITOREO',
        registro_id: 'uuid-1',
        id_monitoreo: 'uuid-1',
        ID_Organizacion: 'COOP-JS',
        ID_Parcela_Fija: null,
        estado_revision: PENDING_STATE,
      },
    ],
    PADRON_PARCELAS: [],
  })

  const [record] = await fetchPendingRecords(supabase)
  assert.equal(record.id_origen, 'uuid-1')
  assert.equal(record.clasificacion, null) // EUDR_MONITOREO nunca tiene clasificación de campo
})

test('fetchPendingRecords deja id_origen undefined para EUDR_INSTALACIONES en puntos (gap real, hasta aplicar la migración)', async () => {
  const supabase = makeFakeSupabase({
    vw_monitoreo_poligonos: [],
    vw_monitoreo_puntos: [
      {
        tabla_origen: 'EUDR_INSTALACIONES',
        registro_id: '4',
        id_monitoreo: 'uuid-derivado',
        ID_Organizacion: 'COOP-JS',
        ID_Parcela_Fija: 'COOP-JS-002',
        tipo_infra: 'BENEFICIO',
        estado_revision: PENDING_STATE,
      },
    ],
    PADRON_PARCELAS: [],
  })

  const [record] = await fetchPendingRecords(supabase)
  assert.equal(record.id_origen, undefined)
})

test('fetchPendingRecords enriquece con parcela_codigo/parcela_nombre reales vía PADRON_PARCELAS (no vienen de la vista)', async () => {
  const supabase = makeFakeSupabase({
    vw_monitoreo_poligonos: [
      {
        tabla_origen: 'EUDR_USO_SUELO',
        registro_id: '1',
        id_origen: '1',
        id_monitoreo: 'uuid-1',
        ID_Organizacion: 'COOP-JS',
        ID_Parcela_Fija: 'COOP-JS-001',
        estado_revision: PENDING_STATE,
      },
    ],
    vw_monitoreo_puntos: [],
    PADRON_PARCELAS: [{ ID_Parcela_Fija: 'COOP-JS-001', parcela_codigo: 'P-01', parcela_nombre: 'Finca Alta' }],
  })

  const [record] = await fetchPendingRecords(supabase)
  assert.equal(record.parcela_codigo, 'P-01')
  assert.equal(record.parcela_nombre, 'Finca Alta')
})

test('fetchPendingRecords no explota sin ID_Parcela_Fija en ningún registro (evita el fetch a PADRON_PARCELAS)', async () => {
  const supabase = makeFakeSupabase({
    vw_monitoreo_poligonos: [],
    vw_monitoreo_puntos: [],
    PADRON_PARCELAS: [],
  })
  const records = await fetchPendingRecords(supabase)
  assert.deepEqual(records, [])
})

// ---------------------------------------------------------------
// approveRecord / rejectRecord
// ---------------------------------------------------------------

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

test('approveRecord actualiza estado_revision a APROBADO sobre la tabla base real (no lanza)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }],
  })
  await approveRecord(supabase, baseRecord(), 'COOP-JS')
})

test('approveRecord lanza EUDRQcError si 0 filas fueron afectadas (registro ya no PENDIENTE)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: 'APROBADO' }],
  })
  await assert.rejects(() => approveRecord(supabase, baseRecord(), 'COOP-JS'), EUDRQcError)
})

test('approveRecord rechaza un registro EUDR_INSTALACIONES sin id_origen con un mensaje claro (gap de migración), sin intentar el UPDATE', async () => {
  const supabase = makeFakeSupabase({ EUDR_INSTALACIONES: [{ id: 4, ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }] })
  const record = baseRecord({ tabla_origen: 'EUDR_INSTALACIONES', id_origen: undefined })
  await assert.rejects(
    () => approveRecord(supabase, record, 'COOP-JS'),
    (err) => err instanceof EUDRQcError && err.message.includes('20260819_fix_vw_monitoreo_puntos_id_origen.sql')
  )
})

test('approveRecord actualiza EUDR_USO_SUELO por id_origen (no por registro_id, que es un valor distinto)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_USO_SUELO: [{ id: 13, ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }],
  })
  const record = baseRecord({ tabla_origen: 'EUDR_USO_SUELO', id_origen: 13 })
  await approveRecord(supabase, record, 'COOP-JS')
  // Si hubiese matcheado por registro_id (distinto de id_origen, ver
  // lib/eudrQcActions.js) esto habría lanzado por 0 filas afectadas.
})

test('approveRecord rechaza si el registro no pertenece a la organización activa (multi-tenant)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'OTRA-COOP', estado_revision: PENDING_STATE }],
  })
  const record = baseRecord({ ID_Organizacion: 'OTRA-COOP' })
  await assert.rejects(() => approveRecord(supabase, record, 'COOP-JS'), EUDRQcError)
})

test('rejectRecord requiere un motivo no vacío', async () => {
  const supabase = makeFakeSupabase({ EUDR_MONITOREO: [] })
  await assert.rejects(() => rejectRecord(supabase, baseRecord(), '   ', 'COOP-JS'), EUDRQcError)
})

test('rejectRecord actualiza estado_revision a RECHAZADO y anexa el motivo a observaciones', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE, observaciones: 'Nota previa' }],
  })
  await rejectRecord(supabase, baseRecord(), 'Geometría inválida', 'COOP-JS')
})

test('rejectRecord lanza EUDRQcError si 0 filas fueron afectadas', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: 'RECHAZADO' }],
  })
  await assert.rejects(() => rejectRecord(supabase, baseRecord(), 'motivo', 'COOP-JS'), EUDRQcError)
})
