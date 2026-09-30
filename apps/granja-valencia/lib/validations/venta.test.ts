import { VentaAnimalSchema, VentaGuanoSchema } from '../../../../lib/validations/pecuario'

const baseAnimal = {
  ID_Organizacion: 'GRANJA-TEST',
  fecha_venta: '2026-09-30',
  tipo_salida: 'carne' as const,
  cantidad: 1,
  precio_total: 20,
  comprador_nombre: null,
  base_precio: 'por_animal' as const,
}

describe('VentaAnimalSchema — modo lote', () => {
  test('acepta venta de lote con precio_unitario', () => {
    const result = VentaAnimalSchema.safeParse({
      ...baseAnimal,
      lote_id: '11111111-1111-1111-1111-111111111111',
      cantidad: 3,
      precio_unitario: 20,
      precio_total: 60,
    })
    expect(result.success).toBe(true)
  })

  test('acepta venta de lote sin precio_unitario (modo total directo)', () => {
    const result = VentaAnimalSchema.safeParse({
      ...baseAnimal,
      lote_id: '11111111-1111-1111-1111-111111111111',
      cantidad: 3,
      precio_unitario: null,
      precio_total: 55,
    })
    expect(result.success).toBe(true)
  })

  test('rechaza sin lote_id ni animal_id', () => {
    const result = VentaAnimalSchema.safeParse(baseAnimal)
    expect(result.success).toBe(false)
  })

  test('rechaza con lote_id y animal_id a la vez', () => {
    const result = VentaAnimalSchema.safeParse({
      ...baseAnimal,
      lote_id: '11111111-1111-1111-1111-111111111111',
      animal_id: '22222222-2222-2222-2222-222222222222',
    })
    expect(result.success).toBe(false)
  })
})

describe('VentaAnimalSchema — modo reproductor', () => {
  test('acepta venta de reproductor con cantidad 1', () => {
    const result = VentaAnimalSchema.safeParse({
      ...baseAnimal,
      animal_id: '22222222-2222-2222-2222-222222222222',
      cantidad: 1,
    })
    expect(result.success).toBe(true)
  })

  test('rechaza venta de reproductor con cantidad distinta de 1', () => {
    const result = VentaAnimalSchema.safeParse({
      ...baseAnimal,
      animal_id: '22222222-2222-2222-2222-222222222222',
      cantidad: 2,
    })
    expect(result.success).toBe(false)
  })
})

describe('VentaAnimalSchema — pelado beneficiado / base_precio', () => {
  test('acepta base_precio=por_kg con tipo_salida=pelado_beneficiado y peso/precio_kg', () => {
    const result = VentaAnimalSchema.safeParse({
      ...baseAnimal,
      lote_id: '11111111-1111-1111-1111-111111111111',
      tipo_salida: 'pelado_beneficiado',
      base_precio: 'por_kg',
      peso_total_kg: 5,
      precio_kg: 22,
      precio_total: 110,
    })
    expect(result.success).toBe(true)
  })

  test('rechaza base_precio=por_kg con tipo_salida distinto de pelado_beneficiado', () => {
    const result = VentaAnimalSchema.safeParse({
      ...baseAnimal,
      lote_id: '11111111-1111-1111-1111-111111111111',
      tipo_salida: 'carne',
      base_precio: 'por_kg',
      peso_total_kg: 5,
      precio_kg: 22,
    })
    expect(result.success).toBe(false)
  })

  test('rechaza base_precio=por_kg sin peso_total_kg o precio_kg', () => {
    const result = VentaAnimalSchema.safeParse({
      ...baseAnimal,
      lote_id: '11111111-1111-1111-1111-111111111111',
      tipo_salida: 'pelado_beneficiado',
      base_precio: 'por_kg',
      peso_total_kg: 5,
    })
    expect(result.success).toBe(false)
  })

  test('rechaza base_precio=por_animal con precio_kg presente', () => {
    const result = VentaAnimalSchema.safeParse({
      ...baseAnimal,
      lote_id: '11111111-1111-1111-1111-111111111111',
      base_precio: 'por_animal',
      precio_kg: 10,
    })
    expect(result.success).toBe(false)
  })
})

describe('VentaGuanoSchema', () => {
  test('acepta una venta de guano válida', () => {
    const result = VentaGuanoSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      fecha: '2026-09-30',
      producto: 'guano',
      cantidad: 40,
      unidad: 'sacos',
      precio_total: 80,
      galpon_id: null,
      comprador_nombre: null,
    })
    expect(result.success).toBe(true)
  })

  test('acepta sin precio_total (columna nullable real)', () => {
    const result = VentaGuanoSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      fecha: '2026-09-30',
      producto: 'guano',
      cantidad: 40,
      unidad: 'kg',
    })
    expect(result.success).toBe(true)
  })

  test('rechaza cantidad cero o negativa', () => {
    const result = VentaGuanoSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      fecha: '2026-09-30',
      producto: 'guano',
      cantidad: 0,
      unidad: 'sacos',
    })
    expect(result.success).toBe(false)
  })

  test('rechaza producto distinto de guano', () => {
    const result = VentaGuanoSchema.safeParse({
      ID_Organizacion: 'GRANJA-TEST',
      fecha: '2026-09-30',
      producto: 'otro',
      cantidad: 10,
      unidad: 'sacos',
    })
    expect(result.success).toBe(false)
  })
})
