// Pruebas de lib/ubigeoData.js — helpers de consulta sobre
// lib/data/ubigeo_peru.json. Ver specs/padron_web_socios.md.
//
// Ejecutar con: node --test tests/test_ubigeo_data.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDepartamentos, getProvincias, getDistritos } from '../lib/ubigeoData.js'

test('getDepartamentos devuelve los 25 departamentos reales del Perú', () => {
  const deps = getDepartamentos()
  assert.equal(deps.length, 25)
  for (const nombre of ['Amazonas', 'Cajamarca', 'Lima', 'Cusco', 'Callao', 'Ucayali']) {
    assert.ok(deps.includes(nombre), `Falta el departamento ${nombre}`)
  }
})

test('getDepartamentos devuelve nombres únicos, ordenados alfabéticamente', () => {
  const deps = getDepartamentos()
  const sorted = [...deps].sort((a, b) => a.localeCompare(b))
  assert.deepEqual(deps, sorted)
  assert.equal(new Set(deps).size, deps.length)
})

test('getProvincias("Cajamarca") incluye Jaén y San Ignacio (organizaciones reales de este proyecto)', () => {
  const provincias = getProvincias('Cajamarca')
  assert.ok(provincias.includes('Jaén'))
  assert.ok(provincias.includes('San Ignacio'))
})

test('getProvincias devuelve [] para un departamento inexistente o vacío', () => {
  assert.deepEqual(getProvincias('No Existe'), [])
  assert.deepEqual(getProvincias(''), [])
  assert.deepEqual(getProvincias(null), [])
})

test('getDistritos("Cajamarca", "Jaén") incluye Bellavista y Pucara', () => {
  const distritos = getDistritos('Cajamarca', 'Jaén')
  assert.ok(distritos.includes('Bellavista'))
  assert.ok(distritos.includes('Pucara'))
})

test('getDistritos devuelve [] si falta departamento, provincia, o la combinación no existe', () => {
  assert.deepEqual(getDistritos('Cajamarca', ''), [])
  assert.deepEqual(getDistritos('', 'Jaén'), [])
  assert.deepEqual(getDistritos('Cajamarca', 'Provincia Inexistente'), [])
  assert.deepEqual(getDistritos('Departamento Inexistente', 'Jaén'), [])
})

test('cada departamento tiene al menos una provincia con al menos un distrito', () => {
  for (const dep of getDepartamentos()) {
    const provincias = getProvincias(dep)
    assert.ok(provincias.length > 0, `${dep} no tiene provincias`)
    for (const prov of provincias) {
      const distritos = getDistritos(dep, prov)
      assert.ok(distritos.length > 0, `${dep} > ${prov} no tiene distritos`)
    }
  }
})
