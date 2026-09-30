import { PesajeSchema } from '../../../../lib/validations/pecuario'

describe('PesajeSchema', () => {
  const base = {
    ID_Organizacion: 'GRANJA-TEST',
    lote_id: '11111111-1111-1111-1111-111111111111',
    fecha_pesaje: '2026-09-29',
    animales_muestreados: 3,
    peso_total_muestra_g: 630,
    peso_promedio_g: 210,
    ganancia_diaria_estimada_g: null,
  }

  test('acepta un pesaje válido sin pesaje anterior (ganancia_diaria_estimada_g null)', () => {
    const result = PesajeSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  test('acepta un pesaje válido con ganancia_diaria_estimada_g calculada', () => {
    const result = PesajeSchema.safeParse({ ...base, ganancia_diaria_estimada_g: 4.5 })
    expect(result.success).toBe(true)
  })

  test('rechaza animales_muestreados cero o negativo', () => {
    expect(PesajeSchema.safeParse({ ...base, animales_muestreados: 0 }).success).toBe(false)
    expect(PesajeSchema.safeParse({ ...base, animales_muestreados: -1 }).success).toBe(false)
  })

  test('rechaza peso_total_muestra_g cero o negativo', () => {
    expect(PesajeSchema.safeParse({ ...base, peso_total_muestra_g: 0 }).success).toBe(false)
  })

  test('rechaza lote_id que no sea un uuid real', () => {
    const result = PesajeSchema.safeParse({ ...base, lote_id: 'no-es-un-uuid' })
    expect(result.success).toBe(false)
  })

  test('rechaza fecha_pesaje con formato inválido', () => {
    const result = PesajeSchema.safeParse({ ...base, fecha_pesaje: '29-09-2026' })
    expect(result.success).toBe(false)
  })
})
