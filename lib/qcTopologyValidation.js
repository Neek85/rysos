// Lógica pura del endpoint /api/qc/validate-spatial — ver
// specs/qc_topological_eudr_validation.md. Separada del Route Handler
// (que sí tiene efectos de lado reales: supabase.rpc, insert de
// auditoría) para que sea testeable con node --test sin una base de datos
// real — mismo criterio que lib/driveSyncTrigger.js.

// EUDR_INSTALACIONES es siempre puntual (nunca aporta polígonos, ver
// components/gis/MapDashboard.jsx) — no tiene topología de área que
// validar, a propósito no incluida acá.
export const TOPOLOGY_VALIDATABLE_TABLES = ['EUDR_MONITOREO', 'EUDR_USO_SUELO']

/**
 * Valida el body de POST /api/qc/validate-spatial antes de invocar la RPC.
 * Devuelve `{ valid: true, tablaOrigen, registroId }` o
 * `{ valid: false, error }` — nunca lanza, para que el Route Handler
 * decida el status HTTP sin un try/catch adicional para este caso.
 */
export function validateTopologyRequest(body) {
  const tablaOrigen = body?.tabla_origen
  const registroId = body?.registro_id

  if (!TOPOLOGY_VALIDATABLE_TABLES.includes(tablaOrigen) || !registroId) {
    return {
      valid: false,
      error:
        'Parámetros inválidos: tabla_origen debe ser EUDR_MONITOREO o EUDR_USO_SUELO ' +
        '(EUDR_INSTALACIONES es siempre puntual, sin topología de área) y registro_id es requerido.',
    }
  }

  return { valid: true, tablaOrigen, registroId }
}
