// ADR-026 -- guardas de regresión estructural para los sitios de código
// listados en specs/multi_organizacion_codigos_unicos.md que se
// corrigieron cuando ID_Socio/ID_Parcela_Fija dejaron de ser PK.
//
// Estos son tests de TEXTO fuente, no de comportamiento -- lib/actions/
// sociosActions.js y lib/actions/gisActions.js son 'use server' y crean su
// propio cliente Supabase internamente (getSupabaseServerClient(), no
// inyectable), a diferencia de lib/sociosSearch.js (ver
// tests/test_sociossearch_multitenant.mjs, que sí puede mockear el
// cliente porque lo recibe como parámetro). El comportamiento real de la
// query scoped por organización se verifica contra Supabase Live en
// tests/test_pk_surrogate_multiorganizacion.py (TestPkSurrogateLive,
// auto-skip hasta que la migración esté aplicada) -- acá solo se confirma
// que el código fuente sigue teniendo el filtro, para atrapar una
// regresión si alguien lo borra sin querer.
//
// Ejecutar con: node --test tests/test_pk_surrogate_code_sites.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sociosActionsSrc = readFileSync(path.join(ROOT, 'lib/actions/sociosActions.js'), 'utf-8')
const gisActionsSrc = readFileSync(path.join(ROOT, 'lib/actions/gisActions.js'), 'utf-8')
const eudrQcActionsSrc = readFileSync(path.join(ROOT, 'lib/eudrQcActions.js'), 'utf-8')

test('sociosActions.js: ningún .maybeSingle() queda sin filtrar por organización o sin manejar múltiples filas', () => {
  // assertMatchesExistingOrg/assertParcelaMatchesOrg ya no usan
  // .maybeSingle() en absoluto (manejan arrays); assertSocioExists sí lo
  // usa, pero scoped por ambas columnas.
  assert.match(
    sociosActionsSrc,
    /\.eq\('ID_Socio', socioId\)\s*\n\s*\.eq\('ID_Organizacion', organizationId\)\s*\n\s*\.maybeSingle\(\)/,
    'assertSocioExists debe filtrar por ID_Socio Y ID_Organizacion antes de .maybeSingle()'
  )
})

test('sociosActions.js: updateSocio incluye ID_Organizacion en el WHERE del UPDATE', () => {
  assert.match(
    sociosActionsSrc,
    /\.update\(socioPayload\(parsed\)\)\s*\n\s*\.eq\('ID_Socio', parsed\.ID_Socio\)\s*\n\s*\.eq\('ID_Organizacion', organizationId\)/
  )
})

test('sociosActions.js: updateParcela incluye ID_Organizacion en el WHERE del UPDATE', () => {
  assert.match(
    sociosActionsSrc,
    /\.update\(updatePayload\)\s*\n\s*\.eq\('ID_Parcela_Fija', parsed\.ID_Parcela_Fija\)\s*\n\s*\.eq\('ID_Organizacion', organizationId\)/
  )
})

test('sociosActions.js: deactivateSocio incluye ID_Organizacion en su propio UPDATE', () => {
  assert.match(
    sociosActionsSrc,
    /\.update\(\{ activo: false \}\)\s*\n\s*\.eq\('ID_Socio', socioId\)\s*\n\s*\.eq\('ID_Organizacion', organizationId\)\s*\n\s*\.select\('ID_Socio, activo'\)/
  )
})

test('sociosActions.js: la cascada de deactivateSocio hacia PADRON_PARCELAS incluye ID_Organizacion -- el sitio más peligroso de la auditoría', () => {
  assert.match(
    sociosActionsSrc,
    /\.from\('PADRON_PARCELAS'\)\s*\n\s*\.update\(\{ activo: false \}\)\s*\n\s*\.eq\('ID_Socio', socioId\)\s*\n\s*\.eq\('ID_Organizacion', organizationId\)/,
    'la cascada de deactivateSocio debe filtrar tambien por ID_Organizacion, no solo por ID_Socio'
  )
})

test('sociosActions.js: deactivateParcela incluye ID_Organizacion en su UPDATE', () => {
  assert.match(
    sociosActionsSrc,
    /\.update\(\{ activo: false \}\)\s*\n\s*\.eq\('ID_Parcela_Fija', parcelaId\)\s*\n\s*\.eq\('ID_Organizacion', organizationId\)\s*\n\s*\.select\('ID_Parcela_Fija, activo'\)/
  )
})

test('gisActions.js: assertSocioActivoOSinValor y assertParcelaActivaOSinValor filtran por ID_Organizacion antes de .maybeSingle()', () => {
  assert.match(
    gisActionsSrc,
    /\.eq\('ID_Socio', socioId\)\s*\n\s*\.eq\('ID_Organizacion', organizationId\)\s*\n\s*\.maybeSingle\(\)/
  )
  assert.match(
    gisActionsSrc,
    /\.eq\('ID_Parcela_Fija', parcelaId\)\s*\n\s*\.eq\('ID_Organizacion', organizationId\)\s*\n\s*\.maybeSingle\(\)/
  )
})

test('eudrQcActions.js: checkSocioParcelaOrganizacion ya no usa .maybeSingle() para las búsquedas cross-organización', () => {
  const start = eudrQcActionsSrc.indexOf('export async function checkSocioParcelaOrganizacion')
  const conflictSection = eudrQcActionsSrc.slice(
    start,
    eudrQcActionsSrc.indexOf('export async function', start + 10)
  )
  // Las 2 búsquedas de conflicto (parcela y socio) ya no deben usar
  // .maybeSingle() sobre ID_Parcela_Fija/ID_Socio -- solo debe sobrevivir
  // el .maybeSingle() de id_monitoreo (EUDR_MONITOREO, PK propia, no
  // afectada por esta migración).
  assert.doesNotMatch(conflictSection, /\.eq\('ID_Parcela_Fija', record\.ID_Parcela_Fija\)\s*\n\s*\.maybeSingle\(\)/)
  assert.doesNotMatch(conflictSection, /\.eq\('ID_Socio', socioId\)\s*\n\s*\.maybeSingle\(\)/)
  assert.match(conflictSection, /\.eq\('id_monitoreo', record\.id_monitoreo\)\s*\n\s*\.maybeSingle\(\)/)
  // Ambas búsquedas de conflicto deben usar .neq(...).limit(1) en su lugar.
  assert.equal(
    (conflictSection.match(/\.neq\('ID_Organizacion', record\.ID_Organizacion\)\s*\n\s*\.limit\(1\)/g) || []).length,
    2,
    'las 2 busquedas de conflicto (parcela y socio) deben usar .neq(...).limit(1)'
  )
})
