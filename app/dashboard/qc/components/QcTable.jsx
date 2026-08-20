'use client'

import { LAYER_LABELS } from '@/lib/eudrQcActions'
import {
  describeTopologyListBadge,
  describeOverlapListBadge,
  describeDeforestationListBadge,
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
// necesitan) — se llena SOLO cuando el usuario corre "Ejecutar Test
// Espacial" para un registro específico desde QcDetailEditor. Nunca se
// valida toda la lista automáticamente al cargar (cada corrida es una
// llamada real a fn_validar_topologia_eudr) — por eso el badge por
// defecto de cada fila es "PENDIENTE" (tono neutro), no un resultado
// inventado.
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

export default function QcTable({ records, selectedKey, onSelect, validationResults, loading, error }) {
  if (loading) return <p className="text-sm text-gray-400">Cargando registros…</p>
  if (error) return <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>
  if (records.length === 0) return <p className="text-sm text-gray-400">Sin registros pendientes en esta capa.</p>

  return (
    <>
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
