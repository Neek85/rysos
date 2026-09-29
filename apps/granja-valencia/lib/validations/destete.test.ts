import {
  LoteDesteteSchema,
  RecoleccionDesteteSchema,
  RecoleccionPartoSchema,
  SEXO_LOTE_DESTETE,
} from '../../../../lib/validations/pecuario'

describe('RecoleccionDesteteSchema', () => {
  test('acepta una recolección válida', () => {
    const result = RecoleccionDesteteSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      fecha_destete: '2026-09-29',
    })
    expect(result.success).toBe(true)
  })

  test('rechaza sin fecha_destete', () => {
    const result = RecoleccionDesteteSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
    })
    expect(result.success).toBe(false)
  })
})

describe('RecoleccionPartoSchema', () => {
  test('acepta una fila válida, sin cantidad_incluida', () => {
    const result = RecoleccionPartoSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      recoleccion_id: '11111111-1111-1111-1111-111111111111',
      parto_id: '22222222-2222-2222-2222-222222222222',
    })
    expect(result.success).toBe(true)
  })

  test('rechaza parto_id que no sea un uuid real', () => {
    const result = RecoleccionPartoSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      recoleccion_id: '11111111-1111-1111-1111-111111111111',
      parto_id: 'no-es-un-uuid',
    })
    expect(result.success).toBe(false)
  })
})

describe('LoteDesteteSchema', () => {
  test('acepta un lote válido', () => {
    const result = LoteDesteteSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      codigo_lote: 'L-001',
      poza_actual_id: '11111111-1111-1111-1111-111111111111',
      cantidad_inicial: 2,
      sexo: 'hembra',
      recoleccion_origen_id: '22222222-2222-2222-2222-222222222222',
      fecha_destete: '2026-09-29',
    })
    expect(result.success).toBe(true)
  })

  test('acepta los 2 valores reales de SEXO_LOTE_DESTETE (nunca mixto)', () => {
    for (const valor of SEXO_LOTE_DESTETE) {
      const result = LoteDesteteSchema.safeParse({
        ID_Organizacion: 'GRANJA-TEST',
        codigo_lote: 'L-002',
        poza_actual_id: '11111111-1111-1111-1111-111111111111',
        cantidad_inicial: 1,
        sexo: valor,
        recoleccion_origen_id: '22222222-2222-2222-2222-222222222222',
        fecha_destete: '2026-09-29',
      })
      expect(result.success).toBe(true)
    }
  })

  test('rechaza sexo="mixto"', () => {
    const result = LoteDesteteSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      codigo_lote: 'L-003',
      poza_actual_id: '11111111-1111-1111-1111-111111111111',
      cantidad_inicial: 1,
      sexo: 'mixto',
      recoleccion_origen_id: '22222222-2222-2222-2222-222222222222',
      fecha_destete: '2026-09-29',
    })
    expect(result.success).toBe(false)
  })

  test('rechaza codigo_lote vacío', () => {
    const result = LoteDesteteSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      codigo_lote: '',
      poza_actual_id: '11111111-1111-1111-1111-111111111111',
      cantidad_inicial: 1,
      sexo: 'hembra',
      recoleccion_origen_id: '22222222-2222-2222-2222-222222222222',
      fecha_destete: '2026-09-29',
    })
    expect(result.success).toBe(false)
  })

  test('rechaza cantidad_inicial cero o negativa', () => {
    expect(
      LoteDesteteSchema.safeParse({
        ID_Organizacion: 'GRANJA-TEST',
        codigo_lote: 'L-004',
        poza_actual_id: '11111111-1111-1111-1111-111111111111',
        cantidad_inicial: 0,
        sexo: 'hembra',
        recoleccion_origen_id: '22222222-2222-2222-2222-222222222222',
        fecha_destete: '2026-09-29',
      }).success
    ).toBe(false)
  })
})
