# ADR-014 — Un código de parcela debe corresponder a un único lugar físico

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-23
- **Migración:** `supabase/migrations/20260823_200000_fn_validar_codigo_parcela_unico.sql`
- **Código:** `scripts/etl_drive_to_supabase.py` (`warn_parcela_code_conflicts`,
  solo informativo), `lib/qcCodigoParcelaUnico.js` (nuevo),
  `app/api/qc/validar-codigo-parcela/route.js` (nuevo),
  `app/dashboard/qc/components/QcDetailEditor.jsx` (bloqueo real de
  Aprobar/Rechazar), `lib/eudrQcActions.js` (`assertSinConflictoDeParcela`
  — guard server-side, cierre del gap, ver sección dedicada más abajo)
- **Tests:** `tests/test_qc_codigo_parcela_unico.mjs` (26 tests),
  `tests/test_etl_drive.py::TestParcelaCodeConflictWarning` (5 tests),
  `tests/test_eudr_qc_actions.mjs` (7 tests nuevos del guard server-side)

## Regla de negocio (confirmada por el usuario, no una inferencia de datos)

Un `ID_Parcela_Fija` es único dentro de una organización y corresponde
**siempre** a un único lugar físico. Dos registros de `EUDR_MONITOREO` con el
mismo código pero geometrías muy separadas son un conflicto real de datos,
no dos capturas normales del mismo lugar.

Una investigación previa a esta tarea (solo lectura, sin cambios) confirmó
el alcance real del problema en la instancia viva: **los 6 registros de
`EUDR_MONITOREO` que existen hoy forman exactamente 3 pares por código de
parcela** (`COOP-JS-001`, `COOP-JS-003`, `COOP-JS-004`), con distancias entre
centroides de **768.53m, 1213.49m y 3532.75m** respectivamente — los 3
claramente "otro lugar", ninguno explicable por ruido GPS de campo. El 100%
de los códigos con datos hoy tiene conflicto, pero eso es un artefacto de
que la única organización con datos es `ORG-TEST-E2E` (organización de
pruebas de toda la sesión, cuyo mismo proyecto QField se resincronizó varias
veces — exactamente el comportamiento que ADR-012 corrigió), no evidencia de
que el problema esté extendido en datos de producción reales.

## Umbral provisorio: 100 metros — limitación honesta

**El umbral de 100m no está calibrado con datos reales** — es un número
provisorio, no un valor validado. Con solo 3 pares disponibles, y los 3
claramente "otro lugar" (el más cercano a 768m), **no hay en los datos
reales ningún ejemplo de "mismo lugar, dos capturas con ruido GPS normal"**
para calibrar el extremo bajo del umbral — a diferencia de Fase A (ADR-005), donde sí hubo un caso real
(0.36% de desalineación de área) que motivó el 98% de contención. El número
100m se apoya en el margen amplio entre precisión GPS de campo razonable
(unas pocas decenas de metros, incluso en mal caso — cobertura de dosel,
multipath) y el caso real más ajustado disponible (768m), no en un dato
calibrado de esta base. Se documenta así, explícitamente, para que quien lo
revise en el futuro sepa que es un punto de partida razonable, no un número
validado — y se recalibre si aparece un caso real de "mismo lugar, distancia
moderada" que lo contradiga. Mismo umbral (nombrado, no un número mágico
inline) en la RPC (`v_umbral_conflicto_m`) y en el ETL
(`PARCELA_CONFLICT_THRESHOLD_M`).

## Decisión: no bloquear la ingesta, sí bloquear la decisión de QC

Dos mecanismos separados, a propósito:

