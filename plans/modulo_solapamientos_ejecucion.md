# PLAN DE EJECUCIÓN: Módulo de Solapamientos Topológicos

## 1. Pasos de Desarrollo
1. **Especificación e Invariantes** (`specs/modulo_solapamientos.md`): Tolerancia de área (0.5%), regla de prevalencia y aislamiento Multi-Tenant.
2. **Script Detector/Corrector** (`scripts/detect_overlaps.py`):
   - `analyze_pair_overlap(feat_a, feat_b)` → métricas de intersección y clasificación.
   - `resolve_minor_overlap(base, target)` → aplica `difference()` a la geometría solapante.
   - `check_overlaps_for_organization(records)` → itera todos los pares de la misma org.
3. **Suite de Pruebas** (`tests/test_modulo_solapamientos.py`):
   - Polígonos disjuntos → sin overlap.
   - Polígonos tangentes (bordes compartidos) → sin overlap de área.
   - Micro-solapamiento (< 0.5%) → `is_minor=True`, corrección válida.
   - Macro-solapamiento (>= 0.5%) → `requires_manual_review=True`.
   - Corrección produce geometría válida sin área residual con la base.
   - Aislamiento Multi-Tenant en análisis por lote.
4. **Confirmación:** `pytest tests/test_modulo_solapamientos.py -v`.

## 2. Plan de Rollback
- El módulo es de solo lectura/análisis hasta que se aplique `resolve_minor_overlap`.
- La geometría corregida debe ser persistida en Supabase solo tras revisión humana explícita (`UPDATE PADRON_PARCELAS SET geom = ST_Difference(...)`).
- Las geometrías originales deben respaldarse en un campo `geom_original` antes de aplicar correcciones en producción.
