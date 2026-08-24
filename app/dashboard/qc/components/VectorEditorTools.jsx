'use client'

// Editor Vectorial (Geoman) — dibujar geometría nueva desde cero directo
// sobre el mapa satelital vía @geoman-io/leaflet-geoman-free (imperativo,
// mismo patrón que components/gis/MapDashboard.jsx: import dinámico
// dentro de un useEffect, nunca react-leaflet). Reubicado de
// app/dashboard/mapa/ a app/dashboard/qc/ en
// specs/ui_reorganization_geoman.md — Mapa pasa a ser un visor de solo
// lectura, toda la creación/edición de geometría vive en la Consola QC,
// junto al mecanismo YA existente para ajustar vértices de un registro
// PENDIENTE seleccionado (components/gis/QcConsoleMap.jsx::editingKey).
//
// Dos piezas en este archivo (las funciones puras de cálculo de área/
// auto-intersección viven en lib/gisVectorEditor.js — separadas porque
// node --test no puede parsear JSX, ver tests/test_gis_editor.mjs):
// 1. attachVectorEditor — engancha los controles de geoman a un mapa ya
//    creado y traduce sus eventos a callbacks planos.
// 2. useVectorEditor + VectorEditorPanel (export default) — hook + panel
//    lateral que consumen lib/gisVectorEditor.js para el flujo de guardado.
//
// ADR-019: los campos `padronEntity` de TARGET_TABLE_FIELDS
// (lib/gisTargetTables.js) — Código de Socio/Código de Parcela — ya no
// son texto libre. PadronEntityField (más abajo) los reemplaza por un
// autocompletado real contra PADRON_SOCIOS/PADRON_PARCELAS (mismo
// lib/padronSearch.js y PadronAutocomplete que ya usa Inspecciones), con
// una opción "+ Crear socio nuevo" que reutiliza SocioFormModal
// (components/features/socios/) como overlay — nunca se duplica su
// validación (sociosActions.js). El rechazo real de un código inventado
// vive del lado del servidor, en lib/actions/gisActions.js.

import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadGeoSpatialFeature } from '@/lib/actions/gisActions'
import {
  TARGET_TABLE_LABELS,
  TARGET_TABLE_FIELDS,
  TARGET_TABLE_GEOMETRY_TYPES,
  GIS_TARGET_TABLES,
} from '@/lib/gisTargetTables'
import { evaluateGeometry, isGeometryAllowedForTable } from '@/lib/gisVectorEditor'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { searchSocios, searchParcelas } from '@/lib/padronSearch'
import PadronAutocomplete from '@/components/features/inspecciones/PadronAutocomplete'
import SocioFormModal from '@/components/features/socios/SocioFormModal'

/**
 * Valores iniciales de `fieldValues` para una geometría recién finalizada
 * (ADR-019, instrucción de herencia entre geometrías consecutivas): en
 * vez de limpiar incondicionalmente a `{}`, precarga (editable, nunca
 * forzado) el ID_Socio/ID_Parcela_Fija/id_parcela del último registro
 * guardado con éxito en la misma sesión de trabajo (`identity`, ver
 * `lastIdentityRef` en useVectorEditor) — útil para el caso real de crear
 * un perímetro y luego varias subdivisiones del mismo socio/parcela
 * seguidas. Solo precarga los campos `padronEntity` que existan para la
 * `targetTable` ACTUAL (ej. EUDR_USO_SUELO no tiene campo de socio, así
 * que `identity.socio` simplemente no se usa ahí) — el resto de los
 * campos (`tipo_uso`, `tipo_infra`, etc.) siempre arranca vacío.
 */
function buildInitialFieldValues(targetTable, identity) {
  const fields = TARGET_TABLE_FIELDS[targetTable] || []
  const next = {}
  fields.forEach((f) => {
    if (f.padronEntity === 'socio' && identity.socio) next[f.key] = identity.socio
    if (f.padronEntity === 'parcela' && identity.parcela) next[f.key] = identity.parcela
  })
  return next
}

