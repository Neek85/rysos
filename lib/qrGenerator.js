// Generador de Código QR (Tarea 14) — contraparte JS de
// generate_qr_data_url() en scripts/generate_lot_qr.py. Usa el paquete
// `qrcode` (no `qrcode.react`) porque expone una función pura que produce
// el mismo tipo de resultado que la versión Python — un Data URL Base64 —
// en vez de un componente React con su propio ciclo de vida; `qrcode`
// también funciona tanto en Server Components (Node, vía node-canvas-less
// PNG encoder) como en componentes cliente, sin depender del DOM.

import QRCode from 'qrcode'

/**
 * Genera una imagen PNG del QR como Data URL Base64 apuntando a `url`.
 * Mismos parámetros de tamaño/margen que la versión Python
 * (box_size=10, border=4) para producir un QR visualmente equivalente.
 */
export async function generateQrDataUrl(url) {
  return QRCode.toDataURL(url, {
    width: 320,
    margin: 4,
    color: { dark: '#000000', light: '#ffffff' },
  })
}