1. **ETL (`warn_parcela_code_conflicts`, solo informativo):** al ingerir un
   registro de `EUDR_MONITOREO`, si su `ID_Parcela_Fija` ya existe en la
   organización bajo otro `id_monitoreo` y la distancia real entre
   centroides supera 100m, se imprime una advertencia clara a stdout — pero
   la ingesta sigue normalmente, el registro se upsertea igual. Envuelta en
   `try/except` que nunca relanza (best-effort real, mismo criterio ya
   aceptado en esta sesión para `audit_logs`, ver ADR-013): un fallo en esta
   verificación (ej. geometría inválida en un registro no relacionado)
   nunca debe impedir que datos de campo reales lleguen a la base.
2. **Consola QC (`fn_validar_codigo_parcela_unico` + `QcDetailEditor.jsx`):**
   al abrir un registro de Monitoreo en revisión, se consulta en vivo
   (nunca un flag guardado que pueda quedar desactualizado, mismo patrón
   que `fn_validar_topologia_eudr`/`fn_cobertura_uso_suelo_parcela`) si su
   código tiene conflicto. Si `tiene_conflicto = true`, **Aprobar y
   Rechazar quedan deshabilitados**, con un mensaje rojo (bloqueante, no
   ámbar/informativo) listando cada registro en conflicto, su distancia y
   su `estado_revision` — mismo estilo de texto que el error ya existente
   en `lib/eudrQcActions.js::resolveUpdateTarget` ("No se puede aplicar la
   decisión...").

La razón de la asimetría: el dato ya existe (frenar la ingesta no arregla
nada, solo retrasa que alguien vea el problema), pero **decidir** sobre un
registro cuyo código es ambiguo sí sería un error real — no se sabe con
certeza a qué parcela corresponde hasta que un humano resuelva cuál de los
dos (o más) registros tiene el código equivocado.

### Por qué esto no repite el "círculo imposible" de ADR-011

`fn_cobertura_uso_suelo_parcela` (Fase B) tuvo que dejar de bloquear porque
el registro en revisión nunca contaba en su propia suma hasta *después* de
aprobarse — el último registro necesario para completar una parcela nunca
podía pasar su propio candado. Acá no existe esa circularidad: el conflicto
se calcula entre DOS (o más) registros que **ya existen**, comparando sus
geometrías entre sí — ninguno depende de que el otro cambie de estado
primero. Un registro puede seguir en conflicto indefinidamente hasta que un
humano lo resuelva manualmente (renombrando un código, corrigiendo una
geometría, etc.) — eso es exactamente el comportamiento deseado, no un bug.

## Hallazgo lateral: 2 de los 3 casos conocidos ya fueron aprobados/rechazados

Al confirmar el estado de los 3 casos conocidos antes de esta tarea (paso 3
de la investigación previa), se encontró que **2 de los 3 ya no están
`PENDIENTE`** — no por ninguna corrección automática, sino porque fueron
aprobados/rechazados por mí mismo como parte de la **verificación en vivo**
de las dos tareas anteriores de esta sesión:

| Código | id_monitoreo | Estado actual | Origen del cambio |
|---|---|---|---|
| `COOP-JS-001` | `b2f305a0...` | **APROBADO** | Verificación en vivo de ADR-012 |
| `COOP-JS-004` | `b12677bd...` | **APROBADO** | Verificación en vivo de ADR-013 |
| `COOP-JS-003` | `10425cbd...` | **RECHAZADO** | Verificación en vivo de ADR-013 |

Esto es un **artefacto de pruebas** (los 6 registros de `EUDR_MONITOREO` de
la instancia son todos datos de `ORG-TEST-E2E`, la organización disponible
para probar en vivo cada tarea de esta sesión), no una decisión real de
negocio sobre parcelas reales — no requiere ninguna acción correctiva. Se
documenta acá por transparencia y porque es relevante para leer
correctamente la tabla de verificación en vivo de este mismo ADR: los 3
casos, sin importar su `estado_revision` actual, siguen siendo el ejemplo
real usado para confirmar que el bloqueo funciona (la regla de conflicto no
filtra por estado del otro registro, ver la migración — un `APROBADO` o
`RECHAZADO` en conflicto sigue bloqueando igual que uno `PENDIENTE`).

## Verificación en vivo

Tras confirmar (usuario) que aplicó la migración en Supabase Studio, se
confirmó primero por REST directo (`supabase.rpc`, Service Role Key) que
`fn_validar_codigo_parcela_unico` existe y devuelve el resultado correcto
para los 6 registros reales — cada par se reporta como conflicto mutuo, con
la distancia exacta ya conocida de la investigación previa:

```json
COOP-JS-001 (b2f305a0, APROBADO)   -> tiene_conflicto: true, distancia_m: 1213.49, otro: 2947810c (PENDIENTE)
COOP-JS-001 (2947810c, PENDIENTE) -> tiene_conflicto: true, distancia_m: 1213.49, otro: b2f305a0 (APROBADO)
COOP-JS-003 (10425cbd, RECHAZADO) -> tiene_conflicto: true, distancia_m: 768.53,  otro: 6b1c9ec5 (PENDIENTE)
COOP-JS-003 (6b1c9ec5, PENDIENTE) -> tiene_conflicto: true, distancia_m: 768.53,  otro: 10425cbd (RECHAZADO)
COOP-JS-004 (b12677bd, APROBADO)   -> tiene_conflicto: true, distancia_m: 3532.75, otro: 6367110b (PENDIENTE)
COOP-JS-004 (6367110b, PENDIENTE) -> tiene_conflicto: true, distancia_m: 3532.75, otro: b12677bd (APROBADO)
```

Confirma en la práctica que la regla no filtra por `estado_revision` del
otro registro (ver la migración): un conflicto contra un registro ya
`APROBADO` o `RECHAZADO` bloquea exactamente igual que uno `PENDIENTE`.

Luego, en el navegador real (`/dashboard/qc`, dev server local), se abrieron
los 3 registros `PENDIENTE` restantes (los únicos que la consola lista —
los otros 3 ya están `APROBADO`/`RECHAZADO`, ver el hallazgo lateral
arriba). Para cada uno se confirmó, leyendo el DOM real (no solo mirando la
pantalla): el mensaje rojo exacto y `button.disabled === true` en ambos
botones:

| Registro abierto | Mensaje mostrado | Aprobar | Rechazar |
|---|---|---|---|
| `2947810c` (COOP-JS-001) | "...también aparece en otra ubicación físicamente distinta — b2f305a0-...-c00596df9987 (1213.49m, APROBADO)..." | `disabled: true` | `disabled: true` |
| `6b1c9ec5` (COOP-JS-003) | "...— 10425cbd-...-3a05c5610282 (768.53m, RECHAZADO)..." | `disabled: true` | `disabled: true` |
| `6367110b` (COOP-JS-004) | "...— b12677bd-...-3b50b164b539 (3532.75m, APROBADO)..." | `disabled: true` | `disabled: true` |

Los 3 coinciden exactamente con la salida de la RPC — la distancia mostrada
en la UI es la distancia real calculada por Postgres, no un valor
recalculado ni hardcodeado del lado del cliente.

## Gap cerrado: guard server-side dentro de approveRecord/rejectRecord

**Estado: cerrado.** La versión original de este ADR documentaba, a
propósito, que el bloqueo solo vivía en el frontend (`QcDetailEditor.jsx`
deshabilitando los botones) — un llamado directo a la Server Action
(`approveQcRecord`/`rejectQcRecord`, sin pasar por la UI) no estaba
protegido. Se cerró agregando el mismo chequeo del lado del servidor:

`lib/eudrQcActions.js::assertSinConflictoDeParcela(supabase, record)` —
llamada al principio de `approveRecord`/`rejectRecord` (después de
`assertSameOrganization`, antes de `resolveUpdateTarget`/el `UPDATE` real),
solo para `record.tabla_origen === 'EUDR_MONITOREO'`. Invoca la MISMA RPC
que ya usa el frontend (`fn_validar_codigo_parcela_unico`) y arma el mensaje
de error con la MISMA función (`buildConflictoParcelaMensaje`,
`lib/qcCodigoParcelaUnico.js`) — un solo lugar donde vive el texto del
mensaje, nunca dos copias que puedan divergir con el tiempo. A diferencia de
`warn_parcela_code_conflicts` (ETL) y `audit_logs` (ADR-013), que son
best-effort a propósito (una traza secundaria, no la operación principal),
acá un fallo de la RPC misma **también aborta** (`if (error) throw error`,
sin capturar) — esto es la aplicación real de la regla de negocio, no una
traza; fallar abierto ante un error de red/función inexistente dejaría
pasar exactamente el conflicto que se supone que bloquea.

### Verificación en vivo (paso 3): llamado directo a la Server Action, sin pasar por la UI

Se invocó la Server Action real (no un mock, no el botón de la UI) contra 2
de los 3 registros en conflicto conocidos, replicando exactamente lo que
hace `lib/actions/qcActions.js::approveQcRecord`/`rejectQcRecord` (mismo
`getSupabaseServerClient()` real, mismas `approveRecord`/`rejectRecord`
reales — invocado desde un script Node standalone en vez de a través del
bundler de Next.js, porque el resolutor ESM nativo de Node no entiende los
alias `@/lib/...` de `jsconfig.json` fuera de Next; el código ejecutado es
idéntico):

```
=== COOP-JS-001 (2947810c) via approveQcRecord directo ===
RECHAZADO como se esperaba:
   No se puede aplicar la decisión sobre este registro: el código de parcela "COOP-JS-001"
   también aparece en otra ubicación físicamente distinta — b2f305a0-f549-5d08-9ab1-c00596df9987
   (1213.49m, APROBADO). Un código de parcela debe corresponder siempre a un único lugar.
   Resolvé el conflicto manualmente antes de decidir.

=== COOP-JS-003 (6b1c9ec5) via rejectQcRecord directo ===
RECHAZADO como se esperaba:
   No se puede aplicar la decisión sobre este registro: el código de parcela "COOP-JS-003"
   también aparece en otra ubicación físicamente distinta — 10425cbd-3d3e-51c3-b529-3a05c5610282
   (768.53m, RECHAZADO). Un código de parcela debe corresponder siempre a un único lugar.
   Resolvé el conflicto manualmente antes de decidir.
```

Confirmado además, vía REST, que **ninguno de los dos registros se tocó**:
ambos siguen `estado_revision = 'PENDIENTE'`, y el intento de rechazo no
dejó ningún rastro en `observaciones` (seguía `''`, vacío) — el guard corre
y aborta antes de que el `UPDATE` real se ejecute, no después.

## Fuera de alcance de esta tarea (a propósito)

- **Flujo de resolución humana del conflicto** (renombrar un código, marcar
  uno como error, fusionar registros) — explícitamente pedido como pendiente
  futuro, no implementado. Hoy el registro simplemente queda visible pero no
  aprobable/rechazable; alguien debe resolverlo manualmente en la base.
- **Extender la regla a `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`** — esas tablas
  no tienen `ID_Parcela_Fija` propio (heredan la parcela de su Monitoreo
  padre vía `id_parcela`/`qfield_relation_id`, ver ADR-010), así que el
  conflicto, si existe, ya se refleja al revisar el Monitoreo padre.
- **Recalibrar el umbral de 100m con datos reales** — ver la limitación
  honesta arriba; queda pendiente hasta que aparezca un caso real que lo
  contradiga en cualquier dirección.
- **`updateRecordAttributes`/`updateRecordGeometry` siguen sin el guard** —
  el prompt de la tarea de cierre pedía específicamente `approveRecord`/
  `rejectRecord` (las únicas que escriben `estado_revision`); esas otras dos
  acciones editan atributos/geometría de un registro que sigue `PENDIENTE`,
  no toman la decisión final, así que quedan fuera del mismo criterio de
  alcance ya usado para el bloqueo del frontend.
