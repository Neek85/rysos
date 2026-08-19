// Pruebas de lib/padronCsv.js — construcción y parseo de CSV para
// exportación/importación masiva del Padrón. Ver specs/padron_web_socios.md.
//
// Ejecutar con: node --test tests/test_padron_csv.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  arrayToCsv,
  buildSociosCsv,
  buildParcelasCsv,
  buildSocioTemplateCsv,
  buildParcelaTemplateCsv,
  parseCsv,
  validateSocioRows,
  validateParcelaRows,
  SOCIO_FIELD_LABELS,
  PARCELA_FIELD_LABELS,
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

test('buildSociosCsv usa encabezados legibles (METADATOS_CAMPO), no los nombres técnicos', () => {
  const csv = buildSociosCsv([{ ID_Socio: 'JS-00001', socio_nombre_completo: 'Juan Pérez' }])
  const header = csv.split('\r\n')[0]
  assert.ok(header.includes('Código de Socio'))
  assert.ok(header.includes('Nombre Completo'))
  assert.ok(!header.includes('ID_Socio'))
})

test('buildSociosCsv sigue guardando el valor bajo la columna técnica en la fila de datos', () => {
  const csv = buildSociosCsv([{ ID_Socio: 'JS-00001', socio_nombre_completo: 'Juan Pérez' }])
  const [, dataRow] = csv.split('\r\n')
  assert.ok(dataRow.includes('JS-00001'))
})

test('arrayToCsv con `labels` usa la etiqueta cuando existe, y la columna técnica si no', () => {
  const csv = arrayToCsv([{ a: '1', b: '2' }], ['a', 'b'], { a: 'Campo A' })
  const header = csv.split('\r\n')[0]
  assert.equal(header, 'Campo A,b')
})

test('buildParcelasCsv usa encabezados legibles para las hectáreas', () => {
  const csv = buildParcelasCsv([{ ID_Parcela_Fija: 'COOP-JS-001', hcp: 2 }])
  const header = csv.split('\r\n')[0]
  assert.ok(header.includes('Código de Parcela'))
  assert.ok(header.includes('Ha. Café Podado'))
})

// ---------------------------------------------------------------
// Plantillas en blanco
// ---------------------------------------------------------------

test('buildSocioTemplateCsv trae encabezado legible + exactamente 1 fila de ejemplo', () => {
  const csv = buildSocioTemplateCsv()
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 2)
  assert.ok(lines[0].includes('Código de Socio'))
  assert.ok(!lines[0].includes('Organización')) // ID_Organizacion excluida: se resuelve del contexto activo
})

test('buildParcelaTemplateCsv excluye totalh (campo calculado, no editable)', () => {
  const csv = buildParcelaTemplateCsv()
  const header = csv.split('\r\n')[0]
  assert.ok(!header.includes('Total Hectáreas'))
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

// ---------------------------------------------------------------
// Encabezados legibles en importación (normalizeRowKeys)
// ---------------------------------------------------------------

test('validateSocioRows acepta encabezados legibles ("Código de Socio", "Nombre Completo") igual que los técnicos', () => {
  const [result] = validateSocioRows([{ 'Código de Socio': 'JS-00099', 'Nombre Completo': 'Prueba Import' }])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.ID_Socio, 'JS-00099')
})

test('validateSocioRows acepta encabezados técnicos en minúsculas/mayúsculas distintas ("id_socio")', () => {
  const [result] = validateSocioRows([{ id_socio: 'JS-00099', socio_nombre_completo: 'Prueba Import' }])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('validateParcelaRows acepta encabezados legibles ("Código de Parcela", "Ha. Café Podado")', () => {
  const [result] = validateParcelaRows([
    { 'Código de Parcela': 'P-01', 'Código de Socio': 'JS-01', 'Ha. Café Podado': '2.5' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.ID_Parcela_Fija, 'P-01')
})

// ---------------------------------------------------------------
// Duplicados internos del archivo
// ---------------------------------------------------------------

test('validateSocioRows marca inválidas AMBAS filas con el mismo ID_Socio repetido en el archivo', () => {
  const results = validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno' },
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Dos' },
  ])
  assert.equal(results[0].valid, false)
  assert.equal(results[1].valid, false)
  assert.ok(results[0].errors.some((e) => e.includes('duplicado')))
  assert.ok(results[1].errors.some((e) => e.includes('duplicado')))
})

test('validateSocioRows marca inválidas las filas con el mismo DNI repetido, aunque el ID_Socio sea distinto', () => {
  const results = validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '12345678' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '12345678' },
  ])
  assert.equal(results[0].valid, false)
  assert.equal(results[1].valid, false)
  assert.ok(results[0].errors.some((e) => e.includes('DNI duplicado')))
})

test('validateSocioRows no marca duplicado un DNI vacío repetido (campo opcional)', () => {
  const results = validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos' },
  ])
  assert.equal(results[0].valid, true)
  assert.equal(results[1].valid, true)
})

test('validateParcelaRows marca inválidas ambas filas con el mismo ID_Parcela_Fija repetido', () => {
  const results = validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2' },
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-02', hcp: '3' },
  ])
  assert.equal(results[0].valid, false)
  assert.equal(results[1].valid, false)
})

test('validateSocioRows no confunde filas distintas sin valores repetidos', () => {
  const results = validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '22222222' },
  ])
  assert.equal(results[0].valid, true)
  assert.equal(results[1].valid, true)
})

// ---------------------------------------------------------------
// Diccionarios de etiquetas (cobertura completa de columnas de export)
// ---------------------------------------------------------------

test('SOCIO_FIELD_LABELS y PARCELA_FIELD_LABELS no tienen labels vacíos ni duplicados entre sí', () => {
  const socioLabels = Object.values(SOCIO_FIELD_LABELS)
  const parcelaLabels = Object.values(PARCELA_FIELD_LABELS)
  assert.ok(socioLabels.every((l) => typeof l === 'string' && l.length > 0))
  assert.ok(parcelaLabels.every((l) => typeof l === 'string' && l.length > 0))
  assert.equal(new Set(socioLabels).size, socioLabels.length, 'SOCIO_FIELD_LABELS tiene labels duplicados')
  assert.equal(new Set(parcelaLabels).size, parcelaLabels.length, 'PARCELA_FIELD_LABELS tiene labels duplicados')
})
