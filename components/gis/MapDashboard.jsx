'use client'

import { useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabaseClient'

const EVIDENCIA_BUCKET = 'evidencias_eudr'
const SIGNED_URL_TTL_SECONDS = 3600

// INVARIANTE: vw_monitoreo_web no distingue "categoría" como columna propia —
// se deriva de tabla_origen (filas EUDR_MONITOREO son siempre el recorrido
// perimetral de la visita) y de `clasificacion` (tipo_uso/tipo_infra) para
// EUDR_USO_SUELO/EUDR_INSTALACIONES.
const CATEGORY_STYLES = {
  MONITOREO_PERIMETRAL: { color: '#2563eb', fillColor: '#3b82f6', label: 'Monitoreo Perimetral' },
  'Pan llevar': { color: '#a16207', fillColor: '#ca8a04', label: 'Pan llevar' },
  Producción: { color: '#15803d', fillColor: '#22c55e', label: 'Producción' },
  Vivienda: { color: '#b91c1c', fillColor: '#ef4444', label: 'Vivienda' },
}
const DEFAULT_STYLE = { color: '#64748b', fillColor: '#94a3b8', label: 'Sin clasificar' }

function resolveCategory(record) {
  if (record.tabla_origen === 'EUDR_MONITOREO') return 'MONITOREO_PERIMETRAL'
  return record.clasificacion || null
}

function categoryStyle(record) {
  const cfg = CATEGORY_STYLES[resolveCategory(record)] ?? DEFAULT_STYLE
  return { color: cfg.color, weight: 2, fillOpacity: 0.4, fillColor: cfg.fillColor }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function popupHtml(record, photoUrl) {
  const productor = record.productor ? escapeHtml(record.productor) : 'Sin registrar'
  const parcela = record['ID_Parcela_Fija'] ? escapeHtml(record['ID_Parcela_Fija']) : 'Sin registrar'
  const estado = record.estado_revision ? escapeHtml(record.estado_revision) : '—'

  let fotoHtml = '<span style="color:#94a3b8;">Sin foto</span>'
  if (record.evidencia_foto) {
    fotoHtml = photoUrl
      ? `<img src="${photoUrl}" alt="Evidencia de campo" style="width:100%;max-width:220px;border-radius:6px;margin-top:6px;display:block;" />`
      : '<span style="color:#94a3b8;">Cargando foto…</span>'
  }

  return (
    '<div style="font-size:13px;line-height:1.6;min-width:180px;">' +
    `<strong>Productor:</strong> ${productor}<br/>` +
    `<strong>Parcela:</strong> ${parcela}<br/>` +
    `<strong>Estado EUDR:</strong> ${estado}<br/>` +
    `<div>${fotoHtml}</div>` +
    '</div>'
  )
}

export default function MapDashboard() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const layersRef = useRef([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Carga de datos: vw_monitoreo_web ya filtra estrictamente estado_revision = 'APROBADO'.
  useEffect(() => {
    let cancelled = false

    async function fetchRecords() {
      const supabase = getSupabaseClient()
      if (!supabase) {
        setError('Cliente Supabase no configurado (revisa las variables de entorno).')
        setLoading(false)
        return
      }

      const { data, error: err } = await supabase
        .from('vw_monitoreo_web')
        .select(
          'tipo_geometria,tabla_origen,registro_id,ID_Organizacion,ID_Parcela_Fija,productor,clasificacion,evidencia_foto,estado_revision,fecha_monitoreo,observaciones,geom_geojson'
        )

      if (cancelled) return
      if (err) {
        setError(err.message)
      } else {
        setRecords(data ?? [])
      }
      setLoading(false)
    }

    fetchRecords()
    return () => {
      cancelled = true
    }
  }, [])

  // Inicialización del mapa (una sola vez). Leaflet requiere `window`, por eso
  // el import es dinámico y se ejecuta solo dentro de useEffect (cliente).
  useEffect(() => {
    let map

    async function init() {
      if (!containerRef.current || mapRef.current) return

      const leaflet = await import('leaflet')
      const L = leaflet.default
      await import('leaflet/dist/leaflet.css')
      leafletRef.current = L

      // Fix de iconos default rotos por el bundling de webpack.
      delete L.Icon.Default.prototype._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      map = L.map(containerRef.current).setView([-6.5, -77.5], 8)
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map)

      renderLayers(L, map, records)
    }

    init()

    return () => {
      map?.remove()
      mapRef.current = null
      layersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-renderiza las capas cada vez que cambian los registros (ej. tras el fetch inicial).
  useEffect(() => {
    if (!mapRef.current || !leafletRef.current) return
    renderLayers(leafletRef.current, mapRef.current, records)
  }, [records])

  function renderLayers(L, map, data) {
    layersRef.current.forEach((layer) => layer.remove())
    layersRef.current = []

    const bounds = []

    data.forEach((record) => {
      if (!record.geom_geojson) return

      let geometry
      try {
        geometry =
          typeof record.geom_geojson === 'string'
            ? JSON.parse(record.geom_geojson)
            : record.geom_geojson
      } catch {
        return // geometría no parseable — se omite este registro
      }
      if (!geometry) return

      const layer = L.geoJSON(
        { type: 'Feature', geometry, properties: record },
        {
          style: () => categoryStyle(record),
          pointToLayer: (_feature, latlng) =>
            L.circleMarker(latlng, { radius: 7, ...categoryStyle(record) }),
        }
      )

      layer.bindPopup(popupHtml(record, null))
      layer.on('popupopen', () => loadPhoto(layer, record))
      layer.addTo(map)
      layersRef.current.push(layer)

      const layerBounds = layer.getBounds?.()
      if (layerBounds?.isValid?.()) bounds.push(layerBounds)
    })

    if (bounds.length > 0) {
      const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0])
      map.fitBounds(combined, { padding: [24, 24], maxZoom: 15 })
    }
  }

  // Firma la URL de la foto de evidencia solo cuando el usuario abre el popup
  // (el bucket evidencias_eudr es privado, no hay URL pública directa).
  async function loadPhoto(layer, record) {
    if (!record.evidencia_foto) return
    const supabase = getSupabaseClient()
    if (!supabase) return

    const { data, error: err } = await supabase.storage
      .from(EVIDENCIA_BUCKET)
      .createSignedUrl(record.evidencia_foto, SIGNED_URL_TTL_SECONDS)

    if (!err && data?.signedUrl) {
      layer.setPopupContent(popupHtml(record, data.signedUrl))
    }
  }

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        style={{ height: '600px' }}
        className="w-full rounded-lg border border-gray-200"
      />

      {loading && <p className="text-sm text-gray-400">Cargando registros aprobados…</p>}
      {!loading && error && (
        <p className="text-sm text-red-600 bg-red-50 rounded p-2">Error de conexión: {error}</p>
      )}
      {!loading && !error && records.length === 0 && (
        <p className="text-sm text-gray-400">Sin registros aprobados en esta organización.</p>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        {Object.entries(CATEGORY_STYLES).map(([key, cfg]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full inline-block"
              style={{ backgroundColor: cfg.fillColor }}
            />
            {cfg.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-full inline-block"
            style={{ backgroundColor: DEFAULT_STYLE.fillColor }}
          />
          {DEFAULT_STYLE.label}
        </span>
      </div>
    </div>
  )
}
