// Route Handler: descarga del Dossier Comercial EUDR en PDF para un lote
// público (mismo lote que /trace/[lot_hash]). Ver specs/pdf_dossier_native_js.md.
//
// runtime = 'nodejs' explícito: @react-pdf/renderer usa APIs de Node (no
// disponibles en el runtime Edge de Next.js) para el layout/render del PDF.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { findLotByHash } from '@/lib/lotLookup'
import { renderDossierPdf } from '@/lib/pdf/renderDossierPdf'

export async function GET(_request, { params }) {
  const { lot_hash } = params

  const lote = await findLotByHash(lot_hash)
  if (!lote) {
    return new Response(JSON.stringify({ error: 'Lote no encontrado' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const pdfBuffer = await renderDossierPdf(lote)

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Dossier_EUDR_${lot_hash}.pdf"`,
    },
  })
}
