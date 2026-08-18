'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// INVARIANTE: la mayoría de los items son el andamiaje de navegación
// modular pedido (Padrón → "Productores y Parcelas", Acopio, "Contratos
// y Ventas" de Comercialización) — enlazar a rutas inexistentes
// produciría 404s, así que quedan sin `href` y se renderizan
// deshabilitados ("Próximamente") hasta que existan las páginas
// correspondientes. "Lotes y Trazabilidad" (Tarea 14) e "Inspecciones"
// (Fase 6) sí son rutas reales.
const NAV_GROUPS = [
  {
    label: 'GIS & EUDR',
    items: [
      { label: 'Mapa WebGIS', href: '/dashboard/mapa', icon: '🗺️' },
      { label: 'Consola QC', href: '/dashboard/qc', icon: '✅' },
    ],
  },
  {
    label: 'Padrón',
    items: [
      { label: 'Inspecciones', href: '/dashboard/inspecciones', icon: '📋' },
      { label: 'Productores y Parcelas', href: null, icon: '👥' },
    ],
  },
  {
    label: 'Acopio',
    items: [{ label: 'Recepción de Lotes', href: null, icon: '📦' }],
  },
  {
    label: 'Comercialización',
    items: [
      { label: 'Lotes y Trazabilidad', href: '/dashboard/lotes', icon: '🔖' },
      { label: 'Contratos y Ventas', href: null, icon: '💰' },
    ],
  },
]

function NavItem({ item, isActive }) {
  if (!item.href) {
    return (
      <span className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-300 cursor-not-allowed">
        <span aria-hidden="true">{item.icon}</span>
        {item.label}
        <span className="ml-auto rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">
          Próximamente
        </span>
      </span>
    )
  }

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
        isActive ? 'bg-green-800 font-medium text-white' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      <span aria-hidden="true">{item.icon}</span>
      {item.label}
    </Link>
  )
}

export default function DashboardSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 shrink-0 border-r border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-4">
        <p className="text-lg font-bold text-green-800">RYZOS</p>
        <p className="text-xs text-gray-400">Trazabilidad EUDR</p>
      </div>
      <nav className="space-y-4 p-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.label}>
                  <NavItem
                    item={item}
                    isActive={Boolean(item.href) && (pathname === item.href || pathname.startsWith(`${item.href}/`))}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
