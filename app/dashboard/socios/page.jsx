'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { fetchSocios, resolveActiveOrganizationId } from '@/lib/sociosSearch'
import { CERT_FLAG_FIELDS } from '@/lib/validations/socios'
import SocioFormModal from '@/components/features/socios/SocioFormModal'
import ParcelaFormModal from '@/components/features/socios/ParcelaFormModal'

export default function SociosPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(15)

  const [certOrgEstatus, setCertOrgEstatus] = useState('')
  const [certFlags, setCertFlags] = useState([])
  const [departamento, setDepartamento] = useState('')

  const [editingSocio, setEditingSocio] = useState(null)
  const [showNewSocio, setShowNewSocio] = useState(false)
  const [parcelasSocio, setParcelasSocio] = useState(null)
  const [toast, setToast] = useState(null)

  const organizationId = resolveActiveOrganizationId(rows)

  async function load() {
    setLoading(true)
    setError(null)
    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('Cliente Supabase no configurado (revisa las variables de entorno).')
      setLoading(false)
      return
    }
    try {
      const { rows: data, total: count, pageSize: size } = await fetchSocios(supabase, {
        page,
        search,
        filters: { certOrgEstatus, certFlags, departamento },
      })
      setRows(data)
      setTotal(count)
      setPageSize(size)
    } catch (err) {
      setError(err?.message || 'Error al cargar el padrón de socios.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, certOrgEstatus, certFlags, departamento])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  function toggleCertFlag(field) {
    setPage(0)
    setCertFlags((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]))
  }

  function handleSocioSaved(result) {
    setShowNewSocio(false)
    setEditingSocio(null)
    setToast({ type: 'success', message: result.created ? 'Socio creado correctamente.' : 'Socio actualizado.' })
    load()
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Padrón de Socios y Fincas</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {total > 0 ? `${total} socio(s) encontrado(s)` : 'Sin registros'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewSocio(true)}
          className="rounded-lg bg-green-800 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-green-900"
        >
          + Nuevo Socio
        </button>
      </div>

      {toast && (
        <div
          className={`rounded-lg p-2.5 text-sm ${
            toast.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          className="w-full max-w-sm rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-700"
          placeholder="Buscar por nombre, DNI o código…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
        />
        <input
          type="text"
          className="w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-700"
          placeholder="Estatus certificación"
          value={certOrgEstatus}
          onChange={(e) => {
            setCertOrgEstatus(e.target.value)
            setPage(0)
          }}
        />
        <input
          type="text"
          className="w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-700"
          placeholder="Departamento"
          value={departamento}
          onChange={(e) => {
            setDepartamento(e.target.value)
            setPage(0)
          }}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CERT_FLAG_FIELDS.map(({ field, label }) => (
          <button
            key={field}
            type="button"
            onClick={() => toggleCertFlag(field)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              certFlags.includes(field)
                ? 'border-green-700 bg-green-800 text-white'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Código</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Nombre</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">DNI</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Departamento
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Certificación
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                    Cargando…
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-red-600">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-sm text-gray-400">
                    {search ? 'No coincide con tu búsqueda.' : 'Sin socios registrados.'}
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                rows.map((row) => (
                  <tr key={row.ID_Socio} className="hover:bg-gray-50/70">
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500">
                        {row.ID_Socio}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.socio_nombre_completo || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{row.socio_dni || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{row.socio_departamento || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{row.cert_org_estatus || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setParcelasSocio(row)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                          Parcelas
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSocio(row)}
                          className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
                        >
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-4 py-3">
            <p className="text-xs text-gray-500">
              Página {page + 1} de {totalPages} · {total} registros
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-gray-200 px-2 py-1 text-gray-500 disabled:opacity-40"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-lg border border-gray-200 px-2 py-1 text-gray-500 disabled:opacity-40"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>

      {showNewSocio && (
        <SocioFormModal
          socio={null}
          organizationId={organizationId}
          onClose={() => setShowNewSocio(false)}
          onSaved={handleSocioSaved}
        />
      )}
      {editingSocio && (
        <SocioFormModal
          socio={editingSocio}
          organizationId={organizationId}
          onClose={() => setEditingSocio(null)}
          onSaved={handleSocioSaved}
        />
      )}
      {parcelasSocio && (
        <ParcelaFormModal socio={parcelasSocio} organizationId={organizationId} onClose={() => setParcelasSocio(null)} />
      )}
    </div>
  )
}
