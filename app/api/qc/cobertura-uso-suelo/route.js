// Route Handler: cobertura completa de subdivisiones de Uso de Suelo para
// la parcela de un registro EUDR_USO_SUELO en revisión (Consola QC,
// /dashboard/qc) — sección "Cobertura de la parcela" en
// QcDetailEditor.jsx. Ver docs/adr/ADR-011-cobertura-completa-uso-suelo.md.
//
// runtime = 'nodejs' — mismo motivo que app/api/qc/validate-spatial/route.js.
//
// Esta ruta resuelve "dado un EUDR_USO_SUELO, ¿cuál es su EUDR_MONITOREO
// padre?" vía el join REAL de ADR-010 (qfield_relation_id = id_parcela) —
// NUNCA el heurístico espacial de ADR-005/Fase A, que solo se usó como
// backfill puntual. Si no hay exactamente un Monitoreo vinculado (0 o
// más de uno — nunca se asume ante ambigüedad, mismo criterio ya
// establecido en Fase A/B0), responde con el caso "sin vínculo" en vez de
// llamar la RPC — fn_cobertura_uso_suelo_parcela asume que ya se le pasó
// un p_monitoreo_id resuelto sin ambigüedad.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getSupabaseServerClient } from '@/lib/supabaseServerClient'
import { validateCoberturaRequest, buildSinVinculoResult } from '@/lib/qcCoberturaUsoSuelo'

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body inválido — se espera JSON.' }, { status: 400 })
  }

  const parsed = validateCoberturaRequest(body)
  if (!parsed.valid) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }

  let supabase
  try {
    supabase = getSupabaseServerClient()
  } catch (err) {
    return Response.json({ error: err?.message || 'Cliente Supabase no configurado.' }, { status: 500 })
  }

  const { data: usoSuelo, error: usoSueloError } = await supabase
    .from('EUDR_USO_SUELO')
    .select('id, id_parcela, "ID_Organizacion"')
    .eq('id', parsed.usoSueloId)
    .maybeSingle()

  if (usoSueloError) {
    return Response.json({ error: usoSueloError.message }, { status: 400 })
  }
  if (!usoSuelo) {
    return Response.json({ error: `Registro EUDR_USO_SUELO ${parsed.usoSueloId} no encontrado.` }, { status: 404 })
  }

  if (!usoSuelo.id_parcela) {
    return Response.json({ result: buildSinVinculoResult() }, { status: 200 })
  }

  // Defensa en profundidad: se filtra también por ID_Organizacion aunque
  // qfield_relation_id ya sea, en la práctica, un GUID improbable de
  // colisionar entre organizaciones (mismo criterio que
  // fetchComparisonGeometries en lib/eudrQcActions.js).
  const { data: monitoreos, error: monitoreoError } = await supabase
    .from('EUDR_MONITOREO')
    .select('id_monitoreo')
    .eq('qfield_relation_id', usoSuelo.id_parcela)
    .eq('ID_Organizacion', usoSuelo.ID_Organizacion)

  if (monitoreoError) {
    return Response.json({ error: monitoreoError.message }, { status: 400 })
  }

  if (!monitoreos || monitoreos.length !== 1) {
    return Response.json({ result: buildSinVinculoResult() }, { status: 200 })
  }

  const { data, error } = await supabase.rpc('fn_cobertura_uso_suelo_parcela', {
    p_monitoreo_id: monitoreos[0].id_monitoreo,
  })

  if (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }

  return Response.json({ result: { vinculo_disponible: true, ...data } }, { status: 200 })
}
