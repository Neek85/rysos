# SPEC: Consola Maestra QGIS Desktop & Auditoría QC (Fase 3)

## 1. Objetivo
Establecer el flujo de Control de Calidad (QC) en QGIS Desktop conectado directamente a la base de datos Supabase PostGIS, permitiendo a los ingenieros GIS auditar, corregir límites topológicos y aprobar o rechazar monitoreos de campo.

## 2. Invariantes del Proceso QC
- **Aislamiento de Capa de Auditoría:** QGIS debe cargar capas filtradas por defecto con `estado_revision = 'PENDIENTE'` para la bandeja de trabajo de auditoría.
- **Transición de Estados Válidos:** Los únicos estados permitidos para `estado_revision` son `'PENDIENTE'`, `'APROBADO'` y `'RECHAZADO'`.
- **Efecto de Aprobación Instantáneo:** En cuanto un registro cambia a `'APROBADO'`, la vista `view_eudr_dashboard_aprobados` debe incluirlo de inmediato sin requerir recargas o procesos batch.
- **Trazabilidad de Auditoría:** Toda aprobación debe registrar o actualizar campos de auditoría si aplican (`actualizado_en = now()`).
- **Protección de Integridad:** El `id_monitoreo` recibido en las acciones QGIS debe ser validado como UUID v4 antes de ejecutar cualquier sentencia SQL.

## 3. Criterios de Aceptación
- [ ] La acción Python para QGIS cambia exitosamente el estado de una inspección de `'PENDIENTE'` a `'APROBADO'` o `'RECHAZADO'`.
- [ ] Los registros en estado `'PENDIENTE'` o `'RECHAZADO'` NUNCA aparecen en `view_eudr_dashboard_aprobados`.
- [ ] Un `id_monitoreo` con formato inválido (no UUID) lanza `ValueError` antes de generar SQL.
- [ ] La suite `test_fase3_qc.py` valida las reglas de transición, visibilidad simulada e integridad de inputs.
