// Código de parcela único por ubicación (ADR-014). A diferencia de Fase B
// (cobertura, ADR-011 — informativa tras el círculo imposible), este
// bloqueo SÍ frena "Aprobar"/"Rechazar": la regla de negocio ("un código de
// parcela = un único lugar físico") es absoluta, confirmada por el usuario,
// no una heurística — y no tiene la circularidad que tenía cobertura (un
// conflicto entre dos registros existentes no depende de que ninguno se
// apruebe primero).
//
// Ejecutar con: node --test tests/test_qc_codigo_parcela_unico.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  validateCodigoParcelaRequest,
  buildConflictoParcelaMensaje,
  formatDistanciaLegible,
} from '../lib/qcCodigoParcelaUnico.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

const MIGRATION_PATH = 'supabase/migrations/20260823_200000_fn_validar_codigo_parcela_unico.sql'
const MIGRATION_CONTEXTO_PATH =
  'supabase/migrations/20260823_210000_fn_validar_codigo_parcela_unico_contexto_legible.sql'
const ROUTE_PATH = 'app/api/qc/validar-codigo-parcela/route.js'
const DETAIL_EDITOR_PATH = 'app/dashboard/qc/components/QcDetailEditor.jsx'
const ETL_PATH = 'scripts/etl_drive_to_supabase.py'
const QC_ACTIONS_PATH = 'lib/eudrQcActions.js'

// ---------------------------------------------------------------
// lib/qcCodigoParcelaUnico.js — lógica pura
// ---------------------------------------------------------------

test('validateCodigoParcelaRequest exige monitoreo_id', () => {
  assert.deepEqual(validateCodigoParcelaRequest({ monitoreo_id: 'uuid-1' }), {
    valid: true,
    monitoreoId: 'uuid-1',
  })
  const invalid = validateCodigoParcelaRequest({})
  assert.equal(invalid.valid, false)
  assert.match(invalid.error, /monitoreo_id/)
})

test('buildConflictoParcelaMensaje devuelve null sin conflicto', () => {
  assert.equal(buildConflictoParcelaMensaje({ tiene_conflicto: false }), null)
  assert.equal(buildConflictoParcelaMensaje(null), null)
})

test('formatDistanciaLegible redondea a metros por debajo de 1000m, y a km con 1 decimal por encima', () => {
  assert.equal(formatDistanciaLegible(768.53), '769 m')
  assert.equal(formatDistanciaLegible(99.4), '99 m')
  assert.equal(formatDistanciaLegible(1213.49), '1.2 km')
  assert.equal(formatDistanciaLegible(3532.75), '3.5 km')
  assert.equal(formatDistanciaLegible(1000), '1.0 km')
})

test('buildConflictoParcelaMensaje explica la regla de negocio en lenguaje simple, sin exponer el id_monitoreo (UUID) del otro registro', () => {
  const mensaje = buildConflictoParcelaMensaje({
    tiene_conflicto: true,
    ID_Parcela_Fija: 'COOP-JS-001',
    registros_en_conflicto: [
      {
        id_monitoreo: 'b2f305a0-f549-5d08-9ab1-c00596df9987',
        distancia_m: 1213.49,
        estado_revision: 'APROBADO',
        fecha_monitoreo: '2026-07-06',
        tecnico_responsable: 'Victor campos',
      },
    ],
  })
  // Elemento 1: la regla de negocio en sí.
  assert.match(mensaje, /Un código de parcela debe corresponder siempre a un único lugar físico/)
  // Elemento 2: qué se detectó -- código, distancia legible (no "1213.49m" crudo), contexto del otro registro.
  assert.match(mensaje, /COOP-JS-001/)
  assert.match(mensaje, /1\.2 km/)
  assert.match(mensaje, /2026-07-06/)
  assert.match(mensaje, /Victor campos/)
  assert.match(mensaje, /ya fue aprobado anteriormente/)
  // Elemento 3: qué hacer -- revisión manual, sin prometer un flujo que no existe.
  assert.match(mensaje, /revisión manual/)
  assert.match(mensaje, /confirmá cuál de los dos registros tiene el código correcto/)
  // Nunca el UUID técnico ni el valor crudo de estado_revision.
  assert.ok(!mensaje.includes('b2f305a0-f549-5d08-9ab1-c00596df9987'), 'no debe exponer el id_monitoreo')
  assert.ok(!/\bAPROBADO\b/.test(mensaje), 'no debe mostrar el valor crudo de estado_revision')
  assert.ok(!/1213\.49/.test(mensaje), 'no debe mostrar la distancia cruda sin redondear')
})

