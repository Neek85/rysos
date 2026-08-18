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

function Score({ register, name, label }) {
  return (
    <FormField label={label}>
      <input type="number" step="any" className={inputClass(false)} {...register(name)} />
    </FormField>
  )
}

export default function TabRiesgos({ register, errors }) {
  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <h2 className="text-base font-bold text-gray-800">Gestión de Riesgos</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Tabla <code className="rounded bg-gray-100 px-1 font-mono">CAP_RIESGOS</code>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="conoce_uso_estiercoles_fresco" label="¿Conoce riesgo de estiércol fresco?" />
        <YesNo register={register} name="insumos_no_permit" label="¿Insumos no permitidos en finca?" />
        <Text register={register} errors={errors} name="insumos_no_permit_que_encontro" label="¿Qué se encontró?" />
        <YesNo register={register} name="tala" label="¿Evidencia de tala?" />
        <Text register={register} errors={errors} name="tala_ob" label="Observación de tala" />
        <YesNo register={register} name="contaminacion" label="¿Riesgo de contaminación?" />
        <Text register={register} errors={errors} name="contaminacion_ob" label="Observación de contaminación" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Mezcla y Producción Paralela</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="prev_mez_prod" label="¿Previene mezcla de producto?" />
        <Text register={register} errors={errors} name="obs_no_mezcla_contam" label="Observación" />
        <YesNo register={register} name="producc_paralela" label="¿Producción paralela (convencional + orgánica)?" />
        <Text register={register} errors={errors} name="obs_paralela" label="Observación" />
        <Text register={register} errors={errors} name="implem_medidas" label="Medidas Implementadas" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Secado y Almacenamiento</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="secado" label="¿Secado adecuado?" />
        <Text register={register} errors={errors} name="secado_cuales" label="¿Cuáles métodos?" />
        <Text register={register} errors={errors} name="secado_condic" label="Condiciones de Secado" />
        <YesNo register={register} name="almacenam" label="¿Almacenamiento adecuado?" />
        <Text register={register} errors={errors} name="almacenam_condic" label="Condiciones de Almacenamiento" />
        <Text register={register} errors={errors} name="condic_oper" label="Condiciones Operativas Generales" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Text register={register} errors={errors} name="levantamiento_nc" label="Levantamiento de No Conformidades" />
        <Text register={register} errors={errors} name="levantamiento_estado" label="Estado del Levantamiento" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Puntaje de Sección</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Score register={register} name="men_riesgo" label="Menores" />
        <Score register={register} name="may_riesgo" label="Mayores" />
        <Score register={register} name="obl_riesgo" label="Obligatorios" />
        <Score register={register} name="total_puntaje_riesgo" label="Puntaje Total" />
      </div>
    </div>
  )
}
