// Lógica pura del endpoint POST /api/qc/validar-codigo-parcela (panel de
// detalle de un registro EUDR_MONITOREO en la Consola QC) — ver
// docs/adr/ADR-014-codigo-parcela-unico-por-ubicacion.md. Separada del
// Route Handler (que sí tiene efectos de lado reales: supabase.rpc) para
// que sea testeable con node --test sin una base de datos real — mismo
// criterio que lib/qcCoberturaUsoSuelo.js/lib/qcTopologyValidation.js.

/**
 * Valida el body de POST /api/qc/validar-codigo-parcela. Devuelve
 * `{ valid: true, monitoreoId }` o `{ valid: false, error }` — nunca
 * lanza, mismo criterio que validateCoberturaRequest/validateTopologyRequest.
 */
export function validateCodigoParcelaRequest(body) {
  const monitoreoId = body?.monitoreo_id
  if (!monitoreoId) {
    return { valid: false, error: 'Parámetros inválidos: monitoreo_id es requerido.' }
  }
  return { valid: true, monitoreoId }
}

/**
 * Mensaje de bloqueo real — mismo estilo que el ya usado en
 * lib/eudrQcActions.js::resolveUpdateTarget para el caso de migración
 * pendiente ("No se puede aplicar la decisión..."), a pedido explícito del
 * prompt de esta tarea. Lista cada registro en conflicto con su distancia
 * real y estado_revision, para que el revisor entienda de inmediato qué
 * otro registro está en disputa sin tener que ir a buscarlo.
 */
export function buildConflictoParcelaMensaje(result) {
  if (!result?.tiene_conflicto) return null
  const detalle = (result.registros_en_conflicto || [])
    .map((r) => `${r.id_monitoreo} (${r.distancia_m}m, ${r.estado_revision})`)
    .join('; ')
  return (
    `No se puede aplicar la decisión sobre este registro: el código de parcela "${result.ID_Parcela_Fija}" ` +
    `también aparece en otra ubicación físicamente distinta — ${detalle}. Un código de parcela debe ` +
    `corresponder siempre a un único lugar. Resolvé el conflicto manualmente antes de decidir.`
  )
}
