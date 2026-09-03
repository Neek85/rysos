'use client'

// Pantalla de login real (Fase B, specs/login_real_organizacion_rol.md)
// -- ruta pública a propósito, FUERA del matcher de middleware.js: un
// login nunca puede requerir sesión previa para ser alcanzable. El gate
// de Basic Auth (middleware.js) sigue activo en paralelo para
// /dashboard/**/api/qc/**/api/gis/** -- esta pantalla no lo reemplaza.
//
// `?next=` (mismo criterio ya usado en app/dashboard/socios/page.jsx
// para `?org=`: se lee de `window.location.search` directo, no
// `useSearchParams` de next/navigation, para no tener que envolver la
// página en <Suspense> solo por esto) -- redirige ahí tras un login
// exitoso, o a /dashboard si no vino.
//
// FIX (post-revisión): `next.startsWith('/')` NO descarta URLs
// protocol-relative (`//evil.com`) -- el navegador las interpreta como
// redirect externo (mismo esquema que la página actual, distinto host)
// aunque técnicamente "empiecen con /". Reemplazado por validación de
// mismo origen real: se resuelve con `new URL(next, window.location.origin)`
// y se compara `.origin` contra el origen actual -- cualquier cosa que
// no sea estrictamente el mismo origen (incluido `//evil.com`, un
// `next` absoluto a otro host, `null`/vacío, o un valor malformado que
// tira en el `new URL()`) cae a `/dashboard`.

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient'
import { FormField, inputClass } from '@/components/ui/FormField'

function resolveSafeNext(next) {
  if (!next) return '/dashboard'
  try {
    const url = new URL(next, window.location.origin)
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : '/dashboard'
  } catch {
    return '/dashboard'
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        setError('No se pudo inicializar el cliente de autenticación.')
        return
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        // Mensaje genérico A PROPÓSITO -- nunca distinguir "usuario no
        // existe" de "contraseña incorrecta" acá, evita enumeración de
        // cuentas (pedido explícito de la Fase B).
        setError('Email o contraseña incorrectos.')
        return
      }
      // Navegación completa (no router.push del lado cliente) para que
      // la siguiente request llegue al servidor -- y a middleware.js --
      // con la cookie de sesión recién escrita ya presente.
      const params = new URLSearchParams(window.location.search)
      window.location.href = resolveSafeNext(params.get('next'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h1 className="mb-1 text-lg font-bold text-gray-800">RYZOS</h1>
        <p className="mb-6 text-sm text-gray-500">Ingresá con tu cuenta interna.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Email" required>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass(false)}
            />
          </FormField>
          <FormField label="Contraseña" required>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass(false)}
            />
          </FormField>

          {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white hover:bg-green-900 disabled:opacity-50"
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  )
}
