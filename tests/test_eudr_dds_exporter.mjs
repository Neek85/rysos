// Pruebas del Paquete de Trazabilidad EUDR (lib/eudrDdsExporter.js) — regla
// de precisión de coordenadas, regla de área/polígono obligatorio,
// integridad de geometría (LineString/anillo abierto/auto-intersección),
// aislamiento multi-tenant, agrupación por parcela, proyección al esquema
// oficial de geolocalización UE, y adjunto de cobertura. Ver
// docs/adr/ADR-017-formato-real-exportacion-trazabilidad.md.
//
// Mismo patrón que tests/test_inspecciones_schema.mjs y
// tests/test_trace_public.mjs: node:test + node:assert nativos.
//
// Ejecutar con: node --test tests/test_eudr_dds_exporter.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTracesPayload,
  buildOfficialEuGeoJson,
  resolveOrganizationId,
  resolveMonitoreoIdsForCobertura,
  attachCoberturaSummary,
  downloadTraceabilityPackage,
  EUDRValidationError,
  EUDR_REGULATION,
  EUDR_CUTOFF_DATE,
  MIN_POLYGON_HECTARES,
  EXPORT_FORMATS,
} from '../lib/eudrDdsExporter.js'

function polygonRecord(overrides = {}) {
  return {
    tabla_origen: 'EUDR_MONITOREO',
    ID_Organizacion: 'ORG-A',
    ID_Parcela_Fija: 'parcela-1',
    parcela_codigo: 'COOP-JS-001',
    parcela_nombre: 'Finca Alta',
    area_ha: 5.123456789,
    productor: 'JS-00001',
    productor_nombre: 'Juan Pérez',
    cumple_eudr: 'SI',
    estado_revision: 'APROBADO',
    geom_geojson: JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-77.123456789, -6.123456789], [-77.1, -6.1], [-77.2, -6.2], [-77.123456789, -6.123456789]]],
    }),
    ...overrides,
  }
}

function pointRecord(overrides = {}) {
  return {
    tabla_origen: 'EUDR_MONITOREO',
    ID_Organizacion: 'ORG-A',
    ID_Parcela_Fija: 'parcela-2',
    parcela_codigo: 'COOP-JS-002',
    parcela_nombre: 'Finca Pequeña',
    area_ha: 1.5,
    productor: 'JS-00002',
    productor_nombre: 'María Gómez',
    cumple_eudr: 'SI',
    estado_revision: 'APROBADO',
    geom_geojson: JSON.stringify({ type: 'Point', coordinates: [-77.5, -6.5] }),
    ...overrides,
  }
}

test('EUDR_REGULATION / EUDR_CUTOFF_DATE / MIN_POLYGON_HECTARES tienen los valores del Reglamento UE 2023/1115', () => {
  assert.equal(EUDR_REGULATION, 'EU 2023/1115')
  assert.equal(EUDR_CUTOFF_DATE, '2020-12-31')
  assert.equal(MIN_POLYGON_HECTARES, 4.0)
})

test('resolveOrganizationId devuelve el único ID_Organizacion presente', () => {
  const id = resolveOrganizationId([polygonRecord(), pointRecord()])
  assert.equal(id, 'ORG-A')
})

test('resolveOrganizationId devuelve null si no hay registros', () => {
  assert.equal(resolveOrganizationId([]), null)
  assert.equal(resolveOrganizationId(null), null)
})

test('resolveOrganizationId lanza EUDRValidationError si hay más de una organización', () => {
  const records = [polygonRecord({ ID_Organizacion: 'ORG-A' }), pointRecord({ ID_Organizacion: 'ORG-B' })]
  assert.throws(() => resolveOrganizationId(records), EUDRValidationError)
})

test('buildTracesPayload redondea coordenadas a 6 decimales (AC1)', () => {
  const payload = buildTracesPayload([polygonRecord()], 'ORG-A')
  const coords = payload.geojson.features[0].geometry.coordinates[0]
  for (const [lon, lat] of coords) {
    // El registro fixture tiene 9 decimales de entrada; comparar contra el
    // valor ya truncado a 6 confirma que sí se redondeó, no que ya venía corto.
    assert.equal(lon, Number(lon.toFixed(6)))
    assert.equal(lat, Number(lat.toFixed(6)))
  }
})

test('buildTracesPayload: parcela >= 4 ha con Polygon no lanza excepción (AC2)', () => {
  assert.doesNotThrow(() => buildTracesPayload([polygonRecord({ area_ha: 5.0 })], 'ORG-A'))
})

test('buildTracesPayload: parcela >= 4 ha con Point lanza EUDRValidationError (AC2)', () => {
  const record = pointRecord({ area_ha: 4.5 })
  assert.throws(() => buildTracesPayload([record], 'ORG-A'), EUDRValidationError)
})

