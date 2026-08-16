# SPEC: Pipeline ETL de Ingesta QField (Fase 2)

## 1. Objetivo
Procesar archivos espaciales offline generados por los técnicos en campo mediante QField (GeoPackage / GeoJSON / ZIP), validar la consistencia topológica y cargar los registros de monitoreo e imágenes de evidencia en Supabase bajo estricto cumplimiento Multi-Tenant.

## 2. Invariantes de Negocio y Geoprocesamiento
- **Estado Inicial OBLIGATORIO:** Todo registro procesado por la ingesta ETL debe asignarse obligatoriamente con `estado_revision = 'PENDIENTE'`.
- **Reproyección Estándar:** Las geometrías capturadas en campo deben transformarse automáticamente a EPSG:4326 (WGS84) antes de ser insertadas en PostGIS.
- **Estructura de Almacenamiento:** Las fotos de evidencia deben cargarse al bucket `evidencias_eudr` usando la ruta relativa `{ID_Organizacion}/{id_monitoreo}/{nombre_foto}`.
- **Relación Parcelaria:** Todo monitoreo debe validar la existencia previa de la parcela (`ID_Parcela_Fija`) o del socio (`ID_Socio`).

## 3. Criterios de Aceptación
- [ ] El script lee un paquete GeoPackage/GeoJSON sin errores de encoding o CRS.
- [ ] Cada geometría insertada en `EUDR_MONITOREO` o `PADRON_PARCELAS` es válida según PostGIS (`ST_IsValid`).
- [ ] El campo `estado_revision` en las tablas `EUDR_MONITOREO`, `EUDR_INSTALACIONES` y `EUDR_USO_SUELO` es igual a `'PENDIENTE'`.
- [ ] La evidencia fotográfica se almacena en el bucket `evidencias_eudr` bajo la estructura de carpetas aislada por organización.
