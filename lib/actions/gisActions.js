'use server'

// Server Actions de escritura para el Ingestor de Capas Espaciales
// (/dashboard/mapa) — ver specs/gis_ingestor_web.md. Primer path de
// escritura del frontend hacia EUDR_MONITOREO/EUDR_USO_SUELO/
// EUDR_INSTALACIONES (antes solo el ETL de Python y QGIS Desktop
// escribían esas 3 tablas). Corren con la Service Role Key
// (lib/supabaseServerClient.js), mismo patrón que
// lib/actions/sociosActions.js.
//
// REGLA DE ÁREA/POLÍGONO: deliberadamente NO HAY ninguna validación de
// hectáreas ni de tipo de geometría en este archivo. La regla ≥4ha ->
// Polygon obligatorio es informativa, nunca bloqueante (confirmado con el
// usuario para este módulo, mismo criterio que ADR-001) — para las 3
// tablas EUDR_*, el trigger de base de datos
// (trg_sanitize_geom_monitoreo/uso_suelo/instalaciones,
// supabase/migrations/20260818_gis_core_sanitization.sql) ya calcula
// area_calculada_ha/requiere_revision_area automáticamente al insertar;
// duplicar ese cálculo acá sería redundante y podría desincronizarse del
// trigger real si cambia. El único lugar del sistema donde esa regla sí
// bloquea es lib/eudrDdsExporter.js::validatePlotGeometry, y solo al
// exportar la DDS, no al guardar.

import { getSupabaseServerClient } from '@/lib/supabaseServerClient'
import { geoJsonToWkt } from '@/lib/geometryImport'
import { createParcela } from '@/lib/actions/sociosActions'
import { GisActionError } from '@/lib/actions/gisActionError'
import { SocioActionError } from '@/lib/actions/socioActionError'
import { GIS_TARGET_TABLES } from '@/lib/gisTargetTables'

// NOTA: GIS_TARGET_TABLES se define en lib/gisTargetTables.js (no acá) y
// NO se reexporta desde este archivo — este módulo tiene 'use server'
// arriba, y Next.js solo permite exportar funciones async desde un
// módulo así; un array reexportado desde acá igual se rompe en runtime
// del lado del cliente (confirmado en vivo). Cualquier componente
// cliente que necesite la lista de tablas debe importarla directo de
// lib/gisTargetTables.js.

function assertOrganizacion(organizationId) {
  if (!organizationId) {
    throw new GisActionError('No se pudo determinar la organización activa.')
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Inserta un registro en EUDR_MONITOREO/EUDR_USO_SUELO/EUDR_INSTALACIONES.
 * No llama a fn_sanitize_geometry ni calcula área a mano (ver nota de
 * cabecera) — solo entrega el WKT crudo al trigger, que hace el resto.
 * `estado_revision` SIEMPRE 'PENDIENTE': un registro subido acá entra al
 * mismo flujo de revisión QGIS QC (Fase 3) que ya usan los datos de
 * campo — nunca se marca aprobado directo desde este módulo.
 */
async function insertEudrCoreRecord(supabase, table, geometryWkt, organizationId, fields) {
  const payload = { ID_Organizacion: organizationId, estado_revision: 'PENDIENTE', ...fields }
  if (table === 'EUDR_MONITOREO') {
    payload.id_monitoreo = crypto.randomUUID()
    payload.geom_inspeccion = geometryWkt
  } else {
    payload.geom = geometryWkt
  }
  const { error } = await supabase.from(table).insert(payload)
  if (error) {
    console.error(`[gisActions] insertEudrCoreRecord(${table}):`, error)
    throw error
  }
}

/**
 * Sube una Feature ya parseada (geometry GeoJSON + properties del
 * archivo, ver lib/gisParser.js) a la tabla destino elegida en el modal.
 * `fieldOverrides`: valores auto-detectados por autoMatchProperties y
 * confirmados/corregidos por el usuario en la vista previa — nunca se
 * escribe a ciegas con lo que trae el archivo.
 *
 * PADRON_PARCELAS delega en createParcela (lib/actions/sociosActions.js)
 * en vez de reimplementar el insert acá — hereda su validación Zod
 * completa (incluida la regla "hectáreas totales > 0", que un archivo
 * espacial puro normalmente no trae como atributo: esas filas fallan con
 * el mismo mensaje que ya usa el resto del módulo Socios, no uno nuevo) y
 * su sanitización de geometría vía RPC fn_sanitize_geometry (única de las
 * 4 tablas destino sin trigger de sanitización automático).
 */
export async function uploadGeoSpatialFeature(targetTable, feature, organizationId, fieldOverrides = {}) {
  assertOrganizacion(organizationId)
  if (!GIS_TARGET_TABLES.includes(targetTable)) {
    throw new GisActionError(`Tabla destino no soportada: "${targetTable}".`)
  }
  if (!feature?.geometry) {
    throw new GisActionError('La Feature no tiene geometría.')
  }
  const geometryWkt = geoJsonToWkt(feature.geometry)

  if (targetTable === 'PADRON_PARCELAS') {
    return createParcela({ ...feature.properties, ...fieldOverrides }, organizationId, feature.geometry)
  }

  const supabase = getSupabaseServerClient()

  if (targetTable === 'EUDR_MONITOREO') {
    await insertEudrCoreRecord(supabase, targetTable, geometryWkt, organizationId, {
      ID_Parcela_Fija: fieldOverrides.ID_Parcela_Fija || null,
      ID_Socio: fieldOverrides.ID_Socio || null,
      fecha_monitoreo: todayIso(),
      tecnico_responsable: 'Carga Web (Ingestor Espacial)',
      observaciones: '[Cargado vía Ingestor Espacial Web /dashboard/mapa]',
    })
    return { created: true }
  }

  if (targetTable === 'EUDR_USO_SUELO') {
    if (!fieldOverrides.id_parcela) {
      throw new GisActionError('Falta "id_parcela" — requerido para EUDR_USO_SUELO.')
    }
    await insertEudrCoreRecord(supabase, targetTable, geometryWkt, organizationId, {
      id_parcela: fieldOverrides.id_parcela,
      tipo_uso: fieldOverrides.tipo_uso || null,
    })
    return { created: true }
  }

  // EUDR_INSTALACIONES
  if (!fieldOverrides.id_parcela) {
    throw new GisActionError('Falta "id_parcela" — requerido para EUDR_INSTALACIONES.')
  }
  await insertEudrCoreRecord(supabase, targetTable, geometryWkt, organizationId, {
    id_parcela: fieldOverrides.id_parcela,
    tipo_infra: fieldOverrides.tipo_infra || null,
  })
  return { created: true }
}

/**
 * Sube un lote de Features ya parseadas y confirmadas en la vista previa
 * del modal. Una fila fallida no aborta el resto del lote — mismo patrón
 * "creados/fallidos con detalle" que handleConfirmImport en
 * components/features/socios/ImportPadronModal.jsx.
 * `items`: [{ feature, overrides, index }].
 */
export async function uploadGeoSpatialBatch(targetTable, items, organizationId) {
  let created = 0
  const failures = []

  for (const { feature, overrides, index } of items) {
    try {
      await uploadGeoSpatialFeature(targetTable, feature, organizationId, overrides)
      created += 1
    } catch (err) {
      failures.push({
        index,
        message:
          err instanceof GisActionError || err instanceof SocioActionError
            ? err.message
            : err?.message || 'Error desconocido.',
      })
    }
  }

  return { created, failed: failures.length, failures }
}
