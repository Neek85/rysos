// Fase B — cobertura completa de subdivisiones de Uso de Suelo. YA NO
// bloquea la aprobación (corregido tras un círculo imposible real
// confirmado en vivo — ver ADR-011, sección "Corrección: de bloqueante a
// informativo") — es puramente informativo, mismo patrón que "Solapado
// X%" de Fase A.
//
// La migración/RPC no están aplicadas todavía en la instancia real al
// momento de escribir estos tests (aplicación manual en Supabase Studio,
// como toda migración de este repo) — se verifica por inspección de la
// SQL real para esa parte, mismo criterio ya usado en toda esta sesión.
//
// Ejecutar con: node --test tests/test_qc_cobertura_uso_suelo.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  validateCoberturaRequest,
  buildSinVinculoResult,
  calcularPctCobertura,
  buildCoberturaAvisoMensaje,
  SIN_VINCULO_MENSAJE,
} from '../lib/qcCoberturaUsoSuelo.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

const MIGRATION_PATH = 'supabase/migrations/20260823_155621_fn_cobertura_uso_suelo_parcela.sql'
const ROUTE_PATH = 'app/api/qc/cobertura-uso-suelo/route.js'
const DETAIL_EDITOR_PATH = 'app/dashboard/qc/components/QcDetailEditor.jsx'

// ---------------------------------------------------------------
// lib/qcCoberturaUsoSuelo.js — lógica pura
// ---------------------------------------------------------------

test('validateCoberturaRequest exige uso_suelo_id', () => {
  assert.deepEqual(validateCoberturaRequest({ uso_suelo_id: 18 }), { valid: true, usoSueloId: 18 })
  const invalid = validateCoberturaRequest({})
  assert.equal(invalid.valid, false)
  assert.match(invalid.error, /uso_suelo_id/)
})

test('buildSinVinculoResult nunca bloquea y devuelve el mensaje esperado', () => {
  const result = buildSinVinculoResult()
  assert.equal(result.vinculo_disponible, false)
  assert.equal(result.bloquea_aprobacion, false)
  assert.equal(result.hueco_cobertura, false)
  assert.equal(result.mensaje, SIN_VINCULO_MENSAJE)
})

test('calcularPctCobertura calcula el % real (suma aprobada / área Monitoreo)', () => {
  const pct = calcularPctCobertura({
    vinculo_disponible: true,
    area_monitoreo_ha: 24.6072,
    suma_uso_suelo_aprobado_ha: 15.0443,
  })
  assert.equal(pct, 61.14)
})

test('calcularPctCobertura devuelve null sin vínculo o sin área válida', () => {
  assert.equal(calcularPctCobertura({ vinculo_disponible: false }), null)
  assert.equal(calcularPctCobertura({ vinculo_disponible: true, area_monitoreo_ha: 0 }), null)
  assert.equal(calcularPctCobertura(null), null)
})

test('buildCoberturaAvisoMensaje NUNCA menciona totalh (no participa en el cálculo de hueco_cobertura, ver ADR-011)', () => {
  const mensaje = buildCoberturaAvisoMensaje({
    hueco_cobertura: true,
    area_monitoreo_ha: 24.6072,
    suma_uso_suelo_aprobado_ha: 15.0443,
    totalh_padron_ha: 2.25,
    divergencia_totalh_pct: 90.86,
  })
  assert.ok(mensaje, 'debería generar un mensaje')
  assert.ok(!/totalh/i.test(mensaje), 'el aviso de cobertura no debe mencionar totalh')
  assert.match(mensaje, /Cobertura parcial/)
})

test('buildCoberturaAvisoMensaje devuelve null si no hay hueco', () => {
  assert.equal(buildCoberturaAvisoMensaje({ hueco_cobertura: false }), null)
})

// ---------------------------------------------------------------
// Migración SQL — regla de negocio: totalh NUNCA participa en el bloqueo
// ---------------------------------------------------------------

test('la migración usa un umbral de hueco con nombre (v_umbral_hueco_pct = 0.05), no un número mágico inline', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /v_umbral_hueco_pct constant numeric := 0\.05;/)
})

test('hueco_cobertura se calcula SOLO con area_monitoreo_ha y suma_uso_suelo (nunca con totalh)', () => {
  const source = read(MIGRATION_PATH)
  const bloque = source.match(/v_hueco_cobertura := [\s\S]*?;/)
  assert.ok(bloque, 'la asignación de v_hueco_cobertura debería existir')
  assert.match(bloque[0], /v_area_monitoreo_ha - v_suma_uso_suelo_ha/)
  assert.ok(!/v_totalh/.test(bloque[0]), 'v_hueco_cobertura no debe referenciar v_totalh_padron_ha en ninguna dirección')
})

