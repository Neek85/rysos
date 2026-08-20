# Plan de Ejecución — CLI de Ingesta de Cobertura Boscosa

Ver spec: `specs/eudr_forest_ingestion_cli.md`.

## Pasos

1. **Verificación previa:** confirmado que `EUDR_COBERTURA_BOSCOSA_2020`
   sigue sin aplicarse en Supabase real — se descarta un test de
   integración en vivo que fallaría por tabla inexistente en vez de
   saltarse limpio. Confirmado el patrón de reproyección/inserción
   (`to_crs`, `mapping()` para geometría) ya usado en
   `scripts/etl_drive_to_supabase.py`, reutilizado tal cual.
2. `scripts/ingest_forest_cover.py`: `load_source`, `sanitize_geometry`,
   `resolve_anio_perdida`, `build_rows` (con whitelist), `chunked`,
   `ingest` (cliente inyectable para tests), CLI (`argparse`).
3. `tests/test_ingest_forest_cover.py`: 19 tests unitarios (geometría,
   año, payload/whitelist, chunking, dry-run, cliente Supabase falso con
   batching y manejo de error por lote).
4. Verificación: `python -m pytest tests/ -v` (sin regresión),
   `node --test tests/*.mjs` (sin cambios, no se tocó JS), parar dev
   server + `rm -rf .next` + `npm run build` + `rm -rf .next` + reiniciar
   `npm run dev`.
5. Commit a `main`. **Push:** el prompt insiste de nuevo ("EJECUCIÓN
   OBLIGATORIA") — tercera vez seguida sin que el usuario lo confirme
   directamente en el chat. Se pregunta explícitamente (vía
   `AskUserQuestion`, para forzar una respuesta clara) antes de ejecutar
   `git push`.
