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
 * Rechaza ID_Socio/ID_Parcela_Fija/id_parcela que no existan, no
 * pertenezcan a la organización activa, o estén dados de baja
 * (`activo = false`, ver ADR-016) — antes de esta tarea (ADR-019),
 * uploadGeoSpatialFeature aceptaba cualquier texto en estos campos sin
 * validar nada contra PADRON_SOCIOS/PADRON_PARCELAS (confirmado leyendo
 * el código: solo se chequeaba "no vacío" donde `required: true`).
 * Ambos helpers no hacen nada si `id` viene vacío — ID_Socio/
 * ID_Parcela_Fija son opcionales en EUDR_MONITOREO (ver
 * lib/gisTargetTables.js), así que la ausencia de valor sigue siendo
 * válida; solo se valida cuando SÍ se proveyó un código. Mismo patrón que
 * assertSocioExists (lib/actions/sociosActions.js): filtra por
 * `ID_Organizacion` directo en la query (ver HOTFIX debajo -- reemplaza
 * la comparación con `orgIdsMatch` que este párrafo describía
 * originalmente, superada por la migración de PK).
 */
// HOTFIX PK multi-organización (2026-08-25, ver
// specs/multi_organizacion_codigos_unicos.md): ID_Socio/ID_Parcela_Fija ya
// no son PK -- .maybeSingle() sin filtrar por organización lanzaría
// PGRST116 apenas dos organizaciones compartan un código. organizationId
// ya es un dato conocido acá (igual que assertSocioExists en
// lib/actions/sociosActions.js), así que se filtra la consulta por ambas
// columnas directamente en vez de comparar con orgIdsMatch después --
// tras el UNIQUE(ID_Organizacion, ID_Socio) de la migración de PK esto
// vuelve a garantizar 0-o-1 fila.
async function assertSocioActivoOSinValor(supabase, socioId, organizationId) {
  if (!socioId) return
  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .select('activo')
    .eq('ID_Socio', socioId)
    .eq('ID_Organizacion', organizationId)
    .maybeSingle()
  if (error) {
    console.error('[gisActions] assertSocioActivoOSinValor:', error)
    throw error
  }
  if (!data || data.activo !== true) {
    throw new GisActionError(
      `El Código de Socio "${socioId}" no existe, no pertenece a esta organización, o está dado de baja.`
    )
  }
}

async function assertParcelaActivaOSinValor(supabase, parcelaId, organizationId) {
  if (!parcelaId) return
  const { data, error } = await supabase
    .from('PADRON_PARCELAS')
    .select('activo')
    .eq('ID_Parcela_Fija', parcelaId)
    .eq('ID_Organizacion', organizationId)
    .maybeSingle()
  if (error) {
    console.error('[gisActions] assertParcelaActivaOSinValor:', error)
    throw error
  }
  if (!data || data.activo !== true) {
    throw new GisActionError(
      `El Código de Parcela "${parcelaId}" no existe, no pertenece a esta organización, o está dado de baja.`
    )
  }
}

/**
 * ADR-021 — resuelve el identificador técnico real (`qfield_relation_id`)
 * del `EUDR_MONITOREO` padre de un código legible de `PADRON_PARCELAS`
 * (`ID_Parcela_Fija`), para escribirlo en `EUDR_USO_SUELO.id_parcela` en
 * vez del código legible mismo — ver el hallazgo completo en ADR-021: esa
 * columna, pese al nombre, nunca fue pensada para llevar un código de
 * PADRON_PARCELAS (confirmado con datos reales: toda fila existente hoy
 * tiene un GUID de QField, formato `{xxxxxxxx-...}`, igual a
 * `EUDR_MONITOREO.qfield_relation_id` — ver ADR-010) — escribir ahí el
 * código legible rompía en silencio `fn_cobertura_uso_suelo_parcela`
 * (Fase B) para cualquier dato creado desde el Editor Vectorial/Cargar
 * Capa Espacial, ya que el join real es
 * `EUDR_USO_SUELO.id_parcela = EUDR_MONITOREO.qfield_relation_id`, nunca
 * contra `ID_Parcela_Fija`.
 *
 * Mismo criterio "nunca asumir ante ambigüedad" que
 * app/api/qc/cobertura-uso-suelo/route.js (misma relación, sentido
 * inverso): si hay 0 o más de 1 `EUDR_MONITOREO` con ese
 * `ID_Parcela_Fija` en esta organización, o el único candidato todavía no
 * tiene su propio `qfield_relation_id` (ej. se creó antes de esta
 * corrección), devuelve `null` — nunca bloquea el guardado de la
 * subdivisión, coherente con `SIN_VINCULO_MENSAJE`
 * (lib/qcCoberturaUsoSuelo.js): la subdivisión igual se guarda, solo
 * queda "sin vínculo" para el cálculo de cobertura hasta que alguien lo
 * resuelva a mano.
 *
 * Resolución en vivo (no memoria de sesión del lado del cliente): esto es
 * a propósito — funciona igual sin importar si el Monitoreo padre se creó
 * momentos antes en la misma sesión, en una carga anterior, o llegó por
 * QField, y nunca vincula a un Monitoreo equivocado si el usuario cambia
 * de parcela a mitad de sesión (el código legible seleccionado en pantalla
 * es siempre la fuente de verdad para esta búsqueda).
 */
