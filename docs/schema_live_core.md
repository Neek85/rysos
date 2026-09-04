# Schema Live — Core (Identidad, Organizaciones, Socios)

> **Split (2026-09-04):** este archivo reemplaza a `docs/schema_live.md`
> (ahora eliminado), junto con
> [`docs/schema_live_agricola.md`](schema_live_agricola.md) (parcelas,
> `EUDR_*`, Inspecciones, vistas espaciales) y
> [`docs/schema_live_pecuario.md`](schema_live_pecuario.md) (vertical
> pecuaria — sin tablas propias todavía). Ver `CLAUDE.md` para cuál
> cargar según la carpeta que se esté tocando. El contenido de cada
> sección se movió tal cual, sin reescribir — cualquier nota fechada
> conserva su fecha original.
>
> **Nota de alcance (heredada del archivo original):** snapshot manual
> derivado de leer `supabase/migrations/*.sql` en orden cronológico,
> verificado puntualmente contra la instancia real vía REST/`supabase db
> query --linked` cuando hace falta confirmar algo. No existe ningún
> script `npm run sync-schema` en este repo — para mantenerlo al día,
> volver a generarlo a mano tras cada migración nueva, o pedir que se
> regenere leyendo el historial completo de `supabase/migrations/`. Sí
> hay conexión real disponible desde este entorno (`supabase db query
> --linked`, o REST vía `.env.local`) — no asumir lo contrario.
>
> **Instancia Supabase:** `jhtocgxlozfuzullrtol`. Ninguna migración de
> este repo se aplica automáticamente contra esa instancia salvo que se
> use `supabase db query --linked -f <archivo>` explícitamente (ver
> `AI_STATE.md`, nota permanente sobre `supabase db push`) — de lo
> contrario, ejecución manual en el SQL Editor de Supabase Studio.
>
> Generado: 2026-08-18. Última actualización de contenido antes del
> split: 2026-09-01 (funciones `SECURITY DEFINER` de ADR-031). **Este
> archivo, como el original, tiene secciones desactualizadas conocidas**
> (ver `docs/adr/INDEX.md` para el estado real más reciente de RLS en
> cada tabla — varias políticas/grants descritos abajo cambiaron en
> ADR-034/036/037, posteriores a la última actualización de contenido
> de esta sección).

## Tablas base (pre-existentes, no creadas por migraciones de este repo)

Las tablas siguientes existen en la base de datos pero **no** tienen
`CREATE TABLE` en el historial de migraciones — fueron creadas fuera de este
repo (Supabase Studio / otra herramienta). Las columnas listadas son solo las
referenciadas por las migraciones y vistas de este repo; puede haber columnas
adicionales no documentadas aquí.

> **Actualización (2026-08-25, ADR-023):** `PADRON_SOCIOS`/`PADRON_PARCELAS`
> dejaron de estar en esta situación — ver
> `supabase/migrations/20260825183000_baseline_padron_socios_parcelas.sql`
> (`CREATE TABLE IF NOT EXISTS`, adopción de documentación, sin cambio de
> comportamiento). Quedan en esta sección solo `ORGANIZACIONES` y las 3
> tablas `EUDR_*` del núcleo GIS (ver `docs/schema_live_agricola.md`), que
> siguen sin `CREATE TABLE` versionado.
> Esa misma tarea confirmó, vía introspección OpenAPI de PostgREST, dos
> columnas fuera de lo documentado más abajo (no corregidas en el prosa de
> esta sección todavía, ver el archivo de migración para el detalle
> completo): `PADRON_SOCIOS.normas_internas_17` (`text`, sin ningún uso
> conocido en el repo) y `PADRON_PARCELAS.hbp`/`otros_cultivo` son `text`
> en la instancia real, no `numeric` como el resto de las columnas de
> hectáreas (ver `docs/schema_live_agricola.md` para `PADRON_PARCELAS`).
>
> **Actualización (2026-08-25, ADR-024):** la discrepancia de
> `hbp`/`otros_cultivo` anotada arriba tiene migración lista —
> `supabase/migrations/20260825142426_normaliza_tipo_hbp_otros_cultivo.sql`
> (`ALTER COLUMN ... TYPE numeric`, pendiente de aplicación manual).

