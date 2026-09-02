// Lógica pura del endpoint POST /api/qc/cobertura-uso-suelo (sección
// "Cobertura de la parcela" en QcDetailEditor.jsx, Fase B) — ver
// docs/adr/ADR-011-cobertura-completa-uso-suelo.md. Separada del Route
// Handler (que sí tiene efectos de lado reales: supabase.rpc, consultas
// reales) para que sea testeable con node --test sin una base de datos
// real — mismo criterio que lib/qcTopologyValidation.js.

export const SIN_VINCULO_MENSAJE =
  'No se pudo determinar la parcela madre de este registro — revisar manualmente.'

/**
 * Valida el body de POST /api/qc/cobertura-uso-suelo. Devuelve
 * `{ valid: true, usoSueloId }` o `{ valid: false, error }` — nunca
 * lanza, mismo criterio que validateTopologyRequest.
 */
export function validateCoberturaRequest(body) {
  const usoSueloId = body?.uso_suelo_id
  if (!usoSueloId) {
    return { valid: false, error: 'Parámetros inválidos: uso_suelo_id es requerido.' }
  }
  return { valid: true, usoSueloId }
}

/**
 * Forma el resultado del caso "sin vínculo" (ver instrucción 2 de
 * ADR-011): un EUDR_USO_SUELO cuyo id_parcela no tiene NINGÚN
 * EUDR_MONITOREO vinculado vía qfield_relation_id (o, por la misma razón
 * de nunca asumir ante ambigüedad ya establecida en Fase A/B0, más de
 * uno). Nunca bloquea — el frontend debe mostrar este mensaje en vez de
 * cualquier número de cobertura.
 */
export function buildSinVinculoResult() {
  return { vinculo_disponible: false, hueco_cobertura: false, bloquea_aprobacion: false, mensaje: SIN_VINCULO_MENSAJE }
}

/**
 * % de cobertura real (suma de subdivisiones aprobadas / área de
 * Monitoreo) para mostrar en el panel — separado del cálculo de bloqueo
 * en sí (que vive en la RPC), solo para render.
 */
export function calcularPctCobertura(result) {
  if (!result?.vinculo_disponible) return null
  if (typeof result.area_monitoreo_ha !== 'number' || result.area_monitoreo_ha <= 0) return null
  if (typeof result.suma_uso_suelo_aprobado_ha !== 'number') return null
  return Math.round((result.suma_uso_suelo_aprobado_ha / result.area_monitoreo_ha) * 100 * 100) / 100
}

/**
 * Aviso informativo cuando hueco_cobertura = true — ya NO bloquea nada
 * (ver ADR-011, sección "Corrección: de bloqueante a informativo"). La
 * versión anterior de esta función frenaba el botón "Aprobar"; eso creaba
 * un círculo imposible confirmado en vivo con 3 registros/parcelas reales
 * (0.00 ha de "subdivisiones aprobadas" siempre, porque el propio
 * registro en revisión nunca cuenta en su propia suma hasta DESPUÉS de
 * aprobarse — el último registro necesario para completar una parcela
 * nunca podía pasar su propio candado). Mismo patrón que "Solapado X%"
 * de Fase A: informa, nunca bloquea. NUNCA menciona totalh (no participa
 * en el cálculo de hueco_cobertura, ver ADR-011).
 */
export function buildCoberturaAvisoMensaje(result) {
  if (!result?.hueco_cobertura) return null
  const pct = calcularPctCobertura(result)
  const pctTexto = pct === null ? 'un porcentaje desconocido' : `${pct}%`
  return (
    `Cobertura parcial: ${pctTexto} de la parcela clasificado — revisá si faltan subdivisiones ` +
    `por registrar antes de considerar esta parcela completa.`
  )
}
