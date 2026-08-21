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
