'use client'

import { useEffect, useRef, useState } from 'react'

// Autocompletado genérico de búsqueda contra el padrón (socios/parcelas,
// ver lib/padronSearch.js) — debounce simple, sin dependencias nuevas.
// `search(query)` debe devolver un array de resultados con `key` único;
// `renderResult(r)` decide cómo se muestra cada fila.
export default function PadronAutocomplete({ label, placeholder, search, renderResult, onSelect, disabled }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!query || query.trim().length < 2) {
      setResults([])
      return undefined
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await search(query)
        setResults(data)
        setOpen(true)
      } catch (err) {
        setError(err?.message || 'Error al buscar.')
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <input
        type="text"
        disabled={disabled}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-700 disabled:bg-gray-50 disabled:text-gray-400"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {loading && <p className="mt-1 text-xs text-gray-400">Buscando…</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(r)
                  setQuery('')
                  setResults([])
                  setOpen(false)
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                {renderResult(r)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
