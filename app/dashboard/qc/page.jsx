'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import nextDynamic from 'next/dynamic'
import { getSupabaseClient } from '@/lib/supabaseClient'
import {
  fetchPendingRecords,
  fetchComparisonGeometries,
  resolveOrganizationId,
  LAYER_LABELS,
  EUDRQcError,
} from '@/lib/eudrQcActions'
import {
  approveQcRecord,
  rejectQcRecord,
  updateQcRecordAttributes,
  updateQcRecordGeometry,
} from '@/lib/actions/qcActions'
import { EUDRValidationError } from '@/lib/eudrDdsExporter'
import QcDetailEditor from './components/QcDetailEditor'
import QcTable from './components/QcTable'
import DriveSyncButton from '@/components/gis/DriveSyncButton'
import CargaEspacialModal from './components/CargaEspacialModal'

const QcConsoleMap = nextDynamic(() => import('@/components/gis/QcConsoleMap'), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-sm text-gray-400">Cargando mapa…</div>,
})

const LAYER_FILTERS = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'EUDR_MONITOREO', label: LAYER_LABELS.EUDR_MONITOREO },
  { value: 'EUDR_USO_SUELO', label: LAYER_LABELS.EUDR_USO_SUELO },
  { value: 'EUDR_INSTALACIONES', label: LAYER_LABELS.EUDR_INSTALACIONES },
]

// vw_monitoreo_poligonos/puntos NO traen parcela_codigo/parcela_nombre
// (reverificado en vivo 2026-08-19 — a diferencia de lo que decía este
// comentario antes) — fetchPendingRecords (lib/eudrQcActions.js) las
// resuelve del lado del cliente vía enrichWithParcelaInfo, un JOIN manual
// contra PADRON_PARCELAS por ID_Parcela_Fija, mismo dato que
// vw_monitoreo_web trae con un LEFT JOIN real en SQL (no usable acá
// porque esa vista excluye PENDIENTE estructuralmente).
function displayParcela(record) {
  const codigo = record?.parcela_codigo && record.parcela_codigo !== 'S/C' ? record.parcela_codigo : null
  if (codigo && record?.parcela_nombre) return `${codigo} — ${record.parcela_nombre}`
  if (codigo) return codigo
  return record?.parcela_nombre || 'Parcela sin código'
}

