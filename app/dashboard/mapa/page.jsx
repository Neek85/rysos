'use client'

export const dynamic = 'force-dynamic'

import nextDynamic from 'next/dynamic'
import EudrStatsWidget from '@/components/gis/EudrStatsWidget'

const MapDashboard = nextDynamic(() => import('@/components/gis/MapDashboard'), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-sm text-gray-400">Cargando mapa…</div>,
})

export default function MapaPage() {
  return (
    <main className="bg-slate-50">
      <header className="bg-green-800 text-white px-6 py-4 shadow-md">
        <h1 className="text-xl font-bold tracking-wide">RYZOS — Mapa WebGIS</h1>
        <p className="text-green-200 text-sm mt-0.5">
          Visor de solo lectura · Parcelas y monitoreos aprobados · vw_monitoreo_web
        </p>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <section className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-base font-semibold text-gray-700 mb-3">
              Visor WebGIS — Registros Aprobados
            </h2>
            <MapDashboard />
          </section>

          <aside className="lg:col-span-1">
            <EudrStatsWidget />
          </aside>
        </div>
      </div>
    </main>
  )
}
