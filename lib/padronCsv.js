// Exportación CSV del Padrón de Socios y Fincas (/dashboard/socios).
// Funciones de construcción de CSV son puras y testeables; la
// orquestación (fetch + descarga en el navegador) vive en
// exportPadronCsv, que sí depende de `document`/`Blob` (mismo patrón que
// lib/eudrDdsExporter.js::exportTracesDDS).

import { CERT_FLAG_FIELDS, socioSchema, parcelaSchema } from './validations/socios.js'

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
  'hcp',
  'hcc',
  'ho',
  'hip',
  'hrp',
  'hbp',
  'otros_cultivo',
  'totalh',
]

function escapeCsvCell(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

/** Construye texto CSV (con encabezado) a partir de una lista de filas y columnas. Función pura. */
export function arrayToCsv(rows, columns) {
  const header = columns.join(',')
  const lines = (rows || []).map((row) => columns.map((col) => escapeCsvCell(row[col])).join(','))
  return [header, ...lines].join('\r\n')
}

export function buildSociosCsv(socios) {
  return arrayToCsv(socios, SOCIO_EXPORT_COLUMNS)
}

export function buildParcelasCsv(parcelas) {
  return arrayToCsv(parcelas, PARCELA_EXPORT_COLUMNS)
}

// ── Importación ──────────────────────────────────────────────────────

/**
 * Parser CSV simple (sin librería externa): soporta campos entre comillas
 * dobles con comas/saltos de línea embebidos y comillas escapadas (""),
 * mismo formato que produce arrayToCsv/Excel. Función pura, texto -> array
 * de objetos (clave = columna del encabezado).
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
 * Valida cada fila parseada contra el schema Zod real (mismo que usa el
 * formulario/la Server Action) — sin escribir nada, es la "vista previa"
 * pedida antes de confirmar una carga masiva. Filas vacías en campos
 * numéricos se normalizan a null para que el coerce de Zod no falle con
 * cadena vacía.
 */
export function validateSocioRows(rows) {
  return (rows || []).map((row, index) => {
    const result = socioSchema.safeParse(row)
    return {
      index,
      raw: row,
      valid: result.success,
      data: result.success ? result.data : null,
      errors: result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    }
  })
}

export function validateParcelaRows(rows) {
  return (rows || []).map((row, index) => {
    const normalized = { ...row }
    for (const key of ['hcp', 'hcc', 'ho', 'hip', 'hrp', 'hbp', 'otros_cultivo']) {
      if (normalized[key] === '') normalized[key] = null
    }
    const result = parcelaSchema.safeParse(normalized)
    return {
      index,
      raw: row,
      valid: result.success,
      data: result.success ? result.data : null,
      errors: result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    }
  })
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

/**
 * Exporta TODO el padrón activo (socios + parcelas), no solo la página
 * visible actual — hace su propio fetch sin paginar. PostgREST limita a
 * 1000 filas por defecto; para un padrón cooperativo real esto alcanza,
 * pero si algún día se supera, esta función necesitará paginar el fetch
 * (no implementado — no hay indicio hoy de que haga falta).
 */
export async function exportPadronCsv(supabase) {
  const [sociosRes, parcelasRes] = await Promise.all([
    supabase
      .from('PADRON_SOCIOS')
      .select(SOCIO_EXPORT_COLUMNS.join(','))
      .eq('activo', true)
      .order('socio_nombre_completo'),
    supabase
      .from('PADRON_PARCELAS')
      .select(PARCELA_EXPORT_COLUMNS.join(','))
      .eq('activo', true)
      .order('parcela_codigo'),
  ])

  if (sociosRes.error) throw sociosRes.error
  if (parcelasRes.error) throw parcelasRes.error

  const stamp = todayStamp()
  triggerCsvDownload(`Padron_Socios_${stamp}.csv`, buildSociosCsv(sociosRes.data ?? []))
  triggerCsvDownload(`Padron_Parcelas_${stamp}.csv`, buildParcelasCsv(parcelasRes.data ?? []))

  return { socios: sociosRes.data?.length ?? 0, parcelas: parcelasRes.data?.length ?? 0 }
}
