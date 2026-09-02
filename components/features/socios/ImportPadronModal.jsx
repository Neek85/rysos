'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  parseCsv,
  validateSocioRows,
  validateParcelaRows,
  downloadSocioTemplate,
  downloadParcelaTemplate,
  decodeCsvBuffer,
  groupValidationErrors,
  DUPLICATE_SKIP_SUFFIX,
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

// `file.text()` decodifica SIEMPRE como UTF-8 -- esa era la causa raíz
// real de "5 columnas no reconocidas, 0/825 filas válidas" en la primera
// carga real (COOP-AROMAS-VALLE, mejoras_importador_padron_masivo.md
// sección 0.a). `decodeCsvBuffer` (lib/padronCsv.js) hace la detección
// UTF-8/windows-1252 real -- acá solo se obtiene el ArrayBuffer del
// navegador, la lógica pura vive en padronCsv.js para ser testeable.
async function readFileAsText(file) {
  return decodeCsvBuffer(await file.arrayBuffer())
}

export default function ImportPadronModal({ organizationId, onClose, onImported }) {
  const [tab, setTab] = useState('socios')
  const [fileName, setFileName] = useState(null)
  const [validated, setValidated] = useState(null)
  const [unrecognizedColumns, setUnrecognizedColumns] = useState([])
  const [hectareWarnings, setHectareWarnings] = useState([])
  const [missingSocioWarnings, setMissingSocioWarnings] = useState([])
  const [validating, setValidating] = useState(false)
  const [parseError, setParseError] = useState(null)
  const [committing, setCommitting] = useState(false)
  const [commitSummary, setCommitSummary] = useState(null)
  // Mejoras importador (spec sección 12.2, ronda 9): avance REAL del loop
  // de confirmación (no una animación genérica) -- se actualiza en cada
  // iteración, ver handleConfirmImport.
  const [commitProgress, setCommitProgress] = useState({ processed: 0, total: 0, created: 0, failed: 0 })
  // Mejoras importador (spec sección 10.2, ronda 7): la tabla fila-por-fila
  // queda detrás de este toggle -- el resumen agrupado de arriba es el
  // triage rápido, la tabla es el detalle bajo demanda.
  const [showAllRows, setShowAllRows] = useState(false)

  function resetFile() {
    setFileName(null)
    setValidated(null)
    setUnrecognizedColumns([])
    setHectareWarnings([])
    setMissingSocioWarnings([])
    setParseError(null)
    setCommitSummary(null)
    setShowAllRows(false)
    setCommitProgress({ processed: 0, total: 0, created: 0, failed: 0 })
  }

  function handleTabChange(next) {
    setTab(next)
    resetFile()
  }

  // Mejoras importador (spec sección 12.3, ronda 9): aviso nativo del
  // navegador si el usuario intenta cerrar/recargar la pestaña mientras
  // el loop de `handleConfirmImport` está en curso -- se activa solo
  // mientras `committing` es true y se desactiva automáticamente al
  // terminar (éxito o error), vía la función de limpieza del propio
  // efecto, sin necesidad de un `removeEventListener` manual aparte.
  useEffect(() => {
    if (!committing) return
    function handleBeforeUnload(e) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [committing])

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    resetFile()
    setFileName(file.name)
    setValidating(true)
    try {
      const text = await readFileAsText(file)
      const rows = parseCsv(text)
      const supabase = getSupabaseClient()
      // Vista previa contra la BD en tiempo real (2026-08-19, pedido
      // explícito): marca ID_Socio/DNI/códigos ya existentes en la
      // organización activa como inválidos ANTES de "Confirmar
      // Importación", no solo al fallar fila por fila después.
      //
      // Mejoras importador (2026-08-31, ronda 3): validateSocioRows/
      // validateParcelaRows devuelven { rows, unrecognizedColumns } --
      // Parcelas además trae hectareWarnings/missingSocioWarnings (mismo
      // patrón de aviso no bloqueante, ver el modal más abajo). Socios no
      // los trae (no aplican) -- valores por defecto [] al destructurar.
      const {
        rows: result,
        unrecognizedColumns: unrecognized,
        hectareWarnings: hectareW = [],
        missingSocioWarnings: missingSocioW = [],
      } =
        tab === 'socios'
          ? await validateSocioRows(rows, supabase, organizationId)
          : await validateParcelaRows(rows, organizationId)
      setValidated(result)
      setUnrecognizedColumns(unrecognized)
      setHectareWarnings(hectareW)
      setMissingSocioWarnings(missingSocioW)
    } catch (err) {
      setParseError(err?.message || 'No se pudo leer el archivo CSV.')
    } finally {
      setValidating(false)
    }
  }

  const validRows = validated?.filter((r) => r.valid) ?? []
  const invalidRows = validated?.filter((r) => !r.valid) ?? []
  // Mejoras importador (spec sección 10.2, ronda 7): agrupa las filas
  // inválidas por el texto exacto del mensaje de error, para el resumen
  // de triage rápido -- ver groupValidationErrors en lib/padronCsv.js.
  const errorGroups = useMemo(
    () => groupValidationErrors(validated ?? [], tab === 'socios' ? 'ID_Socio' : 'ID_Parcela_Fija'),
    [validated, tab]
  )
  // Mejoras importador (spec sección 12.4, ronda 9): separa los grupos de
  // "ya existe, se omite -- esperable al reintentar una carga cortada" de
  // los errores reales de datos, para que se vean claramente distintos en
  // el resumen (bloque informativo aparte, no mezclado con el de errores).
  const duplicateSkipGroups = useMemo(
    () => errorGroups.filter((g) => g.message.includes(DUPLICATE_SKIP_SUFFIX)),
    [errorGroups]
  )
  const dataErrorGroups = useMemo(
    () => errorGroups.filter((g) => !g.message.includes(DUPLICATE_SKIP_SUFFIX)),
    [errorGroups]
  )
  const MAX_CODES_PREVIEW = 10

  async function handleConfirmImport() {
    if (!organizationId) {
      setParseError('No se pudo determinar la organización activa.')
      return
    }
    setCommitting(true)
    const total = validRows.length
    setCommitProgress({ processed: 0, total, created: 0, failed: 0 })
    let created = 0
    const failures = []

    // El loop ya procesaba fila por fila, esperando cada Server Action
    // antes de seguir con la siguiente -- `commitProgress` solo expone ese
    // avance real a la UI (spec sección 12.2), no cambia el orden ni la
    // secuencialidad de las llamadas.
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
      setCommitProgress({ processed: created + failures.length, total, created, failed: failures.length })
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
            Acepta encabezados legibles (&quot;Código de Socio&quot;, &quot;DNI&quot;, …) o técnicos (&quot;ID_Socio&quot;, &quot;socio_dni&quot;, …).
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

        {unrecognizedColumns.length > 0 && (
          <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
            {unrecognizedColumns.length} columna(s) no reconocida(s), fueron ignoradas: {unrecognizedColumns.join(', ')}
          </p>
        )}

        {missingSocioWarnings.length > 0 && (
          <div className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
            <p className="font-semibold">
              {missingSocioWarnings.length} Código(s) de Socio no encontrado(s) en la organización activa:
            </p>
            {missingSocioWarnings.map((w) => (
              <p key={w} className="mt-1 text-xs">
                {w}
              </p>
            ))}
          </div>
        )}

        {hectareWarnings.length > 0 && (
          <div className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
            <p className="font-semibold">
              {hectareWarnings.length} parcela(s) con hectáreas fuera de rango típico (no bloquea la importación):
            </p>
            {hectareWarnings.map((w) => (
              <p key={w} className="mt-1 text-xs">
                {w}
              </p>
            ))}
          </div>
        )}

        {validated && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {fileName}: <span className="font-semibold text-emerald-700">{validRows.length} válida(s)</span>,{' '}
              <span className="font-semibold text-red-600">{invalidRows.length} con error</span> de{' '}
              {validated.length} fila(s) totales.
            </p>

            {duplicateSkipGroups.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                <p className="mb-2 text-xs font-semibold text-blue-700">
                  {duplicateSkipGroups.reduce((sum, g) => sum + g.count, 0)} fila(s) ya cargadas anteriormente — se
                  omiten, no se duplican (esperable si estás reintentando una carga que se cortó a mitad de camino).
                </p>
                <div className="max-h-40 space-y-2 overflow-y-auto">
                  {duplicateSkipGroups.map((g) => (
                    <div key={g.message} className="text-xs">
                      <p className="text-blue-700">
                        <span className="font-semibold">{g.message}</span> ({g.count} fila{g.count === 1 ? '' : 's'})
                      </p>
                      <p className="font-mono text-[11px] text-gray-500">
                        {g.codes.slice(0, MAX_CODES_PREVIEW).join(', ')}
                        {g.codes.length > MAX_CODES_PREVIEW ? ` +${g.codes.length - MAX_CODES_PREVIEW} más` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {dataErrorGroups.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
                <p className="mb-2 text-xs font-semibold text-red-700">
                  Resumen de errores ({dataErrorGroups.length} tipo{dataErrorGroups.length === 1 ? '' : 's'} distinto
                  {dataErrorGroups.length === 1 ? '' : 's'}) — para el detalle fila por fila, usá el botón de abajo.
                </p>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {dataErrorGroups.map((g) => (
                    <div key={g.message} className="text-xs">
                      <p className="text-red-700">
                        <span className="font-semibold">{g.message}</span> ({g.count} fila{g.count === 1 ? '' : 's'})
                      </p>
                      <p className="font-mono text-[11px] text-gray-500">
                        {g.codes.slice(0, MAX_CODES_PREVIEW).join(', ')}
                        {g.codes.length > MAX_CODES_PREVIEW ? ` +${g.codes.length - MAX_CODES_PREVIEW} más` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowAllRows((v) => !v)}
              className="text-xs font-semibold text-gray-500 underline hover:text-gray-700"
            >
              {showAllRows ? 'Ocultar el detalle fila por fila' : `Ver todas las filas (${validated.length})`}
            </button>

            {showAllRows && (
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
            )}

            {committing && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="mb-1.5 text-xs font-semibold text-gray-700">
                  Importando fila {commitProgress.processed} de {commitProgress.total}
                  {commitProgress.total > 0
                    ? ` (${Math.round((commitProgress.processed / commitProgress.total) * 100)}%)`
                    : ''}
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full bg-green-700 transition-all"
                    style={{
                      width: `${commitProgress.total > 0 ? (commitProgress.processed / commitProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-gray-500">
                  <span className="font-semibold text-emerald-700">{commitProgress.created} bien</span> ·{' '}
                  <span className="font-semibold text-red-600">{commitProgress.failed} con error</span> hasta el
                  momento — no cierres ni recargues esta pestaña.
                </p>
              </div>
            )}

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
