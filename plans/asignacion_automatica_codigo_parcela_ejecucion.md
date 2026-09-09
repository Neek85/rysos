# Plan — Asignación automática de código de parcela al aprobar QC

Ver `specs/asignacion_automatica_codigo_parcela.md` para el diseño y las
correcciones de premisa.

1. Migración `supabase/migrations/20260909120000_fn_aprobar_monitoreo_nueva_parcela.sql`:
   crea `fn_aprobar_monitoreo_nueva_parcela` (SECURITY INVOKER, GRANT
   explícito a `authenticated`, REVOKE de PUBLIC/anon).
2. `lib/eudrQcActions.js`: función interna `resolveNuevaParcelaAsignacion`
   (resuelve `ID_Socio` fresco + calcula `ID_Parcela_Fija` con
   `computeNextParcelaCode`/`computeSuggestedParcelaId`); `approveRecord`
   la usa condicionalmente antes del `UPDATE` normal.
3. `tests/test_eudr_qc_actions.mjs`: `baseRecord()` pasa a incluir
   `ID_Parcela_Fija: 'COOP-JS-001'` por defecto (para no alterar el
   comportamiento de los tests existentes, que no la seteaban a propósito
   — ver nota en el diff); tests nuevos para el flujo de parcela nueva
   (código generado, INSERT en PADRON_PARCELAS simulado vía RPC, no
   dispara en parcela existente, aislamiento multi-tenant, colisión PK
   propagada).
4. `npm run build` (verificación estática — no hay E2E real posible hoy,
   ver corrección 5 de la spec).
5. `docs/ESTADO_PROYECTO.md`: entrada nueva, IA/herramienta = Claude
   (Cowork), gate de segunda revisión cubierto en el mismo flujo.
6. Commit `feat(qc): auto-asignación de código de parcela y alta en padrón al aprobar`,
   push a `staging`.
