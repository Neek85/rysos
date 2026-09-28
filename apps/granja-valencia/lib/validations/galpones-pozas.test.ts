import { GalponAltaSchema, PozaAltaSchema, TIPO_USO_POZA } from '../../../../lib/validations/pecuario'

describe('GalponAltaSchema', () => {
  test('acepta un galpón válido con solo los campos obligatorios', () => {
    const result = GalponAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_galpon: 'G1',
    })
    expect(result.success).toBe(true)
  })

  test('acepta un galpón válido con todos los campos', () => {
    const result = GalponAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_galpon: 'G1',
      nombre: 'Galpón Norte',
      capacidad_pozas: 12,
      dias_frecuencia_limpieza: 15,
    })
    expect(result.success).toBe(true)
  })

  test('rechaza codigo_galpon vacío', () => {
    const result = GalponAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_galpon: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('El código de galpón es obligatorio.')
    }
  })

  test('rechaza capacidad_pozas negativa o cero', () => {
    expect(
      GalponAltaSchema.safeParse({
        ID_Organizacion: 'GRANJA-VALENCIA',
        codigo_galpon: 'G1',
        capacidad_pozas: 0,
      }).success
    ).toBe(false)

    expect(
      GalponAltaSchema.safeParse({
        ID_Organizacion: 'GRANJA-VALENCIA',
        codigo_galpon: 'G1',
        capacidad_pozas: -3,
      }).success
    ).toBe(false)
  })
})

describe('PozaAltaSchema', () => {
  test('acepta una poza válida sin galpón asignado', () => {
    const result = PozaAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_poza: 'P1',
      tipo_uso: 'engorde',
      galpon_id: null,
    })
    expect(result.success).toBe(true)
  })

  test('acepta los 5 valores reales de tipo_uso', () => {
    for (const valor of TIPO_USO_POZA) {
      const result = PozaAltaSchema.safeParse({
        ID_Organizacion: 'GRANJA-VALENCIA',
        codigo_poza: 'P1',
        tipo_uso: valor,
      })
      expect(result.success).toBe(true)
    }
  })

  test('rechaza codigo_poza vacío', () => {
    const result = PozaAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_poza: '',
      tipo_uso: 'engorde',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('El código de poza es obligatorio.')
    }
  })

  test('rechaza tipo_uso inválido (fuera del enum real)', () => {
    const result = PozaAltaSchema.safeParse({
      ID_Organizacion: 'GRANJA-VALENCIA',
      codigo_poza: 'P1',
      tipo_uso: 'no-existe',
    })
    expect(result.success).toBe(false)
  })

  test('rechaza capacidad_max negativa o cero', () => {
    expect(
      PozaAltaSchema.safeParse({
        ID_Organizacion: 'GRANJA-VALENCIA',
        codigo_poza: 'P1',
        tipo_uso: 'engorde',
        capacidad_max: 0,
      }).success
    ).toBe(false)

    expect(
      PozaAltaSchema.safeParse({
        ID_Organizacion: 'GRANJA-VALENCIA',
        codigo_poza: 'P1',
        tipo_uso: 'engorde',
        capacidad_max: -1,
      }).success
    ).toBe(false)
  })
})
