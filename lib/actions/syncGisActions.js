'use server'

// Procesador server-side de SYNC_QUEUE para el dominio WebGIS (ver
// specs/sync_queue_webgis_ingestion.md, docs/adr/ADR-041-procesador-
// sync-queue-webgis.md). SYNC_QUEUE (ADR-040) es una cola genérica de
// mutaciones offline -- ninguna app React Native/Expo existe todavía,
// así que hoy solo se siembra manualmente (pruebas) o desde una futura
// app móvil. Esta es su primera consumidora: drena las filas PENDIENTE
// que apuntan a EUDR_MONITOREO/EUDR_USO_SUELO/EUDR_INSTALACIONES y las
// inserta de verdad.
//
// CORRECCIÓN DE CONTRATO (ver el spec): el prompt original pedía filtrar
// por una columna "tabla_destino" y guardar el error en "error_log"/
// "synced_at" -- esas columnas no existen. El schema real de SYNC_QUEUE
// (ADR-040) usa `entity_type`, `error_mensaje` y `procesado_en`.
//
// DECISIÓN: no se valida el payload con Zod (no existe ningún esquema
// Zod para estas 3 tablas en el repo, y escribir uno nuevo duplicaría
// validación que ya existe y ya está probada en uploadGeoSpatialFeature
// y sus helpers). Se llama directo a uploadGeoSpatialFeature con
// organizationId=null -- desde ADR-038, las 3 ramas EUDR de esa función
// ya ignoran ese parámetro y resuelven la organización real vía
// auth_org_id() bajo la sesión activa, el mismo mecanismo que usa este
// procesador para leer/escribir SYNC_QUEUE.

import { createSessionServerClient } from '@/lib/supabase/sessionServerClient'
import { uploadGeoSpatialFeature } from '@/lib/actions/gisActions'
import { GisActionError } from '@/lib/actions/gisActionError'
import { SocioActionError } from '@/lib/actions/socioActionError'

const WEBGIS_ENTITY_TYPES = ['EUDR_MONITOREO', 'EUDR_USO_SUELO', 'EUDR_INSTALACIONES']

function errorMessage(err) {
  return err instanceof GisActionError || err instanceof SocioActionError
    ? err.message
    : err?.message || 'Error desconocido.'
}

export async function processWebGisSyncQueue() {
  const supabase = await createSessionServerClient()

  const { data: rows, error: fetchError } = await supabase
    .from('SYNC_QUEUE')
    .select('id, entity_type, payload')
    .eq('estado', 'PENDIENTE')
    .eq('operation', 'INSERT')
    .in('entity_type', WEBGIS_ENTITY_TYPES)
    .order('creado_en', { ascending: true })

  if (fetchError) throw fetchError

  let procesados = 0
  let errores = 0
  const detalles = []

  for (const row of rows || []) {
    try {
      const { feature, fieldOverrides } = row.payload || {}
      const resultado = await uploadGeoSpatialFeature(row.entity_type, feature, null, fieldOverrides || {})

      const { error: updateError } = await supabase
        .from('SYNC_QUEUE')
        .update({ estado: 'PROCESADO', procesado_en: new Date().toISOString(), error_mensaje: null })
        .eq('id', row.id)
      if (updateError) throw updateError

      procesados += 1
      detalles.push({ id: row.id, ok: true, ...resultado })
    } catch (err) {
      const message = errorMessage(err)

      const { error: updateError } = await supabase
        .from('SYNC_QUEUE')
        .update({ estado: 'ERROR', error_mensaje: message })
        .eq('id', row.id)
      if (updateError) throw updateError

      errores += 1
      detalles.push({ id: row.id, ok: false, error: message })
    }
  }

  return { procesados, errores, total: (rows || []).length, detalles }
}
