// Pruebas de lib/validations/socios.js — schema Zod del Padrón Web de
// Socios y Fincas. Ver specs/padron_web_socios.md.
//
// Ejecutar con: node --test tests/test_socios_schema.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  socioSchema,
  parcelaSchema,
  SOCIO_DEFAULT_VALUES,
  PARCELA_DEFAULT_VALUES,
  CERT_FLAG_FIELDS,
} from '../lib/validations/socios.js'

function validSocio(overrides = {}) {
  return {
    ...SOCIO_DEFAULT_VALUES,
    ID_Socio: 'JS-00003',
    socio_nombre_completo: 'Juan Pérez',
    ...overrides,
  }
}

test('socioSchema acepta un socio mínimo válido (solo ID + nombre requeridos)', () => {
  const result = socioSchema.safeParse(validSocio())
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues))
})

test('socioSchema no depende de PADRON_PARCELAS de ninguna forma — un socio con 0 parcelas es válido', () => {
  const fields = Object.keys(socioSchema.shape)
  assert.ok(!fields.some((f) => f.toLowerCase().includes('parcela')))
})

test('socioSchema rechaza ID_Socio vacío', () => {
  const result = socioSchema.safeParse(validSocio({ ID_Socio: '' }))
  assert.equal(result.success, false)
})

test('socioSchema rechaza socio_nombre_completo vacío', () => {
  const result = socioSchema.safeParse(validSocio({ socio_nombre_completo: '' }))
  assert.equal(result.success, false)
})

test('socioSchema acepta DNI de 8 dígitos', () => {
  const result = socioSchema.safeParse(validSocio({ socio_dni: '44102527' }))
  assert.equal(result.success, true)
})

test('socioSchema rechaza DNI con menos de 8 dígitos', () => {
  const result = socioSchema.safeParse(validSocio({ socio_dni: '1234567' }))
  assert.equal(result.success, false)
})

test('socioSchema rechaza DNI con letras', () => {
  const result = socioSchema.safeParse(validSocio({ socio_dni: '4410252A' }))
  assert.equal(result.success, false)
})

test('socioSchema acepta DNI vacío (campo opcional)', () => {
  const result = socioSchema.safeParse(validSocio({ socio_dni: '' }))
  assert.equal(result.success, true)
})

test('socioSchema valida el mismo formato de DNI para conyuge_dni', () => {
  assert.equal(socioSchema.safeParse(validSocio({ conyuge_dni: '87654321' })).success, true)
  assert.equal(socioSchema.safeParse(validSocio({ conyuge_dni: 'abc' })).success, false)
})

test('socioSchema acepta los 8 flags de certificación en "Sí"/"No"', () => {
  for (const { field } of CERT_FLAG_FIELDS) {
    assert.equal(socioSchema.safeParse(validSocio({ [field]: 'Sí' })).success, true, field)
    assert.equal(socioSchema.safeParse(validSocio({ [field]: 'No' })).success, true, field)
    assert.equal(socioSchema.safeParse(validSocio({ [field]: '' })).success, true, field)
  }
})

test('socioSchema rechaza un valor de flag de certificación fuera de Sí/No', () => {
  const result = socioSchema.safeParse(validSocio({ cert_nop_usda: 'Tal vez' }))
  assert.equal(result.success, false)
})

test('CERT_FLAG_FIELDS tiene exactamente las 8 columnas reales confirmadas contra el schema en vivo', () => {
  const fields = CERT_FLAG_FIELDS.map((f) => f.field).sort()
  assert.deepEqual(fields, [
    'cert_comercio_justo',
    'cert_ds_0442006_ag',
    'cert_fair_trade_usa',
    'cert_lpo_mx',
    'cert_nop_usda',
    'cert_rainforest',
    'cor_canada',
    'ue_2018_848',
  ])
})

// ---------------------------------------------------------------
// parcelaSchema
// ---------------------------------------------------------------

// hcp: 2 por defecto — desde que se agregó la regla de área total > 0 ha
// (2026-08-18), una parcela "mínima válida" ya no puede tener las 7
// hectáreas en null/0: necesita al menos una categoría positiva.
function validParcela(overrides = {}) {
  return {
    ...PARCELA_DEFAULT_VALUES,
    ID_Parcela_Fija: 'COOP-JS-003',
    ID_Socio: 'JS-00003',
    hcp: 2,
    ...overrides,
  }
}

test('parcelaSchema acepta una parcela mínima válida', () => {
  const result = parcelaSchema.safeParse(validParcela())
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues))
})

test('parcelaSchema rechaza ID_Parcela_Fija vacío', () => {
  assert.equal(parcelaSchema.safeParse(validParcela({ ID_Parcela_Fija: '' })).success, false)
})

test('parcelaSchema rechaza ID_Socio vacío (parcela debe estar vinculada)', () => {
  assert.equal(parcelaSchema.safeParse(validParcela({ ID_Socio: '' })).success, false)
})

test('parcelaSchema coerciona campos de hectáreas de string a número', () => {
  const result = parcelaSchema.safeParse(validParcela({ hcp: '2.5', hcc: '0' }))
  assert.equal(result.success, true)
  assert.equal(result.data.hcp, 2.5)
  assert.equal(result.data.hcc, 0)
})

test('parcelaSchema acepta campos de hectáreas nulos (mientras otra categoría cubra el área total)', () => {
  const result = parcelaSchema.safeParse(validParcela({ hcp: null, hcc: 3 }))
  assert.equal(result.success, true)
})

test('parcelaSchema acepta 0 hectáreas en un campo (límite válido, no negativo) mientras otra categoría cubra el área total', () => {
  assert.equal(parcelaSchema.safeParse(validParcela({ hcp: 0, hcc: 3 })).success, true)
})

test('parcelaSchema rechaza una parcela con las 7 categorías en 0/null (área total debe ser > 0.00 ha)', () => {
  const result = parcelaSchema.safeParse(
    validParcela({ hcp: 0, hcc: null, ho: null, hip: null, hrp: null, hbp: null, otros_cultivo: null })
  )
  assert.equal(result.success, false)
  assert.ok(result.error.issues.some((i) => i.message.includes('mayor a 0.00 ha')))
})

test('parcelaSchema rechaza hectáreas negativas en cualquiera de las 7 categorías', () => {
  for (const field of ['hcp', 'hcc', 'ho', 'hip', 'hrp', 'hbp', 'otros_cultivo']) {
    const result = parcelaSchema.safeParse(validParcela({ [field]: -1 }))
    assert.equal(result.success, false, `${field} debería rechazar un valor negativo`)
  }
})

test('parcelaSchema rechaza un string de hectáreas negativo (coerción antes de validar)', () => {
  const result = parcelaSchema.safeParse(validParcela({ hcp: '-2.5' }))
  assert.equal(result.success, false)
})
