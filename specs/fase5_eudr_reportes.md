# SPEC: Generador de Reportes EUDR & Declaración de Debida Diligencia (Fase 5)

## 1. Objetivo
Permitir a los administradores de la organización exportar la Declaración de Debida Diligencia (DDS - Due Diligence Statement) y los archivos de geometría en formato GeoJSON estandarizado conforme al Reglamento UE 2023/1115 (EUDR) para su presentación ante la plataforma TRACES de la Unión Europea.

## 2. Invariantes de Negocio y Normativa EUDR
- **Exposición Exclusiva de Parcelas Aprobadas:** Solo las parcelas asociadas a inspecciones en estado `'APROBADO'` en `view_eudr_dashboard_aprobados` pueden ser incluidas en la DDS.
- **Precisión de Geometría EUDR:** Las coordenadas exportadas deben estar en WGS84 (EPSG:4326) con una precisión mínima de 6 decimales.
- **Regla de Polígono / Punto:** Parcelas con área >= 4 hectáreas deben exportarse obligatoriamente como Polígono cerrado (`Polygon`). Parcelas < 4 hectáreas pueden representarse por un punto central o polígono.
- **Fecha de Corte EUDR:** El reporte debe certificar que la parcela no ha sufrido deforestación posterior al 31 de diciembre de 2020 (`CUTOFF_DATE = "2020-12-31"`).
- **Aislamiento Multi-Tenant:** El generador debe rechazar (`ValueError`) cualquier registro cuyo `ID_Organizacion` no coincida con la organización del generador.

## 3. Criterios de Aceptación
- [ ] La DDS exportada genera un dict/JSON con la estructura oficial exigida por TRACES EU: `declaration_type`, `regulation`, `organization_id`, `total_plots`, `total_hectares`, `geojson`.
- [ ] Las parcelas en estado `'PENDIENTE'` o `'RECHAZADO'` son excluidas automáticamente (lanzando `ValueError`).
- [ ] Las coordenadas son redondeadas a exactamente 6 decimales en todos los niveles de anidamiento.
- [ ] Parcelas >= 4 Ha se exportan como `Polygon`; < 4 Ha aceptan `Point` o `Polygon`.
- [ ] El campo `deforestation_cutoff_date` en cada Feature es siempre `"2020-12-31"`.
- [ ] Todos los tests en `tests/test_fase5_reportes.py` pasan correctamente.

## 4. Corrección (2026-08-23, ADR-017 — investigación externa)

El Criterio de Aceptación #1 de arriba ("estructura oficial exigida por
TRACES EU: `declaration_type`, `regulation`, `organization_id`,
`total_plots`, `total_hectares`, `geojson`") es **incorrecto** — esa
afirmación no tenía ninguna fuente externa citada en este repo, y una
investigación posterior confirmó que no existe tal estándar. La corrección,
en detalle, en `docs/adr/ADR-017-formato-real-exportacion-trazabilidad.md`;
resumen:

- Ese wrapper JSON completo (`declaration_type`/`regulation`/
  `organization_id`/`total_plots`/`total_hectares`) es **una convención
  interna de RYZOS**, no un estándar externo — funciona como hoja de
  resumen para el comprador/importador, nada más.
- El **GeoJSON de geolocalización** (properties `ProducerName`/
  `ProducerCountry`/`ProductionPlace`/`Area`, geometrías Point/MultiPoint/
  Polygon/MultiPolygon/GeometryCollection, nunca LineString/MultiLineString)
  sí sigue el esquema oficial y público de la Comisión Europea (EUDR
  Information System / TRACES NT) — ese es el archivo que efectivamente
  debe coincidir con el estándar externo, no el wrapper.
- RYZOS **no presenta** la DDS directamente ante TRACES — arma el paquete
  de datos para que el comprador/importador europeo la presente. Por eso
  `lib/eudrDdsExporter.js` ya no describe su wrapper como
  `DUE_DILIGENCE_STATEMENT` (ver `RYZOS_TRACEABILITY_PACKAGE_SUMMARY`) ni
  el botón de `/dashboard/mapa` se llama "Exportar DDS".
