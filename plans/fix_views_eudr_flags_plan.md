# Plan de Ejecución — Cierre de brecha vistas EUDR

Ver spec: `specs/fix_views_eudr_flags.md`.

## Pasos

1. Releer `supabase/migrations/20260817_refine_vw_monitoreo_web.sql` (versión
   vigente de las 3 vistas) para partir de la definición exacta actual, no de
   una versión desactualizada.
2. Escribir `supabase/migrations/20260818_fix_views_eudr_flags.sql`:
   `DROP VIEW ... CASCADE` + `CREATE VIEW` para las 3 vistas, agregando
   `area_calculada_ha`/`requiere_revision_area` a cada rama del `UNION ALL`,
   sin tocar el resto de columnas/joins/filtros.
3. Actualizar `tests/test_gis_core_sanitization.py::TestViewIntegrationGap`:
   invertir la aserción (ahora debe confirmar que las columnas SÍ están
   presentes en la migración de vistas vigente), y renombrar la clase/docstring
   para reflejar que el gap está cerrado.
4. Correr `pytest tests/ -v` y confirmar 100% passing.
5. Actualizar `docs/schema_live.md` (quitar el aviso de gap, documentar las
   columnas nuevas en las 3 vistas) y `docs/adr/ADR-001-gis-sanitization-and-eudr-triggers.md`
   (agregar sección de seguimiento indicando que el gap se cerró, con fecha y
   referencia a la nueva migración — no reescribir el ADR original, un ADR
   se complementa con un addendum, no se reescribe su decisión histórica).
6. Commit a `main` (sin push).
