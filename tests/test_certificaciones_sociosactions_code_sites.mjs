// ADR-027 -- guardas de regresión estructural para lib/actions/sociosActions.js
// (createSocio/updateSocio, sincronización con SOCIO_CERTIFICACIONES).
//
// Tests de TEXTO fuente, no de comportamiento -- mismo motivo y mismo
// patrón que tests/test_pk_surrogate_code_sites.mjs: sociosActions.js es
// 'use server' y crea su propio cliente Supabase internamente
// (getSupabaseServerClient(), no inyectable) y, además, importa vía el
// alias `@/lib/...` que solo resuelve dentro del pipeline de Next.js --
// no es importable en un script Node plano sin ese bundler (confirmado:
// `node -e "import('./lib/actions/sociosActions.js')"` falla con
// "Cannot find package '@/lib'"). El comportamiento REAL contra Supabase
// se verifica manualmente (creación/edición de un socio con
// certificaciones desde /dashboard/socios) y, para el efecto de la
// migración sobre los 7 socios reales, en
// tests/test_certificaciones_normalizadas.py::TestCertificacionesNormalizadasLive.
//
// Ejecutar con: node --test tests/test_certificaciones_sociosactions_code_sites.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(path.join(ROOT, 'lib/actions/sociosActions.js'), 'utf-8')

test('socioPayload ya NO escribe ninguna de las 8 columnas de flag ni cert_org_estatus/certificaciones', () => {
  const start = src.indexOf('function socioPayload(values) {')
  const end = src.indexOf('\n}', start)
  const block = src.slice(start, end)
  for (const legacyField of [
    'cert_nop_usda',
    'ue_2018_848',
    'cor_canada',
    'cert_ds_0442006_ag',
    'cert_lpo_mx',
    'cert_rainforest',
    'cert_comercio_justo',
    'cert_fair_trade_usa',
    'cert_org_estatus',
    'certificaciones:',
  ]) {
    assert.ok(!block.includes(legacyField), `socioPayload no debe seguir escribiendo ${legacyField}`)
  }
})

test('syncSocioCertificaciones resuelve el catálogo activo antes de escribir (id/codigo, activo=true)', () => {
  assert.match(
    src,
    /\.from\('CERTIFICACIONES_CATALOGO'\)\s*\n\s*\.select\('id, codigo'\)\s*\n\s*\.eq\('activo', true\)/
  )
})

test('syncSocioCertificaciones borra todas las filas del socio antes de reinsertar (permite destildar)', () => {
  assert.match(src, /\.from\('SOCIO_CERTIFICACIONES'\)\.delete\(\)\.eq\('id_socio', socioUuid\)/)
})

test('syncSocioCertificaciones solo inserta filas para campos marcados "Sí", filtrando certificaciones sin id en el catálogo', () => {
  const start = src.indexOf('async function syncSocioCertificaciones')
  const end = src.indexOf('\n}', src.indexOf('insert(rows)', start))
  const block = src.slice(start, end)
  assert.match(block, /CERT_FLAG_FIELDS\.filter\(\(\{ field \}\) => parsed\[field\] === 'Sí'\)/)
  assert.match(block, /if \(!idCertificacion\) return null/)
})

test('syncSocioCertificaciones copia cert_org_estatus como estado SOLO para las certificaciones orgánicas (ORGANIC_CERT_CODES)', () => {
  assert.match(
    src,
    /estado: ORGANIC_CERT_CODES\.includes\(codigo\) \? parsed\.cert_org_estatus \|\| null : null,/
  )
})

test('createSocio llama a syncSocioCertificaciones con el id UUID recién creado, después del insert exitoso', () => {
  const start = src.indexOf('export async function createSocio')
  const end = src.indexOf('export async function updateSocio')
  const block = src.slice(start, end)
  assert.match(block, /\.insert\(\{ ID_Socio: parsed\.ID_Socio, ID_Organizacion: organizationId, \.\.\.socioPayload\(parsed\) \}\)\s*\n\s*\.select\('id'\)/)
  assert.match(block, /await syncSocioCertificaciones\(supabase, data\[0\]\.id, organizationId, parsed\)/)
  // El orden importa: syncSocioCertificaciones debe correr DESPUÉS del insert (necesita data[0].id).
  const insertIdx = block.indexOf(".select('id')")
  const syncIdx = block.indexOf('await syncSocioCertificaciones')
  assert.ok(insertIdx > -1 && syncIdx > insertIdx, 'syncSocioCertificaciones debe llamarse después del insert')
})

test('updateSocio pide `id` además de `ID_Socio` en el .select() del UPDATE, y llama a syncSocioCertificaciones con ese id', () => {
  const start = src.indexOf('export async function updateSocio')
  const end = src.indexOf('export async function createParcela')
  const block = src.slice(start, end)
  assert.match(block, /\.select\('id, ID_Socio'\)/)
  assert.match(block, /await syncSocioCertificaciones\(supabase, data\[0\]\.id, organizationId, parsed\)/)
  // syncSocioCertificaciones debe correr DESPUÉS de confirmar que el UPDATE afectó filas (throw si data.length === 0).
  const guardIdx = block.indexOf('0 filas afectadas')
  const syncIdx = block.indexOf('await syncSocioCertificaciones')
  assert.ok(guardIdx > -1 && syncIdx > guardIdx, 'syncSocioCertificaciones debe llamarse después del guard de 0 filas afectadas')
})

test('el import de validations/socios incluye CERT_FLAG_FIELDS y ORGANIC_CERT_CODES', () => {
  assert.match(src, /import \{ socioSchema, parcelaSchema, CERT_FLAG_FIELDS, ORGANIC_CERT_CODES \} from '@\/lib\/validations\/socios'/)
})
