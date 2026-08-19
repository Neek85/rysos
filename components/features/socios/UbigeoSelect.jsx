'use client'

import { useState } from 'react'
import { FormField, inputClass } from '@/components/ui/FormField'
import { getDepartamentos, getProvincias, getDistritos } from '@/lib/ubigeoData'

const OTRO = '__OTRO__'

// Desplegables en cascada Departamento -> Provincia -> Distrito
// (lib/data/ubigeo_peru.json — ver la nota de fuente/confianza en el
// propio archivo, no es un dataset descargado de una fuente oficial en
// vivo). Cada nivel incluye una opción "Otro / no está en la lista" que
// revela un campo de texto libre — así un distrito real ausente del
// dataset NUNCA bloquea el alta de un socio real.
export default function UbigeoSelect({ register, watch, setValue, errors }) {
  const departamento = watch('socio_departamento')
  const provincia = watch('socio_provincia')
  const distrito = watch('socio_distrito')

  // Si se está editando un socio existente cuyo departamento/provincia/
  // distrito no coincide con ningún nombre del dataset (dato real que no
  // está en lib/data/ubigeo_peru.json), arranca directo en modo "Otro"
  // mostrando el valor real en vez de vaciarlo silenciosamente.
  const [otroDepartamento, setOtroDepartamento] = useState(
    () => Boolean(departamento) && !getDepartamentos().includes(departamento)
  )
  const [otroProvincia, setOtroProvincia] = useState(
    () => Boolean(provincia) && !getProvincias(departamento).includes(provincia)
  )
  const [otroDistrito, setOtroDistrito] = useState(
    () => Boolean(distrito) && !getDistritos(departamento, provincia).includes(distrito)
  )

  const departamentos = getDepartamentos()
  const provincias = otroDepartamento ? [] : getProvincias(departamento)
  const distritos = otroDepartamento || otroProvincia ? [] : getDistritos(departamento, provincia)

  function handleDepartamentoChange(e) {
    const value = e.target.value
    if (value === OTRO) {
      setOtroDepartamento(true)
      setValue('socio_departamento', '', { shouldDirty: true })
    } else {
      setOtroDepartamento(false)
      setValue('socio_departamento', value, { shouldDirty: true })
    }
    // Cambiar el departamento invalida la provincia/distrito ya elegidos.
    setOtroProvincia(false)
    setOtroDistrito(false)
    setValue('socio_provincia', '', { shouldDirty: true })
    setValue('socio_distrito', '', { shouldDirty: true })
  }

  function handleProvinciaChange(e) {
    const value = e.target.value
    if (value === OTRO) {
      setOtroProvincia(true)
      setValue('socio_provincia', '', { shouldDirty: true })
    } else {
      setOtroProvincia(false)
      setValue('socio_provincia', value, { shouldDirty: true })
    }
    setOtroDistrito(false)
    setValue('socio_distrito', '', { shouldDirty: true })
  }

  function handleDistritoChange(e) {
    const value = e.target.value
    if (value === OTRO) {
      setOtroDistrito(true)
      setValue('socio_distrito', '', { shouldDirty: true })
    } else {
      setOtroDistrito(false)
      setValue('socio_distrito', value, { shouldDirty: true })
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <FormField label="Departamento" error={errors.socio_departamento?.message}>
        {otroDepartamento ? (
          <input
            type="text"
            className={inputClass(false)}
            placeholder="Escribir departamento…"
            {...register('socio_departamento')}
          />
        ) : (
          <select className={inputClass(false)} value={departamento || ''} onChange={handleDepartamentoChange}>
            <option value="">— Seleccionar —</option>
            {departamentos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value={OTRO}>Otro / no está en la lista</option>
          </select>
        )}
      </FormField>

      <FormField label="Provincia" error={errors.socio_provincia?.message}>
        {otroProvincia ? (
          <input
            type="text"
            className={inputClass(false)}
            placeholder="Escribir provincia…"
            {...register('socio_provincia')}
          />
        ) : (
          <select
            className={inputClass(false)}
            value={provincia || ''}
            onChange={handleProvinciaChange}
            disabled={!otroDepartamento && !departamento}
          >
            <option value="">— Seleccionar —</option>
            {provincias.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value={OTRO}>Otro / no está en la lista</option>
          </select>
        )}
      </FormField>

      <FormField label="Distrito" error={errors.socio_distrito?.message}>
        {otroDistrito ? (
          <input
            type="text"
            className={inputClass(false)}
            placeholder="Escribir distrito…"
            {...register('socio_distrito')}
          />
        ) : (
          <select
            className={inputClass(false)}
            value={distrito || ''}
            onChange={handleDistritoChange}
            disabled={!otroProvincia && !provincia}
          >
            <option value="">— Seleccionar —</option>
            {distritos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value={OTRO}>Otro / no está en la lista</option>
          </select>
        )}
      </FormField>
    </div>
  )
}