// Mapeo botón de geoman -> tipo de geometría que produce, para la
// restricción reactiva por tabla destino de abajo (useVectorEditor). Solo
// estos 2 botones existen en este editor (ver drawMarker/drawPolygon en
// attachVectorEditor — el resto de drawX está en false a propósito).
const DRAW_BUTTON_GEOMETRY_TYPES = { drawMarker: 'Point', drawPolygon: 'Polygon' }

// ---------------------------------------------------------------
// attachVectorEditor — capa imperativa sobre geoman
// ---------------------------------------------------------------

/**
 * Agrega los controles de dibujo/edición de geoman a un mapa ya creado.
 * Solo Polígono + Marcador (nada de círculo/rectángulo/polilínea/texto/
 * rotar/cortar — fuera de alcance, ver spec). `onDraftChange(evaluateGeometry(...) | null)`:
 * se dispara en cada vértice agregado durante el dibujo y tras cada
 * edición/arrastre — es lo que alimenta el área/validación en vivo del
 * panel. `onFinalize(layer)`: se dispara una sola vez, cuando geoman
 * termina una geometría nueva (`pm:create` — doble clic para cerrar un
 * polígono, o clic simple para un marcador).
 *
 * `enableGlobalEditControls` (default `true`): si `false`, NO agrega los
 * botones de toolbar de "Editar"/"Arrastrar"/"Eliminar" globales de
 * geoman — SOLO dibujar. Necesario en la Consola QC
 * (specs/ui_reorganization_geoman.md): el modo "Editar" global de geoman
 * llama `map.pm.enableGlobalEditMode()`, que habilita edición de vértices
 * en TODAS las capas editables del mapa a la vez — entraría en conflicto
 * directo con el mecanismo ya existente de `QcConsoleMap.jsx`, que edita
 * deliberadamente UNA sola capa (el registro PENDIENTE seleccionado) vía
 * `layer.pm.enable()` propio. En /dashboard/mapa (visor de solo lectura,
 * ya no usa este módulo) esa restricción no aplicaba.
 *
 * Devuelve una función de limpieza (quita los controles y los listeners),
 * pensada para el `return` de un `useEffect`.
 */
export function attachVectorEditor(map, L, { onDraftChange, onFinalize, enableGlobalEditControls = true } = {}) {
  // Localización a español de los tooltips de geoman ("Draw Polygons" ->
  // "Dibujar Polígonos", etc.) — 'es' viene empaquetado en
  // @geoman-io/leaflet-geoman-free, no hace falta un diccionario propio.
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
    editMode: enableGlobalEditControls,
    dragMode: enableGlobalEditControls,
    cutPolygon: false,
    removalMode: enableGlobalEditControls,
    rotateMode: false,
  })

  function evaluateLayer(layer) {
    if (!layer?.toGeoJSON) return
    onDraftChange?.(evaluateGeometry(layer.toGeoJSON().geometry))
  }

  // Vértice agregado mientras se dibuja (antes de terminar) — HALLAZGO
  // REAL (Fase 2, ver docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md):
  // geoman dispara `pm:vertexadded` sobre la capa "de trabajo" en
  // construcción (`this._layer` dentro de geoman, propagate:false — no
  // llega nunca a `map`), no sobre `map` como se podría asumir por
  // analogía con `pm:create`/`pm:remove` (esos sí se disparan
  // explícitamente sobre `this._map`). `map.on('pm:vertexadded', ...)`
  // nunca se ejecutaba — confirmado en vivo con un log temporal (0
  // disparos pese a colocar vértices reales). Patrón correcto: escuchar
  // `pm:drawstart` (ese SÍ llega a `map`, con `workingLayer` en el
  // payload) y enganchar `pm:vertexadded` directo sobre esa capa de
  // trabajo — mismo objeto durante toda la sesión de dibujo, confirmado
  // en vivo (3 disparos reales para 3 vértices colocados).
  function handleDrawStart(e) {
    e.workingLayer?.on('pm:vertexadded', () => evaluateLayer(e.workingLayer))
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

  map.on('pm:drawstart', handleDrawStart)
  map.on('pm:create', handleCreate)
  map.on('pm:remove', handleRemove)

  return function detach() {
    map.off('pm:drawstart', handleDrawStart)
    map.off('pm:create', handleCreate)
    map.off('pm:remove', handleRemove)
    map.pm.removeControls()
  }
}

