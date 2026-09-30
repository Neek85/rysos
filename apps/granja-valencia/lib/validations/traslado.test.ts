import { TrasladoSchema } from '../../../../lib/validations/pecuario'

const base = {
  ID_Organizacion: 'GRANJA-TEST',
  destino_jaula_id: '33333333-3333-3333-3333-333333333333',
  fecha: '2026-09-29',
  motivo_traslado: 'enfermedad_aislamiento' as const,
  observaciones: null,
}

describe('TrasladoSchema — modo lote', () => {
  test('acepta traslado completo (sin cantidad ni codigo_lote_nuevo)', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'lote',
      lote_id: '11111111-1111-1111-1111-111111111111',
      alcance: 'completo',
    })
    expect(result.success).toBe(true)
  })

  test('acepta traslado parcial con cantidad y codigo_lote_nuevo', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'lote',
      lote_id: '11111111-1111-1111-1111-111111111111',
      alcance: 'parcial',
      cantidad: 2,
      codigo_lote_nuevo: 'L-006',
    })
    expect(result.success).toBe(true)
  })

  test('rechaza parcial sin cantidad', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'lote',
      lote_id: '11111111-1111-1111-1111-111111111111',
      alcance: 'parcial',
      codigo_lote_nuevo: 'L-006',
    })
    expect(result.success).toBe(false)
  })

  test('rechaza parcial sin codigo_lote_nuevo', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'lote',
      lote_id: '11111111-1111-1111-1111-111111111111',
      alcance: 'parcial',
      cantidad: 2,
    })
    expect(result.success).toBe(false)
  })

  test('rechaza completo con cantidad', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'lote',
      lote_id: '11111111-1111-1111-1111-111111111111',
      alcance: 'completo',
      cantidad: 2,
    })
    expect(result.success).toBe(false)
  })

  test('rechaza lote sin alcance', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'lote',
      lote_id: '11111111-1111-1111-1111-111111111111',
    })
    expect(result.success).toBe(false)
  })

  test('rechaza lote con animal_id también presente', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'lote',
      lote_id: '11111111-1111-1111-1111-111111111111',
      animal_id: '22222222-2222-2222-2222-222222222222',
      alcance: 'completo',
    })
    expect(result.success).toBe(false)
  })
})

describe('TrasladoSchema — modo reproductor', () => {
  test('acepta traslado de reproductor', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'reproductor',
      animal_id: '22222222-2222-2222-2222-222222222222',
    })
    expect(result.success).toBe(true)
  })

  test('rechaza reproductor sin animal_id', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'reproductor',
    })
    expect(result.success).toBe(false)
  })

  test('rechaza reproductor con alcance presente', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'reproductor',
      animal_id: '22222222-2222-2222-2222-222222222222',
      alcance: 'completo',
    })
    expect(result.success).toBe(false)
  })

  test('rechaza reproductor con lote_id también presente', () => {
    const result = TrasladoSchema.safeParse({
      ...base,
      tipo_origen: 'reproductor',
      animal_id: '22222222-2222-2222-2222-222222222222',
      lote_id: '11111111-1111-1111-1111-111111111111',
    })
    expect(result.success).toBe(false)
  })
})
