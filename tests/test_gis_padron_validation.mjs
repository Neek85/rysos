// ADR-019 — validación real de socio/parcela en el Editor Vectorial y
// herencia entre geometrías consecutivas. Mismo criterio de inspección de
// código fuente que el resto de esta serie (lib/actions/gisActions.js
// tiene 'use server' y requiere Supabase real para ejecutarse;
// VectorEditorTools.jsx es JSX, que node --test no puede parsear — ver
// tests/test_gis_editor.mjs, tests/test_qc_server_actions_write_fix.mjs).
//
// Ejecutar con: node --test tests/test_gis_padron_validation.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('lib/gisTargetTables.js marca padronEntity solo en los 3 campos que el Editor Vectorial de la Consola QC realmente ofrece', async () => {
  const { TARGET_TABLE_FIELDS } = await import('../lib/gisTargetTables.js')
  assert.equal(TARGET_TABLE_FIELDS.EUDR_MONITOREO.find((f) => f.key === 'ID_Socio').padronEntity, 'socio')
  assert.equal(TARGET_TABLE_FIELDS.EUDR_MONITOREO.find((f) => f.key === 'ID_Parcela_Fija').padronEntity, 'parcela')
  assert.equal(TARGET_TABLE_FIELDS.EUDR_USO_SUELO.find((f) => f.key === 'id_parcela').padronEntity, 'parcela')
  assert.equal(TARGET_TABLE_FIELDS.EUDR_INSTALACIONES.find((f) => f.key === 'id_parcela').padronEntity, 'parcela')
  // PADRON_PARCELAS.ID_Socio fuera de alcance a propósito -- lo consume
  // CargaEspacialModal.jsx, no el Editor Vectorial (QC_DRAWABLE_TABLES
  // nunca incluye PADRON_PARCELAS), y createParcela ya valida ese campo
  // por su cuenta (assertSocioExists, lib/actions/sociosActions.js).
  assert.equal(TARGET_TABLE_FIELDS.PADRON_PARCELAS.find((f) => f.key === 'ID_Socio').padronEntity, undefined)
  // tipo_uso/tipo_infra siguen sin padronEntity -- select fijo (ADR-018) y
  // texto libre respectivamente, ninguno cambia en esta tarea.
  assert.equal(TARGET_TABLE_FIELDS.EUDR_USO_SUELO.find((f) => f.key === 'tipo_uso').padronEntity, undefined)
  assert.equal(TARGET_TABLE_FIELDS.EUDR_INSTALACIONES.find((f) => f.key === 'tipo_infra').padronEntity, undefined)
})

