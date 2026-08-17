import DashboardSidebar from '@/components/layout/DashboardSidebar'

// INVARIANTE: este layout envuelve solo /dashboard/* (mapa, qc, y futuras
// rutas del sidebar modular). NO se agrega al app/layout.jsx raíz porque
// ese layout también sirve app/page.jsx (dashboard viejo, schema distinto,
// ver memoria de proyecto) y app/trace/[lot_hash] (página PÚBLICA de
// trazabilidad) — ninguna de las dos debe mostrar navegación interna de
// organización.
export default function DashboardLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <DashboardSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