### `public."ORGANIZACIONES"`
- Columnas reales confirmadas en vivo con Service Role Key (2026-08-21 —
  `anon` no tiene política `SELECT` acá, solo `authenticated`, así que no
  es introspeccionable con la anon key): `"ID"` (PK de tenant, texto —
  código manual como `"COOP-JS"`/`"COOP-ND"`, comparado contra el claim
  JWT `ID_Organizacion`), `"Nombre_Organizacion"`, `"RUC"`,
  `"Direccion_Fiscal"`, `"Representante_Legal"`, `"Logo"`, `"Config"`
  (jsonb, **`NULL`** en las 2 filas reales hoy — sin estructura definida
  todavía, ver `ORGANIZACIONES.Config.gis.radio_contexto_vecinos_m` en
  `docs/adr/ADR-006-capa-contexto-parcelas-vecinas.md` para el primer uso
  real), `creado_en`, `actualizado_en`, `creado_por`. **Pendiente de
  aplicación manual (ver ADR-008 abajo):** `es_organizacion_prueba
  boolean NOT NULL DEFAULT false` — no existe todavía en la instancia
  real (confirmado en vivo, 2026-08-22: `column
  ORGANIZACIONES.es_organizacion_prueba does not exist`).
- **Solo 2 filas reales existen hoy: `"COOP-JS"` (COOP. JESUS SOLIDARIO)
  y `"COOP-ND"` (Asociacion Miladro de Jesus).** Una 3ra fila,
  `"ORG-TEST-E2E"`, queda pendiente de creación por la misma migración
  (organización de prueba explícita para `scripts/run_e2e_etl_test.py`).
  **Nota (2026-09-04, no en el original):** desde entonces se dieron de
  alta organizaciones reales adicionales (`COOP-AROMAS-VALLE`, ver
  `specs/alta_organizacion_real.md`/ADR-030) y `ORG-TEST-DEMO` — esta
  sección nunca se actualizó tras esas altas, ver `AI_STATE.md`/
  `docs/ESTADO_PROYECTO.md` para el estado real más reciente de filas.
- RLS: solo `SELECT` (asimetría deliberada — Tarea 9.1).
- **Sin FK real desde ninguna tabla transaccional** (confirmado en vivo,
  2026-08-21, vía PostgREST — `?select=*,ORGANIZACIONES(*)` contra
  `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`/
  `PADRON_SOCIOS`/`PADRON_PARCELAS` devuelve `PGRST200`, "no matches
  were found" para las 5 — `ID_Organizacion` es una convención de texto
  sin constraint en todo el schema, no solo en la tabla que se esté
  mirando puntualmente). Un valor de `ID_Organizacion` que no exista en
  `ORGANIZACIONES` no genera ningún error de escritura.
- **`"ORG-COOP-NORTE"` fue dato real de prueba E2E (RESUELTO, ver
  ADR-007/ADR-008):** apareció en 6 filas de `EUDR_MONITOREO`, 4 de
  `EUDR_USO_SUELO`, 4 de `EUDR_INSTALACIONES` sin fila correspondiente en
  `ORGANIZACIONES` — origen: `scripts/run_e2e_etl_test.py` corrido
  repetidas veces contra la instancia viva sin teardown. Las 14 filas
  fueron borradas (commit `2391859`, confirmado en vivo con conteos en 0
  antes de pushear) y el script ya no usa este `ORG_ID` — reemplazado por
  `"ORG-TEST-E2E"` (ver abajo). Se deja esta entrada como registro
  histórico del incidente.
- **Migración pendiente de aplicación manual
  (`20260822_021532_es_organizacion_prueba.sql`, ver
  ADR-008):** agrega `es_organizacion_prueba boolean NOT NULL DEFAULT
  false` (DEFAULT seguro — sin marcar explícitamente, se trata como
  organización real) e inserta/actualiza una fila real
  `"ORG-TEST-E2E"` (`Nombre_Organizacion = "Organización de Prueba — NO
  ES CLIENTE REAL"`, `es_organizacion_prueba = true`) para que
  `scripts/run_e2e_etl_test.py` tenga una organización de prueba real y
  etiquetada en vez de un `ID_Organizacion` sin fila correspondiente. El
  script aborta (`assert_org_is_test_marked`) si el `ORG_ID` que va a
  usar no tiene `es_organizacion_prueba = true` en el momento de
  correr — hasta que esta migración se aplique manualmente, correr el
  script en modo real fallará con `UnsafeOrgIdError` (comportamiento
  esperado: sin la fila, es más seguro abortar que escribir).

