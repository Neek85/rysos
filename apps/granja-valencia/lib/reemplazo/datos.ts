// Acceso a datos de Reemplazo/descarte (specs/app_granja_valencia_reemplazo.md).
// UNA sola función de lectura, compartida por Inicio (tarjeta de Alertas) y
// /reemplazo (lista): el número de la tarjeta y la lista salen del mismo filtro,
// así no pueden discrepar. Lectura bajo la sesión del usuario (RLS por
// organización en todas las tablas del embed).
import { SugerenciaReemplazoResolverSchema } from '../../../../lib/validations/pecuario'
import { supabase } from '../supabase/client'
import { MENSAJE_YA_RESUELTAS, traducirErrorResolver, type AccionResolver, type FilaSugerencia } from './logica'

const SELECT_SUGERENCIAS =
  'id, motivo, detalle, estado, reproductor_id, ' +
  'PECUARIO_REPRODUCTORES!inner(codigo_arete, raza, estado, proposito, jaula_actual_id, ' +
  'PECUARIO_JAULAS(codigo_poza, galpon_id, PECUARIO_GALPONES(codigo_galpon, nombre)))'

/**
 * Sugerencias pendientes de animales activos que no están en descarte (spec §1).
 * Siempre filtra por ID_Organizacion (la RLS ya lo impone; se repite por claridad,
 * como en el resto de la app).
 */
export async function leerSugerenciasPendientes(
  organizacion: string
): Promise<{ filas: FilaSugerencia[]; error: string | null }> {
  const { data, error } = await supabase
    .from('PECUARIO_SUGERENCIAS_REEMPLAZO')
    .select(SELECT_SUGERENCIAS)
    .eq('ID_Organizacion', organizacion)
    .eq('estado', 'pendiente')
    .eq('PECUARIO_REPRODUCTORES.estado', 'activo')
    .neq('PECUARIO_REPRODUCTORES.proposito', 'descarte')
    .order('creada_en', { ascending: true })

  if (error) return { filas: [], error: error.message }
  return { filas: (data ?? []) as unknown as FilaSugerencia[], error: null }
}

export type ResultadoResolver =
  | { tipo: 'resuelta'; filas: number }
  | { tipo: 'ya_resueltas'; mensaje: string }
  | { tipo: 'error'; mensaje: string }

/**
 * UPDATE en bloque por reproductor (spec §4): pasa a `confirmada`/`ignorada` todas
 * las sugerencias `pendiente` de ese animal. El cliente escribe SOLO `estado`;
 * `resuelta_en` y `proposito='descarte'` los escribe la base. Sin offline ni UUID
 * de cliente: es un UPDATE sobre filas que ya existen (spec §6).
 */
export async function resolverSugerencias(
  organizacion: string,
  reproductorId: string,
  estado: AccionResolver
): Promise<ResultadoResolver> {
  const parsed = SugerenciaReemplazoResolverSchema.safeParse({
    reproductor_id: reproductorId,
    ID_Organizacion: organizacion,
    estado,
  })
  if (!parsed.success) {
    return { tipo: 'error', mensaje: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
  }

  const { data, error } = await supabase
    .from('PECUARIO_SUGERENCIAS_REEMPLAZO')
    .update({ estado: parsed.data.estado })
    .eq('reproductor_id', parsed.data.reproductor_id)
    .eq('ID_Organizacion', parsed.data.ID_Organizacion)
    .eq('estado', 'pendiente')
    .select('id')

  if (error) return { tipo: 'error', mensaje: traducirErrorResolver(error) }
  if (!data || data.length === 0) return { tipo: 'ya_resueltas', mensaje: MENSAJE_YA_RESUELTAS }
  return { tipo: 'resuelta', filas: data.length }
}
