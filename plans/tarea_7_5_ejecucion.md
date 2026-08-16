# PLAN DE EJECUCIÓN: Tarea 7.5 - Ingesta Automatizada ZIP desde Google Drive

## 1. Pasos de Desarrollo
1. **Configuración de Dependencias:** Reutilizar `geopandas`, `shapely`, `fiona`, `supabase` ya presentes en `requirements.txt`. No se requiere librería de Google Drive API (la sincronización la resuelve el cliente de escritorio).
2. **Desarrollo del Script ETL (`scripts/etl_drive_to_supabase.py`):**
   - `discover_packages()`: localizar `.zip` bajo `RYZOS_CLIENTES/*/INBOX/*.zip` (jerarquía tenant-first).
   - `get_org_id_from_path(zip_path)`: derivar `ID_Organizacion` de la carpeta abuela (`RYZOS_CLIENTES/{ID_Organizacion}/`).
   - `extract_package(zip_path, dest_dir)`: descomprimir en directorio temporal.
   - `find_geo_layer(extracted_dir)`: localizar `.gpkg` (prioridad) o `.geojson`.
   - `load_and_reproject(geo_path)`: leer capa y forzar EPSG:4326.
   - `find_photos(extracted_dir)`: localizar archivos `.jpg/.jpeg/.png`.
   - `build_storage_path(org_id, id_monitoreo, photo_path)`: construir ruta `{org}/{id_monitoreo}/{foto}` para el bucket `evidencias_eudr`.
   - `build_monitoreo_payload(row, org_id)`: construir payload con `estado_revision = 'PENDIENTE'`.
   - `build_archive_destination(zip_path, org_id, timestamp)`: calcular ruta `RYZOS_CLIENTES/{org_id}/ARCHIVE/PROCESADO_YYYYMMDD_HHMMSS_{filename}.zip`.
   - `archive_package(zip_path, org_id, execute_move)`: mover el archivo (o simular) al destino calculado.
   - `process_package(zip_path, execute_move)`: orquesta el flujo completo end-to-end para un solo paquete.
   - `run(execute_move)`: recorre todos los paquetes descubiertos bajo `RYZOS_CLIENTES/*/INBOX/` y los procesa.
3. **Pruebas de Aceptación (`tests/test_etl_drive.py`):**
   - Descompresión de un `.zip` sintético con GeoJSON + foto.
   - Reestructuración del payload de inserción (`estado_revision`, ruta de Storage).
   - Renombrado y movimiento del archivo procesado (real, sobre `tmp_path` de pytest) y en modo simulación.
   - Reproyección espacial UTM → WGS84.
4. **Ejecución de Suite:** `python -m pytest tests/test_etl_drive.py -v` usando el intérprete completo de Python 3.12 en Windows.

## 2. Plan de Rollback
En caso de falla durante la ingesta de un paquete:
- El paquete NO se archiva si el proceso falla antes de completar la inserción y carga de evidencias (se mantiene en `RYZOS_CLIENTES/{ID_Organizacion}/INBOX/` para reintento).
- Los registros insertados con `estado_revision = 'PENDIENTE'` no afectan la vista `view_eudr_dashboard_aprobados` (filtra solo `APROBADO`).
- Ejecutar `DELETE FROM public."EUDR_MONITOREO" WHERE estado_revision = 'PENDIENTE' AND "ID_Organizacion" = '<org>' AND fecha_monitoreo = '<fecha_lote>';` para eliminar un lote parcialmente insertado antes de reintentar.
- Las fotos subidas a `evidencias_eudr/{org}/{id_monitoreo}/` pueden eliminarse desde el Dashboard de Supabase Storage antes del reintento.
