// Route Handler: inserta una fila en audit_logs (traza inmutable de
// decisiones Aprobar/Rechazar de la Consola QC) — ver
// specs/qc_batch_audit_trail.md. Usa el Service Role Key
// (lib/supabaseServerClient.js): audit_logs no tiene ninguna política RLS
// para anon/authenticated (ver la migración), a propósito — solo este
// route puede escribir ahí.
//
// runtime = 'nodejs' — mismo motivo que el resto de los Route Handlers
// server-only del proyecto.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getSupabaseServerClient } from '@/lib/supabaseServerClient'
import { validateAuditLogRequest } from '@/lib/qcAuditLog'

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body inválido — se espera JSON.' }, { status: 400 })
  }

  const parsed = validateAuditLogRequest(body)
  if (!parsed.valid) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }

  let supabase
  try {
    supabase = getSupabaseServerClient()
  } catch (err) {
    return Response.json({ error: err?.message || 'Cliente Supabase no configurado.' }, { status: 500 })
  }

  const { error } = await supabase.from('audit_logs').insert(parsed.payload)
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true }, { status: 200 })
}
