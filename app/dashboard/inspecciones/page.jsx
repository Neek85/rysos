'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient'
import { fetchInspecciones } from '@/lib/inspeccionesActions'

const ESTADO_STYLES = {
  'En Proceso': 'bg-amber-50 text-amber-700 border-amber-200',
  Cerrada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Aprobada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Rechazada: 'bg-red-50 text-red-700 border-red-200',
}

function EstadoBadge({ estado }) {
  const label = estado || 'En Proceso'
  const cls = ESTADO_STYLES[label] || 'bg-gray-50 text-gray-600 border-gray-200'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  )
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function InspeccionesPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(15)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        setError('Cliente Supabase no configurado (revisa las variables de entorno).')
        setLoading(false)
        return
      }
      try {
        const { rows: data, total: count, pageSize: size } = await fetchInspecciones(supabase, {
          page,
          search,
        })
        if (cancelled) return
        setRows(data)
        setTotal(count)
        setPageSize(size)
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Error al cargar inspecciones.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [page, search])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Inspecciones</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {total > 0 ? `${total} registro(s) encontrado(s)` : 'Sin registros'}
          </p>
        </div>
        <Link
          href="/dashboard/inspecciones/nueva"
          className="rounded-lg bg-green-800 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-green-900"
        >
          + Nueva Inspección
        </Link>
      </div>

      <input
        type="text"
        className="w-full max-w-sm rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-700"
        placeholder="Buscar por inspector, estado, tipo…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(0)
        }}
      />

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  ID
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Fecha de Visita
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Inspector
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Tipo
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Estado
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Resultado
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                    Cargando…
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-red-600">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-sm text-gray-400">
                    {search ? 'No coincide con tu búsqueda.' : 'Sin inspecciones registradas.'}
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                rows.map((row) => (
                  <tr key={row.ID_Inspeccion} className="hover:bg-gray-50/70">
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500">
                        {row.ID_Inspeccion.slice(0, 8).toUpperCase()}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                      {formatDate(row.Fecha_Visita)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.Inspector || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{row.Tipo_Inspeccion || '—'}</td>
                    <td className="px-4 py-3">
                      <EstadoBadge estado={row.Estado} />
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.Resultado_Global || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/inspecciones/${row.ID_Inspeccion}/editar`}
                        className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
                      >
                        Editar
                      </Link>
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
    </div>
  )
}
