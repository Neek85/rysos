'use client'

import { useState } from 'react'
import {
  parseCsv,
  validateSocioRows,
  validateParcelaRows,
  downloadSocioTemplate,
  downloadParcelaTemplate,
} from '@/lib/padronCsv'
import { createSocio, createParcela } from '@/lib/actions/sociosActions'
import { SocioActionError } from '@/lib/actions/socioActionError'
import { getSupabaseClient } from '@/lib/supabaseClient'

// Modal de carga masiva CSV para /dashboard/socios — con vista previa
// obligatoria antes de confirmar (decisión confirmada con el usuario, ver
// specs/padron_web_socios.md): las Server Actions escriben con la Service
// Role Key (bypasea RLS) sobre el padrón maestro compartido con otro
// repositorio, así que nada se escribe hasta que el usuario revise la
// tabla de válidas/inválidas y confirme explícitamente.
//
// Plantilla: botón "Descargar Plantilla" (downloadSocioTemplate/
// downloadParcelaTemplate en lib/padronCsv.js) — CSV en blanco con
// encabezados legibles y 1 fila de ejemplo. El parser de importación
// acepta tanto esos encabezados legibles como los nombres técnicos de
// columna (ver normalizeRowKeys en lib/padronCsv.js), así que un CSV
// exportado con "Exportar Padrón" también sirve para reimportar.

export default function ImportPadronModal({ organizationId, onClose, onImported }) {
  const [tab, setTab] = useState('socios')
  const [fileName, setFileName] = useState(null)
  const [validated, setValidated] = useState(null)
  const [validating, setValidating] = useState(false)
  const [parseError, setParseError] = useState(null)
  const [committing, setCommitting] = useState(false)
  const [commitSummary, setCommitSummary] = useState(null)

  function resetFile() {
    setFileName(null)
    setValidated(null)
    setParseError(null)
    setCommitSummary(null)
  }

  function handleTabChange(next) {
    setTab(next)
    resetFile()
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    resetFile()
    setFileName(file.name)
    setValidating(true)
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      const supabase = getSupabaseClient()
      // Vista previa contra la BD en tiempo real (2026-08-19, pedido
      // explícito): marca ID_Socio/DNI/códigos ya existentes en la
      // organización activa como inválidos ANTES de "Confirmar
      // Importación", no solo al fallar fila por fila después.
      const result =
        tab === 'socios'
          ? await validateSocioRows(rows, supabase, organizationId)
          : await validateParcelaRows(rows, supabase, organizationId)
      setValidated(result)
    } catch (err) {
      setParseError(err?.message || 'No se pudo leer el archivo CSV.')
    } finally {
      setValidating(false)
    }
  }

  const validRows = validated?.filter((r) => r.valid) ?? []
  const invalidRows = validated?.filter((r) => !r.valid) ?? []

  async function handleConfirmImport() {
    if (!organizationId) {
      setParseError('No se pudo determinar la organización activa.')
      return
    }
    setCommitting(true)
    let created = 0
    const failures = []

    for (const row of validRows) {
      try {
        if (tab === 'socios') {
          await createSocio(row.data, organizationId)
        } else {
          await createParcela(row.data, organizationId, null)
        }
        created += 1
      } catch (err) {
        failures.push({
          index: row.index,
          message: err instanceof SocioActionError ? err.message : err?.message || 'Error desconocido.',
        })
      }
    }

    setCommitting(false)
    setCommitSummary({ created, failed: failures.length, failures })
    if (failures.length === 0) {
      onImported?.({ created, failed: 0 })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-800">Cargar Padrón Masivo (CSV)</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="mb-4 flex gap-1.5">
          {['socios', 'parcelas'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleTabChange(t)}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${
                tab === t ? 'border-green-700 bg-green-800 text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            Acepta encabezados legibles ("Código de Socio", "DNI", …) o técnicos ("ID_Socio", "socio_dni", …).
          </p>
          <button
            type="button"
            onClick={() => {
              const supabase = getSupabaseClient()
              return tab === 'socios'
                ? downloadSocioTemplate(supabase, organizationId)
                : downloadParcelaTemplate(supabase, organizationId)
            }}
            className="whitespace-nowrap rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            ⬇ Descargar Plantilla de {tab === 'socios' ? 'Socios' : 'Parcelas'} (.csv)
          </button>
        </div>

        <input
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          disabled={validating}
          className="mb-4 block w-full text-xs text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-green-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-green-700 hover:file:bg-green-100 disabled:opacity-50"
        />

        {validating && <p className="mb-3 text-xs text-gray-500">Validando contra la base de datos…</p>}

        {parseError && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{parseError}</p>}

        {validated && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {fileName}: <span className="font-semibold text-emerald-700">{validRows.length} válida(s)</span>,{' '}
              <span className="font-semibold text-red-600">{invalidRows.length} con error</span> de{' '}
              {validated.length} fila(s) totales.
            </p>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Fila</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">
                      {tab === 'socios' ? 'ID_Socio' : 'ID_Parcela_Fija'}
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {validated.map((r) => (
                    <tr key={r.index} className={r.valid ? '' : 'bg-red-50/50'}>
                      <td className="px-2 py-1.5 text-gray-500">{r.index + 2}</td>
                      <td className="px-2 py-1.5 font-mono text-gray-700">
                        {r.normalized.ID_Socio || r.normalized.ID_Parcela_Fija || '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.valid ? (
                          <span className="text-emerald-700">✓ Válida</span>
                        ) : (
                          <span className="text-red-600">{r.errors.join('; ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {commitSummary && (
              <div
                className={`rounded-lg p-2.5 text-sm ${
                  commitSummary.failed === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                }`}
              >
                Importación terminada: {commitSummary.created} creado(s), {commitSummary.failed} con error al
                guardar.
                {commitSummary.failures.map((f) => (
                  <p key={f.index} className="mt-1 text-xs">
                    Fila {f.index + 2}: {f.message}
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
                onClick={handleConfirmImport}
                disabled={validRows.length === 0 || committing}
                className="rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white hover:bg-green-900 disabled:opacity-50"
              >
                {committing ? 'Importando…' : `Confirmar importación (${validRows.length} fila(s))`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