test('buildTracesPayload: parcela < 4 ha con Point NO lanza excepción (AC2)', () => {
  assert.doesNotThrow(() => buildTracesPayload([pointRecord({ area_ha: 1.5 })], 'ORG-A'))
})

test('buildTracesPayload: parcela exactamente en 4.0 ha con Point SÍ lanza (límite inclusive)', () => {
  assert.throws(
    () => buildTracesPayload([pointRecord({ area_ha: 4.0 })], 'ORG-A'),
    EUDRValidationError
  )
})

test('buildTracesPayload lanza violación multi-tenant si un registro pertenece a otra organización (AC3)', () => {
  const records = [polygonRecord({ ID_Organizacion: 'ORG-A' }), pointRecord({ ID_Organizacion: 'ORG-B', area_ha: 1 })]
  assert.throws(() => buildTracesPayload(records, 'ORG-A'), EUDRValidationError)
})

test('buildTracesPayload agrupa múltiples filas de la misma parcela en una sola Feature (AC4)', () => {
  const records = [
    polygonRecord({ ID_Parcela_Fija: 'parcela-1', tabla_origen: 'EUDR_MONITOREO' }),
    { ...polygonRecord({ ID_Parcela_Fija: 'parcela-1' }), tabla_origen: 'EUDR_USO_SUELO', productor: null },
  ]
  const payload = buildTracesPayload(records, 'ORG-A')
  assert.equal(payload.total_plots, 1)
  assert.equal(payload.geojson.features.length, 1)
})

test('buildTracesPayload filtra estrictamente estado_revision !== APROBADO (AC4)', () => {
  const records = [polygonRecord({ estado_revision: 'APROBADO' }), pointRecord({ estado_revision: 'PENDIENTE', area_ha: 1 })]
  const payload = buildTracesPayload(records, 'ORG-A')
  assert.equal(payload.total_plots, 1)
})

test('buildTracesPayload requiere una organización válida', () => {
  assert.throws(() => buildTracesPayload([polygonRecord()], null), EUDRValidationError)
  assert.throws(() => buildTracesPayload([polygonRecord()], ''), EUDRValidationError)
})

test('buildTracesPayload suma total_hectares de todas las parcelas', () => {
  const records = [polygonRecord({ area_ha: 5, ID_Parcela_Fija: 'p1' }), polygonRecord({ area_ha: 3, ID_Parcela_Fija: 'p2', parcela_codigo: 'COOP-JS-003' })]
  const payload = buildTracesPayload(records, 'ORG-A')
  assert.equal(payload.total_hectares, 8)
})

test('EXPORT_FORMATS tiene exactamente las 2 modalidades reales (json/geojson) — sin CSV ni "puntos" inventados', () => {
  const values = EXPORT_FORMATS.map((f) => f.value).sort()
  assert.deepEqual(values, ['geojson', 'json'])
  EXPORT_FORMATS.forEach((f) => {
    assert.equal(typeof f.label, 'string')
    assert.ok(f.label.length > 0)
  })
})

test('downloadTraceabilityPackage acepta un payload ya construido + format (default "json")', () => {
  assert.equal(downloadTraceabilityPackage.length, 1) // format tiene default (no cuenta en .length)
})

test('downloadTraceabilityPackage no está disponible en Node plano (usa document/Blob del DOM) — se documenta, no se prueba aquí', () => {
  // triggerDownload() dentro de downloadTraceabilityPackage depende de
  // `document`/`Blob`/`URL.createObjectURL`, disponibles solo en el
  // navegador. Probarlo requeriría jsdom (dependencia nueva, fuera de la
  // decisión "cero dependencias nuevas" ya confirmada en tareas anteriores)
  // — la lógica de negocio que sí importa (buildTracesPayload,
  // buildOfficialEuGeoJson) ya está cubierta arriba/abajo;
  // downloadTraceabilityPackage es un wrapper delgado sobre esas funciones +
  // descarga.
  assert.equal(typeof downloadTraceabilityPackage, 'function')
})

test('buildTracesPayload ya NO describe el wrapper como "DUE_DILIGENCE_STATEMENT" (ADR-017 — RYZOS no presenta la DDS directamente)', () => {
  const payload = buildTracesPayload([polygonRecord()], 'ORG-A')
  assert.notEqual(payload.declaration_type, 'DUE_DILIGENCE_STATEMENT')
  assert.equal(typeof payload.declaration_type, 'string')
})

test('buildTracesPayload rechaza una geometría LineString aunque la parcela sea < 4 ha (esquema oficial EUDR nunca la acepta)', () => {
  const record = pointRecord({
    area_ha: 1.5,
    geom_geojson: JSON.stringify({ type: 'LineString', coordinates: [[-77.5, -6.5], [-77.4, -6.4]] }),
  })
  assert.throws(() => buildTracesPayload([record], 'ORG-A'), EUDRValidationError)
})

