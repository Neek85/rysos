export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'

const PII_FIELDS = new Set([
  'socio_dni',
  'socio_nombre',
  'socio_nombre_completo',
  'conyuge_dni',
])

const SAFE_COLUMNS =
  'parcela_codigo,hectareas,estado_revision,riesgo_satelital,lot_hash,ID_Organizacion'

async function getLote(lot_hash) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  const { data } = await supabase
    .from('view_eudr_dashboard_aprobados')
    .select(SAFE_COLUMNS)
    .eq('lot_hash', lot_hash)
    .maybeSingle()

  if (!data) return null

  // Garantía adicional: eliminar cualquier campo PII que pudiera llegar
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !PII_FIELDS.has(key))
  )
}

export default async function TracePage({ params }) {
  const { lot_hash } = params
  const lote = await getLote(lot_hash)

  if (!lote) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-sm w-full p-8 text-center space-y-3">
          <div className="text-4xl">🔍</div>
          <h1 className="text-base font-semibold text-gray-800">Lote no encontrado</h1>
          <p className="text-sm text-gray-500">
            El hash <code className="font-mono text-xs bg-gray-100 px-1 rounded">{lot_hash}</code>{' '}
            no corresponde a ningún lote aprobado.
          </p>
          <a href="/" className="inline-block mt-2 text-sm text-green-700 underline underline-offset-2">
            ← Volver al dashboard
          </a>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-md w-full p-6 space-y-5">
        {/* Encabezado */}
        <div className="text-center space-y-1">
          <span className="inline-block bg-emerald-100 text-emerald-800 text-xs font-semibold px-3 py-1 rounded-full">
            ✓ APROBADO EUDR
          </span>
          <h1 className="text-lg font-bold text-gray-900 mt-2">{lote.parcela_codigo}</h1>
          <p className="text-xs font-mono text-gray-400 break-all">{lot_hash}</p>
        </div>

        {/* Datos del lote */}
        <dl className="divide-y divide-gray-100 text-sm">
          <div className="py-2.5 flex justify-between">
            <dt className="text-gray-500">Superficie</dt>
            <dd className="font-medium text-gray-900">{lote.hectareas} ha</dd>
          </div>
          <div className="py-2.5 flex justify-between">
            <dt className="text-gray-500">Estado de revisión</dt>
            <dd className="font-medium text-emerald-700">{lote.estado_revision}</dd>
          </div>
          <div className="py-2.5 flex justify-between">
            <dt className="text-gray-500">Riesgo satelital</dt>
            <dd className="font-medium text-gray-900">{lote.riesgo_satelital ?? '—'}</dd>
          </div>
          <div className="py-2.5 flex justify-between">
            <dt className="text-gray-500">Regulación</dt>
            <dd className="font-medium text-gray-900">EU 2023/1115</dd>
          </div>
          <div className="py-2.5 flex justify-between">
            <dt className="text-gray-500">Corte deforestación</dt>
            <dd className="font-medium text-gray-900">31 dic 2020</dd>
          </div>
        </dl>

        <p className="text-xs text-gray-400 text-center pt-1">
          Este certificado no contiene datos personales identificables.
          Verificado por RYZOS.
        </p>

        <div className="text-center">
          <a href="/" className="text-sm text-green-700 underline underline-offset-2">
            ← Volver al dashboard
          </a>
        </div>
      </div>
    </main>
  )
}
