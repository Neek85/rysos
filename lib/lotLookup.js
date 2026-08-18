// Búsqueda de un lote por lot_hash — extraído de app/trace/[lot_hash]/page.jsx
// para que tanto la página pública como el Route Handler del PDF
// (app/api/trace/[lot_hash]/pdf/route.js) usen exactamente la misma lógica.
// Duplicarla habría arriesgado el mismo tipo de drift ya encontrado entre
// el hash JS y el hash Python (ver specs/trace_public_audit.md).
//
// INVARIANTE: no existe una columna `lot_hash` persistida en ninguna vista
// (ver specs/trace_public_audit.md) — el lot_hash SIEMPRE se recalcula a
// partir de los registros aprobados de vw_monitoreo_web, agrupados por
// ID_Organizacion, hasta encontrar la organización cuyo hash coincide con
// el parámetro de la URL.

import { createClient } from '@supabase/supabase-js'
import { buildTracesPayload } from '@/lib/eudrDdsExporter'
import { generateLotHash, buildPublicSanitizedPayload } from '@/lib/traceabilityHash'

export async function findLotByHash(lotHash) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  const { data, error } = await supabase
    .from('vw_monitoreo_web')
    .select(
      'tabla_origen,ID_Organizacion,ID_Parcela_Fija,parcela_codigo,parcela_nombre,area_ha,productor,cumple_eudr,estado_revision,geom_geojson'
    )

  if (error || !Array.isArray(data)) return null

  const byOrg = new Map()
  data.forEach((record) => {
    const orgId = record.ID_Organizacion
    if (!orgId) return
    if (!byOrg.has(orgId)) byOrg.set(orgId, [])
    byOrg.get(orgId).push(record)
  })

  for (const [orgId, records] of byOrg.entries()) {
    try {
      const ddsPayload = buildTracesPayload(records, orgId)
      const candidateHash = await generateLotHash(ddsPayload)
      if (candidateHash === lotHash) {
        return buildPublicSanitizedPayload(ddsPayload, lotHash)
      }
    } catch {
      // Una organización cuyo payload DDS no se puede construir (ej. una
      // parcela >= 4 ha sin polígono registrado) simplemente no participa
      // en la búsqueda — nunca debe tumbar la página/endpoint para todos.
    }
  }

  return null
}
