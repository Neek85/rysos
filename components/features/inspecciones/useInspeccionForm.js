'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { inspeccionSchema, DEFAULT_VALUES } from '@/lib/inspeccionesSchema'
import {
  fetchInspeccionDetalle,
  fetchInspecciones,
  resolveOrganizationId,
  saveInspeccion,
  InspeccionError,
} from '@/lib/inspeccionesActions'

// INVARIANTE: la organización activa se resuelve de una consulta amplia
// a INSPECCIONES (fetchInspecciones), independiente de la fila
// específica que se está editando (fetchInspeccionDetalle) — así la
// verificación multi-tenant en saveInspeccion() compara dos señales
// realmente independientes, no un valor contra sí mismo.
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
      const supabase = getSupabaseClient()
      if (!supabase) {
        setLoadError('Cliente Supabase no configurado (revisa las variables de entorno).')
        setIsLoading(false)
        return
      }

      try {
        const { rows } = await fetchInspecciones(supabase, { page: 0 })
        if (cancelled) return
        setOrganizationId(resolveOrganizationId(rows))

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
    const supabase = getSupabaseClient()
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