// ---------------------------------------------------------------
// useVectorEditor — hook de estado React sobre attachVectorEditor
// ---------------------------------------------------------------

/**
 * `mapRef`/`leafletRef`: refs del componente dueño del mapa
 * (`mapRef.current` = instancia `L.Map`, `leafletRef.current` = módulo
 * `L`). `mapReady`: true una vez que el mapa terminó de inicializarse —
 * el efecto de acá espera a que sea true para enganchar geoman (no puede
 * hacerlo antes de que exista `map.pm`, agregado por el propio import de
 * geoman). `organizationId`: resuelta por el llamador (mismo
 * `resolveOrganizationId(records)` que usa el resto del módulo GIS).
 * `targetTables`: subconjunto de `GIS_TARGET_TABLES` que este editor
 * puede ofrecer como destino — la Consola QC solo pasa
 * `['EUDR_MONITOREO', 'EUDR_USO_SUELO']` (specs/ui_reorganization_geoman.md,
 * nunca `EUDR_INSTALACIONES`/`PADRON_PARCELAS` desde acá); default a
 * `GIS_TARGET_TABLES` completo para no romper otro futuro consumidor que
 * sí necesite las 4. `enableGlobalEditControls`: ver attachVectorEditor.
 *
 * `externalDrawDisabled` (default `false`): permite a un llamador externo
 * (QcConsoleMap.jsx, mientras `editingKey` está activo — ver
 * docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md) forzar los 2
 * botones de dibujo a deshabilitado además de las 2 razones internas de
 * abajo. Único punto que llama `map.pm.Toolbar.setButtonDisabled` en todo
 * el editor (ver ADR-018) — antes había una segunda llamada duplicada en
 * QcConsoleMap.jsx que solo conocía la razón "editingKey" y podía
 * pisar/ser pisada por esta, según el orden de ejecución de efectos.
 */
