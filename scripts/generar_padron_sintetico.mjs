// Genera Socios.csv y Parcelas.csv sintéticos para ORG-TEST-DEMO — ver
// specs/organizacion_prueba_robustez_importador.md. Reutiliza el mismo
// contrato de datos que el importador real usa hoy en /dashboard/socios
// (socioSchema/parcelaSchema, buildSociosCsv/buildParcelasCsv), no lo
// reimplementa: el CSV que este script produce es indistinguible, en
// formato, de uno exportado desde la UI real.
//
// Uso: node scripts/generar_padron_sintetico.mjs [--count N] [--seed S] [--out DIR]
//   --count  Filas de socios (y de parcelas) a generar. 10-50. Default 25.
//   --seed   Semilla determinística — mismo seed + count = mismo CSV byte
//            a byte, para poder regenerar el dataset de demo cuando haga
//            falta refrescarlo. Default 'ryzos-demo'.
//   --out    Directorio de salida. Default 'scratch/padron_sintetico'
//            (ignorado por git, ver .gitignore).
//
// Requiere NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en
// .env.local — solo para leer CERTIFICACIONES_CATALOGO (lectura, sin
// ninguna escritura a la base desde este script).

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

import { buildSociosCsv, buildParcelasCsv } from '../lib/padronCsv.js'
import { socioSchema, parcelaSchema, CERT_FLAG_FIELDS, ORGANIC_CERT_CODES } from '../lib/validations/socios.js'
import { computeNextCodes, computeSuggestedParcelaId } from '../lib/parcelaDefaults.js'
import { getProvincias, getDistritos } from '../lib/ubigeoData.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

const ORG_ID = 'ORG-TEST-DEMO'
const DEPARTAMENTO = 'Cajamarca'

// ── CLI args ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { count: 25, seed: 'ryzos-demo', out: join(REPO_ROOT, 'scratch', 'padron_sintetico') }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count') args.count = Number(argv[++i])
    else if (argv[i] === '--seed') args.seed = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
  }
  if (!Number.isInteger(args.count) || args.count < 10 || args.count > 50) {
    throw new Error(`--count debe ser un entero entre 10 y 50 (recibido: ${args.count})`)
  }
  return args
}

// ── .env.local (sin dependencia de dotenv, no está instalado) ─────────
function loadEnvLocal() {
  const path = join(REPO_ROOT, '.env.local')
  if (!existsSync(path)) throw new Error('.env.local no existe — necesario para leer CERTIFICACIONES_CATALOGO en vivo')
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

// ── PRNG determinístico (mulberry32) — sin dependencia nueva ─────────
function mulberry32(seedStr) {
  let h = 1779033703 ^ seedStr.length
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)]
}

function padZero(n, width) {
  return String(n).padStart(width, '0')
}

// Nombres/apellidos genéricos peruanos, claramente placeholder — no
// derivados de ningún dato real de COOP-AROMAS-VALLE ni de ningún otro
// padrón (criterio de la spec, sección 4).
const NOMBRES = [
  'Carlos', 'María', 'Luis', 'Rosa', 'Jorge', 'Elena', 'Pedro', 'Carmen',
  'Miguel', 'Lucía', 'Juan', 'Sofía', 'Andrés', 'Patricia', 'Ricardo',
  'Gabriela', 'Fernando', 'Isabel', 'Manuel', 'Teresa',
]
const APELLIDOS = [
  'Quispe', 'Mamani', 'Rojas', 'Vásquez', 'Cruz', 'Torres', 'Flores',
  'Chávez', 'Díaz', 'Ramírez', 'Huamán', 'Sánchez', 'Castillo', 'Reyes',
  'Vega', 'Paredes', 'Cabrera', 'Ortiz', 'Guevara', 'Salazar',
]

function randomNombreCompleto(rng) {
  const nombre = pick(rng, NOMBRES)
  const apellido1 = pick(rng, APELLIDOS)
  const apellido2 = pick(rng, APELLIDOS)
  return `${nombre} ${apellido1} ${apellido2}`
}

// DNI sintético: 8 dígitos válidos contra el regex de socioSchema, sin
// corresponder a ninguna persona real — secuencia determinística por
// índice, no consulta ni se parece a ningún DNI real del padrón.
function syntheticDni(index) {
  return `9${padZero(9000000 - index, 7)}`.slice(0, 8)
}

function syntheticCelular(rng) {
  return `9${padZero(Math.floor(rng() * 100000000), 8)}`.slice(0, 9)
}

function randomFecha(rng, yearFrom, yearTo) {
  const year = yearFrom + Math.floor(rng() * (yearTo - yearFrom + 1))
  const month = 1 + Math.floor(rng() * 12)
  const day = 1 + Math.floor(rng() * 28) // 28 evita casos Feb-29 inválidos
  return `${month}/${day}/${year}`
}

function randomHectarea(rng, min, max) {
  return Math.round((min + rng() * (max - min)) * 100) / 100
}

