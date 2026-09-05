# ADR-036 — Piloto de "Camino 1", Fase A.1: 4 funciones de `sociosActions.js` migran a RLS por sesión real

- **Estado:** Propuesto — código y ADR escritos, verificación funcional
  real hecha contra producción — pendiente de commitear (ver instrucción
  de la tarea; a diferencia de ADR-032/033/034/035, esta vez el commit
  es parte del mismo cierre, no un paso separado de aprobación previa).
- **Migraciones:** ninguna nueva — depende enteramente de `ADR-034`
  (RLS real de `PADRON_SOCIOS`/`PADRON_PARCELAS`, ya aplicada) y de la
  infraestructura de sesión de Fase B (`createSessionServerClient`, ya
  en uso desde `ADR-035`).
- **Código:** `lib/actions/sociosActions.js` — 4 funciones
  (`createParcela`, `updateParcela`, `deactivateParcela`,
  `deactivateSocio`) cambian de cliente; `createSocio`, `updateSocio`,
  `resolveSocioCertFlags` no se tocan. `specs/padron_web_socios.md` —
  nota de corrección de premisa agregada (mismo formato que `ADR-002`/
  `ADR-007`).
- **Tests:** ninguno nuevo — verificación funcional real contra
  producción, con sesión real, sobre filas descartables creadas y
  borradas dentro de la misma verificación (ver "Verificación
  funcional").
- **Contexto previo:** `ADR-023` (`backend-inspecciones` ya no comparte
  base de datos — la corrección de premisa que este ADR también aplica
  a `padron_web_socios.md`); `ADR-034` (RLS real de
  `PADRON_SOCIOS`/`PADRON_PARCELAS`, prerrequisito); `ADR-035` (mismo
  patrón de migración, para `updateQcRecordAttributes`/
  `updateQcRecordGeometry` — este ADR es su réplica sobre
  `sociosActions.js`); reconocimiento previo de esta sesión (grants de
  `fn_crear_socio_con_certificaciones`, RLS de
  `SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO`).

## Qué migró y por qué es seguro hoy

`createParcela`, `updateParcela`, `deactivateParcela`, `deactivateSocio`
reemplazan `const supabase = getSupabaseServerClient()` por
`const supabase = await createSessionServerClient()`. Ningún otro
cambio — mismos parámetros, misma firma, mismos payloads, mismos
helpers (`assertParcelaMatchesOrg`, `assertSocioExists`,
`assertParcelaCodigoNotDuplicated`, `assertMatchesExistingOrg`,
`sanitizeGeometryForStorage`), que ya reciben `supabase` inyectado y no
necesitaron ningún cambio.

Es seguro porque las 3 condiciones que ADR-035 estableció como
prerrequisito para este tipo de migración ya están confirmadas, esta
vez para el módulo de Padrón:

1. **RLS real y limpia sobre `PADRON_SOCIOS`/`PADRON_PARCELAS`**
   (`ADR-034`, verificado en el reconocimiento de esta sesión):
   `rls_select_padron_socios`/`rls_write_padron_socios`/
   `rls_select_padron_parcelas`/`rls_write_padron_parcelas`, condición
   `"ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role'
   OR current_user = 'postgres'` — exactamente la autoridad que una
   sesión `authenticated` real necesita.
2. **Sesión real ya garantizada por `middleware.js` para
   `/dashboard/socios` y `/dashboard/mapa`**, desde Fase B — el matcher
   (`/dashboard/:path*`) cubre ambas rutas, y el middleware ya redirige
   a `/login` si no hay una sesión Supabase Auth válida antes de que
   cualquier página de esas rutas renderice. No es un mecanismo nuevo
   para estas 2 páginas — ya estaba activo, solo sin consumidor
   client/server-side hasta este ADR.
3. **Ninguna de las 4 funciones depende de una RPC con grants
   faltantes.** `createParcela`/`updateParcela` llaman
   `fn_sanitize_geometry` (vía `sanitizeGeometryForStorage`), que ya
   tiene `EXECUTE` para `authenticated` (confirmado en el
   reconocimiento). `deactivateParcela`/`deactivateSocio` no llaman
   ninguna función RPC — son `UPDATE` directos sobre
   `PADRON_SOCIOS`/`PADRON_PARCELAS`.

`fn_sanitize_geometry` en sí no cambia — sigue siendo la misma función
`STABLE`/`SECURITY INVOKER` de siempre, ya callable por `authenticated`
desde antes de este ADR.

## Qué queda explícitamente fuera, y por qué

**`createSocio`/`updateSocio` (vía `syncSocioCertificaciones`) y
`resolveSocioCertFlags` — Fase A.2, tarea aparte.** No es un olvido:
están bloqueadas por 2 gaps reales, confirmados en el reconocimiento
previo, distintos entre sí:

1. `createSocio` llama `fn_crear_socio_con_certificaciones` — esa
   función tiene `EXECUTE` otorgado únicamente a `postgres`/
   `service_role`, **no** a `authenticated`. Una sesión real recibiría
   `42501 permission denied` antes de que RLS entre siquiera a jugar.
2. `updateSocio` (vía `syncSocioCertificaciones`) y
   `resolveSocioCertFlags` leen/escriben directo
   `SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO` — ninguna de las
   2 tablas tiene **ninguna** política RLS para `authenticated` (solo
   `anon SELECT`, con `CERTIFICACIONES_CATALOGO` incluso en
   `USING (true)` sin condición). Con RLS habilitado y sin política que
   aplique a `authenticated`, esas operaciones fallarían silenciosamente
   (0 filas) o con error de permiso, según el caso.

Migrar `createSocio`/`updateSocio`/`resolveSocioCertFlags` sin resolver
ambos gaps primero rompería el alta/edición de socios con
certificaciones por completo — mismo tipo de trampa que ADR-031 advirtió
y que ADR-035 evitó explícitamente para `approveQcRecord`/
`rejectQcRecord`. Fase A.2 necesita, como mínimo: un `GRANT EXECUTE ...
TO authenticated` sobre `fn_crear_socio_con_certificaciones`, y 2
políticas RLS nuevas (`SELECT`+escritura) para `authenticated` sobre
`SOCIO_CERTIFICACIONES` — con su propia migración y su propio ADR.

**Los 3 targets EUDR de `gisActions.js::uploadGeoSpatialFeature`
(`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`) — Fase A.3,
tarea aparte.** Ese path corre bajo `/dashboard/qc` (confirmado en el
reconocimiento — no `/dashboard/mapa`, pese a lo que dice el header de
`gisActions.js`), usando el mismo `resolveOrganizationId(records)`
sobre registros ya cargados que `ADR-035` ya dejó explícitamente
pendiente para `updateQcRecordAttributes`/`updateQcRecordGeometry` —
migrarlo ahora heredaría ese mismo problema sin resolverlo, y mezclaría
el alcance de este ADR (Padrón) con el de otro módulo (Consola QC/GIS).
Se deja para cuando se retome esa página completa, no como parte de
este piloto.

`PADRON_PARCELAS` en sí, vía `createParcela`/`updateParcela`
(este ADR), **sí** queda resuelta — a diferencia del caso EUDR, estas 2
funciones reciben `organizationId` que ya viene de
`editingSocio.ID_Organizacion`/`parcelasSocio.ID_Organizacion` (el
registro real, no una lista derivada) en los casos de edición, y del
valor devuelto directamente por `fetchSocios()` en creación — no
comparten el mismo patrón fragile de "adivinar de records ya cargados"
que bloqueó a Inspecciones (Task 16) y que sigue pendiente para QC.

## Nota de comportamiento a verificar, no regresión de seguridad

Bajo Service Role Key, un intento de editar/dar de baja un socio o
parcela de **otra** organización era detectado explícitamente por
`assertMatchesExistingOrg`/`assertParcelaMatchesOrg` — esas funciones sí
podían VER la fila de la otra organización (Service Role bypasea RLS) y
lanzaban `SocioActionError` con el mensaje "Violación multi-tenant:
este registro... no pertenece a la organización activa."

**Bajo RLS de sesión, ese mismo intento ya no llega a ese mensaje.** La
fila de la otra organización es invisible por RLS antes de que
`assertMatchesExistingOrg`/`assertParcelaMatchesOrg` la vean — ambas
funciones hacen un `SELECT` primero, y ese `SELECT` ahora devuelve 0
filas para una fila ajena, no la fila real con un `ID_Organizacion`
distinto. El bloqueo sigue siendo real (RLS es más estricto, no más
laxo), pero el *camino* por el que se bloquea cambia: pasa a ser el
guard de "0 filas afectadas" que cada función ya tiene después del
propio `UPDATE`/`INSERT` (`SocioActionError` con el mensaje "No se
encontró... (0 filas afectadas). El cambio NO se guardó."), no el
mensaje específico de "Violación multi-tenant". **No es una regresión
de seguridad** — el resultado final (la escritura se rechaza) es
idéntico; solo cambia cuál de los 2 mensajes ya existentes ve el
usuario. Confirmado en la verificación funcional (punto `e` abajo) que
el mensaje resultante sigue siendo claro y accionable.

## Verificación funcional real

Sesión `authenticated` real para `admin-demo@ryzos-demo.test`
(`ORG-TEST-DEMO`), obtenida vía magic link (Admin API `generate_link` +
`/auth/v1/verify`, sin resetear contraseña, sin exponer el
`access_token` completo) — mismo mecanismo que ADR-033/034/035. Cada
paso llama exactamente la misma consulta REST que la función real
ejecuta internamente (mismo `.eq()`/`.match()`, mismos filtros), con el
`access_token` de la sesión en `Authorization`, no el rol `anon`.

1. **`createParcela`** — `INSERT` de una fila descartable
   (`ID_Parcela_Fija: "TEST-ADR036-1788608092"`, `ID_Organizacion:
   "ORG-TEST-DEMO"`, `ID_Socio: "DEMO-00001"`, un socio real ya
   existente en esa organización) → **`201 Created`**, fila devuelta
   completa.
2. **`updateParcela`** — `PATCH` sobre esa misma fila
   (`parcela_nombre` → `"Parcela descartable ADR-036 - EDITADA"`,
   `hcp`/`totalh` → `1.5`) → **`200 OK`**, 1 fila devuelta con los
   valores nuevos.
3. **`deactivateParcela`** — `PATCH` `{"activo": false}` sobre la misma
   fila → **`200 OK`**, `activo: false` confirmado en la fila devuelta.
4. **`deactivateSocio`** — socio descartable creado aparte
   (`ID_Socio: "TEST-ADR036-SOCIO-1788608133"`) con 1 parcela activa
   propia (`ID_Parcela_Fija: "TEST-ADR036-P2-1788608133"`):
   - `PATCH {"activo": false}` sobre `PADRON_SOCIOS` → **`200 OK`**,
     `activo: false`.
   - `PATCH {"activo": false}` sobre `PADRON_PARCELAS WHERE ID_Socio=...`
     (la cascada real) → **`200 OK`**, `activo: false` en la parcela
     también — cascada confirmada bajo sesión real, no solo bajo
     Service Role Key.
5. **Intento cruzado** (entre los pasos 2 y 3, sobre la fila del paso 1,
   todavía activa): mismo `PATCH` de `updateParcela` pero con
   `ID_Organizacion=eq.COOP-AROMAS-VALLE` en vez de `ORG-TEST-DEMO`
   (la organización real de la fila) → **`200 OK`, `[]` (0 filas)** —
   exactamente el camino "0 filas afectadas" que dispara
   `SocioActionError('No se encontró la parcela "..." para actualizar
   (0 filas afectadas). El cambio NO se guardó.')` en el código real.
   Confirmado con una lectura aparte que la fila real no cambió
   (`parcela_nombre` seguía siendo el valor del paso 2, no
   `"NO DEBERIA GUARDARSE"`). **Mensaje claro y accionable, tal como
   predijo la sección "Nota de comportamiento" arriba** — no dice
   "violación multi-tenant" (ese mensaje ya no se alcanza bajo RLS de
   sesión, la fila es invisible antes), pero comunica correctamente que
   nada se guardó y por qué mirar de nuevo.
6. **Limpieza:** las 3 filas descartables (`TEST-ADR036-1788608092`,
   `TEST-ADR036-SOCIO-1788608133`, `TEST-ADR036-P2-1788608133`)
   borradas por completo (no baja lógica — eran descartables de punta a
   punta, nunca datos reales). Confirmado con `SELECT count(*) ...
   LIKE 'TEST-ADR036%'` después: `0` en ambas tablas. El socio real
   usado como referencia (`DEMO-00001`) nunca se modificó — solo se
   leyó su `ID_Socio` para satisfacer `assertSocioExists`.
