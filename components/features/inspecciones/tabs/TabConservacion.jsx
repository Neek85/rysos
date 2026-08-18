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

export default function TabConservacion({ register, errors }) {
  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <h2 className="text-base font-bold text-gray-800">Conservación del Ecosistema</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Tabla <code className="rounded bg-gray-100 px-1 font-mono">CAP_CONSERVACION</code>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="extr_agua_sup" label="¿Extracción de agua superficial?" />
        <YesNo register={register} name="sepacion_areas" label="¿Separación de áreas de conservación?" />
        <YesNo register={register} name="conoce_proh_bosq_nat" label="¿Conoce prohibición de tala de bosque nativo?" />
        <YesNo register={register} name="conoce_proh_bosq_nat_ue" label="¿Conoce el requisito EUDR (fecha de corte)?" />
        <YesNo register={register} name="vida_silv_ret" label="¿Retiene vida silvestre?" />
        <YesNo register={register} name="vida_silv_no_emp" label="¿No emplea trampas para fauna?" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Especies y Fauna</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Text register={register} errors={errors} name="especies" label="Especies Nativas Identificadas" />
        <Text register={register} errors={errors} name="especies_medidas" label="Medidas de Protección de Especies" />
        <YesNo register={register} name="fauna" label="¿Presencia de Fauna Silvestre?" />
        <Text register={register} errors={errors} name="fauna_especies" label="Especies de Fauna" />
        <Text register={register} errors={errors} name="fauna_medidas" label="Medidas de Protección de Fauna" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Áreas y Fuentes de Agua</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="acciones_proteccion" label="¿Realiza acciones de protección?" />
        <Text register={register} errors={errors} name="acciones_proteccion_manera" label="¿De qué manera?" />
        <YesNo register={register} name="areas_produccion" label="¿Áreas de producción bien delimitadas?" />
        <Text register={register} errors={errors} name="areas_produccion_ob" label="Observación" />
        <Text register={register} errors={errors} name="program_ecosist" label="Programa de Conservación del Ecosistema" />
        <YesNo register={register} name="proteccion_fuentes" label="¿Protección de Fuentes de Agua?" />
        <Text register={register} errors={errors} name="proteccion_fuentes_ob" label="Observación" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Puntaje de Sección</p>
      <div className="grid grid-cols-3 gap-4">
        <Score register={register} name="men_conser" label="Menores" />
        <Score register={register} name="may_conser" label="Mayores" />
        <Score register={register} name="total_puntaje_conser" label="Puntaje Total" />
      </div>
    </div>
  )
}
