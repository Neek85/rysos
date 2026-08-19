'use client'

import { useState } from 'react'
import {
  GisParseError,
  detectFormat,
  parseGeoJsonLayer,
  parseKmlLayer,
  parseShapefileZipLayer,
  autoMatchProperties,
} from '@/lib/gisParser'
import { uploadGeoSpatialBatch, GIS_TARGET_TABLES } from '@/lib/actions/gisActions'

// Modal de carga de capas espaciales para /dashboard/mapa — ver
// specs/gis_ingestor_web.md. Vista previa obligatoria antes de escribir
// (mismo criterio que ImportPadronModal.jsx en /dashboard/socios): el
// archivo se parsea client-side, se muestra fila-por-Feature con los
// campos auto-detectados editables, y nada se sube hasta "Confirmar
// Carga". EUDR_MONITOREO/EUDR_USO_SUELO/EUDR_INSTALACIONES quedan
// PENDIENTE de revisión QGIS QC — no aparecen de inmediato en el mapa
// (que solo muestra APROBADO), aviso explícito en el resumen de carga
// para que no se lea como un bug.

const TARGET_TABLE_LABELS = {
  PADRON_PARCELAS: 'Parcelas (Padrón)',
  EUDR_MONITOREO: 'Monitoreo EUDR (perímetro)',
  EUDR_USO_SUELO: 'Uso de Suelo',
  EUDR_INSTALACIONES: 'Instalaciones',
}

// Campos editables por fila en la vista previa, por tabla destino —
// `required` solo controla si la fila puede confirmarse desde este modal
// (chequeo básico de "no vacío"); la validación real y completa vive del
// lado del servidor (createParcela para PADRON_PARCELAS, o el propio
// insert para las tablas EUDR_*, ver lib/actions/gisActions.js) y se
// reporta fila por fila en el resumen si falla ahí.
const TARGET_TABLE_FIELDS = {
  PADRON_PARCELAS: [
    { key: 'ID_Socio', label: 'Código de Socio', required: true },
    { key: 'parcela_codigo', label: 'Código Interno de Parcela', required: false },
  ],
  EUDR_MONITOREO: [
    { key: 'ID_Socio', label: 'Código de Socio', required: false },
    { key: 'ID_Parcela_Fija', label: 'Código de Parcela', required: false },
  ],
  EUDR_USO_SUELO: [
    { key: 'id_parcela', label: 'Código de Parcela', required: true },
    { key: 'tipo_uso', label: 'Tipo de Uso', required: false },
  ],
  EUDR_INSTALACIONES: [
    { key: 'id_parcela', label: 'Código de Parcela', required: true },
    { key: 'tipo_infra', label: 'Tipo de Infraestructura', required: false },
  ],
}

function rowIsValid(overrides, fields) {
  return fields.every((f) => !f.required || (overrides[f.key] ?? '').toString().trim() !== '')
}

async function parseFile(file) {
  const format = detectFormat(file.name)
  if (format === 'geojson') return parseGeoJsonLayer(await file.text())
  if (format === 'kml') return parseKmlLayer(await file.text())
  // shapefile (.zip)
  return parseShapefileZipLayer(await file.arrayBuffer())
}

