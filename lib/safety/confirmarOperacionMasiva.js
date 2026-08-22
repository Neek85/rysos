// Utilidad de seguridad para cualquier Server Action de borrado/
// actualización masiva — ver Sección 5 ("Reglas Inviolables de Código y
// Seguridad") de docs/RYZOS_ORQUESTADOR_V3.1.md y
// docs/adr/ADR-008-etiqueta-organizacion-prueba-y-guardarail-e2e.md.
//
// Antes de ejecutar un DELETE/UPDATE masivo, la Server Action que lo
// dispare debe llamar a confirmarOperacionMasiva() y mostrar
// nombre_organizacion + conteo_filas_afectadas para que la confirmación
// humana cite esos números reales, en vez de depender de que alguien lo
// consulte a mano. Esta función NUNCA ejecuta el borrado/actualización
// en sí — solo reporta el estado real para que quien decide tenga los
// datos correctos delante.
//
// En archivo separado (sin 'use server') para poder testear con
// node --test, mismo motivo que lib/actions/orgIdMatch.js y
// lib/actions/socioActionError.js.
//
// SOLO server-side (usa la Service Role Key vía getSupabaseServerClient)
// — nunca importar desde un componente 'use client'.

import { getSupabaseServerClient } from '@/lib/supabaseServerClient'

export async function confirmarOperacionMasiva({ idOrganizacion, tabla, columnaOrganizacion = 'ID_Organizacion' }) {
  if (!idOrganizacion || !tabla) {
    throw new Error('confirmarOperacionMasiva requiere idOrganizacion y tabla')
  }

  const supabase = getSupabaseServerClient()

  const { data: orgRows, error: orgError } = await supabase
    .from('ORGANIZACIONES')
    .select('Nombre_Organizacion, es_organizacion_prueba')
    .eq('ID', idOrganizacion)
    .limit(1)

  if (orgError) throw orgError

  const org = orgRows?.[0] ?? null

  const { count, error: countError } = await supabase
    .from(tabla)
    .select('*', { count: 'exact', head: true })
    .eq(columnaOrganizacion, idOrganizacion)

  if (countError) throw countError

  return {
    nombre_organizacion: org?.Nombre_Organizacion ?? null,
    // Sin fila en ORGANIZACIONES = false, el lado seguro del error (misma
    // convención que el DEFAULT false de la columna — ver ADR-008).
    es_prueba: org?.es_organizacion_prueba ?? false,
    conteo_filas_afectadas: count ?? 0,
  }
}