### `public."PADRON_SOCIOS"`
Schema real completo confirmado en vivo el 2026-08-18 (`specs/padron_web_socios.md`,
consulta REST directa, no solo lo referenciado por migraciones):
`ID_Socio` (PK, código manual ej. `JS-00001`, no autogenerado), `ID_Organizacion`,
`codigo_finca`, `socio_nombre_completo`, `socio_dni` (8 dígitos), `socio_genero`,
`socio_fecha_nacimiento`, `celular_socio`, `conyuge_nombre`, `conyuge_dni`,
`socio_departamento`, `socio_provincia`, `socio_distrito`, `localidad`,
`certificaciones` (texto libre), `cert_org_estatus` (texto, ej. "Organico"/
"Sin Estatus"), 8 columnas de certificación booleana en texto `"Sí"`/`"No"`
(`cert_nop_usda`, `ue_2018_848`, `cor_canada`, `cert_ds_0442006_ag`,
`cert_lpo_mx`, `cert_rainforest`, `cert_comercio_justo`, `cert_fair_trade_usa`
— **congeladas desde ADR-027**, ver nota de certificaciones abajo),
`socio_fecha_ingreso`, `creado_en`, `actualizado_en`, `creado_por`.
**No existe ninguna columna `sector`** (verificado — algo a tener presente si
una tarea futura la asume).
- **RLS (desactualizado — ver ADR-034/036/037 para el estado real):** el
  texto original decía "lectura/escritura para `authenticated` scopeado
  a `ID_Organizacion` (Tarea 9.1) + lectura adicional para `anon`". Desde
  ADR-031, la lectura `anon` directa es `USING (false)` (bloqueada — ver
  las 10+ funciones `SECURITY DEFINER` abajo). Desde ADR-034, las
  políticas `rls_select_padron_socios`/`rls_write_padron_socios` para
  `authenticated` son las oficiales, verificadas en vivo (antes de
  ADR-034 corrían por políticas huérfanas no documentadas). Desde
  ADR-036, `createParcela`/`updateParcela`/`deactivateParcela`/
  `deactivateSocio` (`lib/actions/sociosActions.js`) usan sesión real
  (`createSessionServerClient`), no Service Role Key — ese RLS es la
  autoridad real hoy, no un bypass.

### Módulo Padrón Web de Socios y Fincas (`/dashboard/socios`)

**Corrección de premisa (2026-08-26, ver
[ADR-023](adr/ADR-023-backend-inspecciones-ya-no-comparte-base.md)):**
hasta el 2026-08-25 esta sección decía que `PADRON_SOCIOS`/`PADRON_PARCELAS`
estaban "compartidas en vivo con otro repositorio" (`backend-inspecciones`,
`docs/audits/auditoria_backend_inspecciones.md`) — ADR-023 confirmó que
eso ya no aplica. Abrir escritura `anon` seguiría exponiendo DNI/nombre
real a cualquiera con la anon key pública de todos modos — motivo
suficiente por sí solo para nunca haber abierto esa política, independiente
de si el padrón se comparte o no con otro sistema.

- **Lectura:** `lib/sociosSearch.js` — desde ADR-031, vía las funciones
  `SECURITY DEFINER` (`fn_listar_padron_socios` etc., ver "Funciones"
  abajo), no una consulta directa con la anon key.
- **Escritura (desactualizado — ver ADR-036/037 para el estado real):**
  el texto original decía que **toda** la escritura de
  `lib/actions/sociosActions.js` corría con Service Role Key
  (`lib/supabaseServerClient.js`). **Ya no es así desde 2026-09-04/05**:
  las 7 funciones exportadas de ese archivo (`createSocio`, `updateSocio`,
  `createParcela`, `updateParcela`, `deactivateSocio`, `deactivateParcela`,
  `resolveSocioCertFlags`) corren con `createSessionServerClient()`
  (sesión real) — RLS de ADR-034 (`PADRON_SOCIOS`/`PADRON_PARCELAS`) y de
  ADR-037 (`SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO` + `GRANT
  EXECUTE` de `fn_crear_socio_con_certificaciones`) son la autoridad real,
  no un bypass. El aislamiento multi-tenant explícito en el código
  (`assertMatchesExistingOrg`, `assertParcelaMatchesOrg`,
  `assertSocioExists`) se mantiene como defensa en profundidad, no como
  única barrera.
