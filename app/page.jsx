'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import nextDynamic from 'next/dynamic'
import { getSupabaseClient } from '@/lib/supabaseClient'

const EUDRMap = nextDynamic(() => import('@/components/EUDRMap'), { ssr: false })

// INVARIANTE (fix 2026-08-18): esta lista pedía `hectareas`,
// `riesgo_satelital` y `lot_hash` — ninguna existe en
// view_eudr_dashboard_aprobados (confirmado en vivo: error real
// "column view_eudr_dashboard_aprobados.hectareas does not exist").
// `hectareas_totales` es la columna real (PADRON_PARCELAS.totalh).
// `riesgo_satelital` nunca se calculó ni persistió en ningún lado de
// este schema — no hay fuente de datos, se removió del todo (no solo
// del SELECT) en vez de dejar una columna de UI permanentemente vacía.
// `lot_hash` es un concepto agregado POR ORGANIZACIÓN, no por
// parcela/fila, y por diseño nunca se persiste (siempre se recalcula,
// ver specs/trace_public_audit.md) — no tiene sentido como columna de
// esta tabla; el enlace a trazabilidad pública vive en /dashboard/lotes.
// `geom_geojson` (nueva, supabase/migrations/20260818_fix_dashboard_view_columns.sql)
// reemplaza `geom` crudo: PostgREST serializa `geometry` como WKB hex,
// no GeoJSON — components/EUDRMap.jsx hacía JSON.parse(record.geom)
// directo, que fallaba silenciosamente para cada fila.
const VIEW_COLUMNS = [
  'id_monitoreo',
  'parcela_codigo',
  'hectareas_totales',
  'estado_revision',
  'geom_geojson',
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
    // observamos la tabla subyacente (EUDR_MONITOREO, de donde sale esta
    // vista) y refrescamos. Antes apuntaba a `monitoreo_lotes`, una tabla
    // que no existe en este schema — la suscripción nunca disparaba.
    const channel = supabase
      .channel('monitoreo_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'EUDR_MONITOREO' },
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
            <a
              href="/dashboard/lotes"
              className="text-xs text-green-700 hover:text-green-900 underline underline-offset-2"
            >
              Ver trazabilidad pública →
            </a>
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
                        {r.hectareas_totales} ha
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                          {r.estado_revision}
                        </span>
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
