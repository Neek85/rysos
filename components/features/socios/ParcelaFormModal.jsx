'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, inputClass } from '@/components/ui/FormField'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { parcelaSchema, PARCELA_DEFAULT_VALUES, HECTARE_FIELD_KEYS, HECTARE_FIELDS } from '@/lib/validations/socios'
import { fetchParcelasBySocio } from '@/lib/sociosSearch'
import { createParcela, updateParcela, deactivateParcela } from '@/lib/actions/sociosActions'
import { SocioActionError } from '@/lib/actions/socioActionError'
import { computeNextParcelaCode, computeSuggestedParcelaId } from '@/lib/parcelaDefaults'
import GeometryUploadField from './GeometryUploadField'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

function ParcelaForm({ socioId, organizationId, parcela, existingParcelas, onSaved, onCancel }) {
  const isEdit = Boolean(parcela)
  const [geometry, setGeometry] = useState(null)

  // Correlativo automático + ID de Parcela sugerido (solo al crear una
  // parcela nueva — en edición se usan los valores reales existentes).
  // Son solo un punto de partida editable, no un valor forzado.
  const suggestedCode = isEdit ? '' : computeNextParcelaCode(existingParcelas)
  const suggestedId = isEdit ? '' : computeSuggestedParcelaId(socioId, suggestedCode)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    watch,
  } = useForm({
    resolver: zodResolver(parcelaSchema),
    defaultValues: parcela
      ? { ...PARCELA_DEFAULT_VALUES, ...parcela }
      : { ...PARCELA_DEFAULT_VALUES, ID_Socio: socioId, ID_Parcela_Fija: suggestedId, parcela_codigo: suggestedCode },
  })

  const watched = watch(HECTARE_FIELD_KEYS)
  const totalPreview = watched.reduce((acc, v) => acc + (Number(v) || 0), 0)

  async function onSubmit(values) {
    try {
      const result = isEdit
        ? await updateParcela(values, organizationId, geometry)
        : await createParcela(values, organizationId, geometry)
      onSaved(result)
    } catch (err) {
      setError('root', {
        message: err instanceof SocioActionError ? err.message : err?.message || 'Error al guardar la parcela.',
      })
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/50 p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="ID de Parcela" required error={errors.ID_Parcela_Fija?.message}>
          {/* Siempre de solo lectura: se autogenera como
              [CODIGO_SOCIO]-[CORRELATIVO] (lib/parcelaDefaults.js) al crear,
              y nunca es editable en edición tampoco — es la PK del registro. */}
          <input
            type="text"
            readOnly
            disabled
            className={`${inputClass(errors.ID_Parcela_Fija)} disabled:bg-gray-100 disabled:text-gray-400`}
            {...register('ID_Parcela_Fija')}
          />
        </FormField>
        <FormField label="Código de Parcela">
          <input type="text" className={inputClass(false)} {...register('parcela_codigo')} />
        </FormField>
      </div>

      <FormField label="Nombre de la Parcela">
        <input type="text" className={inputClass(false)} {...register('parcela_nombre')} />
      </FormField>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {HECTARE_FIELDS.map(({ field, label }) => (
          <FormField key={field} label={label} error={errors[field]?.message}>
            <input
              type="number"
              step="any"
              min="0"
              className={inputClass(errors[field])}
              {...register(field)}
            />
          </FormField>
        ))}
      </div>
      <p className={`text-xs ${totalPreview <= 0 ? 'text-red-500' : 'text-gray-500'}`}>
        Total calculado:{' '}
        <span className={`font-semibold ${totalPreview <= 0 ? 'text-red-600' : 'text-gray-700'}`}>
          {totalPreview.toFixed(2)} ha
        </span>
        {totalPreview <= 0 && ' — debe ser mayor a 0.00 ha para guardar.'}
      </p>

      <GeometryUploadField
        onGeometryParsed={setGeometry}
        currentSummary={parcela?.geom ? 'ya registrada (se conserva si no subís un archivo nuevo)' : null}
      />

      {errors.root && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{errors.root.message}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-white"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-green-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-900 disabled:opacity-50"
        >
          {isSubmitting ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Agregar parcela'}
        </button>
      </div>
    </form>
  )
}

export default function ParcelaFormModal({ socio, organizationId, onClose }) {
  const [parcelas, setParcelas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingParcela, setEditingParcela] = useState(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [parcelaToDeactivate, setParcelaToDeactivate] = useState(null)
  const [deactivating, setDeactivating] = useState(false)
  const [actionError, setActionError] = useState(null)

  async function reload() {
    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('Cliente Supabase no configurado.')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const rows = await fetchParcelasBySocio(supabase, socio.ID_Socio)
      setParcelas(rows)
    } catch (err) {
      setError(err?.message || 'Error al cargar parcelas.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    reload()
    return () => {
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socio.ID_Socio])

  function handleSaved() {
    setEditingParcela(null)
    setShowNewForm(false)
    reload()
  }

  async function handleConfirmDeactivate() {
    if (!parcelaToDeactivate) return
    setDeactivating(true)
    setActionError(null)
    try {
      await deactivateParcela(parcelaToDeactivate.ID_Parcela_Fija, socio.ID_Socio, organizationId)
      setParcelaToDeactivate(null)
      reload()
    } catch (err) {
      setActionError(err instanceof SocioActionError ? err.message : err?.message || 'Error al dar de baja la parcela.')
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-800">Parcelas de {socio.socio_nombre_completo}</h2>
            <p className="text-xs text-gray-500">{socio.ID_Socio}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {loading && <p className="text-sm text-gray-400">Cargando parcelas…</p>}
        {!loading && error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        {actionError && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{actionError}</p>}

        {!loading && !error && (
          <div className="space-y-3">
            {parcelas.length === 0 && !showNewForm && (
              <p className="text-sm text-gray-400">Sin parcelas registradas todavía.</p>
            )}

            {parcelas.map((p) =>
              editingParcela?.ID_Parcela_Fija === p.ID_Parcela_Fija ? (
                <ParcelaForm
                  key={p.ID_Parcela_Fija}
                  socioId={socio.ID_Socio}
                  organizationId={organizationId}
                  parcela={p}
                  onSaved={handleSaved}
                  onCancel={() => setEditingParcela(null)}
                />
              ) : (
                <div
                  key={p.ID_Parcela_Fija}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {p.parcela_codigo || p.ID_Parcela_Fija} — {p.parcela_nombre || 'Sin nombre'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {p.totalh ?? 0} ha · {p.geom ? 'Con geometría' : 'Sin geometría'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingParcela(p)}
                      className="rounded-lg border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-100"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setParcelaToDeactivate(p)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      Dar de baja
                    </button>
                  </div>
                </div>
              )
            )}

            {showNewForm ? (
              <ParcelaForm
                socioId={socio.ID_Socio}
                organizationId={organizationId}
                existingParcelas={parcelas}
                onSaved={handleSaved}
                onCancel={() => setShowNewForm(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowNewForm(true)}
                className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm font-medium text-gray-500 hover:border-green-300 hover:text-green-700"
              >
                + Agregar parcela
              </button>
            )}
          </div>
        )}
      </div>

      {parcelaToDeactivate && (
        <ConfirmDialog
          title="Dar de baja la parcela"
          message={`¿Confirmás dar de baja la parcela ${parcelaToDeactivate.parcela_codigo || parcelaToDeactivate.ID_Parcela_Fija}? Deja de aparecer en el padrón activo, pero el registro se conserva (no se elimina físicamente).`}
          confirmLabel="Dar de baja"
          loading={deactivating}
          onConfirm={handleConfirmDeactivate}
          onCancel={() => setParcelaToDeactivate(null)}
        />
      )}
    </div>
  )
}
