// Pruebas del Portal Público de Trazabilidad (lib/traceabilityHash.js) —
// hash determinista, sanitización PII, y manejo de payloads inválidos.
// Ver specs/trace_public_audit.md.
//
// Mismo patrón que tests/test_inspecciones_schema.mjs: node:test +
// node:assert nativos, sin dependencias nuevas.
//
// Ejecutar con: node --test tests/test_trace_public.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateLotHash,
  buildPublicSanitizedPayload,
  getTraceUrl,
} from '../lib/traceabilityHash.js'

// Forma real de un ddsPayload generado por buildTracesPayload()
// (lib/eudrDdsExporter.js) contra vw_monitoreo_web — properties SIN
// id_monitoreo (esa columna no existe en esa vista, solo en
// vw_monitoreo_poligonos/puntos), con id_parcela + PII real (productor,
// aquí también arrastrando socio_dni de un merge hipotético para probar
// el filtro completo).
function samplePayload() {
  return {
    organization_id: 'ORG-COOP-NORTE',
    total_plots: 2,
    total_hectares: 12.5,
    regulation: 'EU 2023/1115',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-77.5, -6.5] },
          properties: {
            id_parcela: 'a1b2c3d4-uuid-real-de-parcela',
            parcela_codigo: 'COOP-JS-001',
            parcela_nombre: 'Finca Alta',
            productor: 'JS-00001',
            productor_nombre: 'Juan Pérez',
            socio_dni: '12345678',
            cumple_eudr: 'SI',
            deforestation_cutoff_date: '2020-12-31',
            hectareas: 5.2,
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
          properties: {
            id_parcela: 'e5f6g7h8-uuid-real-de-parcela-2',
            parcela_codigo: 'COOP-JS-002',
            parcela_nombre: 'Finca Baja',
            productor: 'JS-00002',
            productor_nombre: 'María Gómez',
            conyuge_dni: '87654321',
            cumple_eudr: 'SI',
            deforestation_cutoff_date: '2020-12-31',
            hectareas: 7.3,
          },
        },
      ],
    },
  }
}

test('generateLotHash es determinista (mismo payload -> mismo hash)', async () => {
  const payload = samplePayload()
  const hash1 = await generateLotHash(payload)
  const hash2 = await generateLotHash(payload)
  assert.equal(hash1, hash2)
})

test('generateLotHash produce 16 caracteres hexadecimales', async () => {
  const hash = await generateLotHash(samplePayload())
  assert.equal(hash.length, 16)
  assert.match(hash, /^[0-9a-f]{16}$/)
})

test('generateLotHash produce hashes distintos para payloads distintos', async () => {
  const payload1 = samplePayload()
  const payload2 = samplePayload()
  payload2.total_hectares = 99.9
  const hash1 = await generateLotHash(payload1)
  const hash2 = await generateLotHash(payload2)
  assert.notEqual(hash1, hash2)
})

test('generateLotHash usa id_parcela cuando id_monitoreo está ausente (forma real de vw_monitoreo_web, ver specs/trace_public_audit.md)', async () => {
  const payload = samplePayload()
  const hashWithIdParcela = await generateLotHash(payload)

  const withoutIdParcela = samplePayload()
  withoutIdParcela.geojson.features.forEach((f) => delete f.properties.id_parcela)
  const hashWithout = await generateLotHash(withoutIdParcela)

  assert.notEqual(
    hashWithIdParcela,
    hashWithout,
    'quitar id_parcela debería cambiar el hash — confirma que sí se usa en el cálculo'
  )
})

test('generateLotHash no lanza excepción con payload vacío/inválido', async () => {
  await assert.doesNotReject(() => generateLotHash({}))
  await assert.doesNotReject(() => generateLotHash(null))
  await assert.doesNotReject(() => generateLotHash(undefined))
})

test('buildPublicSanitizedPayload remueve los 7 campos PII de cada Feature (agrega productor_nombre, ADR-017)', () => {
  const payload = samplePayload()
  const sanitized = buildPublicSanitizedPayload(payload, 'abc123')

  const piiFields = [
    'socio_dni',
    'socio_nombre',
    'socio_nombre_completo',
    'conyuge_dni',
    'productor',
    'productor_nombre',
    'id_parcela',
  ]
  for (const feature of sanitized.geojson.features) {
    for (const field of piiFields) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(feature.properties, field),
        false,
        `${field} no debería estar presente en el payload público`
      )
    }
  }
})

test('buildPublicSanitizedPayload preserva campos no-PII (parcela_codigo, hectareas, cumple_eudr, geometría)', () => {
  const payload = samplePayload()
  const sanitized = buildPublicSanitizedPayload(payload, 'abc123')

  const first = sanitized.geojson.features[0]
  assert.equal(first.properties.parcela_codigo, 'COOP-JS-001')
  assert.equal(first.properties.hectareas, 5.2)
  assert.equal(first.properties.cumple_eudr, 'SI')
  assert.deepEqual(first.geometry, payload.geojson.features[0].geometry)
})

test('buildPublicSanitizedPayload preserva metadatos del lote y el hash pasado', () => {
  const payload = samplePayload()
  const sanitized = buildPublicSanitizedPayload(payload, 'deadbeef12345678')

  assert.equal(sanitized.lot_hash, 'deadbeef12345678')
  assert.equal(sanitized.verification_url, getTraceUrl('deadbeef12345678'))
  assert.equal(sanitized.regulation, 'EU 2023/1115')
  assert.equal(sanitized.organization_id, 'ORG-COOP-NORTE')
  assert.equal(sanitized.total_plots, 2)
  assert.equal(sanitized.total_hectares, 12.5)
})

test('buildPublicSanitizedPayload no lanza excepción con payload vacío/inválido', () => {
  assert.doesNotThrow(() => buildPublicSanitizedPayload({}, 'x'))
  assert.doesNotThrow(() => buildPublicSanitizedPayload(null, 'x'))
  const result = buildPublicSanitizedPayload(null, 'x')
  assert.deepEqual(result.geojson.features, [])
})

test('getTraceUrl construye la URL de verificación esperada', () => {
  assert.equal(getTraceUrl('abc123'), 'https://app.ryzos.io/trace/abc123')
})
