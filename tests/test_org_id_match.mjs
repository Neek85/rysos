// Pruebas de lib/actions/orgIdMatch.js — comparación de ID_Organizacion
// tolerante a espacios/mayúsculas, usada por
// lib/actions/sociosActions.js para evitar falsos positivos de
// "Violación multi-tenant" (ver bug real reportado en /dashboard/socios,
// 2026-08-18).
//
// Ejecutar con: node --test tests/test_org_id_match.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOrgId, orgIdsMatch } from '../lib/actions/orgIdMatch.js'

test('orgIdsMatch: valores idénticos coinciden', () => {
  assert.equal(orgIdsMatch('COOP-JS', 'COOP-JS'), true)
})

test('orgIdsMatch: diferencia de mayúsculas/minúsculas sí coincide', () => {
  assert.equal(orgIdsMatch('coop-js', 'COOP-JS'), true)
  assert.equal(orgIdsMatch('Coop-Js', 'coop-js'), true)
})

test('orgIdsMatch: espacios extra al inicio/final sí coinciden', () => {
  assert.equal(orgIdsMatch(' COOP-JS ', 'COOP-JS'), true)
  assert.equal(orgIdsMatch('COOP-JS', '  COOP-JS'), true)
})

test('orgIdsMatch: organizaciones realmente distintas NO coinciden', () => {
  assert.equal(orgIdsMatch('COOP-JS', 'ORG-COOP-NORTE'), false)
})

test('orgIdsMatch: null/undefined nunca coinciden con un valor real', () => {
  assert.equal(orgIdsMatch(null, 'COOP-JS'), false)
  assert.equal(orgIdsMatch('COOP-JS', undefined), false)
})

test('orgIdsMatch: null y undefined entre sí no coinciden (igualdad estricta) — en la práctica sin impacto, los call sites de sociosActions.js siempre guardan con `ownerOrg && ...` antes de llamar a esta función', () => {
  assert.equal(orgIdsMatch(null, undefined), false)
})

test('normalizeOrgId recorta espacios y pasa a mayúsculas', () => {
  assert.equal(normalizeOrgId('  coop-js  '), 'COOP-JS')
})

test('normalizeOrgId deja pasar valores no-string sin tocar (null/undefined/number)', () => {
  assert.equal(normalizeOrgId(null), null)
  assert.equal(normalizeOrgId(undefined), undefined)
  assert.equal(normalizeOrgId(42), 42)
})
