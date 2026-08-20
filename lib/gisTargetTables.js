// Fuente única de verdad para las 4 tablas destino del módulo GIS
// (Ingestor de Capas Espaciales + Editor Vectorial) — compartida entre
// app/dashboard/qc/components/CargaEspacialModal.jsx (reubicado desde
// /dashboard/mapa, ver specs/gis_qc_rearchitecture.md) y
// app/dashboard/mapa/components/VectorEditorTools.jsx para que ninguno de
// los dos redefina localmente los mismos labels/campos y diverjan con el
// tiempo (mismo criterio que HECTARE_FIELDS/CERT_FLAG_FIELDS en
// lib/validations/socios.js). Ver specs/gis_ingestor_web.md y
// specs/gis_vector_editor.md.

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
// lib/actions/gisActions.js).
export const TARGET_TABLE_FIELDS = {
  PADRON_PARCELAS: [
    { key: 'ID_Socio', label: 'Código de Socio', required: true },
    { key: 'parcela_codigo', label: 'Código Interno de Parcela', required: false },
  ],
  EUDR_MONITOREO: [
    { key: 'ID_Socio', label: 'Código de Socio', required: false },
    { key: 'ID_Parcela_Fija', label: 'Código de Parcela', required: false },
  ],
  EUDR_USO_SUELO: [
    { key: 'id_parcela', label: 'Código de Parcela', required: true },
    { key: 'tipo_uso', label: 'Tipo de Uso', required: false },
  ],
  EUDR_INSTALACIONES: [
    { key: 'id_parcela', label: 'Código de Parcela', required: true },
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
// (docs/schema_live.md).
export const TARGET_TABLE_GEOMETRY_TYPES = {
  PADRON_PARCELAS: ['Polygon'],
  EUDR_MONITOREO: ['Polygon', 'Point'],
  EUDR_USO_SUELO: ['Polygon'],
  EUDR_INSTALACIONES: ['Point'],
}
