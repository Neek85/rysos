// Pruebas de lib/padronCsv.js — construcción y parseo de CSV para
// exportación/importación masiva del Padrón. Ver specs/padron_web_socios.md
// y specs/mejoras_importador_padron_masivo.md (cert_org_estatus, avisos no
// bloqueantes por columna no reconocida, validación de columna dispareja).
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
  fetchSocioCertOrgEstatus,
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
  // ADR-028: "Ha. Café Podado" -> "Ha. En Producción" (ya no exclusivo de café).
  assert.ok(header.includes('Ha. En Producción'))
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

test('buildSocioTemplateCsv incluye cert_org_estatus reactivado (columna fija, no dinámica)', () => {
  const csv = buildSocioTemplateCsv()
  const [header, row] = csv.split('\r\n')
  assert.ok(header.includes('Estatus de Certificación Orgánica'))
  assert.ok(row.includes('Organico'))
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
  const { rows: results } = await validateParcelaRows(parseCsv(csv))
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
  const { rows: [result] } = await validateSocioRows([{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba Import' }])
  assert.equal(result.valid, true)
  assert.equal(result.errors.length, 0)
})

test('validateSocioRows marca como inválida una fila sin ID_Socio, con el motivo', async () => {
  const { rows: [result] } = await validateSocioRows([{ ID_Socio: '', socio_nombre_completo: 'Sin código' }])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('ID_Socio')))
})

test('validateSocioRows marca como inválido un DNI con formato incorrecto', async () => {
  const { rows: [result] } = await validateSocioRows([{ ID_Socio: 'JS-01', socio_nombre_completo: 'X', socio_dni: '123' }])
  assert.equal(result.valid, false)
})

test('validateParcelaRows marca como inválida una parcela con área total 0', async () => {
  const { rows: [result] } = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '0', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('hectáreas')))
})

test('validateParcelaRows acepta una parcela con área total > 0', async () => {
  const { rows: [result] } = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2.5', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(result.valid, true)
})

test('validateParcelaRows rechaza hectáreas negativas', async () => {
  const { rows: [result] } = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '-1', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(result.valid, false)
})

test('validateSocioRows/validateParcelaRows con lista vacía devuelve rows: []', async () => {
  assert.deepEqual((await validateSocioRows([])).rows, [])
  assert.deepEqual((await validateParcelaRows([])).rows, [])
})

test('validateSocioRows/validateParcelaRows con lista vacía devuelve unrecognizedColumns: []', async () => {
  assert.deepEqual((await validateSocioRows([])).unrecognizedColumns, [])
  assert.deepEqual((await validateParcelaRows([])).unrecognizedColumns, [])
})

// ---------------------------------------------------------------
// Encabezados legibles en importación (normalizeRowKeys)
// ---------------------------------------------------------------

test('validateSocioRows acepta encabezados legibles ("Código de Socio", "Nombre Completo") igual que los técnicos', async () => {
  const { rows: [result] } = await validateSocioRows([{ 'Código de Socio': 'JS-00099', 'Nombre Completo': 'Prueba Import' }])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.ID_Socio, 'JS-00099')
})