test('buildTracesPayload rechaza un polígono con el anillo no cerrado', () => {
  const record = polygonRecord({
    geom_geojson: JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-77.1, -6.1], [-77.2, -6.1], [-77.2, -6.2], [-77.15, -6.15]]],
    }),
  })
  assert.throws(() => buildTracesPayload([record], 'ORG-A'), EUDRValidationError)
})

test('buildTracesPayload rechaza un polígono con auto-intersección (forma de "corbata")', () => {
  const record = polygonRecord({
    area_ha: 5,
    geom_geojson: JSON.stringify({
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]],
    }),
  })
  assert.throws(() => buildTracesPayload([record], 'ORG-A'), EUDRValidationError)
})

test('buildOfficialEuGeoJson usa el casing oficial exacto: ProducerName/ProducerCountry/ProductionPlace/Area', () => {
  const payload = buildTracesPayload([polygonRecord()], 'ORG-A')
  const official = buildOfficialEuGeoJson(payload)
  const props = official.features[0].properties

  assert.equal(official.type, 'FeatureCollection')
  assert.equal(props.ProducerName, 'Juan Pérez')
  assert.equal(props.ProducerCountry, 'PE')
  assert.equal(props.ProductionPlace, 'Finca Alta')
  assert.equal(typeof props.Area, 'number')
  assert.ok(props.Area > 0)
  assert.deepEqual(Object.keys(props).sort(), ['Area', 'ProducerCountry', 'ProducerName', 'ProductionPlace'])
})

test('buildOfficialEuGeoJson nunca envía Area como string, ni siquiera si el dato interno es raro', () => {
  const payload = buildTracesPayload([polygonRecord()], 'ORG-A')
  payload.geojson.features[0].properties.hectareas = undefined
  const official = buildOfficialEuGeoJson(payload)
  assert.equal(official.features[0].properties.Area, 0)
  assert.notEqual(typeof official.features[0].properties.Area, 'string')
})

test('buildOfficialEuGeoJson omite ProducerName/ProductionPlace en vez de inventarlos cuando no hay dato', () => {
  const payload = buildTracesPayload(
    [
      polygonRecord({
        productor: null,
        productor_nombre: null,
        parcela_nombre: null,
        parcela_codigo: null,
        ID_Parcela_Fija: 'parcela-x',
      }),
    ],
    'ORG-A'
  )
  const official = buildOfficialEuGeoJson(payload)
  const props = official.features[0].properties
  assert.equal('ProducerName' in props, false)
  assert.equal('ProductionPlace' in props, false)
  assert.equal(props.ProducerCountry, 'PE')
})

test('buildOfficialEuGeoJson usa productor_nombre (nombre real), NUNCA el código crudo de productor', () => {
  // Regresión del hallazgo de la verificación en vivo de ADR-017 contra
  // ORG-TEST-E2E: `productor` resuelve a un código interno (ID_Socio, ej.
  // "JS-00002"), no a un nombre real — usarlo directamente para
  // ProducerName habría expuesto códigos internos en el archivo oficial.
  const payload = buildTracesPayload(
    [polygonRecord({ productor: 'JS-00099', productor_nombre: 'Nombre Real Del Productor' })],
    'ORG-A'
  )
  const official = buildOfficialEuGeoJson(payload)
  assert.equal(official.features[0].properties.ProducerName, 'Nombre Real Del Productor')
  assert.notEqual(official.features[0].properties.ProducerName, 'JS-00099')
})

test('buildOfficialEuGeoJson omite ProducerName cuando productor_nombre es el sentinel "Socio no asignado" de la vista', () => {
  const payload = buildTracesPayload(
    [polygonRecord({ productor_nombre: 'Socio no asignado' })],
    'ORG-A'
  )
  const official = buildOfficialEuGeoJson(payload)
  assert.equal('ProducerName' in official.features[0].properties, false)
})

test('resolveMonitoreoIdsForCobertura solo incluye parcelas cuyo límite es un perímetro EUDR_MONITOREO con registro_id', () => {
  const records = [
    polygonRecord({ ID_Parcela_Fija: 'p1', registro_id: 'uuid-monitoreo-1' }),
    { ...polygonRecord({ ID_Parcela_Fija: 'p2' }), tabla_origen: 'EUDR_USO_SUELO', registro_id: 'uuid-usosuelo-1' },
  ]
  const lookups = resolveMonitoreoIdsForCobertura(records)
  assert.equal(lookups.length, 1)
  assert.equal(lookups[0].monitoreoId, 'uuid-monitoreo-1')
})

