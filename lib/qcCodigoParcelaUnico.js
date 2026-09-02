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
 * Distancia en un formato legible — metros redondeados por debajo de
 * 1000m, kilómetros con 1 decimal por encima (ej. "769 m", "1.2 km").
 */
export function formatDistanciaLegible(distanciaM) {
  if (typeof distanciaM !== 'number' || Number.isNaN(distanciaM)) return 'una distancia desconocida'
  if (distanciaM >= 1000) return `${(distanciaM / 1000).toFixed(1)} km`
  return `${Math.round(distanciaM)} m`
}

/** estado_revision del otro registro, en lenguaje llano — nunca el valor crudo. */
function describeEstadoOtroRegistro(estado) {
  if (estado === 'APROBADO') return 'ya fue aprobado anteriormente'
  if (estado === 'RECHAZADO') return 'ya fue rechazado anteriormente'
  return 'todavía está pendiente de revisión'
}

/**
 * Describe UN registro en conflicto sin exponer su id_monitoreo (UUID
 * técnico, sin significado para alguien no técnico — ver ADR-014). En su
 * lugar usa fecha de captura + técnico responsable (datos que sí existen
 * en EUDR_MONITOREO, ver scripts/etl_drive_to_supabase.py) cuando están
 * disponibles — si algún registro viejo no los tiene cargados, el mensaje
 * sigue siendo válido, solo omite esa parte en vez de mostrar "null".
 */
function describeRegistroEnConflicto(r) {
  const contexto = [
    r.fecha_monitoreo ? `capturado el ${r.fecha_monitoreo}` : null,
    r.tecnico_responsable ? `por ${r.tecnico_responsable}` : null,
  ]
    .filter(Boolean)
    .join(' ')
  const contextoTexto = contexto ? ` (${contexto})` : ''
  return `a ${formatDistanciaLegible(r.distancia_m)} de distancia${contextoTexto} — ${describeEstadoOtroRegistro(r.estado_revision)}`
}

/**
 * Mensaje de bloqueo en lenguaje simple, pensado para alguien sin
 * conocimiento técnico (ADR-014, revisión de mensaje a pedido del
 * usuario): explica la regla de negocio, qué se detectó (con la
 * distancia real en un formato legible y el contexto del otro registro
 * en vez de su UUID), y qué corresponde hacer — sin prometer un flujo de
 * resolución que todavía no existe (ver ADR-014, "Fuera de alcance"), solo
 * deja explícito que hace falta revisión manual.
 */
export function buildConflictoParcelaMensaje(result) {
  if (!result?.tiene_conflicto) return null
  const detalle = (result.registros_en_conflicto || []).map(describeRegistroEnConflicto).join('; ')
  return (
    `Un código de parcela debe corresponder siempre a un único lugar físico. El código "${result.ID_Parcela_Fija}" ` +
    `también existe en otra ubicación: ${detalle}. Esto requiere revisión manual — confirmá cuál de los dos ` +
    `registros tiene el código correcto antes de aprobar o rechazar este.`
  )
}
