import {
  SugerenciaReemplazoAccionSchema,
  SugerenciaReemplazoResolverSchema,
} from '../../../../lib/validations/pecuario'

const REPRODUCTOR = '11111111-1111-1111-1111-111111111111'
const base = { reproductor_id: REPRODUCTOR, ID_Organizacion: 'GRANJA-TEST' }

describe('SugerenciaReemplazoResolverSchema', () => {
  test('acepta los dos estados válidos: confirmada e ignorada', () => {
    for (const estado of ['confirmada', 'ignorada'] as const) {
      const r = SugerenciaReemplazoResolverSchema.safeParse({ ...base, estado })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.estado).toBe(estado)
    }
  })

  test('rechaza el estado pendiente (no hay "deshacer" desde la app)', () => {
    expect(SugerenciaReemplazoResolverSchema.safeParse({ ...base, estado: 'pendiente' }).success).toBe(false)
  })

  test('rechaza un estado desconocido o ausente', () => {
    expect(SugerenciaReemplazoResolverSchema.safeParse({ ...base, estado: 'descartada' }).success).toBe(false)
    expect(SugerenciaReemplazoResolverSchema.safeParse(base).success).toBe(false)
  })

  test('rechaza reproductor_id que no es uuid y reproductor_id/organización ausentes', () => {
    expect(SugerenciaReemplazoResolverSchema.safeParse({ ...base, reproductor_id: 'H-014', estado: 'ignorada' }).success).toBe(false)
    expect(SugerenciaReemplazoResolverSchema.safeParse({ ID_Organizacion: 'GRANJA-TEST', estado: 'ignorada' }).success).toBe(false)
    expect(SugerenciaReemplazoResolverSchema.safeParse({ reproductor_id: REPRODUCTOR, estado: 'ignorada' }).success).toBe(false)
  })

  test('no deja pasar columnas que el cliente no escribe (resuelta_en, proposito)', () => {
    const r = SugerenciaReemplazoResolverSchema.safeParse({
      ...base,
      estado: 'confirmada',
      resuelta_en: '2026-10-04T00:00:00Z',
      proposito: 'descarte',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect('resuelta_en' in r.data).toBe(false)
      expect('proposito' in r.data).toBe(false)
    }
  })
})

describe('SugerenciaReemplazoAccionSchema (sin cambios)', () => {
  test('sigue siendo solo { reproductor_id, ID_Organizacion }', () => {
    expect(SugerenciaReemplazoAccionSchema.safeParse(base).success).toBe(true)
    const r = SugerenciaReemplazoAccionSchema.safeParse({ ...base, estado: 'confirmada' })
    expect(r.success).toBe(true)
    if (r.success) expect('estado' in r.data).toBe(false)
  })
})
