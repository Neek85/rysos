'use client'

import { useEffect, useState } from 'react'
import { formatSyncMessage, summarizeErrorDetail } from '@/lib/driveSyncTrigger'

// Botón "Sincronizar Google Drive" — ver specs/drive_sync_trigger.md.
//
// EN PAUSA (2026-09-09, specs/drive_sync_trigger.md): se quitó su único
// render real (app/dashboard/qc/page.jsx; nunca llegó a renderizarse
// desde /dashboard/mapa, a diferencia de lo que decía este comentario) —
// hasta que exista integración real con la API de Google Drive para una
// organización paga (ver el spec, "Decisivo: drive_root es una ruta de
// filesystem local"). El componente y el Route Handler
// (app/api/gis/sync-drive/route.js) quedan sin uso pero sin borrar, para
// no perder el trabajo si esa integración real se construye después.
//
// INVARIANTE DE ALCANCE: SOLO hace algo útil en desarrollo local con
// RYZOS_DRIVE_ROOT configurada (ver .env.example) — en cualquier entorno
// desplegado, /api/gis/sync-drive responde `available:false` con un
// mensaje explicativo, nunca un error genérico ni un intento de spawn.
//
// `onSynced(summary)` se llama solo tras una sincronización exitosa CON
// paquetes procesados — el caller (QcConsolePage, MapDashboard) lo usa
// para refrescar su propia lista de registros sin que este componente
// necesite conocer esa lógica.
export default function DriveSyncButton({ onSynced, className = '' }) {
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 7000)
    return () => clearTimeout(timer)
  }, [toast])

  async function handleClick() {
    if (loading) return
    setLoading(true)
    setToast(null)
    try {
      const res = await fetch('/api/gis/sync-drive', { method: 'POST' })
      const data = await res.json()

      if (!data.available) {
        setToast({ type: 'info', message: data.message })
      } else if (!data.success) {
        const base = data.message || 'No se pudo sincronizar con Google Drive.'
        // ver ADR-009: antes esto ignoraba data.detail por completo — el
        // toast siempre mostraba el mismo mensaje genérico sin importar
        // la causa real.
        const detailLine = summarizeErrorDetail(data.detail)
        setToast({ type: 'error', message: detailLine ? `${base} ${detailLine}` : base })
      } else {
        setToast({ type: 'success', message: formatSyncMessage(data.summary) })
        if (data.summary?.packages_processed > 0) onSynced?.(data.summary)
      }
    } catch (err) {
      setToast({ type: 'error', message: err?.message || 'No se pudo conectar con el servidor.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`relative inline-flex flex-col items-start gap-1 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg border border-green-800 px-3 py-1.5 text-xs font-semibold text-green-800 shadow-sm hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Sincronizando…
          </>
        ) : (
          <>☁️ Sincronizar Google Drive</>
        )}
      </button>

      {toast && (
        <p
          className={`max-w-xs rounded p-1.5 text-[11px] shadow-sm ${
            toast.type === 'success'
              ? 'bg-emerald-50 text-emerald-700'
              : toast.type === 'error'
                ? 'bg-red-50 text-red-600'
                : 'bg-amber-50 text-amber-700'
          }`}
        >
          {toast.message}
        </p>
      )}
    </div>
  )
}
