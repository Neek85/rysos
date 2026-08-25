// ADR-021 — vínculo real de cobertura (ADR-010) para datos del Editor
// Vectorial + creación de parcela nueva reutilizando ParcelaFormModal.
// Mismo criterio de inspección de código fuente que el resto de esta
// serie (lib/actions/gisActions.js tiene 'use server' y requiere Supabase
// real para ejecutarse; VectorEditorTools.jsx/ParcelaFormModal.jsx son
// JSX, que node --test no puede parsear — ver test_gis_padron_validation.mjs).
//
// Ejecutar con: node --test tests/test_vinculo_editor_vectorial_y_parcela.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

// ---------------------------------------------------------------
// PARTE 1 — vínculo real (lib/actions/gisActions.js)
// ---------------------------------------------------------------

test('insertEudrCoreRecord genera qfield_relation_id (crypto.randomUUID, sin llaves) para EUDR_MONITOREO', () => {
  const source = read('lib/actions/gisActions.js')
  const fnBlock = source.match(/async function insertEudrCoreRecord[\s\S]*?\n\}/)
  assert.ok(fnBlock, 'insertEudrCoreRecord debería existir')
  assert.match(fnBlock[0], /payload\.id_monitoreo = crypto\.randomUUID\(\)/)
  assert.match(fnBlock[0], /payload\.qfield_relation_id = crypto\.randomUUID\(\)/)
  // Ambas asignaciones deben estar dentro del if (table === 'EUDR_MONITOREO'),
  // nunca para EUDR_USO_SUELO/EUDR_INSTALACIONES (esa tabla nunca tuvo ni
  // debe tener su propia columna qfield_relation_id).
  const monitoreoBranch = fnBlock[0].slice(
    fnBlock[0].indexOf("table === 'EUDR_MONITOREO'"),
    fnBlock[0].indexOf('} else {')
  )
  assert.match(monitoreoBranch, /qfield_relation_id = crypto\.randomUUID\(\)/)
})

test('resolveQfieldRelationId existe, no asume ante ambigüedad (0 o más de 1 match -> null), y no bloquea sin valor', () => {
  const source = read('lib/actions/gisActions.js')
  const fnBlock = source.match(/async function resolveQfieldRelationId\(supabase, idParcelaFija, organizationId\) \{[\s\S]*?\n\}/)
  assert.ok(fnBlock, 'resolveQfieldRelationId debería existir')
  assert.match(fnBlock[0], /if \(!idParcelaFija\) return null/)
  assert.match(fnBlock[0], /\.from\('EUDR_MONITOREO'\)/)
  assert.match(fnBlock[0], /\.select\('qfield_relation_id'\)/)
  assert.match(fnBlock[0], /\.eq\('ID_Parcela_Fija', idParcelaFija\)/)
  assert.match(fnBlock[0], /\.eq\('ID_Organizacion', organizationId\)/)
  assert.match(fnBlock[0], /if \(!data \|\| data\.length !== 1\) return null/)
})

test('EUDR_USO_SUELO: valida el código legible de PADRON_PARCELAS como siempre (ADR-019), pero guarda el identificador técnico resuelto (o null), nunca el código legible', () => {
  const source = read('lib/actions/gisActions.js')
  const instalacionesMarker = source.lastIndexOf('// EUDR_INSTALACIONES')
  const usoSueloBlock = source.slice(source.indexOf("targetTable === 'EUDR_USO_SUELO'"), instalacionesMarker)

  // Sigue validando el código legible tal cual (ADR-019, sin cambios).
  assert.match(usoSueloBlock, /assertParcelaActivaOSinValor\(supabase, fieldOverrides\.id_parcela, organizationId\)/)

  // Pero ya NO guarda fieldOverrides.id_parcela directo -- resuelve primero.
  assert.match(
    usoSueloBlock,
    /const qfieldRelationId = await resolveQfieldRelationId\(supabase, fieldOverrides\.id_parcela, organizationId\)/
  )
  assert.match(usoSueloBlock, /id_parcela: qfieldRelationId,/)
  assert.ok(
    !/id_parcela: fieldOverrides\.id_parcela,/.test(usoSueloBlock),
    'ya no debería escribir el código legible directo en id_parcela'
  )

  // Orden real: validar -> resolver -> insertar (nunca guardar antes de validar).
  const iValidar = usoSueloBlock.indexOf('assertParcelaActivaOSinValor')
  const iResolver = usoSueloBlock.indexOf('resolveQfieldRelationId(supabase')
  const iInsertar = usoSueloBlock.indexOf('insertEudrCoreRecord')
  assert.ok(iValidar < iResolver && iResolver < iInsertar, 'el orden debe ser validar, resolver, insertar')
})

