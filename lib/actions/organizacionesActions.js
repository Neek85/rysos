'use server'

// Server Action de SOLO LECTURA para resolver la organización activa
// cuando el mecanismo normal (inferirla de PADRON_SOCIOS/PADRON_PARCELAS
// ya cargadas, ver lib/sociosSearch.js::fetchSocios) no tiene ninguna
// fila de la cual partir -- hallazgo real, ver
// specs/mejoras_importador_padron_masivo.md ronda 8 ("No se pudo
// determinar la organización activa" al confirmar la importación masiva
// de Socios, con COOP-AROMAS-VALLE como única organización real tras la
// limpieza de datos de prueba).
//
// Usa la Service Role Key porque `anon` NO tiene política SELECT sobre
// ORGANIZACIONES (docs/schema_live.md: "asimetría deliberada -- Tarea
// 9.1") -- el navegador no puede leerla directo, así que esta resolución
// tiene que vivir en un Server Action, mismo patrón ya usado para leer
// ORGANIZACIONES.Config en lib/actions/qcActions.js::resolveRadioContextoM
// (otra columna, mismo criterio).

// Import RELATIVO, no el alias `@/lib/...` que usan el resto de
// lib/actions/*.js -- a diferencia de esos archivos (nunca importados
// directo por ningún test, el alias de Next.js nunca se ejercita fuera
// del build real), este archivo SÍ lo importa lib/sociosSearch.js, que
// tests/test_sociossearch_multitenant.mjs importa directo con Node puro
// (`node --test`, sin el resolver de alias de Next.js) -- `@/lib/...`
// rompería esa cadena con `ERR_MODULE_NOT_FOUND`.
import { getSupabaseServerClient } from '../supabaseServerClient.js'

/**
 * Resuelve una organización real ("primera encontrada" -- misma
 * heurística de "organización única implícita" que ya usa el resto del
 * sistema sin sesión real que la determine de otra forma; no resuelve un
 * selector multi-organización, fuera de alcance de este fix).
 *
 * Por qué esto funciona cuando PADRON_SOCIOS/PADRON_PARCELAS no alcanzan:
 * a diferencia de esas 2 tablas (que solo tienen filas de una
 * organización DESPUÉS de su primera carga de datos), `ORGANIZACIONES`
 * tiene una fila desde el momento del alta -- el runbook
 * (specs/alta_organizacion_real.md) inserta ahí (y en
 * ORGANIZACION_PRODUCTOS) directamente, nunca toca PADRON_SOCIOS/
 * PADRON_PARCELAS. Por eso una organización real recién dada de alta,
 * sin ningún socio/parcela todavía, sí se puede resolver acá aunque el
 * probe de fetchSocios (contra PADRON_SOCIOS) no encuentre nada.
 *
 * Excluye explícitamente `es_organizacion_prueba = true` (ej.
 * `'ORG-TEST-E2E'`, sembrada en
 * supabase/migrations/20260822_021532_es_organizacion_prueba.sql) --
 * sin este filtro, esa fila de prueba podría devolverse en vez de la
 * organización real si Postgres no devuelve las filas en un orden
 * estable. `order('creado_en')` además hace determinístico cuál es la
 * "primera" (la más antigua) en vez de depender del orden físico de
 * almacenamiento.
 */
export async function resolveOrganizationId() {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('ORGANIZACIONES')
    .select('ID')
    .eq('es_organizacion_prueba', false)
    .order('creado_en')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.ID ?? null
}

/**
 * TEMPORAL (ronda de robustez del importador contra ORG-TEST-DEMO, ver
 * AI_STATE.md 2026-09-01f) — verifica contra ORGANIZACIONES, con la
 * Service Role Key, que `orgId` sea una organización de PRUEBA real
 * (`es_organizacion_prueba = true`) antes de que
 * `app/dashboard/socios/page.jsx` la acepte como override vía el query
 * param `?org=...`. Nunca confía en el valor crudo de la URL: si `orgId`
 * no existe en `ORGANIZACIONES`, o existe pero
 * `es_organizacion_prueba = false` (cualquier organización real,
 * incluida `COOP-AROMAS-VALLE`), devuelve `null` y el caller debe caer
 * al comportamiento normal de `fetchSocios` (sin override) — hace
 * estructuralmente imposible que manipular la URL a mano redirija una
 * carga real hacia una organización que no sea explícitamente de
 * prueba, sin depender de que el frontend "se porte bien".
 */
export async function resolveTestOrganizationOverride(orgId) {
  if (!orgId) return null
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('ORGANIZACIONES')
    .select('ID')
    .eq('ID', orgId)
    .eq('es_organizacion_prueba', true)
    .maybeSingle()
  if (error) throw error
  return data?.ID ?? null
}
