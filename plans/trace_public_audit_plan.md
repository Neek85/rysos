# Plan de Ejecución — Auditoría Portal Público de Trazabilidad

Ver spec: `specs/trace_public_audit.md`.

## Pasos

1. **Auditoría (hecha antes de escribir código):**
   - Leer `app/trace/[lot_hash]/page.jsx`, `lib/traceabilityHash.js`,
     `lib/eudrDdsExporter.js`, `lib/qrGenerator.js`,
     `components/gis/PublicLotMap.jsx` completos.
   - Grep exhaustivo de `console.*` en los 5 archivos de arriba.
   - Confirmar que `page.jsx` es un Server Component (sin `'use client'`) —
     condición necesaria para que el fetch multi-organización sea seguro.
   - Comparar `generateLotHash()`/`buildPublicSanitizedPayload()` (JS)
     línea por línea contra `generate_lot_hash()`/
     `build_public_sanitized_payload()` (Python,
     `scripts/generate_lot_qr.py`) — encontrado: divergencia en el fallback
     `id_monitoreo`/`id_parcela` y en el contenido de `PII_FIELDS` (ver
     spec, sección (a)) — no explotable hoy, documentada.
   - Confirmar contra `tests/test_tarea14_trazabilidad.py` que el script
     Python nunca se ejercita con la forma de payload real de
     `vw_monitoreo_web` (sus fixtures siempre incluyen `id_monitoreo`).

2. **Sin cambios de código en `app/trace/[lot_hash]/`, `lib/traceabilityHash.js`,
   `lib/eudrDdsExporter.js`, `lib/qrGenerator.js`, `components/gis/PublicLotMap.jsx`**
   — la auditoría no encontró ningún gap real dentro del alcance de
   archivos pedido (los 3 criterios ya estaban correctamente implementados).

3. **Test nuevo** (`tests/test_trace_public.mjs`, `node --test`, mismo
   patrón que `tests/test_inspecciones_schema.mjs` — sin dependencias
   nuevas): cubre `generateLotHash`/`buildPublicSanitizedPayload`/
   `getTraceUrl` de `lib/traceabilityHash.js` con payloads válidos e
   inválidos, determinismo del hash, y remoción de los 6 campos PII.

4. **Verificación**: `node --test tests/test_trace_public.mjs` (100%
   passing), `python -m pytest tests/ -q` (sin regresión), `npm run build`
   (compila sin errores).

5. **Actualizar `docs/schema_live.md`**: documentar la auditoría, su
   resultado (sin gaps en el alcance pedido) y la discrepancia
   Python/JS encontrada como riesgo latente documentado.

6. **Commit a `main`** (sin push).
