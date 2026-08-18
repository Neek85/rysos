// Proyecta geometrías GeoJSON (ya sanitizadas, ver lib/traceabilityHash.js)
// a coordenadas de un viewport SVG plano — "mapa esquemático" de las
// parcelas de origen para el Dossier PDF, sin depender de un servicio de
// tiles/basemap externo (solución 100% nativa, sin llamadas de red desde
// el Route Handler). No es un mapa geográfico real (sin proyección
// cartográfica, sin escala), es un diagrama de forma/posición relativa
// entre las parcelas del mismo lote.
//
// Funciones puras, sin dependencias de React/@react-pdf — testeadas
// directamente en tests/test_pdf_dossier.mjs.

function collectCoordinates(geometry, acc) {
  if (!geometry) return acc
  const { type, coordinates } = geometry
  if (type === 'Point') {
    acc.push(coordinates)
  } else if (type === 'Polygon') {
    coordinates.forEach((ring) => ring.forEach((c) => acc.push(c)))
  } else if (type === 'MultiPolygon') {
    coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach((c) => acc.push(c))))
  }
  return acc
}

export function computeBoundingBox(features) {
  const allCoords = (features || []).reduce((acc, f) => collectCoordinates(f?.geometry, acc), [])
  if (allCoords.length === 0) return null

  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of allCoords) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return { minLon, maxLon, minLat, maxLat }
}

/**
 * Proyecta las Features a formas listas para dibujar en un <Svg> de
 * `width`x`height` (coordenadas ya en espacio de pantalla, Y invertida
 * porque la latitud crece hacia el norte y SVG crece hacia abajo).
 * Devuelve [] si no hay geometrías válidas — el caller debe manejar ese
 * caso (mapa vacío) sin lanzar excepción.
 */
export function projectFeaturesToSvgShapes(features, { width, height, padding = 10 } = {}) {
  const bbox = computeBoundingBox(features)
  if (!bbox) return []

  // Bounding box degenerado (una sola coordenada, o todas iguales): evita
  // división por cero, centra el punto en el viewport.
  const lonSpan = bbox.maxLon - bbox.minLon || 1
  const latSpan = bbox.maxLat - bbox.minLat || 1
  const innerWidth = width - padding * 2
  const innerHeight = height - padding * 2

  function project([lon, lat]) {
    const x = padding + ((lon - bbox.minLon) / lonSpan) * innerWidth
    const y = padding + innerHeight - ((lat - bbox.minLat) / latSpan) * innerHeight
    return [x, y]
  }

  return (features || [])
    .map((feature) => {
      const geometry = feature?.geometry
      const label = feature?.properties?.parcela_codigo || ''
      if (!geometry) return null

      if (geometry.type === 'Point') {
        const [x, y] = project(geometry.coordinates)
        return { type: 'point', cx: x, cy: y, label }
      }

      if (geometry.type === 'Polygon') {
        const ring = geometry.coordinates[0] || []
        return { type: 'polygon', points: ring.map(project), label }
      }

      if (geometry.type === 'MultiPolygon') {
        const polygons = geometry.coordinates.map((poly) => (poly[0] || []).map(project))
        return { type: 'multipolygon', polygons, label }
      }

      return null
    })
    .filter(Boolean)
}
