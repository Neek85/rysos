# SPEC: Dashboard Web & Visualizador WebGIS (Fase 4)

## 1. Objetivo
Exponer en la interfaz web (Next.js) los monitoreos e inspecciones EUDR que han completado satisfactoriamente el flujo de Control de Calidad (QC) y se encuentran en estado `'APROBADO'`, permitiendo a los administradores de la organización visualizar parcelas, capas de deforestación y fichas técnicas de trazabilidad.

## 2. Invariantes del Dashboard Web
- **Exposición Exclusiva de Aprobados:** El Dashboard Web solo consultará la vista `view_eudr_dashboard_aprobados`. Bajo ningún motivo la aplicación web consultará directamente la tabla `EUDR_MONITOREO` sin filtrar.
- **Aislamiento de Sesión (Multi-Tenant):** Las peticiones desde el frontend utilizarán el cliente Supabase con el JWT del usuario autenticado, asegurando que RLS filtre automáticamente los datos por `ID_Organizacion`.
- **Formato Estándar GeoJSON:** El API de Next.js entregará las geometrías en formato `FeatureCollection` GeoJSON compatible con Mapbox GL JS / Leaflet / OpenLayers.
- **Coordenadas WGS84:** Toda geometría expuesta debe estar en EPSG:4326. Longitud en rango [-180, 180] y latitud en rango [-90, 90].
- **Propiedades Mínimas Requeridas:** Cada `Feature` del GeoJSON debe incluir `id_monitoreo`, `ID_Parcela_Fija`, `parcela_nombre`, `socio_nombre_completo`, `cumple_eudr` y `hectareas_totales`.

## 3. Criterios de Aceptación
- [ ] La consulta del dashboard retorna únicamente registros con `estado_revision = 'APROBADO'`.
- [ ] Las geometrías de inspección y parcelas se devuelven correctamente serializadas en GeoJSON WGS84 (EPSG:4326).
- [ ] Un `FeatureCollection` con 0 features es una respuesta válida (organización sin monitoreos aprobados).
- [ ] Los registros de otras organizaciones no aparecen en la respuesta del JWT activo.
- [ ] Los tests en `tests/test_fase4_dashboard.py` validan el filtrado de vista, la integridad de propiedades y la serialización GeoJSON.
