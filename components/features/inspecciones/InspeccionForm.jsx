'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useInspeccionForm } from './useInspeccionForm'
import TabGeneral from './tabs/TabGeneral'
import TabSocio from './tabs/TabSocio'
import TabMic from './tabs/TabMic'
import TabConservacion from './tabs/TabConservacion'
import TabBienestar from './tabs/TabBienestar'
import TabRiesgos from './tabs/TabRiesgos'
import TabGestion from './tabs/TabGestion'
import TabCierre from './tabs/TabCierre'

const TABS = [
  { id: 'general', label: 'Datos Generales', icon: '📋' },
  { id: 'socio', label: 'Datos del Socio', icon: '👤' },
  { id: 'mic', label: 'Manejo del Cultivo', icon: '🌱' },
  { id: 'conservacion', label: 'Conservación', icon: '🌳' },
  { id: 'bienestar', label: 'Bienestar', icon: '🛡️' },
  { id: 'riesgos', label: 'Riesgos', icon: '⚠️' },
  { id: 'gestion', label: 'Gestión', icon: '📊' },
  { id: 'cierre', label: 'Cierre', icon: '📍' },
]

// Puerta de entrada de las 8 pestañas — portado de
// backend-inspecciones/admin-fed/.../InspeccionForm.tsx. `id` llega como
// prop desde la página de ruta (nueva = sin id, editar = con id), en vez
// de leerse con useParams acá, para no acoplar este componente a una
// estructura de rutas específica.
export default function InspeccionForm({ id }) {
  const [activeTab, setActiveTab] = useState('general')
  const { form, isEdit, isLoading, loadError, saving, toast, onSubmit, organizationId } = useInspeccionForm(id)
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isDirty },
  } = form

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-400">Cargando inspección…</div>
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p className="rounded bg-red-50 p-3 text-sm text-red-600">{loadError}</p>
        <Link href="/dashboard/inspecciones" className="text-sm text-green-700 underline underline-offset-2">
          ← Volver al listado
        </Link>
      </div>
    )
  }

  const tabProps = { register, errors, saving, isDirty, isEdit, control, setValue, organizationId }

  return (
    <div className="max-w-6xl space-y-5 p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/inspecciones"
            className="rounded-lg border border-gray-200 px-2 py-2 text-gray-500 hover:bg-gray-50"
          >
            ←
          </Link>
          <h1 className="text-xl font-bold text-gray-800">
            {isEdit ? `Editar Inspección #${id?.slice(0, 8).toUpperCase()}` : 'Nueva Inspección'}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="hidden items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 sm:inline-flex">
              Cambios sin guardar
            </span>
          )}
          <button
            type="button"
            onClick={handleSubmit(onSubmit)}
            disabled={saving || (!isDirty && isEdit)}
            className="rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white hover:bg-green-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar Cambios'}
          </button>
        </div>
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

      <div className="flex flex-col gap-5 lg:flex-row">
        <nav className="shrink-0 lg:w-56">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <p className="border-b border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Módulos
            </p>
            <ul className="space-y-0.5 p-2">
              {TABS.map((tab) => (
                <li key={tab.id}>
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                      activeTab === tab.id ? 'bg-green-800 text-white' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span aria-hidden="true">{tab.icon}</span>
                    <span className="flex-1 truncate">{tab.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            {activeTab === 'general' && <TabGeneral {...tabProps} />}
            {activeTab === 'socio' && <TabSocio {...tabProps} />}
            {activeTab === 'mic' && <TabMic {...tabProps} />}
            {activeTab === 'conservacion' && <TabConservacion {...tabProps} />}
            {activeTab === 'bienestar' && <TabBienestar {...tabProps} />}
            {activeTab === 'riesgos' && <TabRiesgos {...tabProps} />}
            {activeTab === 'gestion' && <TabGestion {...tabProps} />}
            {activeTab === 'cierre' && <TabCierre {...tabProps} setActiveTab={setActiveTab} />}
          </form>
        </div>
      </div>
    </div>
  )
}
