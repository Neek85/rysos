# Spec — Panel de Visualización de Validación Topológica en la Consola QC

## Contexto y corrección de premisas (verificado contra el repo antes de diseñar)

- **`QcTable.jsx` no existía** — la lista de pendientes vivía inline en
  `app/dashboard/qc/page.jsx` (un `.map()` de botones sin badges). Con los
  3 badges de validación por fila, el bloque creció lo suficiente como
  para justificar extraerlo — mismo criterio ya aplicado cuando se separó
  `QcDetailEditor.jsx` de `page.jsx` en la Consola QC 2.0. Se crea nuevo,
  no se "actualiza" uno preexistente.
- **El `flyTo` sobre la parcela seleccionada YA estaba implementado** —
  `components/gis/QcConsoleMap.jsx` ya hace `map.flyTo(...)` con
  `@turf/centroid` cada vez que cambia `selectedKey` (desde la Consola QC
  2.0, ver `specs/gis_qc_console_v2.md`). Nada que agregar ahí; se
  confirma que sigue funcionando después de este cambio (la selección no
  se tocó).
- **No hay colisión de z-index que corregir en este panel.** El panel de
  detalle (`QcDetailEditor.jsx`) se renderiza en flujo normal DEBAJO del
  mapa dentro de la misma `<section>` (`space-y-3`, sin
  `position: fixed/absolute`) — nunca se superpone al visor Leaflet, a
  diferencia de `CargaEspacialModal.jsx` (un overlay `fixed inset-0` real,
  ya corregido a `z-[9999]` en `specs/gis_mapa_dashboard_polish_v2.md`).
  Confirmado por `grep` que no hay ningún `position:fixed/absolute` en
  estos 3 archivos.
- **Cero logs de PII: ya era cierto, confirmado de nuevo.** `grep` sobre
  `app/dashboard/qc/` y `components/gis/` no encuentra ningún
  `console.log`.
- **Hallazgo real (no una premisa falsa esta vez): `fetchPendingRecords`
  no aislaba por organización.** Su propio comentario decía "RLS ya
  restringe... del lado de Supabase" — falso para este frontend (anon key
  sin sesión, mismo gotcha de `CLAUDE.md` ya encontrado y corregido en
  `vw_monitoreo_web`/`MapDashboard.jsx`). `vw_monitoreo_poligonos`/
  `puntos` corren con privilegio de su owner (`postgres`), así que
  cualquiera con la anon key veía TODOS los registros PENDIENTE de TODAS
  las organizaciones en la Consola QC — un gap real que el prompt pedía
  cerrar ("aislamiento estricto por ID_Organizacion") y que sí estaba
  roto. Cerrado con el mismo patrón de fetch en dos pasos ya usado en
  `MapDashboard.jsx`.

## Diseño

- **`lib/eudrQcActions.js::fetchPendingRecords`**: resuelve la
  organización activa con una consulta liviana (`select('ID_Organizacion').limit(1)`,
  primero contra `vw_monitoreo_poligonos`, si no hay resultado contra
  `vw_monitoreo_puntos`) antes de pedir el resto de columnas ya filtrado
  por esa organización — ninguna fila de otra organización llega nunca al
  navegador.
- **`lib/qcTopologyValidation.js`**: 3 funciones nuevas
  (`describeTopologyListBadge`/`describeOverlapListBadge`/`describeDeforestationListBadge`)
  — devuelven `{tone, label}` con las etiquetas exactas pedidas
  (`VÁLIDA`/`CON ERRORES`/`PENDIENTE`, `SIN SOLAPO`/`SOLAPADO X%`,
  `SIN DATOS`/`APTO`/`ALERTA DEFORESTACIÓN`). Distintas de
  `describeDeforestationBadge` (ya existente, para el panel de detalle,
  con texto más largo) — la tabla necesita etiquetas compactas de una
  fila.
- **`app/dashboard/qc/components/QcTable.jsx`** (nuevo): la lista de
  pendientes extraída de `page.jsx`, con los 3 badges por fila.
- **`app/dashboard/qc/page.jsx`**: `validationResults` (objeto keyed por
  `record.key`) reemplaza el estado local que antes vivía dentro de
  `QcDetailEditor.jsx` — necesario para que `QcTable.jsx` (la lista
  completa) y `QcDetailEditor.jsx` (el registro seleccionado) compartan
  el mismo resultado. `handleValidateTopology(record)` vive acá, no en
  `QcDetailEditor.jsx`.
- **`QcDetailEditor.jsx`**: pierde su estado local de validación (ahora
  recibido por props); botón renombrado a "Ejecutar Test Espacial" (antes
  "Validar Topología & EUDR", mismo comportamiento).
- **Nunca se valida toda la lista automáticamente.** Cada validación es
  una llamada real a `fn_validar_topologia_eudr` — los badges de un
  registro no tocado en la sesión quedan en `PENDIENTE` (tono neutro), no
  se dispara un fetch en cadena para todos los registros visibles al
  cargar la página (sería caro y no lo pidió el prompt explícitamente,
  que sí describe "PENDIENTE" como uno de los 3 estados reales del badge
  de topología).

## Sin test de render (Jest/Testing Library no instalado)

El prompt pedía "certificar que el panel renderiza correctamente los
badges y dispara el re-fetch" — no hay ningún framework de testing de
render en este proyecto (`CLAUDE.md`: no Jest/Vitest/Testing Library).
`tests/test_qc_visualization_panel.mjs` certifica en cambio el contrato
de datos real que consume `QcTable.jsx`: las 3 funciones
`describe*ListBadge` puras, con las 8 combinaciones reales (incluida
"sin resultado todavía").

## Criterios de aceptación

- AC1: `fetchPendingRecords` nunca devuelve un registro de una
  organización distinta a la primera encontrada.
- AC2: Cada badge de `QcTable.jsx` usa exactamente las etiquetas pedidas
  por el prompt (`VÁLIDA`/`CON ERRORES`/`PENDIENTE`, etc.).
- AC3: `npm run build` compila sin errores.
