# Plan de Ejecución — Consola QC 2.0

Ver spec: `specs/gis_qc_console_v2.md`.

## Pasos

1. **Verificación previa:** confirmado que la Consola QC ya existe
   completa (`lib/eudrQcActions.js`, `app/dashboard/qc/page.jsx`,
   `components/gis/QcConsoleMap.jsx`, 13 tests) — esto es una extensión.
   Confirmado que no existe `OBSERVADO` ni `descripcion`, que el
   multi-tenant + guard de 0 filas ya está implementado, y que `flyTo` ya
   existe (solo se mejora el punto objetivo a centroide real).
2. `lib/eudrQcActions.js`: agregar `EDITABLE_FIELDS`/`GEOM_COLUMN`,
   `updateRecordAttributes(supabase, record, attributes, organizationId)`
   y `updateRecordGeometry(supabase, record, geometry, organizationId)` —
   mismo patrón de guard que `approveRecord`/`rejectRecord`
   (`assertSameOrganization` + `resolveUpdateTarget` + `.match()` con
   `estado_revision: PENDING_STATE` + chequeo de 0 filas). Reutiliza
   `geoJsonToWkt` de `lib/geometryImport.js` para la geometría.
3. `components/gis/QcConsoleMap.jsx`: importar geoman dinámicamente
   (antes de `L.map(...)`, mismo motivo que en `MapDashboard.jsx`). Nuevas
   props `editingKey`/`onGeometryChange`: habilita/deshabilita `.pm` solo
   en la capa del registro en edición, reporta la geometría editada.
   Reemplaza `layer.getBounds().getCenter()` por `@turf/centroid` sobre la
   geometry parseada del registro seleccionado.
4. `app/dashboard/qc/components/QcDetailEditor.jsx` (nuevo): formulario de
   atributos reales por tabla + toggle de ajuste de geometría + motivo +
   Aprobar/Rechazar/Guardar Cambios. Reemplaza el panel inline de
   `page.jsx`.
5. `app/dashboard/qc/page.jsx`: estado nuevo (`editingGeometryKey`,
   `pendingGeometry`, borrador de atributos), handlers que llaman a las 2
   funciones nuevas, actualiza el registro en `records` in-place tras una
   corrección exitosa (a diferencia de aprobar/rechazar, que sí lo sacan
   de la lista).
6. `tests/test_qc_console_v2.mjs`: cobertura de las 2 funciones nuevas
   (whitelisting, guard PENDIENTE, guard multi-tenant, 0 filas, columna de
   geometría correcta por tabla) — mismo mock `makeFakeSupabase` que
   `tests/test_eudr_qc_actions.mjs` (duplicado localmente, mismo criterio
   que el resto de los tests `.mjs` del proyecto, cada archivo es
   autocontenido).
7. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -q`
   (sin regresión, no se tocó Python), parar dev server + `rm -rf .next` +
   `npm run build` + `rm -rf .next` + reiniciar `npm run dev`.
8. Smoke test en navegador si la herramienta coopera (cargar
   `/dashboard/qc`, revisar consola sin errores) — si `screenshot`/`zoom`
   vuelven a fallar de forma persistente (como en la tarea anterior), no
   insistir: verificar en su lugar contra el código fuente instalado de
   geoman y dejarlo documentado, igual que la vez pasada.
9. Commit a `main` (sin push).
