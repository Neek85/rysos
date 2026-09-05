# ADR-038 — Piloto de "Camino 1", Fase A.3: las 3 ramas EUDR del Ingestor Espacial migran a RLS por sesión real

- **Estado:** Implementado — sin migración SQL nueva (política ya
  existente desde `ADR-034`), código migrado, verificación funcional
  real hecha contra producción, commiteado y pusheado a `staging`.
- **Migraciones:** ninguna. `rls_write_eudr_monitoreo`/
  `rls_write_eudr_uso_suelo`/`rls_write_eudr_instalaciones` (`FOR ALL`,
  `TO authenticated`, `WITH CHECK ("ID_Organizacion" = auth_org_id() OR
  auth.role() = 'service_role' OR CURRENT_USER = 'postgres')`) ya
  existían desde `ADR-034` y ya cubrían `INSERT` — reconfirmado en vivo
  vía `pg_policies` antes de escribir código, no asumido de memoria.
- **Código:** `lib/actions/gisActions.js` — `uploadGeoSpatialFeature`.
  Las 3 ramas `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`
  cambian de cliente (`getSupabaseServerClient` → `createSessionServerClient`)
  y resuelven la organización server-side vía `supabase.rpc('auth_org_id')`
  en vez de confiar en el parámetro `organizationId` que manda el
  cliente. La rama `PADRON_PARCELAS` (delega en `createParcela`, ya
  migrada en `ADR-036`) no se tocó — sigue siendo el único caso que usa
  `organizationId` del parámetro.
