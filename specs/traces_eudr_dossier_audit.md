# Spec — Auditoría Ruta 1: Exportador TRACES UE + Dossier Comercial

## Contexto y corrección de premisa

El prompt agrupa `/dashboard/lotes` y `/dashboard/mapa` bajo "Exportador
TRACES UE". Tras leer ambas rutas: **el botón real de exportación DDS
(`exportTracesDDS`) vive en `/dashboard/mapa`** (vía
`components/gis/MapDashboard.jsx::handleExportDDS`), no en
`/dashboard/lotes`. `/dashboard/lotes/page.jsx` es, por su propio comentario
de cabecera, una **"Vista de simulación... No persiste nada — es un
preview/demo del QR que se imprimiría en un embarque real"** — genera un
lote de muestra y su QR de trazabilidad pública, pero no ofrece descarga de
DDS. Esta distinción se documenta aquí porque cambia dónde hay que mirar
para verificar cada pieza.

## Resultado de la auditoría (los 4 criterios del prompt)

### (a) 6 decimales, EPSG:4326, regla de área ≥ 4.0 ha — ✅ correcto

`lib/eudrDdsExporter.js`:
- `COORD_PRECISION = 6` — `formatGeometryPrecision()` redondea cada
  coordenada a 6 decimales (`roundCoords`, recursivo para soportar
  `Polygon`/`MultiPolygon` anidados).
- Las geometrías provienen de `geom_geojson` de `vw_monitoreo_web`
  (`ST_AsGeoJSON` sobre columnas ya casteadas a `geometry(...,4326)` en las
  vistas — ver `docs/schema_live.md`) — coordenadas ya en WGS84/EPSG:4326;
  GeoJSON (RFC 7946) asume ese CRS por defecto sin necesidad de declarar un
  miembro `crs` explícito (ese miembro está deprecado en la RFC vigente).
- `MIN_POLYGON_HECTARES = 4.0` + `validatePlotGeometry()`: una parcela con
  `hectares >= 4.0` que no tenga geometría `Polygon`/`MultiPolygon` lanza
  `EUDRValidationError` — confirma la regla pedida. Una parcela `< 4.0 ha`
  puede tener cualquier tipo de geometría (incluido `Point`) sin restricción.
- Nota de precisión distinta: la superficie (`hectareas`/`total_hectares`)
  se redondea a **4 decimales** (`toFixed(4)`), no 6 — la regla de "6
  decimales" del prompt aplica a coordenadas geográficas, no a hectáreas;
  no se encontró ninguna especificación en el repo que pida 6 decimales
  para el área, así que no se considera un gap.

### (b) Lee de `vw_monitoreo_web` respetando `estado_revision` — ✅ correcto, doble filtro

- La vista misma filtra `WHERE estado_revision = 'APROBADO'` (confirmado en
  `20260817_refine_vw_monitoreo_web.sql`).
- `buildTracesPayload()` filtra de nuevo (`approved = records.filter(r =>
  r.estado_revision === 'APROBADO')`) — redundante pero no dañino, defensa
  en profundidad si algún día se le pasan registros de otro origen.
- Ambos call sites (`MapDashboard.jsx`, `app/dashboard/lotes/page.jsx`)
  consultan `vw_monitoreo_web` directamente, nunca una tabla base sin filtro.

### (c) Estado de generación de PDF/Dossier Comercial y Códigos QR

- **Códigos QR: ✅ completo end-to-end.** `lib/qrGenerator.js` (JS,
  `/trace/[lot_hash]`, `/dashboard/lotes`) y
  `PublicTraceabilityService.generate_qr_data_url()` (Python,
  `scripts/generate_lot_qr.py`) — ambos probados
  (`tests/test_tarea14_trazabilidad.py`, más los `.mjs` nuevos de esta
  tarea), ambos realmente invocados desde una ruta real de la app (el lado
  JS) o desde el generador de Dossier (el lado Python).
- **Dossier PDF: ⚠️ backend completo, sin ningún punto de entrada.**
  `scripts/generate_dossier_pdf.py::DossierPDFGenerator.build_pdf_dossier()`
  es una clase Python pura, probada (`tests/test_modulo_dossier_pdf.py`,
  20 tests según el estado del proyecto), pero:
  - No tiene `if __name__ == "__main__"` — ni siquiera es invocable por CLI
    directamente, solo importable como librería.
  - Cero referencias a "dossier"/"Dossier" en todo `app/`, `lib/`,
    `components/` (grep exhaustivo, 0 resultados).
  - **Esta aplicación Next.js no tiene ningún Route Handler/API endpoint**
    (`find app -iname "route.js"` → vacío) — no hay ningún puente entre el
    frontend y un script Python en tiempo de ejecución real. Los scripts
    Python de este repo son todos herramientas standalone (ETL, QC, DDS,
    Dossier), nunca invocados desde una request HTTP.
  - **Conclusión: hoy no existe ninguna forma de que un usuario de RYZOS
    genere/descargue un Dossier Comercial PDF desde la aplicación web.**
    Solo es alcanzable ejecutando Python manualmente contra un payload que
    alguien construya a mano.

### (d) Brechas para el 100% del módulo

1. **Dossier Comercial inalcanzable desde la UI** (ver arriba) — el gap
   más significativo encontrado. Cerrarlo requiere una decisión de
   arquitectura que excede el alcance de esta auditoría (no está en la
   lista de archivos a crear/modificar de esta tarea): las opciones reales
   son (i) portar `build_pdf_dossier` a una librería JS (ej. `pdf-lib`) e
   invocarla desde un Route Handler o directo en el cliente, (ii) crear un
   Route Handler que haga `child_process` hacia el Python (fragil en
   despliegue serverless tipo Vercel, que no incluye runtime Python), o
   (iii) desplegar el generador Python como un servicio HTTP aparte. No se
   implementa ninguna en esta tarea — se deja documentado para que el
   usuario decida la dirección antes de tocar código.
2. **`/dashboard/lotes` no ofrece descarga real de DDS** — solo genera un
   QR de muestra. Si la intención del usuario es que "Lotes" sea la
   pantalla real de exportación (no solo el mapa), falta agregar ahí un
   botón equivalente a `handleExportDDS` de `MapDashboard.jsx`. No
   implementado en esta tarea (cambio de UI no solicitado explícitamente,
   y `/dashboard/mapa` ya cubre la función real).
3. **Cobertura de tests de `lib/eudrDdsExporter.js`: antes de esta tarea,
   0 tests directos** (`tests/test_trace_public.mjs` usa payloads con la
   misma forma pero nunca importa ni ejercita `buildTracesPayload`/
   `resolveOrganizationId`/`validatePlotGeometry` directamente). Cerrado en
   esta tarea — ver `tests/test_eudr_dds_exporter.mjs`.

## Criterios de aceptación

- AC1: coordenadas redondeadas a 6 decimales en el GeoJSON exportado.
- AC2: una parcela ≥ 4 ha sin geometría poligonal lanza
  `EUDRValidationError`; una parcela < 4 ha con `Point` no lanza excepción.
- AC3: `resolveOrganizationId` detecta correctamente violaciones
  multi-tenant (más de un `ID_Organizacion` en el mismo set de registros).
- AC4: `buildTracesPayload` agrupa múltiples filas de la misma parcela en
  una sola `Feature`, y filtra estrictamente `estado_revision !== 'APROBADO'`.
- AC5: `node --test tests/test_eudr_dds_exporter.mjs` pasa al 100%.
