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
  decodeCsvBuffer,
  groupValidationErrors,
  SOCIO_FIELD_LABELS,
  PARCELA_FIELD_LABELS,
  DUPLICATE_SKIP_SUFFIX,
} from '../lib/padronCsv.js'
import { HECTARE_FIELDS } from '../lib/validations/socios.js'

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
// Soporte CSV delimitador flexible (spec soporte_csv_delimitador_flexible.md)
// ---------------------------------------------------------------

test('parseCsv con archivo 100% coma sigue funcionando igual que siempre (regresión, encabezados reales)', () => {
  const rows = parseCsv('ID_Socio,socio_nombre_completo\nJS-01,Juan Pérez\nJS-02,Ana López')
  assert.deepEqual(rows, [
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Juan Pérez' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Ana López' },
  ])
})

test('parseCsv detecta y parsea un archivo 100% punto y coma', () => {
  const rows = parseCsv('ID_Socio;socio_nombre_completo\nJS-01;Juan Pérez\nJS-02;Ana López')
  assert.deepEqual(rows, [
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Juan Pérez' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Ana López' },
  ])
})

test('parseCsv con ";" no confunde una coma embebida en un valor entre comillas con el delimitador', () => {
  const rows = parseCsv('ID_Socio;socio_nombre_completo\nJS-01;"Pérez, Juan"')
  assert.deepEqual(rows, [{ ID_Socio: 'JS-01', socio_nombre_completo: 'Pérez, Juan' }])
})

test('parseCsv ignora BOM UTF-8 con delimitador ";" (BOM presente)', () => {
  const rows = parseCsv('﻿ID_Socio;socio_nombre_completo\nJS-01;Juan Pérez')
  assert.deepEqual(rows, [{ ID_Socio: 'JS-01', socio_nombre_completo: 'Juan Pérez' }])
})

test('parseCsv con delimitador ";" y SIN BOM funciona igual (BOM ausente)', () => {
  const rows = parseCsv('ID_Socio;socio_nombre_completo\nJS-01;Juan Pérez')
  assert.deepEqual(rows, [{ ID_Socio: 'JS-01', socio_nombre_completo: 'Juan Pérez' }])
})

test('parseCsv rechaza el archivo COMPLETO si el número de columnas es inconsistente entre filas (delimitador mezclado)', () => {
  // Cabecera sniffea ';' (2 ';' vs 0 ','), pero la 2da fila de datos en
  // realidad usa ',' -- termina con menos columnas que la cabecera.
  const csv = 'ID_Socio;socio_nombre_completo;socio_dni\nJS-01;Juan Pérez;11111111\nJS-02,Ana López,22222222'
  assert.throws(() => parseCsv(csv), (err) => {
    assert.ok(err.message.includes('número de columnas inconsistente'), err.message)
    assert.ok(err.message.includes('3 columna(s)'), err.message) // la cabecera tiene 3
    assert.ok(err.message.includes('fila 3'), err.message) // fila 1 = encabezado, fila 3 = 2da fila de datos
    return true
  })
})

test('parseCsv con una sola columna (sin "," ni ";" en ningún lado) sigue funcionando como siempre', () => {
  const rows = parseCsv('nombre\nJuan\nAna')
  assert.deepEqual(rows, [{ nombre: 'Juan' }, { nombre: 'Ana' }])
})

test('validateParcelaRows acepta hectáreas en formato "1,5" (coma decimal) bajo delimitador ";"', async () => {
  const rows = parseCsv('ID_Parcela_Fija;ID_Socio;hcp\nP-01;JS-01;1,5')
  const { rows: [result] } = await validateParcelaRows(rows)
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.hcp, 1.5)
})

test('validateParcelaRows sigue aceptando hectáreas en formato "1.5" (punto decimal, sin cambios)', async () => {
  const { rows: [result] } = await validateParcelaRows([{ ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '1.5' }])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.hcp, 1.5)
})

test('validateParcelaRows con hectáreas mixtas "1,5"/"2"/vacío bajo ";" NO bloquea por columna dispareja (las 7 de hectárea siguen excluidas)', async () => {
  const rows = parseCsv('ID_Parcela_Fija;ID_Socio;hcp;hcc\nP-01;JS-01;1,5;\nP-02;JS-01;2;3,5')
  const { rows: results } = await validateParcelaRows(rows)
  assert.equal(results.length, 2)
  assert.ok(results.every((r) => r.valid), JSON.stringify(results.map((r) => r.errors)))
  assert.equal(results[0].data.hcp, 1.5)
  assert.equal(results[1].data.hcc, 3.5)
})

test('normalizeDecimalComma (vía validateParcelaRows): un valor con punto Y coma ("1.234,56", agrupación de miles) se deja tal cual y falla la coerción Zod', async () => {
  const { rows: [result] } = await validateParcelaRows([{ ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '1.234,56' }])
  assert.equal(result.valid, false)
})

// ---------------------------------------------------------------
// validateSocioRows / validateParcelaRows
// ---------------------------------------------------------------

test('validateSocioRows marca como válida una fila con ID_Socio, nombre y DNI', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba Import', socio_dni: '12345678' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.errors.length, 0)
})

