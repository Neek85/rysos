'use server'

// Server Actions de SOLO LECTURA para resolver la organización activa de
// /dashboard/socios (lib/sociosSearch.js::fetchSocios/fetchParcelasBySocio).
//
// HALLAZGO DE SEGURIDAD (2026-09-08, fuga de PII en vivo en ryzosagri.com)
// -- resolveOrganizationId() (RETIRADA, vivía acá) era el fallback por
// defecto de fetchSocios: resolvía "la organización real más antigua"
// (`ORGANIZACIONES` ordenada por `creado_en`, excluyendo
// `es_organizacion_prueba = true`) SIN mirar la sesión en absoluto. Tenía
// sentido cuando se escribió (specs/mejoras_importador_padron_masivo.md
// ronda 8, antes de que existiera login real) porque en ese momento no
// había ninguna sesión de la cual partir. Pero el login real por
// organización/rol (specs/login_real_organizacion_rol.md, Fase D) ya está
// activo para toda /dashboard/** (middleware.js exige sesión de Supabase
// Auth) desde antes de este hallazgo -- nadie actualizó
// lib/sociosSearch.js para usar esa sesión en vez de la heurística vieja.
// Resultado: CUALQUIER cuenta autenticada (Eduardo, Dante, o cualquiera de
// las 3 cuentas demo, sin importar su propia organización) veía siempre el
// padrón completo de `COOP-AROMAS-VALLE` (618 socios reales, nombre + DNI)
// en /dashboard/socios -- confirmado en vivo con la cuenta demo. Las
// ESCRITURAS nunca estuvieron expuestas por este mismo bug (createSocio/
// updateSocio/deactivateSocio siguen tomando `ID_Organizacion` del registro
// real que se está editando, nunca de esta resolución, y además
// fn_enforce_padron_admin_role -- ADR-039 -- exige rol admin vía RLS del
// lado de Postgres) -- era un gap de LECTURA únicamente. Confirmado que
// resolveOrganizationId no tenía ningún otro caller en el repo, así que no
// queda como fallback de nada más al retirarla.
//
// resolveSessionOrganizationId() (nueva, reemplaza a resolveOrganizationId
// como default de fetchSocios) resuelve por SESIÓN real -- mismo patrón y
// misma tabla que lib/auth/getCurrentProfile.js (PERFILES_USUARIO_INTERNOS,
// filtrado por user_id + activo, auth.getUser() para validar el JWT de
// verdad contra el servidor de Supabase Auth). Duplicado acá en vez de
// importado de getCurrentProfile.js porque ese archivo usa el alias
// `@/lib/...` (ver el comentario de import relativo, abajo) -- importarlo
// directo rompería la cadena de Node puro que necesita este archivo.
//
// resolveTestOrganizationOverride() sigue sin cambios -- sigue usando la
// Service Role Key porque verifica un override de URL (`?org=...`) contra
// ORGANIZACIONES antes de aceptarlo, sin depender de que quien lo pase
// tenga sesión propia.

// Import RELATIVO, no el alias `@/lib/...` que usan el resto de
// lib/actions/*.js -- a diferencia de esos archivos (nunca importados
// directo por ningún test, el alias de Next.js nunca se ejercita fuera
// del build real), este archivo SÍ lo importa lib/sociosSearch.js, que
// tests/test_sociossearch_multitenant.mjs importa directo con Node puro
// (`node --test`, sin el resolver de alias de Next.js) -- `@/lib/...`
// rompería esa cadena con `ERR_MODULE_NOT_FOUND`.
import { getSupabaseServerClient } from '../supabaseServerClient.js'
import { createSessionServerClient } from '../supabase/sessionServerClient.js'

/**
 * Resuelve la organización de la SESIÓN real -- ver el hallazgo arriba.
 * Fail-closed: sin sesión válida (JWT inválido/ausente) o sin perfil
 * activo en PERFILES_USUARIO_INTERNOS -> `null`, nunca lanza error (mismo
 * criterio que getCurrentProfile.js). `fetchSocios` ya trata `null` como
 * "sin organización resuelta" -> `rows: []` sin llamar a ninguna función
 * SQL (tests/test_sociossearch_multitenant.mjs, "sin organización
 * resuelta").
 */
export async function resolveSessionOrganizationId() {
  const supabase = await createSessionServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: perfil } = await supabase
    .from('PERFILES_USUARIO_INTERNOS')
    .select('ID_Organizacion')
    .eq('user_id', user.id)
    .eq('activo', true)
    .maybeSingle()

  return perfil?.ID_Organizacion ?? null
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