- **Tests:** ninguno nuevo — verificación funcional real contra
  producción, con sesión real, sobre filas descartables creadas y
  borradas dentro de la misma verificación (ver "Verificación
  funcional").
- **Contexto previo:** `ADR-034` (RLS real de las 5 tablas EUDR/PADRON,
  incluida la política `FOR ALL` que este ADR reutiliza sin cambios);
  `ADR-035` (mismo patrón para `qcActions.js`); `ADR-036`/`ADR-037`
  (mismo patrón para `sociosActions.js`, que dejaron explícitamente esta
  Fase A.3 pendiente).

## El bug real y actual que esto corrige

`app/dashboard/qc/page.jsx` resuelve `organizationId` para
`uploadGeoSpatialFeature`/`uploadGeoSpatialBatch` con el mismo patrón
`resolveOrganizationId(records)` de `lib/eudrDdsExporter.js`: junta los
`ID_Organizacion` distintos de los registros ya cargados en pantalla, y
devuelve `null` si el array está vacío. **Las 3 tablas EUDR están
confirmadas vacías hoy, en las 2 organizaciones reales** (`SELECT
count(*)` con Service Role Key, reconfirmado en este mismo turno) — así
que `resolveOrganizationId([])` siempre devuelve `null`, y
`assertOrganizacion(null)` reventaba con `GisActionError` antes de
cualquier llamada de red, para **cualquier organización**, bloqueando
por completo el único path de escritura web hacia estas 3 tablas (antes
solo el ETL de Python y QGIS Desktop escribían ahí).

Con esta migración, las 3 ramas EUDR ya no llaman a
`assertOrganizacion` ni dependen de `organizationId`/`records` para
nada — resuelven la organización directo de la sesión activa vía
`auth_org_id()`, la misma función que ya usa el RLS de `ADR-034` como
autoridad. El bug queda cerrado de raíz, no parcheado: no hace falta
que `page.jsx` tenga registros cargados para poder escribir.

## Qué cambió, exactamente

Dentro de `uploadGeoSpatialFeature`:

1. `assertOrganizacion(organizationId)` se movió de la cabecera de la
   función a **solo** la rama `PADRON_PARCELAS` — es el único caso que
   sigue usando el parámetro del cliente (`createParcela` ya hace su
   propia validación multi-tenant contra ese valor, sin cambios).
2. Para las 3 ramas EUDR: `const supabase = await createSessionServerClient()`
   (antes `getSupabaseServerClient()`, sin `await`, Service Role Key).
3. Inmediatamente después: `const { data: sessionOrgId, error: orgError }
   = await supabase.rpc('auth_org_id')` — lanza `GisActionError('No se
   pudo determinar la organización de la sesión activa.')` si hay error
   o si `sessionOrgId` es falsy.
4. Todo uso de `organizationId` dentro de las 3 ramas EUDR
   (`assertSocioActivoOSinValor`, `assertParcelaActivaOSinValor`,
   `resolveQfieldRelationId`, `insertEudrCoreRecord`) pasa a usar
   `sessionOrgId`. Los 4 helpers ya recibían `supabase` como parámetro
   inyectado (no instanciaban su propio cliente) — no hizo falta tocar
   sus firmas.
5. La firma pública de `uploadGeoSpatialFeature` no cambió —
   `organizationId` se mantiene como parámetro (sigue vivo solo para
   `PADRON_PARCELAS`), comentado en el código para que quede explícito
   por qué ya no se usa en las otras 3 ramas.

`uploadGeoSpatialBatch` (el wrapper de lote) no se tocó — sigue
pasando `organizationId` tal cual a cada llamada de
`uploadGeoSpatialFeature`; ese valor ahora simplemente se ignora para
los 3 targets EUDR.

## Qué se dejó fuera a propósito

`app/dashboard/qc/page.jsx` y los otros 4 call sites de
`resolveOrganizationId(records)` que alimentan
`approveQcRecord`/`rejectQcRecord` (Service Role Key, sin tocar —
motivo ya documentado en `ADR-035`: falta diferenciar por rol, no solo
por organización) quedan exactamente igual que antes de este ADR. El
`organizationId` que `page.jsx` sigue calculando y pasando a
`uploadGeoSpatialFeature` no se eliminó de esa pantalla — solo dejó de
ser la fuente de verdad para las 3 ramas EUDR de esta función
puntual.

## Verificación funcional real

Sesión `authenticated` real para `admin-demo@ryzos-demo.test`
(`ORG-TEST-DEMO`), obtenida vía magic link (Admin API `generate_link` +
`/auth/v1/verify`, sin resetear contraseña, sin exponer el
`access_token` completo) — mismo mecanismo que `ADR-035`–`037`. Cada
paso llama exactamente la misma consulta REST que
`insertEudrCoreRecord`/`rpc('auth_org_id')` ejecutan internamente, con
el `access_token` de la sesión en `Authorization`.

1. **`auth_org_id()` bajo esta sesión** → `200`, `"ORG-TEST-DEMO"` —
   resuelto sin necesitar ningún registro cargado ni parámetro del
   cliente, a diferencia de `resolveOrganizationId(records)`.
2. **Insert legítimo** (`ID_Organizacion = sessionOrgId` real, el mismo
   valor que ahora escribe `insertEudrCoreRecord`) en las 3 tablas:
   - `EUDR_MONITOREO` → **`201`**, fila devuelta con
     `ID_Organizacion: "ORG-TEST-DEMO"`.
   - `EUDR_USO_SUELO` → **`201`**, ídem (geometría `Polygon`, la misma
     que exige la columna real — un `Point` de prueba había fallado
     antes por tipo de geometría, no por RLS, corregido en el script de
     verificación).
   - `EUDR_INSTALACIONES` → **`201`**, ídem.
3. **Insert falsificado** (`ID_Organizacion = "COOP-AROMAS-VALLE"`,
   simulando qué pasaría si el código todavía usara el `organizationId`
   del cliente en vez de `sessionOrgId` — la sesión real sigue siendo
   `ORG-TEST-DEMO`) en las 3 tablas: **`403`, `42501`, `"new row
   violates row-level security policy for table \"<tabla>\""`** en las
   3 — RLS rechaza el intento cruzado de raíz, antes de que importe si
   el código de la aplicación confía o no en ese valor. Esto demuestra
   en vivo que, aunque alguien lograra colar un `organizationId`
   falsificado como parámetro, ya no tiene ningún efecto: el código ya
   ni lo usa (paso 2), y RLS lo bloquearía de todas formas si algo lo
   reintrodujera por error.
4. **Regresión del bug real:** las 3 tablas EUDR están confirmadas en
   `0` filas (`SELECT` con Service Role Key, antes y después de la
   verificación) — exactamente el estado real de producción hoy. El
   paso 1 y 2 de arriba se ejecutaron con las tablas en ese mismo
   estado vacío y funcionaron sin problema: `auth_org_id()` no depende
   de que existan filas, a diferencia de `resolveOrganizationId([])`
   (que con 0 filas siempre devolvía `null` y bloqueaba todo). Confirma
   que el bug de bloqueo total por tablas vacías queda cerrado.
5. **Limpieza:** las filas descartables de los pasos 2 (1 por tabla,
   `tipo_uso`/`tipo_infra: "TEST-ADR038"` o `id_monitoreo` marcado)
   borradas con Service Role Key. Confirmado `0` filas restantes en las
   3 tablas después.

`npm run build`/`npm run lint`: limpios, mismos warnings preexistentes
en archivos no tocados por esta tarea, 0 errores, mismas 19 rutas.
