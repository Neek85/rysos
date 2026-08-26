# ADR-029 — Resolver el GUID de QField vía `LEFT JOIN LATERAL` con desempate determinístico, en vistas y trigger

- **Estado:** Diseño aceptado, **sin implementar todavía** — ninguna
  migración SQL escrita ni aplicada. Este ADR documenta la decisión de
  arquitectura; el SQL exacto propuesto vive en
  `specs/fix_id_parcela_fija_guid_qfield.md`.
- **Fecha:** 2026-08-26
- **Spec:** `specs/fix_id_parcela_fija_guid_qfield.md` (evidencia completa,
  SQL propuesto detallado, riesgos y mitigaciones)
- **Contexto previo:** `ADR-010-vinculo-real-uso-suelo-monitoreo.md`
  (origen del vínculo real `qfield_relation_id`, y el que ya señalaba —
  sin verificar — que `EUDR_INSTALACIONES` "tiene el mismo patrón"),
  `ADR-028-multi-producto-cafe-cacao.md` (el trigger del paso 4 ya
  resuelve la misma cadena, sin el desempate que este ADR agrega)

## Contexto

`vw_monitoreo_poligonos` (rama `EUDR_USO_SUELO`) y `vw_monitoreo_puntos`
(rama `EUDR_INSTALACIONES`) exponen como `"ID_Parcela_Fija"` el valor
crudo de `id_parcela` — que pese al nombre de la columna, no es un
código de parcela: es el GUID que QField genera para el `EUDR_MONITOREO`
padre de esa subdivisión (`ADR-010`). Una auditoría de solo lectura
(2026-08-26, evidencia completa en la spec) confirmó con datos y código
reales, no solo con lectura de SQL:

- `EUDR_INSTALACIONES.id_parcela` tiene el mismo patrón exacto de GUID
  que `EUDR_USO_SUELO` (verificado, no asumido — `ADR-010` lo dejaba sin
  confirmar).
- El bug es invisible en `MapDashboard.jsx` (ya tiene un guard defensivo
  explícito, `sanitizeCode()`) pero **no** en `lib/eudrDdsExporter.js`:
  corrido contra datos reales de `ORG-TEST-E2E`, produce "plots fantasma"
  — 6 en vez de 3, con el GUID crudo filtrando a la propiedad pública
  `id_parcela` del paquete de trazabilidad exportado.
- `EUDR_MONITOREO.qfield_relation_id` tiene un **duplicado real**
  confirmado (mismo GUID, 2 filas, `"ID_Parcela_Fija"` distinto) — y
  ambas filas comparten además el mismo `fecha_monitoreo`, así que un
  desempate por fecha sola no alcanza.

## Decisión

**1. Resolver la cadena real dentro de las vistas, no solo en el
trigger.** `vw_monitoreo_poligonos`/`vw_monitoreo_puntos` reemplazan el
passthrough naive (`u.id_parcela AS "ID_Parcela_Fija"` /
`i.id_parcela AS "ID_Parcela_Fija"`) por un `LEFT JOIN LATERAL` contra
`EUDR_MONITOREO` que resuelve `qfield_relation_id = id_parcela AND
misma "ID_Organizacion"`, tomando su `"ID_Parcela_Fija"` real. Se eligió
`LATERAL` (no un `JOIN` plano) porque garantiza por diseño cardinalidad
0-o-1 por fila de origen — un `JOIN` plano haría fan-out ante el
`qfield_relation_id` duplicado ya confirmado con datos reales.

**2. Desempate determinístico de 2 niveles:** `ORDER BY fecha_monitoreo
DESC NULLS LAST, creado_en DESC LIMIT 1`. `fecha_monitoreo` (la fecha de
visita, cargada por el técnico) es el criterio de negocio natural — "la
visita más reciente gana" — pero el caso real duplicado ya encontrado
demuestra que puede empatar. `creado_en` (`timestamptz`, poblado en el
100% de las filas reales, nunca `NULL`) desempata con precisión de
timestamp real de inserción — a diferencia de `fecha_monitoreo`, que es
solo `date`.

**3. El mismo criterio se aplica también al trigger del paso 4**
(`fn_set_producto_predominante_uso_suelo`), que resuelve hoy la misma
cadena con un `LIMIT 1` sin `ORDER BY`. Sin este cambio, vista y trigger
podrían elegir un `EUDR_MONITOREO` padre distinto ante el mismo
duplicado — dos fuentes de verdad (`"ID_Parcela_Fija"` de la vista,
`id_producto_predominante` del trigger) apuntando a parcelas distintas
para la misma subdivisión. Aplicar el mismo `ORDER BY` en los 3 lugares
es la única forma de garantizar consistencia entre ellos.

**4. `vw_monitoreo_web` y `lib/eudrDdsExporter.js` no se tocan.** Es una
consecuencia deliberada del diseño, no un descuido: el `LEFT JOIN
PADRON_PARCELAS` ya existente en `vw_monitoreo_web` y el `groupByParcela`
del exportador ya asumen que `"ID_Parcela_Fija"` es un código real —
corrigiendo la fuente (las 2 vistas base), ambos consumidores se
arreglan en cascada sin necesitar su propio cambio. Confirmado
empíricamente: corriendo `buildTracesPayload` contra las 13 filas reales
de `ORG-TEST-E2E`, hoy da `total_plots: 6`; con el fix, el mismo caso
debería dar `total_plots: 3` (uno por `EUDR_MONITOREO` real) — este caso
queda documentado en la spec como el test end-to-end a usar cuando se
aplique la migración real.

**Riesgo aceptado, documentado, sin mitigar en este diseño:**
`lib/traceabilityHash.js::generateLotHash` deriva el hash público de
`/trace/[lot_hash]` de `properties.id_parcela` — tras el fix, los hashes
de los plots fantasma actuales dejan de existir (se fusionan con su
parcela real). Impacto real hoy: cero (100% datos de prueba, sin URLs
públicas reales compartidas de esos plots). Antes de aplicar la
migración real contra una organización con datos reales, revisar si
algún `lot_hash` compartido depende de esta ambigüedad.

**Fuera de alcance, señalado pero no corregido:** el `LATERAL` `mon` ya
existente en `vw_monitoreo_web` (resuelve `productor`, no
`"ID_Parcela_Fija"`) usa `ORDER BY fecha_monitoreo DESC NULLS LAST` sin
el mismo desempate secundario — misma clase de ambigüedad latente, en un
propósito distinto. Candidato a una spec de seguimiento si se decide
unificar el criterio en los 4 lugares que hoy resuelven "el
`EUDR_MONITOREO` más reciente" de formas ligeramente distintas.

## Consecuencias

- Ninguna migración SQL se aplicó todavía — este ADR y la spec asociada
  son el diseño cerrado, listo para una tarea de implementación futura.
- Cuando se implemente, la migración deberá tocar 3 objetos en la misma
  transacción (`vw_monitoreo_poligonos`, `vw_monitoreo_puntos`,
  `fn_set_producto_predominante_uso_suelo`) para mantener la consistencia
  que motiva la decisión — aplicar solo una de las 3 reintroduciría el
  riesgo de inconsistencia entre vista y trigger.
- El test end-to-end contra las 13 filas reales de `ORG-TEST-E2E`
  (`total_plots: 6` → `3`) es el criterio de aceptación concreto para
  esa tarea futura, no solo una verificación de esquema.
