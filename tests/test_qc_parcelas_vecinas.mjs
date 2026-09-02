// Fase 3 — capa de contexto de parcelas vecinas (Monitoreos EUDR
// APROBADOS dentro de un radio configurable por organización) — ver
// docs/adr/ADR-006-capa-contexto-parcelas-vecinas.md.
//
// La migración (fn_parcelas_vecinas_eudr) NO está aplicada todavía en la
// instancia real (aplicación manual en Supabase Studio, como toda
// migración de este repo) — el aislamiento multi-tenant se verifica acá
// por INSPECCIÓN de la SQL real (mismo criterio ya usado para
// fn_validar_topologia_eudr antes de que esa migración se aplicara),
// no con una llamada RPC en vivo. Mismo criterio de inspección de código
// fuente para el resto (no hay Jest/Testing Library en el proyecto).
//
// Ejecutar con: node --test tests/test_qc_parcelas_vecinas.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

const MIGRATION_PATH = 'supabase/migrations/20260821_221221_fn_parcelas_vecinas_eudr.sql'

// ---------------------------------------------------------------
// Migración SQL — corrección de premisas del contrato original
// (p_organizacion_id uuid -> text, estado='APROBADA' -> estado_revision=
// 'APROBADO', geom -> geom_inspeccion) + aislamiento multi-tenant real.
// ---------------------------------------------------------------

test('fn_parcelas_vecinas_eudr usa p_organizacion_id text, no uuid (ID_Organizacion es text en todo el schema)', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /p_organizacion_id text/)
  assert.ok(!/p_organizacion_id uuid/.test(source), 'no debería quedar el tipo uuid incorrecto del contrato original')
})

test('fn_parcelas_vecinas_eudr filtra por estado_revision = \'APROBADO\' (no "estado"/"APROBADA", que no existen)', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /estado_revision = 'APROBADO'/g)
  assert.ok(!/\bm\.estado = 'APROBADA'/.test(source), 'no debería quedar el filtro incorrecto del contrato original')
})

test('fn_parcelas_vecinas_eudr usa geom_inspeccion (columna real de EUDR_MONITOREO), no "geom"', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /m\.geom_inspeccion/)
})

test('fn_parcelas_vecinas_eudr filtra por ID_Organizacion en AMBAS queries (el COUNT y el RETURN QUERY) — aislamiento multi-tenant sin excepciones', () => {
  const source = read(MIGRATION_PATH)
  const orgFilterMatches = source.match(/m\."ID_Organizacion" = p_organizacion_id/g) || []
  assert.equal(orgFilterMatches.length, 2, 'el filtro de organización debería aparecer en las 2 queries (COUNT + RETURN QUERY)')
})

test('fn_parcelas_vecinas_eudr excluye el propio registro (p_excluir_id) cuando no es NULL, en ambas queries', () => {
  const source = read(MIGRATION_PATH)
  const excludeMatches = source.match(/p_excluir_id IS NULL OR m\.id_monitoreo <> p_excluir_id/g) || []
  assert.equal(excludeMatches.length, 2)
})

test('fn_parcelas_vecinas_eudr usa ST_DWithin sobre ::geography, nunca sobre grados crudos', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /ST_DWithin\(m\.geom_inspeccion::geography, p_geom::geography, p_radio_m\)/)
})

test('fn_parcelas_vecinas_eudr devuelve total_encontrados vs total_devueltos (capeo de resultados sin fallar silenciosamente)', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /total_encontrados/)
  assert.match(source, /LEAST\(v_total_encontrados, p_limite\) AS total_devueltos/)
  assert.match(source, /LIMIT p_limite/)
})

test('fn_parcelas_vecinas_eudr NO usa SECURITY DEFINER ni GRANT EXECUTE a anon (solo server-side con Service Role Key, mismo criterio que fn_validar_topologia_eudr)', () => {
  const source = read(MIGRATION_PATH)
  assert.ok(!/^\s*SECURITY DEFINER\s*$/m.test(source), 'no debería quedar una cláusula real SECURITY DEFINER')
  assert.ok(!/^\s*GRANT EXECUTE.*TO anon/m.test(source), 'no debería quedar un GRANT EXECUTE real a anon')
})

test('la migración declara el índice GiST sobre geom_inspeccion con IF NOT EXISTS (ya existía desde 20260818, se declara igual por idempotencia)', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /CREATE INDEX IF NOT EXISTS idx_gist_eudr_monitoreo_geom/)
  assert.match(source, /USING GIST \(geom_inspeccion\)/)
})

// ---------------------------------------------------------------
// lib/actions/qcActions.js::fetchParcelasVecinas — capa de aplicación
// (Server Action, Service Role Key)
// ---------------------------------------------------------------

test('fetchParcelasVecinas usa Service Role Key (getSupabaseServerClient), nunca el cliente anon', () => {
  const source = read('lib/actions/qcActions.js')
  const fnMatch = source.match(/export async function fetchParcelasVecinas\([\s\S]*?\n\}/)
  assert.ok(fnMatch, 'fetchParcelasVecinas debería existir')
  assert.match(fnMatch[0], /getSupabaseServerClient\(\)/)
})

