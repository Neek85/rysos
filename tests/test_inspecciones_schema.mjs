// Pruebas del schema Zod real del Formulario de Inspecciones FED
// (lib/inspeccionesSchema.js) — datos válidos e inválidos, incluida la
// paridad de enumeraciones (Estado/Tipo_Inspeccion/Resultado_Global)
// agregada en specs/inspecciones_fed_audit.md.
//
// Sin dependencias nuevas: usa el módulo nativo `node:assert` y el runner
// nativo `node:test` (disponible desde Node 18+, sin instalar nada). No hay
// Jest/Vitest instalado en el proyecto (confirmado: no existe en
// package.json) y no se agregó ninguno para esta tarea — decisión
// confirmada con el usuario.
//
// Ejecutar con: node --test tests/test_inspecciones_schema.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspeccionSchema, DEFAULT_VALUES } from '../lib/inspeccionesSchema.js'

// DEFAULT_VALUES.Inspector es '' (campo requerido, min(1)) — es el estado
// inicial del formulario antes de que el usuario escriba, no un valor que
// deba pasar la validación por sí solo. VALID_BASE agrega un Inspector no
// vacío para que cada test de un campo específico no falle por una causa
// ajena al campo bajo prueba.
const VALID_BASE = { ...DEFAULT_VALUES, Inspector: 'Inspector de Prueba' }

function withOverrides(overrides) {
  return { ...VALID_BASE, ...overrides }
}

test('DEFAULT_VALUES (estado inicial real del formulario) falla por Inspector vacío', () => {
  const result = inspeccionSchema.safeParse(DEFAULT_VALUES)
  assert.equal(result.success, false)
})

test('VALID_BASE (DEFAULT_VALUES + Inspector no vacío) pasa la validación', () => {
  const result = inspeccionSchema.safeParse(VALID_BASE)
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues))
})

test('Inspector vacío falla (campo requerido)', () => {
  const result = inspeccionSchema.safeParse(withOverrides({ Inspector: '' }))
  assert.equal(result.success, false)
})

test('Estado acepta los 4 valores reales del <select> de TabGeneral/TabCierre', () => {
  for (const value of ['En Proceso', 'Cerrada', 'Aprobada', 'Rechazada']) {
    const result = inspeccionSchema.safeParse(withOverrides({ Estado: value }))
    assert.equal(result.success, true, `Estado="${value}" debería ser válido`)
  }
})

test('Estado rechaza un valor fuera de la lista (paridad de enum)', () => {
  const result = inspeccionSchema.safeParse(withOverrides({ Estado: 'Valor Inventado' }))
  assert.equal(result.success, false)
})

test('Estado vacío falla (a diferencia de Tipo_Inspeccion/Resultado_Global, no tiene opción en blanco en el UI)', () => {
  const result = inspeccionSchema.safeParse(withOverrides({ Estado: '' }))
  assert.equal(result.success, false)
})

test('Tipo_Inspeccion acepta cadena vacía (opción "— Seleccionar —" del UI)', () => {
  const result = inspeccionSchema.safeParse(withOverrides({ Tipo_Inspeccion: '' }))
  assert.equal(result.success, true)
})

test('Tipo_Inspeccion acepta los 5 valores reales del <select>', () => {
  for (const value of ['Interna', 'Externa', 'Seguimiento', 'Anunciada', 'No anunciada']) {
    const result = inspeccionSchema.safeParse(withOverrides({ Tipo_Inspeccion: value }))
    assert.equal(result.success, true, `Tipo_Inspeccion="${value}" debería ser válido`)
  }
})

test('Tipo_Inspeccion rechaza un valor fuera de la lista', () => {
  const result = inspeccionSchema.safeParse(withOverrides({ Tipo_Inspeccion: 'Sorpresa' }))
  assert.equal(result.success, false)
})

test('Resultado_Global acepta cadena vacía y los 4 valores reales del <select>', () => {
  for (const value of ['', 'Aprobado', 'Aprobado con observaciones', 'No aprobado', 'Suspendido']) {
    const result = inspeccionSchema.safeParse(withOverrides({ Resultado_Global: value }))
    assert.equal(result.success, true, `Resultado_Global="${value}" debería ser válido`)
  }
})

test('Resultado_Global rechaza un valor fuera de la lista', () => {
  const result = inspeccionSchema.safeParse(withOverrides({ Resultado_Global: 'Pendiente' }))
  assert.equal(result.success, false)
})

test('campos numéricos coercen string a número (react-hook-form entrega strings de <input type="number">)', () => {
  const result = inspeccionSchema.safeParse(withOverrides({ familia: '4', total_puntaje_mic: '87.5' }))
  assert.equal(result.success, true)
  assert.equal(result.data.familia, 4)
  assert.equal(result.data.total_puntaje_mic, 87.5)
})

test('campos numéricos aceptan null (valor por defecto antes de completar el formulario)', () => {
  const result = inspeccionSchema.safeParse(withOverrides({ familia: null }))
  assert.equal(result.success, true)
})

test('PII (socio_dni, socio_nombre_completo) no está restringida por el schema — solo se valida forma/tipo, nunca se registra en consola en ningún punto del módulo (verificado por auditoría estática, ver specs/inspecciones_fed_audit.md)', () => {
  const result = inspeccionSchema.safeParse(
    withOverrides({ socio_dni: '12345678', socio_nombre_completo: 'Juan Pérez' })
  )
  assert.equal(result.success, true)
})
