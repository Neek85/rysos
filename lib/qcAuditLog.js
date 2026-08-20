// Lógica pura del endpoint /api/qc/audit-log — ver
// specs/qc_batch_audit_trail.md. Separada del Route Handler (que sí tiene
// efectos de lado reales: insert vía Service Role Key) para que sea
// testeable con node --test sin una base de datos real — mismo criterio
// que lib/qcTopologyValidation.js/lib/driveSyncTrigger.js.

// Corrección de premisa: no 'MONITOREO_APROBADO'/'MONITOREO_OBSERVADO'
// (asume una sola tabla y un estado "OBSERVADO" que no existe) — `accion`
// queda genérico, `tabla_origen` (columna separada) carga el dato de qué
// tabla. Ver la migración supabase/migrations/20260820_audit_logs.sql.
export const AUDIT_ACCIONES = ['APROBADO', 'RECHAZADO']
export const AUDIT_TABLAS = ['EUDR_MONITOREO', 'EUDR_USO_SUELO', 'EUDR_INSTALACIONES']

/**
 * Valida el body de POST /api/qc/audit-log antes de insertar. Devuelve
 * `{ valid: true, payload }` o `{ valid: false, error }` — nunca lanza.
 */
export function validateAuditLogRequest(body) {
  const organizationId = body?.ID_Organizacion
  const accion = body?.accion
  const tablaOrigen = body?.tabla_origen
  const entidadId = body?.entidad_id
  const detalles = body?.detalles

  if (!organizationId || typeof organizationId !== 'string') {
    return { valid: false, error: 'ID_Organizacion es requerido.' }
  }
  if (!AUDIT_ACCIONES.includes(accion)) {
    return { valid: false, error: `accion debe ser una de: ${AUDIT_ACCIONES.join(', ')}.` }
  }
  if (!AUDIT_TABLAS.includes(tablaOrigen)) {
    return { valid: false, error: `tabla_origen debe ser una de: ${AUDIT_TABLAS.join(', ')}.` }
  }
  if (!entidadId) {
    return { valid: false, error: 'entidad_id es requerido.' }
  }
  if (detalles !== undefined && (typeof detalles !== 'object' || detalles === null || Array.isArray(detalles))) {
    return { valid: false, error: 'detalles debe ser un objeto JSON (o ausente).' }
  }

  return {
    valid: true,
    payload: {
      ID_Organizacion: organizationId,
      accion,
      tabla_origen: tablaOrigen,
      entidad_id: String(entidadId),
      detalles: detalles || {},
    },
  }
}
