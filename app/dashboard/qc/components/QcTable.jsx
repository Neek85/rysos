'use client'

import { useState } from 'react'
import { LAYER_LABELS } from '@/lib/eudrQcActions'
import {
  describeTopologyListBadge,
  describeOverlapListBadge,
  describeDeforestationListBadge,
  filterBatchValidatableRecords,
} from '@/lib/qcTopologyValidation'

// Lista/tabla de registros PENDIENTE de la Consola QC (/dashboard/qc) —
// extraída de page.jsx en specs/qc_visualization_panel_update.md (antes
// vivía inline ahí, como un simple .map() de botones sin badges; con los
// 3 badges de validación por fila el bloque creció lo suficiente como
// para justificar su propio componente, mismo criterio que ya se aplicó
// para separar QcDetailEditor.jsx).
//
// `validationResults` es un objeto `{ [record.key]: resultado }` que vive
// en page.jsx (no acá, y tampoco en QcConsoleMap — ambos hermanos lo
// necesitan) — se llena cuando el usuario corre "Ejecutar Test Espacial"
// para UN registro desde QcDetailEditor, o "Validar Todos PENDIENTES"
// acá abajo (specs/qc_batch_audit_trail.md) — ambos casos son una acción
// explícita del usuario, nunca se dispara al cargar la página.
const TONE_CLASSES = {
  neutral: 'border border-gray-200 bg-gray-50 text-gray-500',
  ok: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
}

function MiniBadge({ tone, label }) {
  return <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${TONE_CLASSES[tone]}`}>{label}</span>
}

function displayParcela(record) {
  const codigo = record?.parcela_codigo && record.parcela_codigo !== 'S/C' ? record.parcela_codigo : null
  if (codigo && record?.parcela_nombre) return `${codigo} — ${record.parcela_nombre}`
  if (codigo) return codigo
  return record?.parcela_nombre || 'Parcela sin código'
}

export default function QcTable({ records, selectedKey, onSelect, validationResults, loading, error, onValidateTopology }) {
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })

  // "Validar Todos PENDIENTES" — SECUENCIAL a propósito (no
  // Promise.all): cada corrida es una llamada real a
  // fn_validar_topologia_eudr (ST_Overlaps contra todo lo demás APROBADO
  // de la organización) — lanzar todas a la vez multiplicaría la carga
  // sobre Postgres sin necesidad real, y complica reportar progreso.
  // onValidateTopology (mismo handler que usa QcDetailEditor para un solo
  // registro, ver page.jsx::handleValidateTopology) ya atrapa sus propios
  // errores y nunca lanza — un registro que falla no detiene el resto del
  // lote. EUDR_INSTALACIONES se excluye (filterBatchValidatableRecords):
  // el endpoint la rechaza igual (siempre puntual, sin topología de área).
  async function handleValidateAll() {
    const eligible = filterBatchValidatableRecords(records)
    if (eligible.length === 0 || batchRunning) return
    setBatchRunning(true)
    setBatchProgress({ done: 0, total: eligible.length })
    for (const record of eligible) {
      await onValidateTopology(record)
      setBatchProgress((p) => ({ ...p, done: p.done + 1 }))
    }
    setBatchRunning(false)
  }

  if (loading) return <p className="text-sm text-gray-400">Cargando registros…</p>
  if (error) return <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>
  if (records.length === 0) return <p className="text-sm text-gray-400">Sin registros pendientes en esta capa.</p>

  const eligibleCount = filterBatchValidatableRecords(records).length

  return (
    <>
      {eligibleCount > 0 && (
        <div className="mb-1 space-y-1">
          <button
            type="button"
            onClick={handleValidateAll}
            disabled={batchRunning}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {batchRunning
              ? `Validando… ${batchProgress.done}/${batchProgress.total}`
              : `Validar Todos PENDIENTES (${eligibleCount})`}
          </button>
          {batchRunning && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full bg-green-700 transition-all"
                style={{ width: `${(batchProgress.done / Math.max(batchProgress.total, 1)) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {records.map((record) => {
        const result = validationResults?.[record.key]
        const topologia = describeTopologyListBadge(result)
        const solapamiento = describeOverlapListBadge(result)
        const deforestacion = describeDeforestationListBadge(result)

        return (
          <button
            key={record.key}
            type="button"
            onClick={() => onSelect(record.key)}
            className={`w-full rounded-lg border p-2 text-left text-xs ${
              record.key === selectedKey ? 'border-green-700 bg-green-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <p className="font-semibold text-gray-700">{LAYER_LABELS[record.tabla_origen] || record.tabla_origen}</p>
            <p className="text-gray-500">{displayParcela(record)}</p>
            {record.clasificacion && <p className="text-gray-400">{record.clasificacion}</p>}
            <div className="mt-1.5 flex flex-wrap gap-1">
              <MiniBadge tone={topologia.tone} label={topologia.label} />
              <MiniBadge tone={solapamiento.tone} label={solapamiento.label} />
              <MiniBadge tone={deforestacion.tone} label={deforestacion.label} />
            </div>
          </button>
        )
      })}
    </>
  )
}
