// Funciones puras del Editor Vectorial WebGIS (/dashboard/qc, reubicado
// desde /dashboard/mapa — ver specs/ui_reorganization_geoman.md) —
// cálculo de área/auto-intersección y restricción de tipo de geometría
// por tabla destino. Separadas de
// app/dashboard/qc/components/VectorEditorTools.jsx (que sí depende de
// Leaflet/geoman y JSX, no testeable con node --test sin jsdom) para que
// node --test pueda importar este módulo directo. Ver specs/gis_vector_editor.md.

import area from '@turf/area'
import kinks from '@turf/kinks'
import { TARGET_TABLE_GEOMETRY_TYPES } from './gisTargetTables.js'

/**
 * Calcula área en hectáreas (solo Polygon/MultiPolygon, `null` para el
 * resto) y detecta auto-intersecciones (@turf/kinks, solo Polygon) a
 * partir de una `geometry` GeoJSON. Estimación de UI mientras se dibuja —
 * NO es el valor autoritativo (ese lo calcula PostGIS server-side vía
 * fn_calcular_area_ha, ver ADR-001). Nunca lanza: una geometría todavía
 * incompleta hace que @turf/kinks/area lancen internamente — se captura y
 * se devuelve `null`/`false` en vez de propagar el error a la UI mientras
 * el usuario sigue dibujando.
 */
export function evaluateGeometry(geometry) {
  if (!geometry) return { areaHa: null, selfIntersects: false }
  const feature = { type: 'Feature', properties: {}, geometry }

  let areaHa = null
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    try {
      areaHa = area(feature) / 10000
    } catch {
      areaHa = null
    }
  }

  let selfIntersects = false
  if (geometry.type === 'Polygon') {
    try {
      selfIntersects = kinks(feature).features.length > 0
    } catch {
      selfIntersects = false
    }
  }

  return { areaHa, selfIntersects }
}

/** ¿El tipo de `geometry` está permitido para `targetTable`? (ver lib/gisTargetTables.js). */
export function isGeometryAllowedForTable(geometry, targetTable) {
  const allowed = TARGET_TABLE_GEOMETRY_TYPES[targetTable] || []
  return allowed.includes(geometry?.type)
}
