# Checklist de Verificación — Reingeniería Core RYZOS (2026-08-18)

**Alcance:** las 5 migraciones SQL escritas el 2026-08-18, la certificación
local (tests + build), y la verificación funcional en la instancia Supabase
en vivo (`jhtocgxlozfuzullrtol`).

**Nota de honestidad de estado:** este entorno de desarrollo no tiene
credenciales ni conexión directa a la instancia Supabase real — nunca la
tuvo, en ninguna tarea del día (ver el encabezado de cada migración). Por
eso los ítems de la sección 1 (aplicación en Supabase) y 3 (pruebas
funcionales de UI contra datos reales) están **marcados como pendientes**,
no como completados — solo `dneyser5@gmail.com` (o quien tenga acceso al
SQL Editor de Supabase Studio) puede marcarlos. Los ítems de la sección 2
(certificación local) sí se ejecutaron en esta sesión y se documentan con
su resultado real.

## 1. Migraciones SQL — aplicación en Supabase (`jhtocgxlozfuzullrtol`)

**Ninguna de las 5 confirmada aplicada.** Orden de aplicación obligatorio
(dependencias entre archivos, ver `docs/schema_live.md`):

- [ ] 1. `supabase/migrations/20260818_fix_inspecciones_rls.sql` — políticas
      `anon` para `INSPECCIONES`/`CAP_*` + lectura de padrón. **Debe ir
      primero**: `20260818_inspecciones_atomic_save.sql` (ítem 5) depende
      de que estas políticas ya existan (la función RPC nueva no usa
      `SECURITY DEFINER`, corre con los mismos privilegios que ya otorgan
      estas políticas).
- [ ] 2. `supabase/migrations/20260818_gis_core_sanitization.sql` —
      sanitización de geometría, cálculo de área, índices GiST. **Debe ir
      antes que el ítem 3** (crea las columnas `area_calculada_ha`/
      `requiere_revision_area` que el ítem 3 expone en las vistas).
- [ ] 3. `supabase/migrations/20260818_fix_views_eudr_flags.sql` — expone
      `area_calculada_ha`/`requiere_revision_area` en
      `vw_monitoreo_poligonos/puntos/web`.
- [ ] 4. `supabase/migrations/20260818_rls_multi_tenant_fortification.sql`
      — re-certificación RLS Zero-Trust (`ORGANIZACIONES`/`EUDR_*`) + fix
      de fuga PII/cross-tenant en `view_eudr_dashboard_aprobados`. **Sin
      dependencia de orden estricta con 2/3**, pero se recomienda aplicar
      después de confirmar que 2/3 no rompieron nada.
- [ ] 5. `supabase/migrations/20260818_inspecciones_atomic_save.sql` —
      función `fn_guardar_inspeccion_completa` (guardado atómico del
      formulario de Inspecciones). Requiere el ítem 1 ya aplicado.

**Verificación post-aplicación sugerida (a correr en el SQL Editor tras
cada ítem, no verificable desde este entorno):**
- [ ] `SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_gist_eudr_%'`
      devuelve 3 filas (ítem 2).
- [ ] `SELECT area_calculada_ha, requiere_revision_area FROM vw_monitoreo_web LIMIT 1`
      no lanza error de columna inexistente (ítem 3).
- [ ] `SELECT socio_dni FROM view_eudr_dashboard_aprobados LIMIT 1` lanza
      error de columna inexistente — confirma que la PII ya no se expone
      (ítem 4).
- [ ] Crear una inspección de prueba desde `/dashboard/inspecciones/nueva`
      y confirmar que las 6 filas `CAP_*` correspondientes existen con el
      mismo `ID_Inspeccion` (ítem 5).

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
en esta sesión). Pendientes para quien aplique las migraciones:

- [ ] `/dashboard/mapa` carga `vw_monitoreo_web` sin error de columna tras
      aplicar el ítem 3.
- [ ] `/dashboard/inspecciones/nueva` crea una inspección completa (7
      tablas) en una sola operación tras aplicar el ítem 5; forzar un error
      simulado (ej. quitar temporalmente un GRANT) y confirmar que NO queda
      ninguna fila huérfana en `INSPECCIONES` (prueba real de atomicidad,
      no reproducible con la suite estática de este repo).
- [ ] `/trace/[lot_hash]` con un hash real de un lote aprobado muestra el
      certificado sin datos PII visibles en el HTML servido (`view-source`).
- [ ] `/` (dashboard legacy, `view_eudr_dashboard_aprobados`) sigue
      cargando sin error tras el ítem 4 (la vista perdió 2 columnas PII que
      `app/page.jsx` no usaba — confirmado en `docs/schema_live.md`, pero
      vale la pena una verificación visual real).

## Referencias

- `docs/schema_live.md` — snapshot de schema y orden de migraciones.
- `docs/adr/ADR-001-gis-sanitization-and-eudr-triggers.md` — decisión de
  sanitización GIS.
- `specs/gis_core_reengineering.md`, `specs/fix_views_eudr_flags.md`,
  `specs/rls_multi_tenant_audit.md`, `specs/inspecciones_fed_audit.md`,
  `specs/trace_public_audit.md` — specs de cada tarea del día.
