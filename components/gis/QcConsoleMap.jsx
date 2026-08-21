'use client'

import { useEffect, useRef, useState } from 'react'
import centroid from '@turf/centroid'
import VectorEditorPanel, { useVectorEditor } from '@/app/dashboard/qc/components/VectorEditorTools'

// Tablas destino que la Consola QC puede crear desde cero con el Editor
// Vectorial — deliberadamente NO las 4 de GIS_TARGET_TABLES:
// EUDR_INSTALACIONES/PADRON_PARCELAS quedan fuera a propósito
// (specs/ui_reorganization_geoman.md pide explícitamente solo
// EUDR_MONITOREO/EUDR_USO_SUELO desde acá).
const QC_DRAWABLE_TABLES = ['EUDR_MONITOREO', 'EUDR_USO_SUELO']

// Estilo por tabla_origen — deliberadamente distinto de los 11 colores de
// MapDashboard.jsx (uso de suelo/infraestructura): esta es una vista de
// AUDITORÍA, no cartografía temática. Lo que importa acá es de qué tabla
// viene cada registro pendiente, no su clasificación de campo.
const LAYER_STYLES = {
  EUDR_MONITOREO: { color: '#2563eb', fillColor: '#3b82f6' },
  EUDR_USO_SUELO: { color: '#d97706', fillColor: '#f59e0b' },
  EUDR_INSTALACIONES: { color: '#dc2626', fillColor: '#f87171' },
}
const DEFAULT_STYLE = { color: '#6b7280', fillColor: '#9ca3af' }
const SELECTED_WEIGHT = 4
const BASE_WEIGHT = 2

function styleFor(record, isSelected) {
  const cfg = LAYER_STYLES[record?.tabla_origen] || DEFAULT_STYLE
  return {
    color: isSelected ? '#111827' : cfg.color,
    fillColor: cfg.fillColor,
    weight: isSelected ? SELECTED_WEIGHT : BASE_WEIGHT,
    fillOpacity: 0.4,
  }
}

// INVARIANTE: a diferencia de vw_monitoreo_web (que expone geom_geojson
// separado porque su columna `geom` cruda serializa como WKB hex vía
// PostgREST), las vistas de auditoría en vivo devuelven `geom` ya como
// objeto GeoJSON directamente (verificado con una consulta REST real) —
// no existe una columna geom_geojson en vw_monitoreo_poligonos/puntos.
function parseGeometry(record) {
  const raw = record?.geom
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return raw
}

/**
 * Mapa Leaflet dedicado a la Consola QC — un solo layerGroup con las
 * geometrías PENDIENTE ya filtradas por capa (prop `records`), estilo por
 * tabla_origen, y flyTo + resaltado del registro seleccionado desde la
 * lista lateral (prop `selectedKey`). Selección también puede iniciarse
 * clickeando directamente una geometría (`onSelect`).
 *
 * Incluye el Editor Vectorial completo (reubicado desde /dashboard/mapa,
 * ver specs/ui_reorganization_geoman.md): además de ajustar vértices del
 * registro seleccionado (`editingKey`/`onGeometryChange`, mecanismo ya
 * existente), permite dibujar una parcela nueva desde cero
 * (`EUDR_MONITOREO`/`EUDR_USO_SUELO` únicamente) — `organizationId` y
 * `onFeatureCreated` (refresca la lista de pendientes tras guardar) vienen
 * del padre (`app/dashboard/qc/page.jsx`).
 */
