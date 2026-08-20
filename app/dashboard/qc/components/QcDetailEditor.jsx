'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { LAYER_LABELS, EDITABLE_FIELDS } from '@/lib/eudrQcActions'
import { describeDeforestationBadge } from '@/lib/qcTopologyValidation'

// Mismo bucket/TTL que components/gis/MapDashboard.jsx::loadPhoto — el
// bucket evidencias_eudr es privado, no hay URL pública directa. No existía
// ningún visor de evidencia fotográfica en la Consola QC antes de
// specs/gis_qc_rearchitecture.md (el prompt que pidió esta reorganización
// decía "preserva el visor de evidencia fotográfica" como si ya existiera
// acá — no era cierto, verificado por grep, es una adición nueva).
const EVIDENCIA_BUCKET = 'evidencias_eudr'
const SIGNED_URL_TTL_SECONDS = 3600

// Panel de detalle de la Consola QC (/dashboard/qc) — Consola QC 2.0, ver
// specs/gis_qc_console_v2.md. Reemplaza el panel inline que antes vivía en
// page.jsx: agrega corrección de atributos reales (EDITABLE_FIELDS,
// distinto por tabla_origen) y el toggle de ajuste de geometría, además de
// los botones Aprobar/Rechazar ya existentes (sin cambio de comportamiento).
//
// `record`/`geometryDraft`/`isEditingGeometry` vienen de page.jsx, que es
// quien también renderiza QcConsoleMap (hermano de este componente) — el
// borrador de geometría editada en el mapa tiene que pasar por el padre
// común, no puede vivir local acá. El borrador de ATRIBUTOS sí es local
// (no involucra al mapa) — el padre monta este componente con
// `key={record.key}` para que el estado se reinicie solo al cambiar de
// registro seleccionado, sin necesidad de sincronizarlo manualmente.

