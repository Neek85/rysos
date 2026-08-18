# Spec — Auditoría y blindaje anti-PII del Portal Público de Trazabilidad

## Contexto

`app/trace/[lot_hash]/page.jsx` es un Server Component público (sin
`'use client'`) que resuelve un `lot_hash` de 16 hex chars a un lote
sanitizado, recalculando el hash de cada organización sobre
`vw_monitoreo_web` hasta encontrar coincidencia (no hay una columna
`lot_hash` persistida — ver el `INVARIANTE` ya documentado en el propio
archivo). Contraparte JS de `scripts/generate_lot_qr.py`/
`PublicTraceabilityService` (Tarea 14, Python), implementada en
`lib/traceabilityHash.js`.

## Resultado de la auditoría (los 3 criterios del prompt)

### (a) SHA-256 + sanitización PII estricta — ✅ correcto en el código en vivo, con una discrepancia documentada (no explotable hoy)

- `generateLotHash()` usa `crypto.subtle.digest('SHA-256', ...)` truncado a
  16 hex chars — mismo algoritmo que `PublicTraceabilityService.generate_lot_hash()`
  en Python (`hashlib.sha256(...).hexdigest()[:16]`).
- `buildPublicSanitizedPayload()` filtra `PII_FIELDS` (`socio_dni`,
  `socio_nombre`, `socio_nombre_completo`, `conyuge_dni`, `productor`,
  `id_parcela`) de `properties` de cada Feature antes de devolver el
  payload. Confirmado que `buildTracesPayload()` (`lib/eudrDdsExporter.js`)
  sí pone `productor`/`id_parcela` en `properties` — la sanitización no es
  un no-op, remueve datos reales.
- `PublicLotMap.jsx` (el único componente que renderiza las properties de
  cada Feature) solo lee `parcela_codigo`/`hectareas` en su popup — ningún
  campo PII llega al DOM.

**Discrepancia encontrada (no un hallazgo del alcance pedido, pero relevante
para la garantía "mismo hash entre Python y JS" que el propio código
documenta como invariante):** `lib/traceabilityHash.js::generateLotHash()`
concatena `feat.properties.id_monitoreo ?? feat.properties.id_parcela ?? ''`
por feature, mientras que `scripts/generate_lot_qr.py::generate_lot_hash()`
usa únicamente `feat.get("properties", {}).get("id_monitoreo", "")` — sin
fallback a `id_parcela`. Como `buildTracesPayload()` (el único generador de
payload realmente usado por la ruta pública en vivo) **nunca** incluye
`id_monitoreo` en `properties` (solo `id_parcela`), el hash real que ve un
usuario en `/trace/[lot_hash]` siempre se calcula con `id_parcela` — camino
consistente y correcto en la práctica. Pero si algún día el script Python
se apuntara a generar un payload con esta misma forma (`vw_monitoreo_web`),
produciría un hash **distinto** al de la ruta web para el mismo lote,
violando el invariante documentado ("un mismo lote produce siempre el mismo
hash entre Python y JS"). **Confirmado que esto no ocurre hoy:**
`tests/test_tarea14_trazabilidad.py` solo usa fixtures que sí incluyen
`id_monitoreo` explícito — el script Python nunca se ejercita contra la
forma de payload real de `vw_monitoreo_web`. Además, `_PII_FIELDS` en
Python (`scripts/generate_lot_qr.py`) no incluye `productor`/`id_parcela`
— coherente con que apunta a un schema distinto donde esos campos no
existen bajo esos nombres, no un descuido. **No se corrige en esta tarea**
(fuera del alcance de archivos pedido — tocaría `scripts/generate_lot_qr.py`
y su test Python) — se deja documentado aquí y en `docs/schema_live.md`
para que si alguien reutiliza el script Python contra el schema nuevo, sepa
que debe alinear `parts`/`_PII_FIELDS` primero.

### (b) Sin sesión de usuario, aislamiento de datos privados — ✅ correcto, sin cambios

- `findLotByHash()` crea el cliente Supabase con
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, sin autenticación — acceso público real.
- La consulta a `vw_monitoreo_web` trae registros de **todas** las
  organizaciones (`vw_monitoreo_web` no filtra por `ID_Organizacion`, por
  diseño — la URL pública no lleva organización, así que hay que probar
  candidatas). Esto es seguro porque `findLotByHash()` corre enteramente
  **del lado del servidor** (Server Component, sin `'use client'` en
  `page.jsx`) — el conjunto completo multi-organización nunca cruza la red
  hacia el navegador; solo el payload ya sanitizado de la ÚNICA organización
  cuyo hash coincide se serializa en el HTML de respuesta. El resto de
  organizaciones se descartan en memoria del servidor tras el chequeo de
  hash.
- Confirmado (releyendo el bucle `for...of byOrg.entries()`) que la función
  retorna en el primer match y nunca acumula ni expone datos de más de una
  organización.

### (c) Sin `console.log` de datos sensibles — ✅ correcto, sin cambios

Grep exhaustivo sin resultados en: `app/trace/[lot_hash]/page.jsx`,
`lib/traceabilityHash.js`, `lib/eudrDdsExporter.js`, `lib/qrGenerator.js`,
`components/gis/PublicLotMap.jsx`.

## Nota de contexto — el "4.0 ha" real del sistema

`lib/eudrDdsExporter.js` define `MIN_POLYGON_HECTARES = 4.0` y
`validatePlotGeometry()`: una parcela con área ≥ 4 ha **debe** tener un
límite poligonal registrado (no solo un punto) para poder generar una DDS
válida — si no, `buildTracesPayload()` lanza `EUDRValidationError` y esa
organización simplemente no participa en la búsqueda pública de esa
inspección (capturado por el `try/catch` de `findLotByHash`, no tumba la
página para las demás organizaciones). Esta es la regla real de "4 ha" que
existe en RYZOS — un requisito de **calidad de geometría para exportar DDS**,
no un umbral de admisión de parcelas. Confirma por qué la instrucción de
una tarea anterior de "rechazar geometrías < 4 ha al insertar" no tenía
respaldo en el sistema real (se había confundido con esta regla, que actúa
en un punto y con un propósito completamente distintos).

## Ninguna acción de código nueva en `app/trace/[lot_hash]/` ni en las
librerías auditadas — el hallazgo (a) es una nota de riesgo latente en
`scripts/generate_lot_qr.py`, fuera del alcance de archivos de esta tarea.

## Criterios de aceptación

- AC1: `generateLotHash()` es determinista y produce 16 chars hexadecimales.
- AC2: `buildPublicSanitizedPayload()` remueve los 6 campos de `PII_FIELDS`
  de cada Feature, preservando geometría y campos no-PII.
- AC3: Un hash inválido/inexistente no lanza excepción no controlada.
- AC4: `node --test tests/test_trace_public.mjs` pasa al 100%.
