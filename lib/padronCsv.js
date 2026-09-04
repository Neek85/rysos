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
import { getDepartamentos, getProvincias, getDistritos } from './ubigeoData.js'
import {
  fnPadronSociosExistentes,
  fnPadronParcelasExistentes,
  fnPadronSociosIdsTodos,
  fnPadronSociosSampleActivos,
  fnPadronParcelasCodigosEIds,
  fnExportarPadronSocios,
  fnExportarPadronParcelas,
} from './actions/padronReadActions.js'

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
  // mejoras_importador_padron_masivo.md ronda 4: formato ÚNICO M/D/AAAA
  // (mes primero, ver fechaNacimiento en lib/validations/socios.js) -- ya
  // no acepta guiones ISO ni D/M/AAAA. "5/14/1980" = 14 de mayo.
  socio_fecha_nacimiento: '5/14/1980',
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

// fetchSampleSocioIds/fetchExistingCodes (consultaban PADRON_SOCIOS/
// PADRON_PARCELAS directo con la llave `anon`) se retiraron -- ver
// AI_STATE.md "Reemplazo SECURITY DEFINER para lecturas de
// PADRON_SOCIOS/PADRON_PARCELAS". downloadSocioTemplate/
// downloadParcelaTemplate llaman directo a fnPadronSociosIdsTodos/
// fnPadronSociosSampleActivos/fnPadronParcelasCodigosEIds
// (lib/actions/padronReadActions.js) en su lugar.

// ── Importación ──────────────────────────────────────────────────────

/**
 * Mejoras importador padrón masivo (spec `mejoras_importador_padron_masivo.md`
 * sección 0, ronda 3): decodifica un ArrayBuffer de archivo CSV probando
 * UTF-8 estricto primero (`fatal: true`) y, si falla, reintenta como
 * windows-1252 -- causa raíz REAL de "5 columnas no reconocidas, 0/825
 * filas válidas" en la primera carga real de producción (COOP-AROMAS-VALLE,
 * spec sección 0.a), no un problema de reverse-label-map ni de delimitador
 * (commit e031450 no cubre esto, es un problema distinto). Un CSV
 * exportado por Excel como "CSV" plano (no "CSV UTF-8") queda en
 * Windows-1252/ANSI -- el byte suelto 0xF3 de "ó" en esa codificación NO
 * es una secuencia UTF-8 válida, así que `fatal: true` lo detecta y
 * dispara el fallback. Un archivo ya en UTF-8 correcto (con o sin BOM, que
 * `TextDecoder('utf-8')` ya quita por default) nunca activa el fallback.
 * Función pura (ArrayBuffer -> string) para que sea testeable en Node sin
 * la API de `File`/`Blob` del navegador -- `TextDecoder` es global tanto
 * en Node como en el navegador. `ImportPadronModal.jsx` es la única
 * responsable de obtener el `ArrayBuffer` real (`file.arrayBuffer()`).
 */
export function decodeCsvBuffer(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

/**
 * Soporte CSV delimitador flexible (spec `soporte_csv_delimitador_flexible.md`
 * sección 1.1): cuenta ',' y ';' fuera de comillas en la PRIMERA línea
 * (la cabecera) de `text` -- ya sin BOM, ver parseCsv. Si hay más ';' que
 * ',', el archivo completo se parsea con ';'; en cualquier otro caso
 * (incluido un empate o 0 de cada uno) se usa ',' -- mismo resultado que
 * el parser de siempre para todo archivo que no traiga ningún ';'. El
 * delimitador se decide UNA VEZ por archivo, nunca fila por fila.
 */
function detectDelimiter(text) {
  let inQuotes = false
  let commaCount = 0
  let semicolonCount = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    if (char === '\n' || char === '\r') break // fin de la primera línea
    if (char === ',') commaCount++
    else if (char === ';') semicolonCount++
  }
  return semicolonCount > commaCount ? ';' : ','
}

/**
 * Parser CSV simple (sin librería externa): soporta campos entre comillas
 * dobles con comas/saltos de línea embebidos y comillas escapadas (""),
 * mismo formato que produce arrayToCsv/Excel. Función pura, texto -> array
 * de objetos (clave = columna del encabezado, tal cual viene en el
 * archivo — la traducción legible/técnica pasa después, en
 * normalizeRowKeys).
 *
 * Soporte CSV delimitador flexible (spec `soporte_csv_delimitador_flexible.md`):
 * detecta ',' o ';' automáticamente (ver detectDelimiter) -- comportamiento
 * sin cambios para cualquier archivo separado por ',' de siempre. Puede
 * LANZAR (a diferencia de antes) si, ya elegido el delimitador único de la
 * cabecera, alguna fila de datos resulta con un número de columnas
 * distinto al de la cabecera -- señal de delimitador mezclado entre filas,
 * rechazado explícito en vez de rellenar/truncar en silencio (sección 1.3
 * del spec). `ImportPadronModal.jsx` ya envuelve la llamada a `parseCsv`
 * en un try/catch (no necesitó cambios).
 */