- **Geometría de parcela:** carga de archivo `.geojson`/`.json`/`.kml`/`.csv`
  (`lib/geometryImport.js`), sanitizada server-side vía RPC
  `fn_sanitize_geometry` (`lib/actions/sociosActions.js::sanitizeGeometryForStorage`,
  ver `docs/schema_live_agricola.md` para la definición de la función)
  antes de guardar en `PADRON_PARCELAS.geom`.
- **Baja lógica (2026-08-18, `20260818_padron_baja_logica.sql`):** columna
  `activo boolean default true` en ambas tablas — decisión confirmada con
  el usuario (no `DELETE` físico, IDs referenciados desde
  `INSPECCIONES`/`EUDR_MONITOREO` sin FK real, ver `docs/schema_live_agricola.md`).
  `deactivateSocio` (`lib/actions/sociosActions.js`) pone
  `activo = false` en `PADRON_SOCIOS` y hace cascada a las parcelas del
  socio en `PADRON_PARCELAS` — deliberadamente NO toca `EUDR_MONITOREO`.
- **Ubigeo Perú (`lib/data/ubigeo_peru.json`):** dataset de 25
  departamentos / 196 provincias / ~1869 distritos generado por el modelo
  a partir de su conocimiento de entrenamiento — no verificado contra una
  fuente oficial INEI en vivo, decisión confirmada explícitamente con el
  usuario. Siempre ofrece "Otro / no está en la lista" como fallback.
- **Exportación/Importación CSV (`lib/padronCsv.js`):** exporta el padrón
  activo completo (`fn_exportar_padron_socios`/`fn_exportar_padron_parcelas`,
  `SECURITY DEFINER`, ver "Funciones" abajo). Importación exige vista
  previa (`applySocioDbChecks`/`applyParcelaDbChecks`) antes de escribir.

**Certificaciones normalizadas (2026-08-25, ADR-027) —
desactualizado el resumen original, ver nota:** las 9 columnas de
certificación de `PADRON_SOCIOS` (8 flags + `cert_org_estatus`) quedaron
**congeladas** — el destino real es `SOCIO_CERTIFICACIONES`/
`CERTIFICACIONES_CATALOGO` (2 de las 5 tablas nuevas de ADR-027, ver ese
ADR para las otras 3). `resolveSocioCertFlags`/`syncSocioCertificaciones`
(`lib/actions/sociosActions.js`) leen/escriben ahí, no en las columnas
congeladas. Ver ADR-037 para el RLS real de estas 2 tablas
(`authenticated`, desde 2026-09-04).

### `public."PERFILES_USUARIO_INTERNOS"` (Supabase Auth — Fase A del login real)

(2026-09-02, `20260902213506_login_fase_a_identidad.sql`): vincula
`auth.users.id` (`user_id`, PK/FK, `ON DELETE CASCADE`) con
`"ID_Organizacion"` (FK a `ORGANIZACIONES."ID"`) y `rol text CHECK IN
('admin','tecnico_campo','auditor_qc')`, más `nombre_completo`,
`activo boolean DEFAULT true`, `creado_en`/`actualizado_en timestamptz`.
Sin política de escritura para `authenticated` — el aprovisionamiento
de cuentas (Fase D) es exclusivamente vía Service Role Key desde un
script server-side; ninguna cuenta interna puede auto-asignarse un rol
ni cambiar su propia organización. RLS: 2 políticas de `SELECT`
(`rls_select_propio_perfil` — cada usuario ve su propia fila;
`rls_select_perfiles_admin_misma_org` — un `admin` ve las filas de su
propia organización, vía `auth_role()`/`auth_org_id()`). Índice sobre
`"ID_Organizacion"`.

**Nota (2026-09-04, no en el original):** esta tabla y `auth_org_id()`/
`auth_role()` ya están aplicadas y en uso real desde Fase D Paso 1
(aprovisionamiento de 5 cuentas reales) — el texto original decía
"inerte, tabla nace vacía", eso ya no es cierto. Ver
`docs/ESTADO_PROYECTO.md`/`AI_STATE.md` para el estado más reciente.

