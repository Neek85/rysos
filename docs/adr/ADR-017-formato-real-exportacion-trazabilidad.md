# ADR-017 — El exportador de /dashboard/mapa usa el esquema GeoJSON real de la UE, no un "DDS" propio

- **Estado:** Aceptado y verificado en vivo (ORG-TEST-E2E)
- **Fecha:** 2026-08-23
- **Código:** `lib/eudrDdsExporter.js` (reescritura), `lib/traceabilityHash.js`
  (`PII_FIELDS` +1 campo), `components/gis/MapDashboard.jsx`
  (`handleExportDDS`, `fetchRecords`, botón/select), `app/api/gis/dds-cobertura/route.js`
  (nuevo)
- **Tests:** `tests/test_eudr_dds_exporter.mjs` (+18 tests),
  `tests/test_trace_public.mjs` (actualizado — 7mo campo PII)

## El problema real

`lib/eudrDdsExporter.js` y sus specs (`specs/fase5_eudr_reportes.md`,
`docs/RYZOS_ORQUESTADOR_V3.1.md`, `scripts/generate_eudr_dds.py`)
afirmaban, sin ninguna fuente citada en el repo, que el JSON completo que
arma `buildTracesPayload` (`declaration_type`, `regulation`,
`organization_id`, `total_plots`, `total_hectares`, `geojson` con
properties `id_parcela`/`parcela_codigo`/`productor`/`cumple_eudr`/
`hectareas`) era **"la estructura oficial exigida por TRACES EU"**. Una
investigación previa a esta tarea (ver `specs/traces_eudr_dossier_audit.md`
y la conversación de esa investigación) no encontró ningún schema, XSD,
enlace a documentación de la Comisión Europea, ni ejemplo de payload real
de TRACES en el repo que respaldara esa afirmación.

Investigación externa (aportada por el usuario, aplicada tal cual):

- **RYZOS no presenta la DDS directamente ante TRACES** — el comprador/
  importador europeo lo hace. RYZOS solo necesita entregar un paquete de
  datos limpio y correctamente formateado.
- El **documento DDS en sí** (la declaración "libre de deforestación") es
  un XML/SOAP con estructura completamente distinta (`activityType`,
  `commodities`, `producers`, `geometryGeojson` en base64) — fuera de
  alcance, RYZOS no lo construye.
- El **archivo GeoJSON de geolocalización** que acompaña esa DDS sí tiene
  un esquema oficial y público (EUDR Information System / TRACES NT,
  servidor ACCEPTANCE): `FeatureCollection` estándar, properties opcionales
  con casing exacto `ProducerName`/`ProducerCountry` (ISO-3166-1 alfa-2)/
  `ProductionPlace`/`Area` (siempre numérico — el sistema real lo trata
  como 0 si llega como string), geometrías `Point`/`MultiPoint`/`Polygon`/
  `MultiPolygon`/`GeometryCollection` — **nunca** `LineString`/
  `MultiLineString`, polígonos cerrados y sin auto-intersecciones, WGS84/
  EPSG:4326 con máximo 6 decimales.

## La corrección

**Dos representaciones distintas, que antes se confundían en una sola:**

1. **Payload interno** (`buildTracesPayload`, sin cambios de forma) — sigue
   siendo `organization_id`/`total_plots`/`total_hectares`/`geojson` con
   properties propias de RYZOS. Ya **no se describe como
   `DUE_DILIGENCE_STATEMENT`** (ahora `RYZOS_TRACEABILITY_PACKAGE_SUMMARY`)
   — es una hoja de resumen interna, nunca un estándar externo. Se
   mantiene sin cambios de forma a propósito: es la misma forma que
   consumen `lib/traceabilityHash.js::generateLotHash` (hash público
   determinista de `/trace/[lot_hash]`, lee `organization_id`/
   `total_plots`/`total_hectares`/`properties.id_monitoreo`/`id_parcela`)
   y `components/gis/PublicLotMap.jsx` (lee `properties.parcela_codigo`/
   `.hectareas` para las etiquetas del mapa público) — cambiar su forma
   habría roto ambos consumidores en vivo (ver "Decisión descartada"
   abajo).
2. **GeoJSON oficial** (`buildOfficialEuGeoJson`, nueva función) — proyecta
   el payload interno al esquema real de la UE: únicamente
   `ProducerName`/`ProducerCountry`/`ProductionPlace`/`Area`, casing
   exacto, `Area` siempre numérico. Un dato no disponible se **omite**
   (nunca se inventa), salvo `Area` que siempre se envía calculada — nunca
   se depende del default implícito de 4 ha que asume TRACES para un punto
   sin `Area`. `ProducerCountry` es literal `'PE'` (único país operado hoy;
   no existe un campo de país real en `vw_monitoreo_web`/
   `PADRON_PARCELAS`).