export function useVectorEditor({
  mapRef,
  leafletRef,
  mapReady,
  organizationId,
  targetTables = GIS_TARGET_TABLES,
  enableGlobalEditControls = true,
  externalDrawDisabled = false,
  onSaved,
}) {
  const [targetTable, setTargetTable] = useState(targetTables[0])
  const [draft, setDraft] = useState(null) // { areaHa, selfIntersects } | null
  const [drawnLayer, setDrawnLayer] = useState(null)
  const [fieldValues, setFieldValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null) // { type: 'success' | 'error', message }

  // targetTable cambia en cada render pero el efecto de abajo (que engancha
  // onFinalize UNA sola vez, dependencia [mapReady]) necesita leer su valor
  // ACTUAL en el momento en que geoman termina una geometría — no el valor
  // de cuando se enganchó. Mismo motivo por el que existe lastIdentityRef.
  const targetTableRef = useRef(targetTable)
  useEffect(() => {
    targetTableRef.current = targetTable
  }, [targetTable])

  // Último ID_Socio/ID_Parcela_Fija/id_parcela guardado con éxito en esta
  // sesión de trabajo (ADR-019, instrucción de herencia) — un ref, no
  // estado: nada en la UI renderiza a partir de esto directamente, solo lo
  // lee onFinalize (vía buildInitialFieldValues) al precargar la próxima
  // geometría. Mutado directamente en handleSave, sin pasar por setState,
  // para no forzar un re-render extra por cada guardado.
  const lastIdentityRef = useRef({ socio: null, parcela: null })

  useEffect(() => {
    if (!mapReady || !mapRef.current || !leafletRef.current) return undefined
    return attachVectorEditor(mapRef.current, leafletRef.current, {
      onDraftChange: setDraft,
      onFinalize: (layer) => {
        setDrawnLayer(layer)
        setFieldValues(buildInitialFieldValues(targetTableRef.current, lastIdentityRef.current))
        setResult(null)
      },
      enableGlobalEditControls,
    })
    // mapRef/leafletRef son refs estables — solo re-engancha si mapReady cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady])

  // Restricción reactiva de los botones de dibujo (ADR-018) — combina 3
  // razones para deshabilitar cada botón, cualquiera alcanza:
  // 1. `externalDrawDisabled` (ver arriba) — editingKey activo en la
  //    Consola QC.
  // 2. `drawnLayer` sin resolver (ni guardado ni cancelado) — cierra de
  //    raíz el problema de "capas huérfanas": no se puede iniciar una
  //    geometría nueva mientras la anterior siga pendiente, sin importar
  //    su tipo.
  // 3. El tipo de geometría de ESE botón no está en
  //    TARGET_TABLE_GEOMETRY_TYPES[targetTable] — ya no se puede ni
  //    empezar a dibujar un Point con "Uso de Suelo" seleccionado (antes
  //    el error solo aparecía al Guardar, con el marcador ya puesto en el
  //    mapa).
  // Corre DESPUÉS del efecto de arriba en cada render (orden de
  // declaración de hooks) — el toolbar ya existe para cuando esto se
  // ejecuta la primera vez que mapReady pasa a true.
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    const allowedTypes = TARGET_TABLE_GEOMETRY_TYPES[targetTable] || []
    const hasUnresolvedDraft = !!drawnLayer
    Object.entries(DRAW_BUTTON_GEOMETRY_TYPES).forEach(([buttonName, geometryType]) => {
      const shouldDisable = externalDrawDisabled || hasUnresolvedDraft || !allowedTypes.includes(geometryType)
      try {
        map.pm.Toolbar.setButtonDisabled(buttonName, shouldDisable)
      } catch {
        // El botón todavía no existe (carrera de montaje/desmontaje) — nada que hacer.
      }
    })
    // mapRef es un ref estable — no hace falta como dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTable, drawnLayer, externalDrawDisabled, mapReady])

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
        targetTable === 'PADRON_PARCELAS' ? '' : ' Queda PENDIENTE de revisión — ya aparece en la lista de esta consola.'
      setResult({ type: 'success', message: `Geometría guardada correctamente.${pendienteNote}` })
      // Recuerda el socio/parcela de ESTE guardado para precargar la
      // próxima geometría (ver buildInitialFieldValues) — solo sobreescribe
      // cuando este guardado sí traía un valor, para no perder la memoria
      // de la sesión al guardar una tabla que no tiene ese campo (ej.
      // EUDR_USO_SUELO no tiene ID_Socio).
      lastIdentityRef.current = {
        socio: fieldValues.ID_Socio || lastIdentityRef.current.socio,
        parcela: fieldValues.ID_Parcela_Fija || fieldValues.id_parcela || lastIdentityRef.current.parcela,
      }
      drawnLayer.remove()
      setDrawnLayer(null)
      setDraft(null)
      onSaved?.(targetTable)
    } catch (err) {
      setResult({ type: 'error', message: err?.message || 'No se pudo guardar la geometría.' })
    } finally {
      setSaving(false)
    }
  }, [drawnLayer, organizationId, targetTable, fieldValues, onSaved])

  return {
    targetTable,
    setTargetTable,
    targetTables,
    organizationId,
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
// PadronEntityField — autocompletado real contra PADRON_SOCIOS/
// PADRON_PARCELAS (ADR-019) para un campo `padronEntity: 'socio' |
// 'parcela'` de TARGET_TABLE_FIELDS (lib/gisTargetTables.js). Reutiliza
// PadronAutocomplete (components/features/inspecciones/PadronAutocomplete.jsx)
// y lib/padronSearch.js sin modificarlos — mismo mecanismo exacto que ya
// usa TabGeneral.jsx en el formulario de Inspecciones (searchSocios/
// searchParcelas ya excluyen `activo = false`, ver ADR-016), así que solo
// puede seleccionarse un socio/parcela que exista y esté activo: no hay
// forma de escribir el código a mano, `onChange` solo se dispara desde
// `onSelect` de un resultado real de búsqueda.
// `scopeParcelaSearchToSocio`: cuando este campo es de tipo 'parcela' Y el
// mismo fields[] trae un campo 'socio' con valor ya elegido (hoy solo pasa
// en EUDR_MONITOREO, que tiene ambos), acota la búsqueda de parcelas a las
// de ESE socio (mismo `searchParcelas(supabase, org, socioId, query)` que
// ya soporta ese 3er parámetro) — en EUDR_USO_SUELO/EUDR_INSTALACIONES
// (sin campo de socio) queda `null`, búsqueda sin acotar, igual que hoy.
function PadronEntityField({ field, value, onChange, organizationId, scopeParcelaSearchToSocio, onCreateSocio }) {
  const isSocio = field.padronEntity === 'socio'

  async function handleSearch(query) {
    const supabase = getSupabaseClient()
    if (!supabase || !organizationId) return []
    if (isSocio) {
      const rows = await searchSocios(supabase, organizationId, query)
      return rows.map((r) => ({ key: r.ID_Socio, ...r }))
    }
    const rows = await searchParcelas(supabase, organizationId, scopeParcelaSearchToSocio || null, query)
    return rows.map((r) => ({ key: r.ID_Parcela_Fija, ...r }))
  }

  return (
    <div>
      <PadronAutocomplete
        label={`${field.label}${field.required ? ' *' : ''}`}
        placeholder={isSocio ? 'Nombre, DNI o código de finca…' : 'Código o nombre de parcela…'}
        disabled={!organizationId}
        search={handleSearch}
        renderResult={(r) =>
          isSocio ? (
            <>
              <p className="font-medium text-gray-800">{r.socio_nombre_completo || 'Sin nombre'}</p>
              <p className="text-xs text-gray-400">
                {r.socio_dni ? `DNI ${r.socio_dni}` : ''}
                {r.codigo_finca ? ` · ${r.codigo_finca}` : ''}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-gray-800">{r.parcela_codigo || 'Sin código'}</p>
              <p className="text-xs text-gray-400">
                {r.parcela_nombre || ''}
                {r.totalh ? ` · ${r.totalh} ha` : ''}
              </p>
            </>
          )
        }
        onSelect={(r) => onChange(isSocio ? r.ID_Socio : r.ID_Parcela_Fija)}
      />
      {value && <p className="mt-1 text-[11px] text-emerald-700">✓ Seleccionado: {value}</p>}
      {isSocio && (
        <button
          type="button"
          onClick={onCreateSocio}
          className="mt-1 text-[11px] font-semibold text-green-800 hover:underline"
        >
          + Crear socio nuevo
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// VectorEditorPanel — panel lateral compacto (no un modal de pantalla
// completa: el mapa debe seguir visible para comparar contra la imagen
// satelital mientras se dibuja).
// ---------------------------------------------------------------

export default function VectorEditorPanel({ editor }) {
  const {
    targetTable,
    setTargetTable,
    targetTables,
    organizationId,
    draft,
    drawnLayer,
    fieldValues,
    setFieldValues,
    saving,
    result,
    handleSave,
    handleCancel,
  } = editor
  const fields = TARGET_TABLE_FIELDS[targetTable]
  const allowedTypes = (TARGET_TABLE_GEOMETRY_TYPES[targetTable] || []).join(' o ')
  // Overlay de "+ Crear socio nuevo" (ADR-019) — `socioModalFieldKey`
  // recuerda CUÁL campo abrió el modal (hoy solo EUDR_MONITOREO.ID_Socio
  // es padronEntity:'socio', pero esto no asume que sea el único) para
  // saber a qué key de fieldValues escribir el ID_Socio del socio recién
  // creado que devuelve SocioFormModal.
  const [socioModalFieldKey, setSocioModalFieldKey] = useState(null)
  const socioField = fields.find((f) => f.padronEntity === 'socio')

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
          {targetTables.map((t) => (
            <option key={t} value={t}>
              {TARGET_TABLE_LABELS[t]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-gray-400">Acepta geometría: {allowedTypes}.</p>
      </div>

      {/* Panel de información en vivo (Fase 2, recalculado en cada
          vértice vía pm:vertexadded — ver attachVectorEditor arriba) —
          área/perímetro con el mismo redondeo que fn_calcular_area_ha
          server-side (lib/geo/areaUtils.js::AREA_HA_DECIMALS), validez
          geométrica (@turf/kinks) y el aviso informativo de la regla
          "parcelas >= 4.0 ha requieren Polygon" (lib/eudrDdsExporter.js::
          MIN_POLYGON_HECTARES) — nunca bloqueante, ninguno de estos
          impide guardar. */}
      {draft && (
        <div className="space-y-1 rounded bg-gray-50 p-2">
          {draft.areaHa != null && (
            <p>
              Área estimada: <span className="font-semibold">{draft.areaHa.toFixed(4)} ha</span>
            </p>
          )}
          {draft.perimetroM != null && (
            <p>
              Perímetro estimado: <span className="font-semibold">{draft.perimetroM} m</span>
            </p>
          )}
          {draft.selfIntersects && <p className="text-red-600">⚠ El polígono tiene auto-intersecciones.</p>}
          {draft.polygonBelowThreshold && (
            <p className="text-amber-600">
              ℹ Área cercana o menor a 4.0 ha (con margen de precisión cliente/servidor) — un Point también
              podría ser válido para esta parcela según la regla EUDR; el valor exacto se recalcula al guardar.
            </p>
          )}
        </div>
      )}

      {drawnLayer && drawnLayer.toGeoJSON?.().geometry?.type === 'Point' && (
        <p className="rounded bg-gray-50 p-2 text-[11px] text-gray-500">
          ℹ Un Point no tiene área medible — si la parcela real mide 4.0 ha o más, usa Polygon en su lugar.
        </p>
      )}

      {drawnLayer && (
        <div className="space-y-1.5 border-t border-gray-100 pt-2">
          {fields.map((f) =>
            f.padronEntity ? (
              <PadronEntityField
                key={f.key}
                field={f}
                value={fieldValues[f.key] || ''}
                onChange={(v) => setFieldValues((prev) => ({ ...prev, [f.key]: v }))}
                organizationId={organizationId}
                scopeParcelaSearchToSocio={
                  f.padronEntity === 'parcela' && socioField ? fieldValues[socioField.key] || null : null
                }
                onCreateSocio={() => setSocioModalFieldKey(f.key)}
              />
            ) : (
              <div key={f.key}>
                <label className="mb-0.5 block text-[11px] text-gray-500">
                  {f.label}
                  {f.required ? ' *' : ''}
                </label>
                {f.options ? (
                  <select
                    value={fieldValues[f.key] || ''}
                    onChange={(e) => setFieldValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-700"
                  >
                    <option value="">Seleccionar…</option>
                    {f.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={fieldValues[f.key] || ''}
                    onChange={(e) => setFieldValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                  />
                )}
              </div>
            )
          )}
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

      {/* Overlay de "+ Crear socio nuevo" (ADR-019) — SocioFormModal es un
          `position: fixed` de pantalla completa (ver su propio JSX), así
          que renderizarlo acá dentro no cambia dónde aparece en pantalla;
          al ser solo una capa más de React sobre el mismo árbol, dibujar
          o cancelar mientras está abierto nunca se ve afectado: drawnLayer/
          draft viven en useVectorEditor, completamente ajenos a este
          estado local. Reutiliza sociosActions.js sin duplicar ninguna
          validación (DNI/Código de Finca duplicados, etc.) — decisión
          confirmada explícitamente para esta tarea. */}
      {socioModalFieldKey && (
        <SocioFormModal
          socio={null}
          organizationId={organizationId}
          onClose={() => setSocioModalFieldKey(null)}
          onSaved={(savedSocio) => {
            setFieldValues((prev) => ({ ...prev, [socioModalFieldKey]: savedSocio.id }))
            setSocioModalFieldKey(null)
          }}
        />
      )}
    </div>
  )
}
