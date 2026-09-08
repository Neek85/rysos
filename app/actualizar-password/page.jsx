'use client'

// Completa el flujo de recuperación de contraseña de Supabase Auth
// (specs/recuperacion_password.md). Ruta pública a propósito, FUERA del
// matcher de middleware.js -- igual que /login, nunca puede requerir una
// sesión previa para ser alcanzable.
//
// Hallazgo que motivó esta página (ver spec): el botón "Send password
// recovery"/"Send confirmation email" del Dashboard de Supabase no acepta
// un `redirectTo` propio -- siempre usa el Site URL vigente. Por eso el
// Site URL de Supabase Auth se actualizó (fuera del repo, manual) para
// apuntar directo acá.
//
// A propósito usa getSupabaseBrowserClient() (cookies, @supabase/ssr) y
// NO getSupabaseClient() (localStorage, lib/supabaseClient.js) -- la
// sesión que resulta de intercambiar el token de recuperación tiene que
// quedar en cookies para que middleware.js (createSessionMiddlewareClient)
// la vea al entrar a /dashboard/**. Con el cliente de localStorage, el
// usuario queda "logueado" ante Supabase pero invisible para el
// middleware -- exactamente el bug que esta página corrige.
//
// Sirve dos casos con el mismo código: recovery (`type=recovery`) e
// invitación (`inviteUserByEmail` deja al usuario en el mismo tipo de
// sesión temporal hasta que fija su contraseña inicial).

import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient'
import { FormField, inputClass } from '@/components/ui/FormField'

const MIN_PASSWORD_LENGTH = 6

export default function ActualizarPasswordPage() {
  // 'checking' | 'ready' | 'invalid'
  const [status, setStatus] = useState('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setStatus('invalid')
      return
    }

    // La sesión de recuperación puede ya estar activa para cuando este
    // efecto corre (createBrowserClient procesa el hash de la URL al
    // inicializarse) -- por eso se revisa la sesión actual además de
    // escuchar el evento, en vez de depender solo de uno de los dos.
    let cancelled = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled && session) setStatus('ready')
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStatus('ready')
    })

    // Si ni la sesión ya estaba activa ni llega el evento, el link es
    // inválido/expirado/ya usado -- se le da un margen razonable antes de
    // mostrar el estado de error, para no competir en una carrera con el
    // intercambio de token que corre en paralelo al montar el cliente.
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setStatus((current) => (current === 'checking' ? 'invalid' : current))
      }
    }, 2500)

    return () => {
      cancelled = true
      clearTimeout(timeout)
      listener?.subscription?.unsubscribe()
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
      return
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        setError('No se pudo inicializar el cliente de autenticación.')
        return
      }
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        return
      }
      // Navegación completa (no router.push) -- misma razón que
      // app/login/page.jsx: la siguiente request tiene que llegar al
      // servidor, y a middleware.js, con la cookie de sesión ya escrita.
      window.location.href = '/dashboard'
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h1 className="mb-1 text-lg font-bold text-gray-800">RYZOS</h1>

        {status === 'checking' && (
          <p className="text-sm text-gray-500">Verificando enlace…</p>
        )}

        {status === 'invalid' && (
          <>
            <p className="mb-2 text-sm text-gray-700">
              Este enlace no es válido o ya expiró.
            </p>
            <p className="text-sm text-gray-500">
              Pedile a un administrador que te envíe un nuevo enlace desde el panel de
              usuarios, o usá &quot;¿Olvidaste tu contraseña?&quot; en{' '}
              <a href="/login" className="text-green-700 underline underline-offset-2">
                el login
              </a>
              .
            </p>
          </>
        )}

        {status === 'ready' && (
          <>
            <p className="mb-6 text-sm text-gray-500">Elegí tu nueva contraseña.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <FormField label="Nueva contraseña" required>
                <input
                  type="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass(false)}
                />
              </FormField>
              <FormField label="Confirmar contraseña" required>
                <input
                  type="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass(false)}
                />
              </FormField>

              {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white hover:bg-green-900 disabled:opacity-50"
              >
                {submitting ? 'Guardando…' : 'Guardar contraseña'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
