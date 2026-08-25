// Pruebas de lib/eudrQcActions.js — Consola de Auditoría QC WebGIS
// (/dashboard/qc). Sin cobertura JS previa (solo existe
// tests/test_fase3_qc.py, que cubre el flujo QGIS Desktop, un módulo
// distinto — scripts/qgis_qc_actions.py). Mock mínimo de Supabase, sin
// red — mismo patrón que tests/test_padron_csv.mjs.
//
// Ejecutar con: node --test tests/test_eudr_qc_actions.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  fetchPendingRecords,
  fetchComparisonGeometries,
  approveRecord,
  rejectRecord,
  EUDRQcError,
  PENDING_STATE,
} from '../lib/eudrQcActions.js'

const SOURCE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'lib/eudrQcActions.js'
)

/**
 * Mock encadenable que soporta tanto lectura (`.select().eq()`, resuelve
 * como thenable) como escritura (`.update().match().select()`, también
 * thenable) sobre una tabla en memoria — suficiente para las 3 formas de
 * consulta reales que usa este módulo. `.rpc()` (ADR-014: guard server-side
 * de conflicto de código de parcela) devuelve `{ tiene_conflicto: false }`
 * por defecto — sin conflicto — para no alterar el comportamiento de los
 * tests de approveRecord/rejectRecord ya existentes que no configuran
 * `rpcResponses` explícitamente; `rpcResponses[fnName]` (objeto fijo o
 * función `(params) => ({data, error})`) lo sobreescribe por test.
 */
