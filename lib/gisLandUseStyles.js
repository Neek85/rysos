// Fuente única de verdad para las 7 categorías reales de "Uso de Suelo"
// (EUDR_USO_SUELO, siempre polígono) — antes vivían solo como
// LAND_USE_STYLES, definida localmente dentro de
// components/gis/MapDashboard.jsx para la leyenda/estilo de color del
// mapa. Extraídas acá (ADR-019) para que lib/gisTargetTables.js pueda
// poblar el <select> del campo "Tipo de Uso" del Editor Vectorial
// (VectorEditorTools.jsx) sin duplicar la lista en un segundo lugar —
// MapDashboard.jsx importa de acá en vez de definir su propia copia.
//
// `color`/`fillColor`/`fillOpacity`/`icon` solo los usa MapDashboard.jsx
// (estilo de mapa) — el Editor Vectorial únicamente necesita `key`/`label`
// para las <option>, pero se exporta el objeto completo para no bifurcar
// la fuente en 2 formas distintas de la misma lista.
export const LAND_USE_STYLES = [
  { key: 'produccion', label: 'Producción', color: '#16a34a', fillColor: '#22c55e', fillOpacity: 0.35, icon: '🟢' },
  { key: 'crecimiento', label: 'Crecimiento', color: '#65a30d', fillColor: '#84cc16', fillOpacity: 0.35, icon: '🌱' },
  { key: 'pan llevar', label: 'Pan Llevar', color: '#d97706', fillColor: '#f59e0b', fillOpacity: 0.35, icon: '🟧' },
  { key: 'inverna pasto', label: 'Inverna/Pasto', color: '#ca8a04', fillColor: '#eab308', fillOpacity: 0.35, icon: '🌾' },
  { key: 'rastrojo purma', label: 'Rastrojo/Purma', color: '#92400e', fillColor: '#b45309', fillOpacity: 0.35, icon: '🍂' },
  { key: 'bosque', label: 'Bosque', color: '#14532d', fillColor: '#15803d', fillOpacity: 0.45, icon: '🌲' },
  { key: 'otras areas', label: 'Otras áreas', color: '#6b7280', fillColor: '#9ca3af', fillOpacity: 0.3, icon: '🔘' },
]