test('validateSocioRows marca como inválida una fila sin ID_Socio, con el motivo (mensaje legible, ronda 6: label humano, no la clave técnica)', async () => {
  const { rows: [result] } = await validateSocioRows([{ ID_Socio: '', socio_nombre_completo: 'Sin código' }])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Código de Socio') && e.includes('obligatorio')), JSON.stringify(result.errors))
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

test('validateSocioRows acepta encabezados legibles ("Código de Socio", "Nombre Completo", "DNI") igual que los técnicos', async () => {
  const { rows: [result] } = await validateSocioRows([
    { 'Código de Socio': 'JS-00099', 'Nombre Completo': 'Prueba Import', DNI: '12345678' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.ID_Socio, 'JS-00099')
})

test('validateSocioRows acepta encabezados técnicos en minúsculas/mayúsculas distintas ("id_socio")', async () => {
  const { rows: [result] } = await validateSocioRows([
    { id_socio: 'JS-00099', socio_nombre_completo: 'Prueba Import', socio_dni: '12345678' },
  ])
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
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', 'Estatus de Certificación Orgánica': 'Organico' },
  ])
  assert.equal(byLabel.valid, true, JSON.stringify(byLabel.errors))
  assert.equal(byLabel.data.cert_org_estatus, 'Organico')

  const { rows: [byTechnicalKey] } = await validateSocioRows([
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '22222222', cert_org_estatus: 'Sin Estatus' },
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

test('validateSocioRows marca inválida una fila sin DNI (ahora requerido, ronda 3) sin marcarla como duplicado', async () => {
  const { rows: results } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos' },
  ])
  assert.equal(results[0].valid, false)
  assert.equal(results[1].valid, false)
  assert.ok(results[0].errors.some((e) => e.includes('DNI') && e.includes('obligatorio')), JSON.stringify(results[0].errors))
  assert.ok(!results[0].errors.some((e) => e.includes('duplicado')))
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

// Mock mínimo de Supabase, sin red: un builder encadenable
// .from().select().eq().in() que resuelve como una promesa (thenable).
// Sigue en uso para CERTIFICACIONES_CATALOGO/SOCIO_CERTIFICACIONES
// (fetchSocioCertOrgEstatus más abajo) -- esas 2 tablas NO son parte del
// reemplazo SECURITY DEFINER (solo PADRON_SOCIOS/PADRON_PARCELAS lo son,
// ver AI_STATE.md "Reemplazo SECURITY DEFINER para lecturas de
// PADRON_SOCIOS/PADRON_PARCELAS") -- siguen leyéndose directo con la
// llave `anon` tal cual, sin cambios.
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

// ---------------------------------------------------------------
// Pre-validación contra la BD en la vista previa (organizationId
// opcional) — reescrito 2026-09-01 (ver AI_STATE.md "Reemplazo SECURITY
// DEFINER para lecturas de PADRON_SOCIOS/PADRON_PARCELAS"):
// applySocioDbChecks/applyParcelaDbChecks ya no consultan las tablas
// directo con un query builder falso -- llaman a
// fn_padron_socios_existentes/fn_padron_parcelas_existentes (SECURITY
// DEFINER). Acá se inyecta un fake de esas 2 funciones (mismo shape que
// la función SQL real: recibe organizationId + arrays, devuelve las
// filas que matchean DENTRO de esa organización) para seguir probando
// que validateSocioRows/validateParcelaRows arman los mensajes de error
// correctos a partir de lo que la función devuelve -- el aislamiento
// multi-tenant REAL (que la función SQL nunca devuelva una fila de otra
// organización aunque el JS se lo pidiera) se prueba contra la función
// real en tests/test_padron_read_functions_live.mjs.
// ---------------------------------------------------------------

/** Fake de fn_padron_socios_existentes -- filtra por organización, igual que la función SQL real. */
function makeFakeSociosExistentes(rows) {
  return async (organizationId, { idSocios = [], dnis = [], codigosFinca = [] } = {}) =>
    rows.filter(
      (r) =>
        r.ID_Organizacion === organizationId &&
        (idSocios.includes(r.ID_Socio) || dnis.includes(r.socio_dni) || codigosFinca.includes(r.codigo_finca))
    )
}

/** Fake de fn_padron_parcelas_existentes -- misma lógica, para PADRON_PARCELAS. */
function makeFakeParcelasExistentes(rows) {
  return async (organizationId, { ids = [], codigos = [] } = {}) =>
    rows.filter((r) => r.ID_Organizacion === organizationId && (ids.includes(r.ID_Parcela_Fija) || codigos.includes(r.parcela_codigo)))
}

test('validateSocioRows marca inválido un ID_Socio que ya existe en la BD de la organización activa', async () => {
  const fetchSociosExistentes = makeFakeSociosExistentes([
    { ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', socio_dni: null, codigo_finca: null },
  ])
  const { rows: [result] } = await validateSocioRows(
    [{ ID_Socio: 'JS-00001', socio_nombre_completo: 'Ya Existe' }],
    null,
    'COOP-JS',
    { fetchSociosExistentes }
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('ya existe')))
})

test('validateSocioRows marca inválido un DNI que ya existe en la BD, con el mensaje pedido', async () => {
  const fetchSociosExistentes = makeFakeSociosExistentes([
    { ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', socio_dni: '12345678', codigo_finca: null },
  ])
  const { rows: [result] } = await validateSocioRows(
    [{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Nuevo', socio_dni: '12345678' }],
    null,
    'COOP-JS',
    { fetchSociosExistentes }
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('El DNI 12345678 ya existe en esta organización')))
})

test('validateSocioRows marca inválido un codigo_finca que ya existe en la BD', async () => {
  const fetchSociosExistentes = makeFakeSociosExistentes([
    { ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', socio_dni: null, codigo_finca: 'F-001' },
  ])
  const { rows: [result] } = await validateSocioRows(
    [{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Nuevo', codigo_finca: 'F-001' }],
    null,
    'COOP-JS',
    { fetchSociosExistentes }
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('El Código de Finca "F-001" ya existe')))
})

test('validateSocioRows NO marca inválido un ID_Socio/DNI que existe en OTRA organización (aislamiento multi-tenant)', async () => {
  const fetchSociosExistentes = makeFakeSociosExistentes([
    { ID_Socio: 'JS-00001', ID_Organizacion: 'OTRA-COOP', socio_dni: '12345678', codigo_finca: null },
  ])
  const { rows: [result] } = await validateSocioRows(
    [{ ID_Socio: 'JS-00001', socio_nombre_completo: 'Nuevo', socio_dni: '12345678' }],
    null,
    'COOP-JS',
    { fetchSociosExistentes }
  )
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('validateParcelaRows marca inválido un ID_Parcela_Fija/parcela_codigo que ya existe en la BD, con el mensaje de duplicado-se-omite (ronda 9)', async () => {
  const fetchParcelasExistentes = makeFakeParcelasExistentes([
    { ID_Parcela_Fija: 'COOP-JS-001', ID_Organizacion: 'COOP-JS', parcela_codigo: 'P-01' },
  ])
  const fetchSociosExistentes = makeFakeSociosExistentes([{ ID_Socio: 'JS-01', ID_Organizacion: 'COOP-JS' }])
  const { rows: [result] } = await validateParcelaRows(
    [{ ID_Parcela_Fija: 'COOP-JS-001', ID_Socio: 'JS-01', hcp: '2' }],
    'COOP-JS',
    { fetchParcelasExistentes, fetchSociosExistentes }
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Esta parcela ya está registrada') && e.includes(DUPLICATE_SKIP_SUFFIX)))
})

test('validateSocioRows marca inválido un ID_Socio que ya existe en la BD, con el mensaje de duplicado-se-omite (ronda 9)', async () => {
  const fetchSociosExistentes = makeFakeSociosExistentes([
    { ID_Socio: 'JS-00001', ID_Organizacion: 'COOP-JS', socio_dni: null, codigo_finca: null },
  ])
  const { rows: [result] } = await validateSocioRows(
    [{ ID_Socio: 'JS-00001', socio_nombre_completo: 'Repetido' }],
    null,
    'COOP-JS',
    { fetchSociosExistentes }
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Este socio ya está registrado') && e.includes(DUPLICATE_SKIP_SUFFIX)))
})

test('validateParcelaRows marca inválido un ID_Socio que no existe en la BD de la organización, con el mensaje pedido', async () => {
  const fetchParcelasExistentes = makeFakeParcelasExistentes([])
  const fetchSociosExistentes = makeFakeSociosExistentes([])
  const { rows: [result] } = await validateParcelaRows(
    [{ ID_Parcela_Fija: 'COOP-JS-099', ID_Socio: 'JS-INVENTADO', hcp: '2' }],
    'COOP-JS',
    { fetchParcelasExistentes, fetchSociosExistentes }
  )
  assert.equal(result.valid, false)
  assert.ok(
    result.errors.some((e) =>
      e.includes('El Código de Socio "JS-INVENTADO" no existe en la organización activa. Debe registrar al socio antes de importar sus parcelas.')
    )
  )
})

test('validateParcelaRows con ID_Socio real en la BD no marca error de "no existe"', async () => {
  const fetchParcelasExistentes = makeFakeParcelasExistentes([])
  const fetchSociosExistentes = makeFakeSociosExistentes([{ ID_Socio: 'JS-01', ID_Organizacion: 'COOP-JS' }])
  const { rows: [result] } = await validateParcelaRows(
    [{ ID_Parcela_Fija: 'COOP-JS-099', ID_Socio: 'JS-01', hcp: '2' }],
    'COOP-JS',
    { fetchParcelasExistentes, fetchSociosExistentes }
  )
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('validateSocioRows/validateParcelaRows sin supabase/organizationId no intentan tocar la BD (compatibilidad hacia atrás)', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
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
    [{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba', socio_dni: '12345678', 'Rainforest Alliance': 'Sí' }],
    supabase
  )
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.normalized.cert_rainforest, 'Sí')
})

// ── 9.1 (ronda 6): tolerancia de variantes Sí/No en los 8 flags de certificación (evidencia real: "Si"/"No"/"SI", nunca "Sí" con tilde) ──

test('validateSocioRows normaliza "Si" (sin tilde, valor real del archivo del usuario) al canónico "Sí" con tilde', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [RAINFOREST_CERT] })
  const { rows: [result] } = await validateSocioRows(
    [{ ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', 'Rainforest Alliance': 'Si' }],
    supabase
  )
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.normalized.cert_rainforest, 'Sí')
  assert.equal(result.data.cert_rainforest, 'Sí')
})

test('validateSocioRows normaliza "SI" en mayúsculas (valor real observado en la columna Rainforest Alliance) al canónico "Sí"', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [RAINFOREST_CERT] })
  const { rows: [result] } = await validateSocioRows(
    [{ ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', 'Rainforest Alliance': 'SI' }],
    supabase
  )
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.cert_rainforest, 'Sí')
})

test('validateSocioRows normaliza "si"/"sí"/"Sí" (minúsculas, con y sin tilde) al mismo canónico "Sí"', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [RAINFOREST_CERT] })
  for (const variante of ['si', 'sí', 'Sí']) {
    const { rows: [result] } = await validateSocioRows(
      [{ ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', 'Rainforest Alliance': variante }],
      supabase
    )
    assert.equal(result.valid, true, `variante "${variante}": ${JSON.stringify(result.errors)}`)
    assert.equal(result.data.cert_rainforest, 'Sí', `variante "${variante}"`)
  }
})

test('validateSocioRows normaliza "no"/"No"/"NO" al canónico "No"', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [RAINFOREST_CERT] })
  for (const variante of ['no', 'No', 'NO']) {
    const { rows: [result] } = await validateSocioRows(
      [{ ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', 'Rainforest Alliance': variante }],
      supabase
    )
    assert.equal(result.valid, true, `variante "${variante}": ${JSON.stringify(result.errors)}`)
    assert.equal(result.data.cert_rainforest, 'No', `variante "${variante}"`)
  }
})

test('validateSocioRows rechaza un valor de flag de certificación que no es reconocible como sí/no, con mensaje legible "Debe ser Sí o No"', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [RAINFOREST_CERT] })
  const { rows: [result] } = await validateSocioRows(
    [{ ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', 'Rainforest Alliance': 'Tal vez' }],
    supabase
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Debe ser Sí o No')), JSON.stringify(result.errors))
})

test('normalizeSiNo: el canónico real del sistema es "Sí" con tilde, no "Si" -- confirmado contra sociosActions.js antes de implementar (ver comentario en el código); el flag normalizado ya llega listo para el === "Sí" literal que usa syncSocioCertificaciones', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [RAINFOREST_CERT] })
  const { rows: [result] } = await validateSocioRows(
    [{ ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', 'Rainforest Alliance': 'Si' }],
    supabase
  )
  // Simula exactamente la comparación real de lib/actions/sociosActions.js:322
  assert.equal(result.data.cert_rainforest === 'Sí', true)
})

test('validateSocioRows sin supabase (modo offline) NO valida columnas de certificación -- las deja pasar sin reconocer, sin rechazar el archivo', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba', socio_dni: '12345678', 'Rainforest Alliance': 'Sí' },
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
    [{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba', socio_dni: '12345678', 'Rainforezt Alliance': 'Sí' }],
    supabase
  )
  assert.equal(rows[0].valid, true, JSON.stringify(rows[0].errors)) // la fila se procesa igual, la columna typo se ignora
  assert.deepEqual(unrecognizedColumns, ['Rainforezt Alliance'])
})

test('validateSocioRows con supabase reporta en unrecognizedColumns una columna de certificación INACTIVA (no en el catálogo activo)', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [] }) // ninguna activa
  const { rows, unrecognizedColumns } = await validateSocioRows(
    [{ ID_Socio: 'JS-00099', socio_nombre_completo: 'Prueba', socio_dni: '12345678', 'Rainforest Alliance': 'Sí' }],
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

// Ronda 3 (mejoras_importador_padron_masivo.md, 2026-08-31): "columna
// dispareja" RETIRADO por completo para Socios -- ver el comentario en
// lib/padronCsv.js. Los 4 tests siguientes reemplazan a los que antes
// probaban el bloqueo (ya no existe) -- confirman la exención total,
// incluido el patrón real reportado por el usuario tras la primera carga
// (fecha_nacimiento/celular_socio parcialmente vacíos en el mismo archivo).

test('validateSocioRows NO bloquea el archivo con fecha_nacimiento y celular_socio parcialmente vacíos (patrón real reportado tras la primera carga)', async () => {
  const { rows } = await validateSocioRows([
    {
      ID_Socio: 'JS-01',
      socio_nombre_completo: 'Uno',
      socio_dni: '11111111',
      socio_fecha_nacimiento: '5/6/1984',
      celular_socio: '987654321',
    },
    {
      ID_Socio: 'JS-02',
      socio_nombre_completo: 'Dos',
      socio_dni: '22222222',
      socio_fecha_nacimiento: '',
      celular_socio: '',
    },
  ])
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.valid), JSON.stringify(rows.map((r) => r.errors)))
})

test('validateSocioRows NO bloquea el archivo con codigo_finca/socio_departamento parcialmente vacíos (cualquier campo opcional de Socios, no solo fecha/celular)', async () => {
  const { rows } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', codigo_finca: 'F-001', socio_departamento: 'Cajamarca' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '22222222', codigo_finca: '', socio_departamento: '' },
  ])
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.valid), JSON.stringify(rows.map((r) => r.errors)))
})

test('validateSocioRows NO bloquea si la columna no obligatoria está vacía en TODAS las filas (dato no cargado todavía)', async () => {
  const { rows } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', codigo_finca: '' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '22222222', codigo_finca: '' },
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

test('validateSocioRows NO bloquea columna dispareja en una certificación dinámica (retirado por completo para Socios en la ronda 3, a diferencia de la ronda 2)', async () => {
  const supabase = makeFakeSupabase({ CERTIFICACIONES_CATALOGO: [RAINFOREST_CERT] })
  const { rows } = await validateSocioRows(
    [
      { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', 'Rainforest Alliance': 'Sí' },
      { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '22222222', 'Rainforest Alliance': '' },
    ],
    supabase
  )
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.valid), JSON.stringify(rows.map((r) => r.errors)))
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
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', cert_org_estatus: 'Organico' },
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

// ---------------------------------------------------------------
// Ronda 3 (mejoras_importador_padron_masivo.md, 2026-08-31) --
// controles de calidad post-carga real (COOP-AROMAS-VALLE) + corrección
// de labels de hectáreas.
// ---------------------------------------------------------------

// ── 0.a: decodeCsvBuffer -- causa raíz real de "columnas no reconocidas" ──

test('decodeCsvBuffer decodifica un ArrayBuffer UTF-8 válido normalmente', () => {
  const buffer = new TextEncoder().encode('Código de Parcela,Nombre\nCOOP-001,El Lache')
  const text = decodeCsvBuffer(buffer.buffer)
  assert.equal(text, 'Código de Parcela,Nombre\nCOOP-001,El Lache')
})

test('decodeCsvBuffer cae a windows-1252 cuando el buffer NO es UTF-8 válido (caso real: Excel "CSV" plano)', () => {
  // Mismos bytes exactos que el encabezado real de Plantilla_Parcelas_prueba.csv:
  // 'C' + 0xF3 ('ó' en CP-1252, byte suelto inválido como UTF-8) + 'digo'.
  const buffer = new Uint8Array([0x43, 0xf3, 0x64, 0x69, 0x67, 0x6f]).buffer
  const text = decodeCsvBuffer(buffer)
  assert.equal(text, 'Código')
})

test('decodeCsvBuffer con BOM UTF-8 (caso real: Plantilla_Socios_prueba.csv) decodifica correcto y el BOM sigue removible por parseCsv', () => {
  const buffer = new Uint8Array([0xef, 0xbb, 0xbf, 0x43, 0xc3, 0xb3, 0x64, 0x69, 0x67, 0x6f]).buffer // BOM + "Código" en UTF-8 real
  const text = decodeCsvBuffer(buffer)
  const rows = parseCsv(text + ',x\nval,y') // agrega una fila para que parseCsv tenga contenido válido
  assert.deepEqual(rows, [{ Código: 'val', x: 'y' }])
})

// ── 0.b/1: labels de hectárea hip/hrp corregidos (ronda 3); hip corregido de nuevo en ronda 7 ("Inverna/Pasto" exacto, no "Invernadero/Pasto") ──

test('HECTARE_FIELDS: hip/hrp usan los labels corregidos ("Inverna/Pasto"/"Rastrojo/Purma"), no los viejos', () => {
  const hip = HECTARE_FIELDS.find((f) => f.field === 'hip')
  const hrp = HECTARE_FIELDS.find((f) => f.field === 'hrp')
  assert.equal(hip.label, 'Ha. Inverna/Pasto')
  assert.equal(hrp.label, 'Ha. Rastrojo/Purma')
})

test('PARCELA_FIELD_LABELS/buildParcelaTemplateCsv reflejan el label nuevo de hip/hrp (misma fuente que HECTARE_FIELDS)', () => {
  assert.equal(PARCELA_FIELD_LABELS.hip, 'Ha. Inverna/Pasto')
  assert.equal(PARCELA_FIELD_LABELS.hrp, 'Ha. Rastrojo/Purma')
  const csv = buildParcelaTemplateCsv(['JS-01'])
  const header = csv.split('\r\n')[0]
  assert.ok(header.includes('Ha. Inverna/Pasto'))
  assert.ok(header.includes('Ha. Rastrojo/Purma'))
  assert.ok(!header.includes('Infraestructura Productiva'))
  assert.ok(!header.includes('Reserva/Protección'))
  assert.ok(!header.includes('Invernadero'))
})

// ── 1b: DNI obligatorio ──

test('socio_dni: fila sin DNI queda inválida, con mensaje legible ("DNI: Este campo es obligatorio", no la clave técnica)', async () => {
  const { rows: [result] } = await validateSocioRows([{ ID_Socio: 'JS-01', socio_nombre_completo: 'Uno' }])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('DNI') && e.includes('obligatorio')), JSON.stringify(result.errors))
})

test('socio_dni: fila con 7 dígitos (cero inicial perdido, patrón real de 10 de 618 filas) queda inválida', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '1043464' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('8 dígitos')))
})

