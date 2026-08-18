# Spec — Cierre de brecha: exponer flags de sanitización en vw_monitoreo_*

## Contexto

`docs/adr/ADR-001-gis-sanitization-and-eudr-triggers.md` documentó un gap
real: `20260818_gis_core_sanitization.sql` agregó `area_calculada_ha` y
`requiere_revision_area` a `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`,
pero `vw_monitoreo_poligonos`, `vw_monitoreo_puntos` y `vw_monitoreo_web`
seleccionan columnas explícitas (no `SELECT *`) y ninguna las expone. El
Dashboard Web y QGIS Desktop no pueden ver el flag de revisión de área.

## Objetivo

Agregar `area_calculada_ha` y `requiere_revision_area` a las 3 vistas sin
romper ningún consumidor existente.

## Decisiones de diseño

1. **Solo se agregan columnas, no se quita ni renombra ninguna existente.**
   `MapDashboard.jsx` y cualquier proyecto QGIS ya guardado referencian las
   vistas por nombre de columna, no por posición — agregar columnas al final
   del `SELECT` es seguro.
2. **`vw_monitoreo_poligonos`/`vw_monitoreo_puntos`** ya seleccionan
   directamente de `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`
   (alias `m`, `u`, `i`) — se agregan `m.area_calculada_ha`,
   `m.requiere_revision_area` (y equivalentes `u.`/`i.`) a cada rama del
   `UNION ALL`, sin cambiar los casts de geometría ni el resto de columnas.
3. **`vw_monitoreo_web`** selecciona de `vw_monitoreo_poligonos`/
   `vw_monitoreo_puntos` (alias `src`) — una vez que esas dos exponen las
   columnas, `vw_monitoreo_web` solo necesita `src.area_calculada_ha`,
   `src.requiere_revision_area` en su propio `SELECT`, sin joins nuevos.
4. Se re-crea cada vista completa (`DROP VIEW ... CASCADE` /
   `CREATE VIEW`), siguiendo el mismo patrón idempotente de las migraciones
   anteriores de vistas (`20260816_fase2_vistas_qc.sql`,
   `20260817_refine_vw_monitoreo_web.sql`) — no se usa `CREATE OR REPLACE
   VIEW` porque cambia la lista de columnas, lo cual Postgres no permite con
   `CREATE OR REPLACE VIEW` salvo que las columnas nuevas se agreguen al
   final exacto (frágil de mantener a mano en 3 vistas encadenadas); `DROP
   ... CASCADE` + `CREATE` es el patrón ya establecido en este proyecto para
   este caso.
5. No se toca `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` ni los
   triggers/funciones de `20260818_gis_core_sanitization.sql` — esta
   migración es puramente de vistas.

## Criterios de aceptación

- AC1: `vw_monitoreo_poligonos` y `vw_monitoreo_puntos` exponen
  `area_calculada_ha` y `requiere_revision_area` en las 4 ramas del `UNION ALL`
  combinadas (2 vistas × 2 ramas cada una).
- AC2: `vw_monitoreo_web` expone las mismas 2 columnas en sus 2 ramas.
- AC3: Ninguna columna existente de las 3 vistas se elimina o renombra
  (verificable por diff de columnas antes/después).
- AC4: La migración es idempotente y re-ejecutable.
