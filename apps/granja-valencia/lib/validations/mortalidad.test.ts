import { MortalidadFotoInsertSchema, MortalidadSchema } from '../../../../lib/validations/pecuario'

const base = {
  ID_Organizacion: 'GRANJA-TEST',
  fecha_evento: '2026-09-30',
  cantidad: 1,
  etapa: 'recria' as const,
  causa: 'desconocido' as const,
  descripcion_sintomas: null,
}

describe('MortalidadSchema — modo poblacional', () => {
  test('acepta mortalidad de lote (etapa recria)', () => {
    const result = MortalidadSchema.safeParse({
      ...base,
      lote_id: '11111111-1111-1111-1111-111111111111',
      cantidad: 2,
    })
    expect(result.success).toBe(true)
  })

  test('acepta mortalidad de poza (etapa lactancia)', () => {
    const result = MortalidadSchema.safeParse({
      ...base,
      etapa: 'lactancia',
      poza_id: '33333333-3333-3333-3333-333333333333',
    })
    expect(result.success).toBe(true)
  })

  test('rechaza sin lote_id, poza_id ni animal_id', () => {
    const result = MortalidadSchema.safeParse(base)
    expect(result.success).toBe(false)
  })

  test('acepta lote_id y poza_id a la vez (permisividad real de chk_mortalidad_individual_xor_poblacional: usa OR entre ambos, no XOR -- el mockup nunca los manda juntos, pero el schema no inventa una restricción que la base no tiene)', () => {
    const result = MortalidadSchema.safeParse({
      ...base,
      lote_id: '11111111-1111-1111-1111-111111111111',
      poza_id: '33333333-3333-3333-3333-333333333333',
    })
    expect(result.success).toBe(true)
  })

  test('rechaza con lote_id y animal_id a la vez', () => {
    const result = MortalidadSchema.safeParse({
      ...base,
      lote_id: '11111111-1111-1111-1111-111111111111',
      animal_id: '22222222-2222-2222-2222-222222222222',
    })
    expect(result.success).toBe(false)
  })
})

describe('MortalidadSchema — modo reproductor', () => {
  test('acepta mortalidad de reproductor con cantidad 1', () => {
    const result = MortalidadSchema.safeParse({
      ...base,
      etapa: 'reproductor',
      animal_id: '22222222-2222-2222-2222-222222222222',
      cantidad: 1,
    })
    expect(result.success).toBe(true)
  })

  test('rechaza mortalidad de reproductor con cantidad distinta de 1', () => {
    const result = MortalidadSchema.safeParse({
      ...base,
      etapa: 'reproductor',
      animal_id: '22222222-2222-2222-2222-222222222222',
      cantidad: 2,
    })
    expect(result.success).toBe(false)
  })
})

describe('MortalidadSchema — validaciones básicas', () => {
  test('rechaza cantidad cero o negativa', () => {
    const result = MortalidadSchema.safeParse({
      ...base,
      lote_id: '11111111-1111-1111-1111-111111111111',
      cantidad: 0,
    })
    expect(result.success).toBe(false)
  })

  test('default de causa es desconocido', () => {
    const result = MortalidadSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      lote_id: '11111111-1111-1111-1111-111111111111',
      fecha_evento: '2026-09-30',
      cantidad: 1,
      etapa: 'recria',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.causa).toBe('desconocido')
  })
})

describe('MortalidadFotoInsertSchema', () => {
  test('acepta una foto válida', () => {
    const result = MortalidadFotoInsertSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      mortalidad_id: '44444444-4444-4444-4444-444444444444',
      storage_path: 'GRANJA-TEST/mortalidad/44444444-4444-4444-4444-444444444444/foto-1.jpg',
    })
    expect(result.success).toBe(true)
  })

  test('rechaza storage_path vacío', () => {
    const result = MortalidadFotoInsertSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      mortalidad_id: '44444444-4444-4444-4444-444444444444',
      storage_path: '',
    })
    expect(result.success).toBe(false)
  })
})