test('socio_dni: fila con 8 dígitos válidos es válida', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '46837434' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

// ── 1c/ronda 4: formato ÚNICO y determinístico M/D/AAAA (mes primero) ──
// Reemplaza el diseño ambiguo de la ronda 3 ("acepta D/M o M/D, el que
// matchee") -- ver mejoras_importador_padron_masivo.md sección 7.

test('socio_fecha_nacimiento: acepta el formato real de la primera carga (M/D/AAAA sin ceros, ej. "4/29/1986")', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_fecha_nacimiento: '4/29/1986' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('socio_fecha_nacimiento: fecha ambigua "3/4/1990" se interpreta SIEMPRE como mes/día (4 de marzo) -- válida, determinística, nunca "3 de abril"', async () => {
  // "3/4/1990" es válida en CUALQUIER orden (3 y 4 caben como día o mes) --
  // exactamente el caso ambiguo que motivó esta corrección. El campo sigue
  // siendo texto libre de display (no se parsea a Date en ningún lado del
  // repo), así que lo único verificable en código es que la regla NO
  // depende de cuál interpretación "tiene sentido" -- ver el test
  // siguiente ("13/4/1990") para una prueba más concreta: un valor que
  // SOLO tendría sentido como D/M debe rechazarse, no aceptarse con fallback.
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_fecha_nacimiento: '3/4/1990' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('socio_fecha_nacimiento: "13/4/1990" se RECHAZA -- solo tendría sentido como D/M (día 13, mes 4), y D/M ya no se acepta (antes de esta ronda SÍ pasaba por fallback ambiguo)', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_fecha_nacimiento: '13/4/1990' },
  ])
  assert.equal(result.valid, false)
})

