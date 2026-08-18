# Checklist de Verificación — Reingeniería Core RYZOS (2026-08-18)

**Alcance:** las 5 migraciones SQL escritas el 2026-08-18, la certificación
local (tests + build), y la verificación funcional en la instancia Supabase
en vivo (`jhtocgxlozfuzullrtol`).

**Nota de honestidad de estado (actualizada 2026-08-18, segunda pasada):**
la primera versión de este checklist decía que este entorno no tenía forma
de verificar la instancia Supabase real. Eso resultó ser parcialmente
incorrecto: **sí es posible verificar en modo lectura/no-destructivo con la
`NEXT_PUBLIC_SUPABASE_ANON_KEY` de `.env.local`**, vía REST directo
(`${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/...`), sin necesitar Service Role Key
ni acceso al SQL Editor. Con ese método se verificaron en vivo las 5
migraciones — ver resultados abajo. Lo que sigue sin ser posible desde
aquí es una prueba de **escritura** real de punta a punta (ej. crear una
inspección completa desde el UI) sin arriesgar dejar datos de prueba en
producción — esos ítems (sección 3) siguen pendientes.

## 1. Migraciones SQL — aplicación en Supabase (`jhtocgxlozfuzullrtol`)

**Las 5 confirmadas aplicadas y funcionando**, verificado en vivo el
2026-08-18 con un script temporal de solo lectura (borrado tras la
verificación) contra `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/...` con la anon
key. Evidencia real de cada una:

- [x] 1. `supabase/migrations/20260818_fix_inspecciones_rls.sql` —
      confirmado: `GET /rest/v1/INSPECCIONES?select=ID_Inspeccion&limit=1`
      devuelve `200` con una fila real (`ID_Inspeccion: 271CC32A-3D94-4F88-BD26-95A79690E5BA`).
      Antes de esta migración, esa misma consulta con anon key devolvía
      `42501` (RLS sin política para `anon`) — confirmado en la propia
      migración.
- [x] 2. `supabase/migrations/20260818_gis_core_sanitization.sql` —
      confirmado: `POST /rest/v1/rpc/fn_sanitize_geometry` con
      `POINT(-77.123456789 -6.987654321)` (SRID 0, 9 decimales) devuelve
      `200` con `"crs":{"properties":{"name":"EPSG:4326"}}` y coordenadas
      `[-77.123457, -6.987654]` — SRID asignado y redondeo a 6 decimales
      correctos, function-level (índices GiST no verificables sin acceso a
      `pg_indexes`, que PostgREST no expone vía REST — ver ítem pendiente
      abajo).
- [x] 3. `supabase/migrations/20260818_fix_views_eudr_flags.sql` —
      confirmado: `GET /rest/v1/vw_monitoreo_web?select=area_calculada_ha,requiere_revision_area&limit=1`
      devuelve `200` con `{"area_calculada_ha": 4.1518, "requiere_revision_area": false}`
      — valores reales calculados, no solo la columna presente.
- [x] 4. `supabase/migrations/20260818_rls_multi_tenant_fortification.sql`
      — confirmado en dos partes: `GET /rest/v1/view_eudr_dashboard_aprobados?select=socio_dni&limit=1`
      devuelve `400` `{"code":"42703","message":"column view_eudr_dashboard_aprobados.socio_dni does not exist"}`
      (la columna PII fue removida); `GET .../view_eudr_dashboard_aprobados?select=*&limit=1`
      devuelve `200` con `[]` (la vista es alcanzable por `anon` pero el
      filtro `ID_Organizacion = auth_org_id()` correctamente no matchea
      ninguna fila sin una sesión real — aislamiento multi-tenant
      funcionando como se diseñó).
- [x] 5. `supabase/migrations/20260818_inspecciones_atomic_save.sql` —
      confirmado: `POST /rest/v1/rpc/fn_guardar_inspeccion_completa` con
      `p_organizacion: ''` (deliberado, para que la función aborte en su
      propia validación antes de escribir nada) devuelve `400`
      `{"code":"P0001","message":"No se pudo determinar la organización activa."}`
      — exactamente el mensaje de `RAISE EXCEPTION` de la función, confirma
      que existe y corre. Cero filas escritas (la excepción ocurre antes de
      cualquier INSERT/UPDATE).

