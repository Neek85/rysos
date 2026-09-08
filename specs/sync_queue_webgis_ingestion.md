# Spec: Procesador server-side de `SYNC_QUEUE` para el dominio WebGIS

## Contexto

`SYNC_QUEUE` (`ADR-040`, `specs/mobile_offline_sync.md`) es una cola
genérica de mutaciones offline — ninguna app React Native/Expo existe
todavía, así que hoy esta cola solo puede sembrarse manualmente (para
pruebas) o, en el futuro, desde una app móvil real. Esta tarea agrega
el primer **consumidor** de esa cola: una Server Action que drena las
filas `PENDIENTE` que apuntan a las 3 tablas EUDR (`EUDR_MONITOREO`/
`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`) y las inserta de verdad.

## Corrección de contrato (verificada contra el schema real antes de escribir código)

El prompt original describía columnas de `SYNC_QUEUE` que no existen:
`tabla_destino`, `error_log`, `synced_at`. El schema real, creado en
`ADR-040` hace un turno, usa **`entity_type`** (no `tabla_destino`),
**`error_mensaje`** (no `error_log`) y **`procesado_en`** (no
`synced_at`) — confirmado releyendo la migración
`20260906100000_mobile_offline_sync_tables.sql` que este mismo repo ya
tiene aplicada. Esta tarea usa los nombres reales, no los del prompt —
no se renombran las columnas para no romper `ADR-040` recién aplicado
sin ningún motivo real (nada más las usa todavía, pero renombrar sin
necesidad es puro churn).

## Contrato del `payload`

`SYNC_QUEUE.payload` (`jsonb`, libre por diseño desde `ADR-040`) para
una fila con `entity_type IN ('EUDR_MONITOREO', 'EUDR_USO_SUELO',
'EUDR_INSTALACIONES')` y `operation = 'INSERT'` debe tener la forma:

```json
{ "feature": { "geometry": <GeoJSON geometry>, "properties": {} }, "fieldOverrides": { ... } }
```

— el mismo contrato de `feature`/`fieldOverrides` que ya recibe
`uploadGeoSpatialFeature` (`lib/actions/gisActions.js`, `ADR-038`).
`operation IN ('UPDATE', 'DELETE')` queda **fuera de alcance** — no
existe ninguna función de actualización/borrado vía `SYNC_QUEUE` hoy;
esas filas se ignoran (no se tocan, quedan `PENDIENTE`) hasta que esa
capacidad se construya.

## Decisión: reusar `uploadGeoSpatialFeature`, no reimplementar validación con Zod

El prompt pedía "validar el payload contra el esquema Zod
correspondiente" — no existe ningún esquema Zod para
`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` en este repo
(el único módulo GIS con Zod es `createParcela`/`PADRON_PARCELAS`, vía
`lib/validations/socios.js`). Escribir esquemas Zod nuevos duplicaría
validación que **ya existe y ya está probada en producción** dentro de
`uploadGeoSpatialFeature` y sus helpers
(`assertSocioActivoOSinValor`/`assertParcelaActivaOSinValor`/
`geoJsonToWkt`/campos requeridos por tabla) — dos fuentes de verdad
para la misma regla de negocio que divergirían con el tiempo.

Decisión: `processWebGisSyncQueue` llama directo a
`uploadGeoSpatialFeature(entity_type, feature, null, fieldOverrides)`
por cada fila — el `null` en `organizationId` es intencional: desde
`ADR-038`, las 3 ramas EUDR de esa función ya ignoran ese parámetro y
resuelven la organización real vía `auth_org_id()` bajo la sesión
activa, exactamente el mismo mecanismo que este procesador también
usa. Cualquier error que lance esa función (geometría corrupta,
campo requerido faltante, socio/parcela inexistente o de otra
organización, error real de Postgres/RLS) se captura y su `.message`
se guarda tal cual en `SYNC_QUEUE.error_mensaje` — no se reinterpretan
ni se re-envuelven, mismo criterio que ya usa
`uploadGeoSpatialBatch` en el mismo archivo.

## Invariantes

1. Cliente de sesión real (`createSessionServerClient`) para leer y
   escribir `SYNC_QUEUE` — el RLS de `ADR-040`
   (`rls_org_sync_queue`) ya scopea las filas visibles a la
   organización de la sesión activa; no hace falta ningún filtro
   adicional de organización en la consulta.
2. Solo procesa filas `estado = 'PENDIENTE'`, `operation = 'INSERT'`,
   `entity_type IN ('EUDR_MONITOREO', 'EUDR_USO_SUELO',
   'EUDR_INSTALACIONES')` — nunca `PADRON_PARCELAS` (fuera del
   dominio WebGIS de esta tarea, aunque `uploadGeoSpatialFeature`
   también la soporte).
3. Por cada fila: éxito → `estado = 'PROCESADO'`, `procesado_en =
   now()`, `error_mensaje = NULL`. Falla → `estado = 'ERROR'`,
   `error_mensaje = <mensaje real>`, `procesado_en` sin tocar (no se
   marca como procesada si no se procesó).
4. Una fila que falla no aborta el resto del lote — mismo patrón
   "creados/fallidos con detalle" que `uploadGeoSpatialBatch`.
5. Devuelve un resumen (`{ procesados, errores, total, detalles }`)
   para quien invoque la Server Action — no hay UI todavía que la
   consuma (sin cron ni endpoint programado en esta tarea, tampoco
   pedido por el prompt).

## Fuera de alcance

- Procesar `operation IN ('UPDATE', 'DELETE')`.
- Cualquier UI/botón/cron que dispare `processWebGisSyncQueue`
  automáticamente — se deja como Server Action invocable, sin
  disparador todavía.
- Esquemas Zod para el payload de estas 3 tablas (ver decisión
  arriba).