test('socio_fecha_nacimiento: "29/4/1986" (orden día/mes, invertido respecto al real) se RECHAZA como formato inválido, no se acepta silenciosamente', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_fecha_nacimiento: '29/4/1986' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('fecha')))
})

test('socio_fecha_nacimiento: vacío sigue siendo válido (campo opcional)', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_fecha_nacimiento: '' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('socio_fecha_nacimiento: rechaza un valor donde el mes está fuera de rango (ej. "45/13/1990")', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_fecha_nacimiento: '45/13/1990' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('fecha')))
})

test('socio_fecha_nacimiento: rechaza el formato ISO con guiones (ya no se acepta)', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_fecha_nacimiento: '1986-04-29' },
  ])
  assert.equal(result.valid, false)
})

// ── 1d: celular ya validado (confirmación, sin cambios) ──

test('celular_socio: sigue rechazando un valor que no tiene 9 dígitos (regex ya existente, confirmado sin cambios)', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', celular_socio: '12345' },
  ])
  assert.equal(result.valid, false)
})

// ── 1e: DNI duplicado en archivo (ya existía desde antes, confirmado) ──
// Ver 'validateSocioRows marca inválidas las filas con el mismo DNI
// repetido, aunque el ID_Socio sea distinto' más arriba -- mismo
// mecanismo (applyDuplicateChecks), sin cambios en esta ronda.

