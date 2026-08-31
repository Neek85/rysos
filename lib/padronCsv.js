// Exportación/importación CSV del Padrón de Socios y Fincas (/dashboard/socios).
// Funciones de construcción de CSV son puras y testeables; la
// orquestación (fetch + descarga en el navegador) vive en
// exportSociosCsv/exportParcelasCsv, que sí dependen de `document`/`Blob`
// (mismo patrón que lib/eudrDdsExporter.js::exportTracesDDS).

import {
  CERT_FLAG_FIELDS,
  HECTARE_FIELDS,
  HECTARE_FIELD_KEYS,
  ORGANIC_CERT_CODES,
  socioSchema,
  parcelaSchema,
} from './validations/socios.js'
import { computeNextCodes } from './parcelaDefaults.js'

// ADR-027 (specs/padron_certificaciones_normalizado.md sección 6.1):
// cert_org_estatus + las 8 columnas de CERT_FLAG_FIELDS ya NO son
// columnas fijas -- se agregan dinámicamente al exportar/generar la
// plantilla, una por cada fila `activo = true` de CERTIFICACIONES_CATALOGO
// (ver fetchActiveCertificaciones/buildSociosCsv/buildSocioTemplateCsv
// más abajo).
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
  'socio_fecha_ingreso',
  // Reactivada (spec mejoras_importador_padron_masivo.md sección 1) --
  // columna FIJA, a diferencia de las 8 de CERT_FLAG_FIELDS, que siguen
  // siendo dinámicas (ver certificaciones más abajo). ADR-027 la había
  // retirado del CSV; sigue siendo texto libre, sin enum, mismo criterio
  // que socioSchema/SocioFormModal.jsx de siempre.
  'cert_org_estatus',
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

// cert_org_estatus/certificaciones y las 8 de CERT_FLAG_FIELDS retiradas
// (ADR-027) -- ya no son columnas fijas, ver SOCIO_EXPORT_COLUMNS arriba.
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
  socio_fecha_ingreso: 'Fecha de Ingreso',
  cert_org_estatus: 'Estatus de Certificación Orgánica',
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

/**
 * ADR-027: `certificaciones` (opcional, filas de CERTIFICACIONES_CATALOGO
 * `activo = true`, `{id, codigo, nombre}`) agrega una columna dinámica
 * por cada una, con `nombre` como encabezado (mismo criterio que ya
 * usaban las 8 columnas fijas -- ver arrayToCsv). Cada fila de `socios`
 * debe traer ya calculada la celda bajo la clave `cert.id` ('Sí'/'No') --
 * exportSociosCsv/buildSocioTemplateCsv son responsables de armar eso,
 * esta función solo arma el CSV final.
 */
export function buildSociosCsv(socios, certificaciones = []) {
  const columns = [...SOCIO_EXPORT_COLUMNS, ...certificaciones.map((c) => c.id)]
  const labels = { ...SOCIO_FIELD_LABELS, ...Object.fromEntries(certificaciones.map((c) => [c.id, c.nombre])) }
  return arrayToCsv(socios, columns, labels)
}

/**
 * Certificaciones activas del catálogo, para columnas dinámicas de CSV
 * (ADR-027). Ordena en JS, no con `.order()` en la query -- el mock de
 * Supabase que ya usan los tests de este archivo (tests/test_padron_csv.mjs)
 * no implementa `.order()`, solo `.select()/.eq()/.in()`, y no hace falta
 * agregarlo solo para esto.
 */
