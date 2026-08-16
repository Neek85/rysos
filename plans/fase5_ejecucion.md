# PLAN DE EJECUCIÓN: Fase 5 - Reportes EUDR & Exportación DDS

## 1. Pasos de Desarrollo
1. **Especificación e Invariantes** (`specs/fase5_eudr_reportes.md`): Estructura JSON/GeoJSON compatible con EU TRACES.
2. **Script de Generación DDS** (`scripts/generate_eudr_dds.py`):
   - Validación Multi-Tenant y de estado `APROBADO` por registro.
   - Redondeo recursivo de coordenadas a 6 decimales.
   - Validación de tipo geométrico por umbral de hectáreas (>= 4 Ha → `Polygon`).
   - Generación de payload consolidado con `declaration_type`, `regulation` y `FeatureCollection`.
3. **Suite de Pruebas** (`tests/test_fase5_reportes.py`):
   - Validación de esquema TRACES EU (campos requeridos).
   - Exclusión de registros no aprobados.
   - Precisión decimal de coordenadas (6 decimales exactos).
   - Regla Polígono/Punto por hectáreas.
   - Fecha de corte `2020-12-31` presente en cada Feature.
   - Aislamiento Multi-Tenant.
   - Serialización JSON completa.
4. **Ejecución y Confirmación:** `pytest tests/test_fase5_reportes.py -v`.

## 2. Plan de Rollback
- La generación DDS es un proceso de solo lectura — no modifica datos en Supabase.
- Si el reporte contiene datos incorrectos, verificar que la vista `view_eudr_dashboard_aprobados` esté sincronizada con `EUDR_MONITOREO`.
- Los archivos DDS exportados (.json) no deben subirse a `evidencias_eudr`; usar un bucket separado `dds_exports` si se requiere persistencia.
