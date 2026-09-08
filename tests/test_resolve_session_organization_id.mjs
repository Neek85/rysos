// Regresión del hallazgo de seguridad 2026-09-08 (fuga de PII de
// COOP-AROMAS-VALLE en /dashboard/socios -- ver lib/actions/
// organizacionesActions.js y lib/sociosSearch.js para el detalle
// completo del hallazgo y del fix).
//
// resolveOrganizationId() (la heurística "primera organización real",
// SIN mirar la sesión) fue RETIRADA -- ya no existe como export. El
// fallback por defecto de fetchSocios ahora es resolveSessionOrganizationId
// (resuelve por sesión real, mismo patrón que lib/auth/getCurrentProfile.js).
//
// Estos tests no pueden ejercitar una sesión real de Supabase Auth fuera
// del runtime de Next (createSessionServerClient depende de `next/headers`,
// que no existe fuera de una request real de Next -- confirmado corriendo
// `node -e "import('next/headers')"` a mano: "Cannot find module
// '.../node_modules/next/headers'"). Lo que SÍ se puede probar sin ese
// runtime, y es justo lo que hace falta probar para esta regresión
// específica:
//
//   1. resolveOrganizationId ya no existe como export (si alguien la
//      reintroduce como default de fetchSocios, este test lo detecta).
//   2. resolveSessionOrganizationId SÍ existe y es una función.
//   3. Llamar a resolveSessionOrganizationId() (o a fetchSocios() sin
//      ningún resolveOrganizationIdFallback inyectado) rechaza
//      específicamente por la ausencia de `next/headers` -- es decir,
//      el módulo cargó bien y el código intenta de verdad resolver por
//      SESIÓN (createSessionServerClient), no por la heurística vieja
//      (que usaba la Service Role Key y nunca tocaba `next/headers`, así
//      que habría resuelto sin error incluso sin sesión real). Si alguien
//      reintrodujera la heurística vieja como default, este test dejaría
//      de fallar de esta forma específica -- fallaría al no encontrar el
//      error esperado, o peor, resolvería una organización real sin
//      ninguna sesión.
//
// El aislamiento cruzado real (que fetchSocios nunca mezcla filas de dos
// organizaciones) ya está cubierto por
// tests/test_sociossearch_multitenant.mjs, con resolveOrganizationIdFallback
// inyectado -- no se repite acá.
//
// Ejecutar con: node --test tests/test_resolve_session_organization_id.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as organizacionesActions from '../lib/actions/organizacionesActions.js'
import { fetchSocios } from '../lib/sociosSearch.js'

test('resolveOrganizationId (heurística "primera organización real", sin mirar sesión) fue retirada -- ya no es un export', () => {
  assert.equal(
    organizacionesActions.resolveOrganizationId,
    undefined,
    'si esto falla, alguien reintrodujo resolveOrganizationId -- confirmar que nada la use de nuevo como default de fetchSocios antes de dejarla'
  )
})

test('resolveSessionOrganizationId existe y reemplaza a resolveOrganizationId', () => {
  assert.equal(typeof organizacionesActions.resolveSessionOrganizationId, 'function')
})

test('resolveTestOrganizationOverride no se tocó por este fix', () => {
  assert.equal(typeof organizacionesActions.resolveTestOrganizationOverride, 'function')
})

test('resolveSessionOrganizationId(): fuera del runtime de Next, rechaza por next/headers -- nunca resuelve una organización sin sesión real', async () => {
  await assert.rejects(
    () => organizacionesActions.resolveSessionOrganizationId(),
    (err) => {
      assert.match(err.message, /next[\\/]headers/, `mensaje inesperado: ${err.message}`)
      return true
    }
  )
})

test('fetchSocios() SIN resolveOrganizationIdFallback inyectado ya NO cae en la heurística vieja -- intenta resolver por sesión real (rechaza por next/headers, no por la Service Role Key)', async () => {
  // Antes de este fix, esta misma llamada (sin fallback inyectado) habría
  // resuelto silenciosamente a COOP-AROMAS-VALLE vía la Service Role Key,
  // sin tocar `next/headers` en ningún momento -- por eso el hecho de que
  // rechace por `next/headers` es la prueba de que el default cambió de
  // verdad, no solo de nombre.
  await assert.rejects(
    () => fetchSocios(),
    (err) => {
      assert.match(err.message, /next[\\/]headers/, `mensaje inesperado: ${err.message}`)
      return true
    }
  )
})
