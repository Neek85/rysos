// Lógica pura de Reemplazo/descarte (specs/app_granja_valencia_reemplazo.md):
// agrupar las filas de la consulta compartida por animal y por jaula, contar
// animales distintos y armar el desglose por motivo. Sin React ni Supabase, para
// testearla con Jest (logica.test.ts). Inicio (número de la tarjeta) y /reemplazo
// (lista) la usan sobre las MISMAS filas, para no discrepar.

export type Motivo = 'max_partos_alcanzado' | 'camada_chica_parto_temprano'

// Forma de una fila de la consulta de datos.ts (tabla de sugerencias con embed
// anidado de reproductor -> jaula -> galpón).
export type FilaSugerencia = {
  id: string
  motivo: Motivo
  detalle: string
  estado: string
  reproductor_id: string
  PECUARIO_REPRODUCTORES: {
    codigo_arete: string
    raza: string | null
    estado: string
    proposito: string
    jaula_actual_id: string | null
    PECUARIO_JAULAS: {
      codigo_poza: string
      galpon_id: string | null
      PECUARIO_GALPONES: { codigo_galpon: string; nombre: string | null } | null
    } | null
  } | null
}

export type SugerenciaAnimal = { id: string; motivo: Motivo; detalle: string }

export type AnimalSugerido = {
  reproductor_id: string
  codigo_arete: string
  raza: string | null
  codigo_poza: string | null
  codigo_galpon: string | null
  sugerencias: SugerenciaAnimal[]
}

export type GrupoJaula = {
  codigo_poza: string | null // null = "Sin jaula asignada"
  codigo_galpon: string | null
  animales: AnimalSugerido[]
}

// Orden fijo de los motivos (el mismo del desglose de la tarjeta).
export const ORDEN_MOTIVOS: Motivo[] = ['max_partos_alcanzado', 'camada_chica_parto_temprano']

export const ETIQUETA_MOTIVO: Record<Motivo, string> = {
  max_partos_alcanzado: 'Máx. partos',
  camada_chica_parto_temprano: 'Camada chica',
}

const TEXTO_DESGLOSE: Record<Motivo, string> = {
  max_partos_alcanzado: 'por máximo de partos',
  camada_chica_parto_temprano: 'por camada chica',
}

const comparar = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })

/** Cantidad de animales DISTINTOS con al menos una sugerencia (N de la tarjeta). */
export function contarAnimales(filas: FilaSugerencia[]): number {
  return new Set(filas.map((f) => f.reproductor_id)).size
}

/** Cantidad de SUGERENCIAS por motivo (un animal puede sumar en los dos). */
export function contarPorMotivo(filas: FilaSugerencia[]): Record<Motivo, number> {
  const conteo: Record<Motivo, number> = { max_partos_alcanzado: 0, camada_chica_parto_temprano: 0 }
  for (const f of filas) {
    if (f.motivo in conteo) conteo[f.motivo] += 1
  }
  return conteo
}

/** "1 por máximo de partos · 2 por camada chica" (solo motivos con conteo > 0, orden fijo). */
export function textoDesglose(filas: FilaSugerencia[]): string {
  const conteo = contarPorMotivo(filas)
  return ORDEN_MOTIVOS.filter((m) => conteo[m] > 0)
    .map((m) => `${conteo[m]} ${TEXTO_DESGLOSE[m]}`)
    .join(' · ')
}

/** "1 reproductora sugerida para reemplazo" / "N reproductoras sugeridas para reemplazo". */
export function tituloTarjeta(n: number): string {
  return n === 1 ? '1 reproductora sugerida para reemplazo' : `${n} reproductoras sugeridas para reemplazo`
}

/**
 * Subtítulo de /reemplazo, con concordancia en singular y plural
 * ("1 reproductora agrupada por jaula" / "N reproductoras agrupadas por jaula").
 * Sin animales: el estado vacío de la spec. A quien no puede resolver se le indica
 * que es solo lectura.
 */
export function subtituloLista(totalAnimales: number, puedeActuar: boolean): string {
  if (totalAnimales === 0) return 'No hay reproductoras sugeridas para reemplazo por ahora.'
  const una = totalAnimales === 1
  const cabecera = `${totalAnimales} reproductora${una ? '' : 's'} agrupada${una ? '' : 's'} por jaula`
  return `${cabecera} — ${puedeActuar ? 'revisá y confirmá o ignorá cada una' : 'solo lectura'}`
}