test('buildConflictoParcelaMensaje describe cada estado en lenguaje llano (RECHAZADO, PENDIENTE)', () => {
  const mensajeRechazado = buildConflictoParcelaMensaje({
    tiene_conflicto: true,
    ID_Parcela_Fija: 'COOP-JS-003',
    registros_en_conflicto: [{ distancia_m: 768.53, estado_revision: 'RECHAZADO', fecha_monitoreo: '2026-08-19', tecnico_responsable: 'Victor campos' }],
  })
  assert.match(mensajeRechazado, /ya fue rechazado anteriormente/)

  const mensajePendiente = buildConflictoParcelaMensaje({
    tiene_conflicto: true,
    ID_Parcela_Fija: 'COOP-JS-004',
    registros_en_conflicto: [{ distancia_m: 3532.75, estado_revision: 'PENDIENTE', fecha_monitoreo: '2026-08-23', tecnico_responsable: 'Ismael Diaz' }],
  })
  assert.match(mensajePendiente, /todavía está pendiente de revisión/)
})

test('buildConflictoParcelaMensaje sigue funcionando si el registro en conflicto no tiene fecha/técnico cargados (registros viejos)', () => {
  const mensaje = buildConflictoParcelaMensaje({
    tiene_conflicto: true,
    ID_Parcela_Fija: 'COOP-JS-999',
    registros_en_conflicto: [{ distancia_m: 500, estado_revision: 'PENDIENTE', fecha_monitoreo: null, tecnico_responsable: null }],
  })
  assert.ok(mensaje, 'debería seguir generando un mensaje válido')
  assert.ok(!/null/.test(mensaje), 'nunca debe mostrar el texto literal "null"')
  assert.match(mensaje, /500 m/)
})

test('buildConflictoParcelaMensaje lista múltiples registros en conflicto, no solo el primero', () => {
  const mensaje = buildConflictoParcelaMensaje({
    tiene_conflicto: true,
    ID_Parcela_Fija: 'COOP-JS-001',
    registros_en_conflicto: [
      { distancia_m: 200, estado_revision: 'PENDIENTE', fecha_monitoreo: '2026-08-01', tecnico_responsable: 'Ana' },
      { distancia_m: 500, estado_revision: 'RECHAZADO', fecha_monitoreo: '2026-08-05', tecnico_responsable: 'Beto' },
    ],
  })
  assert.match(mensaje, /2026-08-01/)
  assert.match(mensaje, /Ana/)
  assert.match(mensaje, /2026-08-05/)
  assert.match(mensaje, /Beto/)
})

// ---------------------------------------------------------------
// Migración SQL — umbral con nombre, exclusión del propio registro,
// distancia geodésica real
// ---------------------------------------------------------------

test('la migración usa un umbral con nombre (v_umbral_conflicto_m = 100), no un número mágico inline', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /v_umbral_conflicto_m constant numeric := 100;/)
})

test('la migración excluye siempre el propio registro (id_monitoreo != p_monitoreo_id)', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /m\.id_monitoreo != p_monitoreo_id/)
})

test('la migración filtra por la misma organización y el mismo código de parcela', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /m\."ID_Organizacion" = v_org/)
  assert.match(source, /m\."ID_Parcela_Fija" = v_id_parcela_fija/)
})

