// Exportación/importación CSV del Padrón de Socios y Fincas (/dashboard/socios).
// Funciones de construcción de CSV son puras y testeables; la
// orquestación (fetch + descarga en el navegador) vive en
// exportSociosCsv/exportParcelasCsv, que sí dependen de `document`/`Blob`
// (mismo patrón que lib/eudrDdsExporter.js::exportTracesDDS).

import { CERT_FLAG_FIELDS, HECTARE_FIELDS, HECTARE_FIELD_KEYS, socioSchema, parcelaSchema } from './validations/socios.js'

const SOCIO_EXPORT_COLUMNS = [
  'ID_Socio',
  'ID_Organizacion',
  'codigo_finca',
  'socio_nombre_completo',
  'socio_dni',
  'socio_genero',
  'socio_fecha_nacimiento',
  'celular_socio',
  'socio_departamento',
  'socio_provincia',
  'socio_distrito',
  'localidad',
  'cert_org_estatus',
  ...CERT_FLAG_FIELDS.map((f) => f.field),
  'socio_fecha_ingreso',
]

const PARCELA_EXPORT_COLUMNS = [
  'ID_Parcela_Fija',
  'ID_Organizacion',
  'ID_Socio',
  'parcela_codigo',
  'parcela_nombre',
  ...HECTARE_FIELD_KEYS,
  'totalh',
]

// ── Diccionario de encabezados legibles (equivalente a METADATOS_CAMPO en
// el módulo de Inspecciones, ver lib/inspeccionesSchema.js — acá es un
// diccionario nuevo, propio del Padrón: ese otro no cubre estas columnas)
// ─────────────────────────────────────────────────────────────────────
// Reutiliza los mismos textos que ya se muestran en los formularios
// individuales (SocioFormModal/UbigeoSelect, ParcelaFormModal vía
// HECTARE_FIELDS/CERT_FLAG_FIELDS) para que el CSV y la UI nunca
// diverjan.

export const SOCIO_FIELD_LABELS = {
  ID_Socio: 'Código de Socio',
  ID_Organizacion: 'Organización',
  codigo_finca: 'Código de Finca',
  socio_nombre_completo: 'Nombre Completo',
  socio_dni: 'DNI',
  socio_genero: 'Género',
  socio_fecha_nacimiento: 'Fecha de Nacimiento',
  celular_socio: 'Celular',
  socio_departamento: 'Departamento',
  socio_provincia: 'Provincia',
  socio_distrito: 'Distrito',
  localidad: 'Localidad',
  cert_org_estatus: 'Estatus de Certificación Orgánica',
  ...Object.fromEntries(CERT_FLAG_FIELDS.map(({ field, label }) => [field, label])),
  socio_fecha_ingreso: 'Fecha de Ingreso',
}