`downloadTraceabilityPackage(payload, format)` reemplaza a la antigua
`exportTracesDDS`: `format='json'` descarga el payload interno completo
(incluye `cobertura_uso_suelo` si se adjuntó); `format='geojson'` descarga
**exclusivamente** la proyección oficial — nunca el mismo objeto en dos
envoltorios, como pasaba antes.

**UI (`MapDashboard.jsx`):** el botón "📄 Exportar DDS" pasa a
"📄 Exportar Paquete de Trazabilidad"; el `<select>` de formato ya no dice
"DDS Completo (JSON)" sino "Paquete Completo (JSON)" / "Geolocalización
(GeoJSON — esquema oficial UE)"; se agrega el texto de ayuda: *"Paquete de
datos para entregar al comprador/importador, quien presenta la declaración
final ante la UE."*

## Bug real encontrado en la verificación en vivo (no en el prompt original)

Al verificar contra datos reales de `ORG-TEST-E2E`, `ProducerName` salía
como `"JS-00002"` — un código interno, no un nombre. Causa: `vw_monitoreo_web`
resuelve `productor` a `COALESCE(m."ID_Socio", m.nuevo_productor_nombre)`
(ver `20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql`) —
casi siempre un código, no un nombre de persona. El nombre real ya vive
resuelto en una columna separada, `productor_nombre`
(`COALESCE(ps.socio_nombre_completo, ps_parcela.socio_nombre_completo,
src.productor, mon.productor, 'Socio no asignado')`), que `MapDashboard.jsx`
ya pedía en su `SELECT` pero `buildTracesPayload` nunca copiaba a las
properties de cada Feature.

Corrección: se agregó `productor_nombre` a las properties internas de
`buildTracesPayload`, y `buildOfficialEuGeoJson` usa ese campo (no
`productor`) para `ProducerName` — tratando el sentinel literal `'Socio no
asignado'` como "no disponible" (se omite, no se envía ese texto como si
fuera un nombre real). Como `productor_nombre` es PII real (nombre de
persona), se agregó a `PII_FIELDS` en `lib/traceabilityHash.js` (ahora 7
campos, antes 6) para que nunca aparezca en el payload público sanitizado
de `/trace/[lot_hash]`.

## Cobertura de Uso de Suelo (Fase B) como nota informativa

El prompt original asumía que `groupByParcela`/`buildTracesPayload` podían
volverse `async` e invocar `fn_cobertura_uso_suelo_parcela` directamente
vía `supabase.rpc()` desde el navegador. Dos problemas reales lo impedían:

1. **RLS:** esa función no es `SECURITY DEFINER` y su propia migración
   (`supabase/migrations/20260823_155621_fn_cobertura_uso_suelo_parcela.sql`,
   líneas 29-33) documenta que solo debe invocarse con el Service Role Key,
   nunca con la anon key del navegador. Confirmado en vivo: la misma RPC,
   llamada con la anon key, devuelve `"Registro ... (EUDR_MONITOREO) no
   encontrado."` para un `id_monitoreo` real que sí existe (RLS bloquea el
   `SELECT` interno de la función, igual que el resto de las tablas base
   documentadas en el gotcha de RLS de `CLAUDE.md`).
2. **Round-trips en una ruta pública:** `buildTracesPayload` también la usa
   `lib/lotLookup.js::findLotByHash`, invocado en cada request no
   autenticado a `/trace/[lot_hash]` y su PDF — volverla `async` con una
   RPC por parcela habría multiplicado llamadas en una ruta pública que
   nunca muestra esa información.

Solución: `buildTracesPayload` sigue siendo síncrona, sin tocar. Dos
funciones nuevas y separadas en `lib/eudrDdsExporter.js`:

- `resolveMonitoreoIdsForCobertura(records)` — para cada parcela cuyo
  límite es un perímetro `EUDR_MONITOREO` real, devuelve su `id_monitoreo`
  (vía `registro_id`, agregado al `SELECT` de `fetchRecords` en
  `MapDashboard.jsx` — antes no se pedía). Parcelas cuyo límite es una
  subdivisión de Uso de Suelo sin perímetro propio quedan fuera
  (resolverlas requeriría el mismo join que ya usa
  `app/api/qc/cobertura-uso-suelo/route.js` — fuera de alcance, dado que
  esto es solo informativo).
- `attachCoberturaSummary(payload, records, coberturaByMonitoreoId)` —
  agrega `cobertura_uso_suelo` como campo **nuevo de nivel superior** del
  payload (nunca dentro de `organization_id`/`total_plots`/
  `total_hectares`/`geojson.features[].properties`, los únicos campos que
  `generateLotHash` usa — verificado con test que compara el payload antes/
  después). Nunca lanza, nunca bloquea (mismo criterio que ADR-011).

