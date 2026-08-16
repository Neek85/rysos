# PLAN DE EJECUCIÓN: Fase 3 - Consola Maestra QGIS QC

## 1. Pasos de Desarrollo
1. **Definición de Acciones QGIS (`scripts/qgis_qc_actions.py`):**
   - Crear código Python reutilizable para configurar "Acciones de Formulario" en QGIS Desktop (Aprobar / Rechazar).
   - Incluir validación UUID para proteger contra inyección SQL en los formularios de atributos.
2. **Suite de Pruebas Unitarias (`tests/test_fase3_qc.py`):**
   - Validar la lógica de filtrado de la vista QC.
   - Verificar las transiciones de estado válidas e inválidas.
   - Verificar rechazo de `id_monitoreo` con formato no UUID.
3. **Guía de Conexión QGIS (`docs/guia_qgis_postgis.md`):**
   - Documentar los parámetros de conexión SSL y filtros de capa para los analistas GIS.

## 2. Plan de Rollback
En caso de aprobaciones erróneas aplicadas desde QGIS:
- Revertir el estado con:
  ```sql
  UPDATE public."EUDR_MONITOREO"
  SET estado_revision = 'PENDIENTE'
  WHERE id_monitoreo = '<uuid>';
  ```
- El registro desaparecerá inmediatamente de `view_eudr_dashboard_aprobados` al volver a `PENDIENTE`.
