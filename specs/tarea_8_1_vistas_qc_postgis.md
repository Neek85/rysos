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

`EUDR_USO_SUELO` y `EUDR_INSTALACIONES` no exponen una PK de negocio al ETL (ver `scripts/etl_drive_to_supabase.py`, que hace upsert sobre `ID_Organizacion,fid`); las vistas usan esa misma columna `fid` (feature id nativo del GeoPackage de origen) como `registro_id` legible para esas dos tablas.

### id_monitoreo: UUID único y no nulo en toda fila
QGIS Desktop necesita una columna no-nula y única para usar como "Feature id"/clave primaria de la capa — con `NULL`s (como en la iteración anterior, donde `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` no aportaban `id_monitoreo`) la capa queda degradada a solo-lectura o dispara advertencias. Ahora `id_monitoreo` (tipo `uuid` nativo, no `text`) nunca es `NULL`:
- Filas de `EUDR_MONITOREO`: `m.id_monitoreo` (el UUID real, PK de la tabla).
- Filas de `EUDR_USO_SUELO` / `EUDR_INSTALACIONES`: UUID v5 determinístico derivado del `id` nativo de la fila vía `extensions.uuid_generate_v5(extensions.uuid_ns_url(), 'USO_SUELO_' || u.id::text)` (o `'INSTALACIONES_' || i.id::text`) — requiere la extensión `uuid-ossp` habilitada en el schema `extensions` (estándar en proyectos Supabase). Al ser determinístico, el mismo registro produce siempre el mismo UUID entre corridas, y el prefijo por tabla evita colisiones si ambas tablas tienen secuencias `id` que arrancan en 1.
- `id_origen` (tipo `text`, solo en `vw_monitoreo_poligonos`) expone el `id` crudo de la fila tal cual está en la tabla base (`m.id_monitoreo::text` o `u.id::text`), para trazabilidad legible distinta del UUID sintético de `id_monitoreo`.

### Alias dual de geometría: geom y geom_inspeccion
`vw_monitoreo_poligonos` y `vw_monitoreo_puntos` exponen la misma geometría bajo **dos** nombres de columna: `geom` (convención nueva) y `geom_inspeccion` (nombre literal de la columna de `EUDR_MONITOREO`). Esto evita que un proyecto QGIS antiguo que apuntaba directo a `EUDR_MONITOREO` y tenía el campo de geometría de la capa configurado como `geom_inspeccion` deje de funcionar al migrar la capa hacia la vista consolidada. Para las filas de `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`, `geom_inspeccion` es simplemente un alias duplicado de `geom` (esas tablas no tienen una columna con ese nombre).

### Tipado explícito de geometría para QGIS/PostgREST
Postgres solo declara un typmod estable en `information_schema`/`geometry_columns` cuando **todas** las ramas de un `UNION ALL` coinciden exactamente en tipo y SRID de geometría. Sin esto, QGIS Desktop no puede determinar el tipo + SRID desde el catálogo al añadir la capa y muestra el diálogo de "reparar capa". Por eso:
- `vw_monitoreo_poligonos.geom`/`geom_inspeccion` se castean en **ambas** ramas a `geometry(MultiPolygon, 4326)`, normalizando primero con `ST_Multi(ST_CollectionExtract(ST_Transform(geom, 4326), 3))` — esto convierte cualquier `Polygon` suelto o `GeometryCollection` mixta en un `MultiPolygon` limpio antes del cast, para que el cast final nunca falle en tiempo de consulta.
- `vw_monitoreo_puntos.geom`/`geom_inspeccion` se castean en **ambas** ramas a `geometry(Point, 4326)` vía `ST_Transform(geom, 4326)::geometry(Point, 4326)`.
- `vw_monitoreo_web.geom` **no** se re-castea a un tipo único: por diseño mezcla filas de `vw_monitoreo_poligonos` (MultiPolygon) y `vw_monitoreo_puntos` (Point), así que Postgres resuelve el tipo de columna a `geometry` genérico (sin typmod) en esa vista específica. QGIS trata esto como una capa de "Geometry" mixta, comportamiento esperado y sin diálogo de reparación (el SRID sigue siendo consistentemente 4326 en todas las filas). `vw_monitoreo_web` tampoco expone `id_monitoreo`/`id_origen`/`geom_inspeccion` — esas columnas son para compatibilidad QGIS en las vistas de auditoría, no para el consumo del Dashboard Web.
- **`vw_monitoreo_web.geom_geojson` (agregado en Tarea 9.2, WebGIS frontend):** PostgREST serializa una columna `geometry` cruda como texto hexadecimal EWKB, no GeoJSON — un cliente JS no puede hacer `JSON.parse()` sobre eso directamente. Como esta vista (a diferencia de poligonos/puntos) no tiene restricciones de compatibilidad con QGIS, se le agregó `ST_AsGeoJSON(geom)::json AS geom_geojson`, listo para usarse como `Feature.geometry` en el frontend (`components/gis/MapDashboard.jsx`).

