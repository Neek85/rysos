import { z } from 'zod'
import {
  PanelSeguimientoLoteSchema,
  PanelSeguimientoGalponSchema,
  PanelSeguimientoGranjaSchema,
  PanelReproduccionMesSchema,
  PanelIntervaloPartosSchema,
  PanelReemplazoReproductorasSchema,
  PanelIndicadoresSanitariosSchema,
  PanelIncidenciaPatologiasSchema,
  PanelPesosPromedioSchema,
  PanelVentasMesSchema,
  PanelGalponNombreSchema,
  PoblacionResumenSchema,
} from '../../../../lib/validations/pecuario'

// Filas con la FORMA real que devolvió PostgREST con una sesión de GRANJA-TEST
// (2026-10-29): los numeric llegan como número JSON (1.00 -> 1), nunca como string.
// Las vistas sin filas reales en esa organización (galpon, granja, incidencia,
// ventas) usan valores construidos con los tipos de la definición SQL.
const ORG = 'GRANJA-TEST'
const UUID = '11111111-1111-1111-1111-111111111111'

const FILAS = {
  seguimientoLote: {
    lote_id: UUID, ID_Organizacion: ORG, codigo_lote: 'L-001', poza_actual_id: UUID, galpon_id: null,
    cantidad_actual: null, fecha_pesaje_anterior: null, peso_promedio_anterior_g: null,
    fecha_pesaje_reciente: null, peso_promedio_reciente_g: null, dias_periodo: null,
    ganancia_diaria_g: null, ganancia_total_kg_periodo: null, alimento_consumido_kg: 0,
    datos_suficientes: false, fcr: null,
  },
  seguimientoGalpon: { galpon_id: UUID, ID_Organizacion: ORG, lotes_con_datos: 2, ganancia_diaria_promedio_g: 14.25, fcr_promedio: 3.1 },
  seguimientoGranja: { ID_Organizacion: ORG, lotes_con_datos: 3, ganancia_diaria_promedio_g: 14, fcr_promedio: 3.1 },
  reproduccion: { ID_Organizacion: ORG, partos_mes: 2, crias_vivas_total_mes: 2, crias_vivas_promedio_parto: 1, peso_promedio_nacimiento_g: null, partos_con_peso_registrado: 0 },
  intervalo: { ID_Organizacion: ORG, intervalo_promedio_dias_individual: 0.5, madres_con_intervalo_calculado: 1, partos_ultimos_12m_total: 5, hembras_activas_actual: 2 },
  reemplazo: { ID_Organizacion: ORG, altas_hembras_12m: 3, bajas_hembras_12m: 0, hembras_activas_actual: 2, tasa_reemplazo_pct: 0 },
  sanitarios: {
    ID_Organizacion: ORG, muertes_lactancia_mes: 0, mortalidad_lactancia_pct_mes: null,
    muertes_recria_engorde_mes: 0, mortalidad_recria_engorde_pct_mes: 0,
    muertes_reproductores_12m: 1, mortalidad_reproductores_pct_anual: 33.3,
  },
  incidencia: { ID_Organizacion: ORG, causa: 'neumonia', cantidad_mes: 7, porcentaje_mes: 31.8 },
  pesos: { ID_Organizacion: ORG, columna_ajena: 99, peso_promedio_destete_g_mes: null, peso_promedio_engorde_g_actual: null },
  ventas: {
    ID_Organizacion: ORG, ventas_mes: 4, monto_total_mes: 1840, kg_vendidos_mes: 52.5,
    rendimiento_carcasa_promedio_pct: null, ventas_con_rendimiento_registrado: 0, animales_vendidos_mes: 96,
  },
  galpon: { id: UUID, codigo_galpon: 'A', nombre: null },
  poblacion: { ID_Organizacion: ORG, total_lactancia: 0, total_recria: 1, total_engorde: 0, total_reproductores: 3, total_poblacion: 4 },
}
// `pesos` arriba lleva una clave ajena a propósito: el schema la descarta (strip), no falla.

const CASOS: Array<[string, z.ZodTypeAny, Record<string, unknown>]> = [
  ['PanelSeguimientoLoteSchema', PanelSeguimientoLoteSchema, FILAS.seguimientoLote],
  ['PanelSeguimientoGalponSchema', PanelSeguimientoGalponSchema, FILAS.seguimientoGalpon],
  ['PanelSeguimientoGranjaSchema', PanelSeguimientoGranjaSchema, FILAS.seguimientoGranja],
  ['PanelReproduccionMesSchema', PanelReproduccionMesSchema, FILAS.reproduccion],
  ['PanelIntervaloPartosSchema', PanelIntervaloPartosSchema, FILAS.intervalo],
  ['PanelReemplazoReproductorasSchema', PanelReemplazoReproductorasSchema, FILAS.reemplazo],
  ['PanelIndicadoresSanitariosSchema', PanelIndicadoresSanitariosSchema, FILAS.sanitarios],
  ['PanelIncidenciaPatologiasSchema', PanelIncidenciaPatologiasSchema, FILAS.incidencia],
  ['PanelPesosPromedioSchema', PanelPesosPromedioSchema, FILAS.pesos],
  ['PanelVentasMesSchema', PanelVentasMesSchema, FILAS.ventas],
  ['PanelGalponNombreSchema', PanelGalponNombreSchema, FILAS.galpon],
  ['PoblacionResumenSchema (existente, reutilizado)', PoblacionResumenSchema, FILAS.poblacion],
]

