'use client'

import { useEffect, useRef, useState } from 'react'
import centroid from '@turf/centroid'
import VectorEditorPanel, { useVectorEditor } from '@/app/dashboard/qc/components/VectorEditorTools'
import { fetchParcelasVecinas } from '@/lib/actions/qcActions'

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

// Fase 3 (capa de contexto de parcelas vecinas) — el "punto en cuestión"
// para centrar la búsqueda: la geometría misma si ya es Point, o su
// centroide real (@turf/centroid, no getBounds().getCenter() — mismo
// motivo que el flyTo de más abajo) si es Polygon/MultiPolygon.
function centerPointOf(geometry) {
  if (!geometry) return null
  if (geometry.type === 'Point') return geometry
  try {
    return centroid({ type: 'Feature', properties: {}, geometry }).geometry
  } catch {
    return null
  }
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
  onDrawSessionActiveChange,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const layerGroupRef = useRef(null)
  const layersByKeyRef = useRef(new Map())
  const comparisonGroupRef = useRef(null)
  const neighborsGroupRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  // Capa de contexto de parcelas vecinas (Fase 3, ver
  // docs/adr/ADR-006-capa-contexto-parcelas-vecinas.md) — toggle ON por
  // defecto, SIN persistencia entre sesiones (limitación conocida y
  // documentada a propósito, ver ADR-006 — estado de componente puro).
  const [neighborsEnabled, setNeighborsEnabled] = useState(true)
  const [neighborFeatures, setNeighborFeatures] = useState([])
  const [neighborsInfo, setNeighborsInfo] = useState(null) // { totalEncontrados, totalDevueltos, radioM } | null

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
    // Mutua exclusión con el modo "Ajustar Geometría" de abajo (editingKey)
    // — useVectorEditor (ADR-018) es ahora el único punto que llama
    // map.pm.Toolbar.setButtonDisabled sobre los botones de dibujo, así
    // que esta razón se le pasa en vez de deshabilitarlos acá también.
    externalDrawDisabled: !!editingKey,
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

        // Orden de agregado = orden de apilado visual en Leaflet (sin
        // bringToFront(), que además no existe en L.LayerGroup, solo en
        // L.FeatureGroup/L.Path — usarlo acá rompía init() en silencio,
        // dejando mapReady en false para siempre y con eso tumbando TODO
        // el toolbar de "Editor Vectorial", ver
        // docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md). De
        // abajo hacia arriba: parcelas vecinas de contexto (Fase 3, la
        // capa más "de fondo" — nunca debe tapar nada) → comparación de
        // solapamiento (Fase 1) → registros PENDIENTE / el que está en
        // revisión, siempre arriba de todo.
        neighborsGroupRef.current = L.layerGroup().addTo(map)
        comparisonGroupRef.current = L.layerGroup().addTo(map)
        layerGroupRef.current = L.layerGroup().addTo(map)
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
      neighborsGroupRef.current = null
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
  //
  // MUTUA EXCLUSIÓN con el toolbar de "crear registro nuevo" (Editor
  // Vectorial, useVectorEditor/attachVectorEditor arriba) — ver
  // docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md, hallazgo real
  // confirmado en vivo (reproducido con javascript_tool): antes del fix de
  // ADR-005, `attachVectorEditor` enganchaba el toolbar de dibujo UNA sola
  // vez al montar (dependencia `[mapReady]` en useVectorEditor), sin
  // ninguna relación con `editingKey` — mientras un registro existente
  // estaba en modo "Ajustar Geometría", los botones ⬠ Polígono/📍
  // Marcador seguían 100% clickeables, y clickearlos arrancaba una sesión
  // de dibujo de polígono/marcador SUPERPUESTA (el toolbar completo con
  // Finalizar/Eliminar último vértice/Cancelar aparece mientras el
  // registro original sigue mostrando "Editando…"). La deshabilitación de
  // esos 2 botones (`map.pm.Toolbar.setButtonDisabled` — agrega la clase
  // CSS `pm-disabled` de geoman, no solo un estado lógico) ya NO se hace
  // acá: `editingKey` se pasa como `externalDrawDisabled` a
  // `useVectorEditor` (ver arriba), que desde ADR-018 es el único punto
  // del editor que llama `setButtonDisabled` — evitaba que 2 efectos
  // independientes (este, y el nuevo de restricción por tabla destino)
  // pisaran el estado del botón según el orden de ejecución.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

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
  }, [editingKey, records, mapReady])

  // Dirección inversa de la misma exclusión mutua: mientras haya una
  // sesión de dibujo de geometría nueva en curso (borrador con área/
  // capa ya dibujada, aunque todavía sin guardar), se avisa al padre
  // (`page.jsx`) para que deshabilite el botón "Ajustar Geometría" en
  // QcDetailEditor.jsx — evita el caso simétrico (empezar a editar un
  // registro existente mientras se está dibujando uno nuevo).
  useEffect(() => {
    const isDrawing = Boolean(vectorEditor.draft || vectorEditor.drawnLayer)
    onDrawSessionActiveChange?.(isDrawing)
  }, [vectorEditor.draft, vectorEditor.drawnLayer, onDrawSessionActiveChange])

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

  // Fase 3 — capa de contexto de parcelas vecinas (Monitoreos EUDR
  // APROBADOS dentro del radio configurado, ver
  // docs/adr/ADR-006-capa-contexto-parcelas-vecinas.md). Se dispara SOLO
  // al ENTRAR en modo edición de un registro existente (`editingKey`) o
  // al TERMINAR de dibujar uno nuevo (`vectorEditor.drawnLayer`) —
  // nunca en cada pan/zoom del mapa, ni en cada vértice mientras se
  // dibuja (eso sí sería excesivo: cada corrida es una consulta real al
  // server). Centrada en el centroide (Polygon) o el punto mismo (Point)
  // de la geometría en cuestión.
  useEffect(() => {
    if (!editingKey || !organizationId) return
    const record = (records || []).find((r) => r.key === editingKey)
    const geometry = parseGeometry(record)
    const point = centerPointOf(geometry)
    if (!record || !point) return

    let cancelled = false
    // Solo EUDR_MONITOREO tiene sentido excluir de sí mismo — es la única
    // tabla que fn_parcelas_vecinas_eudr consulta (ver ADR-006, "Uso de
    // Suelo/Instalaciones fuera de alcance a propósito").
    const excludeId = record.tabla_origen === 'EUDR_MONITOREO' ? record.id_monitoreo : null
    fetchParcelasVecinas(organizationId, point, excludeId)
      .then((result) => {
        if (cancelled) return
        setNeighborFeatures(result.parcelas)
        setNeighborsInfo({
          totalEncontrados: result.totalEncontrados,
          totalDevueltos: result.totalDevueltos,
          radioM: result.radioM,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setNeighborFeatures([])
          setNeighborsInfo(null)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingKey, organizationId])

  // Misma capa, dirección "dibujar geometría nueva" — dispara una sola
  // vez cuando geoman termina la forma (pm:create ya corrió,
  // vectorEditor.drawnLayer pasa de null a la capa real), nunca mientras
  // se colocan los vértices uno a uno.
  useEffect(() => {
    if (!vectorEditor.drawnLayer || !organizationId) return
    const geometry = vectorEditor.drawnLayer.toGeoJSON?.().geometry
    const point = centerPointOf(geometry)
    if (!point) return

    let cancelled = false
    fetchParcelasVecinas(organizationId, point, null)
      .then((result) => {
        if (cancelled) return
        setNeighborFeatures(result.parcelas)
        setNeighborsInfo({
          totalEncontrados: result.totalEncontrados,
          totalDevueltos: result.totalDevueltos,
          radioM: result.radioM,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setNeighborFeatures([])
          setNeighborsInfo(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [vectorEditor.drawnLayer, organizationId])

  // Limpia la capa de contexto cuando no hay ni edición ni dibujo en
  // curso (deseleccionar un registro, guardar/cancelar un dibujo nuevo)
  // — nunca debe sobrevivir un resultado "colgado" de una sesión previa.
  useEffect(() => {
    if (!editingKey && !vectorEditor.drawnLayer) {
      setNeighborFeatures([])
      setNeighborsInfo(null)
    }
  }, [editingKey, vectorEditor.drawnLayer])

  // Render — contorno punteado gris/slate (dashArray '2, 6', punteado más
  // fino que el '6, 6' de la capa de solapamiento de Fase 1, y color
  // totalmente distinto: gris neutro vs ámbar) para que un auditor jamás
  // confunda "vecino de contexto" (informativo, sin ningún conflicto real
  // detectado) con "solapa de verdad" (Fase 1, alerta real). Se limpia
  // por completo si `neighborsEnabled` es false — apagar el toggle quita
  // la capa del mapa, no solo la oculta con CSS.
  useEffect(() => {
    const L = leafletRef.current
    const group = neighborsGroupRef.current
    if (!L || !group) return

    group.clearLayers()
    if (!neighborsEnabled) return
    ;(neighborFeatures || []).forEach((feature) => {
      const style = { color: '#64748b', weight: 1.5, dashArray: '2, 6', fillOpacity: 0.03, fillColor: '#94a3b8' }
      L.geoJSON(
        { type: 'Feature', geometry: feature.geometry, properties: {} },
        {
          style: () => style,
          pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius: 5, ...style, fillOpacity: 0.2 }),
        }
      )
        .bindTooltip(`Vecino de contexto${feature.codigoSocio ? ` — ${feature.codigoSocio}` : ''}`)
        .addTo(group)
    })
  }, [neighborFeatures, neighborsEnabled])

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
        <div className="w-full space-y-3 lg:w-64 lg:flex-none">
          <VectorEditorPanel editor={vectorEditor} />

          {/* Toggle de la capa de contexto (Fase 3) — ON por defecto, sin
              persistencia entre sesiones (estado de componente puro, ver
              docs/adr/ADR-006-capa-contexto-parcelas-vecinas.md,
              "limitación conocida"). */}
          <div className="space-y-1 rounded-lg border border-gray-200 bg-white p-3 text-xs">
            <label className="flex items-center gap-2 font-semibold text-gray-700">
              <input
                type="checkbox"
                checked={neighborsEnabled}
                onChange={(e) => setNeighborsEnabled(e.target.checked)}
              />
              Parcelas vecinas de contexto
            </label>
            {neighborsEnabled && neighborsInfo && (
              <p className="text-[11px] text-gray-400">
                {neighborsInfo.totalDevueltos} de {neighborsInfo.totalEncontrados} en {neighborsInfo.radioM} m
                {neighborsInfo.totalEncontrados > neighborsInfo.totalDevueltos && (
                  <span className="text-amber-600"> — hay más parcelas en el radio, acercate al mapa.</span>
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
