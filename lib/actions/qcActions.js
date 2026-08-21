'use server'

// Server Actions de escritura para la Consola QC WebGIS (/dashboard/qc) —
// ver docs/adr/ADR-003-consola-qc-server-actions-escritura.md.
//
// HALLAZGO REAL (no pedido explícitamente por ningún prompt, encontrado
// investigando el error "ya no está en estado PENDIENTE" que reportaba
// specs/consola_qc_layout_y_validacion.md): las 4 escrituras de esta
// consola (approveRecord/rejectRecord/updateRecordAttributes/
// updateRecordGeometry, todas en lib/eudrQcActions.js) se invocaban con
// getSupabaseClient() — el cliente anon key, sin sesión de Supabase Auth
// (ver el gotcha de RLS en CLAUDE.md). Pero
// supabase/migrations/20260818_rls_multi_tenant_fortification.sql define
// `rls_write_eudr_monitoreo`/`rls_write_eudr_uso_suelo`/
// `rls_write_eudr_instalaciones` como `FOR ALL TO authenticated` — SIN
// política `anon` de escritura. Confirmado en vivo (curl contra el propio
// endpoint de dev): cualquier UPDATE desde el frontend afectaba 0 filas
// SIEMPRE, sin importar el estado real del registro, disparando el
// mensaje "ya no está en estado PENDIENTE" de forma constante — el bug no
// era el guard PENDIENTE (correcto), era que RLS bloqueaba el UPDATE
// completo antes de llegar a evaluar ninguna condición de negocio.
//
// Mismo patrón ya establecido en lib/actions/sociosActions.js (Padrón) y
// lib/actions/gisActions.js (Editor Vectorial): Service Role Key
// server-side en vez de abrir políticas RLS `anon` de escritura sobre
// EUDR_MONITOREO/EUDR_USO_SUELO/EUDR_INSTALACIONES — decisión confirmada
// con el usuario vía AskUserQuestion (opción recomendada, sobre la
// alternativa de agregar políticas `anon`).
//
// Las funciones puras (multi-tenant + guard PENDIENTE) NO cambiaron —
// siguen en lib/eudrQcActions.js, siguen cubiertas por
// tests/test_eudr_qc_actions.mjs tal como estaban. Este archivo es solo la
// capa server-side que las invoca con el cliente correcto — mismo criterio
// que gisActions.js: lanza EUDRQcError directamente (no un objeto
// {ok,error}), porque page.jsx ya captura `err instanceof EUDRQcError` —
// mismo patrón ya probado en producción por
// VectorEditorTools.jsx::uploadGeoSpatialFeature.

import { getSupabaseServerClient } from '@/lib/supabaseServerClient'
import {
  approveRecord,
  rejectRecord,
  updateRecordAttributes,
  updateRecordGeometry,
} from '@/lib/eudrQcActions'

export async function approveQcRecord(record, organizationId) {
  const supabase = getSupabaseServerClient()
  await approveRecord(supabase, record, organizationId)
  return { ok: true }
}

export async function rejectQcRecord(record, motivo, organizationId) {
  const supabase = getSupabaseServerClient()
  await rejectRecord(supabase, record, motivo, organizationId)
  return { ok: true }
}

export async function updateQcRecordAttributes(record, attributes, organizationId) {
  const supabase = getSupabaseServerClient()
  await updateRecordAttributes(supabase, record, attributes, organizationId)
  return { ok: true }
}

export async function updateQcRecordGeometry(record, geometry, organizationId) {
  const supabase = getSupabaseServerClient()
  await updateRecordGeometry(supabase, record, geometry, organizationId)
  return { ok: true }
}

// ---------------------------------------------------------------
// Fase 3 — capa de contexto de parcelas vecinas, ver
// docs/adr/ADR-006-capa-contexto-parcelas-vecinas.md.
// ---------------------------------------------------------------

const DEFAULT_RADIO_CONTEXTO_M = 500

/**
 * Resuelve el radio configurado (`ORGANIZACIONES.Config.gis.radio_contexto_vecinos_m`)
 * para `organizationId`, con fallback a `DEFAULT_RADIO_CONTEXTO_M` cuando
 * el campo no existe todavía (`Config` es `NULL` en las 2 organizaciones
 * reales hoy, confirmado con Service Role Key — no hay UI para
 * configurarlo, ver ADR-006, "fuera de alcance a propósito"). Resuelto
 * enteramente server-side, nunca se expone `Config` completo al cliente.
 */
async function resolveRadioContextoM(supabase, organizationId) {
  const { data, error } = await supabase
    .from('ORGANIZACIONES')
    .select('Config')
    .eq('ID', organizationId)
    .maybeSingle()
  if (error) return DEFAULT_RADIO_CONTEXTO_M
  const configured = data?.Config?.gis?.radio_contexto_vecinos_m
  return typeof configured === 'number' && configured > 0 ? configured : DEFAULT_RADIO_CONTEXTO_M
}

/**
 * Parcelas vecinas (Monitoreos EUDR APROBADOS) dentro del radio de
 * contexto de `organizationId`, alrededor de `geometry` (el punto/
 * centroide del polígono en dibujo/edición — resuelto por el llamador,
 * ver components/gis/QcConsoleMap.jsx). `excludeId` (id_monitoreo, uuid):
 * omite el propio registro cuando se está editando uno ya existente.
 *
 * `organizationId` viene del mismo valor ya confiable que usa el resto
 * de esta consola (`resolveOrganizationId(records)`, derivado de
 * registros ya filtrados por organización del lado del servidor en
 * `fetchPendingRecords` — nunca un valor arbitrario tecleado por el
 * cliente) — la Service Role Key bypasea RLS, así que el filtro real de
 * aislamiento multi-tenant es el `WHERE "ID_Organizacion" = p_organizacion_id`
 * dentro de `fn_parcelas_vecinas_eudr` (ver la migración), no RLS.
 */
export async function fetchParcelasVecinas(organizationId, geometry, excludeId) {
  if (!organizationId || !geometry) return { parcelas: [], totalEncontrados: 0, totalDevueltos: 0, radioM: DEFAULT_RADIO_CONTEXTO_M }

  const supabase = getSupabaseServerClient()
  const radioM = await resolveRadioContextoM(supabase, organizationId)

  const { data, error } = await supabase.rpc('fn_parcelas_vecinas_eudr', {
    p_organizacion_id: organizationId,
    p_geom: geometry,
    p_radio_m: radioM,
    p_excluir_id: excludeId || null,
    p_limite: 25,
  })
  if (error) throw error

  const rows = data || []
  return {
    parcelas: rows.map((row) => ({ id: row.id, geometry: row.geom, codigoSocio: row.codigo_socio })),
    totalEncontrados: rows[0]?.total_encontrados ?? 0,
    totalDevueltos: rows[0]?.total_devueltos ?? 0,
    radioM,
  }
}