export function parseCsv(text) {
  // Quita un posible BOM UTF-8 al inicio (el que agrega triggerCsvDownload)
  // ANTES de sniffear el delimitador -- detectDelimiter nunca ve el BOM.
  const clean = text.replace(/^﻿/, '')
  const delimiter = detectDelimiter(clean)

  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

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
    } else if (char === delimiter) {
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

  // Delimitador inconsistente entre filas (spec sección 1.3): con el
  // delimitador único ya elegido, cualquier fila con un número de
  // columnas distinto al de la cabecera es un archivo malformado --
  // mismo criterio de "nunca en silencio" que findUnevenColumns/
  // findUnrecognizedSocioColumns más abajo, numeración de fila idéntica
  // (fila 1 = encabezado).
  const mismatched = []
  nonEmptyRows.slice(1).forEach((cells, i) => {
    if (cells.length !== header.length) mismatched.push({ line: i + 2, count: cells.length })
  })
  if (mismatched.length > 0) {
    throw new Error(
      `El archivo tiene un número de columnas inconsistente entre filas (posible delimitador mezclado ',' / ';'): ` +
        `el encabezado tiene ${header.length} columna(s), pero ` +
        mismatched.map((m) => `la fila ${m.line} tiene ${m.count}`).join(', ') +
        `. Revisá que todo el archivo use el mismo separador.`
    )
  }

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

// Mejoras importador padrón masivo (spec sección 9.3, ronda 6; extendido
// ronda 7): alias defensivo de los labels VIEJOS de hip/hrp -- por si
// queda algún archivo exportado con un label anterior al actual dando
// vueltas. Se agregan DESPUÉS de construir el mapa desde
// PARCELA_FIELD_LABELS (que solo tiene el label CANÓNICO actual) para no
// romper esa única fuente de verdad -- este archivo es el único lugar que
// necesita reconocer los alias, ParcelaFormModal.jsx no lee CSVs.
//
// hip tiene 2 alias (historial de 2 correcciones sobre el mismo campo):
// "Ha. Infraestructura Productiva" (original, antes de la ronda 3) y
// "Ha. Invernadero/Pasto" (corrección de la ronda 3, que a su vez resultó
// tener el texto exacto mal -- ronda 7 lo corrigió a "Ha. Inverna/Pasto",
// el canónico actual en HECTARE_FIELDS). Los 3 mapean al mismo campo hip.
// hrp solo tiene su alias original -- no fue tocado en la ronda 7.
PARCELA_REVERSE_LABELS.set('ha. infraestructura productiva', 'hip')
PARCELA_REVERSE_LABELS.set('ha. invernadero/pasto', 'hip')
PARCELA_REVERSE_LABELS.set('ha. reserva/protección', 'hrp')

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

// ── "Columna dispareja" (spec sección 3, alcance corregido en la ronda 3
// -- mejoras_importador_padron_masivo.md) ──────────────────────────────
// Socios: el chequeo se RETIRA por completo -- ronda 3 (2026-08-31, tras
// la primera carga real de COOP-AROMAS-VALLE) exime a TODOS los campos
// opcionales de Socios, no solo a las 8 de certificación/cert_org_estatus
// que ya estaban implícitamente cubiertas por vivir fuera de
// SOCIO_FIELD_LABELS -- ahora también codigo_finca/socio_genero/
// socio_fecha_nacimiento/celular_socio/socio_departamento/etc. quedan
// exentas, igual que ya lo están ID_Socio/socio_nombre_completo (los 2
// únicos campos realmente obligatorios). socio_dni ya no aplica acá de
// todos modos -- pasó a ser obligatorio en socioSchema (ver dniRequerido
// en lib/validations/socios.js), así que su ausencia/formato inválido ya
// se resuelve por fila (Zod), no por archivo completo.
//
// Parcelas: SIN CAMBIOS (confirmado en la investigación de esta ronda:
// parcela_codigo/parcela_nombre están 100% completos en las 825 filas
// reales, el chequeo no genera falsos positivos ahí).

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

/**
 * Soporte CSV delimitador flexible (spec `soporte_csv_delimitador_flexible.md`
 * sección 1.4): tolerancia de separador decimal para las 7 columnas de
 * hectárea. Si `value` es un string con EXACTAMENTE una coma y ningún
 * punto, se interpreta como coma decimal (configuración regional de
 * Perú/Excel) y se reemplaza por punto. Cualquier otro caso (ya tiene
 * punto, no tiene coma, o tiene ambos -- ej. "1.234,56" con agrupación de
 * miles) se deja tal cual, sin adivinar; si termina en NaN, el error de
 * Zod existente ya lo comunica. Solo se usa en validateParcelaRows --
 * socioSchema no tiene ningún campo numérico (confirmado en el spec,
 * sección 0), no hace falta aplicarlo en validateSocioRows.
 */
function normalizeDecimalComma(value) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === '') return trimmed
  const hasSingleComma = (trimmed.match(/,/g) || []).length === 1
  if (hasSingleComma && !trimmed.includes('.')) {
    return trimmed.replace(',', '.')
  }
  return trimmed
}

