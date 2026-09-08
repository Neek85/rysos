// Ver specs/redirect_dashboard_default.md.
//
// `/dashboard` a secas no tiene contenido propio -- las pantallas reales
// viven en /dashboard/mapa, /dashboard/qc, etc. (ver DashboardSidebar).
// Login (app/login/page.jsx) y recuperación de contraseña
// (app/actualizar-password/page.jsx) navegan acá por defecto cuando no
// hay un `?next=` explícito; sin este archivo, Next.js no tiene nada que
// resolver para ese path exacto y devuelve 404 -- confirmado en la
// verificación real de specs/recuperacion_password.md.
//
// Server Component simple: redirige a /dashboard/mapa (Mapa WebGIS),
// primera entrada del primer grupo del sidebar -- landing page por
// defecto, igual para todos los roles por ahora (redirección por rol
// queda fuera de este fix, ver spec).
import { redirect } from 'next/navigation'

export default function DashboardIndexPage() {
  redirect('/dashboard/mapa')
}