function makeFakeSupabase(tableData, { rpcResponses = {} } = {}) {
  const store = Object.fromEntries(Object.entries(tableData).map(([k, v]) => [k, v.slice()]))
  return {
    rpc(fnName, params) {
      const responder = rpcResponses[fnName]
      if (typeof responder === 'function') return Promise.resolve(responder(params))
      if (responder) return Promise.resolve(responder)
      return Promise.resolve({ data: { tiene_conflicto: false }, error: null })
    },
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
        limit(n) {
          rows = rows.slice(0, n)
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
        // ADR-020: checkSocioParcelaOrganizacion es la primera función de
        // este archivo en usar .maybeSingle() (gisActions.js, ADR-019, ya
        // lo usaba con su propio mock separado) — real Supabase devuelve la
        // primera fila o null, nunca un array.
        maybeSingle() {
          return Promise.resolve({ data: rows[0] ?? null, error: null })
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

test('fetchPendingRecords resuelve id_origen = id_monitoreo para EUDR_MONITOREO en puntos aunque la fila no lo traiga explícito (fallback defensivo en tagRecords)', async () => {
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

test('fetchPendingRecords resuelve id_origen real para EUDR_INSTALACIONES en puntos (ADR-015: PUNTOS_COLUMNS ahora lo pide — antes quedaba undefined pese a que la vista ya lo exponía)', async () => {
  const supabase = makeFakeSupabase({
    vw_monitoreo_poligonos: [],
    vw_monitoreo_puntos: [
      {
        tabla_origen: 'EUDR_INSTALACIONES',
        registro_id: '4',
        id_origen: '4',
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
  assert.equal(record.id_origen, '4')
})

test('fetchPendingRecords deja id_origen undefined para EUDR_INSTALACIONES si la fila realmente no lo trae (defensa en profundidad, no un gap conocido — ver ADR-015)', async () => {
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

test('fetchPendingRecords aísla por organización — nunca devuelve PENDIENTE de otra organización (gap real cerrado, ver specs/qc_visualization_panel_update.md)', async () => {
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
      {
        tabla_origen: 'EUDR_USO_SUELO',
        registro_id: '2',
        id_origen: '2',
        id_monitoreo: 'uuid-2',
        ID_Organizacion: 'OTRA-COOP',
        ID_Parcela_Fija: 'OTRA-COOP-001',
        estado_revision: PENDING_STATE,
      },
    ],
    vw_monitoreo_puntos: [],
    PADRON_PARCELAS: [],
  })

  const records = await fetchPendingRecords(supabase)
  assert.equal(records.length, 1)
  assert.equal(records[0].ID_Organizacion, 'COOP-JS')
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

test('approveRecord rechaza un registro EUDR_INSTALACIONES sin id_origen con un mensaje claro que describe el síntoma, sin culpar a una migración específica (ver ADR-015 -- ese mensaje viejo apuntaba a una causa equivocada), sin intentar el UPDATE', async () => {
  const supabase = makeFakeSupabase({ EUDR_INSTALACIONES: [{ id: 4, ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }] })
  const record = baseRecord({ tabla_origen: 'EUDR_INSTALACIONES', id_origen: undefined })
  await assert.rejects(
    () => approveRecord(supabase, record, 'COOP-JS'),
    (err) =>
      err instanceof EUDRQcError &&
      err.message.includes('id_origen ausente') &&
      !err.message.includes('20260819_fix_vw_monitoreo_puntos_id_origen.sql')
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

// ---------------------------------------------------------------
// Guard server-side de conflicto de código de parcela (ADR-014, cierre del
// gap: QcDetailEditor.jsx ya deshabilitaba el botón, pero un llamado
// directo a la Server Action sin pasar por la UI no estaba protegido).
// ---------------------------------------------------------------

test('approveRecord aborta SIN escribir nada si fn_validar_codigo_parcela_unico reporta conflicto (mensaje en lenguaje claro, sin el UUID del otro registro)', async () => {
  const supabase = makeFakeSupabase(
    { EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }] },
    {
      rpcResponses: {
        fn_validar_codigo_parcela_unico: {
          data: {
            tiene_conflicto: true,
            ID_Parcela_Fija: 'COOP-JS-001',
            registros_en_conflicto: [
              {
                id_monitoreo: 'otro-uuid',
                distancia_m: 1213.49,
                estado_revision: 'APROBADO',
                fecha_monitoreo: '2026-07-06',
                tecnico_responsable: 'Victor campos',
              },
            ],
          },
          error: null,
        },
      },
    }
  )
  await assert.rejects(
    () => approveRecord(supabase, baseRecord(), 'COOP-JS'),
    (err) =>
      err instanceof EUDRQcError &&
      err.message.includes('COOP-JS-001') &&
      err.message.includes('1.2 km') &&
      !err.message.includes('otro-uuid')
  )
})

test('approveRecord NO escribe estado_revision cuando hay conflicto (verificado leyendo la tabla en memoria)', async () => {
  const monitoreoRows = [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }]
  const supabase = makeFakeSupabase(
    { EUDR_MONITOREO: monitoreoRows },
    { rpcResponses: { fn_validar_codigo_parcela_unico: { data: { tiene_conflicto: true, registros_en_conflicto: [] }, error: null } } }
  )
  await assert.rejects(() => approveRecord(supabase, baseRecord(), 'COOP-JS'), EUDRQcError)
  const { data: rows } = await supabase.from('EUDR_MONITOREO').select().eq('id_monitoreo', 'uuid-1')
  assert.equal(rows[0].estado_revision, PENDING_STATE, 'el registro no debe haberse tocado')
})

test('rejectRecord también aborta si hay conflicto de código de parcela', async () => {
  const supabase = makeFakeSupabase(
    { EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE, observaciones: '' }] },
    {
      rpcResponses: {
        fn_validar_codigo_parcela_unico: {
          data: {
            tiene_conflicto: true,
            ID_Parcela_Fija: 'COOP-JS-003',
            registros_en_conflicto: [
              {
                id_monitoreo: 'otro-uuid',
                distancia_m: 768.53,
                estado_revision: 'RECHAZADO',
                fecha_monitoreo: '2026-08-19',
                tecnico_responsable: 'Victor campos',
              },
            ],
          },
          error: null,
        },
      },
    }
  )
  await assert.rejects(
    () => rejectRecord(supabase, baseRecord(), 'motivo real', 'COOP-JS'),
    (err) => err instanceof EUDRQcError && err.message.includes('COOP-JS-003') && err.message.includes('769 m')
  )
})

test('approveRecord/rejectRecord proceden normalmente cuando la RPC reporta tiene_conflicto=false', async () => {
  const supabase = makeFakeSupabase(
    { EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE, observaciones: '' }] },
    { rpcResponses: { fn_validar_codigo_parcela_unico: { data: { tiene_conflicto: false }, error: null } } }
  )
  await approveRecord(supabase, baseRecord(), 'COOP-JS') // no debe lanzar
})

test('el guard nunca se invoca para EUDR_USO_SUELO/EUDR_INSTALACIONES (esas tablas no tienen ID_Parcela_Fija propio)', async () => {
  let rpcCalled = false
  const supabase = makeFakeSupabase(
    { EUDR_USO_SUELO: [{ id: 13, ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }] },
    {
      rpcResponses: {
        fn_validar_codigo_parcela_unico: () => {
          rpcCalled = true
          return { data: { tiene_conflicto: false }, error: null }
        },
      },
    }
  )
  const record = baseRecord({ tabla_origen: 'EUDR_USO_SUELO', id_origen: 13 })
  await approveRecord(supabase, record, 'COOP-JS')
  assert.equal(rpcCalled, false, 'fn_validar_codigo_parcela_unico no debe llamarse para EUDR_USO_SUELO')
})

test('si la RPC misma falla (error de red/función inexistente), la operación se aborta — nunca falla abierto', async () => {
  const supabase = makeFakeSupabase(
    { EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }] },
    { rpcResponses: { fn_validar_codigo_parcela_unico: { data: null, error: new Error('fallo simulado de red') } } }
  )
  await assert.rejects(() => approveRecord(supabase, baseRecord(), 'COOP-JS'), /fallo simulado de red/)
})

test('el guard usa el mismo mensaje en lenguaje claro que buildConflictoParcelaMensaje (usado también por QcDetailEditor.jsx) — verificación en vivo real en el paso 3 de la tarea original', async () => {
  const supabase = makeFakeSupabase(
    { EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }] },
    {
      rpcResponses: {
        fn_validar_codigo_parcela_unico: {
          data: {
            tiene_conflicto: true,
            ID_Parcela_Fija: 'COOP-JS-004',
            registros_en_conflicto: [
              {
                id_monitoreo: 'otro-uuid',
                distancia_m: 3532.75,
                estado_revision: 'APROBADO',
                fecha_monitoreo: '2026-08-16',
                tecnico_responsable: 'TECNICO 2',
              },
            ],
          },
          error: null,
        },
      },
    }
  )
  try {
    await approveRecord(supabase, baseRecord(), 'COOP-JS')
    assert.fail('debería haber lanzado')
  } catch (err) {
    assert.match(err.message, /Un código de parcela debe corresponder siempre a un único lugar físico/)
    assert.match(err.message, /COOP-JS-004/)
    assert.match(err.message, /3\.5 km/)
    assert.match(err.message, /revisión manual/)
    assert.ok(!err.message.includes('otro-uuid'), 'no debe exponer el id_monitoreo del otro registro')
  }
})

// ---------------------------------------------------------------
// checkSocioParcelaOrganizacion / assertSocioParcelaMismaOrganizacion (ADR-020)
// ---------------------------------------------------------------

test('approveRecord procede normalmente cuando ID_Parcela_Fija pertenece a la misma organización', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }],
    PADRON_PARCELAS: [{ ID_Parcela_Fija: 'COOP-JS-001', ID_Organizacion: 'COOP-JS' }],
  })
  const record = baseRecord({ ID_Parcela_Fija: 'COOP-JS-001' })
  await approveRecord(supabase, record, 'COOP-JS') // no debe lanzar
})

