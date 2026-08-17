'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import nextDynamic from 'next/dynamic'
import { getSupabaseClient } from '@/lib/supabaseClient'
import {
  fetchPendingRecords,
  approveRecord,
  rejectRecord,
  resolveOrganizationId,
  LAYER_LABELS,
  EUDRQcError,
} from '@/lib/eudrQcActions'
import { EUDRValidationError } from '@/lib/eudrDdsExporter'

const QcConsoleMap = nextDynamic(() => import('@/components/gis/QcConsoleMap'), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-sm text-gray-400">Cargando mapa…</div>,
})

const LAYER_FILTERS = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'EUDR_MONITOREO', label: LAYER_LABELS.EUDR_MONITOREO },
  { value: 'EUDR_USO_SUELO', label: LAYER_LABELS.EUDR_USO_SUELO },
  { value: 'EUDR_INSTALACIONES', label: LAYER_LABELS.EUDR_INSTALACIONES },
]

// Las vistas de auditoría en vivo ya traen parcela_codigo/parcela_nombre
// resueltos (a diferencia de lo documentado en la migración, que asumía
// solo "ID_Parcela_Fija" crudo) — "S/C" es el placeholder real que usa la
// vista cuando la parcela no tiene código cargado, no un UUID a filtrar.
function displayParcela(record) {
  const codigo = record?.parcela_codigo && record.parcela_codigo !== 'S/C' ? record.parcela_codigo : null
  if (codigo && record?.parcela_nombre) return `${codigo} — ${record.parcela_nombre}`
  if (codigo) return codigo
  return record?.parcela_nombre || 'Parcela sin código'
}

export default function QcConsolePage() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [layerFilter, setLayerFilter] = useState('TODOS')
  const [selectedKey, setSelectedKey] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [actionBusyKey, setActionBusyKey] = useState(null)
  const [toast, setToast] = useState(null)

  async function loadPending() {
    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('Cliente Supabase no configurado (revisa las variables de entorno).')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPendingRecords(supabase)
      setRecords(data)
    } catch (err) {
      setError(err?.message || 'Error inesperado al consultar registros pendientes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPending()
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  const filteredRecords = useMemo(() => {
    if (layerFilter === 'TODOS') return records
    return records.filter((r) => r.tabla_origen === layerFilter)
  }, [records, layerFilter])

  const selectedRecord = useMemo(
    () => records.find((r) => r.key === selectedKey) || null,
    [records, selectedKey]
  )

  async function handleDecision(kind) {
    if (!selectedRecord || actionBusyKey) return
    const supabase = getSupabaseClient()
    if (!supabase) return

    setActionBusyKey(selectedRecord.key)
    try {
      const organizationId = resolveOrganizationId(records)
      if (kind === 'approve') {
        await approveRecord(supabase, selectedRecord, organizationId)
      } else {
        await rejectRecord(supabase, selectedRecord, motivo, organizationId)
      }

      setRecords((prev) => prev.filter((r) => r.key !== selectedRecord.key))
      setSelectedKey(null)
      setMotivo('')
      setToast({
        type: 'success',
        message:
          kind === 'approve'
            ? `Registro aprobado: ${displayParcela(selectedRecord)}.`
            : `Registro rechazado: ${displayParcela(selectedRecord)}.`,
      })
    } catch (err) {
      setToast({
        type: 'error',
        message:
          err instanceof EUDRQcError || err instanceof EUDRValidationError
            ? err.message
            : err?.message || 'No se pudo aplicar la decisión.',
      })
    } finally {
      setActionBusyKey(null)
    }
  }

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-xl font-bold text-gray-800">Consola de Auditoría QC</h1>
        <p className="text-sm text-gray-500">
          Registros pendientes de revisión — vw_monitoreo_poligonos / vw_monitoreo_puntos
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {LAYER_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setLayerFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              layerFilter === f.value
                ? 'bg-green-800 text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f.label}
            {f.value !== 'TODOS' && (
              <span className="ml-1 text-[10px] opacity-70">
                ({records.filter((r) => r.tabla_origen === f.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {toast && (
        <p
          className={`rounded p-2 text-sm ${
            toast.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {toast.type === 'success' ? '✓ ' : '⚠ '}
          {toast.message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <section className="max-h-[600px] space-y-2 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 lg:col-span-1">
          {loading && <p className="text-sm text-gray-400">Cargando registros…</p>}
          {!loading && error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
          {!loading && !error && filteredRecords.length === 0 && (
            <p className="text-sm text-gray-400">Sin registros pendientes en esta capa.</p>
          )}
          {filteredRecords.map((record) => (
            <button
              key={record.key}
              type="button"
              onClick={() => setSelectedKey(record.key)}
              className={`w-full rounded-lg border p-2 text-left text-xs ${
                record.key === selectedKey
                  ? 'border-green-700 bg-green-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <p className="font-semibold text-gray-700">
                {LAYER_LABELS[record.tabla_origen] || record.tabla_origen}
              </p>
              <p className="text-gray-500">{displayParcela(record)}</p>
              {record.clasificacion && <p className="text-gray-400">{record.clasificacion}</p>}
            </button>
          ))}
        </section>

        <section className="space-y-3 lg:col-span-3">
          <QcConsoleMap records={filteredRecords} selectedKey={selectedKey} onSelect={setSelectedKey} />

          {selectedRecord && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
              <div>
                <p className="text-sm font-semibold text-gray-700">
                  {LAYER_LABELS[selectedRecord.tabla_origen] || selectedRecord.tabla_origen} —{' '}
                  {displayParcela(selectedRecord)}
                </p>
                {selectedRecord.productor && (
                  <p className="text-xs text-gray-400">Productor: {selectedRecord.productor}</p>
                )}
              </div>

              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Observaciones / motivo (obligatorio para rechazar)"
                className="w-full rounded border border-gray-200 p-2 text-sm"
                rows={2}
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleDecision('approve')}
                  disabled={Boolean(actionBusyKey)}
                  className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionBusyKey === selectedRecord.key ? 'Procesando…' : '✓ Aprobar'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDecision('reject')}
                  disabled={Boolean(actionBusyKey) || !motivo.trim()}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionBusyKey === selectedRecord.key ? 'Procesando…' : '✕ Rechazar'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
