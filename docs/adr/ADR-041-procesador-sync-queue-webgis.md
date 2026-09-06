# ADR-041 — Procesador server-side de `SYNC_QUEUE` para el dominio WebGIS

- **Estado:** Implementado — código escrito, verificación funcional
  real hecha contra producción, commiteado y pusheado a `staging`.
- **Migraciones:** ninguna — usa el schema de `SYNC_QUEUE` ya creado en
  `ADR-040`, sin cambios.
- **Spec:** `specs/sync_queue_webgis_ingestion.md` (nueva, este ADR —
  no existía antes de esta tarea, ver corrección de contrato abajo).
- **Código:** `lib/actions/syncGisActions.js` (nuevo) —
  `processWebGisSyncQueue()`.
- **Tests:** ninguno automatizado — verificación funcional real contra
  producción, con sesión real, invocando la función de verdad dentro
  de un Route Handler temporal (ver "Cómo se verificó" abajo), sobre
  filas descartables creadas y borradas en la misma verificación.
- **Contexto previo:** `ADR-040` (`SYNC_QUEUE`, schema real); `ADR-038`
  (`uploadGeoSpatialFeature` ya migrada a sesión real, reutilizada acá
  sin cambios).

## Corrección de contrato, verificada contra el schema real antes de escribir código

El prompt original describía columnas de `SYNC_QUEUE` que **no
existen**: `tabla_destino`, `error_log`, `synced_at`. El schema real
(`ADR-040`, aplicado un turno antes de este) usa **`entity_type`**,
**`error_mensaje`** y **`procesado_en`**. Se usan los nombres reales —
no se renombraron las columnas de `ADR-040` para no generar una
migración de churn sin ningún beneficio real (nada más las consume
todavía). `specs/sync_queue_webgis_ingestion.md` tampoco existía — se
redactó desde cero, definiendo ahí el contrato exacto de `payload`
(`{ feature, fieldOverrides }`, el mismo que ya recibe
`uploadGeoSpatialFeature`) ya que el prompt no lo especificaba con
precisión suficiente para implementar contra el schema real.

## Decisión: reusar `uploadGeoSpatialFeature`, no escribir esquemas Zod nuevos

El prompt pedía "validar el payload contra el esquema Zod
correspondiente" — no existe ningún esquema Zod para
`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` en este repo (el
único módulo GIS con Zod real es `createParcela`/`PADRON_PARCELAS`).
Escribir esquemas Zod nuevos para estas 3 tablas duplicaría validación
que ya existe, ya está probada en producción, y ya vive dentro de
`uploadGeoSpatialFeature` y sus helpers
(`assertSocioActivoOSinValor`/`assertParcelaActivaOSinValor`/
`geoJsonToWkt`/campos requeridos por tabla) — dos fuentes de verdad
para la misma regla que divergirían con el tiempo, exactamente el tipo
de riesgo que este proyecto ya evitó en decisiones anteriores (ver
`ADR-021`, `ADR-038`).

`processWebGisSyncQueue` llama directo a
`uploadGeoSpatialFeature(entity_type, feature, null, fieldOverrides)`
por fila. El `null` en `organizationId` es intencional: desde
`ADR-038`, las 3 ramas EUDR de esa función ya ignoran ese parámetro por
completo y resuelven la organización real vía `auth_org_id()` bajo la
sesión activa — el mismo mecanismo que este procesador ya usa para
leer/escribir `SYNC_QUEUE`. Cualquier error que `uploadGeoSpatialFeature`
lance (geometría corrupta, campo requerido faltante, socio/parcela
inexistente, error real de Postgres/RLS) se captura una sola vez y su
`.message` se guarda tal cual en `error_mensaje` — sin reinterpretarlo,
mismo criterio que ya usa `uploadGeoSpatialBatch` en el mismo archivo.

## Qué hace `processWebGisSyncQueue`

1. Cliente de sesión real (`createSessionServerClient`) — el RLS de
   `rls_org_sync_queue` (`ADR-040`) ya scopea las filas visibles a la
   organización de la sesión activa.
2. Consulta `SYNC_QUEUE` con `estado = 'PENDIENTE'`,
   `operation = 'INSERT'`, `entity_type IN ('EUDR_MONITOREO',
   'EUDR_USO_SUELO', 'EUDR_INSTALACIONES')` — nunca
   `PADRON_PARCELAS`, fuera del dominio WebGIS de esta tarea aunque
   `uploadGeoSpatialFeature` también la soporte. `operation IN
   ('UPDATE', 'DELETE')` queda sin tocar (fuera de alcance, ver spec).
