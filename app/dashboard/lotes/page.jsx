'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { buildTracesPayload, resolveOrganizationId } from '@/lib/eudrDdsExporter'
import { generateLotHash, buildPublicSanitizedPayload } from '@/lib/traceabilityHash'
import { generateQrDataUrl } from '@/lib/qrGenerator'

// Vista de simulación (Tarea 14, paso 5): genera el QR de trazabilidad
// pública del lote vigente de la organización — mismo lote (agrupado por
// parcela, ver lib/eudrDdsExporter.js) que consumiría /trace/[lot_hash].
// No persiste nada — es un preview/demo del QR que se imprimiría en un
// embarque real.
export default function LotesPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lot, setLot] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [copyState, setCopyState] = useState('idle')

  useEffect(() => {
    let cancelled = false

    async function loadLot() {
      const supabase = getSupabaseClient()
      if (!supabase) {
        setError('Cliente Supabase no configurado (revisa las variables de entorno).')
        setLoading(false)
        return
      }

      try {
        const { data, error: err } = await supabase
          .from('vw_monitoreo_web')
          .select(
            'tabla_origen,ID_Organizacion,ID_Parcela_Fija,parcela_codigo,parcela_nombre,area_ha,productor,cumple_eudr,estado_revision,geom_geojson'
          )
        if (err) throw err
        if (cancelled) return

        const organizationId = resolveOrganizationId(data)
        if (!organizationId) {
          setError('No hay registros aprobados para generar un lote de muestra.')
          setLoading(false)
          return
        }

        const ddsPayload = buildTracesPayload(data, organizationId)
        const lotHash = await generateLotHash(ddsPayload)
        const sanitized = buildPublicSanitizedPayload(ddsPayload, lotHash)
        const qr = await generateQrDataUrl(sanitized.verification_url)

        if (cancelled) return
        setLot(sanitized)
        setQrDataUrl(qr)
      } catch (err) {
        if (!cancelled) setError(err?.message || 'No se pudo generar el lote de muestra.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadLot()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCopyLink() {
    if (!lot) return
    try {
      await navigator.clipboard.writeText(lot.verification_url)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('idle')
    }
  }

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-xl font-bold text-gray-800">Lotes de Trazabilidad Pública</h1>
        <p className="text-sm text-gray-500">
          Simulación del QR de verificación público — vw_monitoreo_web
        </p>
      </header>

      {loading && <p className="text-sm text-gray-400">Generando lote de muestra…</p>}
      {!loading && error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      {!loading && !error && lot && (
        <div className="max-w-sm space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {lot.organization_id}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {lot.total_plots} parcela(s) — {lot.total_hectares} ha
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-4 text-center">
            {qrDataUrl && (
              <img src={qrDataUrl} alt="Código QR de verificación" className="mx-auto h-40 w-40" />
            )}
            <p className="break-all font-mono text-[11px] text-gray-500">{lot.lot_hash}</p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              {copyState === 'copied' ? '✓ Copiado' : 'Copiar enlace'}
            </button>
            <a
              href={`/trace/${lot.lot_hash}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 rounded-lg bg-green-800 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-green-900"
            >
              Ver página pública
            </a>
          </div>

          <a
            href={`/api/trace/${lot.lot_hash}/pdf`}
            className="block rounded-lg bg-emerald-800 px-3 py-2.5 text-center text-xs font-semibold text-white hover:bg-emerald-900"
          >
            📄 Descargar Dossier EUDR (PDF)
          </a>
        </div>
      )}
    </div>
  )
}