test('la migración calcula distancia geodésica real entre centroides (::geography), nunca ST_Contains/área', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /ST_Distance\(\s*ST_Centroid\(v_geom\)::geography,\s*ST_Centroid\(m\.geom_inspeccion\)::geography\s*\)/)
})

test('la migración nunca filtra por estado_revision del otro registro (un conflicto es real sin importar el estado)', () => {
  const source = read(MIGRATION_PATH)
  const whereBlock = source.match(/FROM public\."EUDR_MONITOREO" m[\s\S]*?;/)
  assert.ok(whereBlock, 'el bloque de la consulta de conflicto debería existir')
  assert.ok(!/estado_revision = 'APROBADO'/.test(whereBlock[0]))
  assert.ok(!/estado_revision = 'PENDIENTE'/.test(whereBlock[0]))
})

test('la migración devuelve tiene_conflicto=false y sin ID_Parcela_Fija cuando el registro no tiene código', () => {
  const source = read(MIGRATION_PATH)
  assert.match(source, /IF v_id_parcela_fija IS NULL THEN/)
  assert.match(source, /'tiene_conflicto', false/)
})

// ---------------------------------------------------------------
// Migración de contexto legible (20260823_210000): agrega
// fecha_monitoreo/tecnico_responsable a cada registro en conflicto, para
// que el mensaje ya no dependa del id_monitoreo crudo.
// ---------------------------------------------------------------

test('la migración de contexto legible agrega fecha_monitoreo y tecnico_responsable a cada registro en conflicto', () => {
  const source = read(MIGRATION_CONTEXTO_PATH)
  assert.match(source, /'fecha_monitoreo', m\.fecha_monitoreo/)
  assert.match(source, /'tecnico_responsable', m\.tecnico_responsable/)
})

test('la migración de contexto legible mantiene id_monitoreo en la respuesta (útil para resolver en la base), mismo umbral y misma exclusión', () => {
  const source = read(MIGRATION_CONTEXTO_PATH)
  assert.match(source, /'id_monitoreo', m\.id_monitoreo/)
  assert.match(source, /v_umbral_conflicto_m constant numeric := 100;/)
  assert.match(source, /m\.id_monitoreo != p_monitoreo_id/)
})

// ---------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------

test('la ruta valida el body y llama a fn_validar_codigo_parcela_unico con p_monitoreo_id', () => {
  const source = read(ROUTE_PATH)
  assert.match(source, /validateCodigoParcelaRequest\(body\)/)
  assert.match(source, /supabase\.rpc\('fn_validar_codigo_parcela_unico', \{\s*p_monitoreo_id: parsed\.monitoreoId,?\s*\}\)/)
})

// ---------------------------------------------------------------
// QcDetailEditor.jsx — bloqueo real (no informativo) de Aprobar/Rechazar
// ---------------------------------------------------------------

test('la validación de código de parcela solo se busca para EUDR_MONITOREO', () => {
  const source = read(DETAIL_EDITOR_PATH)
  assert.match(source, /const esMonitoreo = record\.tabla_origen === 'EUDR_MONITOREO'/)
  assert.match(source, /if \(!esMonitoreo\) return/)
})

test('se busca automáticamente al seleccionar el registro (no detrás de un botón manual)', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const effect = source.match(/useEffect\(\(\) => \{\s*if \(!esMonitoreo\) return[\s\S]*?\}, \[esMonitoreo, record\.id_origen\]\)/)
  assert.ok(effect, 'el useEffect de auto-fetch de conflicto de parcela debería existir')
  assert.match(effect[0], /fetch\('\/api\/qc\/validar-codigo-parcela'/)
  assert.match(effect[0], /monitoreo_id: record\.id_origen/)
})

