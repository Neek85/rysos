import { CompraSchema } from '../../../../lib/validations/pecuario'

const U1 = '11111111-1111-1111-1111-111111111111'
const U2 = '22222222-2222-2222-2222-222222222222'
const U3 = '33333333-3333-3333-3333-333333333333'

const comunes = { id: U1, ID_Organizacion: 'GRANJA-TEST', fecha: '2026-10-03' }

const insumo = {
  ...comunes,
  concepto: 'insumo' as const,
  insumo_id: U2,
  cantidad: 50,
  galpon_id: U3,
  costo_insumo: 100,
  flete: null,
  categoria_gasto: null,
  descripcion: null,
  monto_servicio: null,
}

const servicio = {
  ...comunes,
  concepto: 'servicio_otro' as const,
  categoria_gasto: 'combustible' as const,
  descripcion: 'Cambio de aceite del motocultor',
  monto_servicio: 120,
  insumo_id: null,
  cantidad: null,
  galpon_id: null,
  costo_insumo: null,
  flete: null,
}

describe('CompraSchema — rama insumo', () => {
  test('acepta compra de insumo válida, con y sin flete', () => {
    expect(CompraSchema.safeParse(insumo).success).toBe(true)
    expect(CompraSchema.safeParse({ ...insumo, flete: 20 }).success).toBe(true)
  })
  test('costo_insumo debe ser mayor a 0 a nivel de contrato (0 y negativos se rechazan)', () => {
    expect(CompraSchema.safeParse({ ...insumo, costo_insumo: 0 }).success).toBe(false)
    expect(CompraSchema.safeParse({ ...insumo, costo_insumo: -5 }).success).toBe(false)
  })
  test('exige insumo_id, cantidad > 0 y galpon_id', () => {
    expect(CompraSchema.safeParse({ ...insumo, insumo_id: null }).success).toBe(false)
    expect(CompraSchema.safeParse({ ...insumo, cantidad: 0 }).success).toBe(false)
    expect(CompraSchema.safeParse({ ...insumo, galpon_id: null }).success).toBe(false)
  })
  test('rechaza flete negativo y campos de la rama servicio mezclados', () => {
    expect(CompraSchema.safeParse({ ...insumo, flete: -1 }).success).toBe(false)
    expect(CompraSchema.safeParse({ ...insumo, descripcion: 'x' }).success).toBe(false)
  })
})

describe('CompraSchema — rama servicio_otro', () => {
  test('acepta servicio válido', () => {
    expect(CompraSchema.safeParse(servicio).success).toBe(true)
  })
  test('exige categoría, descripción y monto_servicio', () => {
    expect(CompraSchema.safeParse({ ...servicio, categoria_gasto: null }).success).toBe(false)
    expect(CompraSchema.safeParse({ ...servicio, descripcion: null }).success).toBe(false)
    expect(CompraSchema.safeParse({ ...servicio, monto_servicio: null }).success).toBe(false)
  })
  test('rechaza campos de la rama insumo mezclados (incluido flete)', () => {
    expect(CompraSchema.safeParse({ ...servicio, insumo_id: U2 }).success).toBe(false)
    expect(CompraSchema.safeParse({ ...servicio, flete: 0 }).success).toBe(false)
  })
  test('rechaza categoría fuera del enum', () => {
    expect(CompraSchema.safeParse({ ...servicio, categoria_gasto: 'vacaciones' }).success).toBe(false)
  })
})

describe('CompraSchema — comunes', () => {
  test('rechaza fecha mal formada y concepto desconocido', () => {
    expect(CompraSchema.safeParse({ ...servicio, fecha: '03/10/2026' }).success).toBe(false)
    expect(CompraSchema.safeParse({ ...servicio, concepto: 'otro' }).success).toBe(false)
  })
  test('acepta proveedor, comprobante y campos offline opcionales', () => {
    const r = CompraSchema.safeParse({
      ...servicio,
      proveedor: 'Agro Valle',
      comprobante: 'Boleta 0012-345',
      device_id: 'dev-1',
      created_offline_at: '2026-10-03T12:00:00.000Z',
    })
    expect(r.success).toBe(true)
  })
  test('no define monto_total: es una columna generada y no se envía desde el cliente', () => {
    const r = CompraSchema.safeParse({ ...servicio, monto_total: 999 })
    expect(r.success).toBe(true)
    if (r.success) expect('monto_total' in r.data).toBe(false)
  })
})