## Funciones (identidad, organización, socios)

| Función | Retorno | Uso |
|---|---|---|
| `public.auth_org_id()` | `text` | Extrae la organización activa. Desde `20260902213506_login_fase_a_identidad.sql` (aplicada y en uso real): `SECURITY DEFINER` + `SET search_path = public`, resuelve `ID_Organizacion` desde `PERFILES_USUARIO_INTERNOS` vía `auth.uid()`, con el claim JWT legacy como fallback (siempre `NULL` hoy — ningún Auth Hook lo puebla). Autoridad real de todas las políticas RLS `authenticated` del proyecto desde ADR-034/036/037. |
| `public.get_my_org_id()` | `text` | Alias delgado sobre `auth_org_id()` — preservado por compatibilidad con `trg_set_id_organizacion()`. |
| `public.auth_role()` | `text` | `SECURITY DEFINER`, lee `rol` de `PERFILES_USUARIO_INTERNOS` para `auth.uid()`. Devuelve `NULL` para cualquier sesión sin perfil activo (incluida `anon`) — nunca lanza error. |
| `public.trg_set_id_organizacion()` | `trigger` | Auto-inyecta `ID_Organizacion` en INSERT si viene nulo/vacío. |
| `public.fn_crear_socio_con_certificaciones(p_id_socio text, p_organizacion text, p_socio jsonb, p_certificaciones jsonb)` | `jsonb` (`{id, id_socio}`) | Alta atómica de un socio nuevo + sus certificaciones (`PADRON_SOCIOS` + `SOCIO_CERTIFICACIONES`) en una sola invocación. `SECURITY INVOKER` (sin cláusula explícita) — corre con el rol del llamador; sus propios `INSERT` quedan sujetos al RLS real de `authenticated` (ADR-034/037), no lo bypasean. **`GRANT EXECUTE` para `authenticated` desde ADR-037** (2026-09-04) — antes solo `service_role`. Llamada desde `lib/actions/sociosActions.js::createSocio()`. |
| `public.fn_listar_padron_socios(...)` | `TABLE(...)` (columnas de `PADRON_SOCIOS` + `activo` + `total_count`) | `SECURITY DEFINER`, `EXECUTE` solo `service_role` (patrón de lectura ADR-031, sin cambios por ADR-036/037 — la lectura del listado sigue vía esta función, no directa). Reemplaza lectura directa de `lib/sociosSearch.js::fetchSocios`. |
| `public.fn_buscar_padron_socios(p_organizacion text, p_query text)` | `TABLE(ID_Socio, ID_Organizacion, codigo_finca, socio_nombre_completo, socio_dni)` | `SECURITY DEFINER`. Autocompletado — usado por Inspecciones y por el Editor Vectorial de la Consola QC. |
| `public.fn_padron_socios_existentes(...)` | `TABLE(ID_Socio, socio_dni, codigo_finca)` | `SECURITY DEFINER`. Detección de duplicados en preview de importación masiva. |
| `public.fn_padron_socios_ids_todos(p_organizacion text)` | `TABLE(ID_Socio)` | `SECURITY DEFINER`. Todos los `ID_Socio` (activos e inactivos), para el siguiente código libre en la plantilla CSV. |
| `public.fn_padron_socios_sample_activos(p_organizacion text, p_limit int DEFAULT 2)` | `TABLE(ID_Socio)` | `SECURITY DEFINER`. Ejemplos reales para la plantilla de Parcelas. |
| `public.fn_exportar_padron_socios(p_organizacion text)` | `TABLE(...)` | `SECURITY DEFINER`, sin parámetros de filtro (exporta el padrón activo completo). Reemplaza `lib/padronCsv.js::exportSociosCsv` directo con `anon`. |

**Nota sobre las funciones `SECURITY DEFINER` de ADR-031 (fase 1 + fase
1b, socios Y parcelas — las de parcelas están en
`docs/schema_live_agricola.md`):** todas comparten el mismo patrón —
`SECURITY DEFINER` + `SET search_path = public` + `REVOKE EXECUTE`
explícito de `PUBLIC`/`anon`/`authenticated` + `GRANT` único a
`service_role`, consumidas exclusivamente vía
`lib/actions/padronReadActions.js`. Confirmado en vivo: `anon` recibe
`42501 permission denied` al intentar llamarlas.
