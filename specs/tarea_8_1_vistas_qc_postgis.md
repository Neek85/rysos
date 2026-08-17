# SPEC: Vistas de Auditoría Espacial QC en PostGIS (Tarea 8.1)

## 1. Objetivo
Consolidar `EUDR_MONITOREO`, `EUDR_USO_SUELO` y `EUDR_INSTALACIONES` en tres vistas de solo lectura que permitan al revisor QC auditar todas las geometrías de una organización desde un único punto de consulta, y que sirvan como la única fuente de datos del Dashboard Web público.

## 2. Modelo de Consolidación
`EUDR_MONITOREO.geom_inspeccion` es una columna `geometry` genérica: un mismo formulario QField puede producir un `Point` (pin GPS de la visita) o un `Polygon` (recorrido del perímetro de la parcela), según cómo el técnico capturó la evidencia en campo. Por eso la separación entre "polígonos" y "puntos" no es por tabla de origen, sino por `ST_Dimension()` de cada fila (`2` = poligonal, `0` = puntual — también enruta correctamente una `GeometryCollection` mixta, según su componente de mayor dimensión):

```
vw_monitoreo_poligonos = EUDR_MONITOREO (filas dimension=2)  UNION ALL  EUDR_USO_SUELO
vw_monitoreo_puntos    = EUDR_MONITOREO (filas dimension=0)  UNION ALL  EUDR_INSTALACIONES
vw_monitoreo_web       = (vw_monitoreo_poligonos UNION ALL vw_monitoreo_puntos) WHERE estado_revision = 'APROBADO'
```

`EUDR_USO_SUELO` y `EUDR_INSTALACIONES` no exponen una PK de negocio al ETL (ver `scripts/etl_drive_to_supabase.py`, que hace upsert sobre `ID_Organizacion,fid`); las vistas usan esa misma columna `fid` (feature id nativo del GeoPackage de origen) como `registro_id` legible para esas dos tablas. `vw_monitoreo_poligonos` además expone `id_monitoreo` explícito (junto a `registro_id`) por compatibilidad con proyectos QGIS antiguos que apuntaban directo a `EUDR_MONITOREO` y guardaron esa columna como campo de clave primaria de la capa; queda `NULL` para filas de `EUDR_USO_SUELO`, que no tienen un `id_monitoreo` real.

### Tipado explícito de geometría para QGIS/PostgREST
Postgres solo declara un typmod estable en `information_schema`/`geometry_columns` cuando **todas** las ramas de un `UNION ALL` coinciden exactamente en tipo y SRID de geometría. Sin esto, QGIS Desktop no puede determinar el tipo + SRID desde el catálogo al añadir la capa y muestra el diálogo de "reparar capa". Por eso:
- `vw_monitoreo_poligonos.geom` se castea en **ambas** ramas a `geometry(MultiPolygon, 4326)`, normalizando primero con `ST_Multi(ST_CollectionExtract(ST_Transform(geom, 4326), 3))` — esto convierte cualquier `Polygon` suelto o `GeometryCollection` mixta en un `MultiPolygon` limpio antes del cast, para que el cast final nunca falle en tiempo de consulta.
- `vw_monitoreo_puntos.geom` se castea en **ambas** ramas a `geometry(Point, 4326)` vía `ST_Transform(geom, 4326)::geometry(Point, 4326)`.
- `vw_monitoreo_web.geom` **no** se re-castea a un tipo único: por diseño mezcla filas de `vw_monitoreo_poligonos` (MultiPolygon) y `vw_monitoreo_puntos` (Point), así que Postgres resuelve el tipo de columna a `geometry` genérico (sin typmod) en esa vista específica. QGIS trata esto como una capa de "Geometry" mixta, comportamiento esperado y sin diálogo de reparación (el SRID sigue siendo consistentemente 4326 en todas las filas).