describe('schemas de lectura del Panel: forma común', () => {
  test.each(CASOS)('%s acepta una fila con la forma real', (_n, schema, fila) => {
    expect(schema.safeParse(fila).success).toBe(true)
  })

  test.each(CASOS)('%s: la vista sin filas ([]) es un resultado válido, no un error', (_n, schema) => {
    const r = z.array(schema).safeParse([])
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual([])
  })

  test.each(CASOS)('%s rechaza un objeto vacío', (_n, schema) => {
    expect(schema.safeParse({}).success).toBe(false)
  })

  test.each(CASOS)('%s rechaza una fila a la que le falta una columna', (_n, schema, fila) => {
    const [primera] = Object.keys(schema.parse(fila) as object)
    const incompleta: Record<string, unknown> = { ...fila }
    delete incompleta[primera]
    expect(schema.safeParse(incompleta).success).toBe(false)
  })
})

describe('numeric de PostgREST: número estricto, jamás string ni NULL->0', () => {
  test('un numeric que llegara como string falla (el contrato real es número JSON)', () => {
    expect(PanelReproduccionMesSchema.safeParse({ ...FILAS.reproduccion, crias_vivas_promedio_parto: '1.00' }).success).toBe(false)
    expect(PanelVentasMesSchema.safeParse({ ...FILAS.ventas, monto_total_mes: '1840.00' }).success).toBe(false)
  })

  test('las columnas nullable conservan el NULL: no se convierte en 0', () => {
    const r = PanelIndicadoresSanitariosSchema.parse(FILAS.sanitarios)
    expect(r.mortalidad_lactancia_pct_mes).toBeNull()
    expect(r.mortalidad_recria_engorde_pct_mes).toBe(0) // 0 real (población > 0, sin muertes) != NULL
    const g = PanelSeguimientoGranjaSchema.parse({ ...FILAS.seguimientoGranja, ganancia_diaria_promedio_g: null, fcr_promedio: null })
    expect(g.ganancia_diaria_promedio_g).toBeNull()
    expect(g.fcr_promedio).toBeNull()
  })

  test('JSON.parse del texto crudo de PostgREST (1.00, 33.3, 0.0) produce números', () => {
    const crudo = '[{"ID_Organizacion":"GRANJA-TEST","partos_mes":2,"crias_vivas_total_mes":2,"crias_vivas_promedio_parto":1.00,"peso_promedio_nacimiento_g":null,"partos_con_peso_registrado":0}]'
    const filas = z.array(PanelReproduccionMesSchema).parse(JSON.parse(crudo))
    expect(filas[0].crias_vivas_promedio_parto).toBe(1)
    expect(filas[0].peso_promedio_nacimiento_g).toBeNull()
  })

  test('un entero con decimales falla (conteos)', () => {
    expect(PanelReproduccionMesSchema.safeParse({ ...FILAS.reproduccion, partos_mes: 2.5 }).success).toBe(false)
  })
})

describe('casos por vista', () => {
  test('seguimiento_lote: fcr = 0 con datos_suficientes=false es una fila válida (la UI debe mirar el flag)', () => {
    const r = PanelSeguimientoLoteSchema.safeParse({ ...FILAS.seguimientoLote, ganancia_diaria_g: 10, fcr: 0, datos_suficientes: false })
    expect(r.success).toBe(true)
  })

  test('seguimiento_galpon/granja: ganancia y fcr negativos son válidos para el schema (la UI decide)', () => {
    expect(PanelSeguimientoGranjaSchema.safeParse({ ...FILAS.seguimientoGranja, ganancia_diaria_promedio_g: -2.5, fcr_promedio: -1.2 }).success).toBe(true)
  })

  test('incidencia: causa NULL y causas del enum válidas; una causa fuera del enum falla', () => {
    expect(PanelIncidenciaPatologiasSchema.safeParse({ ...FILAS.incidencia, causa: null }).success).toBe(true)
    for (const causa of ['neumonia', 'distocia', 'aplastamiento', 'gastroenteritis', 'depredador', 'desconocido', 'otro']) {
      expect(PanelIncidenciaPatologiasSchema.safeParse({ ...FILAS.incidencia, causa }).success).toBe(true)
    }
    expect(PanelIncidenciaPatologiasSchema.safeParse({ ...FILAS.incidencia, causa: 'sarna' }).success).toBe(false)
  })

  test('ventas_mes: animales_vendidos_mes es obligatoria (columna de 20261008100000)', () => {
    const { animales_vendidos_mes: _omitida, ...sinAnimales } = FILAS.ventas
    expect(PanelVentasMesSchema.safeParse(sinAnimales).success).toBe(false)
  })

  test('pesos_promedio_mes: ambos pesos pueden ser NULL a la vez', () => {
    const r = PanelPesosPromedioSchema.parse({ ID_Organizacion: ORG, peso_promedio_destete_g_mes: null, peso_promedio_engorde_g_actual: null })
    expect(r.peso_promedio_destete_g_mes).toBeNull()
    expect(r.peso_promedio_engorde_g_actual).toBeNull()
  })

  test('intervalo_partos: intervalo individual NULL con 0 madres es válido', () => {
    expect(PanelIntervaloPartosSchema.safeParse({ ...FILAS.intervalo, intervalo_promedio_dias_individual: null, madres_con_intervalo_calculado: 0 }).success).toBe(true)
  })

  test('reemplazo: tasa NULL cuando no hay hembras activas', () => {
    expect(PanelReemplazoReproductorasSchema.safeParse({ ...FILAS.reemplazo, hembras_activas_actual: 0, tasa_reemplazo_pct: null }).success).toBe(true)
  })

  test('galpon: nombre NULL es válido (el rótulo cae al código)', () => {
    expect(PanelGalponNombreSchema.parse(FILAS.galpon).nombre).toBeNull()
  })

  test('las claves ajenas se descartan (strip), no hacen fallar la lectura', () => {
    const r = PanelPesosPromedioSchema.parse(FILAS.pesos) as Record<string, unknown>
    expect('columna_ajena' in r).toBe(false)
  })
})
