# Plan de Ejecución — Auditoría Ruta 1 TRACES UE + Dossier

Ver spec: `specs/traces_eudr_dossier_audit.md`.

## Pasos

1. **Auditoría (hecha antes de escribir código):**
   - Leer `app/dashboard/lotes/page.jsx`, `app/dashboard/mapa/page.jsx`,
     `components/gis/MapDashboard.jsx` (sección `handleExportDDS`),
     `lib/eudrDdsExporter.js` completo.
   - Confirmar que no existen Route Handlers (`find app -iname "route.js"`).
   - Grep de "dossier"/"Dossier" en `app/`, `lib/`, `components/` — 0
     resultados, confirma la desconexión del generador de Dossier PDF.
   - Leer `scripts/generate_dossier_pdf.py` y `scripts/generate_lot_qr.py`
     completos — confirmar que son clases Python puras sin
     `if __name__ == "__main__"`.
   - Confirmar que `grep exportTracesDDS` solo aparece en
     `lib/eudrDdsExporter.js` (definición) y `MapDashboard.jsx` (único
     consumidor) — `/dashboard/lotes` no lo usa.

2. **Sin cambios de código de producción** — la auditoría concluye que (a)
   y (b) ya están correctos, y que (c)/(d) son brechas de arquitectura que
   requieren una decisión del usuario antes de implementarse (no están en
   el alcance de archivos de esta tarea).

3. **Test nuevo** (`tests/test_eudr_dds_exporter.mjs`, `node --test`, mismo
   patrón sin dependencias nuevas): cubre `buildTracesPayload`,
   `resolveOrganizationId`, `validatePlotGeometry` (indirecto, vía
   `buildTracesPayload`) de `lib/eudrDdsExporter.js` — antes sin cobertura
   directa.

4. **Verificación**: `node --test tests/*.mjs` (100% passing, suite
   completa incluyendo los `.mjs` de tareas anteriores),
   `python -m pytest tests/ -q` (sin regresión), `npm run build`.

5. **Actualizar `docs/schema_live.md`**: nota breve señalando que
   `/dashboard/lotes` es una vista de simulación de QR, no el exportador
   DDS real (ese vive en `/dashboard/mapa`), y que el Dossier PDF no tiene
   punto de entrada desde la UI.

6. **Commit a `main`** (sin push).