// ── 1f: Departamento contra catálogo real de Perú ──

test('socio_departamento: rechaza un valor que no es un departamento real de Perú', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_departamento: 'Departamento Inventado' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Departamento')))
})

test('socio_departamento: acepta el valor real de la primera carga ("Cajamarca") y es tolerante a mayúsculas/tildes', async () => {
  const { rows: results } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_departamento: 'Cajamarca' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '22222222', socio_departamento: 'CAJAMARCA' },
    { ID_Socio: 'JS-03', socio_nombre_completo: 'Tres', socio_dni: '33333333', socio_departamento: 'cájamarca' },
  ])
  assert.ok(results.every((r) => r.valid), JSON.stringify(results.map((r) => r.errors)))
})

test('socio_departamento: vacío sigue siendo válido (campo opcional)', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_departamento: '' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

// ── 7: Provincia contra catálogo real (ronda 4) — pertenencia al Departamento de la misma fila ──

test('socio_provincia: acepta una provincia real que pertenece al departamento declarado (Cutervo/Jaén, Cajamarca -- valores reales de la primera carga)', async () => {
  const { rows: results } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_departamento: 'Cajamarca', socio_provincia: 'Cutervo' },
    { ID_Socio: 'JS-02', socio_nombre_completo: 'Dos', socio_dni: '22222222', socio_departamento: 'Cajamarca', socio_provincia: 'Jaén' },
  ])
  assert.ok(results.every((r) => r.valid), JSON.stringify(results.map((r) => r.errors)))
})

test('socio_provincia: rechaza una provincia que EXISTE en el catálogo pero no pertenece al departamento declarado ("Cañete" es de Lima, no de Cajamarca)', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_departamento: 'Cajamarca', socio_provincia: 'Cañete' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Provincia') && e.includes('Cajamarca')), JSON.stringify(result.errors))
})

test('socio_provincia: rechaza una provincia inexistente en el catálogo', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_departamento: 'Cajamarca', socio_provincia: 'Provincia Inventada' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Provincia')))
})

test('socio_provincia: es tolerante a mayúsculas/tildes igual que Departamento', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_departamento: 'CAJAMARCA', socio_provincia: 'jaén' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('socio_provincia: con valor pero SIN Departamento en la misma fila, se rechaza (no se puede validar pertenencia)', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_provincia: 'Cutervo' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Provincia')))
})

test('socio_provincia: vacío sigue siendo válido (campo opcional), incluso con Departamento presente', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_departamento: 'Cajamarca', socio_provincia: '' },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

// ── 8: Distrito contra catálogo real (ronda 5) — pertenencia a la Provincia de la misma fila ──