## 3. Invariantes de Negocio
- **Reproyección Estándar:** Toda geometría expuesta se fuerza a EPSG:4326 vía `ST_Transform(..., 4326)`, independientemente del SRID almacenado en la tabla base.
- **Aislamiento Multi-Tenant:** Las vistas NO tienen `security_invoker` ni bypassean RLS; heredan las políticas ya activas sobre `EUDR_MONITOREO`, `EUDR_USO_SUELO` y `EUDR_INSTALACIONES` (`ryzos_all_eudr_*` en `supabase/migrations/20260815_fix_rls_policies.sql`), que filtran por `ID_Organizacion = public.get_my_org_id()`.
- **Filtro Estricto del Dashboard Web:** `vw_monitoreo_web` únicamente expone filas con `estado_revision = 'APROBADO'`. Un registro `PENDIENTE` o `RECHAZADO` nunca debe llegar a esta vista, siguiendo el mismo criterio ya aplicado en `view_eudr_dashboard_aprobados` (Fase 1) y en `scripts/dashboard_geojson.py`.
- **Columnas Heterogéneas sin NULL Silencioso:** Cuando una tabla no tiene una columna equivalente (ej. `EUDR_USO_SUELO` no tiene `evidencia_foto` ni `productor`), la vista expone `NULL` explícito con el tipo correcto (`NULL::text`, `NULL::date`), nunca omite la columna — así el consumidor siempre recibe el mismo shape de fila sin importar la tabla de origen.
- **Trazabilidad:** Cada fila incluye `tabla_origen` (`'EUDR_MONITOREO' | 'EUDR_USO_SUELO' | 'EUDR_INSTALACIONES'`) para que el revisor QC pueda distinguir el origen real del registro al auditar.

## 4. Criterios de Aceptación
- [ ] `vw_monitoreo_poligonos` incluye únicamente geometrías con dimensión poligonal, combinando `EUDR_MONITOREO` y `EUDR_USO_SUELO`, con columnas de productor, uso de suelo, organización, foto, `estado_revision`, `id_monitoreo` (uuid, nunca nulo) e `id_origen` (text).
- [ ] `vw_monitoreo_puntos` incluye únicamente geometrías con dimensión puntual, combinando `EUDR_MONITOREO` y `EUDR_INSTALACIONES`, con `id_monitoreo` (uuid, nunca nulo) en ambas ramas.
- [ ] `vw_monitoreo_web` consolida (`UNION ALL`) los registros ya `APROBADO` de ambas vistas; nunca expone `PENDIENTE`/`RECHAZADO`.
- [ ] Las tres vistas reproyectan toda geometría a EPSG:4326 vía `ST_Transform`.
- [ ] `vw_monitoreo_poligonos` y `vw_monitoreo_puntos` exponen `geom` y `geom_inspeccion` con typmod explícito (`geometry(MultiPolygon,4326)` / `geometry(Point,4326)`) en **todas** las ramas de su `UNION ALL`, verificable en `geometry_columns` — QGIS Desktop debe cargar cada capa sin mostrar el diálogo de reparación, usando cualquiera de las dos columnas de geometría.
- [ ] `SELECT COUNT(*) FROM vw_monitoreo_poligonos WHERE id_monitoreo IS NULL` y el equivalente en `vw_monitoreo_puntos` devuelven `0`.
- [ ] Las tres vistas tienen `GRANT SELECT ... TO authenticated` y heredan RLS multi-tenant de las tablas base (ninguna organización puede ver filas de otra a través de la vista).
- [ ] La migración es idempotente (`DROP VIEW IF EXISTS` antes de cada `CREATE VIEW`, en orden de dependencia: `vw_monitoreo_web` primero, luego las dos vistas base).

