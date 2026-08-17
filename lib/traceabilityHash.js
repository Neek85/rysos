// Contraparte JS de PublicTraceabilityService en scripts/generate_lot_qr.py
// (Tarea 14). Deriva un lot_hash SHA-256 determinista de un payload tipo DDS
// (mismo objeto que devuelve buildTracesPayload() de lib/eudrDdsExporter.js
// — organization_id / total_plots / total_hectares / geojson.features[].
// properties.id_monitoreo) y sanitiza PII antes de exponerlo públicamente.
//
// Usa Web Crypto (crypto.subtle.digest), disponible tanto en navegador como
// en el runtime Node de Next.js (Node >=19 lo expone como global; este
// proyecto requiere Node >=18.17 vía Next 14, y Vercel corre LTS recientes
// que ya lo incluyen sin flags) — evita depender del módulo `crypto` de
// Node, que no es usable desde un componente cliente sin bundler-shims.
//
// INVARIANTE: el algoritmo (orden de las partes concatenadas con "_", y
// truncar a los primeros 16 hex del digest SHA-256 completo) debe coincidir
// EXACTO con generate_lot_hash() en scripts/generate_lot_qr.py — de lo
// contrario un mismo lote produciría hashes distintos según se genere desde
// Python (batch) o desde este módulo (web), rompiendo la verificación
// pública.

// PII explícitamente prohibida por specs/tarea14_trazabilidad_qr.md
// (nombrada contra el schema viejo de view_eudr_dashboard_aprobados) más
// dos campos que SÍ existen en el payload real de buildTracesPayload()
// (schema vw_monitoreo_web) y son PII por el mismo motivo aunque no
// coincidan textualmente con esos nombres: `productor` es un nombre de
// persona (igual que socio_nombre_completo), e `id_parcela` es el
// identificador interno crudo (con frecuencia UUID) que el resto del
// código ya trata como no apto para exponer (ver sanitizeCode en
// components/gis/MapDashboard.jsx).
const PII_FIELDS = new Set([
  'socio_dni',
  'socio_nombre',
  'socio_nombre_completo',
  'conyuge_dni',
  'productor',
  'id_parcela',
])

const TRACE_BASE_URL = 'https://app.ryzos.io/trace/'

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Genera un hash SHA-256 determinista de 16 chars hex para el lote — mismo
 * algoritmo que generate_lot_hash() en scripts/generate_lot_qr.py.
 */
export async function generateLotHash(ddsPayload) {
  const parts = [
    String(ddsPayload?.organization_id ?? ''),
    String(ddsPayload?.total_plots ?? ''),
    String(ddsPayload?.total_hectares ?? ''),
  ]
  const features = ddsPayload?.geojson?.features ?? []
  for (const feat of features) {
    parts.push(String(feat?.properties?.id_monitoreo ?? feat?.properties?.id_parcela ?? ''))
  }

  const raw = parts.join('_')
  const fullHash = await sha256Hex(raw)
  return fullHash.slice(0, 16)
}

export function getTraceUrl(lotHash) {
  return `${TRACE_BASE_URL}${lotHash}`
}

/**
 * Construye el payload público sanitizado — elimina PII de las properties
 * de cada Feature, preserva geometría y cumplimiento. Misma forma que
 * build_public_sanitized_payload() en scripts/generate_lot_qr.py.
 */
export function buildPublicSanitizedPayload(ddsPayload, lotHash) {
  const features = (ddsPayload?.geojson?.features ?? []).map((feat) => {
    const props = feat?.properties ?? {}
    const sanitizedProps = Object.fromEntries(
      Object.entries(props).filter(([key]) => !PII_FIELDS.has(key))
    )
    return { type: 'Feature', geometry: feat?.geometry ?? null, properties: sanitizedProps }
  })

  return {
    lot_hash: lotHash,
    verification_url: getTraceUrl(lotHash),
    regulation: ddsPayload?.regulation ?? 'EU 2023/1115',
    organization_id: ddsPayload?.organization_id,
    total_plots: ddsPayload?.total_plots,
    total_hectares: ddsPayload?.total_hectares,
    geojson: { type: 'FeatureCollection', features },
  }
}
