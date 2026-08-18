import { FormField, inputClass } from '@/components/ui/FormField'

function Text({ register, name, label, errors }) {
  return (
    <FormField label={label} error={errors[name]?.message}>
      <input type="text" className={inputClass(errors[name])} {...register(name)} />
    </FormField>
  )
}

function YesNo({ register, name, label }) {
  return (
    <FormField label={label}>
      <select className={inputClass(false)} {...register(name)}>
        <option value="">— Seleccionar —</option>
        <option value="Si">Sí</option>
        <option value="No">No</option>
      </select>
    </FormField>
  )
}

function Num({ register, name, label }) {
  return (
    <FormField label={label}>
      <input type="number" step="any" className={inputClass(false)} {...register(name)} />
    </FormField>
  )
}

export default function TabGestion({ register, errors }) {
  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <h2 className="text-base font-bold text-gray-800">Gestión de la Finca y la Organización</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Tabla <code className="rounded bg-gray-100 px-1 font-mono">CAP_GESTION</code>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="cronog_finca" label="¿Cronograma de finca?" />
        <Text register={register} errors={errors} name="cronog_finca_estado" label="Estado del Cronograma" />
        <YesNo register={register} name="registros" label="¿Lleva registros de actividades?" />
        <YesNo register={register} name="visita_asist_tecnica" label="¿Recibió asistencia técnica?" />
        <Text register={register} errors={errors} name="temas_asist_tec" label="Temas de Asistencia Técnica" />
        <Text register={register} errors={errors} name="temas_asist_tec_nc" label="Temas No Cubiertos" />
        <YesNo register={register} name="croquis" label="¿Tiene croquis de la finca?" />
        <Text register={register} errors={errors} name="croquis_tipo" label="Tipo de Croquis" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Comercio Justo y Energía</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="prima_cj" label="¿Recibe prima de comercio justo?" />
        <Text register={register} errors={errors} name="prima_cj_des" label="Destino de la Prima" />
        <YesNo register={register} name="uso_fuente_energia" label="¿Usa fuente de energía alternativa?" />
        <Text register={register} errors={errors} name="uso_fuente_energia_tipo" label="Tipo de Fuente" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Capacitación e Inversión</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="asistio_capacitacion" label="¿Asistió a capacitaciones?" />
        <Num register={register} name="asistio_capacitacion_num" label="N° de Capacitaciones" />
        <YesNo register={register} name="invierte_finca" label="¿Invierte en la finca?" />
        <Text register={register} errors={errors} name="invierte_finca_actividades" label="Actividades de Inversión" />
        <Text register={register} errors={errors} name="invierte_finca_actividades_otros" label="Otras Actividades" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Comercialización y Gobernanza</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="ingresos_venta_producto" label="¿Vende directamente el producto?" />
        <Text register={register} errors={errors} name="ingresos_venta_producto_monto" label="Monto Aproximado" />
        <YesNo register={register} name="directivos" label="¿Conoce a los directivos de la organización?" />
        <YesNo register={register} name="procedimiento_reclamo" label="¿Conoce el procedimiento de reclamo?" />
        <Text register={register} errors={errors} name="riesgos_gest" label="Riesgos Identificados (Gestión)" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Puntaje de Sección</p>
      <div className="grid grid-cols-3 gap-4">
        <Num register={register} name="men_gest" label="Menores" />
        <Num register={register} name="may_gest" label="Mayores" />
        <Num register={register} name="total_puntaje_gest" label="Puntaje Total" />
      </div>
    </div>
  )
}