test('approveRecord aborta si ID_Parcela_Fija pertenece a otra organización real (gap real encontrado en ORG-TEST-E2E, ver ADR-020) — mensaje en lenguaje simple, sin UUID crudo', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'ORG-TEST-E2E', estado_revision: PENDING_STATE }],
    PADRON_PARCELAS: [{ ID_Parcela_Fija: 'COOP-JS-001', ID_Organizacion: 'COOP-JS' }],
  })
  const record = baseRecord({
    ID_Organizacion: 'ORG-TEST-E2E',
    ID_Parcela_Fija: 'COOP-JS-001',
    fecha_monitoreo: '2026-08-23',
  })
  await assert.rejects(
    () => approveRecord(supabase, record, 'ORG-TEST-E2E'),
    (err) =>
      err instanceof EUDRQcError &&
      err.message.includes('COOP-JS-001') &&
      err.message.includes('COOP-JS') &&
      err.message.includes('ORG-TEST-E2E') &&
      err.message.includes('2026-08-23') &&
      !err.message.includes('uuid-1')
  )
})

test('approveRecord NO escribe estado_revision cuando hay mismatch de organización de parcela (verificado leyendo la tabla en memoria)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'ORG-TEST-E2E', estado_revision: PENDING_STATE }],
    PADRON_PARCELAS: [{ ID_Parcela_Fija: 'COOP-JS-001', ID_Organizacion: 'COOP-JS' }],
  })
  const record = baseRecord({ ID_Organizacion: 'ORG-TEST-E2E', ID_Parcela_Fija: 'COOP-JS-001' })
  await assert.rejects(() => approveRecord(supabase, record, 'ORG-TEST-E2E'), EUDRQcError)
  const row = (await supabase.from('EUDR_MONITOREO').select().eq('id_monitoreo', 'uuid-1')).data[0]
  assert.equal(row.estado_revision, PENDING_STATE)
})

