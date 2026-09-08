// Fuente única de verdad para las 4 tablas destino del módulo GIS
// (Ingestor de Capas Espaciales + Editor Vectorial) — compartida entre
// app/dashboard/qc/components/CargaEspacialModal.jsx y
// app/dashboard/qc/components/VectorEditorTools.jsx (ambos reubicados
// desde /dashboard/mapa, ver specs/gis_qc_rearchitecture.md y
// specs/ui_reorganization_geoman.md) para que ninguno de los dos
// redefina localmente los mismos labels/campos y diverjan con el tiempo
// (mismo criterio que HECTARE_FIELDS/CERT_FLAG_FIELDS en
// lib/validations/socios.js). Ver specs/gis_ingestor_web.md y
// specs/gis_vector_editor.md.

import { LAND_USE_STYLES } from './gisLandUseStyles.js'

export const TARGET_TABLE_LABELS = {
  PADRON_PARCELAS: 'Parcelas (Padrón)',
  EUDR_MONITOREO: 'Monitoreo EUDR (perímetro)',
  EUDR_USO_SUELO: 'Uso de Suelo',
  EUDR_INSTALACIONES: 'Instalaciones',
}

// Vive acá (no en lib/actions/gisActions.js) a propósito: ese archivo
// tiene 'use server' arriba, y Next.js solo permite exportar funciones
// async desde un módulo así — un array plano importado desde un
// componente cliente se resuelve a un valor opaco que revienta en
// runtime al llamar .map() (confirmado en vivo, ver
// specs/gis_vector_editor.md). gisActions.js reexporta esta misma
// constante para no romper el import existente en código que ya la
// importaba desde ahí.
export const GIS_TARGET_TABLES = Object.keys(TARGET_TABLE_LABELS)

// Campos editables por Feature, por tabla destino — `required` controla
// si una fila/geometría puede confirmarse (chequeo básico de "no vacío");
// la validación real y completa vive del lado del servidor (createParcela
// para PADRON_PARCELAS, o el propio insert para las tablas EUDR_*, ver
// lib/actions/gisActions.js). Un campo con `options` (array de
// `{ value, label }`) hace que VectorEditorTools.jsx renderice un
// `<select>` en vez del `<input type="text">` genérico — hoy solo
// `tipo_uso` lo usa (ADR-019), poblado desde LAND_USE_STYLES
// (lib/gisLandUseStyles.js) para no duplicar las 7 categorías reales en
// un segundo lugar; `value` es el `label` exacto de cada categoría (texto
// legible, consistente con lo que ya escriben los técnicos a mano en
// `tipo_uso` — ver el comentario de `normalizeKey` en MapDashboard.jsx
// sobre las variantes de ortografía existentes en datos reales).
const TIPO_USO_OPTIONS = LAND_USE_STYLES.map((s) => ({ value: s.label, label: s.label }))

// Un campo con `padronEntity: 'socio'` | `'parcela'` (ADR-019) hace que
// VectorEditorTools.jsx renderice un autocompletado real contra
// PADRON_SOCIOS/PADRON_PARCELAS (lib/padronSearch.js, mismo mecanismo que
// el formulario de Inspecciones) en vez del `<input type="text">`
// genérico — solo puede elegirse un socio/parcela que exista y esté
// activo. Marcado únicamente en EUDR_MONITOREO/EUDR_USO_SUELO/
// EUDR_INSTALACIONES, las 3 tablas que el Editor Vectorial de la Consola
// QC realmente ofrece (QC_DRAWABLE_TABLES en QcConsoleMap.jsx nunca
// incluye PADRON_PARCELAS) — deliberadamente NO se marca en
// PADRON_PARCELAS.ID_Socio: ese campo lo consume el Ingestor de Capas
// Espaciales (CargaEspacialModal.jsx), fuera de alcance de esta tarea, y
// su validación de existencia ya la hace `createParcela` (assertSocioExists,
// lib/actions/sociosActions.js) por su cuenta.
export const TARGET_TABLE_FIELDS = {
  PADRON_PARCELAS: [
    { key: 'ID_Socio', label: 'Código de Socio', required: true },
    { key: 'parcela_codigo', label: 'Código Interno de Parcela', required: false },
  ],
  EUDR_MONITOREO: [
    { key: 'ID_Socio', label: 'Código de Socio', required: false, padronEntity: 'socio' },
    { key: 'ID_Parcela_Fija', label: 'Código de Parcela', required: false, padronEntity: 'parcela' },
  ],
  EUDR_USO_SUELO: [
    { key: 'id_parcela', label: 'Código de Parcela', required: true, padronEntity: 'parcela' },
    { key: 'tipo_uso', label: 'Tipo de Uso', required: false, options: TIPO_USO_OPTIONS },
  ],
  EUDR_INSTALACIONES: [
    { key: 'id_parcela', label: 'Código de Parcela', required: true, padronEntity: 'parcela' },
    { key: 'tipo_infra', label: 'Tipo de Infraestructura', required: false },
  ],
}

// Tipos de geometría GeoJSON aceptados por tabla destino — regla ya
// establecida como comentario en components/gis/MapDashboard.jsx
// ("EUDR_USO_SUELO nunca aporta geometrías puntuales" / "EUDR_INSTALACIONES
// ... siempre punto — nunca aporta polígonos"), extendida acá a las 4
// tablas. PADRON_PARCELAS: una parcela se delimita con un perímetro
// (mismo criterio implícito en lib/eudrDdsExporter.js). EUDR_MONITOREO:
// geometría genérica, Point o Polygon según cómo capturó el técnico
// (docs/schema_live_agricola.md).
export const TARGET_TABLE_GEOMETRY_TYPES = {
  PADRON_PARCELAS: ['Polygon'],
  EUDR_MONITOREO: ['Polygon', 'Point'],
  EUDR_USO_SUELO: ['Polygon'],
  EUDR_INSTALACIONES: ['Point'],
}
