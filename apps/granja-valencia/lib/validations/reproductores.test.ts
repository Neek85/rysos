import { ReproductorAltaSchema, SEXO_CUY } from '../../../../lib/validations/pecuario'

describe('ReproductorAltaSchema', () => {
  test('acepta un reproductor válido con solo los campos obligatorios', () => {
    const result = ReproductorAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_arete: 'H-001',
      sexo: 'hembra',
    })
    expect(result.success).toBe(true)
  })

  test('acepta un reproductor válido con todos los campos', () => {
    const result = ReproductorAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_arete: 'M-001',
      sexo: 'macho',
      raza: 'Andina',
      fecha_nacimiento: '2026-09-01',
      jaula_actual_id: '83d9589d-7e6a-4ec9-85c9-80ae32f8a6d8',
      madre_id: null,
      padre_id: null,
      advertencia_confirmada: true,
    })
    expect(result.success).toBe(true)
  })

  test('acepta los 2 valores reales de sexo', () => {
    for (const valor of SEXO_CUY) {
      const result = ReproductorAltaSchema.safeParse({
        ID_Organizacion: 'GRANJA-VALENCIA',
        codigo_arete: 'H-002',
        sexo: valor,
      })
      expect(result.success).toBe(true)
    }
  })

  test('rechaza codigo_arete vacío', () => {
    const result = ReproductorAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_arete: '',
      sexo: 'hembra',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('El código de arete es obligatorio.')
    }
  })

  test('rechaza sexo inválido (fuera del enum real)', () => {
    const result = ReproductorAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_arete: 'H-003',
      sexo: 'no-existe',
    })
    expect(result.success).toBe(false)
  })

  test('advertencia_confirmada default es false cuando se omite', () => {
    const result = ReproductorAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_arete: 'H-004',
      sexo: 'hembra',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.advertencia_confirmada).toBe(false)
    }
  })
})