Nuevo Route Handler `app/api/gis/dds-cobertura/route.js` (Service Role Key,
`runtime = 'nodejs'`), batched: recibe `{ organizationId, monitoreoIds[] }`
y devuelve `{ result: { [monitoreoId]: rpcResult } }` en una sola llamada
HTTP — `handleExportDDS` la invoca una vez, no una vez por parcela. Defensa
en profundidad: descarta cualquier resultado cuyo `ID_Organizacion` no
coincida con el `organizationId` pedido, aunque el Service Role Key
bypasee RLS. Un fallo de red/RPC nunca bloquea la descarga — se exporta
igual, sin cobertura adjunta.

## Decisión descartada: unificar todo al esquema oficial

Se consideró (y se descartó, confirmado con el usuario) hacer que
`buildTracesPayload`/`groupByParcela` produjeran directamente el esquema
oficial de 4 properties en vez de mantener dos representaciones. Se
descartó porque `properties.id_monitoreo`/`id_parcela` es la entropía que
usa `generateLotHash` (quitarlos habría colapsado el hash — todas las
Features aportando `''`, cambiando el hash de cada lote ya impreso/
emitido) y `PublicLotMap.jsx` lee `properties.parcela_codigo`/`.hectareas`
directamente para las etiquetas del mapa público de `/trace/[lot_hash]`
(se habrían roto, cayendo a `"Parcela"`/`undefined`).

## Verificación en vivo (ORG-TEST-E2E, `jhtocgxlozfuzullrtol`)

12 registros aprobados / 6 parcelas reales. Resultados completos:

- `buildTracesPayload`: `declaration_type: "RYZOS_TRACEABILITY_PACKAGE_SUMMARY"`,
  6 Features, geometrías `MultiPolygon`/`Point` reales.
- `buildOfficialEuGeoJson`: cada Feature con **exactamente** las 4 keys
  permitidas (`Area`/`ProducerCountry`/`ProducerName`/`ProductionPlace`,
  ninguna extra), `Area` siempre `typeof === 'number'`. 2 parcelas con
  productor/nombre resueltos (`"VICTOR ABEL LINARES BUSTAMANTE"`,
  `"VICTORIA AGUILAR GUEVARA"` — nombres reales, no códigos, tras la
  corrección de arriba); 4 sin productor/parcela_nombre resueltos —
  `ProducerName`/`ProductionPlace` correctamente omitidos en esos casos,
  nunca inventados.
- `/api/gis/dds-cobertura`, invocado exactamente como lo haría el botón
  (POST JSON real contra `npm run dev`, no una llamada directa a la
  función): devolvió cobertura real para las 2 parcelas con perímetro
  `EUDR_MONITOREO` resoluble (`P-00004`: 0% de cobertura, hueco real;
  `P-00001`: 22.77% de cobertura, hueco real) — ambos casos reales de
  `hueco_cobertura: true` en la base, útiles para confirmar que el aviso
  se genera correctamente. La misma RPC con la anon key (en vez del
  Service Role Key del route) confirmó fallar como se predijo:
  `"Registro b12677bd-... (EUDR_MONITOREO) no encontrado."`.
- Casos límite del route: `organizationId` faltante → 400; `monitoreoIds`
  vacío → `{result: {}}`; `organizationId` que no coincide con los
  `monitoreoIds` reales → `{result: {}}` (filtrado silencioso, defensa en
  profundidad).
- `npm run build`: compila limpio, `/api/gis/dds-cobertura` aparece en el
  manifiesto de rutas dinámicas.
- Suite completa: `node --test tests/*.mjs` → **503/503**. `python -m
  pytest tests/test_fase5_reportes.py` → 25/25 (lógica Python no tocada,
  solo comentarios/docstrings corregidos).

## Fuera de alcance (a propósito)

- **Integración SOAP/API directa con TRACES** — RYZOS no presenta la DDS,
  el comprador/importador sí. No se construye ningún cliente TRACES.
- **El documento DDS/XML en sí** (`activityType`/`commodities`/`producers`/
  `geometryGeojson` en base64) — RYZOS no lo arma.
- **Renombrar `declaration_type` en la contraparte Python**
  (`scripts/generate_eudr_dds.py`) — solo se corrigieron sus comentarios/
  docstrings (pedido explícito del prompt); su valor sigue siendo
  `"DUE_DILIGENCE_STATEMENT"` en el lado Python. Queda documentado como
  inconsistencia conocida entre ambos generadores, no como bug — el script
  Python no tiene ningún punto de entrada desde la app web hoy (ver
  `specs/traces_eudr_dossier_audit.md`).
- **Resolver cobertura para parcelas sin perímetro `EUDR_MONITOREO` propio**
  (límite = subdivisión de Uso de Suelo) — requeriría el mismo join
  `EUDR_USO_SUELO.id_parcela -> EUDR_MONITOREO.qfield_relation_id` de
  `app/api/qc/cobertura-uso-suelo/route.js`; esas parcelas simplemente no
  aparecen en `cobertura_uso_suelo` hoy.
