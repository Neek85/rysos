# PLAN DE EJECUCIÓN: Fase 1 - Seguridad y Vistas Base

## 1. Secuencia de Ejecución
1. **Paso 1 (Limpieza):** Eliminar políticas RLS obsoletas e inconsistentes detectadas en la auditoría SQL.
2. **Paso 2 (Infraestructura de Aislamiento):** Desplegar la función helper `get_my_org_id()`, habilitar RLS y crear políticas unificadas por tabla.
3. **Paso 3 (Triggers de Inyección):** Asociar la función `trg_set_id_organizacion()` a los eventos `BEFORE INSERT` de las 5 tablas de datos.
4. **Paso 4 (Vistas WebGIS):** Crear la vista `view_eudr_dashboard_aprobados` combinando monitoreo, parcelas y socios.
5. **Paso 5 (Storage RLS):** Crear el bucket `evidencias_eudr` y aplicar políticas sobre `storage.objects`.
6. **Paso 6 (Verificación Automated):** Ejecutar `tests/test_fase1_sdd.py`.

## 2. Plan de Rollback
En caso de falla crítica en producción:
- Revertir aplicando `DROP VIEW IF EXISTS view_eudr_dashboard_aprobados;`
- Revertir triggers con `DROP TRIGGER IF EXISTS trg_auto_org_* ON ...;`
- Restablecer políticas mediante el respaldo previo extraído en el diagnóstico SQL.
