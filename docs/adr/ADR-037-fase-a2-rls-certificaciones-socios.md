# ADR-037 — Piloto de "Camino 1", Fase A.2: certificaciones de socio migran a RLS por sesión real — cierra `sociosActions.js` completo

- **Estado:** Implementado — migración aplicada, código migrado,
  verificación funcional real hecha contra producción, commiteado y
  pusheado a `staging`.
- **Migraciones:**
  `supabase/migrations/20260904174237_fase_a2_rls_certificaciones_socios.sql`
  (nueva, este ADR) — aplicada.
- **Código:** `lib/actions/sociosActions.js` — `createSocio`,
  `updateSocio`, `resolveSocioCertFlags` cambian de cliente; el import
  de `getSupabaseServerClient` se elimina por completo (sin uso
  restante en el archivo).
- **Tests:** ninguno nuevo — verificación funcional real contra
  producción, con sesión real, sobre un socio descartable creado y
  borrado dentro de la misma verificación (ver "Verificación
  funcional").
- **Contexto previo:** `ADR-034` (RLS real de
  `PADRON_SOCIOS`/`PADRON_PARCELAS`); `ADR-035` (mismo patrón de
  migración para `qcActions.js`); `ADR-036` (Fase A.1 de este mismo
  módulo — `createParcela`/`updateParcela`/`deactivateParcela`/
  `deactivateSocio` ya migradas, este ADR completa las 3 que quedaban);
  reconocimiento previo de Fase A (grants de
  `fn_crear_socio_con_certificaciones`, ausencia de RLS `authenticated`
  en `SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO` — los 2 gaps
  que este ADR cierra).

## Los 2 gaps que bloqueaban esto, y cómo se cerraron

Confirmados en el reconocimiento de Fase A, **reverificados en vivo**
antes de escribir la migración (no asumidos de memoria):

1. **`SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO` no tenían
   ninguna política RLS para `authenticated`** (solo `anon SELECT`,
   confirmado que sigue así, sin tocar, después de aplicar). RLS está
   habilitado en ambas — sin política que aplique a `authenticated`, ese
   rol quedaba denegado por completo, tanto para leer como para
   escribir.
   - **Cerrado:** 2 políticas nuevas en `SOCIO_CERTIFICACIONES`
     (`rls_select_socio_certificaciones` `FOR SELECT`,
     `rls_write_socio_certificaciones` `FOR ALL` con `WITH CHECK`),
     misma condición estándar del proyecto (`id_organizacion =
     auth_org_id() OR service_role OR postgres`) — columna en minúscula,
     a diferencia de `"ID_Organizacion"` de `PADRON_*`. 1 política nueva
     de solo lectura en `CERTIFICACIONES_CATALOGO`
     (`rls_select_certificaciones_catalogo_authenticated`, `USING
     (true)` — catálogo compartido sin columna de organización, mismo
     criterio que la política `anon` ya existente; sin política de
     escritura, ninguna función de este archivo escribe ahí).
2. **`fn_crear_socio_con_certificaciones` no tenía `GRANT EXECUTE` para
   `authenticated`** — solo `postgres`/`service_role`. Firma exacta
   confirmada en vivo (`pg_get_function_identity_arguments`): `p_id_socio
   text, p_organizacion text, p_socio jsonb, p_certificaciones jsonb`.
   - **Cerrado:** `GRANT EXECUTE ON FUNCTION ... TO authenticated`.

**Verificación de neutralidad hecha antes de aplicar:** `SOCIO_CERTIFICACIONES`
tiene 4414 filas totales, **0 con `id_organizacion IS NULL`** — ninguna
fila queda invisible bajo la condición nueva (a diferencia del riesgo
teórico que el reconocimiento había señalado como posible, resultó no
aplicar en los datos reales).

## `createSocio` bajo RLS de sesión tiene un modo de falla distinto al de Fase A.1

Las 4 funciones de Fase A.1 (`ADR-036`) son `UPDATE`s directos desde el
cliente — cuando RLS bloquea, Postgres simplemente no encuentra la fila
a actualizar, y el código ya interpretaba eso como "0 filas afectadas"
(`SocioActionError`, mensaje ya existente).

`createSocio` es distinto: es un `INSERT` **dentro de una función RPC**
(`fn_crear_socio_con_certificaciones`, `SECURITY INVOKER`). Cuando el
`organizationId` pasado no coincide con la organización real de la
sesión, el `INSERT INTO "PADRON_SOCIOS"` de adentro de la función viola
el `WITH CHECK` de `rls_write_padron_socios` (ADR-034) directamente —
Postgres aborta con un error real, no con "0 filas". Confirmado en vivo
(ver verificación abajo): **`403`, código `42501`, `"new row violates
row-level security policy for table \"PADRON_SOCIOS\""`** — un error de
Postgres genuino, propagado tal cual por `supabase.rpc(...)` hasta
`createSocio`, que ya lo relanza sin envolverlo en un mensaje propio
(`throwSupabaseError('createSocio(rpc)', error)` — el único caso que sí
intercepta es `23505`, duplicado de PK, no `42501`). La transacción
completa de la función se revierte — confirmado que no queda ninguna
fila creada, ni en `PADRON_SOCIOS` ni en `SOCIO_CERTIFICACIONES`.

**Nota para una eventual mejora de UX** (no resuelta acá, fuera de
alcance de este ADR): el mensaje `42501` crudo no es tan legible como
los mensajes `SocioActionError` ya curados del resto del archivo. Como
`createSocio` ya siempre recibe `organizationId` resuelto del lado del
servidor/cliente de forma confiable (nunca tecleado a mano por un
usuario), este caso debería ser estructuralmente inalcanzable en el uso
normal de la UI — el mismo criterio que ya se aplicó al no envolver
otros errores de Postgres no anticipados en este archivo.

## Esto cierra Fase A.2 completa

Con este ADR, **las 7 funciones exportadas de `lib/actions/sociosActions.js`
corren bajo sesión real — cero funciones con Service Role Key.** El
import de `getSupabaseServerClient` se eliminó del archivo por completo
(sin uso restante, confirmado por `npm run build`/`npm run lint` sin
warnings de import sin usar).

## Qué sigue quedando fuera

**Fase A.3 — `gisActions.js`, los 3 targets EUDR de
`uploadGeoSpatialFeature`** (`EUDR_MONITOREO`/`EUDR_USO_SUELO`/
`EUDR_INSTALACIONES`) — sin tocar, atados al mismo `resolveOrganizationId(records)`
sobre registros ya cargados de la Consola QC que `ADR-035` ya dejó
explícitamente pendiente para `updateQcRecordAttributes`/
`updateQcRecordGeometry`. Migrar ese path ahora heredaría ese mismo
problema sin resolverlo — se deja para cuando se retome esa página
completa.

## Verificación funcional real

Sesión `authenticated` real para `admin-demo@ryzos-demo.test`
(`ORG-TEST-DEMO`), obtenida vía magic link (Admin API `generate_link` +
`/auth/v1/verify`, sin resetear contraseña, sin exponer el
`access_token` completo) — mismo mecanismo que `ADR-033`–`036`.

1. **`createSocio`** — `POST .../rpc/fn_crear_socio_con_certificaciones`
   con un socio descartable (`ID_Socio: "TEST-A2-SOCIO-1788544064"`,
   `ORG-TEST-DEMO`) y 2 certificaciones marcadas (`COMERCIO_JUSTO`,
   `NOP_USDA` con `estado: "Organico"`) → **`200`**, `{"id":
   "426b3fad-...", "id_socio": "TEST-A2-SOCIO-..."}`. Confirmado con
   lectura aparte que ambas filas de `SOCIO_CERTIFICACIONES` quedaron
   con `id_organizacion = "ORG-TEST-DEMO"` correcto.
2. **`updateSocio`** — `PATCH` sobre `PADRON_SOCIOS` (nombre editado) →
   `200`. `syncSocioCertificaciones`: `DELETE` de las 2 filas
   existentes → `200` (ambas devueltas); `INSERT` del set nuevo
   (`NOP_USDA` se mantiene, `COMERCIO_JUSTO` se quita, `RAINFOREST` se
   agrega) → **`201`**, 2 filas nuevas. Confirma que el patrón
   "borrar todo + reinsertar" funciona bajo sesión real, no solo bajo
   Service Role Key.
3. **`resolveSocioCertFlags`** — sus 3 lecturas reales (`PADRON_SOCIOS`
   por `id`, `CERTIFICACIONES_CATALOGO` activo, `SOCIO_CERTIFICACIONES`
   del socio) ejecutadas una por una con la sesión real → **`200` las
   3**. La última devolvió exactamente los 2 `id_certificacion` de
   `NOP_USDA`/`RAINFOREST` — el set post-edición del paso 2, confirmando
   que el flujo completo de lectura para precargar el modal de edición
   funciona bajo RLS de sesión.
4. **Intento cruzado** — mismo RPC que el paso 1, pero
   `p_organizacion: "COOP-AROMAS-VALLE"` (la sesión real es de
   `ORG-TEST-DEMO`) → **`403`**,
   `{"code":"42501","message":"new row violates row-level security
   policy for table \"PADRON_SOCIOS\""}` — el modo de falla distinto
   descrito arriba, confirmado real, no hipotético. Verificado con
   `SELECT count(*)` que no quedó ninguna fila creada.
5. **Políticas `anon` intactas** — `pg_policies` antes y después de
   aplicar la migración: `rls_anon_select_socio_certificaciones`
   (`SOCIO_CERTIFICACIONES`) y `rls_anon_select_certificaciones_catalogo`
   (`CERTIFICACIONES_CATALOGO`) presentes en ambos momentos, mismo
   nombre, mismo `cmd`, mismos `roles` — sin cambios.
6. **Limpieza:** `SOCIO_CERTIFICACIONES` primero (por la FK), después
   `PADRON_SOCIOS` — confirmado `0` filas restantes en ambas para el
   socio descartable.

`npm run build`/`npm run lint`: limpios, mismos warnings preexistentes
en archivos no tocados por esta tarea, 0 errores, mismas 19 rutas.
