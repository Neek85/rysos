import {
  agruparPorAnimal,
  agruparPorJaula,
  contarAnimales,
  contarPorMotivo,
  mensajeDialogo,
  mensajeExito,
  puedeResolver,
  textoDesglose,
  tituloGrupo,
  tituloTarjeta,
  traducirErrorResolver,
  type FilaSugerencia,
  type Motivo,
} from './logica'

let n = 0
function fila(opts: {
  rep: string
  arete: string
  motivo?: Motivo
  poza?: string | null
  galpon?: string | null
  raza?: string | null
  detalle?: string
}): FilaSugerencia {
  n += 1
  const poza = opts.poza === undefined ? 'P-001' : opts.poza
  return {
    id: `s-${n}`,
    motivo: opts.motivo ?? 'max_partos_alcanzado',
    detalle: opts.detalle ?? `detalle ${n}`,
    estado: 'pendiente',
    reproductor_id: opts.rep,
    PECUARIO_REPRODUCTORES: {
      codigo_arete: opts.arete,
      raza: opts.raza === undefined ? 'Andina' : opts.raza,
      estado: 'activo',
      proposito: 'reproductor',
      jaula_actual_id: poza ? `j-${poza}` : null,
      PECUARIO_JAULAS: poza
        ? {
            codigo_poza: poza,
            galpon_id: opts.galpon ? `g-${opts.galpon}` : null,
            PECUARIO_GALPONES: opts.galpon ? { codigo_galpon: opts.galpon, nombre: null } : null,
          }
        : null,
    },
  }
}

describe('contarAnimales / desglose por motivo', () => {
  const filas = [
    fila({ rep: 'A', arete: 'H-1', motivo: 'max_partos_alcanzado' }),
    fila({ rep: 'A', arete: 'H-1', motivo: 'camada_chica_parto_temprano' }), // mismo animal, 2 motivos
    fila({ rep: 'B', arete: 'H-2', motivo: 'camada_chica_parto_temprano' }),
  ]

  test('cuenta animales distintos, no sugerencias', () => {
    expect(contarAnimales(filas)).toBe(2)
    expect(contarAnimales([])).toBe(0)
  })

  test('el desglose cuenta sugerencias y puede sumar más que los animales', () => {
    expect(contarPorMotivo(filas)).toEqual({ max_partos_alcanzado: 1, camada_chica_parto_temprano: 2 })
    expect(textoDesglose(filas)).toBe('1 por máximo de partos · 2 por camada chica')
  })

  test('el desglose omite los motivos en 0 y mantiene el orden fijo', () => {
    expect(textoDesglose([filas[2]])).toBe('1 por camada chica')
    expect(textoDesglose([filas[0]])).toBe('1 por máximo de partos')
    expect(textoDesglose([])).toBe('')
  })

  test('título de la tarjeta en singular y plural', () => {
    expect(tituloTarjeta(1)).toBe('1 reproductora sugerida para reemplazo')
    expect(tituloTarjeta(3)).toBe('3 reproductoras sugeridas para reemplazo')
  })
})

describe('agruparPorAnimal', () => {
  test('una fila por animal, con todas sus sugerencias en orden fijo de motivo', () => {
    const filas = [
      fila({ rep: 'A', arete: 'H-1', motivo: 'camada_chica_parto_temprano', detalle: 'chica' }),
      fila({ rep: 'A', arete: 'H-1', motivo: 'max_partos_alcanzado', detalle: 'max' }),
    ]
    const animales = agruparPorAnimal(filas)
    expect(animales).toHaveLength(1)
    expect(animales[0].sugerencias.map((s) => s.motivo)).toEqual(['max_partos_alcanzado', 'camada_chica_parto_temprano'])
    expect(animales[0].sugerencias.map((s) => s.detalle)).toEqual(['max', 'chica'])
  })

  test('ignora filas sin reproductor embebido y respeta raza nula', () => {
    const sinRep: FilaSugerencia = { ...fila({ rep: 'X', arete: 'H-9' }), PECUARIO_REPRODUCTORES: null }
    const animales = agruparPorAnimal([sinRep, fila({ rep: 'B', arete: 'H-2', raza: null })])
    expect(animales).toHaveLength(1)
    expect(animales[0].raza).toBeNull()
  })
})

