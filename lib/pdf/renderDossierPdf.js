// Genera el buffer PDF del Dossier Comercial EUDR a partir de un lote ya
// sanitizado (mismo shape que devuelve lib/traceabilityHash.js::buildPublicSanitizedPayload).
// Usado por app/api/trace/[lot_hash]/pdf/route.js.

import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import DossierDocument from './DossierDocument.js'
import { generateQrDataUrl } from '../qrGenerator.js'

export async function renderDossierPdf(lote) {
  const qrDataUrl = lote?.verification_url ? await generateQrDataUrl(lote.verification_url) : null
  return renderToBuffer(React.createElement(DossierDocument, { lote, qrDataUrl }))
}