test('bloquea_aprobacion es idéntico a hueco_cobertura (sin lógica de "ambos" adicional)', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /'bloquea_aprobacion', v_hueco_cobertura/)
})

test('totalh NULL o 0 se trata como no disponible (NULLIF), nunca como 0 real', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /SELECT NULLIF\(totalh, 0\) INTO v_totalh_padron_ha/)
})

test('divergencia_totalh_pct es puramente informativo, calculado aparte de hueco_cobertura', () => {
  const source = read(MIGRATION_PATH)
  const idx1 = source.indexOf('v_hueco_cobertura :=')
  const idx2 = source.indexOf('v_divergencia_totalh_pct := CASE')
  assert.ok(idx1 !== -1 && idx2 !== -1 && idx1 < idx2, 'v_hueco_cobertura debe calcularse antes/independiente de la divergencia')
})

test('la suma de Uso de Suelo usa el join REAL (id_parcela = qfield_relation_id) y filtra por APROBADO + ID_Organizacion', () => {
  const source = read(MIGRATION_PATH)
  const bloque = source.match(/SELECT COALESCE\(SUM\(area_calculada_ha\), 0\)[\s\S]*?;/)
  assert.ok(bloque, 'el cálculo de v_suma_uso_suelo_ha debería existir')
  assert.match(bloque[0], /WHERE id_parcela = v_qfield_relation_id/)
  assert.match(bloque[0], /AND "ID_Organizacion" = v_org/)
  assert.match(bloque[0], /AND estado_revision = 'APROBADO'/)
})

// ---------------------------------------------------------------
// Route handler — resolución del vínculo, caso "sin vínculo"
// ---------------------------------------------------------------

test('la ruta resuelve el Monitoreo padre por qfield_relation_id = id_parcela, filtrado por ID_Organizacion', () => {
  const source = read(ROUTE_PATH)
  assert.match(source, /\.eq\('qfield_relation_id', usoSuelo\.id_parcela\)/)
  assert.match(source, /\.eq\('ID_Organizacion', usoSuelo\.ID_Organizacion\)/)
})

test('la ruta devuelve el caso "sin vínculo" si id_parcela es null, o si hay 0 o más de un Monitoreo candidato', () => {
  const source = read(ROUTE_PATH)
  assert.match(source, /if \(!usoSuelo\.id_parcela\)/)
  assert.match(source, /monitoreos\.length !== 1/)
})

