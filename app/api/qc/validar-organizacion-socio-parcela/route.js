// Route Handler: detecta si el ID_Socio/ID_Parcela_Fija de un registro EUDR
// en revisión pertenece, según PADRON_SOCIOS/PADRON_PARCELAS, a una
// organización distinta de la del propio registro — sección de bloqueo en
// QcDetailEditor.jsx. Ver docs/adr/ADR-020-validacion-organizacion-socio-parcela.md.
//
// runtime = 'nodejs' — mismo motivo que el resto de los Route Handlers
// server-only del proyecto. Mismo patrón que
// /api/qc/validar-codigo-parcela (ADR-014): Service Role Key server-side
// (la tabla base EUDR_MONITOREO niega SELECT anon — ver el gotcha de RLS
// en CLAUDE.md), reutilizando la función real (checkSocioParcelaOrganizacion,
// lib/eudrQcActions.js) que también usa assertSocioParcelaMismaOrganizacion
// del lado del servidor — un solo lugar con la lógica de comparación, no
// dos copias que puedan divergir.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getSupabaseServerClient } from '@/lib/supabaseServerClient'
import { checkSocioParcelaOrganizacion } from '@/lib/eudrQcActions'

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body inválido — se espera JSON.' }, { status: 400 })
  }

  const { ID_Organizacion, ID_Parcela_Fija, tabla_origen, id_monitoreo, fecha_monitoreo } = body || {}
  if (!ID_Organizacion) {
    return Response.json({ error: 'Falta "ID_Organizacion".' }, { status: 400 })
  }

  let supabase
  try {
    supabase = getSupabaseServerClient()
  } catch (err) {
    return Response.json({ error: err?.message || 'Cliente Supabase no configurado.' }, { status: 500 })
  }

  try {
    const result = await checkSocioParcelaOrganizacion(supabase, {
      ID_Organizacion,
      ID_Parcela_Fija,
      tabla_origen,
      id_monitoreo,
      fecha_monitoreo,
    })
    return Response.json({ result }, { status: 200 })
  } catch (err) {
    return Response.json({ error: err?.message || 'No se pudo validar la organización.' }, { status: 400 })
  }
}