test('fetchParcelasVecinas invoca fn_parcelas_vecinas_eudr con los 5 parámetros esperados', () => {
  const source = read('lib/actions/qcActions.js')
  assert.match(source, /supabase\.rpc\('fn_parcelas_vecinas_eudr', \{/)
  assert.match(source, /p_organizacion_id: organizationId/)
  assert.match(source, /p_geom: geometry/)
  assert.match(source, /p_radio_m: radioM/)
  assert.match(source, /p_excluir_id: excludeId \|\| null/)
  assert.match(source, /p_limite: 25/)
})

test('resolveRadioContextoM cae en el default (500m) cuando Config.gis.radio_contexto_vecinos_m no existe — sin migrar datos', () => {
  const source = read('lib/actions/qcActions.js')
  assert.match(source, /const DEFAULT_RADIO_CONTEXTO_M = 500/)
  assert.match(source, /data\?\.Config\?\.gis\?\.radio_contexto_vecinos_m/)
  assert.match(source, /typeof configured === 'number' && configured > 0 \? configured : DEFAULT_RADIO_CONTEXTO_M/)
})

// ---------------------------------------------------------------
// components/gis/QcConsoleMap.jsx — capa de contexto en el mapa
// ---------------------------------------------------------------

test('QcConsoleMap.jsx agrega una 3ra capa (neighborsGroupRef) por DEBAJO de la comparación de solapamiento y de los registros en revisión', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  const neighborsIdx = source.indexOf('neighborsGroupRef.current = L.layerGroup().addTo(map)')
  const comparisonIdx = source.indexOf('comparisonGroupRef.current = L.layerGroup().addTo(map)')
  const mainIdx = source.indexOf('layerGroupRef.current = L.layerGroup().addTo(map)')
  assert.ok(neighborsIdx > -1 && comparisonIdx > -1 && mainIdx > -1)
  assert.ok(neighborsIdx < comparisonIdx, 'neighbors debe agregarse antes que comparison (queda visualmente debajo)')
  assert.ok(comparisonIdx < mainIdx, 'comparison debe agregarse antes que la capa principal')
})

test('QcConsoleMap.jsx usa un estilo visualmente distinto para la capa de contexto (gris/slate punteado fino) vs la de solapamiento (ámbar, Fase 1)', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /color: '#64748b', weight: 1\.5, dashArray: '2, 6'/)
  // La capa de solapamiento (Fase 1) sigue con su propio estilo, sin tocar:
  assert.match(source, /color: '#b45309'/)
  assert.match(source, /dashArray: '6, 6'/)
})

test('QcConsoleMap.jsx dispara la búsqueda de vecinos al entrar en editingKey (no en cada render — organizationId/editingKey como únicas dependencias)', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  const effectMatch = source.match(/useEffect\(\(\) => \{\s*if \(!editingKey \|\| !organizationId\) return[\s\S]*?\}, \[editingKey, organizationId\]\)/)
  assert.ok(effectMatch, 'el efecto de editingKey -> fetchParcelasVecinas debería existir')
  assert.match(effectMatch[0], /fetchParcelasVecinas\(organizationId, point, excludeId\)/)
})

test('QcConsoleMap.jsx dispara la búsqueda de vecinos al TERMINAR de dibujar (vectorEditor.drawnLayer), no en cada vértice', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  const effectMatch = source.match(/useEffect\(\(\) => \{\s*if \(!vectorEditor\.drawnLayer \|\| !organizationId\) return[\s\S]*?\}, \[vectorEditor\.drawnLayer, organizationId\]\)/)
  assert.ok(effectMatch, 'el efecto de drawnLayer -> fetchParcelasVecinas debería existir')
  assert.match(effectMatch[0], /fetchParcelasVecinas\(organizationId, point, null\)/)
})

test('QcConsoleMap.jsx solo excluye el propio registro cuando tabla_origen es EUDR_MONITOREO', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /const excludeId = record\.tabla_origen === 'EUDR_MONITOREO' \? record\.id_monitoreo : null/)
})

test('QcConsoleMap.jsx tiene un toggle on/off para la capa de contexto, ON por defecto', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /const \[neighborsEnabled, setNeighborsEnabled\] = useState\(true\)/)
  assert.match(source, /checked=\{neighborsEnabled\}/)
})

test('QcConsoleMap.jsx limpia la capa de contexto (clearLayers) cuando el toggle está apagado, no solo la oculta', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  const renderEffect = source.match(/useEffect\(\(\) => \{\s*const L = leafletRef\.current\s*const group = neighborsGroupRef[\s\S]*?\}, \[neighborFeatures, neighborsEnabled\]\)/)
  assert.ok(renderEffect, 'el efecto de render de neighborFeatures debería existir')
  assert.match(renderEffect[0], /group\.clearLayers\(\)/)
  assert.match(renderEffect[0], /if \(!neighborsEnabled\) return/)
})

test('QcConsoleMap.jsx avisa cuando hay más parcelas en el radio de las devueltas (total_encontrados > total_devueltos), en vez de fallar silenciosamente', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /neighborsInfo\.totalEncontrados > neighborsInfo\.totalDevueltos/)
  assert.match(source, /hay más parcelas en el radio, acercate al mapa/)
})

test('QcConsoleMap.jsx sigue sin console.log (mismo criterio del resto de esta serie)', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.ok(!/console\.log/.test(source))
})