test('attachCoberturaSummary agrega cobertura_uso_suelo como campo nuevo, sin tocar organization_id/total_plots/total_hectares/properties de cada Feature', () => {
  const records = [polygonRecord({ ID_Parcela_Fija: 'p1', registro_id: 'uuid-monitoreo-1' })]
  const payload = buildTracesPayload(records, 'ORG-A')
  const featurePropsBefore = JSON.stringify(payload.geojson.features[0].properties)

  const enriched = attachCoberturaSummary(payload, records, {
    'uuid-monitoreo-1': {
      ID_Organizacion: 'ORG-A',
      area_monitoreo_ha: 10,
      suma_uso_suelo_aprobado_ha: 6,
      hueco_cobertura: true,
    },
  })

  assert.equal(enriched.organization_id, payload.organization_id)
  assert.equal(enriched.total_plots, payload.total_plots)
  assert.equal(enriched.total_hectares, payload.total_hectares)
  assert.equal(JSON.stringify(enriched.geojson.features[0].properties), featurePropsBefore)
  assert.equal(enriched.cobertura_uso_suelo.length, 1)
  assert.equal(enriched.cobertura_uso_suelo[0].cobertura_pct, 60)
  assert.equal(enriched.cobertura_uso_suelo[0].hueco_cobertura, true)
  assert.ok(enriched.cobertura_uso_suelo[0].aviso.includes('no bloquea'))
})

test('attachCoberturaSummary marca disponible:false para una parcela sin resultado, sin lanzar', () => {
  const records = [polygonRecord({ ID_Parcela_Fija: 'p1', registro_id: 'uuid-monitoreo-1' })]
  const payload = buildTracesPayload(records, 'ORG-A')
  const enriched = attachCoberturaSummary(payload, records, {})
  assert.equal(enriched.cobertura_uso_suelo[0].disponible, false)
})

// ---------------------------------------------------------------
// ADR-028 (multi-producto café/cacao) — producto_codigo/producto_nombre
// ---------------------------------------------------------------

test('buildTracesPayload omite producto_codigo/producto_nombre (null) cuando ningún registro del grupo lo trae', () => {
  const records = [polygonRecord({ ID_Parcela_Fija: 'p1' })]
  const payload = buildTracesPayload(records, 'ORG-A')
  assert.equal(payload.geojson.features[0].properties.producto_codigo, null)
  assert.equal(payload.geojson.features[0].properties.producto_nombre, null)
})

test('buildTracesPayload agrega producto_codigo/producto_nombre cuando vienen en el registro (fila de origen EUDR_USO_SUELO)', () => {
  const records = [
    polygonRecord({ ID_Parcela_Fija: 'p1', producto_codigo: 'CAFE', producto_nombre: 'Café' }),
  ]
  const payload = buildTracesPayload(records, 'ORG-A')
  assert.equal(payload.geojson.features[0].properties.producto_codigo, 'CAFE')
  assert.equal(payload.geojson.features[0].properties.producto_nombre, 'Café')
})

test('buildTracesPayload lee producto_codigo/producto_nombre de CUALQUIER fila del grupo, no solo de pickBoundaryRecord (EUDR_MONITOREO nunca lo trae)', () => {
  // pickBoundaryRecord prefiere la fila EUDR_MONITOREO (el perímetro real)
  // como boundary -- esa fila nunca tiene producto_codigo (el trigger solo
  // puebla EUDR_USO_SUELO.id_producto_predominante). Sin escanear todo el
  // grupo (pickProducto), este test fallaría con producto_codigo: null.
  const records = [
    polygonRecord({ ID_Parcela_Fija: 'p1', tabla_origen: 'EUDR_MONITOREO', producto_codigo: null, producto_nombre: null }),
    {
      ...polygonRecord({ ID_Parcela_Fija: 'p1' }),
      tabla_origen: 'EUDR_USO_SUELO',
      productor: null,
      producto_codigo: 'CACAO',
      producto_nombre: 'Cacao',
    },
  ]
  const payload = buildTracesPayload(records, 'ORG-A')
  assert.equal(payload.geojson.features.length, 1, 'debe seguir agrupando ambas filas en una sola Feature (AC4)')
  assert.equal(payload.geojson.features[0].properties.producto_codigo, 'CACAO')
  assert.equal(payload.geojson.features[0].properties.producto_nombre, 'Cacao')
})

test('buildOfficialEuGeoJson NO incluye producto/commodity -- sin campo oficial confirmado en TRACES NT (spec sección 1.7), solo el payload interno lo expone', () => {
  const records = [polygonRecord({ ID_Parcela_Fija: 'p1', producto_codigo: 'CAFE', producto_nombre: 'Café' })]
  const payload = buildTracesPayload(records, 'ORG-A')
  const official = buildOfficialEuGeoJson(payload)
  const props = official.features[0].properties
  assert.ok(!('producto_codigo' in props))
  assert.ok(!('producto_nombre' in props))
})
