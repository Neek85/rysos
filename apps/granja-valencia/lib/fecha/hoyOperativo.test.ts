import { hoyOperativo } from './hoyOperativo'

const ms = (iso: string) => Date.parse(iso)

describe('hoyOperativo (America/Lima, UTC-5 fijo)', () => {
  test('frontera de las 00:00 de Lima (05:00Z): 04:59:59.999Z es el día anterior, 05:00:00.000Z el nuevo', () => {
    expect(hoyOperativo(ms('2026-10-08T04:59:59.999Z'))).toBe('2026-10-07')
    expect(hoyOperativo(ms('2026-10-08T05:00:00.000Z'))).toBe('2026-10-08')
  })

  test('23:59:59.999Z: la fecha UTC ya es la misma, pero Lima sigue en ese día', () => {
    expect(hoyOperativo(ms('2026-10-07T23:59:59.999Z'))).toBe('2026-10-07')
    expect(hoyOperativo(ms('2026-10-07T00:00:00.000Z'))).toBe('2026-10-06') // medianoche UTC = 19:00 del día anterior en Lima
  })

  test('ventana 19:00-24:00 de Lima: la fecha UTC es "mañana", la operativa no', () => {
    // 21:37 de Lima del 7-oct = 02:37Z del 8-oct (el caso real que rompía las vistas y el cliente)
    expect(new Date(ms('2026-10-08T02:37:00Z')).toISOString().slice(0, 10)).toBe('2026-10-08')
    expect(hoyOperativo(ms('2026-10-08T02:37:00Z'))).toBe('2026-10-07')
  })

  test('mediodía de Lima cae en el mismo día', () => {
    expect(hoyOperativo(ms('2026-10-07T17:00:00Z'))).toBe('2026-10-07')
  })

  test('frontera de mes', () => {
    expect(hoyOperativo(ms('2026-11-01T04:59:59.999Z'))).toBe('2026-10-31')
    expect(hoyOperativo(ms('2026-11-01T05:00:00.000Z'))).toBe('2026-11-01')
  })

  test('frontera de año', () => {
    expect(hoyOperativo(ms('2027-01-01T04:59:59.999Z'))).toBe('2026-12-31')
    expect(hoyOperativo(ms('2027-01-01T05:00:00.000Z'))).toBe('2027-01-01')
  })

  test('año bisiesto (2028)', () => {
    expect(hoyOperativo(ms('2028-02-29T04:59:59.999Z'))).toBe('2028-02-28')
    expect(hoyOperativo(ms('2028-02-29T05:00:00.000Z'))).toBe('2028-02-29')
    expect(hoyOperativo(ms('2028-03-01T04:59:59.999Z'))).toBe('2028-02-29')
    expect(hoyOperativo(ms('2028-03-01T05:00:00.000Z'))).toBe('2028-03-01')
  })

  test('siempre devuelve YYYY-MM-DD', () => {
    const muestras = [0, ms('2026-01-01T00:00:00Z'), ms('2026-06-15T13:45:10.123Z'), ms('2026-12-31T23:59:59.999Z'), ms('2099-12-31T23:59:59.999Z')]
    for (const t of muestras) expect(hoyOperativo(t)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(hoyOperativo()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('sin argumento usa Date.now() (instante inyectable con fake timers)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T02:37:00Z'))
    try {
      expect(hoyOperativo()).toBe('2026-10-07')
    } finally {
      jest.useRealTimers()
    }
  })

  test('no depende de la zona horaria del proceso', () => {
    const original = process.env.TZ
    for (const tz of ['UTC', 'America/Lima', 'Asia/Tokyo', 'Pacific/Auckland']) {
      process.env.TZ = tz
      expect(hoyOperativo(ms('2026-10-08T02:37:00Z'))).toBe('2026-10-07')
    }
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })
})
