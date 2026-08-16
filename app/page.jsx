'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import nextDynamic from 'next/dynamic'
import { getSupabaseClient } from '@/lib/supabaseClient'
import RiskBadge from '@/components/RiskBadge'

const EUDRMap = nextDynamic(() => import('@/components/EUDRMap'), { ssr: false })

const VIEW_COLUMNS = [
  'id_monitoreo',
  'parcela_codigo',
  'hectareas',
  'estado_revision',
  'riesgo_satelital',
  'geom',
  'lot_hash',
  'ID_Organizacion',
].join(',')

export default function DashboardPage() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function fetchRecords() {
    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('Cliente Supabase no configurado (revisa las variables de entorno).')
      setLoading(false)
      return
    }

    const { data, error: err } = await supabase
      .from('view_eudr_dashboard_aprobados')
      .select(VIEW_COLUMNS)
      .order('parcela_codigo')
    if (err) {
      setError(err.message)
    } else {
      setRecords(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchRecords()

    const supabase = getSupabaseClient()
    if (!supabase) return

    // Realtime: Supabase no soporta suscripción directa a vistas;
    // observamos la tabla subyacente y refrescamos la vista.
    const channel = supabase
      .channel('monitoreo_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'monitoreo_lotes' },
        fetchRecords
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-green-800 text-white px-6 py-4 shadow-md">
        <h1 className="text-xl font-bold tracking-wide">RYZOS — Dashboard EUDR</h1>
        <p className="text-green-200 text-sm mt-0.5">
          Regulación EU 2023/1115 · Trazabilidad Cafetalera
        </p>
      </header>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Visor WebGIS */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-700 mb-3">
            Visor WebGIS — Parcelas Aprobadas
          </h2>
          <EUDRMap records={records} />
          <div className="mt-3 flex gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-400 inline-block" /> CRÍTICO
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-orange-400 inline-block" /> ALTO
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-green-400 inline-block" /> BAJO
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-slate-300 inline-block" /> Sin evaluación
            </span>
          </div>
        </section>

        {/* Tabla de lotes aprobados */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-700">
              Lotes Aprobados
              {!loading && (
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  ({records.length} registros)
                </span>
              )}
            </h2>
          </div>

          {loading && (
            <div className="p-10 text-center text-gray-400 text-sm">
              Cargando datos...
            </div>
          )}

          {!loading && error && (
            <div className="p-4 text-red-600 text-sm bg-red-50 rounded-b-xl">
              Error de conexión: {error}
            </div>
          )}

          {!loading && !error && records.length === 0 && (
            <div className="p-10 text-center text-gray-400 text-sm">
              Sin registros aprobados en esta organización.
            </div>
          )}

          {!loading && !error && records.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Código Parcela
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Hectáreas
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Estado
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Riesgo EUDR
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Hash Lote
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Trazabilidad
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 bg-white">
                  {records.map((r) => (
                    <tr
                      key={r.id_monitoreo}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900">
                        {r.parcela_codigo}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {r.hectareas} ha
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                          {r.estado_revision}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <RiskBadge risk={r.riesgo_satelital} />
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-400 truncate max-w-[140px]">
                        {r.lot_hash ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {r.lot_hash && (
                          <a
                            href={`/trace/${r.lot_hash}`}
                            className="text-xs text-green-700 hover:text-green-900 underline underline-offset-2"
                          >
                            Ver →
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
