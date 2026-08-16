import './globals.css'

export const metadata = {
  title: 'RYZOS — Trazabilidad EUDR',
  description: 'Sistema de trazabilidad cafetalera EU 2023/1115',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  )
}
