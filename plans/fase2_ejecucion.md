# PLAN DE EJECUCIÓN: Fase 2 - Ingesta ETL QField

## 1. Pasos de Desarrollo
1. **Configuración de Dependencias:** Garantizar librerías `geopandas`, `shapely`, `supabase`, `fiona`.
2. **Desarrollo del Script ETL (`scripts/etl_qfield_ingest.py`):**
   - Lógica de extracción de archivos `.gpkg` / `.geojson` / imágenes `.jpg`.
   - Reproyección de coordenadas a WGS84 (EPSG:4326).
   - Extracción de metadata de inspección (técnico, fecha, precisión GPS, respuestas EUDR).
   - Carga de archivos al bucket de Supabase Storage.
   - Inserción SQL/PostGIS vía REST client.
3. **Pruebas de Aceptación (`tests/test_fase2_etl.py`):**
   - Simulación de lectura e ingesta con un paquete de prueba.

## 2. Plan de Rollback
En caso de falla durante la ingesta:
- Los registros insertados con `estado_revision = 'PENDIENTE'` no afectan la vista `view_eudr_dashboard_aprobados` (que filtra solo `APROBADO`).
- Ejecutar `DELETE FROM public."EUDR_MONITOREO" WHERE estado_revision = 'PENDIENTE' AND fecha_monitoreo = '<fecha_lote>';` para eliminar el lote fallido.
- Las imágenes subidas al bucket pueden eliminarse desde el Dashboard de Supabase Storage filtrando por la carpeta `{ID_Organizacion}/{id_monitoreo}/`.
