'use client'

import { useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabaseClient'

const EVIDENCIA_BUCKET = 'evidencias_eudr'
const SIGNED_URL_TTL_SECONDS = 3600

// INVARIANTE: vw_monitoreo_web no distingue "categoría" como columna propia —
// se deriva de tabla_origen (filas EUDR_MONITOREO son siempre el recorrido
// perimetral de la visita) y de `clasificacion` (tipo_uso/tipo_infra) para
// EUDR_USO_SUELO/EUDR_INSTALACIONES.
//
// JERARQUIA VISUAL DE 3 NIVELES:
//   1. Perimetros (MONITOREO_PERIMETRAL, poligono o punto): borde marcado,
//      relleno casi transparente — nunca debe tapar las subdivisiones.
//   2. Subdivisiones de uso de suelo (siempre poligono — EUDR_USO_SUELO
//      nunca aporta geometrias puntuales): relleno solido por color tematico,
//      una de 7 categorias reales de campo.
//   3. Infraestructura (EUDR_INSTALACIONES, siempre punto — nunca aporta
//      poligonos): circulos distintivos en un pane propio con z-index mayor,
//      para que siempre queden encima de 1 y 2 sin importar el orden en que
//      Supabase devuelva las filas. 4 categorias reales de campo.
//
// `clasificacion` llega tal cual de tipo_uso/tipo_infra (texto libre, sin
// CHECK constraint que fije la ortografia) y en la practica varia en
// acentos/mayusculas/separador ("Pan Llevar" vs "Pan llevar", "Inverna/Pasto"
// vs "Inverna / Pasto", "Otras áreas" vs "Otras Areas"). normalizeKey()
// colapsa esas variantes a una misma clave para que el lookup de estilo no
// dependa de que el dato venga con la ortografia exacta.
function normalizeKey(value) {
  if (typeof value !== 'string') return ''
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Las 7 subdivisiones de uso de suelo (EUDR_USO_SUELO, siempre poligono).
const LAND_USE_STYLES = [
  { key: 'produccion', label: 'Producción', color: '#16a34a', fillColor: '#22c55e', fillOpacity: 0.35, icon: '🟢' },
  { key: 'crecimiento', label: 'Crecimiento', color: '#65a30d', fillColor: '#84cc16', fillOpacity: 0.35, icon: '🌱' },
  { key: 'pan llevar', label: 'Pan Llevar', color: '#d97706', fillColor: '#f59e0b', fillOpacity: 0.35, icon: '🟧' },
  { key: 'inverna pasto', label: 'Inverna/Pasto', color: '#ca8a04', fillColor: '#eab308', fillOpacity: 0.35, icon: '🌾' },
  { key: 'rastrojo purma', label: 'Rastrojo/Purma', color: '#92400e', fillColor: '#b45309', fillOpacity: 0.35, icon: '🍂' },
  { key: 'bosque', label: 'Bosque', color: '#14532d', fillColor: '#15803d', fillOpacity: 0.45, icon: '🌲' },
  { key: 'otras areas', label: 'Otras áreas', color: '#6b7280', fillColor: '#9ca3af', fillOpacity: 0.3, icon: '🔘' },
]
const DEFAULT_LAND_USE_STYLE = {
  label: 'Sin clasificar',
  color: '#64748b',
  fillColor: '#94a3b8',
  fillOpacity: 0.35,
  icon: '⬜',
}
const LAND_USE_BY_KEY = Object.fromEntries(LAND_USE_STYLES.map((s) => [s.key, s]))

function resolveLandUseStyle(clasificacion) {
  return LAND_USE_BY_KEY[normalizeKey(clasificacion)] ?? DEFAULT_LAND_USE_STYLE
}

// Las 4 categorias de infraestructura (EUDR_INSTALACIONES, siempre punto).
const INFRA_STYLES = [
  { key: 'vivienda', label: 'Vivienda', color: '#ef4444', icon: '🏠' },
  { key: 'fuente de agua', label: 'Fuente de agua', color: '#06b6d4', icon: '💧' },
  { key: 'modulo de beneficio', label: 'Módulo de beneficio', color: '#8b5cf6', icon: '⚙️' },
  { key: 'zona con erosion', label: 'Zona con erosión', color: '#f97316', icon: '⚠️' },
]
const DEFAULT_INFRA_STYLE = { label: 'Sin clasificar', color: '#64748b', icon: '📍' }
const INFRA_BY_KEY = Object.fromEntries(INFRA_STYLES.map((s) => [s.key, s]))

function resolveInfraStyle(clasificacion) {
  return INFRA_BY_KEY[normalizeKey(clasificacion)] ?? DEFAULT_INFRA_STYLE
}

// Capa perimetral contenedora (EUDR_MONITOREO, poligono o punto): borde
// marcado, relleno casi transparente para nunca tapar las subdivisiones.
const PERIMETRAL_STYLE = {
  label: 'Monitoreo Perimetral',
  color: '#2563eb',
  weight: 3,
  fillColor: '#3b82f6',
  fillOpacity: 0.05,
  icon: '🔵',
}

// Pane propio con z-index entre markerPane (600) y tooltipPane (650) por
// defecto de Leaflet, para que los puntos de infraestructura siempre se
// dibujen sobre perimetros/subdivisiones sin tapar tooltips ni popups.
const INFRA_PANE_NAME = 'infraestructuraPane'
const INFRA_PANE_Z_INDEX = 645

function polygonStyle(record) {
  if (record?.tabla_origen === 'EUDR_MONITOREO') {
    return {
      color: PERIMETRAL_STYLE.color,
      weight: PERIMETRAL_STYLE.weight,
      fillOpacity: PERIMETRAL_STYLE.fillOpacity,
      fillColor: PERIMETRAL_STYLE.fillColor,
    }
  }
  const cfg = resolveLandUseStyle(record?.clasificacion)
  return { color: cfg.color, weight: 1.5, fillOpacity: cfg.fillOpacity, fillColor: cfg.fillColor }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// INVARIANTE: "ID_Parcela_Fija" es un identificador interno de fila (con
// frecuencia con forma de UUID, ej. "{2bad5d16-...}") y NUNCA debe
// mostrarse en pantalla. Desde 20260817_refine_vw_monitoreo_web.sql,
// vw_monitoreo_web expone parcela_codigo (PADRON_PARCELAS.parcela_codigo,
// el codigo legible real, ej. "COOP-JS-003") — es la fuente preferida.
// sanitizeCode() queda como ultima linea de defensa: si por lo que sea el
// unico valor disponible tiene forma de UUID (con o sin llaves), se
// descarta en vez de mostrarlo, para que un dato mal cargado en
// PADRON_PARCELAS nunca filtre un identificador tecnico a la UI.
const UUID_PATTERN = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i

function sanitizeCode(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || UUID_PATTERN.test(trimmed)) return null
  return trimmed
}

function resolveParcelaCodigo(record, fallback = 'S/C') {
  return (
    sanitizeCode(record?.parcela_codigo) ||
    sanitizeCode(record?.id_parcela) ||
    sanitizeCode(record?.['ID_Parcela_Fija']) ||
    fallback
  )
}

function formatArea(record) {
  return record?.area_ha ? `${record.area_ha} ha` : 'N/A'
}

function formatNombreParcela(record) {
  return record?.parcela_nombre ? ` — ${escapeHtml(record.parcela_nombre)}` : ''
}

// Contenido de tooltip por nivel jerarquico. A diferencia del estilo (donde
// un punto MONITOREO se agrupa junto al perimetro), el contenido textual del
// tooltip se decide directamente por tabla_origen: es la unica columna que
// distingue sin ambiguedad los 3 niveles (EUDR_MONITOREO / EUDR_USO_SUELO /
// EUDR_INSTALACIONES), sin depender de inferir el tipo de geometria. El
// icono del encabezado sale de resolveLandUseStyle/resolveInfraStyle, para
// que tooltip y leyenda muestren siempre el mismo simbolo por categoria.
//
// - EUDR_MONITOREO (Perimetro): codigo+nombre de la parcela, Productor y
//   "Área Total" (area_ha de PADRON_PARCELAS, la parcela completa).
// - EUDR_USO_SUELO (Subdivision, siempre poligono): "[icono] Uso de Suelo:
//   [tipo_uso]", la finca contenedora (codigo+nombre), Productor (via el
//   LEFT JOIN LATERAL de 20260817_refine_vw_monitoreo_web.sql) y "Área del
//   Lote".
// - EUDR_INSTALACIONES (Punto, siempre punto): "[icono] Infraestructura:
//   [tipo_infra]", la finca contenedora y Productor — el Área se OMITE a
//   proposito: una instalacion puntual (tulpa, beneficio, etc.) no tiene
//   una extension propia que mostrar, y repetir el area de la parcela ahi
//   induciria a pensar que es el area de la instalacion.
function tooltipHtml(record) {
  const codigoParcela = escapeHtml(resolveParcelaCodigo(record, 'Parcela'))
  const nombreParcela = formatNombreParcela(record)
  const productor = record?.productor ? escapeHtml(record.productor) : 'Sin registrar'
  const clasificacion = record?.clasificacion ? escapeHtml(record.clasificacion) : 'Sin clasificar'

  if (record?.tabla_origen === 'EUDR_USO_SUELO') {
    const icon = resolveLandUseStyle(record?.clasificacion).icon
    return (
      `<strong>${icon} Uso de Suelo: ${clasificacion}</strong><br/>` +
      `Finca: ${codigoParcela}${nombreParcela}<br/>` +
      `Productor: ${productor}<br/>` +
      `Área del Lote: ${formatArea(record)}`
    )
  }

  if (record?.tabla_origen === 'EUDR_INSTALACIONES') {
    const icon = resolveInfraStyle(record?.clasificacion).icon
    return (
      `<strong>${icon} Infraestructura: ${clasificacion}</strong><br/>` +
      `Finca: ${codigoParcela}${nombreParcela}<br/>` +
      `Productor: ${productor}`
    )
  }

  // EUDR_MONITOREO (Perímetro) — nivel por defecto.
  return (
    `<strong>${codigoParcela}${nombreParcela}</strong><br/>` +
    `Productor: ${productor}<br/>` +
    `Área Total: ${formatArea(record)}`
  )
}

function estadoBadgeHtml(estado) {
  const esAprobado = estado === 'APROBADO'
  const bg = esAprobado ? '#d1fae5' : '#f1f5f9'
  const fg = esAprobado ? '#065f46' : '#475569'
  const texto = esAprobado ? `✓ ${estado}` : estado || '—'
  return (
    `<span style="background:${bg};color:${fg};font-size:10px;font-weight:600;` +
    'padding:2px 8px;border-radius:9999px;white-space:nowrap;">' +
    `${escapeHtml(texto)}</span>`
  )
}

// Tarjeta visual del popup (click): mismo criterio de tabla_origen que
// tooltipHtml, para que encabezado y contenido no queden desalineados entre
// hover y click. Perimetro conserva codigo+nombre de parcela como
// encabezado (es el sujeto de esa fila); Subdivision/Infraestructura usan
// el mismo encabezado emoji+tipo del tooltip y bajan la parcela a una fila
// "Finca:" — nunca se renderiza una fila vacia (formatNombreParcela ya
// devuelve '' sin parcela_nombre, y Área se omite por completo, no en
// blanco, para EUDR_INSTALACIONES). La foto de evidencia se completa de
// forma asincrona via loadPhoto/setPopupContent (el bucket es privado).
function popupHtml(record, photoUrl) {
  const codigoParcela = escapeHtml(resolveParcelaCodigo(record))
  const nombreParcela = formatNombreParcela(record)
  const productor = record?.productor ? escapeHtml(record.productor) : 'Sin registrar'
  const clasificacion = record?.clasificacion ? escapeHtml(record.clasificacion) : 'Sin clasificar'
  const estado = record.estado_revision ? escapeHtml(record.estado_revision) : '—'

  let headerHtml
  let bodyHtml
  if (record.tabla_origen === 'EUDR_USO_SUELO') {
    const icon = resolveLandUseStyle(record?.clasificacion).icon
    headerHtml = `<strong style="font-size:14px;">${icon} Uso de Suelo: ${clasificacion}</strong>`
    bodyHtml =
      `<div><strong>Finca:</strong> ${codigoParcela}${nombreParcela}</div>` +
      `<div><strong>Productor:</strong> ${productor}</div>` +
      `<div><strong>Área del Lote:</strong> ${formatArea(record)}</div>`
  } else if (record.tabla_origen === 'EUDR_INSTALACIONES') {
    const icon = resolveInfraStyle(record?.clasificacion).icon
    headerHtml = `<strong style="font-size:14px;">${icon} Infraestructura: ${clasificacion}</strong>`
    bodyHtml =
      `<div><strong>Finca:</strong> ${codigoParcela}${nombreParcela}</div>` +
      `<div><strong>Productor:</strong> ${productor}</div>`
  } else {
    headerHtml = `<strong style="font-size:14px;">${codigoParcela}${nombreParcela}</strong>`
    bodyHtml =
      `<div><strong>Productor:</strong> ${productor}</div>` +
      `<div><strong>Área Total:</strong> ${formatArea(record)}</div>`
  }

  let fotoHtml = '<span style="color:#94a3b8;">Sin foto</span>'
  if (record.evidencia_foto) {
    fotoHtml = photoUrl
      ? `<img src="${photoUrl}" alt="Evidencia de campo" style="width:100%;max-width:220px;border-radius:6px;margin-top:8px;display:block;" />`
      : '<span style="color:#94a3b8;">Cargando foto…</span>'
  }

  return (
    '<div style="font-size:13px;line-height:1.6;min-width:200px;max-width:240px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
    headerHtml +
    estadoBadgeHtml(estado) +
    '</div>' +
    bodyHtml +
    `<div>${fotoHtml}</div>` +
    '</div>'
  )
}

export default function MapDashboard() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const layersRef = useRef([])
  const layerGroupsRef = useRef(null)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [mapError, setMapError] = useState(null)

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

      try {
        const { data, error: err } = await supabase
          .from('vw_monitoreo_web')
          .select(
            'tabla_origen,ID_Organizacion,ID_Parcela_Fija,parcela_codigo,parcela_nombre,area_ha,productor,clasificacion,evidencia_foto,estado_revision,fecha_monitoreo,observaciones,geom_geojson'
          )

        if (cancelled) return
        if (err) {
          setError(err.message)
        } else {
          setRecords(Array.isArray(data) ? data : [])
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Error inesperado al consultar vw_monitoreo_web.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchRecords()
    return () => {
      cancelled = true
    }
  }, [])

  // Inicialización del mapa (una sola vez). Leaflet requiere `window`, por eso
  // el import es dinámico y se ejecuta solo dentro de useEffect (cliente).
  useEffect(() => {
    // INVARIANTE: la limpieza NUNCA debe depender de una variable local
    // asignada dentro de init() (async) — si el efecto se desmonta antes de
    // que los `await` resuelvan (ej. React 18 Strict Mode en dev, que monta/
    // desmonta/remonta cada efecto una vez para detectar exactamente este
    // tipo de bug), esa variable local seguiria `undefined` al momento de
    // limpiar, el mapa nunca se removeria de verdad, y un remontaje
    // posterior llamaria L.map() de nuevo sobre el mismo contenedor DOM ya
    // inicializado -> Leaflet lanza "Map container is already initialized".
    // Por eso la limpieza y el guard de creacion usan siempre mapRef.current
    // (estable), y `cancelled` evita que la continuacion asincrona cree un
    // mapa despues de que el componente ya se desmonto.
    let cancelled = false

    async function init() {
      if (!containerRef.current || mapRef.current) return

      try {
        const leaflet = await import('leaflet')
        const L = leaflet.default
        await import('leaflet/dist/leaflet.css')
        if (cancelled) return
        leafletRef.current = L

        // Fix de iconos default rotos por el bundling de webpack.
        delete L.Icon.Default.prototype._getIconUrl
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png',
        })

        if (mapRef.current) return // otra inicializacion ya gano la carrera
        const map = L.map(containerRef.current).setView([-6.5, -77.5], 8)
        mapRef.current = map

        map.createPane(INFRA_PANE_NAME)
        map.getPane(INFRA_PANE_NAME).style.zIndex = INFRA_PANE_Z_INDEX

        // INVARIANTE: Google Satelite Hibrido es la capa base por defecto (se
        // agrega directamente al mapa); las demas quedan definidas pero sin
        // addTo(map) — L.control.layers las agrega/quita segun cual elija el
        // usuario (comportamiento tipo radio-button para capas base).
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
        const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
          attribution: '© Google',
          maxZoom: 20,
        })
        const esriImagery = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution:
              'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
            maxZoom: 19,
          }
        )

        googleHybrid.addTo(map)

        const baseMaps = {
          'Google Satélite Híbrido': googleHybrid,
          'Esri World Imagery': esriImagery,
          OpenStreetMap: osm,
        }

        // INVARIANTE: capas superpuestas por nivel jerarquico — las 3 se
        // agregan al mapa por defecto (visibles), y el control permite
        // ocultarlas/mostrarlas independientemente.
        const perimetralGroup = L.layerGroup().addTo(map)
        const subdivisionGroup = L.layerGroup().addTo(map)
        const infraestructuraGroup = L.layerGroup().addTo(map)
        layerGroupsRef.current = {
          perimetral: perimetralGroup,
          subdivision: subdivisionGroup,
          infraestructura: infraestructuraGroup,
        }

        const overlayMaps = {
          'Perímetros de Monitoreo': perimetralGroup,
          'Subdivisiones de Cultivo': subdivisionGroup,
          Infraestructura: infraestructuraGroup,
        }

        L.control.layers(baseMaps, overlayMaps).addTo(map)

        renderLayers(L, map, records)
      } catch (err) {
        // INVARIANTE: un fallo aca (ej. leaflet no pudo cargar, DOM no listo) no
        // debe tumbar el arbol de React entero — no hay ErrorBoundary en la app,
        // asi que una excepcion sin capturar en render/efecto deja la pagina en
        // blanco. Se degrada a un mensaje de error en vez de propagar.
        if (!cancelled) setMapError(err?.message || 'No se pudo inicializar el mapa.')
      }
    }

    init()

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      layersRef.current = []
      layerGroupsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-renderiza las capas cada vez que cambian los registros (ej. tras el fetch inicial).
  useEffect(() => {
    if (!mapRef.current || !leafletRef.current) return
    try {
      renderLayers(leafletRef.current, mapRef.current, records)
    } catch (err) {
      setMapError(err?.message || 'No se pudieron renderizar las capas del mapa.')
    }
  }, [records])

  function renderLayers(L, map, data) {
    const groups = layerGroupsRef.current
    if (!groups) return

    groups.perimetral.clearLayers()
    groups.subdivision.clearLayers()
    groups.infraestructura.clearLayers()
    layersRef.current = []

    const bounds = []
    const safeData = Array.isArray(data) ? data : []

    safeData.forEach((record) => {
      if (!record?.geom_geojson) return

      try {
        const geometry =
          typeof record.geom_geojson === 'string'
            ? JSON.parse(record.geom_geojson)
            : record.geom_geojson
        if (!geometry) return

        const isPerimetral = record.tabla_origen === 'EUDR_MONITOREO'
        const isPoint = geometry.type === 'Point' || geometry.type === 'MultiPoint'

        const layer = L.geoJSON(
          { type: 'Feature', geometry, properties: record },
          {
            style: () => polygonStyle(record),
            pointToLayer: (_feature, latlng) => {
              if (isPerimetral) {
                return L.circleMarker(latlng, {
                  radius: 6,
                  color: PERIMETRAL_STYLE.color,
                  weight: 2,
                  fillColor: PERIMETRAL_STYLE.fillColor,
                  fillOpacity: 0.6,
                })
              }
              // INVARIANTE: unico origen posible de un punto que no es
              // MONITOREO es EUDR_INSTALACIONES — recibe el color de su
              // categoria de infraestructura, en su propio pane elevado.
              const cfg = resolveInfraStyle(record.clasificacion)
              return L.circleMarker(latlng, {
                radius: 8,
                color: '#ffffff',
                weight: 2,
                fillColor: cfg.color,
                fillOpacity: 0.9,
                pane: INFRA_PANE_NAME,
              })
            },
            // Tooltip al pasar el cursor (hover), no permanente — con muchas
            // parcelas visibles a la vez, un tooltip permanente por feature
            // satura el mapa. `feature` aca es el GeoJSON Feature completo;
            // los datos reales del registro viven en `feature.properties`.
            onEachFeature: (feature, featureLayer) => {
              featureLayer.bindTooltip(tooltipHtml(feature.properties), {
                sticky: true,
              })
            },
          }
        )

        layer.bindPopup(popupHtml(record, null))
        layer.on('popupopen', () => loadPhoto(layer, record))

        if (isPerimetral) {
          groups.perimetral.addLayer(layer)
        } else if (isPoint) {
          groups.infraestructura.addLayer(layer)
        } else {
          groups.subdivision.addLayer(layer)
        }
        layersRef.current.push(layer)

        const layerBounds = layer.getBounds?.()
        if (layerBounds?.isValid?.()) bounds.push(layerBounds)
      } catch {
        // geometría no parseable o no soportada por Leaflet — se omite este
        // registro puntual, nunca se deja que tumbe el render de toda la capa.
      }
    })

    if (bounds.length > 0) {
      const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0])
      map.fitBounds(combined, { padding: [24, 24], maxZoom: 15 })
    }
  }

  // Firma la URL de la foto de evidencia solo cuando el usuario abre el popup
  // (el bucket evidencias_eudr es privado, no hay URL pública directa).
  async function loadPhoto(layer, record) {
    if (!record?.evidencia_foto) return
    const supabase = getSupabaseClient()
    if (!supabase) return

    try {
      const { data, error: err } = await supabase.storage
        .from(EVIDENCIA_BUCKET)
        .createSignedUrl(record.evidencia_foto, SIGNED_URL_TTL_SECONDS)

      if (!err && data?.signedUrl) {
        layer.setPopupContent(popupHtml(record, data.signedUrl))
      }
    } catch {
      // No se pudo firmar la foto (red, permisos, etc.) — el popup se queda
      // con el placeholder "Cargando foto…", sin romper el resto del mapa.
    }
  }

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        style={{ height: '600px' }}
        className="w-full rounded-lg border border-gray-200"
      />

      {mapError && (
        <p className="text-sm text-red-600 bg-red-50 rounded p-2">
          Error al cargar el mapa: {mapError}
        </p>
      )}
      {loading && <p className="text-sm text-gray-400">Cargando registros aprobados…</p>}
      {!loading && error && (
        <p className="text-sm text-red-600 bg-red-50 rounded p-2">Error de conexión: {error}</p>
      )}
      {!loading && !error && records.length === 0 && (
        <p className="text-sm text-gray-400">Sin registros aprobados en esta organización.</p>
      )}

      <div className="space-y-2 text-xs text-gray-500 border-t border-gray-100 pt-2">
        <div>
          <p className="font-semibold text-gray-600 mb-1">Uso de Suelo</p>
          <div className="flex flex-wrap gap-3">
            {LAND_USE_STYLES.map((cfg) => (
              <span key={cfg.key} className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-sm inline-block"
                  style={{ backgroundColor: cfg.fillColor, border: `1px solid ${cfg.color}` }}
                />
                <span>
                  {cfg.icon} {cfg.label}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="font-semibold text-gray-600 mb-1">Infraestructura</p>
          <div className="flex flex-wrap gap-3">
            {INFRA_STYLES.map((cfg) => (
              <span key={cfg.key} className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ backgroundColor: cfg.color }}
                />
                <span>
                  {cfg.icon} {cfg.label}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <span className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-sm inline-block"
              style={{ backgroundColor: PERIMETRAL_STYLE.fillColor, border: `2px solid ${PERIMETRAL_STYLE.color}` }}
            />
            <span>
              {PERIMETRAL_STYLE.icon} {PERIMETRAL_STYLE.label}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full inline-block"
              style={{ backgroundColor: DEFAULT_LAND_USE_STYLE.fillColor }}
            />
            {DEFAULT_LAND_USE_STYLE.label}
          </span>
        </div>
      </div>
    </div>
  )
}