test('la ruta nunca llama a la RPC en el caso "sin vínculo" (fn_cobertura_uso_suelo_parcela solo se llama tras resolver sin ambigüedad)', () => {
  const source = read(ROUTE_PATH)
  const rpcCalls = source.match(/supabase\.rpc\('fn_cobertura_uso_suelo_parcela'/g) || []
  assert.equal(rpcCalls.length, 1, 'debería haber una única llamada a la RPC, después de resolver monitoreos.length === 1')
})

// ---------------------------------------------------------------
// QcDetailEditor.jsx — sección "Cobertura de la parcela" + bloqueo real del botón Aprobar
// ---------------------------------------------------------------

test('la sección "Cobertura de la parcela" solo se muestra para EUDR_USO_SUELO', () => {
  const source = read(DETAIL_EDITOR_PATH)
  assert.match(source, /const esUsoSuelo = record\.tabla_origen === 'EUDR_USO_SUELO'/)
  assert.match(source, /\{esUsoSuelo && \(/)
})

test('la cobertura se busca automáticamente (no detrás de un botón manual) al seleccionar un registro de Uso de Suelo', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const effect = source.match(/useEffect\(\(\) => \{\s*if \(!esUsoSuelo\) return[\s\S]*?\}, \[esUsoSuelo, record\.id_origen\]\)/)
  assert.ok(effect, 'el useEffect de auto-fetch de cobertura debería existir')
  assert.match(effect[0], /fetch\('\/api\/qc\/cobertura-uso-suelo'/)
  assert.match(
    effect[0],
    /uso_suelo_id: record\.id_origen/,
  )
  assert.ok(
    !/uso_suelo_id: record\.registro_id/.test(effect[0]),
    'BUG REAL encontrado en vivo: record.registro_id no es el id real de la fila (vw_monitoreo_poligonos/puntos) — debe usar record.id_origen, mismo campo que resolveUpdateTarget y la llamada existente a /api/qc/validate-spatial'
  )
})

// ver ADR-011, sección "Corrección: de bloqueante a informativo" — el
// bloqueo original creaba un círculo imposible (confirmado en vivo con 3
// registros/parcelas reales, siempre "Subdivisiones aprobadas: 0.00 ha"):
// el propio registro en revisión nunca cuenta en su propia suma hasta
// DESPUÉS de aprobarse, así que el último registro necesario para
// completar una parcela nunca podía pasar su propio candado.
test('el botón Aprobar YA NO se deshabilita por cobertura — solo por busy, igual que cualquier otro registro', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const approveButton = source.match(/onClick=\{onApprove\}[\s\S]*?<\/button>/)
  assert.ok(approveButton, 'el botón Aprobar debería existir')
  assert.match(approveButton[0], /disabled=\{busy\}/)
  assert.ok(
    !/coberturaResult/.test(approveButton[0]),
    'Aprobar no debe depender de coberturaResult en absoluto — el círculo imposible de ADR-011 ya no debe existir'
  )
})

test('el botón Rechazar NUNCA se deshabilita por cobertura (solo por busy/motivo vacío)', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const rejectButton = source.match(/onClick=\{onReject\}[\s\S]*?<\/button>/)
  assert.ok(rejectButton, 'el botón Rechazar debería existir')
  assert.match(rejectButton[0], /disabled=\{busy \|\| !motivo\.trim\(\)\}/)
  assert.ok(!/coberturaResult/.test(rejectButton[0]), 'Rechazar no debe depender de coberturaResult en absoluto')
})

test('el aviso de cobertura parcial es informativo (ámbar), nunca bloqueante (rojo/"No se puede aprobar")', () => {
  const source = read(DETAIL_EDITOR_PATH)
  assert.ok(!/No se puede aprobar/.test(source), 'no debería quedar ningún mensaje de bloqueo')
  assert.ok(!/bloquea_aprobacion/.test(source), 'el frontend ya no debe leer bloquea_aprobacion en absoluto')
  const bloque = source.match(/\{coberturaResult\.hueco_cobertura && \([\s\S]*?buildCoberturaAvisoMensaje[\s\S]*?\)\}/)
  assert.ok(bloque, 'el bloque de aviso informativo de cobertura debería existir')
  assert.match(bloque[0], /bg-amber-50 p-2 text-\[11px\] text-amber-800/, 'mismo estilo ámbar que el aviso de "Solapado X%" de Fase A')
  assert.ok(!/totalh/i.test(bloque[0]), 'el aviso de cobertura no debe mencionar totalh')
})

test('la sub-sección de totalh está etiquetada explícitamente como posiblemente no confiable, con referencia a ADR-011', () => {
  const source = read(DETAIL_EDITOR_PATH)
  assert.match(source, /Dato del Padrón — puede no ser confiable, ver ADR-011/)
})

// ---------------------------------------------------------------
// ADR-011 — documenta el caso real COOP-JS-003 y los 3 escenarios de verificación en vivo
// ---------------------------------------------------------------

test('el ADR-011 documenta el caso real COOP-JS-003 (hueco 38.9%) que justificó excluir totalh del bloqueo', () => {
  const source = read('docs/adr/ADR-011-cobertura-completa-uso-suelo.md')
  assert.match(source, /COOP-JS-003/)
  assert.match(source, /38\.86%|38\.9%/)
  assert.match(source, /totalh.*nunca participa|nunca participa.*totalh/is)
})

test('el ADR-011 documenta los 3 escenarios de verificación en vivo con resultados exactos', () => {
  const source = read('docs/adr/ADR-011-cobertura-completa-uso-suelo.md')
  assert.match(source, /"bloquea_aprobacion": true, "area_monitoreo_ha": 24\.6072/)
  assert.match(source, /"bloquea_aprobacion": false, "area_monitoreo_ha": 492\.068/)
  assert.match(source, /"bloquea_aprobacion": true, "area_monitoreo_ha": 491\.7018/)
})

test('el ADR-011 documenta la corrección: círculo imposible real, decisión de pasar a informativo, y la investigación futura pendiente sobre dónde aplicar el control real', () => {
  const source = read('docs/adr/ADR-011-cobertura-completa-uso-suelo.md')
  assert.match(source, /círculo imposible/i)
  assert.match(source, /informativo/i)
  assert.match(source, /fn_cobertura_uso_suelo_parcela/)
  assert.ok(!/DROP FUNCTION|CREATE OR REPLACE FUNCTION/.test(source), 'la RPC no debería haberse tocado — el ADR documenta que sigue igual')
  assert.match(source, /no\s+decidid[oa]\s+en\s+esta\s+tarea/i)
})
