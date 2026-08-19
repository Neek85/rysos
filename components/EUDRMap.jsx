'use client'

import { useEffect, useRef } from 'react'

const RISK_COLORS = {
  CRITICO: '#ef4444',
  ALTO:    '#f97316',
  BAJO:    '#22c55e',
}

function featureStyle(risk) {
  const color = RISK_COLORS[risk] ?? '#94a3b8'
  return { color, weight: 2, fillOpacity: 0.4, fillColor: color }
}

export default function EUDRMap({ records }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef([])

  useEffect(() => {
    let L
    let map

    async function init() {
      if (!containerRef.current || mapRef.current) return

      const leaflet = await import('leaflet')
      L = leaflet.default

      await import('leaflet/dist/leaflet.css')

      // Fix default marker icons broken by webpack
      delete L.Icon.Default.prototype._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png',
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
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then(({ default: L }) => {
      layersRef.current.forEach(l => l.remove())
      layersRef.current = []
      renderLayers(L, mapRef.current, records)
    })
  }, [records])

  function renderLayers(L, map, data) {
    data.forEach((record) => {
      // geom_geojson (no `geom` crudo, fix 2026-08-18): PostgREST
      // serializa `geometry` como WKB hex, no como GeoJSON —
      // JSON.parse(record.geom) fallaba silenciosamente para cada fila.
      // geom_geojson ya es un objeto JS (columna `json` de Postgres, no
      // texto), no hace falta JSON.parse.
      if (!record.geom_geojson) return
      try {
        const layer = L.geoJSON(
          { type: 'Feature', geometry: record.geom_geojson, properties: record },
          { style: () => featureStyle(record.riesgo_satelital) }
        ).bindPopup(
          `<strong>${record.parcela_codigo}</strong><br/>` +
          `${record.hectareas_totales ?? '—'} ha`
        ).addTo(map)
        layersRef.current.push(layer)
      } catch {
        // geom_geojson inválida — se omite
      }
    })
  }

  return (
    <div
      ref={containerRef}
      style={{ height: '400px' }}
      className="w-full rounded-lg border border-gray-200"
    />
  )
}