export default function CargaEspacialModal({ organizationId, onClose, onUploaded }) {
  const [targetTable, setTargetTable] = useState('EUDR_MONITOREO')
  const [fileName, setFileName] = useState(null)
  const [rows, setRows] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [summary, setSummary] = useState(null)

  const fields = TARGET_TABLE_FIELDS[targetTable]

  function resetFile() {
    setFileName(null)
    setRows(null)
    setParseError(null)
    setSummary(null)
  }

  function handleTargetChange(next) {
    setTargetTable(next)
    resetFile()
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    resetFile()
    setFileName(file.name)
    setParsing(true)
    try {
      const features = await parseFile(file)
      const nextFields = TARGET_TABLE_FIELDS[targetTable]
      const built = features.map((feature, index) => {
        const overrides = autoMatchProperties(feature.properties, targetTable)
        return { index, feature, overrides, valid: rowIsValid(overrides, nextFields) }
      })
      setRows(built)
    } catch (err) {
      setParseError(err instanceof GisParseError ? err.message : err?.message || 'No se pudo leer el archivo.')
    } finally {
      setParsing(false)
    }
  }

  function handleFieldEdit(index, key, value) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.index !== index) return r
        const overrides = { ...r.overrides, [key]: value }
        return { ...r, overrides, valid: rowIsValid(overrides, fields) }
      })
    )
  }

  const validRows = rows?.filter((r) => r.valid) ?? []
  const invalidRows = rows?.filter((r) => !r.valid) ?? []

  async function handleConfirmUpload() {
    if (!organizationId) {
      setParseError(
        'No se pudo determinar la organización activa (no hay registros aprobados cargados en el mapa todavía).'
      )
      return
    }
    setUploading(true)
    const items = validRows.map((r) => ({ feature: r.feature, overrides: r.overrides, index: r.index }))
    const result = await uploadGeoSpatialBatch(targetTable, items, organizationId)
    setUploading(false)
    setSummary(result)
    if (result.failed === 0) {
      onUploaded?.({ ...result, targetTable })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-800">Cargar Capa Espacial</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <label className="mb-1 block text-xs font-semibold text-gray-500">Tabla destino</label>
        <select
          value={targetTable}
          onChange={(e) => handleTargetChange(e.target.value)}
          disabled={parsing || uploading}
          className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
        >
          {GIS_TARGET_TABLES.map((t) => (
            <option key={t} value={t}>
              {TARGET_TABLE_LABELS[t]}
            </option>
          ))}
        </select>

        <p className="mb-3 text-xs text-gray-500">
          Acepta .geojson, .json, .kml o .zip (Shapefile: .shp + .dbf, .prj opcional). GPKG no está soportado
          (ver specs/gis_ingestor_web.md).
          {targetTable !== 'PADRON_PARCELAS' && (
            <>
              {' '}
              Los registros quedan <span className="font-semibold">PENDIENTE</span> de revisión QGIS QC — no
              aparecerán en el mapa hasta ser aprobados.
            </>
          )}
        </p>

        <input
          type="file"
          accept=".geojson,.json,.kml,.zip"
          onChange={handleFileChange}
          disabled={parsing || uploading}
          className="mb-4 block w-full text-xs text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-green-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-green-700 hover:file:bg-green-100 disabled:opacity-50"
        />

        {parsing && <p className="mb-3 text-xs text-gray-500">Leyendo archivo…</p>}
        {parseError && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{parseError}</p>}

        {rows && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {fileName}: <span className="font-semibold text-emerald-700">{validRows.length} lista(s)</span>,{' '}
              <span className="font-semibold text-amber-600">{invalidRows.length} incompleta(s)</span> de{' '}
              {rows.length} feature(s) totales.
            </p>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">#</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Geometría</th>
                    {fields.map((f) => (
                      <th key={f.key} className="px-2 py-1.5 text-left font-semibold text-gray-500">
                        {f.label}
                        {f.required ? ' *' : ''}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={r.index} className={r.valid ? '' : 'bg-amber-50/50'}>
                      <td className="px-2 py-1.5 text-gray-500">{r.index + 1}</td>
                      <td className="px-2 py-1.5 font-mono text-gray-500">{r.feature.geometry.type}</td>
                      {fields.map((f) => (
                        <td key={f.key} className="px-2 py-1.5">
                          <input
                            type="text"
                            value={r.overrides[f.key] || ''}
                            onChange={(e) => handleFieldEdit(r.index, f.key, e.target.value)}
                            placeholder={f.required ? 'Requerido' : '—'}
                            className="w-28 rounded border border-gray-200 px-1.5 py-1 text-xs"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        {r.valid ? (
                          <span className="text-emerald-700">✓ Lista</span>
                        ) : (
                          <span className="text-amber-600">Falta campo requerido</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {summary && (
              <div
                className={`rounded-lg p-2.5 text-sm ${
                  summary.failed === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                }`}
              >
                Carga terminada: {summary.created} creado(s), {summary.failed} con error al guardar.
                {summary.failures.map((f) => (
                  <p key={f.index} className="mt-1 text-xs">
                    Feature {f.index + 1}: {f.message}
                  </p>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={handleConfirmUpload}
                disabled={validRows.length === 0 || uploading}
                className="rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white hover:bg-green-900 disabled:opacity-50"
              >
                {uploading ? 'Cargando…' : `Confirmar carga (${validRows.length} feature(s))`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