test('lib/actions/gisActions.js valida ID_Socio/ID_Parcela_Fija/id_parcela contra el padrón real antes de cada insert EUDR_*', () => {
  const source = read('lib/actions/gisActions.js')
  assert.match(source, /async function assertSocioActivoOSinValor\(supabase, socioId, organizationId\)/)
  assert.match(source, /async function assertParcelaActivaOSinValor\(supabase, parcelaId, organizationId\)/)
  // Ambos helpers consultan activo + comparan organización con orgIdsMatch
  // (tolerante a mayúsculas/espacios), mismo criterio que assertSocioExists
  // en lib/actions/sociosActions.js -- no un .eq('ID_Organizacion', ...) crudo.
  assert.match(source, /from\('PADRON_SOCIOS'\)\s*\n\s*\.select\('ID_Organizacion, activo'\)/)
  assert.match(source, /from\('PADRON_PARCELAS'\)\s*\n\s*\.select\('ID_Organizacion, activo'\)/)
  assert.match(source, /orgIdsMatch\(data\.ID_Organizacion, organizationId\)/)

  // Se invocan ANTES del insert real (insertEudrCoreRecord), para las 3
  // tablas EUDR_* -- nunca para PADRON_PARCELAS (esa rama delega en
  // createParcela, que ya valida por su cuenta).
  const eudrMonitoreoBlock = source.slice(source.indexOf("targetTable === 'EUDR_MONITOREO'"), source.indexOf("targetTable === 'EUDR_USO_SUELO'"))
  assert.match(eudrMonitoreoBlock, /assertSocioActivoOSinValor\(supabase, fieldOverrides\.ID_Socio, organizationId\)/)
  assert.match(eudrMonitoreoBlock, /assertParcelaActivaOSinValor\(supabase, fieldOverrides\.ID_Parcela_Fija, organizationId\)/)
  assert.ok(
    eudrMonitoreoBlock.indexOf('assertSocioActivoOSinValor') < eudrMonitoreoBlock.indexOf('insertEudrCoreRecord'),
    'la validación debe correr antes del insert, no después'
  )

  const instalacionesMarker = source.lastIndexOf('// EUDR_INSTALACIONES')
  const usoSueloBlock = source.slice(source.indexOf("targetTable === 'EUDR_USO_SUELO'"), instalacionesMarker)
  assert.match(usoSueloBlock, /assertParcelaActivaOSinValor\(supabase, fieldOverrides\.id_parcela, organizationId\)/)
  assert.ok(
    usoSueloBlock.indexOf('assertParcelaActivaOSinValor') < usoSueloBlock.indexOf('insertEudrCoreRecord'),
    'la validación debe correr antes del insert, no después'
  )

  const instalacionesBlock = source.slice(instalacionesMarker)
  assert.match(instalacionesBlock, /assertParcelaActivaOSinValor\(supabase, fieldOverrides\.id_parcela, organizationId\)/)
  assert.ok(
    instalacionesBlock.indexOf('assertParcelaActivaOSinValor') < instalacionesBlock.indexOf('insertEudrCoreRecord'),
    'la validación debe correr antes del insert, no después'
  )
})

test('gisActions.js no valida cuando el campo viene vacío (ID_Socio/ID_Parcela_Fija son opcionales en EUDR_MONITOREO)', () => {
  const source = read('lib/actions/gisActions.js')
  assert.match(source, /async function assertSocioActivoOSinValor\(supabase, socioId, organizationId\) \{\s*\n\s*if \(!socioId\) return/)
  assert.match(source, /async function assertParcelaActivaOSinValor\(supabase, parcelaId, organizationId\) \{\s*\n\s*if \(!parcelaId\) return/)
})

test('VectorEditorTools.jsx reutiliza lib/padronSearch.js, PadronAutocomplete y SocioFormModal -- sin duplicar validación', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  assert.match(source, /import \{ searchSocios, searchParcelas \} from '@\/lib\/padronSearch'/)
  assert.match(source, /import PadronAutocomplete from '@\/components\/features\/inspecciones\/PadronAutocomplete'/)
  assert.match(source, /import SocioFormModal from '@\/components\/features\/socios\/SocioFormModal'/)
  assert.ok(!/createSocio|assertDniNotDuplicated|assertCodigoFincaNotDuplicated/.test(source), 'no debería reimplementar validación de sociosActions.js acá')
})

test('VectorEditorTools.jsx precarga (no fuerza) el socio/parcela del último guardado exitoso vía un ref, no vía closure directa', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  assert.match(source, /const lastIdentityRef = useRef\(\{ socio: null, parcela: null \}\)/)
  assert.match(source, /const targetTableRef = useRef\(targetTable\)/)
  assert.match(
    source,
    /setFieldValues\(buildInitialFieldValues\(targetTableRef\.current, lastIdentityRef\.current\)\)/
  )
  assert.match(
    source,
    /lastIdentityRef\.current = \{\s*\n\s*socio: fieldValues\.ID_Socio \|\| lastIdentityRef\.current\.socio,\s*\n\s*parcela: fieldValues\.ID_Parcela_Fija \|\| fieldValues\.id_parcela \|\| lastIdentityRef\.current\.parcela,/
  )
})
