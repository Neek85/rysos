# SPEC: Engine de Pre-Validación Satelital de Deforestación (EUDR Art. 9 & 10)

## 1. Objetivo
Automatizar la verificación de no deforestación mediante el cruce espacial de las geometrías de las parcelas contra capas de referencia de pérdida de cobertura forestal (Hansen GFW / PNCBM MINAM) y Áreas Naturales Protegidas (ANP / SERNANP), asegurando el cumplimiento estricto de la fecha de corte del 31 de diciembre de 2020 establecida por el Reglamento UE 2023/1115.

## 2. Invariantes de Negocio y Geometría
- **Fecha de Corte EUDR:** Solo la deforestación ocurrida con `year > 2020` invalida la conformidad. Eventos del año 2020 o anteriores son históricos y no bloquean la certificación.
- **Umbral de Activación:** Cualquier intersección con área > 0 m² activa la alerta correspondiente (tolerancia cero en área).
- **Prioridad de Riesgo:** `CRITICO` (ANP) > `ALTO` (deforestación post-2020) > `BAJO` (sin alertas).
- **Tolerancia Cero en Zonas Intangibles:** Cualquier superposición con un ANP genera alerta crítica inmediata independientemente del área.
- **Aislamiento Multi-Tenant:** La validación en lote procesa únicamente features del mismo `ID_Organizacion`.

## 3. Criterios de Aceptación
- [ ] Parcela sin intersección → `cumple_eudr='SI'`, `nivel_riesgo='BAJO'`.
- [ ] Deforestación `year <= 2020` → `deforestacion_historica_pre2020=True`, sin alerta EUDR.
- [ ] Deforestación `year > 2020` → `alerta_deforestacion=True`, `nivel_riesgo='ALTO'`, `cumple_eudr='NO'`.
- [ ] Superposición con ANP → `alerta_anp=True`, `nivel_riesgo='CRITICO'`, `cumple_eudr='NO'`.
- [ ] ANP tiene prioridad sobre deforestación post-2020 en la asignación de `nivel_riesgo`.
- [ ] Todos los tests en `tests/test_modulo_prevalidacion_satelital.py` pasan correctamente.