/**
 * Mejoras importador padrón masivo (spec sección 9.1, ronda 6): tolerancia
 * de variantes de "Sí"/"No" en los 8 flags de certificación. Evidencia
 * real confirmada por el usuario: el archivo real usa "Si" (sin tilde) y
 * "No", con una columna (Rainforest Alliance) en "SI" mayúsculas -- nunca
 * aparece "Sí" con tilde en los datos reales. Se normaliza acá, ANTES de
 * Zod, hacia 'Sí' (con tilde) -- confirmado como el valor CANÓNICO real
 * que el resto del sistema ya espera, no "Si" sin tilde:
 * `lib/actions/sociosActions.js:322` compara literal
 * `parsed[field] === 'Sí'` para decidir qué certificaciones sincronizar a
 * SOCIO_CERTIFICACIONES -- si el canónico fuera "Si" sin tilde, ese
 * archivo (fuera de alcance de esta tarea) también habría que tocarlo.
 * Normalizando acá, `sociosActions.js` no necesita ningún cambio.
 * Reusa `normalizeForCatalogMatch` (más abajo) para el mismo criterio de
 * "ignorar mayúsculas/tildes" que ya usa el ubigeo.
 */
function normalizeSiNo(value) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === '') return trimmed
  const stripped = normalizeForCatalogMatch(trimmed)
  if (stripped === 'si') return 'Sí'
  if (stripped === 'no') return 'No'
  return trimmed
}

/**
 * Mejoras importador padrón masivo (spec sección 1g, ronda 3): aviso NO
 * bloqueante si la suma de las 7 hectáreas de una fila alcanza o supera
 * 1000 -- deja de caber en 3 dígitos, fuera de rango típico para un
 * pequeño productor (máximo real observado en la primera carga real,
 * COOP-AROMAS-VALLE/825 parcelas: 30). La fila sigue siendo
 * válida/importable -- mismo patrón de warnings no bloqueantes que
 * `unrecognizedColumns` (ronda 2): un array de strings ya formateados que
 * el modal muestra en un banner, sin bloquear "Confirmar Importación".
 */
