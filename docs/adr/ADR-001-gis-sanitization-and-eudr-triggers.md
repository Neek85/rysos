# ADR-001 — Sanitización Espacial GIS Core y Triggers EUDR

- **Estado:** Aceptado
- **Fecha:** 2026-08-18
- **Migración:** `supabase/migrations/20260818_gis_core_sanitization.sql`
- **Spec:** `specs/gis_core_reengineering.md`
- **Tests:** `tests/test_gis_core_sanitization.py`

## Contexto

`EUDR_MONITOREO`, `EUDR_USO_SUELO` y `EUDR_INSTALACIONES` reciben geometrías
desde dos vías sin garantías de calidad: el ETL de QField
(`scripts/etl_drive_to_supabase.py`) y ediciones manuales en QGIS Desktop
sobre `vw_monitoreo_poligonos`/`vw_monitoreo_puntos` (Tarea 8.1). Ninguna de
las dos garantizaba SRID consistente, validez topológica, ni precisión de
coordenadas acotada. Tampoco existía ningún índice GiST en todo el historial
de migraciones del proyecto — confirmado por búsqueda exhaustiva —, lo que
implica table scan completo en cualquier filtro espacial (`ST_Intersects`,
el bounding-box del mapa en `components/gis/MapDashboard.jsx`).

## Decisión

1. **Sanitización de geometría es incondicional e implementada en escritura**
   (`BEFORE INSERT OR UPDATE OF <col_geom>`), no en lectura. `fn_sanitize_geometry()`
   fuerza SRID 4326 (`ST_SetSRID`/`ST_Transform` según corresponda), repara
   topología con `ST_MakeValid`, y redondea coordenadas a 6 decimales
   (`ST_SnapToGrid`, ~11 cm de precisión). Se aplica en las 3 tablas base vía
   `trg_sanitize_geom_monitoreo/uso_suelo/instalaciones`.
2. **La validación de área ≥ 4.0 ha es informativa, nunca bloqueante.**
   `fn_calcular_area_ha()` calcula área geodésica real (`geography`, no grados
   planos) y el trigger la guarda en `area_calculada_ha`, marcando
   `requiere_revision_area = true` si es menor a 4.0 ha. **No existe ningún
   `RAISE EXCEPTION` atado a esta regla** — confirmado explícitamente con el
   usuario antes de implementar. Un rechazo duro habría roto la ingesta de
   fincas reales de pequeños productores cafetaleros, el caso de uso central
   de RYZOS; EUDR tampoco define 4 ha como mínimo de registro (ese umbral
   existe en el reglamento para otro propósito — debida diligencia
   simplificada de operadores grandes, no como filtro de admisión de
   parcelas).
3. Geometrías puntuales (`ST_Dimension = 0`) no tienen área:
   `area_calculada_ha`/`requiere_revision_area` quedan en `NULL`, no en
   `false` — evita que un punto se interprete como "parcela sin área
   suficiente".
4. Se agregan los primeros índices GiST del proyecto
   (`idx_gist_eudr_monitoreo_geom`, `idx_gist_eudr_uso_suelo_geom`,
   `idx_gist_eudr_instalaciones_geom`) más índices btree sobre
   `"ID_Organizacion"` en las 3 tablas, para soportar tanto filtros
   espaciales como el filtro multi-tenant de RLS/vistas.
5. La migración incluye un backfill retroactivo (`UPDATE ... SET geom = geom`)
   que reutiliza el propio trigger para sanitizar todas las filas ya
   existentes, evitando duplicar la lógica de saneo fuera del trigger.

## Validación de integración con `vw_monitoreo_web` (esta tarea)

Se auditó `supabase/migrations/20260816_fase2_vistas_qc.sql` y
`20260817_refine_vw_monitoreo_web.sql` línea por línea contra la migración de
sanitización:

- **Geometría: integración correcta, sin cambios necesarios.** El trigger
  sanitiza en escritura, así que `geom_inspeccion`/`geom` en la tabla base ya
  llegan limpios (SRID 4326, válidos, redondeados) antes de que
  `vw_monitoreo_poligonos`/`vw_monitoreo_puntos`/`vw_monitoreo_web` los lean.
  El `ST_Transform(geom, 4326)` que hacen esas vistas sobre un dato que ya
  está en 4326 es un no-op seguro (PostGIS no reproyecta si el SRID origen y
  destino coinciden) — no hay conflicto ni doble transformación con costo.
- **Gap real encontrado — `area_calculada_ha`/`requiere_revision_area` NO se
  exponen en ninguna vista.** Las 3 vistas seleccionan columnas explícitas
  (no `SELECT *`), y ninguna incluye las dos columnas nuevas de esta
  migración. Hoy son invisibles tanto para el Dashboard Web
  (`MapDashboard.jsx`) como para QGIS Desktop. Es un gap real, no un bug: la
  migración de sanitización (2026-08-18) se escribió y aplicó después de que
  las vistas ya estaban congeladas en su forma actual, y agregar columnas a
  una vista no estaba en el alcance de esa tarea.

## Consecuencias

- Positivo: ningún dato espacial nuevo puede quedar con SRID incorrecto,
  topología inválida, o precisión de punto flotante sin acotar. Los filtros
  espaciales ahora pueden usar el índice GiST en vez de table scan.
- Positivo: la ingesta de parcelas pequeñas reales sigue funcionando sin
  fricción — el hallazgo de área insuficiente queda registrado, no bloquea.
- Pendiente (fuera de alcance de esta tarea, requiere una migración de vistas
  nueva si se decide abordarlo): exponer `area_calculada_ha` y
  `requiere_revision_area` en `vw_monitoreo_web` para que el Dashboard pueda
  mostrar el flag de revisión al usuario QC. Mientras tanto, esas dos
  columnas solo son consultables directamente contra las tablas base
  (`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`).
- Pendiente: la migración `20260818_gis_core_sanitization.sql` no se ha
  confirmado aplicada contra la instancia Supabase `jhtocgxlozfuzullrtol` —
  este entorno no tiene credenciales ni conexión Postgres directa. Requiere
  ejecución manual en el SQL Editor de Supabase Studio.

## Alternativas consideradas

- **Rechazar geometrías < 4 ha con `RAISE EXCEPTION`:** descartada — ver
  decisión 2. Habría requerido además decidir qué hacer con
  `EUDR_INSTALACIONES` (puntos, sin área) y con parcelas legítimamente
  pequeñas, sin ningún beneficio de negocio confirmado.
- **Sanitizar en las vistas (`SELECT fn_sanitize_geometry(geom) ...`) en vez
  de en triggers de escritura:** descartada — recalcularía la sanitización en
  cada lectura (costo repetido) y no dejaría la tabla base limpia para
  consultas fuera de las vistas (ej. `scripts/detect_overlaps.py`,
  `scripts/satellite_prevalidation.py`, que leen las tablas EUDR_* directo).
