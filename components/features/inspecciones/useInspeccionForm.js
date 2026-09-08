'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient'
import { inspeccionSchema, DEFAULT_VALUES } from '@/lib/inspeccionesSchema'
import {
  fetchInspeccionDetalle,
  saveInspeccion,
  InspeccionError,
} from '@/lib/inspeccionesActions'

// INVARIANTE: organizationId viene de la sesión real (RPC auth_org_id(),
// la misma función que las políticas RLS de INSPECCIONES/CAP_* usan como
// autoridad -- ADR-033), no de filas ya cargadas. existingOrganizationId
// viene del registro específico que se está editando (fetchInspeccionDetalle),
// solo en modo edición. Son dos señales independientes por ORIGEN
// (identidad de la sesión vs. dato del registro), no dos consultas
// distintas sobre la misma tabla como antes -- así la verificación
// multi-tenant en saveInspeccion() sigue comparando dos cosas realmente
// independientes, no un valor contra sí mismo.
export function useInspeccionForm(id) {
  const router = useRouter()
  const isEdit = Boolean(id)

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [organizationId, setOrganizationId] = useState(null)
  const [existingOrganizationId, setExistingOrganizationId] = useState(null)

  const form = useForm({
    resolver: zodResolver(inspeccionSchema),
    defaultValues: DEFAULT_VALUES,
    mode: 'onBlur',
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setLoadError(null)
      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        setLoadError('Cliente Supabase no configurado (revisa las variables de entorno).')
        setIsLoading(false)
        return
      }

      try {
        const { data: orgId, error: orgError } = await supabase.rpc('auth_org_id')
        if (cancelled) return
        if (orgError) throw orgError
        if (!orgId) {
          setLoadError(
            'No se pudo verificar tu organización activa. Verificá que tu perfil esté activo o contactá al administrador.'
          )
          return
        }
        setOrganizationId(orgId)

        if (isEdit) {
          const { values, organizationId: recordOrgId } = await fetchInspeccionDetalle(supabase, id)
          if (cancelled) return
          setExistingOrganizationId(recordOrgId)
          form.reset(values)
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof InspeccionError ? err.message : err?.message || 'Error al cargar la inspección.'
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  async function onSubmit(values) {
    const supabase = getSupabaseBrowserClient()
    if (!supabase || saving) return
    setSaving(true)
    setToast(null)
    try {
      const result = await saveInspeccion(supabase, values, {
        id: isEdit ? id : null,
        organizationId,
        existingOrganizationId,
      })
      setToast({
        type: 'success',
        message: isEdit ? 'Inspección guardada correctamente.' : 'Inspección creada correctamente.',
      })
      if (!isEdit) {
        router.replace(`/dashboard/inspecciones/${result.id}/editar`)
      } else if (values.Estado === 'Cerrada') {
        setTimeout(() => router.push('/dashboard/inspecciones'), 1200)
      }
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof InspeccionError ? err.message : err?.message || 'Error al guardar.',
      })
    } finally {
      setSaving(false)
    }
  }

  return { form, isEdit, isLoading, loadError, saving, toast, onSubmit, organizationId }
}