test('validateSocioRows acepta encabezados técnicos en minúsculas/mayúsculas distintas ("id_socio")', async () => {
  const { rows: [result] } = await validateSocioRows([{ id_socio: 'JS-00099', socio_nombre_completo: 'Prueba Import' }])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('validateParcelaRows acepta encabezados legibles ("Código de Parcela", "Ha. En Producción")', async () => {
  const { rows: [result] } = await validateParcelaRows([
    { 'Código de Parcela': 'P-01', 'Código de Socio': 'JS-01', 'Ha. En Producción': '2.5' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.ID_Parcela_Fija, 'P-01')
})

test('validateSocioRows acepta cert_org_estatus por su encabezado legible y por el técnico', async () => {
  const { rows: [byLabel] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', 'Estatus de Certificación Orgánica': 'Organico' },
  ])
  assert.equal(byLabel.valid, true, JSON.stringify(byLabel.errors))
  assert.equal(byLabel.data.cert_org_estatus, 'Organico')

  const { rows: [byTechnicalKey] } = await validateSocioRows([
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', cert_org_estatus: 'Sin Estatus' },
  ])
  assert.equal(byTechnicalKey.valid, true, JSON.stringify(byTechnicalKey.errors))
  assert.equal(byTechnicalKey.data.cert_org_estatus, 'Sin Estatus')
})

// ---------------------------------------------------------------
// Duplicados internos del archivo
// ---------------------------------------------------------------

test('validateSocioRows marca inválidas AMBAS filas con el mismo ID_Socio repetido en el archivo', async () => {
  const { rows: results } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno' },
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Dos' },
  ])
  assert.equal(results[0].valid, false)
  assert.equal(results[1].valid, false)
  assert.ok(results[0].errors.some((e) => e.includes('duplicado')))
  assert.ok(results[1].errors.some((e) => e.includes('duplicado')))
})

test('validateSocioRows marca inválidas las filas con el mismo DNI repetido, aunque el ID_Socio sea distinto', async () => {
  const { rows: results } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '12345678' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '12345678' },
  ])
  assert.equal(results[0].valid, false)
  assert.equal(results[1].valid, false)
  assert.ok(results[0].errors.some((e) => e.includes('DNI duplicado')))
})

test('validateSocioRows no marca duplicado un DNI vacío repetido (campo opcional)', async () => {
  const { rows: results } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos' },
  ])
  assert.equal(results[0].valid, true)
  assert.equal(results[1].valid, true)
})

test('validateParcelaRows marca inválidas ambas filas con el mismo ID_Parcela_Fija repetido', async () => {
  const { rows: results } = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2' },
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-02', hcp: '3' },
  ])
  assert.equal(results[0].valid, false)
  assert.equal(results[1].valid, false)
})

