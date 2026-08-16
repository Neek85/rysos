# SPEC: Pipeline de Ingesta Automatizada de Paquetes QField .ZIP desde Google Drive (Tarea 7.5)

## 1. Objetivo
Automatizar la ingesta de paquetes de campo `.zip` generados por QField y sincronizados a través de una carpeta local de Google Drive (Google Drive Desktop / punto de montaje sincronizado), procesándolos hacia Supabase PostGIS (tabla `EUDR_MONITOREO`) y Supabase Storage (evidencia fotográfica), sin intervención manual del técnico de gabinete.

## 2. Modelo de Origen de Datos
Se asume que Google Drive Desktop sincroniza una carpeta raíz local (`drive_root`) con la siguiente estructura, administrada por los técnicos de campo por organización:

```
<drive_root>/
  INBOX/
    {ID_Organizacion}/
      paquete_campo_01.zip
      paquete_campo_02.zip
  ARCHIVE/
    {ID_Organizacion}/
      PROCESADO_YYYYMMDD_HHMMSS_paquete_campo_01.zip
```

No se integra directamente contra la API de Google Drive (OAuth) en esta tarea; la sincronización de archivos la resuelve el cliente de escritorio de Google Drive. El pipeline opera exclusivamente sobre el sistema de archivos local montado.

## 3. Invariantes de Negocio y Geoprocesamiento
- **Asignación de Organización:** `ID_Organizacion` se deriva SIEMPRE del nombre de la carpeta emisora inmediata dentro de `INBOX/` (carpeta padre del `.zip`), nunca del nombre del archivo ni de metadata interna del paquete.
- **Estado Inicial OBLIGATORIO:** Todo registro insertado en `EUDR_MONITOREO` por este pipeline debe llevar `estado_revision = 'PENDIENTE'`.
- **Reproyección Estándar:** Toda geometría extraída de la capa GeoPackage/GeoJSON debe forzarse a EPSG:4326 (WGS84) antes de construir el payload de inserción, independientemente del CRS de origen.
- **Estructura de Storage:** Las fotografías adjuntas se suben al bucket `evidencias_eudr` (el mismo bucket ya utilizado por el ETL de Fase 2, `scripts/etl_qfield_ingest.py`) bajo la ruta `{ID_Organizacion}/{id_monitoreo}/{nombre_foto}`.
- **Idempotencia de Archivo Procesado:** Un paquete `.zip` solo se considera procesado exitosamente si, tras la inserción de registros y carga de evidencias, se mueve (o se simula el movimiento) a `ARCHIVE/{ID_Organizacion}/`. Un paquete que falla a mitad de proceso NO debe archivarse, para permitir reintento.
- **Renombrado de Archivo Procesado:** El archivo movido a `ARCHIVE/` debe renombrarse con el patrón `PROCESADO_YYYYMMDD_HHMMSS_{nombre_original}.zip`, donde el timestamp corresponde al momento de procesamiento (hora local de ejecución del pipeline).
- **Modo Simulación:** El pipeline debe soportar un modo `dry_run` (o parámetro `execute_move=False`) que calcule la ruta y nombre de destino sin mover físicamente el archivo, para pruebas y auditoría previa.

## 4. Criterios de Aceptación
- [ ] El script descubre todos los `.zip` bajo `INBOX/*/*.zip` sin necesidad de listarlos manualmente.
- [ ] `ID_Organizacion` se determina correctamente a partir del nombre de la carpeta padre del `.zip`.
- [ ] El script descomprime el paquete en un directorio temporal y localiza la capa geoespacial (`.gpkg` con prioridad, `.geojson` como fallback).
- [ ] Toda geometría insertada queda en EPSG:4326, sin importar el CRS de origen del paquete de campo.
- [ ] Cada fotografía encontrada en el paquete genera una ruta de Storage con el patrón `{ID_Organizacion}/{id_monitoreo}/{nombre_foto}` bajo el bucket `evidencias_eudr`.
- [ ] Todo payload de `EUDR_MONITOREO` generado por este pipeline tiene `estado_revision = 'PENDIENTE'`.
- [ ] En modo real (`execute_move=True`), el `.zip` original se mueve a `ARCHIVE/{ID_Organizacion}/PROCESADO_YYYYMMDD_HHMMSS_{filename}.zip`.
- [ ] En modo simulación (`execute_move=False`), se retorna la ruta de destino calculada sin alterar el sistema de archivos.
- [ ] La suite de tests cubre: descompresión, reestructuración de payload, reproyección WGS84 y renombrado del archivo comprimido — sin requerir credenciales reales de Supabase ni acceso a Google Drive.
