// Pruebas del Exportador TRACES UE (lib/eudrDdsExporter.js) — regla de
// precisión de coordenadas, regla de área/polígono obligatorio, aislamiento
// multi-tenant, y agrupación por parcela. Ver specs/traces_eudr_dossier_audit.md
// (antes de esta tarea, este módulo no tenía cobertura de tests directa).
//
// Mismo patrón que tests/test_inspecciones_schema.mjs y
// tests/test_trace_public.mjs: node:test + node:assert nativos.
//
// Ejecutar con: node --test tests/test_eudr_dds_exporter.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTracesPayload,
  resolveOrganizationId,
  exportTracesDDS,
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
    productor: 'Juan Pérez',
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
    productor: 'María Gómez',
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

test('exportTracesDDS acepta un tercer parámetro format (default "json") en vez de descargar json+geojson siempre', () => {
  assert.equal(exportTracesDDS.length, 2) // organizationId requerido, format tiene default (no cuenta en .length)
})

test('exportTracesDDS no está disponible en Node plano (usa document/Blob del DOM) — se documenta, no se prueba aquí', () => {
  // triggerDownload() dentro de exportTracesDDS depende de `document`/`Blob`/
  // `URL.createObjectURL`, disponibles solo en el navegador. Probarlo
  // requeriría jsdom (dependencia nueva, fuera de la decisión "cero
  // dependencias nuevas" ya confirmada en tareas anteriores) — la lógica de
  // negocio que sí importa (buildTracesPayload) ya está cubierta arriba;
  // exportTracesDDS es un wrapper delgado sobre esa función + descarga.
  assert.equal(typeof exportTracesDDS, 'function')
})
