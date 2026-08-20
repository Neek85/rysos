// Route Handler: validación topológica bajo demanda para un registro de la
// Consola QC (/dashboard/qc) — botón "Validar Topología" en QcDetailEditor.jsx.
// Ver specs/qc_topological_eudr_validation.md.
//
// runtime = 'nodejs' (no estrictamente requerido por esta lógica, pero
// consistente con el resto de los Route Handlers del proyecto que hacen
// trabajo server-only — ver app/api/trace/[lot_hash]/pdf/route.js).
//
// Usa el Service Role Key (lib/supabaseServerClient.js) para invocar la
// RPC y escribir la auditoría — mismo patrón que
// lib/actions/sociosActions.js: el aislamiento multi-tenant real lo
// garantiza fn_validar_topologia_eudr (resuelve la organización desde la
// fila real, nunca confía en un valor enviado por el cliente), no RLS.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getSupabaseServerClient } from '@/lib/supabaseServerClient'
import { validateTopologyRequest } from '@/lib/qcTopologyValidation'

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body inválido — se espera JSON.' }, { status: 400 })
  }

  const parsed = validateTopologyRequest(body)
  if (!parsed.valid) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }
  const { tablaOrigen, registroId } = parsed

  let supabase
  try {
    supabase = getSupabaseServerClient()
  } catch (err) {
    return Response.json({ error: err?.message || 'Cliente Supabase no configurado.' }, { status: 500 })
  }

  const { data, error } = await supabase.rpc('fn_validar_topologia_eudr', {
    p_tabla_origen: tablaOrigen,
    p_registro_id: registroId,
  })

  if (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }

  // Auditoría — el resultado (data) no contiene ningún campo de
  // PADRON_SOCIOS/PII, solo geometría/topología/organización (código, no
  // nombre). No se bloquea la respuesta al cliente si el insert de
  // auditoría falla — es un registro secundario, no la operación principal.
  try {
    await supabase.from('qc_validation_audit_log').insert({
      tabla_origen: tablaOrigen,
      registro_id: registroId,
      ID_Organizacion: data?.ID_Organizacion || null,
      resultado: data,
    })
  } catch {
    // No-op: fallar la auditoría no debe impedir que el usuario vea el
    // dictamen topológico que sí se calculó correctamente.
  }

  return Response.json({ result: data }, { status: 200 })
}
