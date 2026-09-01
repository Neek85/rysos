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

// Mejoras importador padrón masivo (spec sección 12.1, ronda 9):
// createSocio dejó de usar syncSocioCertificaciones -- ahora es una sola
// llamada RPC transaccional (fn_crear_socio_con_certificaciones,
// supabase/migrations/20260901120000_socio_creacion_atomica.sql), para
// que el alta del socio y sus certificaciones nunca queden a medio
// escribir por un corte de red/proceso. updateSocio (edición) sigue
// usando syncSocioCertificaciones tal cual, sin cambios -- ver el test
// siguiente.
test('createSocio llama a fn_crear_socio_con_certificaciones (RPC transaccional), NO a syncSocioCertificaciones ni a un insert directo', () => {
  const start = src.indexOf('export async function createSocio')
  const end = src.indexOf('export async function updateSocio')
  const block = src.slice(start, end)
  assert.match(block, /supabase\.rpc\('fn_crear_socio_con_certificaciones', \{/)
  assert.match(block, /p_id_socio: parsed\.ID_Socio,/)
  assert.match(block, /p_organizacion: organizationId,/)
  assert.match(block, /p_socio: socioPayload\(parsed\),/)
  assert.match(block, /p_certificaciones: certificaciones,/)
  assert.ok(!block.includes('await syncSocioCertificaciones'), 'createSocio ya no debe llamar a syncSocioCertificaciones')
  assert.ok(!block.includes(".from('PADRON_SOCIOS')\n    .insert("), 'createSocio ya no debe insertar directo a PADRON_SOCIOS')
})

test('createSocio arma `certificaciones` con el mismo filtro/mapeo que syncSocioCertificaciones ya usaba (solo "Sí", estado solo para ORGANIC_CERT_CODES)', () => {
  const start = src.indexOf('export async function createSocio')
  const end = src.indexOf('export async function updateSocio')
  const block = src.slice(start, end)
  assert.match(block, /CERT_FLAG_FIELDS\.filter\(\(\{ field \}\) => parsed\[field\] === 'Sí'\)/)
  assert.match(block, /estado: ORGANIC_CERT_CODES\.includes\(codigo\) \? parsed\.cert_org_estatus \|\| null : null,/)
})

test('createSocio sigue traduciendo el código 23505 (duplicado) a un mensaje legible, ahora desde el error de la RPC', () => {
  const start = src.indexOf('export async function createSocio')
  const end = src.indexOf('export async function updateSocio')
  const block = src.slice(start, end)
  assert.match(block, /friendlyDuplicateError\(error, 'un socio', parsed\.ID_Socio\)/)
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
