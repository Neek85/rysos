# ADR-035 — Piloto de "Camino 1": `updateQcRecordAttributes`/`updateQcRecordGeometry` migran de Service Role Key a sesión real

- **Estado:** Propuesto — código ya escrito, ADR ya escrito, verificación
  funcional real ya hecha contra la instancia de producción — **sin
  commitear**, pendiente de aprobación.
- **Migraciones:** ninguna nueva — depende enteramente de ADR-034
  (`rls_write_eudr_monitoreo`/`rls_write_eudr_uso_suelo`/
  `rls_write_eudr_instalaciones`, ya aplicadas) y de la infraestructura
  de sesión de Fase B (`createSessionServerClient`,
  `lib/supabase/sessionServerClient.js`, ya existente y en uso desde
  `getCurrentProfile()`/Fase C).
- **Código:** `lib/actions/qcActions.js` — 2 funciones puntuales
  (`updateQcRecordAttributes`, `updateQcRecordGeometry`) cambian de
  cliente; el resto del archivo (`approveQcRecord`, `rejectQcRecord`,
  `resolveRadioContextoM`, `fetchParcelasVecinas`) no se toca.
- **Tests:** ninguno nuevo — `tests/test_eudr_qc_actions.mjs` sigue
  cubriendo las funciones puras de `lib/eudrQcActions.js`
  (`updateRecordAttributes`/`updateRecordGeometry` en sí, que no
  cambiaron — reciben `supabase` inyectado, agnósticas del cliente).
  Verificación de este ADR hecha con una escritura real contra
  producción, con sesión real, sobre una fila descartable creada y
  borrada dentro de la misma verificación (ver "Verificación
  funcional").
- **Contexto previo:** `ADR-003` (Server Actions de escritura para la
  Consola QC, decisión original de usar Service Role Key); `ADR-033`
  (mismo tipo de migración a sesión real + RLS, para
  `INSPECCIONES`/`CAP_*`); `ADR-034` (RLS real por organización en las 3
  tablas EUDR, prerrequisito de este ADR); `specs/login_real_organizacion_rol.md`
  (Fase D, matriz de permisos por rol — el motivo por el que
  `approveQcRecord`/`rejectQcRecord` no entran en este piloto).

## Contexto — por qué Service Role Key en primer lugar, y por qué ya no hace falta para estas 2 funciones

El header original de `lib/actions/qcActions.js` (sin tocar en este
ADR, solo se le agregó una nota) documenta el hallazgo real que motivó
Service Role Key: las 4 escrituras de la Consola QC
(`approveRecord`/`rejectRecord`/`updateRecordAttributes`/
`updateRecordGeometry`) se invocaban originalmente con el cliente
`anon`, y como `20260818_rls_multi_tenant_fortification.sql` ya definía
`rls_write_eudr_*` como `FOR ALL TO authenticated` (sin política `anon`
de escritura), todo `UPDATE` afectaba 0 filas siempre — el bug real no
era el guard `PENDIENTE`, era que RLS bloqueaba el `UPDATE` completo
antes de evaluar nada. En ese momento (antes de Fase B) **no existía
ningún mecanismo de sesión real server-side** — la única forma de que
la escritura funcionara en absoluto era bypasear RLS con Service Role
Key, mismo patrón adoptado en `lib/actions/sociosActions.js` y
`lib/actions/gisActions.js`.

Esa restricción ya no aplica para estas 2 funciones puntuales:

1. **Fase B** (`specs/login_real_organizacion_rol.md`) ya dio a la
   Consola QC acceso a sesión real server-side vía
   `createSessionServerClient()` (`lib/supabase/sessionServerClient.js`)
   — el mismo helper que `getCurrentProfile()` usa desde entonces, sin
   consumidores adicionales hasta este piloto.
2. **ADR-034** (Task 10, esta misma sesión) ya reemplazó las 13
   políticas RLS huérfanas de las 3 tablas EUDR por
   `rls_select_eudr_*`/`rls_write_eudr_*` reales y verificadas, con la
   condición `"ID_Organizacion" = auth_org_id() OR service_role OR
   postgres` — exactamente la condición que una sesión `authenticated`
   real necesita para que el `UPDATE` no vuelva a afectar 0 filas.

Con ambos prerrequisitos cerrados, la razón original para bypasear RLS
en estas 2 funciones ya no existe — el `UPDATE` real puede correr bajo
el rol del usuario, con RLS como autoridad real, en vez de bajo un
cliente que la bypasea por completo.

## Verificación previa (confirmada en el reconocimiento de la tarea anterior, no repetida en detalle acá)

- `createSessionServerClient()` es `async`, lee cookies vía
  `next/headers` — válido dentro de un Server Action (`'use server'`,
  que es exactamente lo que es `lib/actions/qcActions.js`). No requiere
  ningún ajuste adicional para usarse acá.
- `updateRecordAttributes`/`updateRecordGeometry`
  (`lib/eudrQcActions.js`) reciben `supabase` como parámetro inyectado
  — agnósticas del cliente, no necesitaron ningún cambio.
- `approveQcRecord`/`rejectQcRecord` construyen su propio cliente de
  forma completamente independiente (4 llamadas separadas a
  `getSupabaseServerClient()`/`createSessionServerClient()`, sin estado
  compartido) — cambiar 2 de las 4 no afecta a las otras 2.

## Decisión

En `lib/actions/qcActions.js`: `updateQcRecordAttributes` y
`updateQcRecordGeometry` reemplazan
`const supabase = getSupabaseServerClient()` por
`const supabase = await createSessionServerClient()`. Nada más cambia
en esas 2 funciones — mismos parámetros, misma firma, mismas funciones
puras invocadas de `lib/eudrQcActions.js`. `approveQcRecord`/
`rejectQcRecord`/`resolveRadioContextoM`/`fetchParcelasVecinas` quedan
exactamente igual.

## Por qué `approveQcRecord`/`rejectQcRecord` NO se tocan en este ADR

No es un descuido ni un paso pendiente de "hacer después de este piloto
sin más" — es una decisión explícita basada en la matriz de permisos de
Fase D (`specs/login_real_organizacion_rol.md`): aprobar/rechazar es
una acción que debe estar disponible para `admin`/`auditor_qc` pero
**no** para `tecnico_campo` (que sí puede corregir atributos/geometría
de un registro que él mismo cargó, pero no aprobar su propio trabajo).
El RLS real de ADR-034 en las 3 tablas EUDR distingue únicamente por
**organización** (`auth_org_id()`), no por **rol** dentro de esa
organización — migrar `approveQcRecord`/`rejectQcRecord` a sesión real
hoy le daría a cualquier `authenticated` de la organización correcta,
incluido `tecnico_campo`, la capacidad de aprobar/rechazar vía RLS, sin
ningún control de rol real. Diferenciar por rol (a nivel de RLS, con una
condición que lea `auth_role()` además de `auth_org_id()`, o a nivel de
aplicación) es una decisión de diseño aparte, con su propio ADR — este
piloto se mantiene deliberadamente acotado a las 2 funciones donde el
control por organización ya es la autoridad correcta y suficiente.

## Fuera de alcance, explícito: `resolveOrganizationId(records)`

La forma en que la Consola QC resuelve `organizationId` hoy
(`resolveOrganizationId(records)` sobre los registros PENDIENTE ya
cargados, en `lib/eudrQcActions.js`/`app/dashboard/qc/page.jsx`) no se
toca en este ADR — a diferencia del caso de Inspecciones (Task 16), acá
no es un bloqueo funcional: la Consola QC normalmente tiene registros
PENDIENTES ya cargados en pantalla mientras se edita uno de ellos (es
el flujo normal de uso — no se puede editar un registro que no está
listado), así que `organizationId` casi siempre se resuelve
correctamente en la práctica actual. Es una decisión de página completa
(afecta también `approveRecord`/`rejectRecord`/`fetchComparisonGeometries`,
no solo las 2 funciones de este piloto) — cambiarla acá ensancharía el
alcance de un piloto que se quiere mantener quirúrgico. Si en el futuro
se decide unificar esto con el patrón de `auth_org_id()` (como en Task
16), es trabajo aparte, con su propio spec/ADR.

## Verificación funcional real

**Premisa original ajustada en el momento de verificar:** el plan
original era usar una fila `PENDIENTE` real ya existente de
`ORG-TEST-DEMO` y revertir el campo al terminar. Al buscarla, las 3
tablas EUDR (`EUDR_MONITOREO`, `EUDR_USO_SUELO`, `EUDR_INSTALACIONES`)
resultaron **completamente vacías (0 filas cada una, no solo 0
PENDIENTE)** — mismo patrón, sin causa determinada todavía, que
`INSPECCIONES` (ver `AI_STATE.md` `2026-09-03f`/`g`), ahora extendido a
4 tablas centrales de la app. No se inventó ningún dato para forzar la
verificación original — el arquitecto, consultado, autorizó en su
lugar crear una fila 100% descartable (insertada y borrada dentro de
esta misma verificación, nunca dejada como dato real).

Sesión `authenticated` real para `admin-demo@ryzos-demo.test`
(`ORG-TEST-DEMO`), obtenida vía el mismo mecanismo de magic link ya
usado en ADR-033/034/Task 16 (Admin API `generate_link` + `/auth/v1/verify`,
sin resetear contraseña, sin exponer el `access_token` completo).

1. **Fila descartable creada** (Service Role, bypass RLS, valores
   mínimos): `INSERT INTO "EUDR_MONITOREO" ("ID_Organizacion",
   observaciones) VALUES ('ORG-TEST-DEMO', 'Piloto ADR-035 - fila
   descartable, se borra al terminar')` → `id_monitoreo =
   a56f4aee-9461-498c-ab26-d176ad18a251`, `estado_revision =
   'PENDIENTE'` (default de columna).
2. **Valor leído con la sesión real, antes de escribir:**
   `observaciones = "Piloto ADR-035 - fila descartable, se borra al
   terminar"`.
3. **`PATCH` vía REST con el `access_token` de la sesión real**,
   replicando exactamente el `.update(payload).match({ id_monitoreo,
   ID_Organizacion: 'ORG-TEST-DEMO', estado_revision: 'PENDIENTE' })`
   que ejecuta `updateRecordAttributes` (mismos parámetros de filtro en
   la query string): `observaciones` → `"Piloto ADR-035 - EDITADO via
   sesion real"`. **`200 OK`, exactamente 1 fila devuelta** (no 0) —
   confirma que el RLS real de `authenticated` (ADR-034) permite la
   escritura para el usuario correcto de su propia organización, en vez
   de bloquearla como habría bloqueado antes de ADR-034 (mismo síntoma
   "0 filas" que motivó Service Role Key originalmente en 2026-08,
   ahora resuelto por el RLS real, no por bypasearlo).
4. **Limpieza:** `DELETE` de la fila completa (no una reversión de
   campo — la fila era descartable de punta a punta, nunca un dato
   real). Confirmado con `SELECT count(*)` después: `EUDR_MONITOREO`
   vuelve a 0 filas, mismo estado que antes de esta verificación.
