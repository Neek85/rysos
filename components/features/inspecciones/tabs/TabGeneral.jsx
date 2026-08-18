import { useWatch } from 'react-hook-form'
import { FormField, inputClass } from '@/components/ui/FormField'
import PadronAutocomplete from '../PadronAutocomplete'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { searchSocios, searchParcelas } from '@/lib/padronSearch'

// INVARIANTE: el autocompletado de socio/parcela depende de la política
// RLS `rls_anon_select_padron_socios`/`rls_anon_select_padron_parcelas`
// (supabase/migrations/20260818_fix_inspecciones_rls.sql). Sin esa
// migración aplicada, las búsquedas simplemente no devuelven resultados
// (RLS filtra silenciosamente) — no rompe el formulario, solo el
// autocompletado queda inerte hasta que se aplique.
function VinculoPadron({ control, setValue, organizationId }) {
  const [idSocio, idParcela] = useWatch({ control, name: ['ID_Socio', 'ID_Parcela'] })

  async function handleSearchSocios(query) {
    const supabase = getSupabaseClient()
    if (!supabase) return []
    const rows = await searchSocios(supabase, organizationId, query)
    return rows.map((r) => ({ key: r.ID_Socio, ...r }))
  }

  async function handleSearchParcelas(query) {
    const supabase = getSupabaseClient()
    if (!supabase) return []
    const rows = await searchParcelas(supabase, organizationId, idSocio || null, query)
    return rows.map((r) => ({ key: r.ID_Parcela_Fija, ...r }))
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <h2 className="text-base font-bold text-gray-800">Vincular Socio y Parcela</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Busca en el padrón (<code className="rounded bg-gray-100 px-1 font-mono">PADRON_SOCIOS</code> /{' '}
          <code className="rounded bg-gray-100 px-1 font-mono">PADRON_PARCELAS</code>) por nombre, DNI o
          código.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <PadronAutocomplete
            label="Buscar Socio"
            placeholder="Nombre, DNI o código de finca…"
            disabled={!organizationId}
            search={handleSearchSocios}
            renderResult={(r) => (
              <>
                <p className="font-medium text-gray-800">{r.socio_nombre_completo || 'Sin nombre'}</p>
                <p className="text-xs text-gray-400">
                  {r.socio_dni ? `DNI ${r.socio_dni}` : ''}
                  {r.codigo_finca ? ` · ${r.codigo_finca}` : ''}
                </p>
              </>
            )}
            onSelect={(r) => {
              setValue('ID_Socio', r.ID_Socio, { shouldDirty: true })
              if (r.socio_nombre_completo) setValue('socio_nombre_completo', r.socio_nombre_completo, { shouldDirty: true })
              if (r.socio_dni) setValue('socio_dni', r.socio_dni, { shouldDirty: true })
            }}
          />
          {idSocio && <p className="mt-1 text-xs text-emerald-700">✓ Socio vinculado: {idSocio}</p>}
        </div>

        <div>
          <PadronAutocomplete
            label="Buscar Parcela"
            placeholder="Código o nombre de parcela…"
            disabled={!organizationId}
            search={handleSearchParcelas}
            renderResult={(r) => (
              <>
                <p className="font-medium text-gray-800">{r.parcela_codigo || 'Sin código'}</p>
                <p className="text-xs text-gray-400">
                  {r.parcela_nombre || ''}
                  {r.totalh ? ` · ${r.totalh} ha` : ''}
                </p>
              </>
            )}
            onSelect={(r) => setValue('ID_Parcela', r.ID_Parcela_Fija, { shouldDirty: true })}
          />
          {idParcela && <p className="mt-1 text-xs text-emerald-700">✓ Parcela vinculada: {idParcela}</p>}
        </div>
      </div>
    </div>
  )
}

export default function TabGeneral({ register, errors, control, setValue, organizationId }) {
  return (
    <div className="space-y-5">
      <VinculoPadron control={control} setValue={setValue} organizationId={organizationId} />

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
    </div>
  )
}
