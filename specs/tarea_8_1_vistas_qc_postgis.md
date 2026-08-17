# SPEC: Vistas de Auditoría Espacial QC en PostGIS (Tarea 8.1)

## 1. Objetivo
Consolidar `EUDR_MONITOREO`, `EUDR_USO_SUELO` y `EUDR_INSTALACIONES` en tres vistas de solo lectura que permitan al revisor QC auditar todas las geometrías de una organización desde un único punto de consulta, y que sirvan como la única fuente de datos del Dashboard Web público.

## 2. Modelo de Consolidación
`EUDR_MONITOREO.geom_inspeccion` es una columna `geometry` genérica: un mismo formulario QField puede producir un `Point` (pin GPS de la visita) o un `Polygon` (recorrido del perímetro de la parcela), según cómo el técnico capturó la evidencia en campo. Por eso la separación entre "polígonos" y "puntos" no es por tabla de origen, sino por `ST_GeometryType()` de cada fila:

```
vw_monitoreo_poligonos = EUDR_MONITOREO (filas Polygon/MultiPolygon)  UNION ALL  EUDR_USO_SUELO
vw_monitoreo_puntos    = EUDR_MONITOREO (filas Point/MultiPoint)      UNION ALL  EUDR_INSTALACIONES
vw_monitoreo_web       = (vw_monitoreo_poligonos UNION ALL vw_monitoreo_puntos) WHERE estado_revision = 'APROBADO'
```

`EUDR_USO_SUELO` y `EUDR_INSTALACIONES` no exponen una PK de negocio al ETL (ver `scripts/etl_drive_to_supabase.py`, que hace upsert sobre `ID_Organizacion,fid`); las vistas usan esa misma columna `fid` (feature id nativo del GeoPackage de origen) como `registro_id` legible para esas dos tablas, y `id_monitoreo` para las filas de `EUDR_MONITOREO`.

## 3. Invariantes de Negocio
- **Reproyección Estándar:** Toda geometría expuesta se fuerza a EPSG:4326 vía `ST_Transform(..., 4326)`, independientemente del SRID almacenado en la tabla base.
- **Aislamiento Multi-Tenant:** Las vistas NO tienen `security_invoker` ni bypassean RLS; heredan las políticas ya activas sobre `EUDR_MONITOREO`, `EUDR_USO_SUELO` y `EUDR_INSTALACIONES` (`ryzos_all_eudr_*` en `supabase/migrations/20260815_fix_rls_policies.sql`), que filtran por `ID_Organizacion = public.get_my_org_id()`.
- **Filtro Estricto del Dashboard Web:** `vw_monitoreo_web` únicamente expone filas con `estado_revision = 'APROBADO'`. Un registro `PENDIENTE` o `RECHAZADO` nunca debe llegar a esta vista, siguiendo el mismo criterio ya aplicado en `view_eudr_dashboard_aprobados` (Fase 1) y en `scripts/dashboard_geojson.py`.
- **Columnas Heterogéneas sin NULL Silencioso:** Cuando una tabla no tiene una columna equivalente (ej. `EUDR_USO_SUELO` no tiene `evidencia_foto` ni `productor`), la vista expone `NULL` explícito con el tipo correcto (`NULL::text`, `NULL::date`), nunca omite la columna — así el consumidor siempre recibe el mismo shape de fila sin importar la tabla de origen.
- **Trazabilidad:** Cada fila incluye `tabla_origen` (`'EUDR_MONITOREO' | 'EUDR_USO_SUELO' | 'EUDR_INSTALACIONES'`) para que el revisor QC pueda distinguir el origen real del registro al auditar.

## 4. Criterios de Aceptación
- [ ] `vw_monitoreo_poligonos` incluye únicamente geometrías `Polygon`/`MultiPolygon`, combinando `EUDR_MONITOREO` y `EUDR_USO_SUELO`, con columnas de productor, uso de suelo, organización, foto y `estado_revision`.
- [ ] `vw_monitoreo_puntos` incluye únicamente geometrías `Point`/`MultiPoint`, combinando `EUDR_MONITOREO` y `EUDR_INSTALACIONES`.
- [ ] `vw_monitoreo_web` filtra estrictamente `estado_revision = 'APROBADO'` y nunca expone `PENDIENTE`/`RECHAZADO`.
- [ ] Las tres vistas reproyectan toda geometría a EPSG:4326 vía `ST_Transform`.
- [ ] Las tres vistas tienen `GRANT SELECT ... TO authenticated` y heredan RLS multi-tenant de las tablas base (ninguna organización puede ver filas de otra a través de la vista).
- [ ] La migración es idempotente (`DROP VIEW IF EXISTS` antes de cada `CREATE VIEW`, en orden de dependencia: `vw_monitoreo_web` primero, luego las dos vistas base).

## 5. Plan de Despliegue
1. Ejecutar `supabase/migrations/20260816_fase2_vistas_qc.sql` en el SQL Editor de Supabase (o vía `supabase db push` si el CLI está configurado contra el proyecto).
2. Verificar manualmente con un usuario de prueba autenticado de cada organización que:
   - `SELECT * FROM vw_monitoreo_web` solo devuelve filas de su propia organización y en estado `APROBADO`.
   - `SELECT DISTINCT tabla_origen FROM vw_monitoreo_poligonos` y `vw_monitoreo_puntos` devuelven las tablas esperadas.
3. Si en el futuro se requiere enriquecer las vistas con nombre de parcela/socio legible (`parcela_nombre`, `socio_nombre_completo`), seguir el mismo patrón de `LEFT JOIN` a `PADRON_PARCELAS`/`PADRON_SOCIOS` ya usado en `view_eudr_dashboard_aprobados` — no incluido en esta tarea para mantener el alcance acotado a lo solicitado.

## 6. Rollback
```sql
DROP VIEW IF EXISTS public.vw_monitoreo_web;
DROP VIEW IF EXISTS public.vw_monitoreo_poligonos;
DROP VIEW IF EXISTS public.vw_monitoreo_puntos;
```
Ninguna de las tres vistas modifica datos ni tiene efectos secundarios; el rollback es un simple `DROP VIEW` sin riesgo de pérdida de información en las tablas base.
