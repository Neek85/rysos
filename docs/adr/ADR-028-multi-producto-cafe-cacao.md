# ADR-028 — Multi-producto (café/cacao): PRODUCTOS/ORGANIZACION_PRODUCTOS, `id_producto_predominante` y conexión al exportador DDS

- **Estado:** Aceptado — migración escrita, código de aplicación
  actualizado, tests nuevos pasando (434 passed / 0 failed / 29 skipped
  en pytest; 576 passed / 0 failed en `node --test tests/*.mjs`).
  Pendiente de aplicación manual en Supabase Studio (mismo flujo de
  siempre en este repo); los tests Live se auto-saltan hasta entonces.
- **Fecha:** 2026-08-26
- **Migraciones:** `supabase/migrations/20260826120000_multi_producto_cafe_cacao.sql`
- **Spec:** `specs/multi_producto_cafe_cacao.md` (4 rondas de auditoría —
  contrato de datos cerrado en la sección 8, evidencia técnica del
  vínculo `EUDR_USO_SUELO`↔`PADRON_PARCELAS` en la sección 6)
- **Tests:** `tests/test_multi_producto_cafe_cacao.py`
  (`TestMigrationFileStatic`: 18 casos sobre la estructura de la
  migración, siempre corre; `TestMultiProductoCafeCacaoLive`: 8 casos
  funcionales contra Supabase Live, auto-skip hasta aplicar la
  migración), `tests/test_multi_producto_code_sites.mjs` (9 casos
  estructurales sobre `socios.js`/`sociosActions.js`/
  `ParcelaFormModal.jsx`/`sociosSearch.js`), más 4 casos nuevos en
  `tests/test_eudr_dds_exporter.mjs` (`producto_codigo`/`producto_nombre`
  en `buildTracesPayload`) y 2 assertions actualizadas en
  `tests/test_padron_csv.mjs` (label de `hcp`/`hcc`).
