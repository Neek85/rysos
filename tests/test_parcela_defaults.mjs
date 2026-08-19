// Pruebas de lib/parcelaDefaults.js — correlativo automático y sugerencia
// de ID de Parcela al crear una parcela nueva. Ver specs/padron_web_socios.md.
//
// Ejecutar con: node --test tests/test_parcela_defaults.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeNextParcelaCode, computeSuggestedParcelaId } from '../lib/parcelaDefaults.js'

test('computeNextParcelaCode sin parcelas previas devuelve P-00001', () => {
  assert.equal(computeNextParcelaCode([]), 'P-00001')
  assert.equal(computeNextParcelaCode(null), 'P-00001')
  assert.equal(computeNextParcelaCode(undefined), 'P-00001')
})

test('computeNextParcelaCode con P-00001..P-00003 sugiere P-00004', () => {
  const existing = [{ parcela_codigo: 'P-00001' }, { parcela_codigo: 'P-00002' }, { parcela_codigo: 'P-00003' }]
  assert.equal(computeNextParcelaCode(existing), 'P-00004')
})

test('computeNextParcelaCode toma el máximo, sin importar el orden de la lista', () => {
  const existing = [{ parcela_codigo: 'P-00003' }, { parcela_codigo: 'P-00001' }, { parcela_codigo: 'P-00002' }]
  assert.equal(computeNextParcelaCode(existing), 'P-00004')
})

test('computeNextParcelaCode detecta el prefijo real en vez de asumir "P-"', () => {
  const existing = [{ parcela_codigo: 'FINCA-007' }, { parcela_codigo: 'FINCA-008' }]
  assert.equal(computeNextParcelaCode(existing), 'FINCA-009')
})

test('computeNextParcelaCode preserva el ancho de relleno de ceros observado', () => {
  assert.equal(computeNextParcelaCode([{ parcela_codigo: 'P-001' }]), 'P-002')
  assert.equal(computeNextParcelaCode([{ parcela_codigo: 'P-0009' }]), 'P-0010')
})

test('computeNextParcelaCode ignora códigos vacíos/nulos/sin número', () => {
  const existing = [{ parcela_codigo: null }, { parcela_codigo: '' }, { parcela_codigo: 'SIN-NUMERO' }, { parcela_codigo: 'P-00005' }]
  assert.equal(computeNextParcelaCode(existing), 'P-00006')
})

test('computeNextParcelaCode con solo códigos no numéricos usa el default P-00001', () => {
  const existing = [{ parcela_codigo: 'ABC' }, { parcela_codigo: null }]
  assert.equal(computeNextParcelaCode(existing), 'P-00001')
})

test('computeSuggestedParcelaId combina socio + código de parcela', () => {
  assert.equal(computeSuggestedParcelaId('ND-00001', 'P-00004'), 'ND-00001-P-00004')
})

test('computeSuggestedParcelaId devuelve vacío si falta el socio o el código', () => {
  assert.equal(computeSuggestedParcelaId('', 'P-00004'), '')
  assert.equal(computeSuggestedParcelaId('ND-00001', ''), '')
  assert.equal(computeSuggestedParcelaId(null, null), '')
})
