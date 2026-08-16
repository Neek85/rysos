const RISK_CONFIG = {
  CRITICO: { label: 'CRÍTICO', className: 'bg-red-100 text-red-800 border-red-300' },
  ALTO:    { label: 'ALTO',    className: 'bg-orange-100 text-orange-800 border-orange-300' },
  BAJO:    { label: 'BAJO',    className: 'bg-green-100 text-green-800 border-green-300' },
}

export default function RiskBadge({ risk }) {
  const cfg = RISK_CONFIG[risk] ?? {
    label: risk ?? 'PENDIENTE',
    className: 'bg-gray-100 text-gray-500 border-gray-300',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}
