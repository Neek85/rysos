'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, inputClass } from '@/components/ui/FormField'
import { socioSchema, SOCIO_DEFAULT_VALUES, CERT_FLAG_FIELDS } from '@/lib/validations/socios'
import { createSocio, updateSocio, resolveSocioCertFlags } from '@/lib/actions/sociosActions'
import { SocioActionError } from '@/lib/actions/socioActionError'
import UbigeoSelect from './UbigeoSelect'

function SiNoSelect({ register, name, label }) {
  return (
    <FormField label={label}>
      <select className={inputClass(false)} {...register(name)}>
        <option value="">— Sin dato —</option>
        <option value="Sí">Sí</option>
        <option value="No">No</option>
      </select>
    </FormField>
  )
}

export default function SocioFormModal({ socio, organizationId, onClose, onSaved }) {
  const isEdit = Boolean(socio)
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
    setError,
  } = useForm({
    resolver: zodResolver(socioSchema),
    defaultValues: socio ? { ...SOCIO_DEFAULT_VALUES, ...socio } : SOCIO_DEFAULT_VALUES,
  })

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  // Las 8 columnas cert_* + cert_org_estatus de PADRON_SOCIOS quedaron
  // congeladas desde ADR-027 -- `socio` (la fila de fn_listar_padron_socios)
  // trae su valor viejo, no el real. Se resuelven acá desde
  // SOCIO_CERTIFICACIONES (fuente de verdad real) y se sobreescriben los
  // defaultValues ya montados -- ver AI_STATE.md "Fix autoselect de
  // certificaciones en SocioFormModal.jsx" / "Fix cert_org_estatus
  // desactualizado". `resolveSocioCertFlags` devuelve los 8 flags Y
  // cert_org_estatus en el mismo objeto -- el loop de abajo ya cubre
  // ambos sin cableado adicional.
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    resolveSocioCertFlags(socio.ID_Socio, organizationId)
      .then((flags) => {
        if (cancelled) return
        for (const [field, value] of Object.entries(flags)) {
          setValue(field, value)
        }
      })
      .catch((err) => {
        console.error('[SocioFormModal] resolveSocioCertFlags:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(values) {
    try {
      const result = isEdit ? await updateSocio(values, organizationId) : await createSocio(values, organizationId)
      onSaved(result)
    } catch (err) {
      setError('root', {
        message: err instanceof SocioActionError ? err.message : err?.message || 'Error al guardar el socio.',
      })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-800">{isEdit ? 'Editar Socio' : 'Nuevo Socio'}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Código de Socio" required error={errors.ID_Socio?.message}>
              <input
                type="text"
                disabled={isEdit}
                className={`${inputClass(errors.ID_Socio)} disabled:bg-gray-50 disabled:text-gray-400`}
                placeholder="ej: JS-00003"
                {...register('ID_Socio')}
              />
            </FormField>
            <FormField label="Código de Finca">
              <input type="text" className={inputClass(false)} {...register('codigo_finca')} />
            </FormField>
          </div>

          <FormField label="Nombre Completo" required error={errors.socio_nombre_completo?.message}>
            <input type="text" className={inputClass(errors.socio_nombre_completo)} {...register('socio_nombre_completo')} />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="DNI" error={errors.socio_dni?.message}>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                className={inputClass(errors.socio_dni)}
                placeholder="8 dígitos"
                {...register('socio_dni')}
              />
            </FormField>
            <FormField label="Género">
              <select className={inputClass(false)} {...register('socio_genero')}>
                <option value="">— Seleccionar —</option>
                <option value="Hombre">Hombre</option>
                <option value="Mujer">Mujer</option>
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Fecha de Nacimiento">
              <input type="date" className={inputClass(false)} {...register('socio_fecha_nacimiento')} />
            </FormField>
            <FormField label="Celular" error={errors.celular_socio?.message}>
              <input
                type="text"
                inputMode="numeric"
                maxLength={9}
                placeholder="9 dígitos"
                className={inputClass(errors.celular_socio)}
                {...register('celular_socio')}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Nombre del Cónyuge">
              <input type="text" className={inputClass(false)} {...register('conyuge_nombre')} />
            </FormField>
            <FormField label="DNI del Cónyuge" error={errors.conyuge_dni?.message}>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                className={inputClass(errors.conyuge_dni)}
                {...register('conyuge_dni')}
              />
            </FormField>
          </div>

          <UbigeoSelect register={register} watch={watch} setValue={setValue} errors={errors} />

          <FormField label="Localidad">
            <input type="text" className={inputClass(false)} {...register('localidad')} />
          </FormField>

          <FormField label="Fecha de Ingreso">
            <input type="date" className={inputClass(false)} {...register('socio_fecha_ingreso')} />
          </FormField>

          <div className="rounded-xl border border-gray-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">Certificaciones</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Estatus de Certificación Orgánica">
                <input type="text" className={inputClass(false)} placeholder="ej: Organico" {...register('cert_org_estatus')} />
              </FormField>
              <FormField label="Certificaciones (texto libre)">
                <input type="text" className={inputClass(false)} {...register('certificaciones')} />
              </FormField>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {CERT_FLAG_FIELDS.map(({ field, label }) => (
                <SiNoSelect key={field} register={register} name={field} label={label} />
              ))}
            </div>
          </div>

          {errors.root && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{errors.root.message}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white hover:bg-green-900 disabled:opacity-50"
            >
              {isSubmitting ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