3. Por cada fila, en orden de creación: llama a
   `uploadGeoSpatialFeature` con el `payload` de la fila. Éxito →
   `estado = 'PROCESADO'`, `procesado_en = now()`, `error_mensaje =
   NULL`. Falla → `estado = 'ERROR'`, `error_mensaje = <mensaje real>`,
   `procesado_en` sin tocar. Una fila que falla no aborta el resto del
   lote (mismo patrón que `uploadGeoSpatialBatch`).
4. Devuelve `{ procesados, errores, total, detalles }` — sin UI, cron
   ni endpoint programado que la invoque todavía (no pedido, ver spec).

## Cómo se verificó (sin invocar la Server Action directamente desde un script)

`createSessionServerClient()` usa `next/headers`, que **no funciona
fuera de un Server Component/Server Action/Route Handler real** — a
diferencia de `ADR-035`–`040` (consultas de una sola tabla,
replicables 1:1 con REST + `access_token`), `processWebGisSyncQueue`
es una función que orquesta lógica real (recorre filas, invoca otra
función, hace escrituras condicionales) — replicarla con REST habría
significado reimplementarla en el script de prueba, probando la
reimplementación en vez del código real.

Se creó un Route Handler temporal (`app/api/test-adr041-tmp/route.js`,
**borrado antes de este commit** — nunca llegó a `staging`) que corre
dentro de un request real de Next.js: recibe un `hashedToken` de magic
link, llama `supabase.auth.verifyOtp(...)` con el cliente de sesión
(estableciendo la sesión real en las cookies de ese mismo request), y
en el mismo request invoca `processWebGisSyncQueue()` de verdad — el
código de producción, sin ninguna reimplementación.

1. **Setup** (Service Role Key): 3 filas `SYNC_QUEUE`
   `PENDIENTE`/`ORG-TEST-DEMO` —
   (A) `EUDR_MONITOREO` válida (`Point`, sin socio/parcela — opcionales),
   (B) `EUDR_USO_SUELO` sin `id_parcela` (campo requerido faltante),
   (B2) `EUDR_INSTALACIONES` con geometría `GeometryCollection`
   (tipo no soportado).
2. **Sesión real** `admin-demo@ryzos-demo.test` (`ORG-TEST-DEMO`, magic
   link, mismo mecanismo que `ADR-035`–`040`) → `POST
   /api/test-adr041-tmp` con el `hashedToken`.
3. **Resultado real:** `{ "procesados": 1, "errores": 2, "total": 3 }`.
   Fila A → `ok: true, created: true`. Fila B → `ok: false, error:
   'Falta "id_parcela" — requerido para EUDR_USO_SUELO.'`. Fila B2 →
   `ok: false, error: 'Tipo de geometría no soportado para WKT:
   GeometryCollection'`.
4. **Confirmado con Service Role Key:** `SYNC_QUEUE` fila A →
   `estado: 'PROCESADO'`, `error_mensaje: null`, `procesado_en`
   poblado. Filas B/B2 → `estado: 'ERROR'`, `error_mensaje` con el
   mensaje real exacto. `EUDR_MONITOREO` tiene 1 fila nueva,
   `ID_Organizacion: 'ORG-TEST-DEMO'` correcto, `estado_revision:
   'PENDIENTE'` (el trigger sanitizador corrió — `area_calculada_ha:
   null` es el resultado esperado para una geometría `Point`, no un
   fallo).
5. **Limpieza:** las 3 filas `SYNC_QUEUE` y la fila `EUDR_MONITOREO`
   borradas con Service Role Key. Confirmado `0` filas restantes en
   `SYNC_QUEUE`/`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`
   después. El Route Handler temporal se borró del todo — no forma
   parte de este commit.

`npm run build`/`npm run lint`: limpios, mismas 19 rutas (sin la ruta
temporal), mismos warnings preexistentes.

## Qué queda fuera

Procesar `operation IN ('UPDATE', 'DELETE')`; cualquier UI/cron que
dispare `processWebGisSyncQueue` automáticamente; esquemas Zod para
estas 3 tablas (ver decisión arriba) — todo documentado en
`specs/sync_queue_webgis_ingestion.md`.
