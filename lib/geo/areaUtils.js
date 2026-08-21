// Cálculo de área/perímetro en vivo del Editor Vectorial (Fase 2 —
// panel de información al dibujar geometría nueva) — ver
// specs/consola_qc_layout_y_validacion.md (addendum panel de dibujo) y
// docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md.
//
// CORRECCIÓN DE PREMISA: el prompt pedía que el redondeo coincidiera con
// "el ROUND(...,4) usado en fn_validar_topologia_eudr" — esa función no
// calcula el área ella misma, reutiliza `fn_calcular_area_ha(v_geom)`
// (supabase/migrations/20260818_gis_core_sanitization.sql, línea 88):
//
//   ROUND((ST_Area(p_geom::geography) / 10000)::numeric, 4)
//
// Esa es la constante real con la que hay que coincidir — 4 decimales,
// sobre hectáreas geodésicas (`::geography`, no grados planos de un CRS
// geográfico crudo). AREA_HA_DECIMALS de acá abajo es la ÚNICA constante
// de redondeo del lado del cliente para área — si el redondeo server-side
// cambia alguna vez, se actualiza acá y en ningún otro lugar más del
// frontend (evaluateGeometry en lib/gisVectorEditor.js consume esta
// función en vez de reimplementar el redondeo).
//
// Esto sigue siendo una ESTIMACIÓN de UI mientras se dibuja, nunca el
// valor autoritativo — ese lo recalcula PostGIS server-side vía el
// trigger trg_gis_sanitize_eudr_* (ADR-001) al guardar.
// `Math.round(x * 10**4) / 10**4` puede diferir de `ROUND(numeric, 4)` de
// Postgres en el último dígito por casos límite de punto flotante binario
// (ej. un valor exactamente en .00005) — aceptable para una vista previa
// en vivo, no relevante para lo que efectivamente se guarda.

import area from '@turf/area'
import length from '@turf/length'

export const AREA_HA_DECIMALS = 4

// Verificado explícitamente (2026-08-21, a pedido directo): Math.round(x
// * 10**n) / 10**n y Number(x.toFixed(n)) dan el MISMO resultado en el
// caso clásico de imprecisión de punto flotante (ej. 1.005 con 2
// decimales → ambos devuelven 1, no 1.01) — probado en vivo con node -e,
// no es una elección arbitraria entre dos opciones. La causa es que
// 1.005 no es representable exacto en binario IEEE754 (se guarda como
// ~1.00499999999999989...), así que cualquier técnica de redondeo nativa
// de JS ve el mismo valor "de menos" — solo una librería de precisión
// arbitraria (decimal.js/big.js) evitaría esto, y no se agrega una
// dependencia nueva para eso: el área del cliente (@turf/area, esfera
// aproximada) y la del server (ST_Area(geography), geodésica sobre el
// elipsoide WGS84) ya divergen varios dígitos ANTES del último decimal
// por usar modelos matemáticos distintos de la forma de la Tierra — un
// redondeo perfecto no las haría coincidir, solo redondearía con más
// precisión dos números que ya son distintos. Por eso esto sigue siendo
// una ESTIMACIÓN, nunca el valor autoritativo (ver comentario de arriba).
function roundTo(value, decimals) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Área en hectáreas de una geometry GeoJSON (Polygon/MultiPolygon),
 * redondeada a AREA_HA_DECIMALS — mismo criterio que fn_calcular_area_ha.
 * `null` para cualquier otro tipo (un Point no tiene área) o si turf
 * lanza (geometría todavía incompleta mientras se dibuja, antes del
 * primer polígono cerrado).
 */
export function calcularAreaHa(geometry) {
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null
  try {
    const feature = { type: 'Feature', properties: {}, geometry }
    return roundTo(area(feature) / 10000, AREA_HA_DECIMALS)
  } catch {
    return null
  }
}

/**
 * Perímetro en metros de una geometry GeoJSON (Polygon/MultiPolygon) —
 * suma la longitud de todos los anillos vía @turf/length. `null` para
 * Point (sin perímetro) o si turf lanza.
 */
export function calcularPerimetroM(geometry) {
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null
  try {
    const feature = { type: 'Feature', properties: {}, geometry }
    return Math.round(length(feature, { units: 'kilometers' }) * 1000)
  } catch {
    return null
  }
}
