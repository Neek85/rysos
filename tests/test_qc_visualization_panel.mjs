// Pruebas de los badges compactos de QcTable.jsx (lista de pendientes de
// /dashboard/qc) — ver specs/qc_visualization_panel_update.md. Las
// funciones puras viven en lib/qcTopologyValidation.js (no en QcTable.jsx,
// que es JSX) para poder testearlas con node --test, mismo criterio que
// describeDeforestationBadge (tests/test_qc_validation_eudr.mjs).
//
// No es un test de integración de render (no hay Jest/Testing Library
// instalado en este proyecto, ver CLAUDE.md) — certifica el contrato de
// datos que consume QcTable.jsx: qué `tone`/`label` produce cada
// combinación real de `validationResults[record.key]`, incluido el
// default "PENDIENTE" antes de que exista un resultado.
//
// Ejecutar con: node --test tests/test_qc_visualization_panel.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeTopologyListBadge,
  describeOverlapListBadge,
  describeDeforestationListBadge,
} from '../lib/qcTopologyValidation.js'

// ---------------------------------------------------------------
// describeTopologyListBadge
// ---------------------------------------------------------------

test('describeTopologyListBadge: sin resultado todavía -> PENDIENTE (tono neutral)', () => {
  const badge = describeTopologyListBadge(undefined)
  assert.deepEqual(badge, { tone: 'neutral', label: 'PENDIENTE' })
})

test('describeTopologyListBadge: es_valido true -> VÁLIDA (tono ok)', () => {
  const badge = describeTopologyListBadge({ es_valido: true })
  assert.deepEqual(badge, { tone: 'ok', label: 'VÁLIDA' })
})

test('describeTopologyListBadge: es_valido false -> CON ERRORES (tono bad)', () => {
  const badge = describeTopologyListBadge({ es_valido: false })
  assert.deepEqual(badge, { tone: 'bad', label: 'CON ERRORES' })
})

// ---------------------------------------------------------------
// describeOverlapListBadge
// ---------------------------------------------------------------

test('describeOverlapListBadge: sin resultado todavía -> PENDIENTE (tono neutral)', () => {
  assert.deepEqual(describeOverlapListBadge(null), { tone: 'neutral', label: 'PENDIENTE' })
})

test('describeOverlapListBadge: sin solapamiento -> SIN SOLAPO (tono ok)', () => {
  const badge = describeOverlapListBadge({ solapa: false, solapamiento_max_pct: 0 })
  assert.deepEqual(badge, { tone: 'ok', label: 'SIN SOLAPO' })
})

test('describeOverlapListBadge: con solapamiento -> SOLAPADO X% (tono warn, NO bad — es advertencia, no bloquea)', () => {
  const badge = describeOverlapListBadge({ solapa: true, solapamiento_max_pct: 37.5 })
  assert.deepEqual(badge, { tone: 'warn', label: 'SOLAPADO 37.5%' })
})

// ---------------------------------------------------------------
// describeDeforestationListBadge
// ---------------------------------------------------------------

test('describeDeforestationListBadge: sin cruce disponible -> SIN DATOS (tono neutral) — nunca un veredicto inventado', () => {
  const badge = describeDeforestationListBadge({ deforestacion: { disponible: false } })
  assert.deepEqual(badge, { tone: 'neutral', label: 'SIN DATOS' })
})

test('describeDeforestationListBadge: sin resultado en absoluto -> SIN DATOS (tono neutral)', () => {
  assert.deepEqual(describeDeforestationListBadge(undefined), { tone: 'neutral', label: 'SIN DATOS' })
})

test('describeDeforestationListBadge: disponible, sin intersección post-2020 -> APTO (tono ok)', () => {
  const badge = describeDeforestationListBadge({
    deforestacion: { disponible: true, interseca_post_2020: false },
  })
  assert.deepEqual(badge, { tone: 'ok', label: 'APTO' })
})

test('describeDeforestationListBadge: disponible, con intersección post-2020 -> ALERTA DEFORESTACIÓN (tono bad)', () => {
  const badge = describeDeforestationListBadge({
    deforestacion: { disponible: true, interseca_post_2020: true, area_afectada_max_pct: 8 },
  })
  assert.deepEqual(badge, { tone: 'bad', label: 'ALERTA DEFORESTACIÓN' })
})
