// Pruebas de la corrección de 2 bugs reales en el Editor Vectorial de la
// Consola QC + investigación/mejora de la auditabilidad del solapamiento
// — ver docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md.
//
// Bug 1 (popup con nombre crudo de tabla): CONFIRMADO real, verificado en
// vivo en el navegador ("EUDR_INSTALACIONES" mostrado literalmente en un
// popup) antes de tocar código — corregido eliminando bindPopup()/
// openPopup().
//
// Bug 2 ("editor de puntos abre modo polígono"): investigado a fondo
// (lectura del código + verificación en vivo con javascript_tool
// inspeccionando el DOM real) y NO se reprodujo — al editar un registro
// Point, geoman solo agrega la clase leaflet-pm-draggable al marcador,
// cero marcadores de vértice en el DOM. La mejora real hecha acá es de
// claridad de UI (texto de ayuda distinto según el tipo de geometría
// REAL del registro, nunca inferido por tabla_origen — pedido explícito
// del prompt aunque no había un bug funcional detrás).
//
// Mismo criterio de inspección de código fuente que el resto de esta
// serie (no hay Jest/Testing Library en el proyecto).
//
// Ejecutar con: node --test tests/test_qc_editor_bugs_and_solapamiento.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('QcConsoleMap.jsx ya no llama bindPopup()/openPopup() con el nombre crudo de tabla_origen', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.ok(!/layer\.bindPopup\(/.test(source), 'no debería quedar ninguna llamada real a bindPopup()')
  assert.ok(!/\.openPopup\?\.\(\)/.test(source), 'no debería quedar ninguna llamada real a openPopup()')
})

test('QcDetailEditor.jsx deriva isPointRecord de la geometría real (record.geom), nunca de tabla_origen', () => {
  const source = read('app/dashboard/qc/components/QcDetailEditor.jsx')
  assert.match(source, /isPointRecord = recordGeometry\?\.type === 'Point'/)
  const helpTextBlock = source.match(/\{isEditingGeometry && \([\s\S]*?\)\}/)
  assert.ok(helpTextBlock, 'el bloque de texto de ayuda debería existir')
  assert.match(helpTextBlock[0], /isPointRecord/)
  assert.ok(!/tabla_origen === 'EUDR_INSTALACIONES'/.test(helpTextBlock[0]),
    'el texto de ayuda no debería inferir el tipo por tabla_origen')
})

test('QcConsoleMap.jsx acepta y renderiza comparisonFeatures como capa secundaria punteada', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  assert.match(source, /comparisonFeatures/)
  assert.match(source, /comparisonGroupRef/)
  assert.match(source, /dashArray: '6, 6'/)
})

test('QcConsoleMap.jsx limpia (clearLayers) la capa de comparación en cada cambio de comparisonFeatures', () => {
  const source = read('components/gis/QcConsoleMap.jsx')
  const effect = source.match(/useEffect\(\(\) => \{\s*const L = leafletRef\.current\s*const group = comparisonGroupRef[\s\S]*?\}, \[comparisonFeatures\]\)/)
  assert.ok(effect, 'el efecto de comparisonFeatures debería existir')
  assert.match(effect[0], /group\.clearLayers\(\)/)
})

test('page.jsx limpia comparisonFeatures al cambiar de registro seleccionado', () => {
  const source = read('app/dashboard/qc/page.jsx')
  const resetEffect = source.match(/useEffect\(\(\) => \{\s*setEditingGeometryKey\(null\)[\s\S]*?\}, \[selectedKey\]\)/)
  assert.ok(resetEffect, 'el efecto de reset por selectedKey debería existir')
  assert.match(resetEffect[0], /setComparisonFeatures\(\[\]\)/)
})

test('page.jsx solo calcula la capa de comparación para el registro actualmente seleccionado (nunca durante "Validar Todos" en batch)', () => {
  const source = read('app/dashboard/qc/page.jsx')
  const fn = source.match(/async function handleValidateTopology\([\s\S]*?\n  \}/)
  assert.ok(fn, 'handleValidateTopology debería existir')
  assert.match(fn[0], /record\.key === selectedKey/)
  assert.match(fn[0], /fetchComparisonGeometries/)
})

test('page.jsx pasa comparisonFeatures a QcConsoleMap', () => {
  const source = read('app/dashboard/qc/page.jsx')
  const mapCall = source.match(/<QcConsoleMap[\s\S]*?\/>/)
  assert.ok(mapCall, 'el uso de QcConsoleMap debería existir')
  assert.match(mapCall[0], /comparisonFeatures=\{comparisonFeatures\}/)
})

test('fn_validar_topologia_eudr (migración instalada) ya filtra por ID_Organizacion, excluye el propio registro, y usa ::geography para el % de solapamiento', () => {
  const source = read('supabase/migrations/20260820_fn_validar_topologia_eudr.sql')
  assert.match(source, /WHERE "ID_Organizacion" = v_org/)
  assert.match(source, /NOT \(p_tabla_origen = 'EUDR_MONITOREO' AND id_monitoreo::text = p_registro_id\)/)
  assert.match(source, /NOT \(p_tabla_origen = 'EUDR_USO_SUELO' AND id::text = p_registro_id\)/)
  assert.match(source, /ST_Area\(ST_Intersection\(v_geom, geom\)::geography\)/)
})

