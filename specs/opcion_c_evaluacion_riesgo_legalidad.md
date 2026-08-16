# Especificación: Opción C — Evaluación de Riesgo y Legalidad Nacional (EUDR Arts. 10 & 11)

## Contexto Regulatorio
El Reglamento EU 2023/1115 obliga a los operadores a realizar **diligencia debida** antes de
poner en el mercado UE productos derivados de materias primas con riesgo de deforestación.

- **Art. 10** — Diligencia debida simplificada: aplica cuando el país de producción y la
  cadena de suministro tienen riesgo **NEGLIGIBLE** (bajo).
- **Art. 11** — Diligencia debida completa: aplica para países/cadenas de riesgo **ESTÁNDAR**
  o **ALTO**. Requiere documentación exhaustiva y plan de mitigación.
- **Art. 29** — Clasificación de países: la Comisión Europea clasifica países en HIGH /
  STANDARD / NEGLIGIBLE (LOW) según métricas de deforestación.

## Categorías de Cumplimiento Legal

| Categoría | Peso | Descripción |
|-----------|------|-------------|
| `LAND_TITLE` | 25 pts | Derecho de uso/propiedad del suelo documentado |
| `ENVIRONMENTAL` | 20 pts | Permisos ambientales vigentes |
| `DEFORESTATION_CUTOFF` | 30 pts | Uso de suelo anterior al 31 dic 2020 |
| `PROTECTED_AREA` | 15 pts | Distancia mínima de 5 km a ANP |
| `COUNTRY_RISK` | 10 pts | Clasificación de riesgo del país de origen (Art. 29) |
| **Total** | **100 pts** | |

## Clasificación de Riesgo (score → RiskLevel)

| Score | Nivel | Diligencia Debida | Artículo |
|-------|-------|-------------------|----------|
| ≥ 0.80 y país NEGLIGIBLE | `NEGLIGIBLE` | Simplificada | Art. 10 |
| ≥ 0.60 o país STANDARD | `STANDARD` | Completa | Art. 11 |
| < 0.60 | `HIGH` | Completa | Art. 11 |

**Invariante**: Un país clasificado como HIGH por Art. 29 no puede resultar en nivel
NEGLIGIBLE aunque el score supere 0.80.

## Países HIGH Risk (Art. 29 — lista inicial)
BR, ID, PG, CD, MY, NG, CM, GH, CI

## Países NEGLIGIBLE/LOW Risk (Art. 29)
Estados miembros UE + GB, NO, CH, JP, AU, NZ, US, CA

## Países STANDARD Risk
Todos los demás (incluido PE — Perú, contexto operativo de RYZOS).

## Invariantes del Motor

1. `compliance_score ∈ [0.0, 1.0]`
2. `total_points == sum(f.score for f in findings)`
3. `max_points == 100` siempre
4. `len(gaps) == count(findings donde status != COMPLIANT)`
5. `article_applicable ∈ {10, 11}`
6. Aislamiento Multi-Tenant: `evaluate_batch(records, org_id)` filtra por `ID_Organizacion`
7. Campos faltantes retornan `INSUFFICIENT_DATA`, nunca lanzan excepción

## Estructura del Reporte de Salida (`LegalRiskReport`)

```python
{
    "id_monitoreo": str,
    "parcela_codigo": str,
    "ID_Organizacion": str,
    "risk_level": "NEGLIGIBLE" | "STANDARD" | "HIGH",
    "due_diligence_type": "SIMPLIFIED" | "FULL",
    "compliance_score": float,   # 0.0 – 1.0
    "total_points": int,
    "max_points": int,           # siempre 100
    "article_applicable": int,   # 10 o 11
    "findings": [ComplianceFinding, ...],
    "gaps": [str, ...],
    "recommendation": str,
}
```

## Criterios de Aceptación
- AC1: Lote totalmente conforme de país EU → `NEGLIGIBLE` + `SIMPLIFIED` (Art. 10).
- AC2: Lote conforme de Perú → `NEGLIGIBLE` score pero `FULL` (Art. 11) por país STANDARD.
- AC3: Lote sin título y sin permiso ambiental → `HIGH` o `STANDARD` según resto.
- AC4: Uso de suelo posterior a 31-dic-2020 → finding `NON_COMPLIANT` en `DEFORESTATION_CUTOFF`.
- AC5: País HIGH risk no puede arrojar nivel `NEGLIGIBLE`.
- AC6: `evaluate_batch` con `org_id` solo procesa registros de esa organización.
- AC7: Campos faltantes no lanzan excepción; retornan `INSUFFICIENT_DATA`.