test('socio_distrito: acepta un distrito real que pertenece a la provincia declarada (Callayuc/Cutervo y Huabal/Jaén, Cajamarca -- valores reales de la primera carga)', async () => {
  const { rows: results } = await validateSocioRows([
    {
      ID_Socio: 'JS-01',
      socio_nombre_completo: 'Uno',
      socio_dni: '11111111',
      socio_departamento: 'Cajamarca',
      socio_provincia: 'Cutervo',
      socio_distrito: 'Callayuc',
    },
    {
      ID_Socio: 'JS-02',
      socio_nombre_completo: 'Dos',
      socio_dni: '22222222',
      socio_departamento: 'Cajamarca',
      socio_provincia: 'Jaén',
      socio_distrito: 'Huabal',
    },
  ])
  assert.ok(results.every((r) => r.valid), JSON.stringify(results.map((r) => r.errors)))
})

test('socio_distrito: rechaza un distrito que EXISTE en el catálogo pero no pertenece a la provincia declarada ("Jaén" es distrito de la provincia Jaén, no de Cutervo)', async () => {
  const { rows: [result] } = await validateSocioRows([
    {
      ID_Socio: 'JS-01',
      socio_nombre_completo: 'Uno',
      socio_dni: '11111111',
      socio_departamento: 'Cajamarca',
      socio_provincia: 'Cutervo',
      socio_distrito: 'Jaén',
    },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Distrito') && e.includes('Cutervo')), JSON.stringify(result.errors))
})

test('socio_distrito: rechaza un distrito inexistente en el catálogo', async () => {
  const { rows: [result] } = await validateSocioRows([
    {
      ID_Socio: 'JS-01',
      socio_nombre_completo: 'Uno',
      socio_dni: '11111111',
      socio_departamento: 'Cajamarca',
      socio_provincia: 'Cutervo',
      socio_distrito: 'Distrito Inventado',
    },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Distrito')))
})

test('socio_distrito: es tolerante a mayúsculas/tildes igual que Departamento/Provincia', async () => {
  const { rows: [result] } = await validateSocioRows([
    {
      ID_Socio: 'JS-01',
      socio_nombre_completo: 'Uno',
      socio_dni: '11111111',
      socio_departamento: 'CAJAMARCA',
      socio_provincia: 'cutervo',
      socio_distrito: 'CALLAYUC',
    },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('socio_distrito: con valor pero SIN Provincia en la misma fila, se rechaza (no se puede validar pertenencia)', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_departamento: 'Cajamarca', socio_distrito: 'Callayuc' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('Distrito')))
})

test('socio_distrito: con valor pero SIN Departamento ni Provincia, no duplica el error de Distrito (ya alcanza con el de Provincia)', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_distrito: 'Callayuc' },
  ])
  assert.equal(result.valid, false)
  // Sin Provincia en la fila, el Distrito no puede validarse -- pero como
  // tampoco había Provincia, ese es el único motivo reportado (no hay
  // Departamento tampoco, así que ni siquiera se intenta resolver Distrito).
  assert.ok(result.errors.some((e) => e.includes('Distrito')))
})

test('socio_distrito: vacío sigue siendo válido (campo opcional), incluso con Departamento/Provincia presentes', async () => {
  const { rows: [result] } = await validateSocioRows([
    {
      ID_Socio: 'JS-01',
      socio_nombre_completo: 'Uno',
      socio_dni: '11111111',
      socio_departamento: 'Cajamarca',
      socio_provincia: 'Cutervo',
      socio_distrito: '',
    },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

// ── 9.2 (ronda 6): confirmación de tolerancia a tildes ya existente en ubigeo, con valores reales tal cual vienen en el archivo del usuario ──

test('validateSocioRows: "Jaén" (provincia y distrito, con tilde real) matchea el catálogo (que también tiene tilde) sin ningún cambio de código -- ya funcionaba', async () => {
  const { rows: [result] } = await validateSocioRows([
    {
      ID_Socio: 'JS-01',
      socio_nombre_completo: 'Uno',
      socio_dni: '11111111',
      socio_departamento: 'Cajamarca',
      socio_provincia: 'Jaén',
      socio_distrito: 'Jaén',
    },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('validateSocioRows: "San José de Lourdes" (distrito real con tilde y espacios, provincia San Ignacio) matchea el catálogo', async () => {
  const { rows: [result] } = await validateSocioRows([
    {
      ID_Socio: 'JS-01',
      socio_nombre_completo: 'Uno',
      socio_dni: '11111111',
      socio_departamento: 'Cajamarca',
      socio_provincia: 'San Ignacio',
      socio_distrito: 'San José de Lourdes',
    },
  ])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('validateSocioRows: un archivo SIN tilde ("Jaen", "San Jose de Lourdes") también matchea -- comparación ya normalizada en ambos sentidos', async () => {
  const { rows: results } = await validateSocioRows([
    {
      ID_Socio: 'JS-01',
      socio_nombre_completo: 'Uno',
      socio_dni: '11111111',
      socio_departamento: 'Cajamarca',
      socio_provincia: 'Jaen',
      socio_distrito: 'Jaen',
    },
    {
      ID_Socio: 'JS-02',
      socio_nombre_completo: 'Dos',
      socio_dni: '22222222',
      socio_departamento: 'Cajamarca',
      socio_provincia: 'San Ignacio',
      socio_distrito: 'San Jose de Lourdes',
    },
  ])
  assert.ok(results.every((r) => r.valid), JSON.stringify(results.map((r) => r.errors)))
})

// ── 9.3/10.1 (rondas 6-7): alias defensivo de labels VIEJOS de hip/hrp (además del canónico actual) ──
// hip tiene 2 alias (2 correcciones sucesivas sobre el mismo campo):
// "Ha. Infraestructura Productiva" (original) y "Ha. Invernadero/Pasto"
// (corrección de la ronda 3, que a su vez resultó tener el texto exacto
// mal -- ronda 7 corrigió al canónico real "Ha. Inverna/Pasto").

test('validateParcelaRows reconoce el label ORIGINAL de hip ("Ha. Infraestructura Productiva") como alias', async () => {
  const rows = parseCsv('ID_Parcela_Fija,ID_Socio,Ha. Infraestructura Productiva\nP-01,JS-01,2.5')
  const { rows: [result], unrecognizedColumns } = await validateParcelaRows(rows)
  assert.deepEqual(unrecognizedColumns, [])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.hip, 2.5)
})

test('validateParcelaRows reconoce el label de la ronda 3 de hip ("Ha. Invernadero/Pasto", palabra completa -- ya no es el canónico) como alias', async () => {
  const rows = parseCsv('ID_Parcela_Fija,ID_Socio,Ha. Invernadero/Pasto\nP-01,JS-01,2.5')
  const { rows: [result], unrecognizedColumns } = await validateParcelaRows(rows)
  assert.deepEqual(unrecognizedColumns, [])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.hip, 2.5)
})

test('validateParcelaRows reconoce el label VIEJO de hrp ("Ha. Reserva/Protección") como alias además del nuevo', async () => {
  const rows = parseCsv('ID_Parcela_Fija,ID_Socio,Ha. Reserva/Protección\nP-01,JS-01,1.5')
  const { rows: [result], unrecognizedColumns } = await validateParcelaRows(rows)
  assert.deepEqual(unrecognizedColumns, [])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.hrp, 1.5)
})

test('validateParcelaRows reconoce el label CANÓNICO actual de hip ("Ha. Inverna/Pasto", texto exacto real) -- los valores se leen correctamente, no se pierden', async () => {
  const rows = parseCsv('ID_Parcela_Fija,ID_Socio,Ha. Inverna/Pasto,Ha. Rastrojo/Purma\nP-01,JS-01,2,3')
  const { rows: [result], unrecognizedColumns } = await validateParcelaRows(rows)
  assert.deepEqual(unrecognizedColumns, [])
  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.equal(result.data.hip, 2)
  assert.equal(result.data.hrp, 3)
})

// ── 9.4 (ronda 6): mensajes de error legibles con label humano en vez de la clave técnica ──

test('validateParcelaRows: hectáreas en 0 usa el label humano ("Ha. En Producción:"), no el prefijo técnico "hcp:"', async () => {
  const { rows: [result] } = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '0', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.startsWith('Ha. En Producción:')), JSON.stringify(result.errors))
  assert.ok(!result.errors.some((e) => e.startsWith('hcp:')), JSON.stringify(result.errors))
})

test('validateSocioRows: celular inválido usa label humano + mensaje legible ("Celular: El celular debe tener 9 dígitos")', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', celular_socio: '123' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e === 'Celular: El celular debe tener 9 dígitos'), JSON.stringify(result.errors))
})

test('validateSocioRows: fecha inválida usa mensaje legible completo ("La fecha debe tener el formato M/D/AAAA (ej: 4/29/1986)")', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_fecha_nacimiento: '1986-04-29' },
  ])
  assert.equal(result.valid, false)
  assert.ok(
    result.errors.some((e) => e.includes('La fecha debe tener el formato M/D/AAAA (ej: 4/29/1986)')),
    JSON.stringify(result.errors)
  )
})

test('validateParcelaRows: ID_Parcela_Fija/ID_Socio requeridos usan label humano + "Este campo es obligatorio"', async () => {
  const { rows: [result] } = await validateParcelaRows([{ ID_Parcela_Fija: '', ID_Socio: '', hcp: '2' }])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e === 'Código de Parcela: Este campo es obligatorio'), JSON.stringify(result.errors))
})

