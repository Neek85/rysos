'use client'

// Editor Vectorial WebGIS para /dashboard/mapa — dibujar/editar
// Polígonos y Puntos directo sobre la capa satelital vía
// @geoman-io/leaflet-geoman-free (imperativo, mismo patrón que el resto
// de components/gis/MapDashboard.jsx: import dinámico dentro de un
// useEffect, nunca react-leaflet). Ver specs/gis_vector_editor.md.
//
// Dos piezas en este archivo (las funciones puras de cálculo de área/
// auto-intersección viven en lib/gisVectorEditor.js — separadas porque
// node --test no puede parsear JSX, ver tests/test_gis_editor.mjs):
// 1. attachVectorEditor — engancha los controles de geoman a un mapa ya
//    creado y traduce sus eventos a callbacks planos.
// 2. useVectorEditor + VectorEditorPanel (export default) — hook + panel
//    lateral que consumen lib/gisVectorEditor.js para el flujo de guardado.

import { useCallback, useEffect, useState } from 'react'
import { uploadGeoSpatialFeature } from '@/lib/actions/gisActions'
import {
  TARGET_TABLE_LABELS,
  TARGET_TABLE_FIELDS,
  TARGET_TABLE_GEOMETRY_TYPES,
  GIS_TARGET_TABLES,
} from '@/lib/gisTargetTables'
import { evaluateGeometry, isGeometryAllowedForTable } from '@/lib/gisVectorEditor'

// ---------------------------------------------------------------
// attachVectorEditor — capa imperativa sobre geoman
// ---------------------------------------------------------------

/**
 * Agrega los controles de dibujo/edición de geoman a un mapa ya creado.
 * Solo Polígono + Marcador + Editar + Arrastrar + Eliminar (nada de
 * círculo/rectángulo/polilínea/texto/rotar/cortar — fuera de alcance, ver
 * spec). `onDraftChange(evaluateGeometry(...) | null)`: se dispara en
 * cada vértice agregado durante el dibujo y tras cada edición/arrastre —
 * es lo que alimenta el área/validación en vivo del panel. `onFinalize(layer)`:
 * se dispara una sola vez, cuando geoman termina una geometría nueva
 * (`pm:create` — doble clic para cerrar un polígono, o clic simple para
 * un marcador).
 *
 * Devuelve una función de limpieza (quita los controles y los listeners),
 * pensada para el `return` de un `useEffect`.
 */
export function attachVectorEditor(map, L, { onDraftChange, onFinalize } = {}) {
  // Localización a español de los tooltips de geoman ("Draw Polygons" ->
  // "Dibujar Polígonos", etc.) — 'es' viene empaquetado en
  // @geoman-io/leaflet-geoman-free, no hace falta un diccionario propio.
  // L.PM.activeLang es un estado global del módulo (no por instancia de
  // mapa), así que basta con llamarlo una vez por carga de página; se deja
  // acá (en vez de en MapDashboard.jsx) porque este es el único lugar que
  // agrega un toolbar visible con esos textos.
  map.pm.setLang('es')
  map.pm.setGlobalOptions({ allowSelfIntersection: false, snappable: true })
  map.pm.addControls({
    position: 'topleft',
    drawMarker: true,
    drawPolygon: true,
    drawPolyline: false,
    drawCircle: false,
    drawCircleMarker: false,
    drawRectangle: false,
    drawText: false,
    editMode: true,
    dragMode: true,
    cutPolygon: false,
    removalMode: true,
    rotateMode: false,
  })

  function evaluateLayer(layer) {
    if (!layer?.toGeoJSON) return
    onDraftChange?.(evaluateGeometry(layer.toGeoJSON().geometry))
  }

  // Vértice agregado mientras se dibuja (antes de terminar) — geoman
  // entrega la capa "de trabajo" en construcción vía e.workingLayer.
  function handleVertexAdded(e) {
    evaluateLayer(e.workingLayer)
  }

  function handleCreate(e) {
    evaluateLayer(e.layer)
    e.layer.on('pm:edit', () => evaluateLayer(e.layer))
    e.layer.on('pm:markerdragend', () => evaluateLayer(e.layer))
    onFinalize?.(e.layer)
  }

  function handleRemove() {
    onDraftChange?.(null)
  }

  map.on('pm:vertexadded', handleVertexAdded)
  map.on('pm:create', handleCreate)
  map.on('pm:remove', handleRemove)

  return function detach() {
    map.off('pm:vertexadded', handleVertexAdded)
    map.off('pm:create', handleCreate)
    map.off('pm:remove', handleRemove)
    map.pm.removeControls()
  }
}

// ---------------------------------------------------------------
// useVectorEditor — hook de estado React sobre attachVectorEditor
// ---------------------------------------------------------------

/**
 * `mapRef`/`leafletRef`: mismos refs que ya mantiene MapDashboard.jsx
 * (`mapRef.current` = instancia `L.Map`, `leafletRef.current` = módulo
 * `L`). `mapReady`: true una vez que el init() de MapDashboard.jsx
 * terminó — el efecto de acá espera a que sea true para enganchar geoman
 * (no puede hacerlo antes de que exista `map.pm`, agregado por el propio
 * import de geoman en MapDashboard.jsx). `organizationId`: resuelta por
 * el llamador (mismo `resolveOrganizationId(records)` que ya usa
 * `handleExportDDS`).
 */
