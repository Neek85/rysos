// Pruebas de lib/geo/areaUtils.js — cálculo de área/perímetro en vivo
// para el panel de información del Editor Vectorial (Fase 2, ver
// specs/consola_qc_layout_y_validacion.md, addendum panel de dibujo).
//
// El redondeo a 4 decimales (AREA_HA_DECIMALS) debe coincidir con
// fn_calcular_area_ha (supabase/migrations/20260818_gis_core_sanitization.sql,
// línea 88: ROUND((ST_Area(p_geom::geography) / 10000)::numeric, 4)) — NO
// con fn_validar_topologia_eudr directamente, esa función solo reutiliza
// fn_calcular_area_ha, no calcula el área ella misma (corrección de
// premisa del prompt original de esta tarea).
//
// Ejecutar con: node --test tests/test_geo_area_utils.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularAreaHa, calcularPerimetroM, AREA_HA_DECIMALS } from '../lib/geo/areaUtils.js'

test('AREA_HA_DECIMALS es 4 (coincide con el ROUND(...,4) de fn_calcular_area_ha)', () => {
  assert.equal(AREA_HA_DECIMALS, 4)
})

test('calcularAreaHa redondea a 4 decimales, no más ni menos', () => {
  const square = {
    type: 'Polygon',
    coordinates: [[[0, 0], [0.009, 0], [0.009, 0.009], [0, 0.009], [0, 0]]],
  }
  const areaHa = calcularAreaHa(square)
  const decimals = (areaHa.toString().split('.')[1] || '').length
  assert.ok(decimals <= 4, `no debería tener más de 4 decimales: ${areaHa}`)
})

test('calcularAreaHa devuelve null para un Point (sin área medible)', () => {
  assert.equal(calcularAreaHa({ type: 'Point', coordinates: [0, 0] }), null)
})

test('calcularAreaHa devuelve null para geometría nula/undefined', () => {
  assert.equal(calcularAreaHa(null), null)
  assert.equal(calcularAreaHa(undefined), null)
})

test('calcularAreaHa no lanza con un polígono degenerado (geometría todavía incompleta mientras se dibuja)', () => {
  const degenerate = { type: 'Polygon', coordinates: [[[0, 0]]] }
  assert.doesNotThrow(() => calcularAreaHa(degenerate))
})

test('calcularPerimetroM calcula un valor positivo en metros para un Polygon', () => {
  const square = {
    type: 'Polygon',
    coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
  }
  const perimetroM = calcularPerimetroM(square)
  assert.ok(perimetroM > 0)
  assert.ok(Number.isInteger(perimetroM), 'se redondea a metros enteros')
})

test('calcularPerimetroM devuelve null para un Point', () => {
  assert.equal(calcularPerimetroM({ type: 'Point', coordinates: [0, 0] }), null)
})

test('calcularPerimetroM no lanza con geometría nula', () => {
  assert.equal(calcularPerimetroM(null), null)
})