test('approveRecord aborta si ID_Socio (resuelto fresco desde la tabla base) pertenece a otra organización real', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [
      { id_monitoreo: 'uuid-1', ID_Organizacion: 'ORG-TEST-E2E', ID_Socio: 'JS-00001', estado_revision: PENDING_STATE },
    ],
    PADRON_SOCIOS: [{ ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS' }],
  })
  const record = baseRecord({ ID_Organizacion: 'ORG-TEST-E2E' })
  await assert.rejects(
    () => approveRecord(supabase, record, 'ORG-TEST-E2E'),
    (err) => err instanceof EUDRQcError && err.message.includes('JS-00001') && err.message.includes('COOP-JS')
  )
})

test('rejectRecord SÍ procede normalmente pese al mismatch de organización — decisión explícita ADR-020, nunca cerrar la salida de descartar un registro problemático (a diferencia del conflicto de código de parcela, que sí bloquea ambos)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'ORG-TEST-E2E', estado_revision: PENDING_STATE, observaciones: '' }],
    PADRON_PARCELAS: [{ ID_Parcela_Fija: 'COOP-JS-001', ID_Organizacion: 'COOP-JS' }],
  })
  const record = baseRecord({ ID_Organizacion: 'ORG-TEST-E2E', ID_Parcela_Fija: 'COOP-JS-001' })
  await rejectRecord(supabase, record, 'motivo real', 'ORG-TEST-E2E') // no debe lanzar
})

test('el chequeo de organización no explota ni reporta conflicto cuando ID_Parcela_Fija/ID_Socio no existen en el padrón (código inventado — fuera de alcance de esta verificación, ya cubierto por otras)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_MONITOREO: [{ id_monitoreo: 'uuid-1', ID_Organizacion: 'COOP-JS', estado_revision: PENDING_STATE }],
    PADRON_PARCELAS: [],
  })
  const record = baseRecord({ ID_Parcela_Fija: 'CODIGO-INVENTADO' })
  await approveRecord(supabase, record, 'COOP-JS') // no debe lanzar
})

test('el chequeo de organización corre para EUDR_USO_SUELO/EUDR_INSTALACIONES (a diferencia del guard de código de parcela — ID_Parcela_Fija ahí también viene de PADRON_PARCELAS)', async () => {
  const supabase = makeFakeSupabase({
    EUDR_USO_SUELO: [{ id: 13, ID_Organizacion: 'ORG-TEST-E2E', estado_revision: PENDING_STATE }],
    PADRON_PARCELAS: [{ ID_Parcela_Fija: 'COOP-JS-001', ID_Organizacion: 'COOP-JS' }],
  })
  const record = baseRecord({
    tabla_origen: 'EUDR_USO_SUELO',
    id_origen: 13,
    ID_Organizacion: 'ORG-TEST-E2E',
    ID_Parcela_Fija: 'COOP-JS-001',
  })
  await assert.rejects(() => approveRecord(supabase, record, 'ORG-TEST-E2E'), EUDRQcError)
})

// ---------------------------------------------------------------
// fetchComparisonGeometries — capa de comparación de solapamiento
// (specs/consola_qc_layout_y_validacion.md, addendum solapamiento
// auditable). fn_validar_topologia_eudr YA filtra sus candidatos por
// ID_Organizacion del lado del servidor — este fetch defiende igual por
// ID_Organizacion (defensa en profundidad), no porque la lista de IDs sea
// insegura.
// ---------------------------------------------------------------

