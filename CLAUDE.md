# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Python (backend/ETL/GIS scripts + tests)

```bash
pip install -r requirements.txt        # geopandas/shapely/fiona need GDAL installed (see .github/workflows/test_and_deploy.yml)
python -m pytest tests/ -v             # full suite
python -m pytest tests/test_fase2_etl.py -v                          # single file
python -m pytest tests/test_fase2_etl.py::TestClassName::test_name   # single test
```

Tests that require a live Supabase connection are decorated with a
`@pytest.mark.skipif` gate on `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` env
vars (see `NEEDS_SUPABASE` in e.g. `tests/test_fase1_sdd.py`,
`tests/test_gis_core_sanitization.py`) and skip automatically without
credentials — this is expected locally; CI supplies them via GitHub Secrets.

### Frontend (Next.js)

```bash
npm run dev      # dev server
npm run build
npm run start
npm run lint
```

No Jest/Vitest/Playwright is installed, and there is no `npm test` script —
verify UI changes with `npm run build` + `npm run dev`. A handful of pure
`lib/*.js` modules (currently the Padrón CSV/validation helpers) do have
unit tests under `tests/*.mjs`, run with Node's built-in test runner:
`node --test tests/*.mjs` (11 files, 177 tests as of 2026-08-19). **These
are not wired into CI** — `.github/workflows/test_and_deploy.yml` only runs
`python -m pytest tests/ -v --tb=short`, so a regression in one of those
`lib/` files would not fail the pipeline today.

### Database (Supabase PostGIS)

Migrations live in `supabase/migrations/*.sql` as plain, idempotent SQL
(`CREATE OR REPLACE`, `DROP ... IF EXISTS`, `ADD COLUMN IF NOT EXISTS`, wrapped
in `BEGIN;`/`COMMIT;`). There is no Supabase CLI project linked and no live
Postgres connection available from a normal dev session — migrations are
written here and applied manually in the Supabase Studio SQL Editor.

## Architecture

RYZOS is an EUDR (EU Regulation 2023/1115) coffee traceability system: two
largely independent codebases share one Supabase PostGIS database.

- **Next.js frontend** (`app/`, `components/`, `lib/` — plain `.jsx`/`.js`,
  no TypeScript, no `src/`) reads/writes Supabase directly from the browser
  via `lib/supabaseClient.js` (`getSupabaseClient()`, lazy singleton, **anon
  key only — there is no Supabase Auth session anywhere in this repo**).
- **Python scripts** (`scripts/`) run standalone (ETL ingestion, QGIS QC
  actions, EUDR DDS/report generation, satellite prevalidation, overlap
  detection) — not exposed as API routes; they are invoked directly against
  Supabase using service-role credentials.

### RLS / multi-tenant gotcha (non-obvious, read before touching security)

Row-level security policies scoped to `authenticated` (via
`public.auth_org_id()`, extracting the `ID_Organizacion` JWT claim — see
`supabase/migrations/20260816_fase3_seguridad_rls.sql`) **do not apply to the
frontend's real traffic**, because the frontend never authenticates — it only
carries the anon key. Reads work anyway because the consolidated views
(`vw_monitoreo_web`, etc.) execute with their owner's privileges (`postgres`),
not the querying role's. A direct `SELECT` against a base table like
`PADRON_PARCELAS` with the anon key returns zero rows; going through the view
works. The `INSPECCIONES`/`CAP_*` module (Fase 6) writes directly to base
tables with the anon key, so it needed separate `anon`-scoped policies (see
`supabase/migrations/20260818_fix_inspecciones_rls.sql` for the full
reasoning) — don't assume the `authenticated`-only pattern from earlier
migrations covers every table.

### Core spatial tables and the consolidated views

- `EUDR_MONITOREO` (geometry can be Point *or* Polygon depending on how the
  QField technician captured it — routing between the two uses
  `ST_Dimension()`, not the source table), `EUDR_USO_SUELO`, `EUDR_INSTALACIONES`
  — the "GIS core". None of these tables have a `CREATE TABLE` in the
  migration history (created outside this repo); migrations only alter them.