test('el botón Aprobar se deshabilita cuando hay conflicto de código de parcela', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const approveButton = source.match(/onClick=\{onApprove\}[\s\S]*?<\/button>/)
  assert.ok(approveButton, 'el botón Aprobar debería existir')
  assert.match(approveButton[0], /disabled=\{busy \|\| conflictoParcela\?\.tiene_conflicto\}/)
})

test('el botón Rechazar también se deshabilita cuando hay conflicto de código de parcela', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const rejectButton = source.match(/onClick=\{onReject\}[\s\S]*?<\/button>/)
  assert.ok(rejectButton, 'el botón Rechazar debería existir')
  assert.match(rejectButton[0], /disabled=\{busy \|\| !motivo\.trim\(\) \|\| conflictoParcela\?\.tiene_conflicto\}/)
})

test('el aviso de conflicto es bloqueante (rojo), distinto del estilo ámbar informativo de Fase A/B', () => {
  const source = read(DETAIL_EDITOR_PATH)
  const bloque = source.match(/\{esMonitoreo && conflictoParcela\?\.tiene_conflicto && \([\s\S]*?buildConflictoParcelaMensaje[\s\S]*?\)\}/)
  assert.ok(bloque, 'el bloque de bloqueo de conflicto de parcela debería existir')
  assert.match(bloque[0], /border-red-200 bg-red-50/, 'debe ser rojo (bloqueante), no ámbar (informativo)')
})

test('QcDetailEditor importa buildConflictoParcelaMensaje desde lib/qcCodigoParcelaUnico', () => {
  const source = read(DETAIL_EDITOR_PATH)
  assert.match(source, /import \{ buildConflictoParcelaMensaje \} from '@\/lib\/qcCodigoParcelaUnico'/)
})

// ---------------------------------------------------------------
// scripts/etl_drive_to_supabase.py — advertencia informativa, nunca bloqueante
// ---------------------------------------------------------------

test('el ETL usa el mismo umbral (100m) documentado, con nombre, no un número mágico', () => {
  const source = read(ETL_PATH)
  assert.match(source, /PARCELA_CONFLICT_THRESHOLD_M = 100/)
})

