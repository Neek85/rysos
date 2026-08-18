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

export default function TabMic({ register, errors }) {
  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <h2 className="text-base font-bold text-gray-800">Manejo Integrado del Cultivo</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Tabla <code className="rounded bg-gray-100 px-1 font-mono">CAP_MIC</code>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="semilla_propia" label="¿Semilla Propia?" />
        <Text register={register} errors={errors} name="semilla_proviene" label="¿De dónde proviene la semilla?" />
        <YesNo register={register} name="plant_norma_org" label="¿Plantación cumple norma orgánica?" />
        <Text register={register} errors={errors} name="plant_norma_org_insum_perm" label="Insumos permitidos usados" />
        <Text register={register} errors={errors} name="nc_plant_norma_org_insum_no_perm" label="Insumos NO permitidos encontrados" />
        <Text register={register} errors={errors} name="manejo_sombra" label="Manejo de Sombra" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Infraestructura de Beneficio</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <YesNo register={register} name="benef_humedo" label="¿Beneficio Húmedo?" />
        <Text register={register} errors={errors} name="benef_humedo_ob" label="Observación" />
        <Text register={register} errors={errors} name="benef_humedo_estado" label="Estado" />
        <YesNo register={register} name="tanque_tina" label="¿Tanque/Tina?" />
        <Text register={register} errors={errors} name="tanque_tina_tipo" label="Tipo" />
        <Text register={register} errors={errors} name="tanque_tina_estado" label="Estado" />
        <YesNo register={register} name="pulpero" label="¿Pulpero?" />
        <Text register={register} errors={errors} name="pulpero_tipo" label="Tipo" />
        <Text register={register} errors={errors} name="pulpero_estado" label="Estado" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Text register={register} errors={errors} name="manejo_aguas_mieles_practica" label="Manejo de Aguas Mieles — Práctica" />
        <Text register={register} errors={errors} name="manejo_aguas_mieles_estado" label="Manejo de Aguas Mieles — Estado" />
        <YesNo register={register} name="nva_areas_adecuadas" label="¿Nuevas áreas adecuadas para siembra?" />
        <YesNo register={register} name="pract_plagenf" label="¿Prácticas de manejo de plagas/enfermedades?" />
        <Text register={register} errors={errors} name="pract_plagenf_cuales" label="¿Cuáles?" />
        <Text register={register} errors={errors} name="abonom" label="Abonamiento" />
        <Text register={register} errors={errors} name="insumo_perm_org" label="Insumo Orgánico Permitido Usado" />
        <YesNo register={register} name="diversif_cultivos" label="¿Diversificación de Cultivos?" />
        <Text register={register} errors={errors} name="diversif_cultivos_det" label="Detalle de Diversificación" />
        <Text register={register} errors={errors} name="fertilidad" label="Manejo de Fertilidad de Suelo" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Puntaje de Sección</p>
      <div className="grid grid-cols-3 gap-4">
        <Score register={register} name="men_mic" label="Menores" />
        <Score register={register} name="may_mic" label="Mayores" />
        <Score register={register} name="total_puntaje_mic" label="Puntaje Total" />
      </div>
    </div>
  )
}