describe('agruparPorJaula', () => {
  test('ordena grupos por codigo_poza (orden natural), animales por codigo_arete y deja "Sin jaula" al final', () => {
    const filas = [
      fila({ rep: 'A', arete: 'H-020', poza: 'P-10', galpon: 'A' }),
      fila({ rep: 'B', arete: 'H-003', poza: 'P-2', galpon: 'A' }),
      fila({ rep: 'C', arete: 'H-001', poza: null }),
      fila({ rep: 'D', arete: 'H-002', poza: 'P-2', galpon: 'A' }),
      fila({ rep: 'E', arete: 'H-004', poza: 'H-1', galpon: 'B' }),
    ]
    const grupos = agruparPorJaula(filas)
    expect(grupos.map((g) => g.codigo_poza)).toEqual(['H-1', 'P-2', 'P-10', null])
    expect(grupos[1].animales.map((a) => a.codigo_arete)).toEqual(['H-002', 'H-003'])
  })

  test('un animal con dos sugerencias cuenta una sola vez en su grupo', () => {
    const filas = [
      fila({ rep: 'A', arete: 'H-1', motivo: 'max_partos_alcanzado' }),
      fila({ rep: 'A', arete: 'H-1', motivo: 'camada_chica_parto_temprano' }),
    ]
    const grupos = agruparPorJaula(filas)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].animales).toHaveLength(1)
    expect(tituloGrupo(grupos[0])).toBe('Jaula P-001 · 1 sugerida')
  })

  test('encabezados: con galpón, sin galpón, plural y sin jaula', () => {
    const filas = [
      fila({ rep: 'A', arete: 'H-1', poza: 'P-1', galpon: 'A' }),
      fila({ rep: 'B', arete: 'H-2', poza: 'P-1', galpon: 'A' }),
      fila({ rep: 'C', arete: 'H-3', poza: 'P-2', galpon: null }),
      fila({ rep: 'D', arete: 'H-4', poza: null }),
    ]
    const t = agruparPorJaula(filas).map(tituloGrupo)
    expect(t).toEqual(['Jaula P-1 — Galpón A · 2 sugeridas', 'Jaula P-2 · 1 sugerida', 'Sin jaula asignada · 1 sugerida'])
  })

  test('sin filas devuelve lista vacía', () => {
    expect(agruparPorJaula([])).toEqual([])
  })
})

describe('textos de la acción', () => {
  test('diálogos: nombran al animal y avisan que no se puede deshacer', () => {
    const c = mensajeDialogo('confirmada', 'H-014')
    expect(c.mensaje).toBe('Se marcará a H-014 como descarte. Esta acción no se puede deshacer.')
    const i = mensajeDialogo('ignorada', 'H-014')
    expect(i.mensaje).toBe('No se volverá a sugerir el reemplazo de H-014 por ninguno de sus motivos. Esta acción no se puede deshacer.')
  })

  test('mensajes de éxito', () => {
    expect(mensajeExito('confirmada', 'H-014')).toBe('H-014 marcada para descarte.')
    expect(mensajeExito('ignorada', 'H-014')).toBe('No se volverá a sugerir el reemplazo de H-014.')
  })

  test('traducción de errores: permisos, red y mensaje de la base', () => {
    expect(traducirErrorResolver({ code: '42501', message: 'x' })).toBe('No tenés permiso para resolver sugerencias.')
    expect(traducirErrorResolver({ message: 'new row violates row-level security policy' })).toBe('No tenés permiso para resolver sugerencias.')
    expect(traducirErrorResolver({ message: 'TypeError: Network request failed' })).toMatch(/^Sin conexión/)
    expect(traducirErrorResolver({ message: 'algo raro de la base' })).toBe('algo raro de la base')
    expect(traducirErrorResolver({})).toBe('No se pudo resolver la sugerencia.')
  })

  test('solo admin y tecnico_campo ven los botones', () => {
    expect(puedeResolver('admin')).toBe(true)
    expect(puedeResolver('tecnico_campo')).toBe(true)
    expect(puedeResolver('auditor_qc')).toBe(false)
    expect(puedeResolver(null)).toBe(false)
    expect(puedeResolver(undefined)).toBe(false)
  })
})
