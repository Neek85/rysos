# PLAN DE EJECUCIÓN: Módulo de Pre-Validación Satelital Automática

## 1. Pasos de Desarrollo
1. **Especificación e Invariantes** (`specs/modulo_prevalidacion_satelital.md`): Fecha de corte, umbrales y prioridades de riesgo.
2. **Detector Satelital** (`scripts/satellite_prevalidation.py`):
   - `evaluate_plot(plot, forest_events, anp_polygons)` → análisis de una parcela.
   - `evaluate_batch(plots, forest_events, anp_polygons, org_id)` → lote Multi-Tenant.
   - Clasificación: `BAJO / ALTO / CRITICO`.
3. **Suite de Pruebas** (`tests/test_modulo_prevalidacion_satelital.py`):
   - Parcela limpia → BAJO.
   - Deforestación `year <= 2020` → histórica, no activa alerta.
   - Deforestación `year == 2020` (año exacto del corte) → conforme.
   - Deforestación `year > 2020` → ALTO.
   - Múltiples eventos post-2020 → área acumulada.
   - ANP intersecada → CRITICO con prevalencia sobre deforestación.
4. **Confirmación:** `pytest tests/test_modulo_prevalidacion_satelital.py -v`.

## 2. Plan de Rollback
- El módulo es de solo lectura — no modifica registros en Supabase.
- Los resultados deben almacenarse en una tabla de staging (`eudr_prevalidacion_resultados`) antes de actualizar `PADRON_PARCELAS.nivel_riesgo` en producción.
- En caso de capas GFW/ANP desactualizadas, marcar los resultados con `capa_version` para trazabilidad.
