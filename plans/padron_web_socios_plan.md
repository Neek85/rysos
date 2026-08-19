# Plan de Ejecución — Padrón Web Activo de Socios y Fincas

Ver spec: `specs/padron_web_socios.md`.

## Pasos

1. **Auditoría previa (hecha antes de escribir código):** consultar
   `PADRON_SOCIOS`/`PADRON_PARCELAS` en vivo con la anon key (solo
   lectura) para confirmar columnas reales — reveló que no existe
   `sector` y que `geom` suele ser `null`. Confirmar con el usuario 3
   decisiones bloqueantes (escritura vía Server Actions, filtros con
   `cert_org_estatus`+flags, carga de geometría por archivo) antes de
   diseñar el resto.
2. `npm install @tmcw/togeojson @xmldom/xmldom` (parseo KML→GeoJSON).
3. `lib/geometryImport.js` — funciones puras: `parseGeoJson(text)`,
   `parseKml(text)`, `parseCsvPoints(text)`, todas devuelven un `geometry`
   GeoJSON o lanzan un error legible. Testeable con `node --test` sin red.
4. `lib/validations/socios.js` — Zod: `socioSchema` (DNI, nombre,
   geografía, 8 flags de certificación) y `parcelaSchema` (código, nombre,
   hectáreas por categoría, vínculo a socio).
5. `lib/supabaseServerClient.js` — cliente Supabase server-only con
   `SUPABASE_SERVICE_ROLE_KEY`, falla con mensaje claro si la env var no
   está. Nunca importado desde `'use client'` (verificar con grep al
   final).
6. `lib/actions/sociosActions.js` — Server Actions (`'use server'`):
   `createSocio`, `updateSocio`, `createParcela`, `updateParcela`.
   Verificación multi-tenant explícita (mismo patrón que
   `saveInspeccion`), llamada a `fn_sanitize_geometry` antes de guardar
   geometría de parcela.
7. `app/dashboard/socios/page.jsx` + `components/features/socios/*`
   (tabla, filtros, `SocioFormModal`, `ParcelaFormModal`,
   `GeometryUploadField`) — sigue las convenciones de
   `components/features/inspecciones/*` (FormField, react-hook-form +
   zodResolver, toasts locales).
8. Conectar el placeholder "Productores y Parcelas" del sidebar a
   `/dashboard/socios`.
9. Tests: `tests/test_geometry_import.mjs`, `tests/test_socios_schema.mjs`
   (`node --test`, mismo patrón sin dependencias de testing nuevas).
10. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -q`
    (sin regresión), `npm run build`. Grep de
    `lib/supabaseServerClient.js` para confirmar que no lo importa ningún
    archivo `'use client'` (AC4).
11. Actualizar `docs/schema_live.md`: documentar el schema real completo
    de `PADRON_SOCIOS`/`PADRON_PARCELAS` (antes solo parcialmente
    documentado), la arquitectura Server Actions, y el requisito de
    `SUPABASE_SERVICE_ROLE_KEY` no satisfecho.
12. Commit a `main` (sin push).