export default function QcConsolePage() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [layerFilter, setLayerFilter] = useState('TODOS')
  const [selectedKey, setSelectedKey] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [actionBusyKey, setActionBusyKey] = useState(null)
  const [toast, setToast] = useState(null)
  const [editingGeometryKey, setEditingGeometryKey] = useState(null)
  const [geometryDraft, setGeometryDraft] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  // Resultados de "Ejecutar Test Espacial" (POST /api/qc/validate-spatial)
  // keyed por record.key — vive acá (no en QcDetailEditor) porque
  // QcTable.jsx también los necesita para el badge de cada fila de la
  // lista, y porque un resultado ya calculado no debe perderse solo
  // porque QcDetailEditor se remonta (key={record.key}) al cambiar de
  // selección. Ver specs/qc_visualization_panel_update.md.
  const [validationResults, setValidationResults] = useState({})
  const [validatingKey, setValidatingKey] = useState(null)
  const [validationError, setValidationError] = useState(null)
  // Capa de comparación de solapamiento (specs/consola_qc_layout_y_validacion.md,
  // addendum solapamiento auditable) — geometrías APROBADAS reales contra
  // las que "Ejecutar Test Espacial" detectó solapamiento para el registro
  // seleccionado. Se limpia al cambiar de registro (ver el efecto de
  // [selectedKey] más abajo), nunca sobrevive apuntando a otra capa.
  const [comparisonFeatures, setComparisonFeatures] = useState([])
  // Exclusión mutua entre "crear registro nuevo" (Editor Vectorial, toolbar
  // de dibujo dentro de QcConsoleMap) y "Ajustar Geometría" (editar un
  // registro existente ya seleccionado) — ver
  // docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md, hallazgo
  // confirmado en vivo: ambos mecanismos podían estar activos a la vez.
  // QcConsoleMap reporta acá cuando hay un dibujo en curso (borrador o
  // capa ya dibujada sin guardar) para deshabilitar el botón "Ajustar
  // Geometría" en QcDetailEditor.jsx — la dirección inversa (editingKey
  // deshabilita el toolbar de dibujo) la maneja QcConsoleMap.jsx
  // directamente contra la API de geoman.
  const [isDrawSessionActive, setIsDrawSessionActive] = useState(false)

  async function loadPending() {
    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('Cliente Supabase no configurado (revisa las variables de entorno).')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPendingRecords(supabase)
      setRecords(data)
    } catch (err) {
      setError(err?.message || 'Error inesperado al consultar registros pendientes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPending()
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  // Cambiar de registro seleccionado descarta cualquier edición de
  // geometría en curso sobre el registro anterior — nunca debe sobrevivir
  // un borrador de vértices "colgado" apuntando a otra capa.
  useEffect(() => {
    setEditingGeometryKey(null)
    setGeometryDraft(null)
    setComparisonFeatures([])
  }, [selectedKey])

  const filteredRecords = useMemo(() => {
    if (layerFilter === 'TODOS') return records
    return records.filter((r) => r.tabla_origen === layerFilter)
  }, [records, layerFilter])

  const selectedRecord = useMemo(
    () => records.find((r) => r.key === selectedKey) || null,
    [records, selectedKey]
  )

  async function handleDecision(kind) {
    if (!selectedRecord || actionBusyKey) return

    setActionBusyKey(selectedRecord.key)
    try {
      const organizationId = resolveOrganizationId(records)
      if (kind === 'approve') {
        await approveQcRecord(selectedRecord, organizationId)
      } else {
        await rejectQcRecord(selectedRecord, motivo, organizationId)
      }

      logQcDecisionAudit(selectedRecord, kind === 'approve' ? 'APROBADO' : 'RECHAZADO', organizationId, motivo)

      setRecords((prev) => prev.filter((r) => r.key !== selectedRecord.key))
      setSelectedKey(null)
      setMotivo('')
      setToast({
        type: 'success',
        message:
          kind === 'approve'
            ? `Registro aprobado: ${displayParcela(selectedRecord)}.`
            : `Registro rechazado: ${displayParcela(selectedRecord)}.`,
      })
    } catch (err) {
      setToast({
        type: 'error',
        message:
          err instanceof EUDRQcError || err instanceof EUDRValidationError
            ? err.message
            : err?.message || 'No se pudo aplicar la decisión.',
      })
    } finally {
      setActionBusyKey(null)
    }
  }

  // Validación topológica bajo demanda (app/api/qc/validate-spatial) — ver
  // specs/qc_topological_eudr_validation.md. Nunca se dispara
  // automáticamente para toda la lista: cada corrida es una llamada real
  // a fn_validar_topologia_eudr, solo cuando el usuario la pide desde
  // QcDetailEditor ("Ejecutar Test Espacial") para el registro
  // seleccionado. También la usa "Validar Todos PENDIENTES" (QcTable.jsx)
  // en modo batch — por eso la capa de comparación de solapamiento (ver
  // fetchComparisonGeometries) solo se calcula cuando `record` es el
  // registro ACTUALMENTE seleccionado, nunca durante un batch sobre
  // registros que el usuario no está mirando en el mapa.
  async function handleValidateTopology(record) {
    setValidationError(null)
    setValidatingKey(record.key)
    try {
      const res = await fetch('/api/qc/validate-spatial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabla_origen: record.tabla_origen, registro_id: record.id_origen }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'No se pudo validar la topología.')
      setValidationResults((prev) => ({ ...prev, [record.key]: data.result }))

      if (record.key === selectedKey) {
        const solapados = data.result?.registros_solapados
        if (data.result?.solapa && solapados?.length > 0) {
          // Fallo acá no debe mostrarse como "no se pudo validar la
          // topología" — la validación en sí ya tuvo éxito (arriba), solo
          // no se pudo dibujar la capa de comparación visual.
          try {
            const supabase = getSupabaseClient()
            if (supabase) {
              const organizationId = resolveOrganizationId(records)
              const comparisons = await fetchComparisonGeometries(supabase, solapados, organizationId)
              setComparisonFeatures(comparisons)
            }
          } catch {
            setComparisonFeatures([])
          }
        } else {
          setComparisonFeatures([])
        }
      }
    } catch (err) {
      setValidationError(err?.message || 'No se pudo validar la topología.')
    } finally {
      setValidatingKey(null)
    }
  }

  // Traza inmutable de la decisión (app/api/qc/audit-log) — ver
  // specs/qc_batch_audit_trail.md. Best-effort, no bloquea la respuesta
  // al usuario si falla (mismo criterio ya aceptado para
  // qc_validation_audit_log en app/api/qc/validate-spatial/route.js) —
  // NO es una transacción atómica con el UPDATE de estado_revision de
  // arriba (eso hubiera exigido reemplazar approveRecord/rejectRecord,
  // ya cubiertos por 8 tests reales tal como están). `detalles` incluye
  // el último resultado de "Ejecutar Test Espacial" para este registro si
  // existe (nunca PII — solo topología/solapamiento/deforestación).
  async function logQcDecisionAudit(record, accion, organizationId, motivoTexto) {
    if (!organizationId) return
    try {
      await fetch('/api/qc/audit-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ID_Organizacion: organizationId,
          accion,
          tabla_origen: record.tabla_origen,
          entidad_id: record.id_origen,
          detalles: {
            validacion: validationResults[record.key] || null,
            motivo: accion === 'RECHAZADO' ? motivoTexto : null,
          },
        }),
      })
    } catch {
      // No-op: la auditoría es best-effort, un fallo acá no debe impedir
      // que la decisión ya aplicada se refleje en la UI.
    }
  }

  function handleSpatialUploaded({ created, targetTable }) {
    setShowUpload(false)
    const pendienteNote = targetTable === 'PADRON_PARCELAS' ? '' : ' Ya aparecen en la lista de pendientes.'
    setToast({ type: 'success', message: `Carga completa: ${created} registro(s) creado(s).${pendienteNote}` })
    loadPending()
  }

  function handleToggleGeometryEdit() {
    if (!selectedRecord) return
    if (editingGeometryKey === selectedRecord.key) {
      setEditingGeometryKey(null)
      setGeometryDraft(null)
    } else {
      setEditingGeometryKey(selectedRecord.key)
      setGeometryDraft(null)
    }
  }

  function handleGeometryChange(key, geometry) {
    if (key === editingGeometryKey) setGeometryDraft(geometry)
  }

  async function handleSaveAttributes(attributes) {
    if (!selectedRecord) return
    const organizationId = resolveOrganizationId(records)
    await updateQcRecordAttributes(selectedRecord, attributes, organizationId)
    setRecords((prev) => prev.map((r) => (r.key === selectedRecord.key ? { ...r, ...attributes } : r)))
    setToast({ type: 'success', message: `Atributos actualizados: ${displayParcela(selectedRecord)}.` })
  }

  async function handleSaveGeometry(geometry) {
    if (!selectedRecord || !geometry) return
    const organizationId = resolveOrganizationId(records)
    await updateQcRecordGeometry(selectedRecord, geometry, organizationId)
    setRecords((prev) => prev.map((r) => (r.key === selectedRecord.key ? { ...r, geom: geometry } : r)))
    setEditingGeometryKey(null)
    setGeometryDraft(null)
    setToast({ type: 'success', message: `Geometría actualizada: ${displayParcela(selectedRecord)}.` })

    // Re-validación topológica automática tras guardar — ver
    // specs/qc_single_record_geometry_editing.md. Cualquier
    // validationResults[key] anterior quedó calculado contra la
    // geometría VIEJA (topología/solapamiento/área ya no reflejan el
    // registro real) — se dispara sin esperar (no bloquea el toast de
    // éxito de arriba); handleValidateTopology ya maneja sus propios
    // errores sin lanzar, así que un fallo acá no rompe nada.
    if (selectedRecord.tabla_origen !== 'EUDR_INSTALACIONES') {
      handleValidateTopology(selectedRecord)
    }
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Consola de Auditoría QC</h1>
          <p className="text-sm text-gray-500">
            Registros pendientes de revisión — vw_monitoreo_poligonos / vw_monitoreo_puntos
          </p>
        </div>
        <div className="flex gap-2">
          <DriveSyncButton onSynced={loadPending} />
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-green-800 px-3 py-1.5 text-xs font-semibold text-green-800 shadow-sm hover:bg-green-50"
          >
            📤 Cargar Capa Espacial
          </button>
        </div>
      </header>

      {showUpload && (
        <CargaEspacialModal
          organizationId={resolveOrganizationId(records)}
          onClose={() => setShowUpload(false)}
          onUploaded={handleSpatialUploaded}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {LAYER_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setLayerFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              layerFilter === f.value
                ? 'bg-green-800 text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f.label}
            {f.value !== 'TODOS' && (
              <span className="ml-1 text-[10px] opacity-70">
                ({records.filter((r) => r.tabla_origen === f.value).length})
              </span>
            )}
          </button>
        ))}
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

      {/* Layout de 3 columnas (lista | mapa | panel de edición fijo) — ver
          specs/consola_qc_layout_y_validacion.md. Antes el panel de edición
          vivía debajo del mapa en la misma columna (grid-cols-4, mapa+panel
          en col-span-3 apilados), obligando a hacer scroll de página para
          llegar a Aprobar/Rechazar al seleccionar un registro. Ahora el
          panel es su propia columna con `sticky` + scroll interno propio
          (`overflow-y-auto`) — la página nunca necesita scrollear para
          llegar a los botones de acción; si el panel es más alto que la
          pantalla, scrollea DENTRO de su propia columna, no la página
          entera. Mismas proporciones relativas que antes (lista 25%, antes
          mapa+panel 75% combinados → ahora mapa 50% + panel 25%). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section className="max-h-[600px] space-y-2 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 lg:col-span-3">
          <QcTable
            records={filteredRecords}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            validationResults={validationResults}
            loading={loading}
            error={error}
            onValidateTopology={handleValidateTopology}
          />
        </section>

        <section className="lg:col-span-6">
          <QcConsoleMap
            records={filteredRecords}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            editingKey={editingGeometryKey}
            onGeometryChange={handleGeometryChange}
            organizationId={resolveOrganizationId(records)}
            onFeatureCreated={loadPending}
            comparisonFeatures={comparisonFeatures}
            onDrawSessionActiveChange={setIsDrawSessionActive}
          />
        </section>

        <section className="lg:col-span-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          {selectedRecord ? (
            <QcDetailEditor
              key={selectedRecord.key}
              record={selectedRecord}
              geometryDraft={geometryDraft}
              isEditingGeometry={editingGeometryKey === selectedRecord.key}
              onToggleGeometryEdit={handleToggleGeometryEdit}
              geometryEditDisabled={isDrawSessionActive && editingGeometryKey !== selectedRecord.key}
              onSaveAttributes={handleSaveAttributes}
              onSaveGeometry={handleSaveGeometry}
              motivo={motivo}
              setMotivo={setMotivo}
              onApprove={() => handleDecision('approve')}
              onReject={() => handleDecision('reject')}
              busy={actionBusyKey === selectedRecord.key}
              validationResult={validationResults[selectedRecord.key]}
              validating={validatingKey === selectedRecord.key}
              validationError={validationError}
              onValidateTopology={handleValidateTopology}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
              Seleccioná un registro de la lista para ver sus detalles.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
