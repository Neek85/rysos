export const dynamic = 'force-dynamic'

import nextDynamic from 'next/dynamic'
import { createClient } from '@supabase/supabase-js'
import { buildTracesPayload } from '@/lib/eudrDdsExporter'
import { generateLotHash, buildPublicSanitizedPayload } from '@/lib/traceabilityHash'
import { generateQrDataUrl } from '@/lib/qrGenerator'

const PublicLotMap = nextDynamic(() => import('@/components/gis/PublicLotMap'), {
  ssr: false,
  loading: () => <div className="p-6 text-center text-xs text-gray-400">Cargando mapa…</div>,
})

// INVARIANTE: no existe una columna `lot_hash` persistida en ninguna vista
// real (verificado contra la instancia Supabase en vivo — ni
// view_eudr_dashboard_aprobados ni vw_monitoreo_web la tienen; la versión
// anterior de esta página asumía `hectareas`/`riesgo_satelital`/`lot_hash`
// en view_eudr_dashboard_aprobados, ninguna de las cuales existe live, así
// que nunca funcionó). El lot_hash SIEMPRE se RECALCULA a partir de los
// registros aprobados de vw_monitoreo_web, igual que
// generate_lot_hash(dds_payload) en scripts/generate_lot_qr.py — un
// "lote" es, por definición, el paquete de exportación DDS vigente de una
// organización (mismo agrupado por parcela que ya usa
// lib/eudrDdsExporter.js para el exportador TRACES UE).
//
// Como la URL pública no lleva organización, se agrupan TODOS los
// registros aprobados por ID_Organizacion, se recalcula el hash de cada
// organización y se compara contra el parámetro de la URL. Para el tamaño
// actual de este sistema (pocas organizaciones) esto es aceptable; si el
// número de organizaciones creciera mucho, valdría la pena persistir
// lot_hash en una tabla de lotes dedicada en vez de recalcularlo en cada
// visita.
async function findLotByHash(lotHash) {
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
      // en la búsqueda — nunca debe tumbar la página pública para todos.
    }
  }

  return null
}

export default async function TracePage({ params }) {
  const { lot_hash } = params
  const lote = await findLotByHash(lot_hash)

  if (!lote) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm space-y-3 rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="text-4xl">🔍</div>
          <h1 className="text-base font-semibold text-gray-800">Lote no encontrado</h1>
          <p className="text-sm text-gray-500">
            El código{' '}
            <code className="rounded bg-gray-100 px-1 font-mono text-xs">{lot_hash}</code> no
            corresponde a ningún lote aprobado.
          </p>
        </div>
      </main>
    )
  }

  const qrDataUrl = await generateQrDataUrl(lote.verification_url)

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto w-full max-w-md space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            ✓ APROBADO EUDR
          </span>
          <h1 className="text-base font-bold leading-snug text-emerald-800">
            100% LIBRE DE DEFORESTACIÓN
            <br />
            FECHA DE CORTE 31/12/2020
          </h1>
          <p className="break-all font-mono text-xs text-gray-400">{lote.lot_hash}</p>
        </div>

        <PublicLotMap features={lote.geojson.features} />

        <dl className="divide-y divide-gray-100 text-sm">
          <div className="flex justify-between py-2.5">
            <dt className="text-gray-500">Parcelas de origen</dt>
            <dd className="font-medium text-gray-900">{lote.total_plots}</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-gray-500">Superficie total</dt>
            <dd className="font-medium text-gray-900">{lote.total_hectares} ha</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-gray-500">Regulación</dt>
            <dd className="font-medium text-gray-900">{lote.regulation}</dd>
          </div>
        </dl>

        <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-4 text-center">
          <img src={qrDataUrl} alt="Código QR de verificación" className="mx-auto h-32 w-32" />
          <p className="text-xs text-gray-400">Escanear para verificar en línea</p>
          <p className="break-all font-mono text-[11px] text-gray-500">{lote.verification_url}</p>
        </div>

        <p className="pt-1 text-center text-xs text-gray-400">
          Este certificado no contiene datos personales identificables. Verificado por RYZOS.
        </p>
      </div>
    </main>
  )
}