async function fetchActiveCertificaciones(supabase) {
  const { data, error } = await supabase.from('CERTIFICACIONES_CATALOGO').select('id, codigo, nombre').eq('activo', true)
  if (error) throw error
  return (data ?? []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
}

// Mapea CERTIFICACIONES_CATALOGO.codigo -> el mismo campo interno que
// siempre usó socioSchema/createSocio (cert_nop_usda, etc.) -- las
// columnas dinámicas del CSV se traducen de vuelta a estos campos fijos,
// no a un esquema nuevo, para no tener que tocar socioSchema/
// SocioFormModal.jsx en esta tarea (ver ADR-027). Una certificación
// activa cuyo `codigo` no esté acá (agregada al catálogo después de
// esta migración, sin columna interna correspondiente) queda fuera del
// CSV -- limitación conocida, documentada en el ADR.
const CODIGO_TO_FIELD = Object.fromEntries(CERT_FLAG_FIELDS.map((f) => [f.codigo, f.field]))

export function buildParcelasCsv(parcelas) {
  return arrayToCsv(parcelas, PARCELA_EXPORT_COLUMNS, PARCELA_FIELD_LABELS)
}

/**
 * Mejoras importador padrón masivo (spec sección 1) -- resuelve
 * `cert_org_estatus` EN VIVO desde `SOCIO_CERTIFICACIONES.estado` (las 5
 * certificaciones de equivalencia orgánica, `ORGANIC_CERT_CODES`) para
 * cada `id_socio` de `socioIds`, en vez de la columna congelada de
 * `PADRON_SOCIOS` (sin escritura desde ADR-027, ver `socioPayload` en
 * `lib/actions/sociosActions.js`). Exportada aparte de `exportSociosCsv`
 * (que sí depende de `document`/`Blob`) para que sea testeable en Node
 * sin polyfills -- mismo criterio de separación pura/impura que ya usa
 * el resto del archivo (ver comentario del encabezado).
 *
 * Criterio de divergencia (investigado antes de decidir, ver spec sección
 * 1.4): no existe HOY ningún camino de escritura hacia
 * `SOCIO_CERTIFICACIONES.estado` fuera de `syncSocioCertificaciones`
 * (`sociosActions.js`), que siempre escribe el mismo valor a las 5 filas
 * orgánicas en la misma operación (borrar-todo-y-reinsertar) -- una
 * divergencia real solo puede venir de una edición manual directa en
 * Supabase Studio. Si las filas presentes coinciden, se usa ese valor; si
 * divergen, se usa la de `actualizado_en` más reciente (mejor señal
 * disponible, aunque hoy equivale a `creado_en` porque el flujo actual
 * nunca hace `UPDATE` in-place) y se deja un `console.warn` con el
 * detalle -- no bloquea la descarga por esto, mismo criterio de
 * degradación que el resto de `exportSociosCsv`/`downloadSocioTemplate`.
 *
 * @returns {Promise<Map<string, string>>} id_socio (uuid) -> cert_org_estatus ('' si no tiene ninguna certificación orgánica registrada)
 */
export async function fetchSocioCertOrgEstatus(supabase, socioIds) {
  const result = new Map()
  if (!socioIds || socioIds.length === 0) return result

  const { data: organicCerts, error: catalogoErr } = await supabase
    .from('CERTIFICACIONES_CATALOGO')
    .select('id, codigo')
    .in('codigo', ORGANIC_CERT_CODES)
  if (catalogoErr) throw catalogoErr
  const organicCertIds = (organicCerts ?? []).map((c) => c.id)
  if (organicCertIds.length === 0) return result

  const { data: rows, error } = await supabase
    .from('SOCIO_CERTIFICACIONES')
    .select('id_socio, estado, actualizado_en')
    .in('id_socio', socioIds)
    .in('id_certificacion', organicCertIds)
  if (error) throw error

  const bySocio = new Map()
  for (const row of rows ?? []) {
    if (!bySocio.has(row.id_socio)) bySocio.set(row.id_socio, [])
    bySocio.get(row.id_socio).push(row)
  }

  for (const [socioId, socioRows] of bySocio) {
    const withEstado = socioRows.filter((r) => r.estado)
    if (withEstado.length === 0) {
      result.set(socioId, '')
      continue
    }
    const distinctValues = new Set(withEstado.map((r) => r.estado))
    if (distinctValues.size === 1) {
      result.set(socioId, withEstado[0].estado)
      continue
    }
    const mostRecent = withEstado.slice().sort((a, b) => new Date(b.actualizado_en) - new Date(a.actualizado_en))[0]
    console.warn(
      `[padronCsv] fetchSocioCertOrgEstatus: cert_org_estatus divergente entre certificaciones orgánicas del socio ${socioId} (${[...distinctValues].join(', ')}) -- se exporta el valor más reciente ("${mostRecent.estado}") según actualizado_en.`
    )
    result.set(socioId, mostRecent.estado)
  }
  return result
}

// ── Plantillas en blanco (1 fila de ejemplo, para carga masiva) ───────
// ID_Organizacion y totalh quedan afuera a propósito: la organización se
// resuelve del contexto activo (nunca se escribe desde el CSV) y totalh
// es un campo calculado (lib/actions/sociosActions.js::computeTotalHectares),
// no algo que el usuario deba tipear.

const SOCIO_TEMPLATE_COLUMNS = SOCIO_EXPORT_COLUMNS.filter((c) => c !== 'ID_Organizacion')
const PARCELA_TEMPLATE_COLUMNS = PARCELA_EXPORT_COLUMNS.filter((c) => c !== 'ID_Organizacion' && c !== 'totalh')

// cert_org_estatus/los 8 flags retirados del ejemplo fijo (ADR-027) --
// buildSocioTemplateCsv les agrega columnas dinámicas por separado,
// todas en 'No' por defecto (ver ahí).
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
  socio_fecha_ingreso: '2020-01-15',
  cert_org_estatus: 'Organico',
}

// ID_Socio de respaldo cuando la organización activa todavía no tiene
// ningún socio real (organización nueva) — nunca se usa si hay al menos
// un socio activo real disponible, ver buildParcelaTemplateCsv/
// fetchSampleSocioIds más abajo.
const PARCELA_TEMPLATE_FALLBACK_SOCIO_ID = 'JS-00001'