- `PADRON_SOCIOS` / `PADRON_PARCELAS` — master data (producers/parcels),
  joined in for display fields (`parcela_codigo`, `parcela_nombre`, area).
- `vw_monitoreo_poligonos` / `vw_monitoreo_puntos` — QGIS Desktop audit views,
  `UNION ALL` across the three GIS-core tables, explicit
  `geometry(MultiPolygon,4326)` / `geometry(Point,4326)` casts on every branch
  (required so QGIS resolves type/SRID from the catalog without prompting to
  "repair" the layer).
- `vw_monitoreo_web` — the only view the Dashboard (`components/gis/MapDashboard.jsx`)
  reads; filters strictly to `estado_revision = 'APROBADO'` and adds
  `geom_geojson` (`ST_AsGeoJSON`) since PostgREST otherwise serializes
  `geometry` as raw WKB hex.
- `view_eudr_dashboard_aprobados` — an older Fase 1 view (different column
  names: `parcela_codigo`/`hectareas_totales`/`socio_nombre_completo`) still
  used by `app/page.jsx`. It is a separate, legacy line of work from
  `vw_monitoreo_web` — do not conflate the two when a column appears to be
  "missing" from one or the other.

### Padrón module (`/dashboard/socios`) — write path and logical delete

`PADRON_SOCIOS`/`PADRON_PARCELAS` only grant `anon` `SELECT` (deliberate,
see the RLS gotcha above) — writes go through Next.js Server Actions
(`lib/actions/sociosActions.js`, `'use server'`) using
`lib/supabaseServerClient.js` (Service Role Key, never imported from a
`'use client'` file). Because the Service Role Key bypasses RLS,
multi-tenant isolation is enforced explicitly in that file
(`assertMatchesExistingOrg`, `assertParcelaMatchesOrg`,
`assertSocioExists`) rather than by a policy. Deactivating a record
(`activo = false`, never a physical `DELETE` — the padrón is shared live
with another repo and IDs may be referenced from `INSPECCIONES`/
`EUDR_MONITOREO` without a real FK) cascades from socio to that socio's
parcelas (`deactivateSocio`) but deliberately stops there — it does not
touch `EUDR_MONITOREO` or any EUDR/WebGIS view, so monitoring history
survives a producer leaving the padrón. CSV bulk import
(`lib/padronCsv.js`) pre-validates rows against the live DB in the preview
step (`applySocioDbChecks`/`applyParcelaDbChecks`) before the same checks
run again at write time. See `specs/padron_web_socios.md` and
`docs/adr/ADR-002-padron-enterprise-y-baja-cascada.md` for the full
rationale.

These views select explicit column lists (never `SELECT *`), so any new
column added to a base table (e.g. `area_calculada_ha`,
`requiere_revision_area`) needs its own migration to actually surface in the
views — check `docs/schema_live.md` and `docs/adr/` before assuming a base
table column is visible to the frontend.

### Data ingestion

`scripts/etl_drive_to_supabase.py` ingests QField GeoPackage exports from a
tenant-first Google Drive folder layout:
`RYZOS_CLIENTES/{ID_Organizacion}/RYZOS_INBOX/*.zip` → processed →
`RYZOS_CLIENTES/{ID_Organizacion}/RYZOS_ARCHIVE/PROCESADO_...zip`. Field data
column/layer names vary by QField form version, so lookups go through
candidate-list resolvers rather than fixed names.

### Documentation of DB state

`docs/schema_live.md` is a manually maintained snapshot of the live schema
(no `npm run sync-schema` or equivalent exists) — regenerate it by reading
`supabase/migrations/*.sql` in order after any migration change.
Architecture-level decisions about the GIS core are recorded as ADRs under
`docs/adr/`.

## Workflow convention (SDD)

New modules are delivered as four artifacts, in order: `specs/<module>.md`
(invariants, acceptance criteria) → `plans/<module>_plan.md` (execution
sequence) → implementation (`scripts/<module>.py` or a migration under
`supabase/migrations/`) → `tests/test_<module>.py`. Run the full test suite
and report the pass count after each module.
