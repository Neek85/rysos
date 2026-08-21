// Funciones puras del Editor Vectorial WebGIS (/dashboard/qc, reubicado
// desde /dashboard/mapa — ver specs/ui_reorganization_geoman.md) —
// cálculo de área/auto-intersección y restricción de tipo de geometría
// por tabla destino. Separadas de
// app/dashboard/qc/components/VectorEditorTools.jsx (que sí depende de
// Leaflet/geoman y JSX, no testeable con node --test sin jsdom) para que
// node --test pueda importar este módulo directo. Ver specs/gis_vector_editor.md.

import kinks from '@turf/kinks'
import { TARGET_TABLE_GEOMETRY_TYPES } from './gisTargetTables.js'
import { calcularAreaHa, calcularPerimetroM } from './geo/areaUtils.js'
import { MIN_POLYGON_HECTARES } from './eudrDdsExporter.js'

/**
 * HALLAZGO REAL (no un simple "falta implementar"): mientras se está
 * dibujando un polígono, geoman todavía no lo serializa como GeoJSON tipo
 * `Polygon` — `workingLayer.toGeoJSON().geometry.type` es `LineString`
 * hasta que el anillo se cierra (clic sobre el primer vértice o
 * "Finalizar"). Confirmado en vivo con un log temporal: con 3 vértices
 * colocados, `geometry.type` seguía siendo `"LineString"`. Como
 * calcularAreaHa/calcularPerimetroM solo calculan para Polygon/
 * MultiPolygon, sin esta conversión el panel de información en vivo
 * habría mostrado siempre `null` mientras se dibuja — nunca actualizando
 * "en cada vértice" como pide la spec, solo al terminar (pm:create). Acá
 * se sintetiza un anillo cerrado a partir del LineString en construcción
 * (>= 3 puntos) SOLO para esta estimación de UI — nunca se persiste ni
 * se usa para nada más que area/perímetro/auto-intersección en vivo.
 */
function toPreviewPolygon(geometry) {
  if (geometry?.type !== 'LineString' || !geometry.coordinates || geometry.coordinates.length < 3) {
    return geometry
  }
  const ring = [...geometry.coordinates]
  const [firstLng, firstLat] = ring[0]
  const [lastLng, lastLat] = ring[ring.length - 1]
  if (firstLng !== lastLng || firstLat !== lastLat) ring.push(ring[0])
  return { type: 'Polygon', coordinates: [ring] }
}

/**
 * Margen de seguridad para el badge "área < 4.0 ha" — ver
 * docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md, sección
 * "Divergencia turf/PostGIS cuantificada". Medido empíricamente contra
 * `fn_calcular_area_ha` real (consulta RPC en vivo, no una fórmula
 * reimplementada a mano) con 7 polígonos entre 3.90 y 4.10 ha en
 * coordenadas reales de operación de RYZOS (Jaén, Cajamarca, lat ≈
 * -5.89° — tomadas de un polígono EUDR_MONITOREO real vía REST), más 2
 * formas adicionales (rectángulo 4:1, pentágono irregular) para
 * confirmar que la divergencia no depende de la forma del polígono:
 * turf.js (esfera aproximada) SIEMPRE sobreestima el área respecto a
 * PostGIS (`ST_Area(geometry::geography)`, geodésico WGS84) en esta
 * zona — divergencia consistente de ~0.0170–0.0177 ha (~0.43–0.44%),
 * nunca en la dirección contraria, prácticamente idéntica sin importar
 * la forma probada.
 *
 * Como turf siempre sobreestima, un polígono cuya área REAL (server) ya
 * está por debajo de 4.0 ha puede aparecer en el cliente como >= 4.0 ha
 * — el badge informativo no se mostraría pese a que el server sí
 * consideraría el área por debajo del umbral ("sub-advertencia" del
 * cliente respecto al server). CLIENT_AREA_SAFETY_MARGIN_HA compensa
 * corriendo el punto de disparo del cliente hacia arriba (~70% de
 * margen sobre el máximo medido, ~0.0177 ha, redondeado a 0.03 ha) para
 * que el cliente jamás deje de mostrar el aviso en un caso donde el
 * server sí lo mostraría. No es un margen simétrico "por las dudas" —
 * refleja la dirección real y medida de la divergencia.
 */
const CLIENT_AREA_SAFETY_MARGIN_HA = 0.03

/**
 * Calcula área en hectáreas + perímetro en metros (solo Polygon/
 * MultiPolygon, `null` para el resto — vía lib/geo/areaUtils.js, mismo
 * redondeo a 4 decimales que fn_calcular_area_ha server-side) y detecta
 * auto-intersecciones (@turf/kinks, solo Polygon) a partir de una
 * `geometry` GeoJSON. Estimación de UI mientras se dibuja — NO es el
 * valor autoritativo (ese lo calcula PostGIS server-side, ver ADR-001).
 * Nunca lanza: una geometría todavía incompleta hace que @turf/kinks
 * lance internamente — se captura y se devuelve `false` en vez de
 * propagar el error a la UI mientras el usuario sigue dibujando
 * (calcularAreaHa/calcularPerimetroM ya son defensivas por su cuenta).
 *
 * `polygonBelowThreshold`: true solo cuando la geometría es Polygon/
 * MultiPolygon Y su área (con el margen de seguridad de arriba
 * restado, ver CLIENT_AREA_SAFETY_MARGIN_HA) es menor a
 * MIN_POLYGON_HECTARES (lib/eudrDdsExporter.js — misma regla ya usada
 * para exigir Polygon en el export DDS, "parcelas >= 4.0 ha exigen
 * representación tipo Polygon") — informativo, nunca bloqueante (una
 * parcela chica sigue siendo un Polygon válido, la regla real no exige
 * el sentido inverso). NO existe un `pointExceedsThreshold` equivalente:
 * un Point no tiene área medible por definición, así que no hay forma de
 * calcular en vivo si "el área supera 4.0 ha" mientras se dibuja un
 * marcador — esa comprobación solo sería posible cruzando contra el área
 * YA registrada de la parcela real (PADRON_PARCELAS), un lookup al
 * servidor por cada cambio, explícitamente fuera de alcance de esta fase
 * (mismo criterio ya aplicado al % de solapamiento en vivo).
 */
export function evaluateGeometry(geometry) {
  if (!geometry) return { areaHa: null, perimetroM: null, selfIntersects: false, polygonBelowThreshold: false }

  const previewGeometry = toPreviewPolygon(geometry)
  const areaHa = calcularAreaHa(previewGeometry)
  const perimetroM = calcularPerimetroM(previewGeometry)

  let selfIntersects = false
  if (previewGeometry.type === 'Polygon') {
    try {
      const feature = { type: 'Feature', properties: {}, geometry: previewGeometry }
      selfIntersects = kinks(feature).features.length > 0
    } catch {
      selfIntersects = false
    }
  }

  const polygonBelowThreshold =
    (previewGeometry.type === 'Polygon' || previewGeometry.type === 'MultiPolygon') &&
    areaHa != null &&
    areaHa - CLIENT_AREA_SAFETY_MARGIN_HA < MIN_POLYGON_HECTARES

  return { areaHa, perimetroM, selfIntersects, polygonBelowThreshold }
}

/** ¿El tipo de `geometry` está permitido para `targetTable`? (ver lib/gisTargetTables.js). */
export function isGeometryAllowedForTable(geometry, targetTable) {
  const allowed = TARGET_TABLE_GEOMETRY_TYPES[targetTable] || []
  return allowed.includes(geometry?.type)
}
