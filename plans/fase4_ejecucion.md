# PLAN DE EJECUCIÓN: Fase 4 - Dashboard WebGIS

## 1. Pasos de Desarrollo
1. **Especificación e Invariantes** (`specs/fase4_dashboard_webgis.md`): Reglas de consumo de API y estructura de respuesta.
2. **Función helper de serialización** (`scripts/dashboard_geojson.py`): Convierte filas de `view_eudr_dashboard_aprobados` a `FeatureCollection` GeoJSON.
3. **Suite de Pruebas Unitarias** (`tests/test_fase4_dashboard.py`):
   - Validación de estado `APROBADO` en registros expuestos.
   - Verificación de serialización GeoJSON (Feature y FeatureCollection).
   - Validación de coordenadas WGS84 en rango válido.
   - Test de aislamiento Multi-Tenant por `ID_Organizacion`.
   - Test de campos requeridos en cada Feature.
4. **Ejecución y Confirmación:** `pytest tests/test_fase4_dashboard.py -v`.

## 2. Plan de Rollback
- Si la API expone datos incorrectos, el problema es de RLS en Supabase, no de la capa Next.js.
- Verificar `get_my_org_id()` retornando el valor esperado con: `SELECT public.get_my_org_id();` en el SQL Editor autenticado.
- La vista `view_eudr_dashboard_aprobados` no tiene estado propio — es una proyección en tiempo real de `EUDR_MONITOREO`.