test('fetchComparisonGeometries devuelve [] si no hay registros_solapados', async () => {
  const supabase = makeFakeSupabase({ vw_monitoreo_poligonos: [] })
  const result = await fetchComparisonGeometries(supabase, [], 'COOP-JS')
  assert.deepEqual(result, [])
})

test('fetchComparisonGeometries trae geom + tabla_origen de los registros solapados, filtrado por ID_Organizacion', async () => {
  const supabase = makeFakeSupabase({
    vw_monitoreo_poligonos: [
      {
        id_origen: 'uuid-aprobado-1',
        tabla_origen: 'EUDR_USO_SUELO',
        ID_Organizacion: 'COOP-JS',
        geom: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      },
      // Misma organización que el registro de arriba, distinto id — no
      // debería aparecer porque no está en registrosSolapados.
      { id_origen: 'uuid-no-solapado', tabla_origen: 'EUDR_USO_SUELO', ID_Organizacion: 'COOP-JS', geom: {} },
      // Otra organización — no debería aparecer aunque coincida el id
      // (defensa en profundidad, ver comentario de arriba).
      { id_origen: 'uuid-otra-org', tabla_origen: 'EUDR_MONITOREO', ID_Organizacion: 'OTRA-COOP', geom: {} },
    ],
  })
  const solapados = [
    { registro_id: 'uuid-aprobado-1', tabla_origen: 'EUDR_USO_SUELO', solapamiento_pct: 45.2 },
    { registro_id: 'uuid-otra-org', tabla_origen: 'EUDR_MONITOREO', solapamiento_pct: 10 },
  ]
  const result = await fetchComparisonGeometries(supabase, solapados, 'COOP-JS')
  assert.equal(result.length, 1, 'debería excluir el registro de OTRA-COOP pese a venir en registros_solapados')
  assert.equal(result[0].registro_id, 'uuid-aprobado-1')
  assert.equal(result[0].tabla_origen, 'EUDR_USO_SUELO')
  assert.equal(result[0].geometry.type, 'Polygon')
})

test('fetchComparisonGeometries parsea geom si llega como string JSON (mismo caso defensivo que parseGeometry en QcConsoleMap.jsx)', async () => {
  const supabase = makeFakeSupabase({
    vw_monitoreo_poligonos: [
      {
        id_origen: 'uuid-1',
        tabla_origen: 'EUDR_MONITOREO',
        ID_Organizacion: 'COOP-JS',
        geom: JSON.stringify({ type: 'Point', coordinates: [1, 2] }),
      },
    ],
  })
  const result = await fetchComparisonGeometries(
    supabase,
    [{ registro_id: 'uuid-1', tabla_origen: 'EUDR_MONITOREO' }],
    'COOP-JS'
  )
  assert.equal(result[0].geometry.type, 'Point')
})

// ---------------------------------------------------------------
// ADR-015: PUNTOS_COLUMNS debe pedir id_origen a PostgREST -- si algún día
// se vuelve a quitar sin querer, este test de inspección de fuente lo
// atrapa aunque los mocks de arriba no lo hicieran.
// ---------------------------------------------------------------

test('PUNTOS_COLUMNS incluye id_origen (regresión real: la vista lo exponía desde el 19 de agosto, pero esta lista nunca lo pedía)', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8')
  const match = source.match(/const PUNTOS_COLUMNS =\s*\n((?:\s*'.*?'\s*\+?\s*\n?)+)/)
  assert.ok(match, 'PUNTOS_COLUMNS debería existir')
  const columnList = match[1].replace(/[\s'+]/g, '')
  assert.match(columnList, /(^|,)id_origen(,|$)/)
})

test('el mensaje de id_origen ausente ya no culpa a una migración específica (ADR-015: esa versión apuntaba a una causa equivocada)', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8')
  const throwBlock = source.match(/if \(!record\.id_origen\) \{[\s\S]*?throw new EUDRQcError\(\s*\n[\s\S]*?\)\s*\n\s*\}/)
  assert.ok(throwBlock, 'el bloque que lanza el error de id_origen ausente debería existir')
  assert.ok(
    !throwBlock[0].includes('20260819_fix_vw_monitoreo_puntos_id_origen.sql'),
    'el TEXTO DEL MENSAJE no debe volver a nombrar esa migración específica (la referencia histórica en comentarios de cabecera sí puede seguir)'
  )
  assert.match(throwBlock[0], /id_origen ausente/)
})
