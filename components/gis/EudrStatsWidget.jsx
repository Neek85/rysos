'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabaseClient'

// INVARIANTE: cumple_eudr solo existe en EUDR_MONITOREO; las filas de
// EUDR_USO_SUELO/EUDR_INSTALACIONES traen NULL en esta columna (ver
// supabase/migrations/20260816_fase2_vistas_qc.sql). El % de cumplimiento se
// calcula sobre las filas donde el campo aplica, no sobre el total de la
// vista, para no diluir el porcentaje con filas donde la pregunta ni
// corresponde.
const SELECT_COLUMNS = 'estado_revision,cumple_eudr,observaciones'

const STAT_ACCENTS = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-100' },
  green: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-100' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-100' },
}

function StatCard({ label, value, hint, accent = 'blue' }) {
  const cfg = STAT_ACCENTS[accent] ?? STAT_ACCENTS.blue
  return (
    <div className={`rounded-lg p-4 ring-1 ${cfg.bg} ${cfg.ring}`}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${cfg.text}`}>{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

function computeStats(records) {
  const total = records.length

  const conCampoCumpleEudr = records.filter(
    (r) => r.cumple_eudr === 'SI' || r.cumple_eudr === 'NO'
  )
  const cumplen = conCampoCumpleEudr.filter((r) => r.cumple_eudr === 'SI').length
  const porcentajeCumplimiento =
    conCampoCumpleEudr.length > 0 ? Math.round((cumplen / conCampoCumpleEudr.length) * 100) : null

  const conObservaciones = records.filter(
    (r) => typeof r.observaciones === 'string' && r.observaciones.trim() !== ''
  ).length

  return {
    total,
    cumplen,
    evaluados: conCampoCumpleEudr.length,
    porcentajeCumplimiento,
    conObservaciones,
  }
}

export default function EudrStatsWidget() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function fetchStats() {
      const supabase = getSupabaseClient()
      if (!supabase) {
        setError('Cliente Supabase no configurado (revisa las variables de entorno).')
        setLoading(false)
        return
      }

      const { data, error: err } = await supabase.from('vw_monitoreo_web').select(SELECT_COLUMNS)

      if (cancelled) return
      if (err) {
        setError(err.message)
      } else {
        setStats(computeStats(data ?? []))
      }
      setLoading(false)
    }

    fetchStats()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-3">
      <h2 className="text-base font-semibold text-gray-700">Métricas EUDR</h2>

      {loading && <p className="text-sm text-gray-400">Calculando métricas…</p>}

      {!loading && error && (
        <p className="text-sm text-red-600 bg-red-50 rounded p-2">Error de conexión: {error}</p>
      )}

      {!loading && !error && stats && (
        <div className="space-y-3">
          <StatCard
            label="Registros Auditados"
            value={stats.total}
            hint="Aprobados en vw_monitoreo_web"
            accent="blue"
          />
          <StatCard
            label="Cumplimiento EUDR"
            value={
              stats.porcentajeCumplimiento === null ? '—' : `${stats.porcentajeCumplimiento}%`
            }
            hint={
              stats.evaluados > 0
                ? `${stats.cumplen} de ${stats.evaluados} monitoreos`
                : 'Sin monitoreos evaluados'
            }
            accent="green"
          />
          <StatCard
            label="Con Observaciones"
            value={stats.conObservaciones}
            hint="Pendientes de subsanar / revisar"
            accent="amber"
          />
        </div>
      )}
    </div>
  )
}
