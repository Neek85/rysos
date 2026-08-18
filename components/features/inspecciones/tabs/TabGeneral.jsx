import { FormField, inputClass } from '@/components/ui/FormField'

export default function TabGeneral({ register, errors }) {
  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <h2 className="text-base font-bold text-gray-800">Datos Generales de la Inspección</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Información principal registrada en la tabla{' '}
          <code className="rounded bg-gray-100 px-1 font-mono">INSPECCIONES</code>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Fecha de Visita" error={errors.Fecha_Visita?.message}>
          <input type="date" className={inputClass(errors.Fecha_Visita)} {...register('Fecha_Visita')} />
        </FormField>
        <FormField label="Inspector Interno" required error={errors.Inspector?.message}>
          <input
            type="text"
            className={inputClass(errors.Inspector)}
            placeholder="Nombre del inspector"
            {...register('Inspector')}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Estado de la Inspección" required error={errors.Estado?.message}>
          <select className={inputClass(errors.Estado)} {...register('Estado')}>
            <option value="En Proceso">En Proceso</option>
            <option value="Cerrada">Cerrada</option>
            <option value="Aprobada">Aprobada</option>
            <option value="Rechazada">Rechazada</option>
          </select>
        </FormField>
        <FormField label="Tipo de Inspección" error={errors.Tipo_Inspeccion?.message}>
          <select className={inputClass(errors.Tipo_Inspeccion)} {...register('Tipo_Inspeccion')}>
            <option value="">— Seleccionar —</option>
            <option value="Interna">Interna</option>
            <option value="Externa">Externa</option>
            <option value="Seguimiento">Seguimiento</option>
            <option value="Anunciada">Anunciada</option>
            <option value="No anunciada">No anunciada</option>
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Resultado Global" error={errors.Resultado_Global?.message}>
          <select className={inputClass(false)} {...register('Resultado_Global')}>
            <option value="">— Seleccionar —</option>
            <option value="Aprobado">Aprobado</option>
            <option value="Aprobado con observaciones">Aprobado con observaciones</option>
            <option value="No aprobado">No aprobado</option>
            <option value="Suspendido">Suspendido</option>
          </select>
        </FormField>
        <FormField label="Punto de Control GPS" error={errors.GPS_Punto_Control?.message}>
          <input
            type="text"
            className={inputClass(false)}
            placeholder="ej: -6.7654, -79.8397"
            {...register('GPS_Punto_Control')}
          />
        </FormField>
      </div>

      <FormField label="Fecha de Cierre" error={errors.Fecha_Cierre?.message}>
        <input type="date" className={inputClass(false)} {...register('Fecha_Cierre')} />
      </FormField>

      <FormField label="Resumen de Incumplimientos" error={errors.resumen_incumplimientos?.message}>
        <textarea
          rows={3}
          className={`${inputClass(false)} resize-none`}
          placeholder="Describe los incumplimientos encontrados…"
          {...register('resumen_incumplimientos')}
        />
      </FormField>

      <FormField label="Comprobación Interna" error={errors.comprobacion_interna?.message}>
        <textarea
          rows={3}
          className={`${inputClass(false)} resize-none`}
          placeholder="Notas de la comprobación interna…"
          {...register('comprobacion_interna')}
        />
      </FormField>
    </div>
  )
}