/** Junta las filas por animal (una fila por reproductor_id, con todas sus sugerencias). */
export function agruparPorAnimal(filas: FilaSugerencia[]): AnimalSugerido[] {
  const porAnimal = new Map<string, AnimalSugerido>()
  for (const f of filas) {
    const rep = f.PECUARIO_REPRODUCTORES
    if (!rep) continue // con !inner no debería pasar; no se inventa un animal sin datos
    let animal = porAnimal.get(f.reproductor_id)
    if (!animal) {
      animal = {
        reproductor_id: f.reproductor_id,
        codigo_arete: rep.codigo_arete,
        raza: rep.raza ?? null,
        codigo_poza: rep.PECUARIO_JAULAS?.codigo_poza ?? null,
        codigo_galpon: rep.PECUARIO_JAULAS?.PECUARIO_GALPONES?.codigo_galpon ?? null,
        sugerencias: [],
      }
      porAnimal.set(f.reproductor_id, animal)
    }
    animal.sugerencias.push({ id: f.id, motivo: f.motivo, detalle: f.detalle })
  }
  for (const animal of porAnimal.values()) {
    animal.sugerencias.sort((a, b) => ORDEN_MOTIVOS.indexOf(a.motivo) - ORDEN_MOTIVOS.indexOf(b.motivo))
  }
  return [...porAnimal.values()]
}

/**
 * Agrupa por jaula: grupos ordenados por codigo_poza (orden natural: P-2 antes de
 * P-10), animales por codigo_arete dentro del grupo, y "Sin jaula asignada"
 * (codigo_poza null) siempre al final.
 */
export function agruparPorJaula(filas: FilaSugerencia[]): GrupoJaula[] {
  const grupos = new Map<string, GrupoJaula>()
  for (const animal of agruparPorAnimal(filas)) {
    const clave = animal.codigo_poza ?? '\u0000sin-jaula'
    let grupo = grupos.get(clave)
    if (!grupo) {
      grupo = { codigo_poza: animal.codigo_poza, codigo_galpon: animal.codigo_galpon, animales: [] }
      grupos.set(clave, grupo)
    }
    grupo.animales.push(animal)
  }
  const lista = [...grupos.values()]
  for (const g of lista) g.animales.sort((a, b) => comparar(a.codigo_arete, b.codigo_arete))
  const conJaula = lista.filter((g) => g.codigo_poza !== null).sort((a, b) => comparar(a.codigo_poza!, b.codigo_poza!))
  const sinJaula = lista.filter((g) => g.codigo_poza === null)
  return [...conJaula, ...sinJaula]
}

/** "Jaula X — Galpón Y · N sugerida(s)" / "Jaula X · N sugerida(s)" / "Sin jaula asignada · N sugerida(s)". */
export function tituloGrupo(g: GrupoJaula): string {
  const n = g.animales.length
  const cuenta = n === 1 ? '1 sugerida' : `${n} sugeridas`
  if (g.codigo_poza === null) return `Sin jaula asignada · ${cuenta}`
  return g.codigo_galpon ? `Jaula ${g.codigo_poza} — Galpón ${g.codigo_galpon} · ${cuenta}` : `Jaula ${g.codigo_poza} · ${cuenta}`
}

export type AccionResolver = 'confirmada' | 'ignorada'

/** Texto del diálogo de confirmación previo a la acción (spec §4): avisa que no se puede deshacer. */
export function mensajeDialogo(accion: AccionResolver, codigoArete: string): { titulo: string; mensaje: string; boton: string } {
  if (accion === 'confirmada') {
    return {
      titulo: 'Confirmar descarte',
      mensaje: `Se marcará a ${codigoArete} como descarte. Esta acción no se puede deshacer.`,
      boton: 'Confirmar descarte',
    }
  }
  return {
    titulo: 'Ignorar por ahora',
    mensaje: `No se volverá a sugerir el reemplazo de ${codigoArete} por ninguno de sus motivos. Esta acción no se puede deshacer.`,
    boton: 'Ignorar',
  }
}

/** Mensaje de éxito tras resolver (spec §4). */
export function mensajeExito(accion: AccionResolver, codigoArete: string): string {
  return accion === 'confirmada'
    ? `${codigoArete} marcada para descarte.`
    : `No se volverá a sugerir el reemplazo de ${codigoArete}.`
}

export const MENSAJE_YA_RESUELTAS = 'Estas sugerencias ya fueron resueltas.'

/** Traduce un error de Supabase a un mensaje para el banner (spec §4). */
export function traducirErrorResolver(error: { code?: string | null; message?: string | null }): string {
  const mensaje = error.message ?? ''
  if (error.code === '42501' || /row-level security/i.test(mensaje)) return 'No tenés permiso para resolver sugerencias.'
  if (/network|fetch|failed to fetch|timeout/i.test(mensaje)) return 'Sin conexión. No se guardó nada: reintentá cuando vuelva la señal.'
  return mensaje || 'No se pudo resolver la sugerencia.'
}

/** Roles que ven los botones (cosmético: la barrera real es la RLS). */
export function puedeResolver(rol: string | null | undefined): boolean {
  return rol === 'admin' || rol === 'tecnico_campo'
}