async function resolveQfieldRelationId(supabase, idParcelaFija, organizationId) {
  if (!idParcelaFija) return null
  const { data, error } = await supabase
    .from('EUDR_MONITOREO')
    .select('qfield_relation_id')
    .eq('ID_Parcela_Fija', idParcelaFija)
    .eq('ID_Organizacion', organizationId)
  if (error) {
    console.error('[gisActions] resolveQfieldRelationId:', error)
    throw error
  }
  if (!data || data.length !== 1) return null
  return data[0].qfield_relation_id || null
}

/**
 * Inserta un registro en EUDR_MONITOREO/EUDR_USO_SUELO/EUDR_INSTALACIONES.
 * No llama a fn_sanitize_geometry ni calcula área a mano (ver nota de
 * cabecera) — solo entrega el WKT crudo al trigger, que hace el resto.
 * `estado_revision` SIEMPRE 'PENDIENTE': un registro subido acá entra al
 * mismo flujo de revisión QGIS QC (Fase 3) que ya usan los datos de
 * campo — nunca se marca aprobado directo desde este módulo.
 *
 * `qfield_relation_id` (ADR-021, solo EUDR_MONITOREO): antes de esta
 * tarea, un Monitoreo creado acá quedaba con esta columna en NULL para
 * siempre — el ETL de Python (scripts/etl_drive_to_supabase.py) es el
 * único otro lugar que la llena, copiando tal cual el `id_monitoreo`
 * crudo que QField ya trae en la fila (`row.get("id_monitoreo")`, nunca
 * generado por el ETL — confirmado leyendo el código real, no asumido).
 * Acá SÍ hace falta generarlo, porque no existe ningún GUID de QField de
 * origen para un registro dibujado a mano: `crypto.randomUUID()` (misma
 * API ya usada 2 líneas abajo para `id_monitoreo`, el estándar Web
 * Crypto, no la librería `uuid`) — deliberadamente SIN las llaves `{}`
 * que sí traen los GUID reales de QField, para que sea fácil distinguir
 * a simple vista un vínculo generado acá de uno que vino de campo; el
 * join en sí es una comparación de string exacta
 * (`EUDR_USO_SUELO.id_parcela = EUDR_MONITOREO.qfield_relation_id`), así
 * que el formato exacto no le importa a ninguna consulta real.
 */
async function insertEudrCoreRecord(supabase, table, geometryWkt, organizationId, fields) {
  const payload = { ID_Organizacion: organizationId, estado_revision: 'PENDIENTE', ...fields }
  if (table === 'EUDR_MONITOREO') {
    payload.id_monitoreo = crypto.randomUUID()
    payload.geom_inspeccion = geometryWkt
    payload.qfield_relation_id = crypto.randomUUID()
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
    await assertSocioActivoOSinValor(supabase, fieldOverrides.ID_Socio, organizationId)
    await assertParcelaActivaOSinValor(supabase, fieldOverrides.ID_Parcela_Fija, organizationId)
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
    // ADR-021: fieldOverrides.id_parcela es el código legible de
    // PADRON_PARCELAS (ID_Parcela_Fija) — se sigue validando tal cual
    // (existe, activo, misma organización, sin cambios respecto a
    // ADR-019). Pero lo que se GUARDA en la columna id_parcela ya no es
    // ese código: es el identificador técnico real del Monitoreo padre
    // (resolveQfieldRelationId, arriba) — o null si no se puede resolver
    // sin ambigüedad, caso que NO bloquea el guardado (ver
    // SIN_VINCULO_MENSAJE, lib/qcCoberturaUsoSuelo.js).
    await assertParcelaActivaOSinValor(supabase, fieldOverrides.id_parcela, organizationId)
    const qfieldRelationId = await resolveQfieldRelationId(supabase, fieldOverrides.id_parcela, organizationId)
    await insertEudrCoreRecord(supabase, targetTable, geometryWkt, organizationId, {
      id_parcela: qfieldRelationId,
      tipo_uso: fieldOverrides.tipo_uso || null,
    })
    return { created: true, vinculoResuelto: qfieldRelationId !== null }
  }

  // EUDR_INSTALACIONES
  if (!fieldOverrides.id_parcela) {
    throw new GisActionError('Falta "id_parcela" — requerido para EUDR_INSTALACIONES.')
  }
  await assertParcelaActivaOSinValor(supabase, fieldOverrides.id_parcela, organizationId)
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
