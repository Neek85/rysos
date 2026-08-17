'use client'

import { useEffect, useRef } from 'react'

// Mapa de solo lectura para la página pública de trazabilidad
// (app/trace/[lot_hash]/page.jsx) — sin selección, sin flyTo interactivo,
// sin capas base conmutables: solo el perímetro/parcelas de origen del
// lote ya sanitizado (properties sin PII, ver lib/traceabilityHash.js).
export default function PublicLotMap({ features }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!containerRef.current || mapRef.current) return

      try {
        const leaflet = await import('leaflet')
        const L = leaflet.default
        await import('leaflet/dist/leaflet.css')
        if (cancelled) return

        if (mapRef.current) return
        const map = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: true,
        }).setView([-6.5, -77.5], 8)
        mapRef.current = map

        L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
          attribution: '© Google',
          maxZoom: 20,
        }).addTo(map)

        const group = L.layerGroup().addTo(map)
        const bounds = []

        ;(features || []).forEach((feature) => {
          if (!feature?.geometry) return
          const layer = L.geoJSON(feature, {
            style: () => ({ color: '#15803d', weight: 2, fillColor: '#22c55e', fillOpacity: 0.35 }),
            pointToLayer: (_f, latlng) =>
              L.circleMarker(latlng, {
                radius: 6,
                color: '#ffffff',
                weight: 2,
                fillColor: '#15803d',
                fillOpacity: 0.9,
              }),
          })
          const codigo = feature.properties?.parcela_codigo || 'Parcela'
          const hectareas = feature.properties?.hectareas
          layer.bindPopup(
            `<strong>${codigo}</strong>${hectareas ? `<br/>${hectareas} ha` : ''}`
          )
          group.addLayer(layer)

          const b = layer.getBounds?.()
          if (b?.isValid?.()) bounds.push(b)
        })

        if (bounds.length > 0) {
          const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0])
          map.fitBounds(combined, { padding: [24, 24], maxZoom: 14 })
        }
      } catch {
        // Fallo al inicializar Leaflet — se deja el contenedor vacío en vez
        // de tumbar la página pública completa.
      }
    }

    init()

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ height: '280px' }}
      className="w-full rounded-lg border border-gray-200"
    />
  )
}