// ---------------------------------------------------------------
// Fase A: excluir del solapamiento la contención esperada de una
// subdivisión de EUDR_USO_SUELO dentro del perímetro de Monitoreo de SU
// PROPIA parcela — ver docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md
// (sección "Fase A", agregada 2026-08-22).
//
// PREMISA VERIFICADA ANTES DE ESCRIBIR ESTA MIGRACIÓN (confirmado contra
// datos reales, REST en vivo + el GeoPackage real de un paquete de
// prueba): EUDR_USO_SUELO.id_parcela NO es comparable contra
// EUDR_MONITOREO."ID_Parcela_Fija" — son identificadores de espacios
// distintos (GUID interno de QField vs. código de negocio); el GUID
// original que sí los vincularía se descarta en
// scripts/etl_drive_to_supabase.py::build_monitoreo_payload y nunca se
// persiste. Por eso el fix usa un heurístico ESPACIAL (contención
// exclusiva), no un join por ID — decisión confirmada con el usuario.
//
// REPRODUCCIÓN REAL EN VIVO del bug (antes del fix, contra la instancia
// real, vía RPC): EUDR_USO_SUELO id=18 (0.9455 ha, ORG-TEST-E2E) →
// `solapa: true, solapamiento_max_pct: 100.00` contra su propio
// EUDR_MONITOREO padre (id_monitoreo b2f305a0-..., ID_Parcela_Fija
// COOP-JS-001) — el mismo patrón exacto del reporte original ("0.95 ha
// completamente dentro del perímetro de su propia parcela"). También
// reproducido en id=19 (100.00%) e id=20 (99.64%) contra su propio padre
// (10425cbd-..., ID_Parcela_Fija COOP-JS-003).
// ---------------------------------------------------------------

const CONTENCION_MIGRATION_PATH = 'supabase/migrations/20260822_173416_fn_validar_topologia_contencion_parcela.sql'

test('la migración de Fase A calcula v_contenedor_exclusivo SOLO para EUDR_USO_SUELO, y solo cuando hay EXACTAMENTE UN Monitoreo aprobado que contiene por completo la subdivisión', () => {
  const source = read(CONTENCION_MIGRATION_PATH)
  assert.match(source, /IF p_tabla_origen = 'EUDR_USO_SUELO' THEN/)
  assert.match(source, /CASE WHEN count\(\*\) = 1 THEN MIN\(id_monitoreo\) ELSE NULL END/)
  assert.match(source, /AND ST_Contains\(geom_inspeccion, v_geom\);/)
})

test('la migración de Fase A excluye el contenedor exclusivo SOLO de la rama EUDR_MONITOREO de candidatos (regla 1), nunca de la rama EUDR_USO_SUELO (regla 2 sin cambios)', () => {
  const source = read(CONTENCION_MIGRATION_PATH)
  const monitoreoRama = source.match(/SELECT 'EUDR_MONITOREO'::text[\s\S]*?UNION ALL/)
  assert.ok(monitoreoRama, 'la rama EUDR_MONITOREO del CTE candidatos debería existir')
  assert.match(monitoreoRama[0], /AND \(v_contenedor_exclusivo IS NULL OR id_monitoreo <> v_contenedor_exclusivo\)/)

  const usoSueloRama = source.match(/UNION ALL\s*SELECT 'EUDR_USO_SUELO'::text[\s\S]*?\),\s*solapados AS/)
  assert.ok(usoSueloRama, 'la rama EUDR_USO_SUELO del CTE candidatos debería existir')
  assert.ok(
    !/v_contenedor_exclusivo/.test(usoSueloRama[0]),
    'la rama EUDR_USO_SUELO NO debería filtrar por v_contenedor_exclusivo — dos subdivisiones de la misma parcela que se solapan entre sí deben seguir marcándose (regla 2)'
  )
})

test('la migración de Fase A NO toca el filtro por ID_Organizacion ni la exclusión del propio registro (comportamiento contra OTRA parcela sin cambios, regla 3)', () => {
  const source = read(CONTENCION_MIGRATION_PATH)
  assert.match(source, /WHERE "ID_Organizacion" = v_org/)
  assert.match(source, /NOT \(p_tabla_origen = 'EUDR_MONITOREO' AND id_monitoreo::text = p_registro_id\)/)
  assert.match(source, /NOT \(p_tabla_origen = 'EUDR_USO_SUELO' AND id::text = p_registro_id\)/)
})

test('la migración de Fase A documenta que es un heurístico espacial temporal (no una relación real de datos) y por qué', () => {
  const source = read(CONTENCION_MIGRATION_PATH)
  assert.match(source, /heur.stico/i)
  assert.match(source, /TEMPORAL/)
  assert.match(source, /id_parcela.*NO es comparable|Confirmado FALSO/i)
})

test('el ADR-005 documenta la Fase A: la premisa falsa descartada, la decisión de heurístico espacial, y el hallazgo real en vivo', () => {
  const source = read('docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md')
  assert.match(source, /Fase A/)
  assert.match(source, /id_parcela/)
  assert.match(source, /ST_Contains/)
  assert.match(source, /heur.stico/i)
})