test('EUDR_INSTALACIONES sigue guardando el código legible tal cual -- fuera de alcance de esta tarea a propósito (mismo gap potencial, no corregido acá)', () => {
  const source = read('lib/actions/gisActions.js')
  const instalacionesMarker = source.lastIndexOf('// EUDR_INSTALACIONES')
  const instalacionesBlock = source.slice(instalacionesMarker)
  assert.match(instalacionesBlock, /id_parcela: fieldOverrides\.id_parcela,/)
  assert.ok(
    !/resolveQfieldRelationId/.test(instalacionesBlock),
    'EUDR_INSTALACIONES no debería usar resolveQfieldRelationId en esta tarea'
  )
})

// ---------------------------------------------------------------
// PARTE 2 — creación de parcela nueva
// ---------------------------------------------------------------

test('createSocio devuelve socio_nombre_completo además de id/created (aditivo, ADR-021)', () => {
  const source = read('lib/actions/sociosActions.js')
  const fnBlock = source.match(/export async function createSocio[\s\S]*?\n\}/)
  assert.ok(fnBlock, 'createSocio debería existir')
  assert.match(
    fnBlock[0],
    /return \{ id: parsed\.ID_Socio, created: true, socio_nombre_completo: parsed\.socio_nombre_completo \}/
  )
})

test('ParcelaFormModal acepta onParcelaCreated (opcional) y lo dispara SOLO en un alta real, nunca en edición', () => {
  const source = read('components/features/socios/ParcelaFormModal.jsx')
  assert.match(source, /export default function ParcelaFormModal\(\{ socio, organizationId, onClose, onParcelaCreated \}\)/)
  const fnBlock = source.match(/function handleSaved\(result\) \{[\s\S]*?\n  \}/)
  assert.ok(fnBlock, 'handleSaved debería existir con el parámetro result')
  assert.match(fnBlock[0], /if \(result\?\.created\) \{\s*\n\s*onParcelaCreated\?\.\(result\)/)
})

test('VectorEditorTools.jsx: "+ Crear parcela nueva" solo se ofrece para un campo de parcela con un campo de socio hermano en el mismo fields[]', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  assert.match(source, /import ParcelaFormModal from '@\/components\/features\/socios\/ParcelaFormModal'/)
  assert.match(
    source,
    /onCreateParcela=\{\s*\n\s*f\.padronEntity === 'parcela' && socioField \? \(\) => setParcelaModalFieldKey\(f\.key\) : undefined\s*\n\s*\}/
  )
})

test('VectorEditorTools.jsx: el botón "+ Crear parcela nueva" está deshabilitado sin un socio seleccionado, con el texto explicando por qué', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  const bloque = source.match(/\{isParcela && onCreateParcela && \([\s\S]*?\)\}/)
  assert.ok(bloque, 'el bloque del botón de crear parcela debería existir')
  assert.match(bloque[0], /disabled=\{!socioSeleccionado\}/)
  assert.match(bloque[0], /Seleccioná o creá un socio primero\./)
})

test('VectorEditorTools.jsx: al guardar la parcela nueva, queda seleccionada automáticamente y el overlay se cierra (mismo patrón que "+ Crear socio nuevo")', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  const bloque = source.match(/\{parcelaModalFieldKey && socioField && \([\s\S]*?\)\}\s*\n\s*<\/div>/)
  assert.ok(bloque, 'el overlay de ParcelaFormModal debería existir')
  assert.match(bloque[0], /onParcelaCreated=\{\(savedParcela\) => \{/)
  assert.match(
    bloque[0],
    /setFieldValues\(\(prev\) => \(\{ \.\.\.prev, \[parcelaModalFieldKey\]: savedParcela\.id \}\)\)/
  )
  assert.match(bloque[0], /setParcelaModalFieldKey\(null\)/)
})

test('VectorEditorTools.jsx: no reimplementa createParcela ni el cálculo de correlativo -- reutiliza ParcelaFormModal/lib/parcelaDefaults.js sin tocarlos', () => {
  const source = read('app/dashboard/qc/components/VectorEditorTools.jsx')
  assert.ok(
    !/computeNextParcelaCode|computeSuggestedParcelaId|createParcela\(/.test(source),
    'no debería reimplementar la lógica de parcelaDefaults.js/sociosActions.js acá'
  )
})
