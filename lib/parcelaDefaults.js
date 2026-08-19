// Sugerencias de valores por defecto al crear una parcela nueva en el
// modal de /dashboard/socios — ver specs/padron_web_socios.md. Funciones
// puras (lista de parcelas existentes -> sugerencia), sin dependencia de
// red — el usuario puede editar la sugerencia antes de guardar, no es un
// valor forzado.

/**
 * Calcula los siguientes `count` códigos correlativos LIBRES a partir de
 * una lista de códigos ya usados (de cualquier entidad — parcela, socio,
 * etc., ver computeNextParcelaCode abajo para el caso original). Detecta
 * el prefijo y el ancho de relleno de ceros observados en el código
 * existente con el número más alto (ej. "P-00001", "P-00002" ->
 * siguiente "P-00003"), en vez de asumir un formato fijo — así se adapta
 * al esquema real de numeración de cada organización. Sin códigos
 * previos, usa `defaultPrefix`/`defaultPadLength` (ej. "P-00001").
 * Códigos devueltos en secuencia (`count > 1`: P-00004, P-00005, …), sin
 * repetir ninguno de los ya usados.
 */
export function computeNextCodes(existingCodes, count, { defaultPrefix = 'P-', defaultPadLength = 5 } = {}) {
  let maxNumber = 0
  let prefix = defaultPrefix
  let padLength = defaultPadLength

  for (const code of existingCodes || []) {
    if (typeof code !== 'string' || !code.trim()) continue

    const match = /^(.*?)(\d+)$/.exec(code.trim())
    if (!match) continue

    const [, matchedPrefix, digits] = match
    const num = parseInt(digits, 10)
    if (num > maxNumber) {
      maxNumber = num
      prefix = matchedPrefix
      padLength = digits.length
    }
  }

  return Array.from({ length: count }, (_, i) => `${prefix}${String(maxNumber + i + 1).padStart(padLength, '0')}`)
}

/** Igual que computeNextCodes, pero devuelve solo el primero — atajo para el caso count=1. */
export function computeNextCode(existingCodes, options) {
  return computeNextCodes(existingCodes, 1, options)[0]
}

/**
 * Calcula el siguiente código correlativo a partir de las parcelas ya
 * registradas para un socio. Sin parcelas previas, usa "P-00001" por
 * defecto. Wrapper de computeNextCode para el shape original
 * (`{ parcela_codigo }[]`) — ver ese para la lógica real.
 */
export function computeNextParcelaCode(existingParcelas, options = {}) {
  return computeNextCode((existingParcelas || []).map((p) => p?.parcela_codigo), options)
}

/**
 * Sugiere un ID_Parcela_Fija combinando el código del socio con el
 * código de parcela sugerido (ej. socio "ND-00001" + parcela "P-00004"
 * -> "ND-00001-P-00004"). Editable por el usuario antes de guardar — es
 * solo un punto de partida para no dejar el campo requerido vacío.
 */
export function computeSuggestedParcelaId(socioId, parcelaCode) {
  if (!socioId || !parcelaCode) return ''
  return `${socioId}-${parcelaCode}`
}