test('validateSocioRows: Departamento fuera de catálogo usa el mensaje "no se reconoce como Departamento válido de Perú"', async () => {
  const { rows: [result] } = await validateSocioRows([
    { ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111', socio_departamento: 'Departamento Inventado' },
  ])
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('no se reconoce como Departamento válido de Perú')), JSON.stringify(result.errors))
})

// ── 1g: aviso no bloqueante de hectáreas ≥1000 ──

test('validateParcelaRows: hectáreas totales ≥1000 generan un aviso no bloqueante en hectareWarnings, la fila igual se importa', async () => {
  const { rows, hectareWarnings } = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '600', hcc: '500', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.equal(rows[0].valid, true, JSON.stringify(rows[0].errors))
  assert.equal(hectareWarnings.length, 1)
  assert.ok(hectareWarnings[0].includes('Fila 2'), hectareWarnings[0])
  assert.ok(hectareWarnings[0].includes('1100'), hectareWarnings[0])
})

test('validateParcelaRows: hectáreas totales <1000 (caso real, máximo observado 30) NO generan aviso', async () => {
  const { hectareWarnings } = await validateParcelaRows([
    { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '30', hcc: '', ho: '', hip: '', hrp: '', hbp: '', otros_cultivo: '' },
  ])
  assert.deepEqual(hectareWarnings, [])
})

test('validateSocioRows no trae hectareWarnings/missingSocioWarnings (no aplican a Socios)', async () => {
  const result = await validateSocioRows([{ ID_Socio: 'JS-01', socio_nombre_completo: 'Uno', socio_dni: '11111111' }])
  assert.equal(result.hectareWarnings, undefined)
  assert.equal(result.missingSocioWarnings, undefined)
})

// ── 1h: mensaje agrupado de ID_Socio no encontrado ──

