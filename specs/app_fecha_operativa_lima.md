# Spec: fecha operativa de Lima en la app Granja Valencia

**Estado:** implementada (2026-10-08). Sin migración SQL (no aplica gate de seguridad). Contexto:
`specs/pecuario_huso_horario_lima.md` (base: `fn_hoy_operativo()`, migraciones `20261008100000` y `20261008110000`).

## 1. Problema
Diez pantallas definían su propia `hoyISO()` = `new Date().toISOString().slice(0, 10)`, que da el día en
**UTC**. Entre las 19:00 y las 24:00 de Lima la app precargaba la fecha de **mañana** (p. ej. a las 21:37 de Lima
del 7-oct mostraba 8-oct), mientras la base, tras las migraciones de huso, ya cuenta el día de Lima: un parto o
una venta registrados de noche quedaban con fecha adelantada y caían en el mes siguiente a fin de mes.

## 2. Decisión
Un único helper `hoyOperativo(ahora?: number): string` en `apps/granja-valencia/lib/fecha/hoyOperativo.ts`:
`new Date(ahora - 5 * 3600 * 1000).toISOString().slice(0, 10)`.
- Lima es UTC−5 fijo (sin horario de verano), igual que `fn_hoy_operativo()`.
- Determinista: sin `Intl`, sin depender de la zona del teléfono, sin librerías nuevas (el soporte de `Intl`
  con `timeZone` en Hermes no está verificado).
- El instante es inyectable (`ahora`, epoch ms) para poder probarlo.
- Ubicación: `lib/<dominio>/<archivo>.ts` con su `*.test.ts` al lado, como `lib/reemplazo/logica.ts`.
- Si algún día se necesita huso por organización, el helper cambia de firma (hoy no: la base tampoco).

## 3. Contrato
`hoyOperativo(ahora?: number): string` → `YYYY-MM-DD`, fecha de calendario en America/Lima.
Solo para **fechas de calendario del día** (columnas `date`). Los **instantes** (`created_offline_at`,
timestamps, nombres de archivo) siguen siendo `new Date().toISOString()` completos y NO se tocan.
No cambia ningún esquema SQL ni Zod.

## 4. Casos límite (cubiertos en `lib/fecha/hoyOperativo.test.ts`)
- 04:59:59.999Z → día anterior; 05:00:00.000Z → día nuevo (00:00 de Lima).
- 23:59:59.999Z: la fecha UTC es la misma pero Lima sigue en ese día; 00:00Z = 19:00 del día anterior.
- Ventana 19:00–24:00 de Lima: UTC ya es "mañana", la operativa no.
- Frontera de mes (2026-11-01), de año (2027-01-01) y bisiesto (2028-02-29 / 2028-03-01).
- Siempre `YYYY-MM-DD`; sin argumento usa `Date.now()`; independiente de la zona del proceso.

## 5. Alcance
Reemplazadas las 10 `hoyISO()` locales: compras, destete, empadre/asignar-macho, insumos, mortalidad, parto,
pesaje, sanidad, traslado y venta (esta usa el helper dos veces: fecha de venta y de guano).
Clasificación del resto de usos de fecha en la app, en `ESTADO_PROYECTO.md`: validadores `esFechaValida`,
`sumarDias` y `diasEntre` parsean/operan fechas puras con `T00:00:00Z` (correctos, no se tocan);
`created_offline_at` es instante; `Date.now()` solo nombra fotos.

## 6. Fuera de alcance
Archivos web (`lib/actions/gisActions.js:61`, `lib/actions/syncGisActions.js:63`; solo se reportan); tests de
base de datos; mover el panel a una organización de prueba.
