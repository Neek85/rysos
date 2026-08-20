'use client'

import { useEffect, useRef } from 'react'
import centroid from '@turf/centroid'

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
 */
export default function QcConsoleMap({ records, selectedKey, onSelect, editingKey, onGeometryChange }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const layerGroupRef = useRef(null)
  const layersByKeyRef = useRef(new Map())

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
        // Geoman ANTES de crear el mapa (mismo motivo que MapDashboard.jsx):
        // su hook vía L.Map.addInitHook solo aplica a mapas creados después
        // de que el hook exista. Acá se usa únicamente en modo edición
        // (layer.pm.enable()) sobre la capa seleccionada, nunca para dibujar
        // capas nuevas — ver el efecto de editingKey más abajo.
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

        // Español consistente con /dashboard/mapa (VectorEditorTools.jsx) —
        // esta consola no dibuja un toolbar propio, pero layer.pm.enable()
        // sigue usando textos de geoman (ver specs/gis_mapa_dashboard_polish.md).
        map.pm.setLang('es')

        L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
          attribution: '© Google',
          maxZoom: 20,
        }).addTo(map)

        layerGroupRef.current = L.layerGroup().addTo(map)
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
      layersByKeyRef.current = new Map()
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
      layer.bindPopup(
        `<strong>${record.tabla_origen}</strong><br/>${record.clasificacion || 'Sin clasificar'}`
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
    selectedLayer.openPopup?.()
  }, [selectedKey, records])

  // Modo edición de vértices — habilita layer.pm SOLO en la capa cuyo key
  // coincide con `editingKey` (nunca todas a la vez), y lo deshabilita en
  // cualquier otra que hubiera quedado en edición (cambio de selección
  // mientras se editaba, por ejemplo). `layer` (L.geoJSON de una sola
  // Feature) es un FeatureGroup — su `.pm.enable()` delega correctamente al
  // sublayer real (confirmado en node_modules/.../L.PM.Edit.LayerGroup.js),
  // pero los eventos pm:edit/pm:markerdragend los dispara ese SUBLAYER, no
  // el FeatureGroup — hay que escucharlos en `layer.getLayers()[0]`, no en
  // `layer`. Nada se escribe a la base desde acá — el botón "Guardar
  // Geometría" en QcDetailEditor decide cuándo persistir el borrador.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    layersByKeyRef.current.forEach((layer, key) => {
      const childLayer = layer.getLayers?.()[0]
      const shouldEdit = key === editingKey
      const isEditing = layer.pm?.enabled?.()
      if (shouldEdit && !isEditing) {
        layer.pm?.enable({ allowSelfIntersection: false })
        if (childLayer) {
          const report = () => onGeometryChange?.(key, childLayer.toGeoJSON().geometry)
          childLayer.on('pm:edit', report)
          childLayer.on('pm:markerdragend', report)
        }
      } else if (!shouldEdit && isEditing) {
        layer.pm?.disable()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingKey, records])

  return (
    <div
      ref={containerRef}
      style={{ height: '600px' }}
      className="w-full rounded-lg border border-gray-200"
    />
  )
}