/**
 * `sampleSocioId` (opcional): un ID_Socio LIBRE calculado a partir del
 * correlativo más alto ya usado en la organización activa (ver
 * computeNextCodes en lib/parcelaDefaults.js) — evita que la plantilla
 * choque con un socio real si se importa tal cual (2026-08-19, pedido
 * explícito: "JS-00001" es justamente el primer ID_Socio real en los
 * datos de prueba de este proyecto). Sin organización con socios
 * todavía, o sin conexión a la base, cae al ID fijo de siempre.
 *
 * `certificaciones` (opcional, ADR-027): mismo formato que buildSociosCsv
 * — una columna por cada una, valor de ejemplo `'No'` en las 8 (mismo
 * default que tenía el ejemplo fijo de antes).
 */
export function buildSocioTemplateCsv(sampleSocioId, certificaciones = []) {
  const example = { ...SOCIO_TEMPLATE_EXAMPLE, ID_Socio: sampleSocioId || SOCIO_TEMPLATE_EXAMPLE.ID_Socio }
  for (const cert of certificaciones) example[cert.id] = 'No'
  const columns = [...SOCIO_TEMPLATE_COLUMNS, ...certificaciones.map((c) => c.id)]
  const labels = { ...SOCIO_FIELD_LABELS, ...Object.fromEntries(certificaciones.map((c) => [c.id, c.nombre])) }
  return arrayToCsv([example], columns, labels)
}

