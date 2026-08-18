// Pruebas del Dossier Comercial EUDR nativo en JS (lib/pdf/). Ver
// specs/pdf_dossier_native_js.md. Mismo patrón de validación que
// tests/test_modulo_dossier_pdf.py (Python) para el PDF resultante: magic
// bytes, marcador EOF, tamaño mínimo, XObject de imagen (confirma que el
// QR se embebió).
//
// Ejecutar con: node --test tests/test_pdf_dossier.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeBoundingBox, projectFeaturesToSvgShapes } from '../lib/pdf/geometryToSvg.js'
import { renderDossierPdf } from '../lib/pdf/renderDossierPdf.js'

// ---------------------------------------------------------------
// geometryToSvg.js — funciones puras
// ---------------------------------------------------------------

const polygonFeature = {
  type: 'Feature',
  properties: { parcela_codigo: 'COOP-JS-001', hectareas: 5.2 },
  geometry: {
    type: 'Polygon',
    coordinates: [[[-77.5, -6.5], [-77.4, -6.5], [-77.4, -6.4], [-77.5, -6.4], [-77.5, -6.5]]],
  },
}

const pointFeature = {
  type: 'Feature',
  properties: { parcela_codigo: 'COOP-JS-002', hectareas: 1.1 },
  geometry: { type: 'Point', coordinates: [-77.45, -6.45] },
}

test('computeBoundingBox calcula min/max lon/lat correctos', () => {
  const bbox = computeBoundingBox([polygonFeature])
  assert.equal(bbox.minLon, -77.5)
  assert.equal(bbox.maxLon, -77.4)
  assert.equal(bbox.minLat, -6.5)
  assert.equal(bbox.maxLat, -6.4)
})

test('computeBoundingBox devuelve null sin geometrías', () => {
  assert.equal(computeBoundingBox([]), null)
  assert.equal(computeBoundingBox([{ geometry: null }]), null)
  assert.equal(computeBoundingBox(undefined), null)
})

test('projectFeaturesToSvgShapes proyecta un Polygon dentro del viewport (sin desbordar)', () => {
  const shapes = projectFeaturesToSvgShapes([polygonFeature], { width: 400, height: 300, padding: 10 })
  assert.equal(shapes.length, 1)
  assert.equal(shapes[0].type, 'polygon')
  for (const [x, y] of shapes[0].points) {
    assert.ok(x >= 0 && x <= 400, `x=${x} fuera de rango`)
    assert.ok(y >= 0 && y <= 300, `y=${y} fuera de rango`)
  }
})

test('projectFeaturesToSvgShapes proyecta un Point como {type: "point", cx, cy}', () => {
  const shapes = projectFeaturesToSvgShapes([pointFeature], { width: 400, height: 300 })
  assert.equal(shapes.length, 1)
  assert.equal(shapes[0].type, 'point')
  assert.ok(typeof shapes[0].cx === 'number')
  assert.ok(typeof shapes[0].cy === 'number')
})

test('projectFeaturesToSvgShapes maneja Polygon + Point en el mismo lote', () => {
  const shapes = projectFeaturesToSvgShapes([polygonFeature, pointFeature], { width: 400, height: 300 })
  assert.equal(shapes.length, 2)
})

test('projectFeaturesToSvgShapes devuelve [] sin geometrías (mapa vacío, no lanza excepción)', () => {
  assert.deepEqual(projectFeaturesToSvgShapes([], { width: 400, height: 300 }), [])
  assert.deepEqual(projectFeaturesToSvgShapes(undefined, { width: 400, height: 300 }), [])
})

test('projectFeaturesToSvgShapes no lanza con bounding box degenerado (una sola coordenada)', () => {
  const single = {
    geometry: { type: 'Polygon', coordinates: [[[-77.5, -6.5], [-77.5, -6.5], [-77.5, -6.5]]] },
    properties: {},
  }
  assert.doesNotThrow(() => projectFeaturesToSvgShapes([single], { width: 400, height: 300 }))
})

// ---------------------------------------------------------------
// renderDossierPdf.js — render end-to-end (mismos checks que el
// equivalente Python en tests/test_modulo_dossier_pdf.py)
// ---------------------------------------------------------------

function sampleLote(overrides = {}) {
  return {
    lot_hash: 'abc123deadbeef01',
    verification_url: 'https://app.ryzos.io/trace/abc123deadbeef01',
    regulation: 'EU 2023/1115',
    organization_id: 'ORG-COOP-NORTE',
    total_plots: 2,
    total_hectares: 12.5,
    geojson: { type: 'FeatureCollection', features: [polygonFeature, pointFeature] },
    ...overrides,
  }
}

test('renderDossierPdf produce un buffer con magic bytes %PDF-', async () => {
  const pdf = await renderDossierPdf(sampleLote())
  assert.ok(Buffer.isBuffer(pdf))
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
})

test('renderDossierPdf produce un PDF con marcador %%EOF', async () => {
  const pdf = await renderDossierPdf(sampleLote())
  assert.ok(pdf.toString('latin1').includes('%%EOF'))
})

test('renderDossierPdf produce un PDF de tamaño razonable (>= 2KB — confirma que el QR/tabla se renderizaron, no solo una página vacía)', async () => {
  const pdf = await renderDossierPdf(sampleLote())
  assert.ok(pdf.length >= 2000, `PDF de ${pdf.length} bytes — demasiado pequeño`)
})

test('renderDossierPdf embebe el QR como XObject de imagen', async () => {
  const pdf = await renderDossierPdf(sampleLote())
  assert.ok(pdf.toString('latin1').includes('/Image'))
})

test('renderDossierPdf no lanza excepción con un lote sin geometría (mapa vacío)', async () => {
  const lote = sampleLote({ geojson: { type: 'FeatureCollection', features: [] } })
  const pdf = await renderDossierPdf(lote)
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
})

test('renderDossierPdf no lanza excepción con un lote sin verification_url (sin QR)', async () => {
  const lote = sampleLote({ verification_url: null })
  const pdf = await renderDossierPdf(lote)
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
})

test('renderDossierPdf NO incluye ningún dato del módulo de Inspecciones FED (decisión confirmada, ver specs/pdf_dossier_native_js.md)', async () => {
  const pdf = await renderDossierPdf(sampleLote())
  const text = pdf.toString('latin1')
  for (const forbidden of ['CAP_DATOS_SOCIO', 'CAP_MIC', 'CAP_BIENESTAR', 'socio_dni', 'INSPECCIONES']) {
    assert.ok(!text.includes(forbidden), `El PDF no debería contener "${forbidden}"`)
  }
})
