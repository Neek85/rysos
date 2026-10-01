import { SanidadActividadCrearSchema, SanidadRegistroCrearSchema } from '../../../../lib/validations/pecuario'

const UUID = '11111111-1111-1111-1111-111111111111'
const GALPON = '22222222-2222-2222-2222-222222222222'

describe('SanidadActividadCrearSchema', () => {
  const base = { ID_Organizacion: 'GRANJA-TEST', nombre: 'Control de roedores', alcance: 'granja' as const, frecuencia_dias: 15 }

  test('acepta actividad válida de ambos alcances', () => {
    expect(SanidadActividadCrearSchema.safeParse(base).success).toBe(true)
    expect(SanidadActividadCrearSchema.safeParse({ ...base, alcance: 'galpon' }).success).toBe(true)
  })
  test('rechaza nombre vacío o solo espacios', () => {
    expect(SanidadActividadCrearSchema.safeParse({ ...base, nombre: '   ' }).success).toBe(false)
  })
  test('rechaza frecuencia 0, negativa, decimal o NaN', () => {
    for (const f of [0, -3, 1.5, NaN]) {
      expect(SanidadActividadCrearSchema.safeParse({ ...base, frecuencia_dias: f }).success).toBe(false)
    }
  })
  test('rechaza alcance fuera del enum real (lote/poza no existen)', () => {
    expect(SanidadActividadCrearSchema.safeParse({ ...base, alcance: 'lote' }).success).toBe(false)
  })
})

describe('SanidadRegistroCrearSchema', () => {
  const base = { ID_Organizacion: 'GRANJA-TEST', actividad_id: UUID, fecha: '2026-09-30' }

  test('acepta registro de granja sin galpón y con opcionales nulos', () => {
    expect(SanidadRegistroCrearSchema.safeParse({ ...base, galpon_id: null, producto_usado: null }).success).toBe(true)
  })
  test('acepta registro por galpón con todos los campos', () => {
    const r = SanidadRegistroCrearSchema.safeParse({ ...base, galpon_id: GALPON, producto_usado: 'amonio', responsable: 'Ana', observaciones: 'ok' })
    expect(r.success).toBe(true)
  })
  test('rechaza fecha mal formada y actividad_id no uuid', () => {
    expect(SanidadRegistroCrearSchema.safeParse({ ...base, fecha: '30/09/2026' }).success).toBe(false)
    expect(SanidadRegistroCrearSchema.safeParse({ ...base, actividad_id: 'x' }).success).toBe(false)
  })
  test('rechaza producto_usado/responsable por encima de 150 caracteres', () => {
    expect(SanidadRegistroCrearSchema.safeParse({ ...base, producto_usado: 'a'.repeat(151) }).success).toBe(false)
    expect(SanidadRegistroCrearSchema.safeParse({ ...base, responsable: 'a'.repeat(151) }).success).toBe(false)
  })
})
