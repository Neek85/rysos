import { EmpadreAsignacionSchema } from '../../../../lib/validations/pecuario'

describe('EmpadreAsignacionSchema', () => {
  test('acepta una asignación válida sin fecha de retiro', () => {
    const result = EmpadreAsignacionSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      macho_id: '11111111-1111-1111-1111-111111111111',
      jaula_id: '22222222-2222-2222-2222-222222222222',
      fecha_entrada: '2026-09-28',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.advertencia_confirmada).toBe(false)
    }
  })

  test('acepta una asignación válida con fecha de retiro y advertencia confirmada', () => {
    const result = EmpadreAsignacionSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      macho_id: '11111111-1111-1111-1111-111111111111',
      jaula_id: '22222222-2222-2222-2222-222222222222',
      fecha_entrada: '2026-09-28',
      fecha_salida: '2026-10-05',
      advertencia_confirmada: true,
    })
    expect(result.success).toBe(true)
  })

  test('rechaza macho_id que no sea un uuid real', () => {
    const result = EmpadreAsignacionSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      macho_id: 'no-es-un-uuid',
      jaula_id: '22222222-2222-2222-2222-222222222222',
      fecha_entrada: '2026-09-28',
    })
    expect(result.success).toBe(false)
  })

  test('rechaza jaula_id que no sea un uuid real', () => {
    const result = EmpadreAsignacionSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      macho_id: '11111111-1111-1111-1111-111111111111',
      jaula_id: 'no-es-un-uuid',
      fecha_entrada: '2026-09-28',
    })
    expect(result.success).toBe(false)
  })

  test('rechaza sin fecha_entrada', () => {
    const result = EmpadreAsignacionSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      macho_id: '11111111-1111-1111-1111-111111111111',
      jaula_id: '22222222-2222-2222-2222-222222222222',
    })
    expect(result.success).toBe(false)
  })
})
