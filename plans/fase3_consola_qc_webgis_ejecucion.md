# PLAN DE EJECUCIÓN: Consola de Auditoría QC WebGIS (`/dashboard/qc`)

## 1. Pasos de Desarrollo
1. **`lib/eudrQcActions.js`:**
   - `fetchPendingRecords(supabase)` — consulta `vw_monitoreo_poligonos` +
     `vw_monitoreo_puntos` filtrando `estado_revision = 'PENDIENTE'`, fusiona
     ambos resultados client-side (Supabase no soporta `UNION` entre vistas
     en una sola llamada `.from()`).
   - `approveRecord` / `rejectRecord` — resuelven la tabla base + condición
     `WHERE` real por `tabla_origen` y ejecutan el `UPDATE` correspondiente.
   - Reutiliza `resolveOrganizationId` de `lib/eudrDdsExporter.js` (misma
     lógica de resolución/validación multi-tenant que el exportador DDS, sin
     duplicarla).
2. **`components/layout/DashboardSidebar.jsx`:** nav modular con 4
   categorías; solo `GIS & EUDR` tiene rutas reales (`/dashboard/mapa`,
   `/dashboard/qc`) hasta que existan las demás.
3. **`app/dashboard/layout.jsx`:** envuelve las rutas `/dashboard/*` con el
   sidebar (flex row, sidebar fijo + contenido). Ajuste menor en
   `app/dashboard/mapa/page.jsx` para no competir por el alto de viewport
   con el nuevo layout (`min-h-screen` se mueve al layout).
4. **`components/gis/QcConsoleMap.jsx`:** mapa Leaflet dedicado a la
   consola — un solo `layerGroup` con las geometrías PENDIENTE ya
   filtradas por capa, estilo por `tabla_origen`, resaltado + `flyTo` del
   registro seleccionado vía props (`records`, `selectedKey`, `onSelect`).
5. **`app/dashboard/qc/page.jsx`:** selector de capa, lista lateral,
   panel de decisión (textarea de motivo + botones Aprobar/Rechazar) y
   toast de resultado, siguiendo el mismo patrón de estado
   (loading/error/toast) ya usado en `components/gis/MapDashboard.jsx`.
6. **Verificación:** `Remove-Item -Recurse -Force .next` + `npm run build`
   (deteniendo cualquier `next dev` activo primero — la corrupción de
   `.next` por build+dev concurrentes ya se documentó en sesiones
   anteriores).

## 2. Plan de Rollback
- Todas las escrituras son `UPDATE`s reversibles sobre `estado_revision`
  (nunca `DELETE`). Para revertir una decisión aplicada por error desde la
  consola:
  ```sql
  UPDATE public."EUDR_MONITOREO"    SET estado_revision = 'PENDIENTE' WHERE id_monitoreo = '<uuid>';
  UPDATE public."EUDR_USO_SUELO"    SET estado_revision = 'PENDIENTE' WHERE fid = <fid> AND "ID_Organizacion" = '<org>';
  UPDATE public."EUDR_INSTALACIONES" SET estado_revision = 'PENDIENTE' WHERE fid = <fid> AND "ID_Organizacion" = '<org>';
  ```
- El registro reaparece de inmediato en la consola (sin caché intermedia)
  y desaparece de `vw_monitoreo_web`/el Dashboard aprobado en el mismo
  instante, sin requerir recargas ni procesos batch.
- No se modifican las vistas de auditoría (`vw_monitoreo_poligonos`/
  `vw_monitoreo_puntos`) ni `vw_monitoreo_web` — este módulo es
  exclusivamente frontend + `UPDATE`s sobre las tablas base ya existentes.
