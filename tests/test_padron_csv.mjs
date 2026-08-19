// Pruebas de lib/padronCsv.js — construcción y parseo de CSV para
// exportación/importación masiva del Padrón. Ver specs/padron_web_socios.md.
//
// Ejecutar con: node --test tests/test_padron_csv.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  arrayToCsv,
  buildSociosCsv,
  parseCsv,
  validateSocioRows,
  validateParcelaRows,
} from '../lib/padronCsv.js'

// ---------------------------------------------------------------
// arrayToCsv / buildSociosCsv
// ---------------------------------------------------------------

test('arrayToCsv produce encabezado + filas en el orden de columnas dado', () => {
  const csv = arrayToCsv([{ a: '1', b: '2' }, { a: '3', b: '4' }], ['a', 'b'])
  assert.equal(csv, 'a,b\r\n1,2\r\n3,4')
})

test('arrayToCsv escapa comas, comillas y saltos de línea', () => {
  const csv = arrayToCsv([{ nombre: 'Pérez, Juan "El Grande"\nFinca Alta' }], ['nombre'])
  assert.equal(csv, 'nombre\r\n"Pérez, Juan ""El Grande""\nFinca Alta"')
})

test('arrayToCsv trata null/undefined como celda vacía', () => {
  const csv = arrayToCsv([{ a: null, b: undefined }], ['a', 'b'])
  assert.equal(csv, 'a,b\r\n,')
})

test('buildSociosCsv incluye ID_Socio y socio_nombre_completo en el encabezado', () => {
  const csv = buildSociosCsv([{ ID_Socio: 'JS-00001', socio_nombre_completo: 'Juan Pérez' }])
  const header = csv.split('\r\n')[0]
  assert.ok(header.includes('ID_Socio'))
  assert.ok(header.includes('socio_nombre_completo'))
})

// ---------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------

test('parseCsv parsea un CSV simple a objetos por columna', () => {
  const rows = parseCsv('a,b\n1,2\n3,4')
  assert.deepEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }])
})

test('parseCsv maneja campos entre comillas con comas embebidas', () => {
  const rows = parseCsv('nombre,dni\n"Pérez, Juan",12345678')
  assert.deepEqual(rows, [{ nombre: 'Pérez, Juan', dni: '12345678' }])
})

test('parseCsv maneja comillas escapadas ("")', () => {
  const rows = parseCsv('nombre\n"El ""Grande"""')
  assert.deepEqual(rows, [{ nombre: 'El "Grande"' }])
})

test('parseCsv ignora un BOM UTF-8 al inicio', () => {
  const rows = parseCsv('﻿a,b\n1,2')
  assert.deepEqual(rows, [{ a: '1', b: '2' }])
})

test('parseCsv devuelve [] para texto vacío', () => {
  assert.deepEqual(parseCsv(''), [])
})

test('parseCsv(arrayToCsv(x)) es un roundtrip correcto', () => {
  const original = [{ a: 'uno, dos', b: 'tres "cuatro"' }]
  const csv = arrayToCsv(original, ['a', 'b'])
  const parsed = parseCsv(csv)
  assert.deepEqual(parsed, original)
})

// ---------------------------------------------------------------
// validateSocioRows / validateParcelaRows
// ---------------------------------------------------------------

test('validateSocioRows marca como válida una fila con ID_Socio y nombre', () => {
  const [result] = validateSocioRows([{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba Import' }])
  assert.equal(result.valid, true)
  assert.equal(result.errors.length, 0)
})

test('validateSocioRows marca como inválida una fila sin ID_Socio, con el motivo', () => {
  const [result] = validateSocioRows([{ ID_Socio: '', socio_nombre_completo: 'Sin código' }])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('ID_Socio')))
})

test('validateSocioRows marca como inválido un DNI con formato incorrecto', () => {
  const [result] = validateSocioRows([{ ID_Socio: 'JS-01', socio_nombre_completo: 'X', socio_dni: '123' }])
  assert.equal(result.valid, false)
})

test('validateParcelaRows marca como inválida una parcela con área total 0', () => {
  const [result] = validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '0', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('hectáreas')))
})

test('validateParcelaRows acepta una parcela con área total > 0', () => {
  const [result] = validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2.5', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(result.valid, true)
})

test('validateParcelaRows rechaza hectáreas negativas', () => {
  const [result] = validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '-1', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(result.valid, false)
})

test('validateSocioRows/validateParcelaRows con lista vacía devuelve []', () => {
  assert.deepEqual(validateSocioRows([]), [])
  assert.deepEqual(validateParcelaRows([]), [])
})
