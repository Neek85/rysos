// ADR-028 -- guardas de regresión estructural para el paso 4 de
// multi-producto (café/cacao): lib/validations/socios.js (HECTARE_FIELDS
// genérico + id_producto_predominante en el schema), lib/actions/sociosActions.js
// (parcelaPayload), components/features/socios/ParcelaFormModal.jsx (dropdown
// de producto) y lib/sociosSearch.js (PARCELA_COLUMNS).
//
// Tests de TEXTO fuente, no de comportamiento -- mismo motivo y mismo
// patrón que tests/test_certificaciones_sociosactions_code_sites.mjs:
// sociosActions.js es 'use server' con su propio cliente Supabase interno
// (no inyectable), y ParcelaFormModal.jsx es un componente 'use client' de
// Next.js (imports vía alias '@/...') -- ninguno de los dos es importable
// en un script Node plano. El comportamiento REAL contra Supabase se
// verifica manualmente (alta/edición de una parcela con producto desde
// /dashboard/socios) y, para la migración en sí, en
// tests/test_multi_producto_cafe_cacao.py.
//
// Ejecutar con: node --test tests/test_multi_producto_code_sites.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const socios = readFileSync(path.join(ROOT, 'lib/validations/socios.js'), 'utf-8')
const sociosActions = readFileSync(path.join(ROOT, 'lib/actions/sociosActions.js'), 'utf-8')
const parcelaFormModal = readFileSync(path.join(ROOT, 'components/features/socios/ParcelaFormModal.jsx'), 'utf-8')
const sociosSearch = readFileSync(path.join(ROOT, 'lib/sociosSearch.js'), 'utf-8')

test('HECTARE_FIELDS ya NO nombra "Café" en ningún label -- hcp/hcc genéricos (ADR-028, resuelve el hallazgo de la sección 5.1 de la spec)', () => {
  const start = socios.indexOf('export const HECTARE_FIELDS = [')
  const end = socios.indexOf(']', start)
  const block = socios.slice(start, end)
  assert.ok(!block.includes('Café'), 'HECTARE_FIELDS no debe contener la palabra "Café" en ningún label')
  assert.match(block, /field: 'hcp', label: 'Ha\. En Producción'/)
  assert.match(block, /field: 'hcc', label: 'Ha\. En Crecimiento'/)
})

test('parcelaSchema incluye id_producto_predominante como uuid opcional/nullable', () => {
  const start = socios.indexOf('export const parcelaSchema')
  const end = socios.indexOf('.refine(', start)
  const block = socios.slice(start, end)
  assert.match(block, /id_producto_predominante: z\.string\(\)\.uuid\(\)\.optional\(\)\.nullable\(\)\.or\(z\.literal\(''\)\)/)
})

test('PARCELA_DEFAULT_VALUES inicializa id_producto_predominante en \'\' (nunca null -- <select> no controlado)', () => {
  const start = socios.indexOf('export const PARCELA_DEFAULT_VALUES')
  const end = socios.indexOf('}', start)
  const block = socios.slice(start, end)
  assert.match(block, /id_producto_predominante: '',/)
})

test('parcelaPayload (sociosActions.js) normaliza id_producto_predominante: \'\' -> null antes de escribir en PADRON_PARCELAS', () => {
  const start = sociosActions.indexOf('function parcelaPayload(values, totalh) {')
  const end = sociosActions.indexOf('\n}', start)
  const block = sociosActions.slice(start, end)
  assert.match(block, /id_producto_predominante: values\.id_producto_predominante \|\| null,/)
})

test('createParcela/updateParcela no necesitaron cambio propio -- ambos siguen spreadeando parcelaPayload(parsed, totalh) tal cual', () => {
  assert.match(sociosActions, /\.\.\.parcelaPayload\(parsed, totalh\),/)
  assert.match(sociosActions, /const updatePayload = parcelaPayload\(parsed, totalh\)/)
})

test('lib/sociosSearch.js::PARCELA_COLUMNS incluye id_producto_predominante (si no, ParcelaFormModal no puede pre-seleccionar el producto real al editar)', () => {
  assert.match(sociosSearch, /const PARCELA_COLUMNS =[\s\S]*?id_producto_predominante/)
})

test('ParcelaFormModal.jsx carga PRODUCTOS filtrando vertical=AGRICOLA y activo=true (sin productos PECUARIO todavía)', () => {
  const start = parcelaFormModal.indexOf("supabase\n      .from('PRODUCTOS')")
  assert.ok(start > -1, "debe existir un .from('PRODUCTOS') en el componente")
  const block = parcelaFormModal.slice(start, start + 300)
  assert.match(block, /\.eq\('vertical', 'AGRICOLA'\)/)
  assert.match(block, /\.eq\('activo', true\)/)
})

test('ParcelaFormModal.jsx renderiza un <select> para id_producto_predominante con opción "Sin especificar"', () => {
  assert.match(parcelaFormModal, /register\('id_producto_predominante'\)/)
  assert.match(parcelaFormModal, /<option value="">Sin especificar<\/option>/)
})

test('ParcelaFormModal.jsx normaliza null -> \'\' al pre-cargar defaultValues en edición (un <select> no controlado no debe recibir null)', () => {
  assert.match(
    parcelaFormModal,
    /id_producto_predominante: parcela\.id_producto_predominante \|\| ''/
  )
})
