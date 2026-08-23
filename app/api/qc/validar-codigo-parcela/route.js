// Route Handler: detecta si el ID_Parcela_Fija de un registro EUDR_MONITOREO
// en revisión también aparece en otra ubicación físicamente distinta dentro
// de la misma organización (Consola QC, /dashboard/qc) — sección de bloqueo
// en QcDetailEditor.jsx. Ver docs/adr/ADR-014-codigo-parcela-unico-por-ubicacion.md.
//
// runtime = 'nodejs' — mismo motivo que el resto de los Route Handlers
// server-only del proyecto.
//
// A diferencia de /api/qc/cobertura-uso-suelo, acá no hace falta resolver
// ningún vínculo indirecto: la regla aplica directo sobre el propio
// EUDR_MONITOREO en revisión, así que monitoreo_id ya es el id real de la
// fila (record.id_origen === record.id_monitoreo para esta tabla, ver
// lib/eudrQcActions.js).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getSupabaseServerClient } from '@/lib/supabaseServerClient'
import { validateCodigoParcelaRequest } from '@/lib/qcCodigoParcelaUnico'

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body inválido — se espera JSON.' }, { status: 400 })
  }

  const parsed = validateCodigoParcelaRequest(body)
  if (!parsed.valid) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }

  let supabase
  try {
    supabase = getSupabaseServerClient()
  } catch (err) {
    return Response.json({ error: err?.message || 'Cliente Supabase no configurado.' }, { status: 500 })
  }

  const { data, error } = await supabase.rpc('fn_validar_codigo_parcela_unico', {
    p_monitoreo_id: parsed.monitoreoId,
  })

  if (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }

  return Response.json({ result: data }, { status: 200 })
}
