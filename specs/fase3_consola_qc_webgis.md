# SPEC: Consola de Auditoría QC WebGIS (`/dashboard/qc`)

## 0. Nota de origen
Este spec no existía en el repositorio al momento de pedirse esta tarea —
`plans/fase3_ejecucion.md` (Fase 3 original) documenta un módulo distinto y
ya completado: la consola de auditoría en **QGIS Desktop**
(`specs/fase3_qgis_qc.md`, `scripts/qgis_qc_actions.py`). Este documento
cubre su contraparte **WebGIS** (navegador), un módulo nuevo — ver
`plans/fase3_consola_qc_webgis_ejecucion.md` para el plan de ejecución
asociado.

## 1. Objetivo
Permitir a un revisor QC aprobar o rechazar, desde el navegador, los
registros con `estado_revision = 'PENDIENTE'` de las tres tablas de campo
(`EUDR_MONITOREO`, `EUDR_USO_SUELO`, `EUDR_INSTALACIONES`), con selector de
capa, lista lateral y un mapa interactivo que hace `flyTo` a la geometría
del registro seleccionado — sin depender de QGIS Desktop.

## 2. Invariantes
- **Fuente de datos = vistas de auditoría, no `vw_monitoreo_web`:**
  `vw_monitoreo_web` filtra `estado_revision = 'APROBADO'` en su propia
  definición (`supabase/migrations/20260816_fase2_vistas_qc.sql`) — es
  estructuralmente incapaz de devolver PENDIENTE. La consola consulta
  `vw_monitoreo_poligonos` y `vw_monitoreo_puntos` (que exponen los 3
  estados) filtrando `estado_revision = 'PENDIENTE'` del lado del cliente.
- **Nunca se escribe sobre una vista:** las vistas de auditoría son de solo
  lectura. Aprobar/Rechazar ejecuta `UPDATE` directo sobre la tabla base
  real detrás de `tabla_origen`.
- **Identificador real por tabla, no el UUID sintético:** `id_monitoreo` es
  la PK real solo para `EUDR_MONITOREO`. Para `EUDR_USO_SUELO`/
  `EUDR_INSTALACIONES`, `vw_monitoreo_puntos` no expone su columna `id` real
  (a diferencia de `vw_monitoreo_poligonos`, que sí expone `id_origen`) —
  se usa `registro_id` (= `fid`) + `ID_Organizacion` como condición
  `WHERE`, el mismo par que ya usa `resolve_upsert_conflict_target()` en
  `scripts/etl_drive_to_supabase.py` como target de upsert idempotente.
- **Transición Idempotente:** todo `UPDATE` incluye `estado_revision =
  'PENDIENTE'` en el `WHERE`/`.match()`, igual que
  `get_approve_action_sql`/`get_reject_action_sql` en el script QGIS — una
  segunda aprobación sobre un registro ya procesado no tiene efecto.
- **Rechazo Siempre Motivado:** `Rechazar` exige un motivo no vacío,
  anexado a `observaciones` con el mismo formato de sufijo que el flujo
  QGIS (`" [RECHAZADO QC: <motivo>]"`), para que ambos caminos de auditoría
  dejen un rastro consistente.
- **`actualizado_en` solo en `EUDR_MONITOREO`:** es la única de las tres
  tablas con esa columna confirmada (usada ya en `qgis_qc_actions.py`); no
  se asume su existencia en `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` sin
  verificar contra el schema real primero.
- **Aislamiento Multi-Tenant:** además de RLS (autoritativo del lado de
  Supabase), el cliente verifica `record.ID_Organizacion` contra la
  organización resuelta de los registros ya cargados antes de ejecutar
  cualquier `UPDATE` — mismo patrón de defensa en profundidad que
  `lib/eudrDdsExporter.js`.
- **Sidebar Nuevo, Aislado a `/dashboard`:** el layout con sidebar modular
  (`GIS & EUDR`, `Padrón`, `Acopio`, `Comercialización`) vive en
  `app/dashboard/layout.jsx`, no en el `app/layout.jsx` raíz — este último
  también envuelve `app/page.jsx` (dashboard viejo, schema distinto) y
  `app/trace/[lot_hash]` (página **pública** de trazabilidad), que no deben
  mostrar navegación interna de la organización.
- **Categorías sin Página Aún = Deshabilitadas, No Rotas:** `Padrón`,
  `Acopio` y `Comercialización` no tienen rutas implementadas todavía — el
  sidebar las muestra como entradas no clicables ("Próximamente") en vez de
  enlaces a páginas inexistentes.

## 3. Criterios de Aceptación
- [ ] `/dashboard/qc` lista los registros `PENDIENTE` de las tres tablas,
      con selector de capa (Todos / Monitoreos / Uso de Suelo /
      Instalaciones) que filtra la lista y el mapa sin volver a consultar
      Supabase.
- [ ] Seleccionar un registro de la lista ejecuta `flyTo` sobre su
      geometría en el mapa y resalta su estilo.
- [ ] "Aprobar" ejecuta `UPDATE` con `estado_revision = 'APROBADO'` sobre
      la tabla base correcta y retira el registro de la lista al éxito.
- [ ] "Rechazar" sin motivo queda deshabilitado; con motivo, ejecuta
      `UPDATE` con `estado_revision = 'RECHAZADO'` y el sufijo de
      auditoría en `observaciones`.
- [ ] Un registro cuyo `ID_Organizacion` no coincide con la organización
      resuelta de la sesión nunca puede aprobarse/rechazarse desde la UI
      (lanza error antes de llamar a Supabase).
- [ ] El sidebar (`components/layout/DashboardSidebar.jsx`) muestra las 4
      categorías modulares y resalta la ruta activa; aparece en
      `/dashboard/mapa` y `/dashboard/qc`, no en `/` ni `/trace/[lot_hash]`.
- [ ] `npm run build` compila sin errores.
