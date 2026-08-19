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

test('buildParcelaTemplateCsv sin ID_Socio reales cae al ID de respaldo (1 fila)', () => {
  const csv = buildParcelaTemplateCsv([])
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 2) // encabezado + 1 fila
  assert.ok(lines[1].includes('JS-00001'))
})

test('buildParcelaTemplateCsv con ID_Socio reales genera una fila de ejemplo por cada uno (hasta 2)', () => {
  const csv = buildParcelaTemplateCsv(['COOP-01', 'COOP-02', 'COOP-03'])
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 3) // encabezado + 2 filas (recorta a 2, ignora el 3ro)
  assert.ok(lines[1].includes('COOP-01'))
  assert.ok(lines[2].includes('COOP-02'))
  assert.ok(!csv.includes('COOP-03'))
})

test('buildParcelaTemplateCsv con 2 socios reales no genera códigos de parcela duplicados entre sí', async () => {
  const csv = buildParcelaTemplateCsv(['COOP-01', 'COOP-02'])
  // La propia plantilla, reimportada tal cual, no debe autochocar como duplicado.
  const results = await validateParcelaRows(parseCsv(csv))
  assert.ok(results.every((r) => !r.errors.some((e) => e.includes('duplicado'))))
})

test('buildSocioTemplateCsv con un ID_Socio libre calculado lo usa en vez del fijo', () => {
  const csv = buildSocioTemplateCsv('JS-00099')
  const lines = csv.split('\r\n')
  assert.ok(lines[1].startsWith('JS-00099'))
})

test('buildParcelaTemplateCsv con códigos existentes calcula el siguiente libre (no "P-01"/"COOP-001" fijos)', () => {
  const csv = buildParcelaTemplateCsv(['COOP-01'], ['P-01', 'P-02'], ['COOP-01-P01'])
  const lines = csv.split('\r\n')
  assert.ok(!lines[1].includes(',P-01,'), 'no debería reusar P-01, ya existente')
  assert.ok(lines[1].includes('P-03'))
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

test('validateSocioRows marca como válida una fila con ID_Socio y nombre', async () => {
  const [result] = await validateSocioRows([{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba Import' }])
  assert.equal(result.valid, true)
  assert.equal(result.errors.length, 0)
})

test('validateSocioRows marca como inválida una fila sin ID_Socio, con el motivo', async () => {
  const [result] = await validateSocioRows([{ ID_Socio: '', socio_nombre_completo: 'Sin código' }])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('ID_Socio')))
})

test('validateSocioRows marca como inválido un DNI con formato incorrecto', async () => {
  const [result] = await validateSocioRows([{ ID_Socio: 'JS-01', socio_nombre_completo: 'X', socio_dni: '123' }])
  assert.equal(result.valid, false)
})

test('validateParcelaRows marca como inválida una parcela con área total 0', async () => {
  const [result] = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '0', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('hectáreas')))
})

test('validateParcelaRows acepta una parcela con área total > 0', async () => {
  const [result] = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2.5', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(result.valid, true)
})

test('validateParcelaRows rechaza hectáreas negativas', async () => {
  const [result] = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '-1', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(result.valid, false)
})

test('validateSocioRows/validateParcelaRows con lista vacía devuelve []', async () => {
  assert.deepEqual(await validateSocioRows([]), [])
  assert.deepEqual(await validateParcelaRows([]), [])
})

// ---------------------------------------------------------------
// Encabezados legibles en importación (normalizeRowKeys)
// ---------------------------------------------------------------

test('validateSocioRows acepta encabezados legibles ("Código de Socio", "Nombre Completo") igual que los técnicos', async () => {
  const [result] = await validateSocioRows([{ 'Código de Socio': 'JS-00099', 'Nombre Completo': 'Prueba Import' }])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.ID_Socio, 'JS-00099')
})

test('validateSocioRows acepta encabezados técnicos en minúsculas/mayúsculas distintas ("id_socio")', async () => {
  const [result] = await validateSocioRows([{ id_socio: 'JS-00099', socio_nombre_completo: 'Prueba Import' }])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('validateParcelaRows acepta encabezados legibles ("Código de Parcela", "Ha. Café Podado")', async () => {
  const [result] = await validateParcelaRows([
    { 'Código de Parcela': 'P-01', 'Código de Socio': 'JS-01', 'Ha. Café Podado': '2.5' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.ID_Parcela_Fija, 'P-01')
})

// ---------------------------------------------------------------
// Duplicados internos del archivo
// ---------------------------------------------------------------

test('validateSocioRows marca inválidas AMBAS filas con el mismo ID_Socio repetido en el archivo', async () => {
  const results = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno' },
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Dos' },
  ])
  assert.equal(results[0].valid, false)
  assert.equal(results[1].valid, false)
  assert.ok(results[0].errors.some((e) => e.includes('duplicado')))
  assert.ok(results[1].errors.some((e) => e.includes('duplicado')))
})

test('validateSocioRows marca inválidas las filas con el mismo DNI repetido, aunque el ID_Socio sea distinto', async () => {
  const results = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '12345678' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '12345678' },
  ])
  assert.equal(results[0].valid, false)
  assert.equal(results[1].valid, false)
  assert.ok(results[0].errors.some((e) => e.includes('DNI duplicado')))
})

test('validateSocioRows no marca duplicado un DNI vacío repetido (campo opcional)', async () => {
  const results = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos' },
  ])
  assert.equal(results[0].valid, true)
  assert.equal(results[1].valid, true)
})