**Pendiente, no verificable vía REST (requiere SQL Editor):**
- [ ] `SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_gist_eudr_%'`
      devuelve 3 filas — PostgREST no expone `pg_indexes` vía REST con la
      anon key; confirmar manualmente en Supabase Studio.

## 2. Certificación local — ejecutada en esta sesión

Comandos reales ejecutados en este entorno (no hay script `npm test` en
`package.json` — confirmado, solo `dev`/`build`/`start`/`lint` — se usó el
comando real equivalente):

- [x] `npm test` → falla con `npm error Missing script: "test"` (esperado,
      documentado desde la primera tarea de esta serie — no existe ese
      script en este proyecto).
- [x] `node --test tests/*.mjs` (suite JS real —
      `test_inspecciones_schema.mjs` + `test_trace_public.mjs`) →
      **24 passed, 0 failed**.
- [x] `python -m pytest tests/ -q` (suite Python completa) →
      **319 passed, 5 skipped** (skips: tests que requieren
      `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no disponibles en este
      entorno — mismo patrón desde el inicio del proyecto).
- [x] `npm run build` → `✓ Compiled successfully`, 9 rutas generadas sin
      errores.

## 3. Pruebas funcionales de UI — pendientes (requieren la instancia real)

No ejecutables desde este entorno (sin navegador conectado a Supabase Live
en esta sesión). Actualizado tras dos verificaciones reales de tareas
posteriores (Dossier PDF y esta verificación en vivo):

- [ ] `/dashboard/mapa` carga `vw_monitoreo_web` sin error de columna tras
      aplicar el ítem 3. No probado en navegador, pero la consulta REST
      equivalente (sección 1, ítem 3) ya confirmó que la columna existe y
      trae datos reales — falla improbable, no confirmada visualmente.
- [ ] `/dashboard/inspecciones/nueva` crea una inspección completa (7
      tablas) en una sola operación tras aplicar el ítem 5; forzar un error
      simulado (ej. quitar temporalmente un GRANT) y confirmar que NO queda
      ninguna fila huérfana en `INSPECCIONES` (prueba real de atomicidad,
      no reproducible con la suite estática de este repo). La RPC se
      confirmó existente y ejecutable (sección 1, ítem 5), pero no se
      probó una escritura real completa de las 7 tablas — deliberado,
      para no dejar datos de prueba en producción.
- [x] `/trace/[lot_hash]` con un hash real de un lote aprobado muestra el
      certificado sin datos PII visibles — **confirmado en la tarea
      anterior** (`specs/pdf_dossier_native_js.md`): se generó el Dossier
      PDF real para el hash `752ef9ab79645546` (organización
      `ORG-COOP-NORTE`, datos reales) y se inspeccionó visualmente sin
      ningún campo PII presente.
- [ ] `/` (dashboard legacy, `view_eudr_dashboard_aprobados`) sigue
      cargando sin error tras el ítem 4 — no probado en navegador. La
      consulta REST equivalente (sección 1, ítem 4) confirmó que la vista
      es alcanzable y no lanza error de columna faltante para las columnas
      que `app/page.jsx` sí usa; falta la verificación visual real.

## Referencias

- `docs/schema_live.md` — snapshot de schema y orden de migraciones.
- `docs/adr/ADR-001-gis-sanitization-and-eudr-triggers.md` — decisión de
  sanitización GIS.
- `specs/gis_core_reengineering.md`, `specs/fix_views_eudr_flags.md`,
  `specs/rls_multi_tenant_audit.md`, `specs/inspecciones_fed_audit.md`,
  `specs/trace_public_audit.md`, `specs/traces_eudr_dossier_audit.md`,
  `specs/pdf_dossier_native_js.md` — specs de cada tarea del día.