## 5. Plan de Despliegue
1. Confirmar que la extensión `uuid-ossp` está habilitada en el schema `extensions` del proyecto Supabase (`SELECT * FROM pg_extension WHERE extname = 'uuid-ossp';`) — requerida por `extensions.uuid_generate_v5`/`extensions.uuid_ns_url`. Si falta: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;`.
2. Ejecutar `supabase/migrations/20260816_fase2_vistas_qc.sql` en el SQL Editor de Supabase (o vía `supabase db push` si el CLI está configurado contra el proyecto).
3. Verificar el typmod de geometría registrado en el catálogo:
   ```sql
   SELECT f_table_name, f_geometry_column, type, srid
   FROM geometry_columns
   WHERE f_table_name IN ('vw_monitoreo_poligonos', 'vw_monitoreo_puntos');
   ```
   Debe devolver dos filas por vista (`geom` y `geom_inspeccion`), ambas `MULTIPOLYGON`/4326 o `POINT`/4326 según corresponda (no `GEOMETRY` genérico).
4. Verificar que `id_monitoreo` nunca es `NULL` (ver criterios de aceptación) y que los UUID sintéticos son estables entre corridas (ejecutar la misma consulta dos veces y comparar).
5. En QGIS Desktop: eliminar las capas de vistas antiguas del panel de Capas, refrescar la conexión PostgreSQL en el panel Navegador, y volver a arrastrar `vw_monitoreo_poligonos` / `vw_monitoreo_puntos` — deben cargar de inmediato sin el diálogo de reparación, con `id_monitoreo` disponible como candidato de clave primaria.
6. Verificar manualmente con un usuario de prueba autenticado de cada organización que:
   - `SELECT * FROM vw_monitoreo_web` solo devuelve filas de su propia organización y en estado `APROBADO`.
   - `SELECT DISTINCT tabla_origen FROM vw_monitoreo_poligonos` y `vw_monitoreo_puntos` devuelven las tablas esperadas.
7. Si en el futuro se requiere enriquecer las vistas con nombre de parcela/socio legible (`parcela_nombre`, `socio_nombre_completo`), seguir el mismo patrón de `LEFT JOIN` a `PADRON_PARCELAS`/`PADRON_SOCIOS` ya usado en `view_eudr_dashboard_aprobados` — no incluido en esta tarea para mantener el alcance acotado a lo solicitado.

## 7. Riesgo Residual
La migración asume que `EUDR_INSTALACIONES` tiene una columna `id` con la misma estructura que `EUDR_USO_SUELO` (ambas fueron creadas en el mismo diseño de Fase 1, ver `supabase/migrations/20260815_fase1_security_storage.sql`), ya que la generación de UUID determinístico para sus filas usa `i.id::text`. El uso de `u.id` en `EUDR_USO_SUELO` fue confirmado explícitamente al redactar esta tarea; el de `EUDR_INSTALACIONES` es una inferencia por simetría estructural, no confirmada directamente. Si `EUDR_INSTALACIONES` no tiene columna `id`, la creación de `vw_monitoreo_puntos` fallará con un error de columna inexistente (falla ruidosa, no silenciosa) al aplicar la migración.

## 6. Rollback
```sql
DROP VIEW IF EXISTS public.vw_monitoreo_web;
DROP VIEW IF EXISTS public.vw_monitoreo_poligonos;
DROP VIEW IF EXISTS public.vw_monitoreo_puntos;
```
Ninguna de las tres vistas modifica datos ni tiene efectos secundarios; el rollback es un simple `DROP VIEW` sin riesgo de pérdida de información en las tablas base.
