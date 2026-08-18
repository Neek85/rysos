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

export default function TabBienestar({ register, errors }) {
  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <h2 className="text-base font-bold text-gray-800">Bienestar Laboral y Social</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Tabla <code className="rounded bg-gray-100 px-1 font-mono">CAP_BIENESTAR</code>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="condiciones_bienestar" label="¿Condiciones de bienestar adecuadas?" />
        <Text register={register} errors={errors} name="condiciones_bienestar_ob" label="Observación" />
        <Text register={register} errors={errors} name="condiciones_bienestar_mat" label="Material de Vivienda/Instalaciones" />
        <YesNo register={register} name="agua_consumo" label="¿Agua de consumo disponible?" />
        <Text register={register} errors={errors} name="agua_consumo_cuales" label="¿Cuáles fuentes?" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Condiciones Laborales</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="personal_monto" label="¿Paga salario mínimo o superior?" />
        <Text register={register} errors={errors} name="personal_monto_ob" label="Observación" />
        <Text register={register} errors={errors} name="personal_monto_ob_otro" label="Observación (otro)" />
        <Text register={register} errors={errors} name="horas_trabajo" label="Horas de Trabajo" />
        <Text register={register} errors={errors} name="descanso_trabajo" label="Descanso Laboral" />
        <YesNo register={register} name="monitoreo_menores" label="¿Monitoreo de trabajo de menores?" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Salud y Seguridad</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="medicamentos" label="¿Botiquín/medicamentos disponibles?" />
        <Text register={register} errors={errors} name="medicamentos_lista" label="Lista de Medicamentos" />
        <YesNo register={register} name="program_salud" label="¿Programa de salud ocupacional?" />
        <YesNo register={register} name="capacit_trab_prot" label="¿Capacitación en protección al trabajador?" />
        <YesNo register={register} name="posee_epp" label="¿Posee Equipo de Protección Personal (EPP)?" />
        <YesNo register={register} name="accidentes" label="¿Registro de accidentes laborales?" />
        <YesNo register={register} name="senalizacion_peligro" label="¿Señalización de peligro?" />
        <YesNo register={register} name="nomas_seguridad" label="¿Normas de seguridad visibles?" />
        <YesNo register={register} name="emergencia" label="¿Plan de emergencia?" />
        <Text register={register} errors={errors} name="situaciones_peligro" label="Situaciones de Peligro Identificadas" />
        <Text register={register} errors={errors} name="act_no_riesgo" label="Actividades sin Riesgo Aparente" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        No Discriminación y Trabajo Infantil
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <YesNo register={register} name="practica_discriminatoria" label="¿Práctica discriminatoria identificada?" />
        <Text register={register} errors={errors} name="practica_discriminatoria_ob" label="Observación" />
        <YesNo register={register} name="discrimin_raza_rel_sex" label="¿Discriminación por raza/religión/sexo?" />
        <Text register={register} errors={errors} name="discrimin_raza_rel_sex_ob" label="Observación" />
        <YesNo register={register} name="menores_trabajando" label="¿Menores de edad trabajando?" />
        <Text register={register} errors={errors} name="menores_trabajando_edades" label="Edades" />
        <YesNo register={register} name="registro_trabajadores" label="¿Registro de trabajadores?" />
        <YesNo register={register} name="quejas_reclamaciones" label="¿Mecanismo de quejas/reclamaciones?" />
        <YesNo register={register} name="discapac_temporal_trab" label="¿Trabajadores con discapacidad temporal?" />
        <Text register={register} errors={errors} name="discapac_temporal_trab_ob" label="Observación" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Puntaje de Sección</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Score register={register} name="obl_bien" label="Obligatorios" />
        <Score register={register} name="may_bien" label="Mayores" />
        <Score register={register} name="men_bien" label="Menores" />
        <Score register={register} name="total_puntaje_bien" label="Puntaje Total" />
      </div>
    </div>
  )
}
