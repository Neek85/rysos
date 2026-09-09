# Spec — Asignación automática de código de parcela al aprobar QC

Origen: prompt `[PROMPT PARA CLAUDE]` (2026-09-09). Redactado y ejecutado
por Claude (Cowork) de punta a punta — el gate de segunda revisión de
`docs/RYZOS_ORQUESTADOR_V3.1.md` §4.1 queda cubierto por el punto 2 de esa
sección ("Si se trabajó con Claude (Cowork) desde el principio, la revisión
ya queda cubierta en el mismo flujo"). No toca ninguna política RLS nueva
(ver corrección 1 abajo).

## Objetivo

Al aprobar en la Consola QC (`/dashboard/qc`) un `EUDR_MONITOREO` capturado
en campo vía QField cuyo `ID_Parcela_Fija` viene NULO (parcela nueva, sin
alta previa en el padrón), asignar automáticamente un código de parcela,
crear la fila correspondiente en `PADRON_PARCELAS`, y dejar el propio
`EUDR_MONITOREO` actualizado con ese código — todo en una sola operación
atómica.

## Correcciones de premisa (verificadas contra el repo/schema real antes de escribir código)

1. **No existe columna `ID_Parcela_Fija` en `EUDR_USO_SUELO` ni en
   `EUDR_INSTALACIONES`** (confirmado en `docs/schema_live_agricola.md` y en
   `supabase/migrations/20260823_155621_fn_cobertura_uso_suelo_parcela.sql`,
   que solo lee `id_parcela`/`qfield_relation_id`, nunca un
   `ID_Parcela_Fija` propio de esas tablas). El paso 3.a.3 del prompt
   original ("propagar ID_Parcela_Fija a EUDR_USO_SUELO/EUDR_INSTALACIONES
   por id_parcela = qfield_relation_id") pedía escribir una columna que no
   existe. Crearla sería denormalizar el código legible junto al vínculo
   técnico (`id_parcela`) — exactamente la "colisión de significado" que
   ADR-021 ya diagnosticó y corrigió para `EUDR_USO_SUELO` (antes esa
   columna guardaba a veces el código legible, a veces el GUID técnico, y
   rompía `fn_cobertura_uso_suelo_parcela` en silencio). **Esta tarea NO
   crea esa columna ni escribe nada en las tablas hijas** — una vez que
   `EUDR_MONITOREO.ID_Parcela_Fija` queda asignado, el código ya es
   resoluble para cualquier fila hija vía el JOIN existente
   (`id_parcela = qfield_relation_id` → `EUDR_MONITOREO.ID_Parcela_Fija`),
   sin necesidad de copiar el dato.
2. **Formato del código:** el prompt proponía `{ID_Socio}-P-{NN}` con
   relleno de 2 dígitos (ej. `DEMO-00052-P-08`). El formato real ya en
   producción (`lib/parcelaDefaults.js::computeNextParcelaCode` +
   `computeSuggestedParcelaId`, ya usado y probado en `/dashboard/socios` y
   en el Editor Vectorial — ver ADR-021, ej. real
   `TEST-ADR021-SOC-P-00001`) usa relleno de 5 dígitos y detecta el
   ancho/prefijo desde los códigos ya existentes de ese socio. Esta tarea
   **reutiliza esas dos funciones sin modificarlas** — no hace falta
   adaptar `lib/parcelaDefaults.js` como sugería el prompt.
3. **Columnas de hectáreas en `PADRON_PARCELAS`:** el prompt listaba
   `hcc, ho, hip, hrp, otros_cultivo` a poner en 0 — falta `hbp` (existe en
   el schema real, ver ADR-024 "normaliza tipo hbp/otros_cultivo"). Se
   agrega a la lista. La columna `hr` (de significado no documentado en
   `docs/schema_live_agricola.md`) y `id_producto_predominante` (ADR-028,
   admite `NULL`) se dejan sin setear — no hay evidencia de qué valor por
   defecto correspondería.
4. **Atomicidad real:** el cliente Supabase-JS de una Server Action no
   soporta una transacción multi-tabla — cada `.from().insert()/.update()`
   es una llamada HTTP independiente. El prompt pedía "una sola
   transacción" pero solo anticipaba una migración para "índice o
   constraint". Se necesita una función Postgres (RPC) que envuelva
   INSERT + UPDATE en un solo bloque `plpgsql` — mismo patrón ya usado en
   este repo para el mismo problema
   (`fn_crear_socio_con_certificaciones`,
   `supabase/migrations/20260901120000_socio_creacion_atomica.sql`). Esto
   es una función invocada explícitamente desde la Server Action, no un
   trigger — no contradice el pedido de "server action, no trigger SQL"
   del prompt (ese pedido apuntaba a dónde vive la *lógica de negocio*
   — cálculo del código, condición "solo si es nueva" — que sigue en JS).
5. **Corrección tardía (2026-09-09, ver `docs/ESTADO_PROYECTO.md`):** esta
   sección decía que el testing en vivo "no es posible hoy" citando que
   las 3 tablas EUDR están vacías. Eso describe correctamente por qué no
   hay datos reales preexistentes para probar (cierto, sin causa
   determinada, `AI_STATE.md` 2026-09-03/2026-09-05), pero es una premisa
   incompleta: **sí es posible insertar filas descartables reales y
   probar en vivo** con una sesión `authenticated` genuina (magic link,
   mismo mecanismo ya usado en ADR-039/el smoke test de Fase D Paso 2,
   `tests/test_padron_rbac_rls.py`), no solo con mocks. Se hizo
   exactamente eso en la tarea de seguimiento (fix de
   `fn_validar_codigo_parcela_unico`) — ver la entrada correspondiente de
   `docs/ESTADO_PROYECTO.md` para la verificación real completa (sesión
   `auditor-qc-demo@ryzos-demo.test` contra `ORG-TEST-DEMO`, filas
   descartables, limpieza confirmada). Los tests unitarios (`node
   --test`) siguen siendo la cobertura permanente/repetible; la
   verificación en vivo fue puntual, no quedó como test versionado
   (mismo criterio ya usado en ADR-039/2026-09-08: script descartable,
   nunca commiteado).

## Diseño

### Detección del caso "parcela nueva"

En `approveRecord` (`lib/eudrQcActions.js`), tras los guards existentes
(`assertSameOrganization`, `assertSinConflictoDeParcela`,
`assertSocioParcelaMismaOrganizacion`): si `record.tabla_origen ===
'EUDR_MONITOREO'` y `record.ID_Parcela_Fija` es nulo/vacío, se activa el
flujo nuevo. Si el monitoreo aprobado YA tiene `ID_Parcela_Fija` (parcela
existente), o si el registro es de `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`,
el flujo de aprobación no cambia (requisito 3.c del prompt, cumplido).

### Resolución de datos (JS, antes de la RPC)

`ID_Socio` no viene en las columnas de `vw_monitoreo_poligonos`/
`vw_monitoreo_puntos` (solo `productor`, que puede ser el nombre libre —
ver ADR-020) — se resuelve fresco desde `EUDR_MONITOREO` por
`id_monitoreo`, mismo patrón ya usado en
`checkSocioParcelaOrganizacion`. Con ese `ID_Socio`, se listan los
`parcela_codigo` ya usados por ese socio en `PADRON_PARCELAS` (mismo
`ID_Organizacion`) y se calcula el siguiente código con
`computeNextParcelaCode`/`computeSuggestedParcelaId` — igual que hace
`ParcelaFormModal` hoy.

### RPC atómica

`fn_aprobar_monitoreo_nueva_parcela(p_id_monitoreo uuid, p_organizacion
text, p_id_parcela_fija text)`:
- Revalida server-side (defensa en profundidad, mismo criterio que
  `approveRecord`/`rejectRecord`): el monitoreo existe, pertenece a
  `p_organizacion`, está `PENDIENTE`, y su `ID_Parcela_Fija` sigue siendo
  NULL (ninguna otra sesión lo asignó mientras tanto) — si no, lanza y no
  escribe nada.
- Resuelve `ID_Socio` del propio `EUDR_MONITOREO` (nunca confía en un
  parámetro del cliente para ese dato).
- `INSERT INTO PADRON_PARCELAS`: `ID_Parcela_Fija = p_id_parcela_fija`,
  `ID_Socio`, `ID_Organizacion` (heredados del monitoreo),
  `hcp = totalh = area_calculada_ha` del monitoreo, `hcc = ho = hip = hrp
  = hbp = otros_cultivo = 0`.
- `UPDATE EUDR_MONITOREO SET "ID_Parcela_Fija" = p_id_parcela_fija,
  estado_revision = 'APROBADO' WHERE id_monitoreo = p_id_monitoreo`.
- Si el `INSERT` colisiona por PK (dos aprobaciones concurrentes del mismo
  socio generaron el mismo correlativo — ventana de carrera aceptada,
  documentada, nunca corrompe datos: la constraint PK aborta toda la
  transacción) el error se propaga tal cual a la Server Action, que lo
  muestra como error de aprobación — el auditor reintenta.
- `SECURITY INVOKER` (no `DEFINER`): corre con el rol de la sesión real
  del auditor (`createSessionServerClient`), sujeta a la RLS real de
  ambas tablas — igual que el resto de `approveRecord` desde ADR-039/
  ADR-034. `GRANT EXECUTE` explícito a `authenticated` (`REVOKE ... FROM
  PUBLIC/anon` primero) — mismo criterio de defensa en profundidad que
  `fn_crear_socio_con_certificaciones`.

### Multi-tenant

`ID_Organizacion` se hereda del monitoreo en cada escritura, y la RPC
revalida `p_organizacion` contra la fila real de `EUDR_MONITOREO` antes de
escribir — un monitoreo de la Organización A nunca puede generar/afectar
código o filas de la Organización B (la propia RLS de `EUDR_MONITOREO`
también lo impedería aunque la revalidación explícita fallara).

## Fuera de alcance (a propósito)

- Backfill de monitoreos ya `APROBADO` con `ID_Parcela_Fija` NULL
  existentes hoy (no se investigó si hay filas reales en ese estado; no
  se pidió backfill).
- Cualquier cambio a `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` (ver
  corrección 1).
- Resolver el hallazgo abierto de tablas EUDR vacías en producción (ver
  corrección 5) — fuera del alcance de esta tarea.