function parcelaTemplateRow(socioId, parcelaId, codigo) {
  return {
    ID_Parcela_Fija: parcelaId,
    ID_Socio: socioId,
    parcela_codigo: codigo,
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

/**
 * `sampleSocioIds` (opcional, hasta 2): ID_Socio reales de la
 * organización activa, para que la fila de ejemplo apunte a un socio que
 * de verdad existe (evita que alguien copie el ID de ejemplo tal cual y
 * se choque con "El Código de Socio no existe en la organización activa"
 * al importar — ver assertSocioExists en lib/actions/sociosActions.js).
 * Sin organización con socios todavía (org nueva), cae al ID de
 * respaldo — no es un error, solo un ejemplo menos "real".
 *
 * `existingParcelaCodigos`/`existingParcelaIds` (opcionales): usados con
 * computeNextCodes para que ID_Parcela_Fija/parcela_codigo de las filas
 * de ejemplo sean códigos LIBRES en la organización activa, en vez de
 * "P-01"/"P-02" fijos que podrían coincidir con una parcela real ya
 * existente de ese mismo socio.
 */
export function buildParcelaTemplateCsv(sampleSocioIds = [], existingParcelaCodigos = [], existingParcelaIds = []) {
  const ids = sampleSocioIds.length > 0 ? sampleSocioIds.slice(0, 2) : [PARCELA_TEMPLATE_FALLBACK_SOCIO_ID]
  const freeCodigos = computeNextCodes(existingParcelaCodigos, ids.length, { defaultPrefix: 'P-', defaultPadLength: 2 })
  const freeParcelaIds = computeNextCodes(existingParcelaIds, ids.length, { defaultPrefix: 'COOP-', defaultPadLength: 3 })
  const rows = ids.map((socioId, i) => parcelaTemplateRow(socioId, freeParcelaIds[i], freeCodigos[i]))
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

/** Todos los valores no vacíos de `column` en `table` para la organización activa. */
async function fetchExistingCodes(supabase, table, column, organizationId) {
  const { data, error } = await supabase.from(table).select(column).eq('ID_Organizacion', organizationId)
  if (error) throw error
  return (data ?? []).map((r) => r[column]).filter(Boolean)
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
 * ADR-027: extiende el mapa inverso fijo (SOCIO_REVERSE_LABELS) con el
 * `nombre` de cada certificación activa -> el mismo campo interno fijo
 * que siempre usó socioSchema (vía CODIGO_TO_FIELD), para que las
 * columnas dinámicas del CSV se normalicen igual que antes (createSocio/
 * updateSocio no cambiaron qué esperan recibir). Una certificación activa
 * sin campo interno correspondiente (ver CODIGO_TO_FIELD) se omite acá a
 * propósito -- limitación conocida, ver el comentario de CODIGO_TO_FIELD.
 */
function buildSocioReverseLabelsWithCertificaciones(certificaciones) {
  const map = new Map(SOCIO_REVERSE_LABELS)
  for (const cert of certificaciones) {
    const field = CODIGO_TO_FIELD[cert.codigo]
    if (!field) continue
    map.set(cert.nombre.trim().toLowerCase(), field)
  }
  return map
}

/**
 * ADR-027: a diferencia del resto de columnas no reconocidas (que
 * `normalizeRowKeys` deja pasar tal cual, confiando en que Zod las
 * ignore), una columna de certificación mal tipeada o de una
 * certificación desactivada NO debe perderse en silencio -- el usuario
 * tiene que enterarse antes de confirmar la importación
 * (specs/padron_certificaciones_normalizado.md sección 6.1). Devuelve
 * las columnas del archivo (encabezados crudos, sin normalizar) que no
 * matchean ningún campo fijo conocido ni el nombre de una certificación
 * activa.
 */
function findUnrecognizedSocioColumns(rows, reverseMap) {
  const rawKeys = new Set()
  for (const row of rows || []) {
    for (const key of Object.keys(row)) rawKeys.add(key.trim())
  }
  return [...rawKeys].filter((key) => key && !reverseMap.has(key.toLowerCase()))
}

/**
 * Mejoras importador padrón masivo (spec `mejoras_importador_padron_masivo.md`
 * sección 2): equivalente de `findUnrecognizedSocioColumns` para Parcelas.
 * A diferencia de Socios, no depende de `supabase` -- `PARCELA_REVERSE_LABELS`
 * es estático (Parcelas no tiene columnas dinámicas de catálogo), así que
 * corre siempre, con o sin conexión.
 */
function findUnrecognizedParcelaColumns(rows) {
  const rawKeys = new Set()
  for (const row of rows || []) {
    for (const key of Object.keys(row)) rawKeys.add(key.trim())
  }
  return [...rawKeys].filter((key) => key && !PARCELA_REVERSE_LABELS.has(key.toLowerCase()))
}

// ── "Columna dispareja" (spec sección 3) ───────────────────────────────
// Campos NO obligatorios a chequear por entidad -- derivados de
// *_FIELD_LABELS (el mismo conjunto que ya reconocen findUnrecognized*/
// normalizeRowKeys), nunca del schema Zod completo, para no chequear un
// campo que el importador no trata como columna reconocida (ver
// corrección de premisa sobre `id_producto_predominante` en el spec,
// sección 3.1). ID_Organizacion/totalh se excluyen -- nunca son columnas
// del CSV (se resuelven del contexto/se calculan), así que siempre
// tendrían 0 filas con valor y el chequeo las saltaría sin efecto; se
// excluyen explícitamente por claridad, no por necesidad funcional.
const SOCIO_REQUIRED_FIELDS = new Set(['ID_Socio', 'socio_nombre_completo'])
const SOCIO_UNEVEN_CHECK_FIELDS = [
  ...Object.entries(SOCIO_FIELD_LABELS)
    .filter(([key]) => key !== 'ID_Organizacion' && !SOCIO_REQUIRED_FIELDS.has(key))
    .map(([key, label]) => ({ key, label })),
  // Las 8 de CERT_FLAG_FIELDS no viven en SOCIO_FIELD_LABELS (ADR-027,
  // columnas dinámicas) -- se agregan acá aparte. A diferencia de las 7
  // de hectárea en Parcelas, SÍ quedan en el chequeo: 'Sí'/'No' no tiene
  // la ambigüedad vacío=cero de un campo numérico (decisión documentada
  // en el spec, sección 3.4).
  ...CERT_FLAG_FIELDS.map(({ field, label }) => ({ key: field, label })),
]

// Las 7 columnas de hectárea (HECTARE_FIELD_KEYS) quedan EXCLUIDAS a
// propósito (spec sección 3.4, decisión adoptada tras la ronda 1): vacío
// y 0 son equivalentes en la práctica real de las planillas para estos
// campos, y ya se resuelve a nivel Zod (`nonNegativeNum` + el refine de
// suma > 0 en `parcelaSchema`) -- aplicar el chequeo acá generaría falsos
// positivos masivos, no una señal de calidad real.
const PARCELA_REQUIRED_FIELDS = new Set(['ID_Parcela_Fija', 'ID_Socio'])
const PARCELA_UNEVEN_CHECK_FIELDS = Object.entries(PARCELA_FIELD_LABELS)
  .filter(
    ([key]) =>
      key !== 'ID_Organizacion' && key !== 'totalh' && !PARCELA_REQUIRED_FIELDS.has(key) && !HECTARE_FIELD_KEYS.includes(key)
  )
  .map(([key, label]) => ({ key, label }))

/**
 * Para cada campo de `fieldsToCheck`, cuenta filas con valor no vacío vs.
 * filas vacías sobre el total de `normalizedRows`. Devuelve solo los
 * campos "disparejos" (al menos 1 fila con valor Y al menos 1 vacía) --
 * un campo con 0 filas con valor (la organización no cargó ese dato
 * todavía) o con todas las filas completas no se reporta.
 */
function findUnevenColumns(normalizedRows, fieldsToCheck) {
  const offenders = []
  for (const { key, label } of fieldsToCheck) {
    const emptyRowNumbers = []
    let filledCount = 0
    normalizedRows.forEach((row, i) => {
      const value = (row[key] ?? '').toString().trim()
      if (value) filledCount += 1
      else emptyRowNumbers.push(i + 2) // fila 1 = encabezado, mismo criterio que applyDuplicateChecks
    })
    if (filledCount > 0 && emptyRowNumbers.length > 0) {
      offenders.push({ key, label, emptyRowNumbers, filledCount, totalRows: normalizedRows.length })
    }
  }
  return offenders
}

/** Mensaje de rechazo del archivo completo por columna(s) dispareja(s) -- ver findUnevenColumns. */
function formatUnevenColumnsError(offenders) {
  const lines = offenders.map(
    (o) => `- ${o.label}: ${o.filledCount} de ${o.totalRows} fila(s) tienen valor, vacío en fila(s) ${o.emptyRowNumbers.join(', ')}.`
  )
  return [
    'El archivo tiene columna(s) con datos incompletos — completá el dato faltante',
    'en el Excel de origen o borrá la columna entera si no vas a cargar ese dato',
    'todavía:',
    ...lines,
  ].join('\n')
}

/**
 * Segunda pasada sobre las filas ya normalizadas: detecta duplicados
 * INTERNOS del archivo subido (mismo valor repetido en más de una fila)
 * para los campos indicados, y marca inválidas todas las filas
 * involucradas — incluida la primera ocurrencia, para que quede claro en
 * la vista previa cuáles filas chocan entre sí. Los duplicados contra la
 * base de datos ya existente se detectan aparte (ver applySocioDbChecks/
 * applyParcelaDbChecks más abajo) — misma vista previa si se le pasa
 * supabase/organizationId, además del chequeo redundante que igual corre
 * al confirmar la importación (createSocio/createParcela en
 * lib/actions/sociosActions.js), por si el archivo cambió entre la
 * vista previa y la confirmación.
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

function uniqueNonEmpty(values) {
  return [...new Set((values || []).map((v) => (v ?? '').toString().trim()).filter(Boolean))]
}

/**
 * Consulta PADRON_SOCIOS (organización activa) por los valores de
 * ID_Socio/socio_dni/codigo_finca presentes en las filas, y marca
 * inválida cualquier fila cuyo valor YA EXISTA en la base — mismos
 * chequeos que corren al confirmar la importación
 * (assertDniNotDuplicated/assertCodigoFincaNotDuplicated en
 * lib/actions/sociosActions.js, y la PK de PADRON_SOCIOS para ID_Socio),
 * pero adelantados a la vista previa (2026-08-19, pedido explícito) para
 * que el usuario vea el motivo ANTES de presionar "Confirmar
 * Importación" en vez de enterarse fila por fila después. Todas las
 * filas del archivo son ALTAS nuevas — a diferencia de una edición
 * individual, acá no hay "propio registro" que excluir del chequeo.
 */
async function applySocioDbChecks(results, normalizedRows, supabase, organizationId) {
  const idSocios = uniqueNonEmpty(normalizedRows.map((r) => r.ID_Socio))
  const dnis = uniqueNonEmpty(normalizedRows.map((r) => r.socio_dni))
  const codigosFinca = uniqueNonEmpty(normalizedRows.map((r) => r.codigo_finca))
  if (idSocios.length === 0 && dnis.length === 0 && codigosFinca.length === 0) return results

  const [byId, byDni, byCodigo] = await Promise.all([
    idSocios.length
      ? supabase.from('PADRON_SOCIOS').select('ID_Socio').eq('ID_Organizacion', organizationId).in('ID_Socio', idSocios)
      : Promise.resolve({ data: [] }),
    dnis.length
      ? supabase.from('PADRON_SOCIOS').select('ID_Socio, socio_dni').eq('ID_Organizacion', organizationId).in('socio_dni', dnis)
      : Promise.resolve({ data: [] }),
    codigosFinca.length
      ? supabase
          .from('PADRON_SOCIOS')
          .select('ID_Socio, codigo_finca')
          .eq('ID_Organizacion', organizationId)
          .in('codigo_finca', codigosFinca)
      : Promise.resolve({ data: [] }),
  ])
  if (byId.error) throw byId.error
  if (byDni.error) throw byDni.error
  if (byCodigo.error) throw byCodigo.error

  const existingIds = new Set((byId.data ?? []).map((r) => r.ID_Socio))
  const existingDnis = new Map((byDni.data ?? []).map((r) => [r.socio_dni, r.ID_Socio]))
  const existingCodigos = new Map((byCodigo.data ?? []).map((r) => [r.codigo_finca, r.ID_Socio]))

  normalizedRows.forEach((row, i) => {
    const id = (row.ID_Socio ?? '').toString().trim()
    const dni = (row.socio_dni ?? '').toString().trim()
    const codigo = (row.codigo_finca ?? '').toString().trim()
    if (id && existingIds.has(id)) {
      results[i].valid = false
      results[i].errors.push(`El Código de Socio "${id}" ya existe en esta organización.`)
    }
    if (dni && existingDnis.has(dni)) {
      results[i].valid = false
      results[i].errors.push(`El DNI ${dni} ya existe en esta organización (socio "${existingDnis.get(dni)}").`)
    }
    if (codigo && existingCodigos.has(codigo)) {
      results[i].valid = false
      results[i].errors.push(`El Código de Finca "${codigo}" ya existe en esta organización (socio "${existingCodigos.get(codigo)}").`)
    }
  })
  return results
}

/**
 * Mismo criterio que applySocioDbChecks, para PADRON_PARCELAS: marca
 * inválida una fila cuyo ID_Parcela_Fija o parcela_codigo ya exista en la
 * organización, y ADEMÁS valida que el ID_Socio referenciado exista
 * (mismo mensaje que assertSocioExists en lib/actions/sociosActions.js,
 * adelantado acá a la vista previa).
 */
async function applyParcelaDbChecks(results, normalizedRows, supabase, organizationId) {
  const parcelaIds = uniqueNonEmpty(normalizedRows.map((r) => r.ID_Parcela_Fija))
  const codigos = uniqueNonEmpty(normalizedRows.map((r) => r.parcela_codigo))
  const socioIds = uniqueNonEmpty(normalizedRows.map((r) => r.ID_Socio))
  if (parcelaIds.length === 0 && codigos.length === 0 && socioIds.length === 0) return results

  const [byId, byCodigo, socios] = await Promise.all([
    parcelaIds.length
      ? supabase.from('PADRON_PARCELAS').select('ID_Parcela_Fija').eq('ID_Organizacion', organizationId).in('ID_Parcela_Fija', parcelaIds)
      : Promise.resolve({ data: [] }),
    codigos.length
      ? supabase
          .from('PADRON_PARCELAS')
          .select('ID_Parcela_Fija, parcela_codigo')
          .eq('ID_Organizacion', organizationId)
          .in('parcela_codigo', codigos)
      : Promise.resolve({ data: [] }),
    socioIds.length
      ? supabase.from('PADRON_SOCIOS').select('ID_Socio').eq('ID_Organizacion', organizationId).in('ID_Socio', socioIds)
      : Promise.resolve({ data: [] }),
  ])
  if (byId.error) throw byId.error
  if (byCodigo.error) throw byCodigo.error
  if (socios.error) throw socios.error

  const existingParcelaIds = new Set((byId.data ?? []).map((r) => r.ID_Parcela_Fija))
  const existingCodigos = new Map((byCodigo.data ?? []).map((r) => [r.parcela_codigo, r.ID_Parcela_Fija]))
  const existingSocioIds = new Set((socios.data ?? []).map((r) => r.ID_Socio))

  normalizedRows.forEach((row, i) => {
    const parcelaId = (row.ID_Parcela_Fija ?? '').toString().trim()
    const codigo = (row.parcela_codigo ?? '').toString().trim()
    const socioId = (row.ID_Socio ?? '').toString().trim()
    if (parcelaId && existingParcelaIds.has(parcelaId)) {
      results[i].valid = false
      results[i].errors.push(`El Código de Parcela "${parcelaId}" ya existe en esta organización.`)
    }
    if (codigo && existingCodigos.has(codigo)) {
      results[i].valid = false
      results[i].errors.push(
        `El Código Interno de Parcela "${codigo}" ya existe en esta organización (parcela "${existingCodigos.get(codigo)}").`
      )
    }
    if (socioId && !existingSocioIds.has(socioId)) {
      results[i].valid = false
      results[i].errors.push(
        `El Código de Socio "${socioId}" no existe en la organización activa. Debe registrar al socio antes de importar sus parcelas.`
      )
    }
  })
  return results
}

/**
 * Valida cada fila parseada contra el schema Zod real (mismo que usa el
 * formulario/la Server Action) — sin escribir nada, es la "vista previa"
 * pedida antes de confirmar una carga masiva. Acepta encabezados legibles
 * o técnicos (ver normalizeRowKeys) y marca duplicados internos de
 * ID_Socio/DNI dentro del propio archivo.
 *
 * `supabase`/`organizationId` (opcionales): si se proveen, además
 * consulta la base en tiempo real y marca inválida cualquier fila cuyo
 * ID_Socio/socio_dni/codigo_finca ya exista en la organización (ver
 * applySocioDbChecks) — ANTES de confirmar la importación. Sin ellos,
 * queda el comportamiento anterior (solo Zod + duplicados internos del
 * archivo): sigue siendo válido llamarla así para pruebas o previews sin
 * conexión.
 *
 * ADR-027: con `supabase` provisto, además resuelve el catálogo de
 * certificaciones activas para reconocer sus columnas dinámicas en el CSV.
 * Sin `supabase`, esa resolución específica se omite (mismo criterio de
 * degradación que el resto del archivo en modo offline/test).
 *
 * Mejoras importador padrón masivo (spec `mejoras_importador_padron_masivo.md`
 * sección 2, 2026-08-31): una columna que no matchea ningún campo fijo
 * conocido ni el nombre de una certificación activa YA NO rechaza el
 * archivo completo — se acumula en `unrecognizedColumns` (aviso no
 * bloqueante) del valor de retorno. El archivo SÍ se rechaza completo
 * (lanza) si alguna columna reconocida resulta "dispareja" — al menos 1
 * fila con valor y al menos 1 vacía (sección 3 del mismo spec, ver
 * `findUnevenColumns`).
 *
 * @returns {Promise<{rows: Array, unrecognizedColumns: string[]}>}
 */
export async function validateSocioRows(rows, supabase, organizationId) {
  let reverseMap = SOCIO_REVERSE_LABELS
  let unrecognizedColumns = []
  if (supabase) {
    try {
      const certificaciones = await fetchActiveCertificaciones(supabase)
      reverseMap = buildSocioReverseLabelsWithCertificaciones(certificaciones)
    } catch (err) {
      console.error(
        '[padronCsv] validateSocioRows: no se pudo obtener el catálogo de certificaciones activas -- sus columnas se tratan como no reconocidas:',
        err
      )
    }
    // Mejoras importador (spec mejoras_importador_padron_masivo.md sección 2):
    // ya no se rechaza el archivo completo -- se acumula como aviso no
    // bloqueante, transportado en el retorno (ver abajo).
    unrecognizedColumns = findUnrecognizedSocioColumns(rows, reverseMap)
  }

  const normalizedRows = (rows || []).map((row) => normalizeRowKeys(row, reverseMap))

  // "Columna dispareja" (spec sección 3): chequeo bloqueante, corre antes
  // de Zod/duplicados/BD -- si el archivo va a rechazarse igual, no tiene
  // sentido gastar una ida y vuelta a la base primero.
  const uneven = findUnevenColumns(normalizedRows, SOCIO_UNEVEN_CHECK_FIELDS)
  if (uneven.length > 0) {
    throw new Error(formatUnevenColumnsError(uneven))
  }

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
  applyDuplicateChecks(results, normalizedRows, [
    { key: 'ID_Socio', label: 'Código de Socio' },
    { key: 'socio_dni', label: 'DNI' },
  ])
  if (supabase && organizationId) {
    await applySocioDbChecks(results, normalizedRows, supabase, organizationId)
  }
  return { rows: results, unrecognizedColumns }
}

/**
 * Ver validateSocioRows — mismo criterio, `supabase`/`organizationId`
 * opcionales. Mejoras importador (spec sección 2): a diferencia de
 * Socios, `findUnrecognizedParcelaColumns` no depende de `supabase` (sin
 * columnas dinámicas de catálogo en Parcelas) -- corre siempre.
 */
export async function validateParcelaRows(rows, supabase, organizationId) {
  const unrecognizedColumns = findUnrecognizedParcelaColumns(rows)

  const normalizedRows = (rows || []).map((row) => {
    const normalized = normalizeRowKeys(row, PARCELA_REVERSE_LABELS)
    for (const key of HECTARE_FIELD_KEYS) {
      if (normalized[key] === '') normalized[key] = null
    }
    return normalized
  })

  const uneven = findUnevenColumns(normalizedRows, PARCELA_UNEVEN_CHECK_FIELDS)
  if (uneven.length > 0) {
    throw new Error(formatUnevenColumnsError(uneven))
  }

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
  applyDuplicateChecks(results, normalizedRows, [{ key: 'ID_Parcela_Fija', label: 'Código de Parcela' }])
  if (supabase && organizationId) {
    await applyParcelaDbChecks(results, normalizedRows, supabase, organizationId)
  }
  return { rows: results, unrecognizedColumns }
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
 * `supabase`/`organizationId` (opcionales): si se proveen, calcula un
 * ID_Socio LIBRE a partir del correlativo más alto ya usado en la
 * organización activa (ver buildSocioTemplateCsv). Sin ellos —o si la
 * consulta falla— cae al ID fijo de siempre en vez de romper la
 * descarga.
 *
 * ADR-027: con `supabase` (sin necesitar `organizationId` -- el catálogo
 * no está scopeado por organización), agrega también las columnas
 * dinámicas de certificaciones activas. Si esa consulta falla, la
 * plantilla se descarga igual, sin esas columnas, en vez de romper la
 * descarga completa.
 */
export async function downloadSocioTemplate(supabase, organizationId) {
  let sampleSocioId
  if (supabase && organizationId) {
    try {
      const existingIds = await fetchExistingCodes(supabase, 'PADRON_SOCIOS', 'ID_Socio', organizationId)
      sampleSocioId = computeNextCodes(existingIds, 1, { defaultPrefix: 'JS-', defaultPadLength: 5 })[0]
    } catch (err) {
      console.error('[padronCsv] downloadSocioTemplate: no se pudo calcular un Código de Socio libre, usando el de respaldo:', err)
    }
  }
  let certificaciones = []
  if (supabase) {
    try {
      certificaciones = await fetchActiveCertificaciones(supabase)
    } catch (err) {
      console.error(
        '[padronCsv] downloadSocioTemplate: no se pudieron obtener las certificaciones activas, la plantilla queda sin esas columnas:',
        err
      )
    }
  }
  triggerCsvDownload('Plantilla_Socios.csv', buildSocioTemplateCsv(sampleSocioId, certificaciones))
}

/**
 * `supabase`/`organizationId` (opcionales): si se proveen, consulta
 * ID_Socio reales y activos de la organización activa para la fila de
 * ejemplo (ver fetchSampleSocioIds), y los ID_Parcela_Fija/parcela_codigo
 * ya usados para calcular códigos libres (ver buildParcelaTemplateCsv).
 * Sin ellos —o si la consulta falla— cae a los valores fijos de siempre
 * en vez de romper la descarga: la plantilla debe seguir siendo útil
 * aunque la consulta de ejemplo no lo sea.
 */
export async function downloadParcelaTemplate(supabase, organizationId) {
  let sampleSocioIds = []
  let existingCodigos = []
  let existingParcelaIds = []
  if (supabase && organizationId) {
    try {
      ;[sampleSocioIds, existingCodigos, existingParcelaIds] = await Promise.all([
        fetchSampleSocioIds(supabase, organizationId, 2),
        fetchExistingCodes(supabase, 'PADRON_PARCELAS', 'parcela_codigo', organizationId),
        fetchExistingCodes(supabase, 'PADRON_PARCELAS', 'ID_Parcela_Fija', organizationId),
      ])
    } catch (err) {
      console.error('[padronCsv] downloadParcelaTemplate: no se pudieron obtener datos reales de ejemplo, usando los valores de respaldo:', err)
    }
  }
  triggerCsvDownload('Plantilla_Parcelas.csv', buildParcelaTemplateCsv(sampleSocioIds, existingCodigos, existingParcelaIds))
}

/**
 * Exporta el padrón ACTIVO de socios (no solo la página visible actual) —
 * hace su propio fetch sin paginar. PostgREST limita a 1000 filas por
 * defecto; para un padrón cooperativo real esto alcanza, pero si algún
 * día se supera, esta función necesitará paginar el fetch (no
 * implementado — no hay indicio hoy de que haga falta).
 *
 * ADR-027: las certificaciones ya no viven en PADRON_SOCIOS (columnas
 * congeladas, sin uso) — se leen de SOCIO_CERTIFICACIONES, la fuente de
 * verdad real de acá en adelante, y se arman como columnas dinámicas
 * (una celda 'Sí'/'No' por certificación activa y socio exportado).
 */
export async function exportSociosCsv(supabase) {
  const [{ data, error }, certificaciones] = await Promise.all([
    supabase
      .from('PADRON_SOCIOS')
      .select([...SOCIO_EXPORT_COLUMNS, 'id'].join(','))
      .eq('activo', true)
      .order('socio_nombre_completo'),
    fetchActiveCertificaciones(supabase),
  ])
  if (error) throw error
  const socios = data ?? []

  const socioIds = socios.map((s) => s.id).filter(Boolean)
  let certRows = []
  if (socioIds.length > 0) {
    const { data: rows, error: certErr } = await supabase
      .from('SOCIO_CERTIFICACIONES')
      .select('id_socio, id_certificacion')
      .in('id_socio', socioIds)
    if (certErr) throw certErr
    certRows = rows ?? []
  }
  const certIdsBySocio = new Map()
  for (const row of certRows) {
    if (!certIdsBySocio.has(row.id_socio)) certIdsBySocio.set(row.id_socio, new Set())
    certIdsBySocio.get(row.id_socio).add(row.id_certificacion)
  }
  // Mejoras importador (spec sección 1): cert_org_estatus se sobrescribe
  // con el valor EN VIVO de SOCIO_CERTIFICACIONES -- el que trae `s` de
  // PADRON_SOCIOS está congelado desde ADR-027 (nunca se escribe ahí).
  const certOrgEstatusBySocio = await fetchSocioCertOrgEstatus(supabase, socioIds)
  const enriched = socios.map((s) => {
    const owned = certIdsBySocio.get(s.id) ?? new Set()
    const certCells = Object.fromEntries(certificaciones.map((c) => [c.id, owned.has(c.id) ? 'Sí' : 'No']))
    return { ...s, ...certCells, cert_org_estatus: certOrgEstatusBySocio.get(s.id) ?? '' }
  })

  triggerCsvDownload(`Padron_Socios_${todayStamp()}.csv`, buildSociosCsv(enriched, certificaciones))
  return { socios: enriched.length }
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
