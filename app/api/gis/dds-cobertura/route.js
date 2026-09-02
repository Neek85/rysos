// Route Handler: cobertura de Uso de Suelo por parcela para el Paquete de
// Trazabilidad exportado desde /dashboard/mapa (botón "Exportar Paquete de
// Trazabilidad", components/gis/MapDashboard.jsx::handleExportDDS).
// Puramente informativo — nunca bloquea la exportación (mismo criterio que
// ADR-011).
//
// fn_cobertura_uso_suelo_parcela no es SECURITY DEFINER y su propia
// migración (supabase/migrations/20260823_155621_fn_cobertura_uso_suelo_parcela.sql)
// documenta que solo debe invocarse con el Service Role Key, nunca con la
// anon key del navegador (fallaría por RLS: EUDR_MONITOREO solo es legible
// por el rol authenticated, y este frontend nunca tiene sesión — ver el
// "gotcha" de RLS en CLAUDE.md) — de ahí este Route Handler intermedio, en
// vez de un supabase.rpc() directo desde MapDashboard.jsx como asumía el
// prompt original de ADR-017.
//
// Batched a propósito: UNA sola llamada HTTP con todos los id_monitoreo de
// la exportación, no una por parcela (ver ADR-017 — evita multiplicar
// round-trips en lo que ya es una acción manual de un solo click).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getSupabaseServerClient } from '@/lib/supabaseServerClient'

const MAX_IDS_PER_REQUEST = 200

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body inválido — se espera JSON.' }, { status: 400 })
  }

  const organizationId = body?.organizationId
  const monitoreoIds = Array.isArray(body?.monitoreoIds) ? body.monitoreoIds : []

  if (!organizationId || typeof organizationId !== 'string') {
    return Response.json({ error: 'organizationId requerido.' }, { status: 400 })
  }
  if (monitoreoIds.length === 0) {
    return Response.json({ result: {} }, { status: 200 })
  }
  if (monitoreoIds.length > MAX_IDS_PER_REQUEST) {
    return Response.json(
      { error: `Máximo ${MAX_IDS_PER_REQUEST} parcelas por exportación.` },
      { status: 400 }
    )
  }

  let supabase
  try {
    supabase = getSupabaseServerClient()
  } catch (err) {
    return Response.json({ error: err?.message || 'Cliente Supabase no configurado.' }, { status: 500 })
  }

  const validIds = monitoreoIds.filter((id) => typeof id === 'string' && id)

  const settled = await Promise.all(
    validIds.map(async (monitoreoId) => {
      const { data, error } = await supabase.rpc('fn_cobertura_uso_suelo_parcela', {
        p_monitoreo_id: monitoreoId,
      })
      // Informativo únicamente: una parcela que falla (RPC error, sin datos,
      // o — defensa en profundidad — perteneciente a otra organización pese
      // a que el Service Role Key bypasea RLS) simplemente no aparece en el
      // resumen, nunca tumba el resto del batch.
      if (error || !data || data.ID_Organizacion !== organizationId) return null
      return [monitoreoId, data]
    })
  )

  const result = Object.fromEntries(settled.filter(Boolean))

  return Response.json({ result }, { status: 200 })
}
