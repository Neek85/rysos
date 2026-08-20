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

/**
 * Deriva el texto/estado del badge de deforestación a partir del campo
 * `deforestacion` que devuelve fn_validar_topologia_eudr — separado de
 * QcDetailEditor.jsx (JSX) para poder testear las 3 combinaciones reales
 * sin renderizar nada. `ok`: `null` cuando no hay datos (badge neutro,
 * nunca verde/rojo sin verificación real detrás), `true`/`false` cuando sí
 * hubo un cruce real contra EUDR_COBERTURA_BOSCOSA_2020.
 */
export function describeDeforestationBadge(deforestacion) {
  if (!deforestacion?.disponible) {
    return { ok: null, label: '🛰️ Deforestación: sin datos (no integrado)' }
  }
  if (deforestacion.interseca_post_2020) {
    return { ok: false, label: `⚠ Alerta Deforestación Post-2020 (${deforestacion.area_afectada_max_pct}%)` }
  }
  return { ok: true, label: '✓ Apto EUDR (sin deforestación post-2020 detectada)' }
}
