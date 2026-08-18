import { useWatch } from 'react-hook-form'
import { FormField, inputClass } from '@/components/ui/FormField'

// Nota de portabilidad: el TabCierre original (backend-inspecciones)
// tiene un "mini-dashboard" de resumen con los valores hardcodeados en
// "—" — nunca se conectó al estado real del formulario. Acá se conecta
// de verdad con `useWatch`, una mejora menor sobre el port directo.
export default function TabCierre({ register, errors, control, setActiveTab }) {
  const watched = useWatch({
    control,
    name: ['Inspector', 'Fecha_Visita', 'Tipo_Inspeccion', 'Estado'],
  })
  const [inspector, fechaVisita, tipoInspeccion, estado] = watched

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500">
          ⚠️
        </span>
        <div>
          <p className="text-sm font-semibold text-amber-800">Sección de Cierre Oficial</p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-700">
            Al guardar esta sección con el estado <strong>&quot;Cerrada&quot;</strong>, se da por
            concluida la inspección técnica. Asegúrese de haber revisado todos los módulos antes de
            finalizar.
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
          <h3 className="text-sm font-bold text-gray-700">Resumen de la Inspección</h3>
          <span className="ml-auto rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-400">
            Solo lectura
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Inspector Interno', inspector],
            ['Fecha de Visita', fechaVisita],
            ['Tipo de Inspección', tipoInspeccion],
            ['Estado Actual', estado],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
              <p className="truncate text-sm font-semibold text-gray-800">{value || '—'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-green-100 text-xs font-bold text-green-700">
            1
          </span>
          <h3 className="text-sm font-bold text-gray-700">Resultado y Cierre Formal</h3>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Estado de la Inspección" error={errors.Estado?.message}>
            <select className={inputClass(errors.Estado)} {...register('Estado')}>
              <option value="En Proceso">En Proceso</option>
              <option value="Cerrada">Cerrada</option>
              <option value="Aprobada">Aprobada</option>
              <option value="Rechazada">Rechazada</option>
            </select>
          </FormField>
          <FormField label="Resultado de la Inspección" error={errors.Resultado_Global?.message}>
            <select className={inputClass(false)} {...register('Resultado_Global')}>
              <option value="">— Seleccionar —</option>
              <option value="Aprobado">Aprobado</option>
              <option value="Aprobado con observaciones">Aprobado con observaciones</option>
              <option value="No aprobado">No aprobado</option>
              <option value="Suspendido">Suspendido</option>
            </select>
          </FormField>
          <FormField label="Fecha de Cierre" error={errors.Fecha_Cierre?.message}>
            <input type="date" className={inputClass(false)} {...register('Fecha_Cierre')} />
          </FormField>
        </div>

        <FormField label="Punto GPS de Control" error={errors.GPS_Punto_Control?.message}>
          <input
            type="text"
            className={inputClass(false)}
            placeholder="ej: -6.7654, -79.8397"
            {...register('GPS_Punto_Control')}
          />
        </FormField>

        <FormField label="Firma del Productor (URL/ruta)" error={errors.Firma_Productor?.message}>
          <input type="text" className={inputClass(false)} {...register('Firma_Productor')} />
        </FormField>
        <FormField label="Firma del Inspector (URL/ruta)" error={errors.Firma_Inspector?.message}>
          <input type="text" className={inputClass(false)} {...register('Firma_Inspector')} />
        </FormField>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setActiveTab('general')}
          className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
        >
          ← Revisar Datos Generales antes de guardar
        </button>
      </div>
    </div>
  )
}