export function useVectorEditor({ mapRef, leafletRef, mapReady, organizationId }) {
  const [targetTable, setTargetTable] = useState('EUDR_MONITOREO')
  const [draft, setDraft] = useState(null) // { areaHa, selfIntersects } | null
  const [drawnLayer, setDrawnLayer] = useState(null)
  const [fieldValues, setFieldValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null) // { type: 'success' | 'error', message }

  useEffect(() => {
    if (!mapReady || !mapRef.current || !leafletRef.current) return undefined
    return attachVectorEditor(mapRef.current, leafletRef.current, {
      onDraftChange: setDraft,
      onFinalize: (layer) => {
        setDrawnLayer(layer)
        setFieldValues({})
        setResult(null)
      },
    })
    // mapRef/leafletRef son refs estables — solo re-engancha si mapReady cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady])

  const handleCancel = useCallback(() => {
    drawnLayer?.remove()
    setDrawnLayer(null)
    setDraft(null)
    setResult(null)
  }, [drawnLayer])

  const handleSave = useCallback(async () => {
    if (!drawnLayer) return
    const geometry = drawnLayer.toGeoJSON().geometry
    if (!organizationId) {
      setResult({ type: 'error', message: 'No se pudo determinar la organización activa.' })
      return
    }
    if (!isGeometryAllowedForTable(geometry, targetTable)) {
      const allowed = (TARGET_TABLE_GEOMETRY_TYPES[targetTable] || []).join(' o ')
      setResult({
        type: 'error',
        message: `${TARGET_TABLE_LABELS[targetTable]} solo acepta geometría ${allowed} — dibujaste un ${geometry.type}. Cambia la tabla destino o dibuja de nuevo.`,
      })
      return
    }
    const { selfIntersects } = evaluateGeometry(geometry)
    if (selfIntersects) {
      setResult({ type: 'error', message: 'El polígono tiene auto-intersecciones — corrígelo antes de guardar.' })
      return
    }
    const fields = TARGET_TABLE_FIELDS[targetTable]
    const missing = fields.find((f) => f.required && !(fieldValues[f.key] || '').toString().trim())
    if (missing) {
      setResult({ type: 'error', message: `Falta "${missing.label}".` })
      return
    }

    setSaving(true)
    try {
      await uploadGeoSpatialFeature(targetTable, { geometry, properties: {} }, organizationId, fieldValues)
      const pendienteNote =
        targetTable === 'PADRON_PARCELAS' ? '' : ' Queda PENDIENTE de revisión en QGIS QC.'
      setResult({ type: 'success', message: `Geometría guardada correctamente.${pendienteNote}` })
      drawnLayer.remove()
      setDrawnLayer(null)
      setDraft(null)
    } catch (err) {
      setResult({ type: 'error', message: err?.message || 'No se pudo guardar la geometría.' })
    } finally {
      setSaving(false)
    }
  }, [drawnLayer, organizationId, targetTable, fieldValues])

  return {
    targetTable,
    setTargetTable,
    draft,
    drawnLayer,
    fieldValues,
    setFieldValues,
    saving,
    result,
    handleSave,
    handleCancel,
  }
}

// ---------------------------------------------------------------
// VectorEditorPanel — panel lateral compacto (no un modal de pantalla
// completa: el mapa debe seguir visible para comparar contra la imagen
// satelital mientras se dibuja).
// ---------------------------------------------------------------

export default function VectorEditorPanel({ editor }) {
  const { targetTable, setTargetTable, draft, drawnLayer, fieldValues, setFieldValues, saving, result, handleSave, handleCancel } =
    editor
  const fields = TARGET_TABLE_FIELDS[targetTable]
  const allowedTypes = (TARGET_TABLE_GEOMETRY_TYPES[targetTable] || []).join(' o ')

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-xs">
      <p className="font-semibold text-gray-700">✏️ Editor Vectorial</p>

      <div>
        <label className="mb-1 block text-[11px] font-semibold text-gray-500">Tabla destino</label>
        <select
          value={targetTable}
          onChange={(e) => setTargetTable(e.target.value)}
          className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-700"
        >
          {GIS_TARGET_TABLES.map((t) => (
            <option key={t} value={t}>
              {TARGET_TABLE_LABELS[t]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-gray-400">Acepta geometría: {allowedTypes}.</p>
      </div>

      {draft && (
        <div className="space-y-1 rounded bg-gray-50 p-2">
          {draft.areaHa != null && (
            <p>
              Área estimada: <span className="font-semibold">{draft.areaHa.toFixed(2)} ha</span>
            </p>
          )}
          {draft.selfIntersects && <p className="text-red-600">⚠ El polígono tiene auto-intersecciones.</p>}
        </div>
      )}

      {drawnLayer && (
        <div className="space-y-1.5 border-t border-gray-100 pt-2">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="mb-0.5 block text-[11px] text-gray-500">
                {f.label}
                {f.required ? ' *' : ''}
              </label>
              <input
                type="text"
                value={fieldValues[f.key] || ''}
                onChange={(e) => setFieldValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
              />
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-green-800 px-3 py-1 text-xs font-semibold text-white hover:bg-green-900 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {!drawnLayer && !draft && (
        <p className="text-[11px] text-gray-400">
          Usa los botones de dibujo en el mapa (⬠ Polígono, 📍 Marcador) para empezar.
        </p>
      )}

      {result && (
        <p
          className={`rounded p-1.5 text-[11px] ${
            result.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  )
}
