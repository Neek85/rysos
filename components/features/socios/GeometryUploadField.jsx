'use client'

import { useState } from 'react'
import { parseGeometryFile, GeometryImportError } from '@/lib/geometryImport'

// Campo de carga de archivo de geometría (.geojson/.json/.kml/.csv) para
// el modal de Parcela — ver specs/padron_web_socios.md. El parseo ocurre
// en el navegador (feedback inmediato); la sanitización real
// (fn_sanitize_geometry) ocurre server-side al guardar
// (lib/actions/sociosActions.js).
export default function GeometryUploadField({ onGeometryParsed, currentSummary }) {
  const [fileName, setFileName] = useState(null)
  const [error, setError] = useState(null)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setFileName(file.name)
    try {
      const text = await file.text()
      const geometry = parseGeometryFile(file.name, text)
      onGeometryParsed(geometry)
    } catch (err) {
      onGeometryParsed(null)
      setError(err instanceof GeometryImportError ? err.message : 'No se pudo procesar el archivo.')
    }
  }

  return (
    <div className="space-y-1.5">
      <input
        type="file"
        accept=".geojson,.json,.kml,.csv"
        onChange={handleFileChange}
        className="block w-full text-xs text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-green-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-green-700 hover:file:bg-green-100"
      />
      <p className="text-[11px] text-gray-400">Formatos: .geojson, .json, .kml, .csv (columnas lat/lon)</p>
      {fileName && !error && (
        <p className="text-xs text-emerald-700">✓ {fileName} procesado — se sanitizará al guardar.</p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!fileName && currentSummary && <p className="text-xs text-gray-500">Geometría actual: {currentSummary}</p>}
    </div>
  )
}