test('validateParcelaRows: agrupa los ID_Socio no encontrados en missingSocioWarnings, con las filas donde aparecen (caso real: "#N/D" de una fórmula de Excel rota)', async () => {
  const fetchSociosExistentes = makeFakeSociosExistentes([{ ID_Socio: 'JS-01', ID_Organizacion: 'COOP-JS' }])
  const fetchParcelasExistentes = makeFakeParcelasExistentes([])
  const { rows, missingSocioWarnings } = await validateParcelaRows(
    [
      { ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-01', hcp: '2' },
      { ID_Parcela_Fija: 'P-02', ID_Socio: '#N/D', hcp: '3' },
      { ID_Parcela_Fija: 'P-03', ID_Socio: '#N/D', hcp: '1' },
    ],
    'COOP-JS',
    { fetchSociosExistentes, fetchParcelasExistentes }
  )
  assert.equal(rows[0].valid, true, JSON.stringify(rows[0].errors))
  assert.equal(rows[1].valid, false)
  assert.equal(rows[2].valid, false)
  assert.equal(missingSocioWarnings.length, 1) // un solo ID_Socio distinto agrupado, no 2 mensajes repetidos
  assert.ok(missingSocioWarnings[0].includes('#N/D'), missingSocioWarnings[0])
  assert.ok(missingSocioWarnings[0].includes('fila(s) 3, 4'), missingSocioWarnings[0]) // fila 1 = encabezado
})

// ── 9.5 (ronda 6): "#N/D" y otros errores de fórmula de Excel se identifican como tales, no como "socio no encontrado" genérico ──

test('validateParcelaRows: "#N/D" en ID_Socio se reporta como error de fórmula de Excel, no como "socio no encontrado" genérico (ni en missingSocioWarnings ni en el error de fila)', async () => {
  const fetchSociosExistentes = makeFakeSociosExistentes([])
  const fetchParcelasExistentes = makeFakeParcelasExistentes([])
  const { rows, missingSocioWarnings } = await validateParcelaRows(
    [{ ID_Parcela_Fija: 'P-01', ID_Socio: '#N/D', hcp: '2' }],
    'COOP-JS',
    { fetchSociosExistentes, fetchParcelasExistentes }
  )
  assert.equal(rows[0].valid, false)
  assert.ok(rows[0].errors.some((e) => e.includes('error de fórmula')), JSON.stringify(rows[0].errors))
  assert.ok(!rows[0].errors.some((e) => e.includes('no existe en la organización')), JSON.stringify(rows[0].errors))
  assert.ok(missingSocioWarnings[0].includes('error de fórmula'), missingSocioWarnings[0])
})

test('validateParcelaRows: un ID_Socio faltante REAL (no error de fórmula) sigue con el mensaje genérico de siempre', async () => {
  const fetchSociosExistentes = makeFakeSociosExistentes([])
  const fetchParcelasExistentes = makeFakeParcelasExistentes([])
  const { rows, missingSocioWarnings } = await validateParcelaRows(
    [{ ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-INVENTADO', hcp: '2' }],
    'COOP-JS',
    { fetchSociosExistentes, fetchParcelasExistentes }
  )
  assert.equal(rows[0].valid, false)
  assert.ok(rows[0].errors.some((e) => e.includes('no existe en la organización activa')), JSON.stringify(rows[0].errors))
  assert.ok(!rows[0].errors.some((e) => e.includes('error de fórmula')), JSON.stringify(rows[0].errors))
  assert.ok(missingSocioWarnings[0].includes('no existe en la organización activa'), missingSocioWarnings[0])
})

test('validateParcelaRows: sin supabase/organizationId, missingSocioWarnings queda vacío (mismo gating que applyParcelaDbChecks)', async () => {
  const { missingSocioWarnings } = await validateParcelaRows([{ ID_Parcela_Fija: 'P-01', ID_Socio: 'JS-INEXISTENTE', hcp: '2' }])
  assert.deepEqual(missingSocioWarnings, [])
})

// ---------------------------------------------------------------
// groupValidationErrors (spec sección 10.2, ronda 7) -- resumen agrupado
// de errores para el preview de importación (triage rápido).
// ---------------------------------------------------------------

test('groupValidationErrors agrupa filas con el mismo mensaje EXACTO en un solo grupo, con count y codes correctos', () => {
  const results = [
    { valid: false, index: 0, normalized: { ID_Socio: 'JS-01' }, errors: ['DNI: Este campo es obligatorio'] },
    { valid: false, index: 1, normalized: { ID_Socio: 'JS-02' }, errors: ['DNI: Este campo es obligatorio'] },
    { valid: true, index: 2, normalized: { ID_Socio: 'JS-03' }, errors: [] },
  ]
  const groups = groupValidationErrors(results, 'ID_Socio')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].message, 'DNI: Este campo es obligatorio')
  assert.equal(groups[0].count, 2)
  assert.deepEqual(groups[0].codes, ['JS-01', 'JS-02'])
})

test('groupValidationErrors: una fila con MÁS DE UN error aparece en cada grupo correspondiente (no se deduplica entre grupos)', () => {
  const results = [
    {
      valid: false,
      index: 0,
      normalized: { ID_Socio: 'JS-01' },
      errors: ['DNI: Este campo es obligatorio', 'Celular: El celular debe tener 9 dígitos'],
    },
  ]
  const groups = groupValidationErrors(results, 'ID_Socio')
  assert.equal(groups.length, 2)
  assert.ok(groups.every((g) => g.codes.includes('JS-01')))
})

test('groupValidationErrors: filas válidas (sin error) no aportan a ningún grupo', () => {
  const results = [{ valid: true, index: 0, normalized: { ID_Socio: 'JS-01' }, errors: [] }]
  assert.deepEqual(groupValidationErrors(results, 'ID_Socio'), [])
})

test('groupValidationErrors: sin codeKey en la fila (vacío), cae al número de fila ("fila N")', () => {
  const results = [{ valid: false, index: 0, normalized: { ID_Socio: '' }, errors: ['Código de Socio: Este campo es obligatorio'] }]
  const groups = groupValidationErrors(results, 'ID_Socio')
  assert.deepEqual(groups[0].codes, ['fila 2']) // fila 1 = encabezado
})

test('groupValidationErrors: grupos ordenados de mayor a menor cantidad de filas afectadas', () => {
  const results = [
    { valid: false, index: 0, normalized: { ID_Socio: 'A' }, errors: ['Error raro'] },
    { valid: false, index: 1, normalized: { ID_Socio: 'B' }, errors: ['Error común'] },
    { valid: false, index: 2, normalized: { ID_Socio: 'C' }, errors: ['Error común'] },
    { valid: false, index: 3, normalized: { ID_Socio: 'D' }, errors: ['Error común'] },
  ]
  const groups = groupValidationErrors(results, 'ID_Socio')
  assert.equal(groups[0].message, 'Error común')
  assert.equal(groups[0].count, 3)
  assert.equal(groups[1].message, 'Error raro')
})

test('groupValidationErrors: escenario real -- 28 filas con Provincia "Utcubamba" que no pertenece a "Cajamarca" quedan en un solo grupo', async () => {
  const rows = Array.from({ length: 28 }, (_, i) => ({
    ID_Socio: `COOP-AROMAS-VALLE-${String(i + 1).padStart(3, '0')}`,
    socio_nombre_completo: `Socio ${i + 1}`,
    socio_dni: `1000000${i}`.slice(-8),
    socio_departamento: 'Cajamarca',
    socio_provincia: 'Utcubamba', // provincia real, pero de Amazonas, no de Cajamarca
  }))
  const { rows: results } = await validateSocioRows(rows)
  const groups = groupValidationErrors(results, 'ID_Socio')
  const provinciaGroup = groups.find((g) => g.message.includes('Provincia') && g.message.includes('Utcubamba'))
  assert.ok(provinciaGroup, JSON.stringify(groups))
  assert.equal(provinciaGroup.count, 28)
  assert.equal(provinciaGroup.codes.length, 28)
  assert.equal(provinciaGroup.codes[0], 'COOP-AROMAS-VALLE-001')
})