test('validateParcelaRows marca inválidas ambas filas con el mismo ID_Parcela_Fija repetido', async () => {
  const results = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2' },
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-02', hcp: '3' },
  ])
  assert.equal(results[0].valid, false)
  assert.equal(results[1].valid, false)
})

test('validateSocioRows no confunde filas distintas sin valores repetidos', async () => {
  const results = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '22222222' },
  ])
  assert.equal(results[0].valid, true)
  assert.equal(results[1].valid, true)
})

// ---------------------------------------------------------------
// Pre-validación contra la BD en la vista previa (supabase/organizationId
// opcionales) — mock mínimo, sin red: un builder encadenable
// .from().select().eq().in() que resuelve como una promesa (thenable),
// igual de forma que lo usa applySocioDbChecks/applyParcelaDbChecks.
// ---------------------------------------------------------------

function makeFakeSupabase(tableData) {
  return {
    from(table) {
      let rows = (tableData[table] || []).slice()
      const builder = {
        select() {
          return builder
        },
        eq(col, val) {
          rows = rows.filter((r) => r[col] === val)
          return builder
        },
        in(col, vals) {
          rows = rows.filter((r) => vals.includes(r[col]))
          return builder
        },
        then(resolve, reject) {
          Promise.resolve({ data: rows, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

test('validateSocioRows marca inválido un ID_Socio que ya existe en la BD de la organización activa', async () => {
  const supabase = makeFakeSupabase({
    PADRON_SOCIOS: [{ ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', socio_dni: null, codigo_finca: null }],
  })
  const [result] = await validateSocioRows(
    [{ ID_Socio: 'JS-00001', socio_nombre_completo: 'Ya Existe' }],
    supabase,
    'COOP-JS'
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('ya existe')))
})

test('validateSocioRows marca inválido un DNI que ya existe en la BD, con el mensaje pedido', async () => {
  const supabase = makeFakeSupabase({
    PADRON_SOCIOS: [{ ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', socio_dni: '12345678', codigo_finca: null }],
  })
  const [result] = await validateSocioRows(
    [{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Nuevo', socio_dni: '12345678' }],
    supabase,
    'COOP-JS'
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('El DNI 12345678 ya existe en esta organización')))
})

test('validateSocioRows marca inválido un codigo_finca que ya existe en la BD', async () => {
  const supabase = makeFakeSupabase({
    PADRON_SOCIOS: [{ ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', socio_dni: null, codigo_finca: 'F-001' }],
  })
  const [result] = await validateSocioRows(
    [{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Nuevo', codigo_finca: 'F-001' }],
    supabase,
    'COOP-JS'
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('El Código de Finca "F-001" ya existe')))
})

test('validateSocioRows NO marca inválido un ID_Socio/DNI que existe en OTRA organización (aislamiento multi-tenant)', async () => {
  const supabase = makeFakeSupabase({
    PADRON_SOCIOS: [{ ID_Socio: 'JS-00001', ID_Organizacion: 'OTRA-COOP', socio_dni: '12345678', codigo_finca: null }],
  })
  const [result] = await validateSocioRows(
    [{ ID_Socio: 'JS-00001', socio_nombre_completo: 'Nuevo', socio_dni: '12345678' }],
    supabase,
    'COOP-JS'
  )
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('validateParcelaRows marca inválido un ID_Parcela_Fija/parcela_codigo que ya existe en la BD', async () => {
  const supabase = makeFakeSupabase({
    PADRON_PARCELAS: [{ ID_Parcela_Fija: 'COOP-JS-001', ID_Organizacion: 'COOP-JS', parcela_codigo: 'P-01' }],
    PADRON_SOCIOS: [{ ID_Socio: 'JS-01', ID_Organizacion: 'COOP-JS' }],
  })
  const [result] = await validateParcelaRows(
    [{ ID_Parcela_Fija: 'COOP-JS-001', ID_Socio: 'JS-01', hcp: '2' }],
    supabase,
    'COOP-JS'
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('ya existe en esta organización')))
})

test('validateParcelaRows marca inválido un ID_Socio que no existe en la BD de la organización, con el mensaje pedido', async () => {
  const supabase = makeFakeSupabase({ PADRON_SOCIOS: [], PADRON_PARCELAS: [] })
  const [result] = await validateParcelaRows(
    [{ ID_Parcela_Fija: 'COOP-JS-099', ID_Socio: 'JS-INVENTADO', hcp: '2' }],
    supabase,
    'COOP-JS'
  )
  assert.equal(result.valid, false)
  assert.ok(
    result.errors.some((e) =>
      e.includes('El Código de Socio "JS-INVENTADO" no existe en la organización activa. Debe registrar al socio antes de importar sus parcelas.')
    )
  )
})

test('validateParcelaRows con ID_Socio real en la BD no marca error de "no existe"', async () => {
  const supabase = makeFakeSupabase({
    PADRON_SOCIOS: [{ ID_Socio: 'JS-01', ID_Organizacion: 'COOP-JS' }],
    PADRON_PARCELAS: [],
  })
  const [result] = await validateParcelaRows(
    [{ ID_Parcela_Fija: 'COOP-JS-099', ID_Socio: 'JS-01', hcp: '2' }],
    supabase,
    'COOP-JS'
  )
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('validateSocioRows/validateParcelaRows sin supabase/organizationId no intentan tocar la BD (compatibilidad hacia atrás)', async () => {
  const [result] = await validateSocioRows([{ ID_Socio: 'JS-01', socio_nombre_completo: 'Uno' }])
  assert.equal(result.valid, true)
  const [resultParcela] = await validateParcelaRows([{ ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2' }])
  assert.equal(resultParcela.valid, true)
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