- **Contexto previo:** `ADR-026` (PK surrogate `id` uuid en
  `PADRON_PARCELAS` — no usado por este diseño, que sigue anclando en
  `ID_Parcela_Fija`/`ID_Organizacion` igual que el resto del núcleo GIS),
  `ADR-027` (mismo protocolo de "arrancar en blanco, verificar con
  evidencia antes de asumir", mismo patrón de RLS/GRANTs replicado acá),
  `ADR-010`/`ADR-021` (origen real de `EUDR_USO_SUELO.id_parcela` como
  GUID crudo de QField — la premisa técnica detrás del trigger de este
  ADR), `ADR-017` (formato real del exportador DDS, `buildTracesPayload`/
  `buildOfficialEuGeoJson`).

## Contexto

RYZOS documentaba y operaba como un sistema exclusivamente cafetalero
(texto de UI, exportador DDS, y dos columnas físicas de `PADRON_PARCELAS`
literalmente rotuladas "Café Podado"/"Café en Crecimiento") sin ninguna
estructura de datos que representara qué producto trabaja una
organización o una parcela. La auditoría de 4 rondas
(`specs/multi_producto_cafe_cacao.md`) confirmó en vivo: cero columnas
de producto en las 3 tablas núcleo GIS; que `hcp`/`hcc` son un concepto
universal (en producción/en crecimiento) mal rotulado, no una limitación
de esquema; que `EUDR_USO_SUELO.id_parcela` no es una FK real a
`PADRON_PARCELAS` sino el GUID crudo de QField del `EUDR_MONITOREO`
padre (cadena de 2 saltos sin FK en ningún tramo); y que el exportador
DDS lee exclusivamente de `vw_monitoreo_web`, nunca de las tablas núcleo
directamente.

## Decisión

**2 tablas nuevas**, contrato cerrado en la ronda 4 de la spec (sección 8):

- `PRODUCTOS` (`id`/`codigo`/`nombre`/`vertical` con `CHECK IN
  ('AGRICOLA','PECUARIO')`/`activo`/`creado_en`) — catálogo puro,
  sembrado con 2 filas (`CAFE`, `CACAO`, ambas `AGRICOLA`).
- `ORGANIZACION_PRODUCTOS` — membresía N-a-N (una organización puede
  trabajar café y cacao a la vez), FK real a `ORGANIZACIONES("ID")`
  (`text`). Sin seed: se llena por organización cuando corresponda.

**`id_producto_predominante` en 2 tablas, con roles distintos:**

- `PADRON_PARCELAS.id_producto_predominante` (nullable, FK a
  `PRODUCTOS`) — el dato **maestro editable**, la fuente de verdad de
  "qué produce esta parcela hoy". Con **backfill obligatorio** de las
  filas existentes a `CAFE` en la misma migración — decisión que las
  rondas 2/3 de la spec no habían cerrado (la sección 2.3, ronda 1, la
  dejaba explícitamente como pregunta sin resolver); confirmada
  directamente por el usuario en la ronda 4, no asumida.
- `EUDR_USO_SUELO.id_producto_predominante` (nullable, FK a
  `PRODUCTOS`) — una **foto**, copiada al momento exacto de cada evento
  de monitoreo. Justificado con evidencia real (sección 6.2 de la spec):
  ya existen hoy múltiples eventos de monitoreo por parcela a lo largo
  del tiempo (hasta 4 para una misma parcela); si el producto cambia
  entre visitas, cada `EUDR_USO_SUELO` histórico debe conservar el que
  tenía en ESE momento, no el valor actual del padrón.

**Poblado por trigger `BEFORE INSERT` sobre `EUDR_USO_SUELO`**
(`fn_set_producto_predominante_uso_suelo` /
`trg_set_producto_predominante_uso_suelo`), no por código de aplicación.
Resuelve la cadena real de 2 saltos (`ADR-010`): `NEW.id_parcela` (GUID
crudo de QField) → `EUDR_MONITOREO.qfield_relation_id` → su
`ID_Parcela_Fija` → `PADRON_PARCELAS` (por `ID_Parcela_Fija` +
`ID_Organizacion`) → su `id_producto_predominante`.

**Crítico, y verificado por test (`test_trigger_no_bloqueante_*`): el
trigger NUNCA lanza una excepción.** Si cualquier salto de la cadena no
resuelve (parcela no encontrada, sin monitoreo asociado, parcela sin
producto asignado), `NEW.id_producto_predominante` queda `NULL` y el
`INSERT` continúa. Motivo: `EUDR_USO_SUELO` se puebla mayormente vía
`scripts/etl_drive_to_supabase.py` en lotes de GeoPackages QField sin
supervisión interactiva — una excepción ahí rompería la ingesta completa
de un archivo por una sola subdivisión sin producto resuelto. Con el
trigger a nivel de base de datos, los 2 sitios de aplicación que insertan
`EUDR_USO_SUELO` (`lib/actions/gisActions.js::uploadGeoSpatialFeature` y
`scripts/etl_drive_to_supabase.py::build_uso_suelo_payload`) quedan
cubiertos automáticamente sin que ninguno de los 2 necesite construir la
cadena de resolución en código de aplicación.

**RLS/GRANTs** replican exactamente el patrón ya establecido en
`ADR-027`: `PRODUCTOS` (catálogo global) usa `SELECT` abierto para
`anon` (`USING (true)`); `ORGANIZACION_PRODUCTOS` (org-scoped) usa
`SELECT` para `anon` con `USING (id_organizacion IS NOT NULL)`. Ninguna
tiene política de escritura para `anon`.

**Extensión de `vw_monitoreo_poligonos`/`vw_monitoreo_web`** — solo la
rama "poligono" (`EUDR_INSTALACIONES`/rama "punto" no tiene producto,
queda `NULL` para alinear el `UNION ALL`). Se decidió exponer
`id_producto_predominante` primero en `vw_monitoreo_poligonos` (mismo
criterio ya usado para `area_calculada_ha`/`requiere_revision_area` en
`20260818_fix_views_eudr_flags.sql`: esa vista sirve además de fuente de
auditoría QGIS Desktop, no solo del Dashboard Web), y desde ahí
`vw_monitoreo_web` agrega un `LEFT JOIN` adicional contra `PRODUCTOS`
para exponer `producto_codigo`/`producto_nombre` legibles (mismo patrón
que la vista ya usa para `productor_nombre` vía `PADRON_SOCIOS`). Ambas
vistas se extendieron con `CREATE OR REPLACE VIEW`, agregando columnas
al final de cada rama — sin `DROP VIEW`, sin tocar ningún `JOIN`/filtro/
columna existente.

**El `JOIN` ya roto contra `PADRON_PARCELAS`** (`src."ID_Parcela_Fija" =
pp."ID_Parcela_Fija"`, que no matchea para filas de origen
`EUDR_USO_SUELO` porque ese campo ahí es el GUID crudo de QField, no un
código real de parcela — hallazgo de la sección 6.1 de la spec) queda
**deliberadamente sin tocar**: `id_producto_predominante` se lee directo
de `EUDR_USO_SUELO` (vía el trigger), sin depender de ese `JOIN`. Su
arreglo queda para un ADR/spec futuro aparte, fuera de este alcance.

**Código de aplicación:**

- `lib/validations/socios.js::HECTARE_FIELDS` — `hcp`/`hcc` pasan de
  `'Ha. Café Podado'`/`'Ha. Café en Crecimiento'` a `'Ha. En
  Producción'`/`'Ha. En Crecimiento'` (texto genérico, la columna física
  no cambia). `ParcelaFormModal.jsx`/`lib/padronCsv.js` heredan el label
  nuevo automáticamente — son consumidores de la misma fuente única, no
  se tocaron directamente.
- `ParcelaFormModal.jsx` — nuevo `<select>` para `id_producto_predominante`,
  poblado desde `PRODUCTOS` filtrando `vertical = 'AGRICOLA'` y
  `activo = true` (sin productos `PECUARIO` todavía). `parcelaSchema`/
  `PARCELA_DEFAULT_VALUES` (`lib/validations/socios.js`) y `parcelaPayload`
  (`lib/actions/sociosActions.js`) extendidos — `createParcela`/
  `updateParcela` no necesitaron cambio propio, ya spreadean
  `parcelaPayload(...)`. `lib/sociosSearch.js::PARCELA_COLUMNS` gana la
  columna nueva (sin esto, la edición no podía pre-seleccionar el
  producto real).
- `lib/eudrDdsExporter.js::buildTracesPayload` — agrega
  `producto_codigo`/`producto_nombre` al payload interno, vía un nuevo
  helper `pickProducto(groupRecords)` que escanea **todo el grupo** de
  registros de una parcela (mismo patrón que `pickCumpleEudr`), no solo
  `pickBoundaryRecord` — necesario porque `pickBoundaryRecord` prefiere
  la fila `EUDR_MONITOREO` (el perímetro real) cuando existe, y esa fila
  **nunca** trae `producto_codigo` (el trigger solo puebla
  `EUDR_USO_SUELO`). Sin este helper, una parcela con perímetro
  `EUDR_MONITOREO` + subdivisión `EUDR_USO_SUELO` con producto perdería
  el dato silenciosamente. **No** se agregó a `buildOfficialEuGeoJson`
  (el GeoJSON oficial EUDR): la spec (sección 1.7) no encontró evidencia
  de un campo de producto/commodity confirmado en el esquema real de
  TRACES NT — se prefiere omitir a inventar un nombre de propiedad
  oficial no verificado.
- `components/gis/MapDashboard.jsx` — el `.select(...)` explícito de
  `vw_monitoreo_web` (línea ~470) gana las 3 columnas nuevas
  (`id_producto_predominante,producto_codigo,producto_nombre`); sin esto,
  agregar la columna a la vista no la hace llegar a `records` (regla ya
  documentada en `CLAUDE.md`: un `SELECT` explícito no expone columnas
  nuevas por sí solo).

## Consecuencias

- **Diferido a propósito, sin implementar en esta ronda:** un filtro de
  UI por producto en `/dashboard/mapa` (`MapDashboard.jsx`). No existe
  hoy ningún patrón de filtro similar (ej. por certificación) que
  extender — inventar uno desde cero quedaba fuera del alcance mecánico
  de esta implementación (mismo criterio que ADR-027 sección "Pendiente,
  diferido a propósito" para la UI de certificaciones). Queda como
  trabajo de UI futuro, no bloqueante.
- `SocioFormModal`/el listado de `/dashboard/socios` no muestran el
  producto de una parcela en ningún lugar todavía — solo el formulario
  de edición/alta (`ParcelaFormModal.jsx`) lo expone. Igual que ADR-027,
  esto es alcance de rediseño de UI, no una extensión mecánica.
- El bug preexistente del `JOIN` roto contra `PADRON_PARCELAS` en
  `vw_monitoreo_web`/`vw_monitoreo_poligonos` (filas de origen
  `EUDR_USO_SUELO`) sigue sin corregirse — documentado, deliberadamente
  fuera de este alcance, con su propio ADR/spec futuro.
- `scripts/etl_drive_to_supabase.py::build_uso_suelo_payload` no necesitó
  ningún cambio de código: el trigger cubre la resolución del producto
  automáticamente para cualquier `INSERT` en `EUDR_USO_SUELO`,
  independientemente de qué código lo origine.
