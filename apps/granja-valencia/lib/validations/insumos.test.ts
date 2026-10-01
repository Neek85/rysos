import { InsumoAltaConStockInicialSchema, InsumoCrearSchema, MovimientoInsumoCrearSchema } from '../../../../lib/validations/pecuario'

const U1 = '11111111-1111-1111-1111-111111111111'
const U2 = '22222222-2222-2222-2222-222222222222'
const U3 = '33333333-3333-3333-3333-333333333333'

describe('InsumoCrearSchema', () => {
  const base = { ID_Organizacion: 'GRANJA-TEST', nombre: 'Alfalfa', categoria: 'alimento' as const, unidad_medida: 'kg' as const }
  test('acepta insumo válido y aplica defaults', () => {
    const r = InsumoCrearSchema.safeParse({ ID_Organizacion: 'GRANJA-TEST', nombre: ' Alfalfa ' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.nombre).toBe('Alfalfa')
      expect(r.data.categoria).toBe('otro')
      expect(r.data.unidad_medida).toBe('unidad')
      expect(r.data.activo).toBe(true)
    }
  })
  test('rechaza nombre vacío, categoría "cama" y unidad de texto libre', () => {
    expect(InsumoCrearSchema.safeParse({ ...base, nombre: '  ' }).success).toBe(false)
    expect(InsumoCrearSchema.safeParse({ ...base, categoria: 'cama' }).success).toBe(false)
    expect(InsumoCrearSchema.safeParse({ ...base, unidad_medida: 'kilos' }).success).toBe(false)
  })
  test('rechaza stock_minimo negativo y acepta 0 o null', () => {
    expect(InsumoCrearSchema.safeParse({ ...base, stock_minimo: -1 }).success).toBe(false)
    expect(InsumoCrearSchema.safeParse({ ...base, stock_minimo: 0 }).success).toBe(true)
    expect(InsumoCrearSchema.safeParse({ ...base, stock_minimo: null }).success).toBe(true)
  })
})

describe('MovimientoInsumoCrearSchema', () => {
  const base = { ID_Organizacion: 'GRANJA-TEST', insumo_id: U1, tipo_movimiento: 'entrada' as const, cantidad: 12.5, fecha: '2026-10-01' }
  test('acepta entrada y salida, con y sin galpón/poza/lote', () => {
    expect(MovimientoInsumoCrearSchema.safeParse(base).success).toBe(true)
    expect(MovimientoInsumoCrearSchema.safeParse({ ...base, tipo_movimiento: 'salida', galpon_id: U2 }).success).toBe(true)
    expect(MovimientoInsumoCrearSchema.safeParse({ ...base, galpon_id: U2, poza_id: U3, lote_id: U3 }).success).toBe(true)
  })
  test('rechaza cantidad 0 o negativa, tipo inválido y fecha mal formada', () => {
    expect(MovimientoInsumoCrearSchema.safeParse({ ...base, cantidad: 0 }).success).toBe(false)
    expect(MovimientoInsumoCrearSchema.safeParse({ ...base, cantidad: -3 }).success).toBe(false)
    expect(MovimientoInsumoCrearSchema.safeParse({ ...base, tipo_movimiento: 'ajuste' }).success).toBe(false)
    expect(MovimientoInsumoCrearSchema.safeParse({ ...base, fecha: '01/10/2026' }).success).toBe(false)
  })
})

describe('InsumoAltaConStockInicialSchema', () => {
  const base = { ID_Organizacion: 'GRANJA-TEST', nombre: 'Alfalfa', categoria: 'alimento' as const, unidad_medida: 'kg' as const, insumo_id: U1 }
  test('acepta alta sin stock inicial', () => {
    expect(InsumoAltaConStockInicialSchema.safeParse(base).success).toBe(true)
    expect(InsumoAltaConStockInicialSchema.safeParse({ ...base, stock_inicial: 0 }).success).toBe(true)
  })
  test('acepta alta con stock inicial y movimiento_id', () => {
    expect(InsumoAltaConStockInicialSchema.safeParse({ ...base, stock_inicial: 40, movimiento_id: U2, galpon_id: U3 }).success).toBe(true)
  })
  test('rechaza stock inicial > 0 sin movimiento_id (mismo criterio que la RPC)', () => {
    expect(InsumoAltaConStockInicialSchema.safeParse({ ...base, stock_inicial: 40 }).success).toBe(false)
  })
  test('rechaza stock inicial negativo', () => {
    expect(InsumoAltaConStockInicialSchema.safeParse({ ...base, stock_inicial: -1, movimiento_id: U2 }).success).toBe(false)
  })
})
