export const dynamic = 'force-dynamic'

import nextDynamic from 'next/dynamic'
import { findLotByHash } from '@/lib/lotLookup'
import { generateQrDataUrl } from '@/lib/qrGenerator'

const PublicLotMap = nextDynamic(() => import('@/components/gis/PublicLotMap'), {
  ssr: false,
  loading: () => <div className="p-6 text-center text-xs text-gray-400">Cargando mapa…</div>,
})

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

        <a
          href={`/api/trace/${lote.lot_hash}/pdf`}
          className="block rounded-lg bg-emerald-800 px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-emerald-900"
        >
          📄 Descargar Dossier EUDR (PDF)
        </a>

        <p className="pt-1 text-center text-xs text-gray-400">
          Este certificado no contiene datos personales identificables. Verificado por RYZOS.
        </p>
      </div>
    </main>
  )
}