test('el ETL nunca omite/bloquea el upsert por un conflicto de código de parcela — solo advierte', () => {
  const source = read(ETL_PATH)
  const fn = source.match(/def warn_parcela_code_conflicts\([\s\S]*?\n    def process_layer_rows/)
  assert.ok(fn, 'warn_parcela_code_conflicts debería existir antes de process_layer_rows')
  // El único "continue" permitido es el de saltar UN candidato sin geometría
  // dentro del for interno — no debe existir ningún "raise" que aborte la
  // ingesta completa (best-effort real, ver también el try/except que
  // envuelve toda la función).
  assert.ok(!/raise/.test(fn[0]), 'la advertencia nunca debe relanzar — best-effort real')
  assert.match(fn[0], /except Exception as exc:/, 'debe atrapar cualquier fallo, nunca dejarlo propagar')
})

test('el ETL solo llama warn_parcela_code_conflicts para EUDR_MONITOREO', () => {
  const source = read(ETL_PATH)
  assert.match(source, /if table_name == MONITOREO_TABLE:\s*\n\s*self\.warn_parcela_code_conflicts\(/)
})

// ---------------------------------------------------------------
// ADR-014
// ---------------------------------------------------------------

test('el ADR-014 documenta la regla de negocio, el umbral provisorio (100m) y su limitación honesta', () => {
  const source = read('docs/adr/ADR-014-codigo-parcela-unico-por-ubicacion.md')
  assert.match(source, /100\s*m/i)
  assert.match(source, /no\s+est[aá]\s+calibrad[oa]/i)
})

test('el ADR-014 documenta que 2 de los 3 casos conocidos ya fueron aprobados/rechazados durante verificaciones de esta sesión', () => {
  const source = read('docs/adr/ADR-014-codigo-parcela-unico-por-ubicacion.md')
  assert.match(source, /COOP-JS-001/)
  assert.match(source, /COOP-JS-003/)
  assert.match(source, /COOP-JS-004/)
  assert.match(source, /artefacto/i)
})

test('el ADR-014 documenta que la ingesta NUNCA se bloquea, solo la decisión de QC', () => {
  const source = read('docs/adr/ADR-014-codigo-parcela-unico-por-ubicacion.md')
  assert.match(source, /no\s+bloquear?\s+la\s+ingesta/i)
})

// ---------------------------------------------------------------
// lib/eudrQcActions.js — guard server-side (cierre del gap documentado en
// ADR-014: el bloqueo no debe depender únicamente del botón deshabilitado
// en el frontend — ver también tests/test_eudr_qc_actions.mjs para la
// cobertura de comportamiento con mocks).
// ---------------------------------------------------------------

test('approveRecord y rejectRecord invocan el guard de conflicto de parcela antes de resolveUpdateTarget/el UPDATE', () => {
  const source = read(QC_ACTIONS_PATH)
  const approveFn = source.match(/export async function approveRecord\([\s\S]*?\n}/)
  const rejectFn = source.match(/export async function rejectRecord\([\s\S]*?\n}/)
  assert.ok(approveFn && rejectFn, 'approveRecord/rejectRecord deberían existir')
  assert.match(approveFn[0], /await assertSinConflictoDeParcela\(supabase, record\)/)
  assert.match(rejectFn[0], /await assertSinConflictoDeParcela\(supabase, record\)/)
  // El guard debe llamarse ANTES del UPDATE real (resolveUpdateTarget/.update(...)),
  // nunca después de que el dato ya se escribió.
  const guardIdxApprove = approveFn[0].indexOf('assertSinConflictoDeParcela')
  const updateIdxApprove = approveFn[0].indexOf('.update(')
  assert.ok(guardIdxApprove < updateIdxApprove, 'el guard debe correr antes del UPDATE en approveRecord')
  const guardIdxReject = rejectFn[0].indexOf('assertSinConflictoDeParcela')
  const updateIdxReject = rejectFn[0].indexOf('.update(')
  assert.ok(guardIdxReject < updateIdxReject, 'el guard debe correr antes del UPDATE en rejectRecord')
})

test('el guard solo aplica a EUDR_MONITOREO y usa fn_validar_codigo_parcela_unico + buildConflictoParcelaMensaje (mismo mensaje que el frontend)', () => {
  const source = read(QC_ACTIONS_PATH)
  const guardFn = source.match(/async function assertSinConflictoDeParcela\([\s\S]*?\n}/)
  assert.ok(guardFn, 'assertSinConflictoDeParcela debería existir')
  assert.match(guardFn[0], /if \(record\.tabla_origen !== 'EUDR_MONITOREO'\) return/)
  assert.match(guardFn[0], /supabase\.rpc\('fn_validar_codigo_parcela_unico', \{\s*p_monitoreo_id: record\.id_monitoreo,?\s*\}\)/)
  assert.match(guardFn[0], /if \(error\) throw error/, 'un fallo de la RPC misma debe abortar -- nunca fallar abierto')
  assert.match(guardFn[0], /throw new EUDRQcError\(buildConflictoParcelaMensaje\(data\)\)/)
})

test('eudrQcActions.js importa buildConflictoParcelaMensaje desde lib/qcCodigoParcelaUnico (una sola fuente del mensaje, frontend y backend)', () => {
  const source = read(QC_ACTIONS_PATH)
  assert.match(source, /import \{ buildConflictoParcelaMensaje \} from '\.\/qcCodigoParcelaUnico\.js'/)
})

test('el ADR-014 documenta el gap del guard server-side como cerrado, con evidencia de la verificación directa a la Server Action', () => {
  const source = read('docs/adr/ADR-014-codigo-parcela-unico-por-ubicacion.md')
  assert.match(source, /Gap cerrado/i)
  assert.match(source, /assertSinConflictoDeParcela/)
  assert.match(source, /sin pasar por la UI/i)
})