export const PARCELA_FIELD_LABELS = {
  ID_Parcela_Fija: 'Código de Parcela',
  ID_Organizacion: 'Organización',
  ID_Socio: 'Código de Socio',
  parcela_codigo: 'Código Interno de Parcela',
  parcela_nombre: 'Nombre de la Parcela',
  ...Object.fromEntries(HECTARE_FIELDS.map(({ field, label }) => [field, label])),
  totalh: 'Total Hectáreas',
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

/**
 * Construye texto CSV (con encabezado) a partir de una lista de filas y
 * columnas. Función pura. `labels` (opcional): diccionario columna
 * técnica -> encabezado legible; si se omite, el encabezado usa la
 * columna técnica tal cual (comportamiento original).
 */
export function arrayToCsv(rows, columns, labels) {
  const header = columns.map((col) => escapeCsvCell(labels?.[col] || col)).join(',')
  const lines = (rows || []).map((row) => columns.map((col) => escapeCsvCell(row[col])).join(','))
  return [header, ...lines].join('\r\n')
}

export function buildSociosCsv(socios) {
  return arrayToCsv(socios, SOCIO_EXPORT_COLUMNS, SOCIO_FIELD_LABELS)
}

export function buildParcelasCsv(parcelas) {
  return arrayToCsv(parcelas, PARCELA_EXPORT_COLUMNS, PARCELA_FIELD_LABELS)
}

// ── Plantillas en blanco (1 fila de ejemplo, para carga masiva) ───────
// ID_Organizacion y totalh quedan afuera a propósito: la organización se
// resuelve del contexto activo (nunca se escribe desde el CSV) y totalh
// es un campo calculado (lib/actions/sociosActions.js::computeTotalHectares),
// no algo que el usuario deba tipear.

const SOCIO_TEMPLATE_COLUMNS = SOCIO_EXPORT_COLUMNS.filter((c) => c !== 'ID_Organizacion')
const PARCELA_TEMPLATE_COLUMNS = PARCELA_EXPORT_COLUMNS.filter((c) => c !== 'ID_Organizacion' && c !== 'totalh')

const SOCIO_TEMPLATE_EXAMPLE = {
  ID_Socio: 'JS-00001',
  codigo_finca: 'F-001',
  socio_nombre_completo: 'Juan Pérez García',
  socio_dni: '12345678',
  socio_genero: 'Hombre',
  socio_fecha_nacimiento: '1980-05-14',
  celular_socio: '987654321',
  socio_departamento: 'San Martín',
  socio_provincia: 'Moyobamba',
  socio_distrito: 'Moyobamba',
  localidad: 'Alto Mayo',
  cert_org_estatus: 'Organico',
  cert_nop_usda: 'Sí',
  ue_2018_848: 'No',
  cor_canada: 'No',
  cert_ds_0442006_ag: 'No',
  cert_lpo_mx: 'No',
  cert_rainforest: 'No',
  cert_comercio_justo: 'No',
  cert_fair_trade_usa: 'No',
  socio_fecha_ingreso: '2020-01-15',
}

// ID_Socio de respaldo cuando la organización activa todavía no tiene
// ningún socio real (organización nueva) — nunca se usa si hay al menos
// un socio activo real disponible, ver buildParcelaTemplateCsv/
// fetchSampleSocioIds más abajo.
const PARCELA_TEMPLATE_FALLBACK_SOCIO_ID = 'JS-00001'

function parcelaTemplateRow(socioId, seq) {
  return {
    ID_Parcela_Fija: `${socioId}-P0${seq}`,
    ID_Socio: socioId,
    parcela_codigo: `P-0${seq}`,
    parcela_nombre: 'Finca Alta',
    hcp: 2,
    hcc: 1.5,
    ho: 0,
    hip: 0,
    hrp: 0,
    hbp: 0,
    otros_cultivo: 0,
  }
}

export function buildSocioTemplateCsv() {
  return arrayToCsv([SOCIO_TEMPLATE_EXAMPLE], SOCIO_TEMPLATE_COLUMNS, SOCIO_FIELD_LABELS)
}

/**
 * `sampleSocioIds` (opcional, hasta 2): ID_Socio reales de la
 * organización activa, para que la fila de ejemplo apunte a un socio que
 * de verdad existe (evita que alguien copie el ID de ejemplo tal cual y
 * se choque con "El Código de Socio no existe en la organización activa"
 * al importar — ver assertSocioExists en lib/actions/sociosActions.js).
 * Sin organización con socios todavía (org nueva), cae al ID de
 * respaldo — no es un error, solo un ejemplo menos "real".
 */
export function buildParcelaTemplateCsv(sampleSocioIds = []) {
  const ids = sampleSocioIds.length > 0 ? sampleSocioIds.slice(0, 2) : [PARCELA_TEMPLATE_FALLBACK_SOCIO_ID]
  const rows = ids.map((socioId, i) => parcelaTemplateRow(socioId, i + 1))
  return arrayToCsv(rows, PARCELA_TEMPLATE_COLUMNS, PARCELA_FIELD_LABELS)
}

/** Los primeros `limit` ID_Socio activos de la organización, para la plantilla de parcelas. */
async function fetchSampleSocioIds(supabase, organizationId, limit = 2) {
  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .select('ID_Socio')
    .eq('ID_Organizacion', organizationId)
    .eq('activo', true)
    .order('ID_Socio')
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((r) => r.ID_Socio)
}

// ── Importación ──────────────────────────────────────────────────────

/**
 * Parser CSV simple (sin librería externa): soporta campos entre comillas
 * dobles con comas/saltos de línea embebidos y comillas escapadas (""),
 * mismo formato que produce arrayToCsv/Excel. Función pura, texto -> array
 * de objetos (clave = columna del encabezado, tal cual viene en el
 * archivo — la traducción legible/técnica pasa después, en
 * normalizeRowKeys).
 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  // Quita un posible BOM UTF-8 al inicio (el que agrega triggerCsvDownload).
  const clean = text.replace(/^﻿/, '')

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]
    const next = clean[i + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r') {
      // ignorado, \n cierra la fila
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const nonEmptyRows = rows.filter((r) => !(r.length === 1 && r[0] === ''))
  if (nonEmptyRows.length === 0) return []

  const header = nonEmptyRows[0].map((h) => h.trim())
  return nonEmptyRows.slice(1).map((cells) => {
    const obj = {}
    header.forEach((col, i) => {
      obj[col] = (cells[i] ?? '').trim()
    })
    return obj
  })
}

/**
 * Mapa inverso label/clave técnica (ambos en minúsculas) -> clave técnica
 * canónica, para que el parser de importación acepte tanto el encabezado
 * legible ("Código de Socio") como el técnico ("ID_Socio", en cualquier
 * mayúscula/minúscula). Una columna del CSV que no matchea ninguno de los
 * dos se deja pasar tal cual — Zod la ignora si no es un campo conocido.
 */
function buildReverseLabelMap(labels) {
  const map = new Map()
  for (const [key, label] of Object.entries(labels)) {
    map.set(key.toLowerCase(), key)
    map.set(label.toLowerCase(), key)
  }
  return map
}

const SOCIO_REVERSE_LABELS = buildReverseLabelMap(SOCIO_FIELD_LABELS)
const PARCELA_REVERSE_LABELS = buildReverseLabelMap(PARCELA_FIELD_LABELS)

function normalizeRowKeys(row, reverseMap) {
  const normalized = {}
  for (const [rawKey, value] of Object.entries(row)) {
    const canonical = reverseMap.get(rawKey.trim().toLowerCase())
    normalized[canonical || rawKey] = value
  }
  return normalized
}

/**
 * Segunda pasada sobre las filas ya normalizadas: detecta duplicados
 * INTERNOS del archivo subido (mismo valor repetido en más de una fila)
 * para los campos indicados, y marca inválidas todas las filas
 * involucradas — incluida la primera ocurrencia, para que quede claro en
 * la vista previa cuáles filas chocan entre sí. Los duplicados contra la
 * base de datos ya existente se detectan aparte, al confirmar la
 * importación (createSocio/createParcela en lib/actions/sociosActions.js
 * — mismo chequeo que usa el alta individual, sin duplicar esa lógica acá).
 */
function applyDuplicateChecks(results, normalizedRows, fields) {
  for (const { key, label } of fields) {
    const groups = new Map()
    normalizedRows.forEach((row, i) => {
      const value = (row[key] ?? '').toString().trim()
      if (!value) return
      if (!groups.has(value)) groups.set(value, [])
      groups.get(value).push(i)
    })
    for (const indices of groups.values()) {
      if (indices.length < 2) continue
      for (const i of indices) {
        const otherRows = indices.filter((j) => j !== i).map((j) => j + 2) // fila 1 = encabezado
        results[i].valid = false
        results[i].errors.push(`${label} duplicado en el archivo (también en fila ${otherRows.join(', ')}).`)
      }
    }
  }
  return results
}

/**
 * Valida cada fila parseada contra el schema Zod real (mismo que usa el
 * formulario/la Server Action) — sin escribir nada, es la "vista previa"
 * pedida antes de confirmar una carga masiva. Acepta encabezados legibles
 * o técnicos (ver normalizeRowKeys) y marca duplicados internos de
 * ID_Socio/DNI dentro del propio archivo.
 */
export function validateSocioRows(rows) {
  const normalizedRows = (rows || []).map((row) => normalizeRowKeys(row, SOCIO_REVERSE_LABELS))
  const results = normalizedRows.map((row, index) => {
    const result = socioSchema.safeParse(row)
    return {
      index,
      raw: rows[index],
      normalized: row,
      valid: result.success,
      data: result.success ? result.data : null,
      errors: result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    }
  })
  return applyDuplicateChecks(results, normalizedRows, [
    { key: 'ID_Socio', label: 'Código de Socio' },
    { key: 'socio_dni', label: 'DNI' },
  ])
}

export function validateParcelaRows(rows) {
  const normalizedRows = (rows || []).map((row) => {
    const normalized = normalizeRowKeys(row, PARCELA_REVERSE_LABELS)
    for (const key of HECTARE_FIELD_KEYS) {
      if (normalized[key] === '') normalized[key] = null
    }
    return normalized
  })
  const results = normalizedRows.map((row, index) => {
    const result = parcelaSchema.safeParse(row)
    return {
      index,
      raw: rows[index],
      normalized: row,
      valid: result.success,
      data: result.success ? result.data : null,
      errors: result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    }
  })
  return applyDuplicateChecks(results, normalizedRows, [{ key: 'ID_Parcela_Fija', label: 'Código de Parcela' }])
}

function triggerCsvDownload(filename, csvText) {
  // BOM UTF-8 al inicio para que Excel abra tildes/ñ correctamente.
  const blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function todayStamp() {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
}

export function downloadSocioTemplate() {
  triggerCsvDownload('Plantilla_Socios.csv', buildSocioTemplateCsv())
}

/**
 * `supabase`/`organizationId` (opcionales): si se proveen, consulta
 * ID_Socio reales y activos de la organización activa para la fila de
 * ejemplo (ver fetchSampleSocioIds). Sin ellos —o si la consulta falla—
 * cae al ID de respaldo en vez de romper la descarga: la plantilla debe
 * seguir siendo útil aunque la consulta de ejemplo no lo sea.
 */
export async function downloadParcelaTemplate(supabase, organizationId) {
  let sampleSocioIds = []
  if (supabase && organizationId) {
    try {
      sampleSocioIds = await fetchSampleSocioIds(supabase, organizationId, 2)
    } catch (err) {
      console.error('[padronCsv] downloadParcelaTemplate: no se pudieron obtener socios reales de ejemplo, usando el ID de respaldo:', err)
    }
  }
  triggerCsvDownload('Plantilla_Parcelas.csv', buildParcelaTemplateCsv(sampleSocioIds))
}

/**
 * Exporta el padrón ACTIVO de socios (no solo la página visible actual) —
 * hace su propio fetch sin paginar. PostgREST limita a 1000 filas por
 * defecto; para un padrón cooperativo real esto alcanza, pero si algún
 * día se supera, esta función necesitará paginar el fetch (no
 * implementado — no hay indicio hoy de que haga falta).
 */
export async function exportSociosCsv(supabase) {
  const { data, error } = await supabase
    .from('PADRON_SOCIOS')
    .select(SOCIO_EXPORT_COLUMNS.join(','))
    .eq('activo', true)
    .order('socio_nombre_completo')
  if (error) throw error

  triggerCsvDownload(`Padron_Socios_${todayStamp()}.csv`, buildSociosCsv(data ?? []))
  return { socios: data?.length ?? 0 }
}

/** Exporta el padrón ACTIVO de parcelas — mismo criterio que exportSociosCsv. */
export async function exportParcelasCsv(supabase) {
  const { data, error } = await supabase
    .from('PADRON_PARCELAS')
    .select(PARCELA_EXPORT_COLUMNS.join(','))
    .eq('activo', true)
    .order('parcela_codigo')
  if (error) throw error

  triggerCsvDownload(`Padron_Parcelas_${todayStamp()}.csv`, buildParcelasCsv(data ?? []))
  return { parcelas: data?.length ?? 0 }
}