export default function QcConsoleMap({
  records,
  selectedKey,
  onSelect,
  editingKey,
  onGeometryChange,
  organizationId,
  onFeatureCreated,
  comparisonFeatures,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const layerGroupRef = useRef(null)
  const layersByKeyRef = useRef(new Map())
  const comparisonGroupRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  // Editor Vectorial (crear geometría nueva desde cero) — reubicado acá
  // desde /dashboard/mapa (specs/ui_reorganization_geoman.md).
  // `enableGlobalEditControls: false`: NO agrega los botones globales de
  // Editar/Arrastrar/Eliminar de geoman — el modo "Editar" global
  // (`map.pm.enableGlobalEditMode()`) habilitaría vértices en TODAS las
  // capas PENDIENTE a la vez, chocando con el mecanismo de arriba
  // (`editingKey`, que edita deliberadamente UNA sola capa). Solo quedan
  // los botones de dibujo (Polígono/Marcador).
  const vectorEditor = useVectorEditor({
    mapRef,
    leafletRef,
    mapReady,
    organizationId,
    targetTables: QC_DRAWABLE_TABLES,
    enableGlobalEditControls: false,
    onSaved: onFeatureCreated,
  })

  // Inicialización del mapa (una sola vez) — mismo patrón defensivo de
  // MapDashboard.jsx: cleanup siempre via mapRef.current (nunca una
  // variable local), `cancelled` evita crear el mapa tras desmontar.
  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!containerRef.current || mapRef.current) return

      try {
        const leaflet = await import('leaflet')
        const L = leaflet.default
        await import('leaflet/dist/leaflet.css')
        // Geoman ANTES de crear el mapa (mismo motivo que MapDashboard.jsx
        // tenía antes de perder su propio Editor Vectorial, ver
        // specs/ui_reorganization_geoman.md): su hook vía L.Map.addInitHook
        // solo aplica a mapas creados después de que el hook exista. Se usa
        // en DOS modos independientes en este componente: edición de
        // vértices de la capa seleccionada (layer.pm.enable(), ver el
        // efecto de editingKey más abajo) y dibujo de geometría nueva desde
        // cero (useVectorEditor/VectorEditorPanel, con los controles
        // globales de Editar/Arrastrar/Eliminar de geoman deshabilitados a
        // propósito para que no choquen con el primer modo).
        await import('@geoman-io/leaflet-geoman-free')
        await import('@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css')
        if (cancelled) return
        leafletRef.current = L

        delete L.Icon.Default.prototype._getIconUrl
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png',
        })

        if (mapRef.current) return
        const map = L.map(containerRef.current).setView([-6.5, -77.5], 8)
        mapRef.current = map

        // Español para los tooltips de geoman — attachVectorEditor
        // (VectorEditorTools.jsx) también lo llama al enganchar el toolbar
        // de dibujo, pero L.PM.activeLang es un estado global del módulo
        // así que da igual quién lo llame primero.
        map.pm.setLang('es')

        L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
          attribution: '© Google',
          maxZoom: 20,
        }).addTo(map)

        layerGroupRef.current = L.layerGroup().addTo(map)
        // Capa secundaria de comparación de solapamiento (ver el efecto de
        // comparisonFeatures más abajo) — DEBAJO de layerGroupRef en el
        // z-order (agregada antes) para que el registro en revisión quede
        // siempre visualmente por encima de lo que solapa con él.
        comparisonGroupRef.current = L.layerGroup().addTo(map)
        layerGroupRef.current.bringToFront()
        if (!cancelled) setMapReady(true)
      } catch {
        // Fallo al inicializar (Leaflet no cargó, DOM no listo) — se deja
        // el contenedor vacío en vez de tumbar la consola completa.
      }
    }

    init()

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      layerGroupRef.current = null
      comparisonGroupRef.current = null
      layersByKeyRef.current = new Map()
      setMapReady(false)
    }
  }, [])

  // Re-renderiza las geometrías cada vez que cambia la lista filtrada.
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    const group = layerGroupRef.current
    if (!L || !map || !group) return

    group.clearLayers()
    layersByKeyRef.current = new Map()

    const bounds = []
    ;(records || []).forEach((record) => {
      const geometry = parseGeometry(record)
      if (!geometry) return

      const layer = L.geoJSON(
        { type: 'Feature', geometry, properties: record },
        {
          style: () => styleFor(record, record.key === selectedKey),
          pointToLayer: (_feature, latlng) =>
            L.circleMarker(latlng, {
              radius: 7,
              ...styleFor(record, record.key === selectedKey),
              color: '#ffffff',
              weight: 2,
            }),
        }
      )
      layer.on('click', () => onSelect?.(record.key))

      group.addLayer(layer)
      layersByKeyRef.current.set(record.key, layer)

      const b = layer.getBounds?.()
      if (b?.isValid?.()) bounds.push(b)
    })

    if (bounds.length > 0) {
      const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0])
      map.fitBounds(combined, { padding: [24, 24], maxZoom: 15 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records])

  // flyTo + resaltado del registro seleccionado desde la lista lateral (o
  // desde un click directo en el mapa, que ya actualiza selectedKey vía
  // onSelect y dispara este mismo efecto). Objetivo del flyTo: centroide
  // geométrico real (@turf/centroid) sobre la geometry del registro, no
  // getBounds().getCenter() (centro del rectángulo envolvente — puede caer
  // fuera de un polígono cóncavo/en L, ver specs/gis_qc_console_v2.md).
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    layersByKeyRef.current.forEach((layer, key) => {
      const record = (records || []).find((r) => r.key === key)
      if (record && layer.setStyle) layer.setStyle(styleFor(record, key === selectedKey))
    })

    if (!selectedKey) return
    const selectedRecord = (records || []).find((r) => r.key === selectedKey)
    const selectedLayer = layersByKeyRef.current.get(selectedKey)
    if (!selectedLayer) return

    const geometry = parseGeometry(selectedRecord)
    let target = null
    if (geometry) {
      try {
        const [lon, lat] = centroid({ type: 'Feature', properties: {}, geometry }).geometry.coordinates
        target = L.latLng(lat, lon)
      } catch {
        target = null
      }
    }
    if (!target && selectedLayer.getBounds) {
      target = selectedLayer.getBounds().getCenter()
    }
    if (target) {
      map.flyTo(target, Math.max(map.getZoom(), 16))
    }
    // Antes se llamaba abrir-popup acá, mostrando un popup permanente con
    // el nombre crudo de tabla_origen (ej. "EUDR_INSTALACIONES") apenas se
    // seleccionaba un registro. El panel derecho ("Corregir atributos" en
    // QcDetailEditor.jsx) ya muestra esa misma info con la etiqueta legible
    // (LAYER_LABELS) — el popup era redundante y confuso, se eliminó junto
    // con el bind-popup del efecto de renderizado de arriba.
  }, [selectedKey, records])

  // Modo edición de vértices — habilita .pm SOLO en la capa cuyo key
  // coincide con `editingKey` (nunca todas a la vez), y lo deshabilita en
  // cualquier otra que hubiera quedado en edición (cambio de selección
  // mientras se editaba, por ejemplo).
  //
  // `layer` (L.geoJSON de una sola Feature) es un FeatureGroup: llamar
  // `.pm.enable()` sobre él delega correctamente al sublayer real vía
  // L.PM.Edit.LayerGroup.enable() (confirmado leyendo
  // node_modules/@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.js),
  // incluyendo el caso Point → L.CircleMarker: geoman tiene un módulo
  // dedicado `L.PM.Edit.CircleMarker` (no reusa el de L.Marker), y su
  // `enable()` termina en `enableLayerDrag()` (mixin de arrastre genérico,
  // ya que CircleMarker no tiene dragging nativo de Leaflet) — confirmado
  // que esa ruta dispara `pm:edit` al soltar (`_dragMixinOnMouseUp` →
  // `_fireEdit()`), igual que la edición de vértices de un polígono. Se
  // llama `.pm.enable()`/`.disable()` directamente sobre `childLayer` (el
  // sublayer real) en vez de sobre el FeatureGroup wrapper para no
  // depender de esa delegación implícita y para pasar las opciones de
  // arrastre/snap explícitas en vez de confiar en los defaults heredados
  // por prototipo de `L.PM.Edit`. Nada se escribe a la base desde acá — el
  // botón "Guardar Cambios de Geometría" en QcDetailEditor decide cuándo
  // persistir el borrador.
  //
  // También se escucha `pm:dragend` (además de `pm:edit`/`pm:markerdragend`):
  // para el CircleMarker de un registro Point SÍ dispara el mismo callback
  // que `pm:edit` (mismo mixin de arrastre, ver `specs/qc_geoman_layer_binding_fix.md`),
  // así que es redundante ahí (llama `onGeometryChange` dos veces con la
  // misma geometría final, inofensivo — es solo un draft en memoria). Para
  // un `L.Polygon` casi nunca dispara (ese evento es de arrastrar la FORMA
  // completa, no de mover un vértice — la edición de vértices ya la cubre
  // `pm:edit`), pero se deja el listener por si alguna vez se habilita el
  // modo de arrastre de la forma completa.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    layersByKeyRef.current.forEach((layer, key) => {
      const childLayer = layer.getLayers?.()[0]
      if (!childLayer?.pm) return
      const shouldEdit = key === editingKey
      const isEditing = childLayer.pm.enabled?.()
      if (shouldEdit && !isEditing) {
        childLayer.pm.enable({ draggable: true, snappable: true, allowSelfIntersection: false })
        const report = () => onGeometryChange?.(key, childLayer.toGeoJSON().geometry)
        childLayer.on('pm:edit', report)
        childLayer.on('pm:markerdragend', report)
        childLayer.on('pm:dragend', report)
      } else if (!shouldEdit && isEditing) {
        childLayer.pm.disable()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingKey, records])

  // Capa de comparación de solapamiento — dibuja las geometrías APROBADAS
  // reales devueltas por fetchComparisonGeometries (lib/eudrQcActions.js,
  // vía handleValidateTopology en app/dashboard/qc/page.jsx) cuando
  // "Ejecutar Test Espacial" detecta solapamiento > 0% para el registro
  // seleccionado — contorno punteado, color distinto (ámbar) y sin
  // relleno, para que el auditor vea físicamente contra qué está
  // solapando sin confundirlo con el estilo del registro en revisión
  // (ver styleFor/LAYER_STYLES arriba). Se limpia solo (clearLayers) cada
  // vez que `comparisonFeatures` cambia — page.jsx ya lo vacía al cambiar
  // de registro seleccionado (specs/consola_qc_layout_y_validacion.md,
  // addendum solapamiento auditable).
  useEffect(() => {
    const L = leafletRef.current
    const group = comparisonGroupRef.current
    if (!L || !group) return

    group.clearLayers()
    ;(comparisonFeatures || []).forEach((feature) => {
      L.geoJSON(
        { type: 'Feature', geometry: feature.geometry, properties: {} },
        {
          style: () => ({
            color: '#b45309',
            weight: 2,
            dashArray: '6, 6',
            fillOpacity: 0.05,
            fillColor: '#b45309',
          }),
        }
      )
        .bindTooltip(`Solapa con: ${feature.tabla_origen} (${feature.registro_id})`)
        .addTo(group)
    })
  }, [comparisonFeatures])

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      {/* Antes 600px fijos — con el panel de edición ahora en su propia
          columna sticky (ver app/dashboard/qc/page.jsx), el mapa puede
          ocupar el alto disponible de la pantalla en vez de un valor fijo
          (specs/consola_qc_layout_y_validacion.md: "el mapa ocupa el
          centro, a toda la altura disponible"). min-h conserva un alto
          usable en pantallas muy bajas. */}
      <div
        ref={containerRef}
        className="h-[70vh] min-h-[500px] w-full flex-1 rounded-lg border border-gray-200 lg:h-[calc(100vh-220px)]"
      />
      {mapReady && (
        <div className="w-full lg:w-64 lg:flex-none">
          <VectorEditorPanel editor={vectorEditor} />
        </div>
      )}
    </div>
  )
}
