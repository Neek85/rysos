'use client'

// Modal de confirmación genérico — usado para las bajas lógicas de
// Socio/Parcela en /dashboard/socios (y reutilizable para cualquier
// acción destructiva/irreversible futura). z-index por encima del modal
// padre (z-50) para que quede siempre visible arriba.
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
  danger = true,
  loading = false,
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-green-800 hover:bg-green-900'
            }`}
          >
            {loading ? 'Procesando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
