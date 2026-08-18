import { FormField, inputClass } from '@/components/ui/FormField'

function Text({ register, name, label, errors, type = 'text', placeholder }) {
  return (
    <FormField label={label} error={errors[name]?.message}>
      <input type={type} className={inputClass(errors[name])} placeholder={placeholder} {...register(name)} />
    </FormField>
  )
}

function Num({ register, name, label, errors, placeholder = '%' }) {
  return (
    <FormField label={label} error={errors[name]?.message}>
      <input
        type="number"
        step="any"
        className={inputClass(errors[name])}
        placeholder={placeholder}
        {...register(name)}
      />
    </FormField>
  )
}

export default function TabSocio({ register, errors }) {
  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <h2 className="text-base font-bold text-gray-800">Datos del Socio</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Tabla <code className="rounded bg-gray-100 px-1 font-mono">CAP_DATOS_SOCIO</code> — información
          personal y socioeconómica del productor.
        </p>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Identidad</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Text register={register} errors={errors} name="socio_nombre_completo" label="Nombre Completo" />
        <Text register={register} errors={errors} name="socio_dni" label="DNI" />
        <FormField label="Género" error={errors.socio_genero?.message}>
          <select className={inputClass(false)} {...register('socio_genero')}>
            <option value="">— Seleccionar —</option>
            <option value="Masculino">Masculino</option>
            <option value="Femenino">Femenino</option>
          </select>
        </FormField>
        <Text register={register} errors={errors} name="socio_fecha_nacimiento" label="Fecha de Nacimiento" type="date" />
        <Text register={register} errors={errors} name="socio_fecha_ingreso" label="Fecha de Ingreso a la Organización" type="date" />
        <FormField label="Estado Civil" error={errors.estado_civil?.message}>
          <select className={inputClass(false)} {...register('estado_civil')}>
            <option value="">— Seleccionar —</option>
            <option value="Soltero(a)">Soltero(a)</option>
            <option value="Casado(a)">Casado(a)</option>
            <option value="Conviviente">Conviviente</option>
            <option value="Viudo(a)">Viudo(a)</option>
            <option value="Divorciado(a)">Divorciado(a)</option>
          </select>
        </FormField>
        <Text register={register} errors={errors} name="conyuge_nombre" label="Nombre del Cónyuge" />
        <Text register={register} errors={errors} name="conyuge_dni" label="DNI del Cónyuge" />
        <Text register={register} errors={errors} name="educacion" label="Nivel Educativo" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ubicación</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Text register={register} errors={errors} name="socio_departamento" label="Departamento" />
        <Text register={register} errors={errors} name="socio_provincia" label="Provincia" />
        <Text register={register} errors={errors} name="socio_distrito" label="Distrito" />
        <Text register={register} errors={errors} name="localidad" label="Localidad / Caserío" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Contacto y Conectividad</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Text register={register} errors={errors} name="celular_socio" label="Celular del Socio" />
        <FormField label="¿Tiene Smartphone?" error={errors.celular_smartphone?.message}>
          <select className={inputClass(false)} {...register('celular_smartphone')}>
            <option value="">— Seleccionar —</option>
            <option value="Si">Sí</option>
            <option value="No">No</option>
          </select>
        </FormField>
        <FormField label="¿Acceso a Internet?" error={errors.acceso_internet?.message}>
          <select className={inputClass(false)} {...register('acceso_internet')}>
            <option value="">— Seleccionar —</option>
            <option value="Si">Sí</option>
            <option value="No">No</option>
          </select>
        </FormField>
        <Text register={register} errors={errors} name="redes_sociales" label="Redes Sociales que Usa" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Crédito y Banca</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="¿Accede a Crédito?" error={errors.credito?.message}>
          <select className={inputClass(false)} {...register('credito')}>
            <option value="">— Seleccionar —</option>
            <option value="Si">Sí</option>
            <option value="No">No</option>
          </select>
        </FormField>
        <Text register={register} errors={errors} name="credito_donde_otros" label="¿Dónde (si es otra entidad)?" />
        <Text register={register} errors={errors} name="credito_utilizo" label="¿En qué lo utilizó?" />
        <FormField label="¿Tiene Cuenta Bancaria?" error={errors.cuenta_bancaria?.message}>
          <select className={inputClass(false)} {...register('cuenta_bancaria')}>
            <option value="">— Seleccionar —</option>
            <option value="Si">Sí</option>
            <option value="No">No</option>
          </select>
        </FormField>
        <Text register={register} errors={errors} name="cuenta_bancaria_entidad" label="Entidad Bancaria" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        Desglose de Fuentes de Ingreso (%)
      </p>
      <Text register={register} errors={errors} name="generacion_ingresos" label="Fuente Principal de Ingresos" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Num register={register} errors={errors} name="porcent_ingresos_cafe" label="% Café" />
        <Num register={register} errors={errors} name="percent_ingresos_otros_cultivo" label="% Otros Cultivos" />
        <Num register={register} errors={errors} name="percent_ingresos_crianza_animales" label="% Crianza de Animales" />
        <Num register={register} errors={errors} name="percent_ingresos_comercio" label="% Comercio" />
        <Num register={register} errors={errors} name="percent_ingresos_construccion" label="% Construcción" />
        <Num register={register} errors={errors} name="percent_ingresos_transporte" label="% Transporte" />
        <Num register={register} errors={errors} name="percent_profesion_oficio" label="% Profesión/Oficio" />
        <Num register={register} errors={errors} name="percent_ingresos_otros" label="% Otros" />
        <Num register={register} errors={errors} name="percent_tot" label="% Total" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Text register={register} errors={errors} name="generacion_profesion_oficio_cual" label="¿Cuál profesión/oficio?" />
        <Text register={register} errors={errors} name="generacion_profesion_oficio_cual_otro" label="¿Cuál (otro)?" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Familia y Mano de Obra</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Num register={register} errors={errors} name="familia" label="Integrantes de Familia" placeholder="N°" />
        <Num register={register} errors={errors} name="familia_menores_14" label="Menores de 14" placeholder="N°" />
        <Num register={register} errors={errors} name="familia_menores_15_18" label="Entre 15 y 18" placeholder="N°" />
        <Num register={register} errors={errors} name="traba_cam_tot" label="Total Trabajadores de Campo" placeholder="N°" />
        <Num register={register} errors={errors} name="nro_empleado_permanente" label="Empleados Permanentes" placeholder="N°" />
        <Num register={register} errors={errors} name="nro_empleado_temporales" label="Empleados Temporales" placeholder="N°" />
      </div>
      <Text register={register} errors={errors} name="hijos_socio" label="Hijos del Socio (resumen)" />

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Salud y Transporte</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="¿Cuenta con Centro de Salud Cercano?" error={errors.centro_salud?.message}>
          <select className={inputClass(false)} {...register('centro_salud')}>
            <option value="">— Seleccionar —</option>
            <option value="Si">Sí</option>
            <option value="No">No</option>
          </select>
        </FormField>
        <Text register={register} errors={errors} name="centro_salud_cuales" label="¿Cuáles?" />
        <Text register={register} errors={errors} name="centro_salud_distanc" label="Distancia al Centro de Salud" />
        <Text register={register} errors={errors} name="medio_transporte_tiene" label="Medio de Transporte" />
      </div>
    </div>
  )
}