test('validateSocioRows no confunde filas distintas sin valores repetidos', async () => {
  const { rows: results } = await validateSocioRows([
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
  const { rows: [result] } = await validateSocioRows(
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
  const { rows: [result] } = await validateSocioRows(
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
  const { rows: [result] } = await validateSocioRows(
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
  const { rows: [result] } = await validateSocioRows(
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
  const { rows: [result] } = await validateParcelaRows(
    [{ ID_Parcela_Fija: 'COOP-JS-001', ID_Socio: 'JS-01', hcp: '2' }],
    supabase,
    'COOP-JS'
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('ya existe en esta organización')))
})

test('validateParcelaRows marca inválido un ID_Socio que no existe en la BD de la organización, con el mensaje pedido', async () => {
  const supabase = makeFakeSupabase({ PADRON_SOCIOS: [], PADRON_PARCELAS: [] })
  const { rows: [result] } = await validateParcelaRows(
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
  const { rows: [result] } = await validateParcelaRows(
    [{ ID_Parcela_Fija: 'COOP-JS-099', ID_Socio: 'JS-01', hcp: '2' }],
    supabase,
    'COOP-JS'
  )
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('validateSocioRows/validateParcelaRows sin supabase/organizationId no intentan tocar la BD (compatibilidad hacia atrás)', async () => {
  const { rows: [result] } = await validateSocioRows([{ ID_Socio: 'JS-01', socio_nombre_completo: 'Uno' }])
  assert.equal(result.valid, true)
  const { rows: [resultParcela] } = await validateParcelaRows([{ ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2' }])
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

// ---------------------------------------------------------------
// ADR-027: certificaciones normalizadas -- columnas dinámicas de CSV
// ---------------------------------------------------------------

const RAINFOREST_CERT = { id: 'cert-rainforest-uuid', codigo: 'RAINFOREST', nombre: 'Rainforest Alliance', activo: true }
const NOP_USDA_CERT = { id: 'cert-nop-usda-uuid', codigo: 'NOP_USDA', nombre: 'NOP USDA', activo: true }

test('buildSociosCsv sin certificaciones no agrega ninguna columna extra (compatibilidad hacia atrás)', () => {
  const csv = buildSociosCsv([{ ID_Socio: 'JS-00001', socio_nombre_completo: 'Juan Pérez' }])
  const header = csv.split('\r\n')[0]
  assert.ok(!header.includes('Rainforest'))
})

test('buildSociosCsv con certificaciones agrega una columna por cada una, con su `nombre` como encabezado', () => {
  const csv = buildSociosCsv(
    [{ ID_Socio: 'JS-00001', socio_nombre_completo: 'Juan Pérez', [RAINFOREST_CERT.id]: 'Sí' }],
    [RAINFOREST_CERT]
  )
  const [header, dataRow] = csv.split('\r\n')
  assert.ok(header.includes('Rainforest Alliance'))
  assert.ok(dataRow.endsWith(',Sí') || dataRow.endsWith(',"Sí"'))
})

test('buildSocioTemplateCsv con certificaciones agrega columnas dinámicas en "No" por defecto', () => {
  const csv = buildSocioTemplateCsv(undefined, [RAINFOREST_CERT, NOP_USDA_CERT])
  const [header, row] = csv.split('\r\n')
  assert.ok(header.includes('Rainforest Alliance'))
  assert.ok(header.includes('NOP USDA'))
  const cells = row.split(',')
  assert.equal(cells[cells.length - 1], 'No')
  assert.equal(cells[cells.length - 2], 'No')
})

test('validateSocioRows con supabase reconoce una columna de certificación por su `nombre` activo y la traduce al campo interno fijo', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [RAINFOREST_CERT] })
  const { rows: [result] } = await validateSocioRows(
    [{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba', 'Rainforest Alliance': 'Sí' }],
    supabase
  )
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.normalized.cert_rainforest, 'Sí')
})

test('validateSocioRows sin supabase (modo offline) NO valida columnas de certificación -- las deja pasar sin reconocer, sin rechazar el archivo', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba', 'Rainforest Alliance': 'Sí' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

// ---------------------------------------------------------------
// Mejoras importador padrón masivo (2026-08-31):
//  - columna no reconocida -> aviso no bloqueante (Socios y Parcelas)
//  - validación de "columna dispareja" -> bloquea el archivo completo
//  - cert_org_estatus en vivo (fetchSocioCertOrgEstatus)
// Ver specs/mejoras_importador_padron_masivo.md
// ---------------------------------------------------------------

test('validateSocioRows con supabase YA NO rechaza el archivo por una columna no reconocida (typo) -- la reporta en unrecognizedColumns', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [RAINFOREST_CERT] })
  const { rows, unrecognizedColumns } = await validateSocioRows(
    [{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba', 'Rainforezt Alliance': 'Sí' }],
    supabase
  )
  assert.equal(rows[0].valid, true, JSON.stringify(rows[0].errors)) // la fila se procesa igual, la columna typo se ignora
  assert.deepEqual(unrecognizedColumns, ['Rainforezt Alliance'])
})

test('validateSocioRows con supabase reporta en unrecognizedColumns una columna de certificación INACTIVA (no en el catálogo activo)', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [] }) // ninguna activa
  const { rows, unrecognizedColumns } = await validateSocioRows(
    [{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba', 'Rainforest Alliance': 'Sí' }],
    supabase
  )
  assert.equal(rows[0].valid, true, JSON.stringify(rows[0].errors))
  assert.deepEqual(unrecognizedColumns, ['Rainforest Alliance'])
})

test('validateSocioRows sin supabase no calcula unrecognizedColumns (mismo criterio de degradación offline de siempre)', async () => {
  const { unrecognizedColumns } = await validateSocioRows([
    { ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba', 'Columna Rara': 'x' },
  ])
  assert.deepEqual(unrecognizedColumns, [])
})

test('validateParcelaRows reporta en unrecognizedColumns una columna con typo, SIN supabase (no depende de catálogo dinámico) y sin rechazar el archivo', async () => {
  const { rows, unrecognizedColumns } = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2', 'Columna Inventada': 'x' },
  ])
  assert.equal(rows[0].valid, true, JSON.stringify(rows[0].errors))
  assert.deepEqual(unrecognizedColumns, ['Columna Inventada'])
})

test('validateParcelaRows con encabezados válidos no reporta ninguna columna no reconocida', async () => {
  const { unrecognizedColumns } = await validateParcelaRows([{ ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2' }])
  assert.deepEqual(unrecognizedColumns, [])
})

test('validateSocioRows bloquea el archivo COMPLETO si una columna no obligatoria tiene al menos 1 valor y al menos 1 vacío (DNI)', async () => {
  await assert.rejects(
    () =>
      validateSocioRows([
        { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111' },
        { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '' },
      ]),
    (err) => {
      assert.ok(err.message.includes('DNI'), err.message)
      assert.ok(err.message.includes('fila(s) 3'), err.message) // fila 1 = encabezado, fila 3 = 2da fila de datos
      return true
    }
  )
})

test('validateSocioRows NO bloquea si la columna no obligatoria está vacía en TODAS las filas (dato no cargado todavía)', async () => {
  const { rows } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '' },
  ])
  assert.equal(rows.length, 2)
})

test('validateSocioRows NO bloquea si la columna no obligatoria está completa en TODAS las filas', async () => {
  const { rows } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '22222222' },
  ])
  assert.equal(rows.length, 2)
})

test('validateParcelaRows bloquea el archivo COMPLETO si parcela_codigo tiene al menos 1 valor y al menos 1 vacío', async () => {
  await assert.rejects(
    () =>
      validateParcelaRows([
        { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2', parcela_codigo: 'INT-01' },
        { ID_Parcela_Fija: 'P-02', ID_Socio: 'JS-01', hcp: '3', parcela_codigo: '' },
      ]),
    (err) => {
      assert.ok(err.message.includes('Código Interno de Parcela'), err.message)
      return true
    }
  )
})

test('validateParcelaRows NO bloquea por columna dispareja en las 7 hectáreas individuales (excluidas a propósito, spec sección 3.4)', async () => {
  const { rows } = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
    { ID_Parcela_Fija: 'P-02', ID_Socio: 'JS-01', hcp: '', hcc: '3', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.valid))
})

test('validateSocioRows bloquea por columna dispareja en una certificación dinámica (CERT_FLAG_FIELDS sí queda en el chequeo, a diferencia de las hectáreas)', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [RAINFOREST_CERT] })
  await assert.rejects(
    () =>
      validateSocioRows(
        [
          { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', 'Rainforest Alliance': 'Sí' },
          { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', 'Rainforest Alliance': '' },
        ],
        supabase
      ),
    (err) => {
      assert.ok(err.message.includes('Rainforest Alliance'), err.message)
      return true
    }
  )
})

// ── fetchSocioCertOrgEstatus (spec sección 1.4 -- export en vivo) ──────

test('fetchSocioCertOrgEstatus con socioIds vacío devuelve un Map vacío sin consultar la BD', async () => {
  const result = await fetchSocioCertOrgEstatus(makeFakeSupabase({}), [])
  assert.equal(result.size, 0)
})

test('fetchSocioCertOrgEstatus resuelve el estado real desde SOCIO_CERTIFICACIONES cuando las 5 orgánicas coinciden', async () => {
  const supabase = makeFakeSupabase({
    CERTIFICACIONES_CATALOGO: [
      { id: 'cert-nop-usda', codigo: 'NOP_USDA' },
      { id: 'cert-ue', codigo: 'UE_2018_848' },
    ],
    SOCIO_CERTIFICACIONES: [
      { id_socio: 'socio-1', id_certificacion: 'cert-nop-usda', estado: 'Organico', actualizado_en: '2026-08-20T00:00:00Z' },
      { id_socio: 'socio-1', id_certificacion: 'cert-ue', estado: 'Organico', actualizado_en: '2026-08-20T00:00:00Z' },
    ],
  })
  const result = await fetchSocioCertOrgEstatus(supabase, ['socio-1'])
  assert.equal(result.get('socio-1'), 'Organico')
})

test('fetchSocioCertOrgEstatus con estado divergente entre las orgánicas usa el de actualizado_en más reciente', async () => {
  const supabase = makeFakeSupabase({
    CERTIFICACIONES_CATALOGO: [
      { id: 'cert-nop-usda', codigo: 'NOP_USDA' },
      { id: 'cert-ue', codigo: 'UE_2018_848' },
    ],
    SOCIO_CERTIFICACIONES: [
      { id_socio: 'socio-1', id_certificacion: 'cert-nop-usda', estado: 'Organico', actualizado_en: '2026-08-01T00:00:00Z' },
      { id_socio: 'socio-1', id_certificacion: 'cert-ue', estado: 'Sin Estatus', actualizado_en: '2026-08-25T00:00:00Z' },
    ],
  })
  const result = await fetchSocioCertOrgEstatus(supabase, ['socio-1'])
  assert.equal(result.get('socio-1'), 'Sin Estatus') // el más reciente (2026-08-25)
})

test('fetchSocioCertOrgEstatus para un socio sin ninguna certificación orgánica registrada no aparece en el Map (el caller usa ?? "")', async () => {
  const supabase = makeFakeSupabase({
    CERTIFICACIONES_CATALOGO: [{ id: 'cert-nop-usda', codigo: 'NOP_USDA' }],
    SOCIO_CERTIFICACIONES: [],
  })
  const result = await fetchSocioCertOrgEstatus(supabase, ['socio-sin-certs'])
  assert.equal(result.has('socio-sin-certs'), false)
})

// ── Ida y vuelta cert_org_estatus: import (CSV -> Zod) -> el mismo
//    camino que ya usa createSocio/syncSocioCertificaciones -> export en
//    vivo (fetchSocioCertOrgEstatus) refleja el valor real ──────────────

test('cert_org_estatus: ida y vuelta -- el valor importado del CSV, una vez en SOCIO_CERTIFICACIONES, es el que exporta fetchSocioCertOrgEstatus', async () => {
  // 1. Import: el CSV trae cert_org_estatus -- validateSocioRows lo deja
  //    en row.data.cert_org_estatus (mismo objeto que createSocio
  //    recibiría como `values`, ver sociosActions.js:349-351).
  const { rows: [imported] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', cert_org_estatus: 'Organico' },
  ])
  assert.equal(imported.valid, true, JSON.stringify(imported.errors))
  assert.equal(imported.data.cert_org_estatus, 'Organico')

  // 2. syncSocioCertificaciones (sociosActions.js, no se reimplementa acá)
  //    escribiría este valor a SOCIO_CERTIFICACIONES.estado para las 5
  //    orgánicas marcadas 'Sí' -- se simula el resultado de esa escritura
  //    directamente en el fake de Supabase.
  const supabase = makeFakeSupabase({
    CERTIFICACIONES_CATALOGO: [{ id: 'cert-nop-usda', codigo: 'NOP_USDA' }],
    SOCIO_CERTIFICACIONES: [
      { id_socio: 'socio-1-uuid', id_certificacion: 'cert-nop-usda', estado: imported.data.cert_org_estatus, actualizado_en: '2026-08-31T00:00:00Z' },
    ],
  })

  // 3. Export: fetchSocioCertOrgEstatus lee el valor EN VIVO, no el
  //    congelado de PADRON_SOCIOS.
  const exported = await fetchSocioCertOrgEstatus(supabase, ['socio-1-uuid'])
  assert.equal(exported.get('socio-1-uuid'), 'Organico')
})