## 3. Invariantes de Negocio
- **Reproyección Estándar:** Toda geometría expuesta se fuerza a EPSG:4326 vía `ST_Transform(..., 4326)`, independientemente del SRID almacenado en la tabla base.
- **Aislamiento Multi-Tenant:** Las vistas NO tienen `security_invoker` ni bypassean RLS; heredan las políticas ya activas sobre `EUDR_MONITOREO`, `EUDR_USO_SUELO` y `EUDR_INSTALACIONES` (`ryzos_all_eudr_*` en `supabase/migrations/20260815_fix_rls_policies.sql`), que filtran por `ID_Organizacion = public.get_my_org_id()`.
- **Filtro Estricto del Dashboard Web:** `vw_monitoreo_web` únicamente expone filas con `estado_revision = 'APROBADO'`. Un registro `PENDIENTE` o `RECHAZADO` nunca debe llegar a esta vista, siguiendo el mismo criterio ya aplicado en `view_eudr_dashboard_aprobados` (Fase 1) y en `scripts/dashboard_geojson.py`.
- **Columnas Heterogéneas sin NULL Silencioso:** Cuando una tabla no tiene una columna equivalente (ej. `EUDR_USO_SUELO` no tiene `evidencia_foto` ni `productor`), la vista expone `NULL` explícito con el tipo correcto (`NULL::text`, `NULL::date`), nunca omite la columna — así el consumidor siempre recibe el mismo shape de fila sin importar la tabla de origen.
- **Trazabilidad:** Cada fila incluye `tabla_origen` (`'EUDR_MONITOREO' | 'EUDR_USO_SUELO' | 'EUDR_INSTALACIONES'`) para que el revisor QC pueda distinguir el origen real del registro al auditar.

## 4. Criterios de Aceptación
- [ ] `vw_monitoreo_poligonos` incluye únicamente geometrías con dimensión poligonal, combinando `EUDR_MONITOREO` y `EUDR_USO_SUELO`, con columnas de productor, uso de suelo, organización, foto, `estado_revision` e `id_monitoreo` explícito.
- [ ] `vw_monitoreo_puntos` incluye únicamente geometrías con dimensión puntual, combinando `EUDR_MONITOREO` y `EUDR_INSTALACIONES`.
- [ ] `vw_monitoreo_web` consolida (`UNION ALL`) los registros ya `APROBADO` de ambas vistas; nunca expone `PENDIENTE`/`RECHAZADO`.
- [ ] Las tres vistas reproyectan toda geometría a EPSG:4326 vía `ST_Transform`.
- [ ] `vw_monitoreo_poligonos.geom` y `vw_monitoreo_puntos.geom` tienen typmod explícito (`geometry(MultiPolygon,4326)` / `geometry(Point,4326)`) en **todas** las ramas de su `UNION ALL`, verificable en `geometry_columns` — QGIS Desktop debe cargar cada capa sin mostrar el diálogo de reparación.
- [ ] Las tres vistas tienen `GRANT SELECT ... TO authenticated` y heredan RLS multi-tenant de las tablas base (ninguna organización puede ver filas de otra a través de la vista).
- [ ] La migración es idempotente (`DROP VIEW IF EXISTS` antes de cada `CREATE VIEW`, en orden de dependencia: `vw_monitoreo_web` primero, luego las dos vistas base).

## 5. Plan de Despliegue
1. Ejecutar `supabase/migrations/20260816_fase2_vistas_qc.sql` en el SQL Editor de Supabase (o vía `supabase db push` si el CLI está configurado contra el proyecto).
2. Verificar el typmod de geometría registrado en el catálogo:
   ```sql
   SELECT f_table_name, f_geometry_column, type, srid
   FROM geometry_columns
   WHERE f_table_name IN ('vw_monitoreo_poligonos', 'vw_monitoreo_puntos');
   ```
   Debe devolver `MULTIPOLYGON`/4326 y `POINT`/4326 respectivamente (no `GEOMETRY` genérico).
3. En QGIS Desktop: eliminar las capas de vistas antiguas del panel de Capas, refrescar la conexión PostgreSQL en el panel Navegador, y volver a arrastrar `vw_monitoreo_poligonos` / `vw_monitoreo_puntos` — deben cargar de inmediato sin el diálogo de reparación.
4. Verificar manualmente con un usuario de prueba autenticado de cada organización que:
   - `SELECT * FROM vw_monitoreo_web` solo devuelve filas de su propia organización y en estado `APROBADO`.
   - `SELECT DISTINCT tabla_origen FROM vw_monitoreo_poligonos` y `vw_monitoreo_puntos` devuelven las tablas esperadas.
5. Si en el futuro se requiere enriquecer las vistas con nombre de parcela/socio legible (`parcela_nombre`, `socio_nombre_completo`), seguir el mismo patrón de `LEFT JOIN` a `PADRON_PARCELAS`/`PADRON_SOCIOS` ya usado en `view_eudr_dashboard_aprobados` — no incluido en esta tarea para mantener el alcance acotado a lo solicitado.

## 6. Rollback
```sql
DROP VIEW IF EXISTS public.vw_monitoreo_web;
DROP VIEW IF EXISTS public.vw_monitoreo_poligonos;
DROP VIEW IF EXISTS public.vw_monitoreo_puntos;
```
Ninguna de las tres vistas modifica datos ni tiene efectos secundarios; el rollback es un simple `DROP VIEW` sin riesgo de pérdida de información en las tablas base.