async function fetchActiveCertificaciones(supabase) {
  const { data, error } = await supabase.from('CERTIFICACIONES_CATALOGO').select('id, codigo, nombre').eq('activo', true)
  if (error) throw error
  return (data ?? []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
}

function buildSocio(rng, index, ID_Socio, provincias) {
  const provincia = pick(rng, provincias)
  const distritos = getDistritos(DEPARTAMENTO, provincia)
  const distrito = distritos.length ? pick(rng, distritos) : ''

  return {
    ID_Socio,
    ID_Organizacion: ORG_ID,
    codigo_finca: `F-${padZero(index + 1, 4)}`,
    socio_nombre_completo: randomNombreCompleto(rng),
    socio_dni: syntheticDni(index),
    socio_genero: rng() < 0.5 ? 'Femenino' : 'Masculino',
    socio_fecha_nacimiento: randomFecha(rng, 1955, 2003),
    celular_socio: syntheticCelular(rng),
    socio_departamento: DEPARTAMENTO,
    socio_provincia: provincia,
    socio_distrito: distrito,
    localidad: `Caserío Demo ${index + 1}`,
    socio_fecha_ingreso: randomFecha(rng, 2015, 2025),
  }
}

function buildSocioCertFlags(rng) {
  const flags = {}
  let anyOrganic = false
  for (const { field, codigo } of CERT_FLAG_FIELDS) {
    const value = rng() < 0.4 ? 'Sí' : 'No'
    flags[field] = value
    if (value === 'Sí' && ORGANIC_CERT_CODES.includes(codigo)) anyOrganic = true
  }
  return { flags, cert_org_estatus: anyOrganic ? 'Organico' : 'Sin Estatus' }
}

function buildParcela(rng, socioId, ID_Parcela_Fija, parcela_codigo) {
  return {
    ID_Parcela_Fija,
    ID_Organizacion: ORG_ID,
    ID_Socio: socioId,
    parcela_codigo,
    parcela_nombre: `Finca ${parcela_codigo}`,
    hcp: randomHectarea(rng, 0.5, 4),
    hcc: randomHectarea(rng, 0, 2),
    ho: randomHectarea(rng, 0, 1),
    hip: randomHectarea(rng, 0, 1),
    hrp: randomHectarea(rng, 0, 1),
    hbp: randomHectarea(rng, 0, 1.5),
    otros_cultivo: 0,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  loadEnvLocal()

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const certificaciones = await fetchActiveCertificaciones(supabase)
  if (certificaciones.length === 0) {
    throw new Error('CERTIFICACIONES_CATALOGO no tiene ninguna fila activa — revisar antes de generar el dataset')
  }

  const rng = mulberry32(`${args.seed}:${args.count}`)
  const provincias = getProvincias(DEPARTAMENTO)
  if (provincias.length === 0) throw new Error(`getProvincias('${DEPARTAMENTO}') no devolvió nada — revisar lib/data/ubigeo_peru.json`)

  const socioIds = computeNextCodes([], args.count, { defaultPrefix: 'DEMO-', defaultPadLength: 5 })

  const socioRecords = [] // objetos con forma socioSchema (validados)
  const socioCsvRows = [] // objetos con forma buildSociosCsv (columnas fijas + cert ids dinámicos)

  for (let i = 0; i < args.count; i++) {
    const base = buildSocio(rng, i, socioIds[i], provincias)
    const { flags, cert_org_estatus } = buildSocioCertFlags(rng)

    const schemaShaped = { ...base, ...flags, cert_org_estatus }
    const parsed = socioSchema.safeParse(schemaShaped)
    if (!parsed.success) {
      throw new Error(`Socio sintético ${base.ID_Socio} no pasa socioSchema: ${JSON.stringify(parsed.error.issues)}`)
    }
    socioRecords.push(parsed.data)

    const csvRow = { ...base, cert_org_estatus }
    for (const cert of certificaciones) {
      const field = CERT_FLAG_FIELDS.find((f) => f.codigo === cert.codigo)?.field
      csvRow[cert.id] = field ? flags[field] : 'No'
    }
    socioCsvRows.push(csvRow)
  }

  // Exactamente 1 parcela por socio (simple y reproducible; el criterio
  // "10 a 50 socios/parcelas" de la spec no exige una relación N-a-N acá
  // — 1:1 ya cubre el rango pedido y mantiene la integridad referencial
  // trivial de verificar: cada ID_Socio de Parcelas.csv existe en
  // Socios.csv de esta misma corrida, en el mismo orden).
  const parcelaCsvRows = []
  let existingCodigos = []
  for (let i = 0; i < args.count; i++) {
    const socioId = socioIds[i]
    const [codigo] = computeNextCodes(existingCodigos, 1, { defaultPrefix: 'P-', defaultPadLength: 2 })
    const idFija = computeSuggestedParcelaId(socioId, codigo)
    existingCodigos = [...existingCodigos, codigo]

    const base = buildParcela(rng, socioId, idFija, codigo)
    const parsed = parcelaSchema.safeParse(base)
    if (!parsed.success) {
      throw new Error(`Parcela sintética ${idFija} no pasa parcelaSchema: ${JSON.stringify(parsed.error.issues)}`)
    }
    parcelaCsvRows.push(base)
  }

  const sociosCsv = buildSociosCsv(socioCsvRows, certificaciones)
  const parcelasCsv = buildParcelasCsv(parcelaCsvRows)

  mkdirSync(args.out, { recursive: true })
  const sociosPath = join(args.out, 'Socios.csv')
  const parcelasPath = join(args.out, 'Parcelas.csv')
  writeFileSync(sociosPath, '﻿' + sociosCsv, 'utf-8')
  writeFileSync(parcelasPath, '﻿' + parcelasCsv, 'utf-8')

  console.log(`OK: ${socioCsvRows.length} socios -> ${sociosPath}`)
  console.log(`OK: ${parcelaCsvRows.length} parcelas -> ${parcelasPath}`)
  console.log(`Organización objetivo: ${ORG_ID} (debe existir en ORGANIZACIONES antes de importar vía /dashboard/socios)`)
  console.log('Nota: la columna id_producto_predominante NO está en el contrato del importador CSV (PARCELA_EXPORT_COLUMNS) -- las parcelas quedan sin producto asignado tras la carga; asignar Café/Cacao por parcela requiere editarlas luego desde la UI o un UPDATE aparte.')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
