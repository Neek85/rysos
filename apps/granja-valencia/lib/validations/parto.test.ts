import { PartoRegistroSchema } from '../../../../lib/validations/pecuario'

describe('PartoRegistroSchema', () => {
  test('acepta un parto válido con solo los campos obligatorios', () => {
    const result = PartoRegistroSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      poza_id: '11111111-1111-1111-1111-111111111111',
      madre_id: '22222222-2222-2222-2222-222222222222',
      fecha_parto: '2026-09-29',
      n_vivos: 3,
      n_muertos: 0,
    })
    expect(result.success).toBe(true)
  })

  test('acepta un parto válido con todos los campos', () => {
    const result = PartoRegistroSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      poza_id: '11111111-1111-1111-1111-111111111111',
      madre_id: '22222222-2222-2222-2222-222222222222',
      macho_id: '33333333-3333-3333-3333-333333333333',
      fecha_parto: '2026-09-29',
      n_vivos: 3,
      n_muertos: 1,
      peso_total_camada_g: 420,
      observaciones: 'Parto asistido.',
    })
    expect(result.success).toBe(true)
  })

  test('acepta macho_id null (sin macho activo asignado)', () => {
    const result = PartoRegistroSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      poza_id: '11111111-1111-1111-1111-111111111111',
      madre_id: '22222222-2222-2222-2222-222222222222',
      macho_id: null,
      fecha_parto: '2026-09-29',
      n_vivos: 3,
      n_muertos: 0,
    })
    expect(result.success).toBe(true)
  })

  test('rechaza sin madre_id (el modo poblacional queda fuera de esta pantalla)', () => {
    const result = PartoRegistroSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      poza_id: '11111111-1111-1111-1111-111111111111',
      fecha_parto: '2026-09-29',
      n_vivos: 3,
      n_muertos: 0,
    })
    expect(result.success).toBe(false)
  })

  test('rechaza n_vivos negativo', () => {
    const result = PartoRegistroSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      poza_id: '11111111-1111-1111-1111-111111111111',
      madre_id: '22222222-2222-2222-2222-222222222222',
      fecha_parto: '2026-09-29',
      n_vivos: -1,
      n_muertos: 0,
    })
    expect(result.success).toBe(false)
  })

  test('rechaza peso_total_camada_g cero o negativo', () => {
    expect(
      PartoRegistroSchema.safeParse({
        ID_Organizacion: 'GRANJA-TEST',
        poza_id: '11111111-1111-1111-1111-111111111111',
        madre_id: '22222222-2222-2222-2222-222222222222',
        fecha_parto: '2026-09-29',
        n_vivos: 3,
        n_muertos: 0,
        peso_total_camada_g: 0,
      }).success
    ).toBe(false)
  })
})