function findHectareRangeWarnings(normalizedRows) {
  const warnings = []
  normalizedRows.forEach((row, i) => {
    const total = HECTARE_FIELD_KEYS.reduce((sum, key) => sum + (Number(row[key]) || 0), 0)
    if (total >= 1000) {
      warnings.push(`Fila ${i + 2}: suma de hectáreas = ${total} -- fuera de rango típico para un pequeño productor.`)
    }
  })
  return warnings
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

/**
 * Mejoras importador padrón masivo (spec sección 1f, ronda 3): normaliza
 * para comparar contra el catálogo de Departamento ignorando mayúsculas y
 * tildes de forma razonable (`normalize('NFD')` + strip de diacríticos) --
 * "cajamarca"/"CAJAMARCA"/"Cájamarca" deben matchear "Cajamarca" igual.
 */
function normalizeForCatalogMatch(value) {
  return (value ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Catálogo REAL ya existente en el repo (lib/data/ubigeo_peru.json, usado
// hoy por UbigeoSelect.jsx en el formulario manual) -- no se creó ningún
// archivo nuevo, ver corrección de premisa en el spec sección 0. Ronda 3
// validaba solo Departamento; ronda 4 extendió a Provincia; ronda 5
// (mejoras_importador_padron_masivo.md sección 8) extiende a Distrito --
// el catálogo ya tenía los ~1869 distritos completos, no hizo falta
// agregar ningún dato nuevo, solo usar getDistritos() (lib/ubigeoData.js)
// que ya existía. Confianza del dato de distrito MENOR que
// departamento/provincia (ver docs/schema_live_core.md, sección PADRON_SOCIOS, y el propio
// `_meta` del JSON) -- riesgo de falso rechazo aceptado explícitamente
// (documentado en el spec, no una omisión).
//
// Mapa normalizado -> nombre CANÓNICO (no solo un Set) porque
// getProvincias(departamentoNombre)/getDistritos(departamentoNombre,
// provinciaNombre) necesitan el nombre EXACTO del catálogo para resolver
// el nivel siguiente -- si el archivo trae "CAJAMARCA" hay que resolverlo
// a "Cajamarca" antes de poder llamar getProvincias, y de ahí en más en
// cascada para Distrito.
const DEPARTAMENTOS_CANONICOS_POR_NORMALIZADO = new Map(getDepartamentos().map((d) => [normalizeForCatalogMatch(d), d]))

/**
 * Mejoras importador padrón masivo (spec sección 1f/7/8, rondas 3-5):
 * rechazo de FILA (no de archivo completo) en cascada Departamento ->
 * Provincia -> Distrito -- cada nivel debe pertenecer al nivel anterior
 * declarado EN LA MISMA FILA (o no existir en el catálogo). Los 3 campos
 * vacíos siguen siendo válidos (opcionales en socioSchema, sin cambios
 * acá) -- un nivel con valor pero sin el nivel anterior en la misma fila
 * SÍ se rechaza: no hay forma de validar la pertenencia sin el contexto
 * completo. Si un nivel superior ya está marcado inválido, el nivel
 * siguiente NO duplica el motivo de rechazo (un solo mensaje por causa
 * real).
 *
 * A propósito NO se agregó este chequeo a `socioSchema` (Zod compartido
 * con el formulario manual, `SocioFormModal.jsx`/`UbigeoSelect.jsx`) --
 * `UbigeoSelect.jsx` ofrece deliberadamente una opción "Otro / no está en
 * la lista" que guarda un valor de texto libre FUERA del catálogo, en los
 * 3 niveles (ver su propio comentario: "un distrito real ausente del
 * dataset NUNCA bloquea el alta de un socio real"). Si esta validación
 * viviera en `socioSchema`, elegir "Otro" en el formulario manual
 * rompería el guardado -- exactamente el caso que esa opción existe para
 * evitar. Por eso el chequeo vive acá, específico del importador masivo,
 * no en el schema compartido.
 */
function applyUbigeoCatalogChecks(results, normalizedRows) {
  normalizedRows.forEach((row, i) => {
    const departamentoValue = (row.socio_departamento ?? '').toString().trim()
    const provinciaValue = (row.socio_provincia ?? '').toString().trim()
    const distritoValue = (row.socio_distrito ?? '').toString().trim()

    let departamentoCanonico = null
    if (departamentoValue) {
      departamentoCanonico = DEPARTAMENTOS_CANONICOS_POR_NORMALIZADO.get(normalizeForCatalogMatch(departamentoValue)) ?? null
      if (!departamentoCanonico) {
        results[i].valid = false
        results[i].errors.push(`"${departamentoValue}" no se reconoce como Departamento válido de Perú.`)
      }
    }

    let provinciaCanonica = null
    if (provinciaValue) {
      if (!departamentoCanonico) {
        // Sin Departamento (o con uno inválido, ya marcado arriba) no hay
        // forma de validar a qué departamento debería pertenecer la
        // Provincia -- se rechaza con un mensaje propio solo si el
        // Departamento estaba VACÍO (si ya estaba inválido, ese error de
        // arriba alcanza, no hace falta duplicar el motivo de rechazo).
        if (!departamentoValue) {
          results[i].valid = false
          results[i].errors.push(`La Provincia "${provinciaValue}" no se puede validar sin un Departamento en la misma fila.`)
        }
      } else {
        const provinciasPorNormalizado = new Map(getProvincias(departamentoCanonico).map((p) => [normalizeForCatalogMatch(p), p]))
        provinciaCanonica = provinciasPorNormalizado.get(normalizeForCatalogMatch(provinciaValue)) ?? null
        if (!provinciaCanonica) {
          results[i].valid = false
          results[i].errors.push(
            `La Provincia "${provinciaValue}" no pertenece al Departamento "${departamentoCanonico}" (o no existe en el catálogo).`
          )
        }
      }
    }

    if (!distritoValue) return

    if (!provinciaCanonica) {
      // Mismo criterio que Provincia sin Departamento: solo agrega un
      // mensaje propio si la Provincia estaba VACÍA -- si estaba
      // presente pero inválida (o sin Departamento válido), ese error ya
      // cubre la fila.
      if (!provinciaValue) {
        results[i].valid = false
        results[i].errors.push(`El Distrito "${distritoValue}" no se puede validar sin una Provincia en la misma fila.`)
      }
      return
    }

    const distritosNormalizados = getDistritos(departamentoCanonico, provinciaCanonica).map(normalizeForCatalogMatch)
    if (!distritosNormalizados.includes(normalizeForCatalogMatch(distritoValue))) {
      results[i].valid = false
      results[i].errors.push(
        `El Distrito "${distritoValue}" no pertenece a la Provincia "${provinciaCanonica}" (o no existe en el catálogo).`
      )
    }
  })
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
// Mejoras importador padrón masivo (spec sección 12.4, ronda 9): sufijo
// EXACTO compartido por los 2 mensajes de "ID_Socio/ID_Parcela_Fija ya
// existe" (el propio código de la fila, no un DNI/código secundario
// distinto perteneciendo a otro registro -- esos siguen siendo errores
// reales de datos, mensaje sin cambios). Exportado para que
// ImportPadronModal.jsx pueda distinguir estos grupos ("esperable al
// reintentar una carga cortada") de un error real de datos en el resumen
// agrupado, sin tener que duplicar el texto exacto en 2 archivos.
export const DUPLICATE_SKIP_SUFFIX = '— se omite, no se vuelve a cargar.'

// `fetchExistentes` inyectable (default: fnPadronSociosExistentes real,
// vía Server Action/Service Role Key) -- mismo patrón ya usado en
// lib/sociosSearch.js::fetchSocios (`resolveOrganizationIdFallback`),
// para poder testear sin depender de la Service Role Key real (ver
// tests/test_padron_csv.mjs).
async function applySocioDbChecks(results, normalizedRows, organizationId, fetchExistentes = fnPadronSociosExistentes) {
  const idSocios = uniqueNonEmpty(normalizedRows.map((r) => r.ID_Socio))
  const dnis = uniqueNonEmpty(normalizedRows.map((r) => r.socio_dni))
  const codigosFinca = uniqueNonEmpty(normalizedRows.map((r) => r.codigo_finca))
  if (idSocios.length === 0 && dnis.length === 0 && codigosFinca.length === 0) return results

  // Reemplaza las 3 consultas paralelas de antes (una por cada campo) por
  // una sola llamada a fn_padron_socios_existentes (SECURITY DEFINER) --
  // ver AI_STATE.md "Reemplazo SECURITY DEFINER para lecturas de
  // PADRON_SOCIOS/PADRON_PARCELAS". Ya no consulta PADRON_SOCIOS directo
  // con la llave `anon`.
  const matches = await fetchExistentes(organizationId, { idSocios, dnis, codigosFinca })

  const existingIds = new Set()
  const existingDnis = new Map()
  const existingCodigos = new Map()
  for (const row of matches) {
    if (idSocios.includes(row.ID_Socio)) existingIds.add(row.ID_Socio)
    if (row.socio_dni && dnis.includes(row.socio_dni)) existingDnis.set(row.socio_dni, row.ID_Socio)
    if (row.codigo_finca && codigosFinca.includes(row.codigo_finca)) existingCodigos.set(row.codigo_finca, row.ID_Socio)
  }

  normalizedRows.forEach((row, i) => {
    const id = (row.ID_Socio ?? '').toString().trim()
    const dni = (row.socio_dni ?? '').toString().trim()
    const codigo = (row.codigo_finca ?? '').toString().trim()
    if (id && existingIds.has(id)) {
      results[i].valid = false
      results[i].errors.push(`Este socio ya está registrado (código "${id}" ya existe en el sistema) ${DUPLICATE_SKIP_SUFFIX}`)
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
 *
 * Mejoras importador padrón masivo (spec sección 1h, ronda 3): además de
 * marcar cada fila individual inválida (sin cambios, mensaje por fila
 * sigue igual), agrupa los ID_Socio no encontrados en un Map (socioId ->
 * [línea, línea, ...]) y lo devuelve -- validateParcelaRows arma con esto
 * un resumen agrupado (`missingSocioWarnings`), para que el usuario vea de
 * una sola vez qué códigos de socio faltan en una carga real de cientos de
 * filas, sin tener que revisar fila por fila. Confirmado con la primera
 * carga real (825 parcelas): 1 de 616 ID_Socio referenciados no existía --
 * literalmente el string `#N/D` (error de fórmula de Excel filtrado a la
 * celda), evidencia real de por qué el resumen agrupado importa: el
 * usuario necesita ver ese valor tal cual para reconocer que es un error
 * de su propio Excel, no un código real mal tipeado.
 */
// `fetchParcelasExistentes`/`fetchSociosExistentes` inyectables --
// mismo motivo que en applySocioDbChecks arriba.
async function applyParcelaDbChecks(
  results,
  normalizedRows,
  organizationId,
  fetchParcelasExistentes = fnPadronParcelasExistentes,
  fetchSociosExistentes = fnPadronSociosExistentes
) {
  const parcelaIds = uniqueNonEmpty(normalizedRows.map((r) => r.ID_Parcela_Fija))
  const codigos = uniqueNonEmpty(normalizedRows.map((r) => r.parcela_codigo))
  const socioIds = uniqueNonEmpty(normalizedRows.map((r) => r.ID_Socio))
  const missingSocios = new Map()
  if (parcelaIds.length === 0 && codigos.length === 0 && socioIds.length === 0) return missingSocios

  // Reemplaza las 3 consultas paralelas de antes por 2 llamadas a las
  // funciones SECURITY DEFINER (fn_padron_parcelas_existentes +
  // fn_padron_socios_existentes, esta última reutilizada de
  // applySocioDbChecks arriba) -- ver AI_STATE.md "Reemplazo SECURITY
  // DEFINER para lecturas de PADRON_SOCIOS/PADRON_PARCELAS".
  const [parcelaMatches, socioMatches] = await Promise.all([
    parcelaIds.length || codigos.length
      ? fetchParcelasExistentes(organizationId, { ids: parcelaIds, codigos })
      : Promise.resolve([]),
    socioIds.length ? fetchSociosExistentes(organizationId, { idSocios: socioIds }) : Promise.resolve([]),
  ])

  const existingParcelaIds = new Set(parcelaMatches.filter((r) => parcelaIds.includes(r.ID_Parcela_Fija)).map((r) => r.ID_Parcela_Fija))
  const existingCodigos = new Map(
    parcelaMatches.filter((r) => r.parcela_codigo && codigos.includes(r.parcela_codigo)).map((r) => [r.parcela_codigo, r.ID_Parcela_Fija])
  )
  const existingSocioIds = new Set(socioMatches.map((r) => r.ID_Socio))

  normalizedRows.forEach((row, i) => {
    const parcelaId = (row.ID_Parcela_Fija ?? '').toString().trim()
    const codigo = (row.parcela_codigo ?? '').toString().trim()
    const socioId = (row.ID_Socio ?? '').toString().trim()
    if (parcelaId && existingParcelaIds.has(parcelaId)) {
      results[i].valid = false
      results[i].errors.push(
        `Esta parcela ya está registrada (código "${parcelaId}" ya existe en el sistema) ${DUPLICATE_SKIP_SUFFIX}`
      )
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
        isExcelFormulaError(socioId)
          ? `Valor de socio inválido: "${socioId}" — revisá esta celda en tu Excel de origen (parece un error de fórmula, no un código real).`
          : `El Código de Socio "${socioId}" no existe en la organización activa. Debe registrar al socio antes de importar sus parcelas.`
      )
      if (!missingSocios.has(socioId)) missingSocios.set(socioId, [])
      missingSocios.get(socioId).push(i + 2)
    }
  })
  return missingSocios
}

// Mejoras importador padrón masivo (spec sección 9.5, ronda 6): valores
// literales que Excel/Google Sheets escriben en una celda cuando una
// fórmula falla (VLOOKUP sin match, referencia rota, etc.) -- ninguno
// podría ser jamás un ID_Socio real, así que detectarlos permite avisar
// específicamente "esto es un error de fórmula en tu Excel", no un
// genérico "socio no encontrado". Confirmado con evidencia real: 1 de 616
// ID_Socio referenciados por las 825 parcelas de la primera carga real
// (COOP-AROMAS-VALLE) era literalmente "#N/D".
const EXCEL_FORMULA_ERROR_VALUES = new Set(['#N/D', '#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NULL!', '#NOMBRE?', '#NUM!'])
function isExcelFormulaError(value) {
  return EXCEL_FORMULA_ERROR_VALUES.has((value ?? '').toString().trim().toUpperCase())
}

// Mejoras importador padrón masivo (spec sección 9.4, ronda 6): mapa
// completo campo técnico -> label humano para Socios, usado para prefijar
// los mensajes de error de Zod con el nombre visible del campo en vez de
// la clave técnica cruda (ej. "DNI: El DNI debe tener 8 dígitos" en vez
// de "socio_dni: El DNI debe tener 8 dígitos"). SOCIO_FIELD_LABELS no
// incluye las 8 de CERT_FLAG_FIELDS (son columnas dinámicas del CSV,
// ADR-027) -- se agregan acá aparte.
const SOCIO_ERROR_LABELS = {
  ...SOCIO_FIELD_LABELS,
  ...Object.fromEntries(CERT_FLAG_FIELDS.map(({ field, label }) => [field, label])),
}

/**
 * Traduce los issues de un `safeParse` fallido a mensajes legibles:
 * "{label humano}: {mensaje}" en vez de "{clave técnica}: {mensaje}" (ej.
 * "hcp: El total de hectáreas debe ser mayor a 0.00 ha." pasa a "Ha. En
 * Producción: El total de hectáreas debe ser mayor a 0.00 ha."). Un campo
 * sin label conocido (no debería pasar, defensivo) cae al nombre técnico.
 */
function formatZodIssues(issues, labels) {
  return issues.map((i) => {
    const key = i.path[0]
    const label = labels[key] || key
    return `${label}: ${i.message}`
  })
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
 * Ronda 3 (mejoras_importador_padron_masivo.md, 2026-08-31, tras la
 * primera carga real de COOP-AROMAS-VALLE): "columna dispareja" retirado
 * por completo para Socios (ver el comentario en el módulo, sección
 * "Columna dispareja"); `socio_dni` pasó a obligatorio en `socioSchema`;
 * `socio_departamento`/`socio_provincia`/`socio_distrito` se validan acá
 * (no en `socioSchema`, ver `applyUbigeoCatalogChecks`) contra el
 * catálogo real de `lib/ubigeoData.js` -- Provincia valida pertenencia al
 * Departamento de la misma fila (ronda 4), Distrito valida pertenencia a
 * la Provincia de la misma fila (ronda 5).
 *
 * Ronda 4 (2026-09-01): `socio_fecha_nacimiento` valida formato ÚNICO
 * M/D/AAAA (mes primero) -- reemplaza el diseño ambiguo de la ronda 3
 * (aceptaba D/M o M/D indistintamente).
 *
 * @returns {Promise<{rows: Array, unrecognizedColumns: string[]}>}
 */
export async function validateSocioRows(rows, supabase, organizationId, { fetchSociosExistentes = fnPadronSociosExistentes } = {}) {
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

  const normalizedRows = (rows || []).map((row) => {
    const normalized = normalizeRowKeys(row, reverseMap)
    // Ronda 6 (spec sección 9.1): tolerancia Si/si/SI/Sí/sí -> 'Sí' (y
    // equivalente para 'No') en los 8 flags de certificación, ANTES de
    // que socioSchema los valide.
    for (const { field } of CERT_FLAG_FIELDS) {
      normalized[field] = normalizeSiNo(normalized[field])
    }
    return normalized
  })

  // Ronda 3 (mejoras_importador_padron_masivo.md): "columna dispareja"
  // retirado por completo para Socios -- ver el comentario en la
  // declaración de PARCELA_UNEVEN_CHECK_FIELDS más arriba.

  const results = normalizedRows.map((row, index) => {
    const result = socioSchema.safeParse(row)
    return {
      index,
      raw: rows[index],
      normalized: row,
      valid: result.success,
      data: result.success ? result.data : null,
      errors: result.success ? [] : formatZodIssues(result.error.issues, SOCIO_ERROR_LABELS),
    }
  })
  applyDuplicateChecks(results, normalizedRows, [
    { key: 'ID_Socio', label: 'Código de Socio' },
    { key: 'socio_dni', label: 'DNI' },
  ])
  applyUbigeoCatalogChecks(results, normalizedRows)
  if (organizationId) {
    await applySocioDbChecks(results, normalizedRows, organizationId, fetchSociosExistentes)
  }
  return { rows: results, unrecognizedColumns }
}

/**
 * Ver validateSocioRows — mismo criterio, `supabase`/`organizationId`
 * opcionales. Mejoras importador (spec sección 2): a diferencia de
 * Socios, `findUnrecognizedParcelaColumns` no depende de `supabase` (sin
 * columnas dinámicas de catálogo en Parcelas) -- corre siempre.
 *
 * Ronda 3 (mejoras_importador_padron_masivo.md): sin cambios en el
 * chequeo de columna dispareja para Parcelas. Retorno extendido con 2
 * campos nuevos, mismo patrón que `unrecognizedColumns` (array de strings
 * ya formateados, no bloqueantes): `hectareWarnings` (fila con suma de
 * hectáreas ≥1000, ver `findHectareRangeWarnings`) y
 * `missingSocioWarnings` (resumen agrupado de ID_Socio referenciados que
 * no existen, ver `applyParcelaDbChecks` -- solo con `supabase`+
 * `organizationId`, mismo gating que el resto de los chequeos contra BD).
 *
 * @returns {Promise<{rows: Array, unrecognizedColumns: string[], hectareWarnings: string[], missingSocioWarnings: string[]}>}
 */
export async function validateParcelaRows(
  rows,
  organizationId,
  { fetchParcelasExistentes = fnPadronParcelasExistentes, fetchSociosExistentes = fnPadronSociosExistentes } = {}
) {
  const unrecognizedColumns = findUnrecognizedParcelaColumns(rows)

  const normalizedRows = (rows || []).map((row) => {
    const normalized = normalizeRowKeys(row, PARCELA_REVERSE_LABELS)
    for (const key of HECTARE_FIELD_KEYS) {
      const value = normalizeDecimalComma(normalized[key])
      normalized[key] = value === '' ? null : value
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
      errors: result.success ? [] : formatZodIssues(result.error.issues, PARCELA_FIELD_LABELS),
    }
  })
  applyDuplicateChecks(results, normalizedRows, [{ key: 'ID_Parcela_Fija', label: 'Código de Parcela' }])

  const hectareWarnings = findHectareRangeWarnings(normalizedRows)

  let missingSocioWarnings = []
  if (organizationId) {
    const missingSocios = await applyParcelaDbChecks(results, normalizedRows, organizationId, fetchParcelasExistentes, fetchSociosExistentes)
    if (missingSocios.size > 0) {
      missingSocioWarnings = [...missingSocios.entries()].map(([socioId, lines]) =>
        isExcelFormulaError(socioId)
          ? `Valor de socio inválido: "${socioId}" — revisá esta celda en tu Excel de origen (parece un error de fórmula, no un código real) (fila(s) ${lines.join(', ')}).`
          : `El Código de Socio "${socioId}" no existe en la organización activa (fila(s) ${lines.join(', ')}).`
      )
    }
  }
  return { rows: results, unrecognizedColumns, hectareWarnings, missingSocioWarnings }
}

/**
 * Mejoras importador padrón masivo (spec sección 10.2, ronda 7): agrupa
 * las filas inválidas de `results` (el array `rows` que devuelven
 * validateSocioRows/validateParcelaRows) por el TEXTO EXACTO de cada
 * mensaje de error -- mismo mensaje = mismo grupo, sin importar en qué
 * fila apareció. Pensado para un resumen de triage rápido en el preview
 * de importación (`ImportPadronModal.jsx`), en vez de obligar a
 * desplazarse fila por fila en una lista larga para ver qué está
 * fallando.
 *
 * Una fila con MÁS DE UN error aparece en cada grupo correspondiente --
 * no se deduplica entre grupos, cada grupo es independiente por tipo de
 * error (pedido explícito).
 *
 * `codeKey`: campo de `r.normalized` a usar como "código" visible por
 * fila en la lista de afectados de cada grupo (`'ID_Socio'` para Socios,
 * `'ID_Parcela_Fija'` para Parcelas). Si la fila no tiene ese campo (ej.
 * quedó vacío, que es justamente uno de los motivos de error posibles),
 * cae al número de fila (`fila N`) para que igual sea identificable.
 *
 * Grupos ordenados de mayor a menor cantidad de filas afectadas (el
 * problema más extendido primero) -- decisión de diseño para el triage,
 * no pedida literal pero razonable dado el propósito de la función.
 *
 * @returns {Array<{ message: string, count: number, codes: string[] }>}
 */
export function groupValidationErrors(results, codeKey) {
  const groups = new Map() // message -> codes[]
  for (const r of results || []) {
    if (r.valid) continue
    for (const message of r.errors) {
      if (!groups.has(message)) groups.set(message, [])
      const code = (r.normalized?.[codeKey] ?? '').toString().trim() || `fila ${r.index + 2}`
      groups.get(message).push(code)
    }
  }
  return [...groups.entries()]
    .map(([message, codes]) => ({ message, count: codes.length, codes }))
    .sort((a, b) => b.count - a.count)
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
  if (organizationId) {
    try {
      const existingIds = await fnPadronSociosIdsTodos(organizationId)
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
  if (organizationId) {
    try {
      const [sample, codigosEIds] = await Promise.all([
        fnPadronSociosSampleActivos(organizationId, 2),
        fnPadronParcelasCodigosEIds(organizationId),
      ])
      sampleSocioIds = sample
      existingCodigos = codigosEIds.codigos
      existingParcelaIds = codigosEIds.ids
    } catch (err) {
      console.error('[padronCsv] downloadParcelaTemplate: no se pudieron obtener datos reales de ejemplo, usando los valores de respaldo:', err)
    }
  }
  triggerCsvDownload('Plantilla_Parcelas.csv', buildParcelaTemplateCsv(sampleSocioIds, existingCodigos, existingParcelaIds))
}

/**
 * Exporta el padrón ACTIVO de socios (no solo la página visible actual)
 * de `organizationId` — nunca ningún filtro de la UI (búsqueda/
 * departamento/certOrgEstatus/certFlags), tal como funcionaba antes del
 * lockdown (ver AI_STATE.md "Restaurar exportSociosCsv/exportParcelasCsv"
 * para la evidencia). PostgREST limita a 1000 filas por defecto; para un
 * padrón cooperativo real esto alcanza, pero si algún día se supera,
 * esta función necesitará paginar el fetch (no implementado — no hay
 * indicio hoy de que haga falta).
 *
 * Reescrito (2026-09-01, ver AI_STATE.md "Restaurar exportSociosCsv/
 * exportParcelasCsv"): la consulta a `PADRON_SOCIOS` ya no va directo
 * con `anon` (RLS ahora `USING (false)`, ADR-031) -- pasa por
 * `fn_exportar_padron_socios` (SECURITY DEFINER) vía
 * `lib/actions/padronReadActions.js`. El resto de la función (join
 * contra `SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO`) sigue
 * exactamente igual -- esas tablas no fueron parte del lockdown.
 *
 * ADR-027: las certificaciones ya no viven en PADRON_SOCIOS (columnas
 * congeladas, sin uso) — se leen de SOCIO_CERTIFICACIONES, la fuente de
 * verdad real de acá en adelante, y se arman como columnas dinámicas
 * (una celda 'Sí'/'No' por certificación activa y socio exportado).
 */
export async function exportSociosCsv(supabase, organizationId) {
  const [data, certificaciones] = await Promise.all([
    fnExportarPadronSocios(organizationId),
    fetchActiveCertificaciones(supabase),
  ])
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

/**
 * Exporta el padrón ACTIVO de parcelas de `organizationId` — mismo
 * criterio que exportSociosCsv (siempre completo, sin filtro de la UI).
 *
 * Reescrito (2026-09-01, ver AI_STATE.md "Restaurar exportSociosCsv/
 * exportParcelasCsv"): la consulta a `PADRON_PARCELAS` ya no va directo
 * con `anon` -- pasa por `fn_exportar_padron_parcelas` (SECURITY
 * DEFINER) vía `lib/actions/padronReadActions.js`.
 */
export async function exportParcelasCsv(supabase, organizationId) {
  const data = await fnExportarPadronParcelas(organizationId)

  triggerCsvDownload(`Padron_Parcelas_${todayStamp()}.csv`, buildParcelasCsv(data ?? []))
  return { parcelas: data?.length ?? 0 }
}