function Badge({ ok, okLabel, badLabel, title }) {
  return (
    <span
      title={title}
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
      }`}
    >
      {ok ? `✓ ${okLabel}` : `⚠ ${badLabel}`}
    </span>
  )
}

function buildInitialAttributes(record, fields) {
  const values = {}
  for (const { key } of fields) {
    values[key] = record?.[key] ?? ''
  }
  return values
}

export default function QcDetailEditor({
  record,
  geometryDraft,
  isEditingGeometry,
  onToggleGeometryEdit,
  onSaveAttributes,
  onSaveGeometry,
  motivo,
  setMotivo,
  onApprove,
  onReject,
  busy,
  // Validación topológica & EUDR — el resultado vive en page.jsx
  // (validationResults, keyed por record.key), no acá: QcTable.jsx
  // también necesita leerlo para el badge de cada fila, y un registro
  // seleccionado no debe "perder" su resultado ya calculado solo porque
  // este componente se remonta con key={record.key} al cambiar de
  // selección (ver specs/qc_visualization_panel_update.md).
  validationResult,
  validating,
  validationError,
  onValidateTopology,
}) {
  const fields = EDITABLE_FIELDS[record.tabla_origen] || []
  const [attributeValues, setAttributeValues] = useState(() => buildInitialAttributes(record, fields))
  const [savingAttributes, setSavingAttributes] = useState(false)
  const [savingGeometry, setSavingGeometry] = useState(false)
  const [localError, setLocalError] = useState(null)
  const [photoUrl, setPhotoUrl] = useState(null)
  const canValidateTopology = record.tabla_origen !== 'EUDR_INSTALACIONES'

  // Firma la URL de la foto de evidencia solo cuando hay una para este
  // registro — `key={record.key}` en el padre (page.jsx) ya remonta este
  // componente al cambiar de selección, así que no hace falta un guard de
  // "cancelled" adicional acá (mismo criterio que loadPhoto en
  // components/gis/MapDashboard.jsx, que sí lo necesita porque su capa
  // Leaflet persiste entre selecciones).
  useEffect(() => {
    if (!record.evidencia_foto) return
    const supabase = getSupabaseClient()
    if (!supabase) return
    supabase.storage
      .from(EVIDENCIA_BUCKET)
      .createSignedUrl(record.evidencia_foto, SIGNED_URL_TTL_SECONDS)
      .then(({ data, error }) => {
        if (!error && data?.signedUrl) setPhotoUrl(data.signedUrl)
      })
  }, [record.evidencia_foto])

  async function handleSaveAttributes() {
    setLocalError(null)
    setSavingAttributes(true)
    try {
      await onSaveAttributes(attributeValues)
    } catch (err) {
      setLocalError(err?.message || 'No se pudieron guardar los cambios.')
    } finally {
      setSavingAttributes(false)
    }
  }

  async function handleSaveGeometry() {
    setLocalError(null)
    setSavingGeometry(true)
    try {
      await onSaveGeometry(geometryDraft)
    } catch (err) {
      setLocalError(err?.message || 'No se pudo guardar la geometría.')
    } finally {
      setSavingGeometry(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <p className="text-sm font-semibold text-gray-700">
          {LAYER_LABELS[record.tabla_origen] || record.tabla_origen}
        </p>
        {record.productor && <p className="text-xs text-gray-400">Productor: {record.productor}</p>}
      </div>

      {record.evidencia_foto && (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-semibold text-gray-500">Evidencia fotográfica</p>
          {photoUrl ? (
            <img
              src={photoUrl}
              alt="Evidencia de campo"
              className="max-h-48 w-full rounded-md object-cover"
            />
          ) : (
            <p className="text-[11px] text-gray-400">Cargando foto…</p>
          )}
        </div>
      )}

      {fields.length > 0 && (
        <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-500">Corregir atributos</p>
          {fields.map((f) => (
            <div key={f.key}>
              <label className="mb-0.5 block text-[11px] text-gray-500">{f.label}</label>
              <input
                type="text"
                value={attributeValues[f.key] || ''}
                onChange={(e) => setAttributeValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={handleSaveAttributes}
            disabled={savingAttributes}
            className="rounded border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-white disabled:opacity-50"
          >
            {savingAttributes ? 'Guardando…' : 'Guardar Atributos'}
          </button>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
        <p className="text-xs font-semibold text-gray-500">Ajustar geometría</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleGeometryEdit}
            className={`rounded border px-3 py-1 text-xs font-semibold ${
              isEditingGeometry
                ? 'border-amber-400 bg-amber-50 text-amber-700'
                : 'border-gray-300 text-gray-700 hover:bg-white'
            }`}
          >
            {isEditingGeometry ? '✏️ Editando… (click para terminar)' : '✏️ Ajustar Geometría'}
          </button>
          {geometryDraft && (
            <button
              type="button"
              onClick={handleSaveGeometry}
              disabled={savingGeometry}
              className="rounded bg-gray-700 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {savingGeometry ? 'Guardando…' : 'Guardar Geometría'}
            </button>
          )}
        </div>
        {isEditingGeometry && (
          <p className="text-[11px] text-gray-400">
            Arrastrá los vértices directamente sobre el mapa. "Guardar Geometría" aparece cuando haya un cambio.
          </p>
        )}
      </div>

      {canValidateTopology && (
        <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-500">Validación topológica &amp; EUDR</p>
            <button
              type="button"
              onClick={() => onValidateTopology(record)}
              disabled={validating}
              className="rounded border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-white disabled:opacity-50"
            >
              {validating ? 'Validando…' : 'Ejecutar Test Espacial'}
            </button>
          </div>

          {validationError && <p className="text-[11px] text-red-600">{validationError}</p>}

          {validationResult && (
            <div className="flex flex-wrap gap-1.5">
              <Badge
                ok={validationResult.es_valido}
                okLabel="Topología Válida"
                badLabel="Topología Con Errores"
                title={validationResult.motivo_invalidez || undefined}
              />
              <Badge
                ok={!validationResult.solapa}
                okLabel="Sin Solapamiento"
                badLabel={`Solapado (${validationResult.solapamiento_max_pct}%)`}
              />
              {/* Estado real de EUDR_COBERTURA_BOSCOSA_2020 (ver
                  specs/eudr_forest_cover_2020_schema.md) — mientras esa
                  tabla siga vacía, describeDeforestationBadge devuelve
                  ok:null (badge neutro), nunca inventa un veredicto. */}
              {(() => {
                const badge = describeDeforestationBadge(validationResult.deforestacion)
                return (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      badge.ok === null
                        ? 'border border-gray-300 bg-white text-gray-500'
                        : badge.ok
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {badge.label}
                  </span>
                )
              })()}
              {typeof validationResult.area_ha === 'number' && (
                <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600">
                  {validationResult.area_ha.toFixed(2)} ha
                </span>
              )}
            </div>
          )}

          {validationResult &&
            (!validationResult.es_valido ||
              validationResult.solapa ||
              validationResult.deforestacion?.interseca_post_2020) && (
              <p className="rounded bg-amber-50 p-2 text-[11px] text-amber-800">
                ⚠ Este registro tiene fallas topológicas, solapamiento con otra geometría APROBADA,
                o deforestación post-2020 detectada — revisá antes de aprobar (no bloquea la decisión).
              </p>
            )}
        </div>
      )}

      {localError && <p className="rounded bg-red-50 p-2 text-xs text-red-600">{localError}</p>}

      <textarea
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Observaciones / motivo (obligatorio para rechazar)"
        className="w-full rounded border border-gray-200 p-2 text-sm"
        rows={2}
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Procesando…' : '✓ Aprobar'}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy || !motivo.trim()}
          className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Procesando…' : '✕ Rechazar'}
        </button>
      </div>
    </div>
  )
}
