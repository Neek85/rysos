# SPEC: Motor de Detección y Limpieza de Solapamientos Topológicos (Overlaps)

## 1. Objetivo
Asegurar que ningún lote de exportación EUDR enviado a TRACES contenga polígonos con superposiciones geométricas (overlaps) entre parcelas colindantes, resolviendo pequeñas imprecisiones GPS de campo (< 0.5% de área) mediante corrección topológica y alertando sobre conflictos de linderos significativos (>= 0.5%).

## 2. Invariantes de Negocio y Geometría
- **Aislamiento Multi-Tenant:** Las consultas de solapamiento únicamente comparan geometrías dentro de la misma organización (`ID_Organizacion`).
- **Regla de Tolerancia Automatizada:**
  - Overlap < 0.5% del área total de la parcela → Corrección automática mediante resta de diferencia geométrica (`Shapely.difference`).
  - Overlap >= 0.5% del área total de la parcela → Generación de Alerta Topológica (`requires_manual_review = True`).
- **Prevalencia de Geometría Base:** En la corrección automática, la geometría base ("aprobada") no se modifica; solo la geometría solapante recibe la diferencia.
- **Validez Geométrica de Salida:** Cualquier polígono resultante de la resta topológica debe ser geométricamente válido (`is_valid == True`).
- **Intersecciones de Borde No Cuentan:** Intersecciones de tipo `LineString`, `Point` o `MultiPoint` (área == 0) no se consideran solapamientos de área.

## 3. Criterios de Aceptación
- [ ] `detect_overlaps.py` detecta solapamientos de área entre dos polígonos, ignorando intersecciones de borde (línea/punto).
- [ ] Las superposiciones < 0.5% son corregidas con `difference()` sin modificar la geometría base.
- [ ] La geometría resultante de la corrección no solapa con la base (`intersection.area ≈ 0`).
- [ ] Las superposiciones >= 0.5% activan `requires_manual_review = True` sin modificar geometrías.
- [ ] `check_overlaps_for_organization()` compara solo pares de la misma organización.
- [ ] Todos los tests en `tests/test_modulo_solapamientos.py` pasan correctamente.
