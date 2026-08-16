# Plan de Ejecución: Opción C — Motor de Evaluación de Riesgo y Legalidad EUDR

## Archivos a crear

| Archivo | Propósito |
|---------|-----------|
| `specs/opcion_c_evaluacion_riesgo_legalidad.md` | Invariantes, categorías, criterios de aceptación |
| `plans/opcion_c_ejecucion.md` | Este archivo |
| `scripts/evaluate_legal_risk.py` | Motor `LegalRiskEvaluator` |
| `tests/test_opcion_c_riesgo_legalidad.py` | Suite pytest ~28 tests |

## Diseño del Motor (`LegalRiskEvaluator`)

```
evaluate_record(record: dict) → LegalRiskReport
    ├── _evaluate_land_title(record)          → ComplianceFinding (max 25 pts)
    ├── _evaluate_environmental(record)       → ComplianceFinding (max 20 pts)
    ├── _evaluate_deforestation_cutoff(record)→ ComplianceFinding (max 30 pts)
    ├── _evaluate_protected_area(record)      → ComplianceFinding (max 15 pts)
    ├── _evaluate_country_risk(record)        → ComplianceFinding (max 10 pts)
    ├── _aggregate_score(findings)            → (total, max, score_float)
    ├── _classify_risk_level(score, country)  → RiskLevel
    └── _determine_due_diligence(risk, country_risk) → (DueDiligenceType, article)

evaluate_batch(records, org_id=None) → list[LegalRiskReport]
    └── filtra por ID_Organizacion si org_id no es None
```

## Lógica de Scoring Detallada

### LAND_TITLE (max 25)
- Sin título → 0 pts, NON_COMPLIANT
- Con título sin fecha → 20 pts, COMPLIANT
- Con título y fecha ≤ 2020-12-31 → 25 pts, COMPLIANT

### ENVIRONMENTAL (max 20)
- Sin permiso → 0 pts, NON_COMPLIANT
- Con permiso → 20 pts, COMPLIANT

### DEFORESTATION_CUTOFF (max 30)
- fecha_uso ≤ 2020-12-31 → 30 pts, COMPLIANT
- fecha_uso > 2020-12-31 → 0 pts, NON_COMPLIANT
- Sin fecha pero cumple_eudr=True → 30 pts, COMPLIANT
- Sin fecha pero cumple_eudr=False → 0 pts, NON_COMPLIANT
- Sin fecha sin campo cumple_eudr → 0 pts, INSUFFICIENT_DATA

### PROTECTED_AREA (max 15)
- distancia_anp_km = None → 15 pts, COMPLIANT (sin ANP próxima)
- distancia ≥ 5.0 km → 15 pts, COMPLIANT
- 1.0 ≤ distancia < 5.0 km → 7 pts, NON_COMPLIANT (zona buffer)
- distancia < 1.0 km → 0 pts, NON_COMPLIANT

### COUNTRY_RISK (max 10)
- NEGLIGIBLE (países EU/US/etc.) → 10 pts
- STANDARD (PE, CO, VN, etc.) → 5 pts
- HIGH (BR, ID, CD, etc.) → 0 pts, NON_COMPLIANT

## Validación
```bash
python -m pytest tests/test_opcion_c_riesgo_legalidad.py -v
```
Objetivo: todos los tests pasan sin credenciales externas.
