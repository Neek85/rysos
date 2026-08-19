# Spec — Padrón Web Activo de Socios y Fincas (`/dashboard/socios`)

## Contexto y corrección de premisas (verificado contra el schema real antes de diseñar)

Se consultó `PADRON_SOCIOS`/`PADRON_PARCELAS` en vivo (anon key, solo
lectura) antes de diseñar, en vez de asumir el schema documentado
parcialmente en `docs/schema_live.md`:

- **No existe ninguna columna `sector`** en `PADRON_SOCIOS`. Existen
  `socio_departamento`/`socio_provincia`/`socio_distrito`/`localidad`
  (geografía) y 9 columnas de certificación: `cert_org_estatus` (texto
  libre tipo "Organico"/"Sin Estatus"), `cert_nop_usda`, `ue_2018_848`,
  `cor_canada`, `cert_ds_0442006_ag`, `cert_lpo_mx`, `cert_rainforest`,
  `cert_comercio_justo`, `cert_fair_trade_usa` (todas "Sí"/"No" en texto)
  más el campo libre `certificaciones`.
- **`PADRON_PARCELAS.geom` es `null` en la mayoría de registros reales**
  confirmado con datos reales de producción (`COOP-JS-001`, `COOP-JS-002`).
  Columnas reales: `hcp`, `hcc`, `ho`, `hip`, `hrp`, `hbp`, `otros_cultivo`
  (hectáreas por categoría de uso, nomenclatura heredada de AppSheet —
  mismo patrón `CAP_*`/`my_element_273` ya documentado en
  `docs/audits/auditoria_backend_inspecciones.md`), `totalh` (total).
  `PADRON_PARCELAS` también trae copias desnormalizadas de
  `socio_dni`/`socio_nombre_completo` (más superficie de PII a cuidar).

## Decisión arquitectónica crítica (confirmada con el usuario, no se implementa de otra forma)

**Las escrituras (alta/edición de socio, alta/edición de parcela) NO usan
políticas RLS `anon` nuevas.** `PADRON_SOCIOS`/`PADRON_PARCELAS` solo tienen
`SELECT` para `anon` hoy, por diseño deliberado (`20260818_fix_inspecciones_rls.sql`:
"nunca escritura") — son el padrón maestro, compartido en vivo con otro
repositorio (`backend-inspecciones`, mismo Postgres, ver
`docs/audits/auditoria_backend_inspecciones.md` §hallazgo crítico). Abrir
escritura vía `anon` expondría esas tablas (con DNI/nombre real) a
cualquiera con la anon key pública.

**En su lugar: Server Actions de Next.js** (`'use server'`,
`lib/actions/sociosActions.js`) que corren en el servidor con un cliente
Supabase nuevo autenticado con `SUPABASE_SERVICE_ROLE_KEY`
(`lib/supabaseServerClient.js`, **nunca** importado desde un componente
`'use client'`). El aislamiento multi-tenant que normalmente daría RLS pasa
a ser responsabilidad explícita del código de la Server Action — mismo
patrón ya usado en `lib/inspeccionesActions.js::saveInspeccion` (organización
activa resuelta del lado del navegador vía los registros ya cargados,
validada contra la organización real del registro existente antes de
escribir, nunca contra un valor que el propio formulario pueda enviar).

**⚠️ Requisito de entorno no satisfecho hoy:** `.env.local` no tiene
`SUPABASE_SERVICE_ROLE_KEY` configurada (confirmado, sin imprimir el
valor). Las Server Actions leen esa variable y fallan con un mensaje claro
si no está — el módulo de lectura (tabla/búsqueda/filtros) funciona igual
sin ella (usa la anon key existente), pero **el alta/edición no funcionará
en este entorno ni en producción hasta que se agregue esa variable** (aquí
y en el entorno de despliegue real, ej. Vercel). No se puede probar el
camino de escritura de punta a punta en esta sesión por este motivo — se
prueban exhaustivamente las funciones puras (validación Zod, parseo de
geometría) que no requieren la clave.

## Filtros de la tabla (decisión confirmada)

`cert_org_estatus` (dropdown, valores reales observados en los datos:
"Organico", "Sin Estatus", más los que aparezcan) + un multi-select
opcional sobre las 8 columnas booleanas de certificación (ej. filtrar
"NOP USDA = Sí" Y "Rainforest = Sí"). Sin columna `sector` — se usa
`socio_departamento`/`socio_provincia` como filtro geográfico adicional,
ya que son las columnas reales más cercanas a esa intención.

## Carga de geometría de parcela (decisión confirmada)

Modal de parcela con un campo de carga de archivo — acepta `.geojson`,
`.json`, `.kml`, `.csv`:
- **GeoJSON/JSON:** se parsea directo; acepta un objeto `geometry` crudo,
  un `Feature`, o un `FeatureCollection` (toma la primera feature).
- **KML:** se convierte con `@tmcw/togeojson` (nueva dependencia, requiere
  un DOM parser — `@xmldom/xmldom`, también nueva) a GeoJSON, toma la
  primera feature con geometría.
- **CSV:** formato esperado — una fila por vértice del polígono, columnas
  `lat,lon` (o `latitud,longitud`), en orden de recorrido. Una sola fila
  produce un `Point`; ≥ 3 filas producen un `Polygon` cerrado
  automáticamente (se repite el primer punto al final si no viene
  cerrado). Pensado para exportaciones simples de trackpoints GPS.

Todos los formatos convergen en un mismo `geometry` GeoJSON, que la Server
Action envía a `fn_sanitize_geometry` (RPC ya existente,
`supabase/migrations/20260818_gis_core_sanitization.sql`) **antes** de
guardarlo en `PADRON_PARCELAS.geom` — cumple el pedido explícito de la
tarea ("procesar vía PostGIS con fn_sanitize_geometry, EPSG:4326, 6
decimales") sin necesitar un trigger nuevo (esa tabla no tiene el trigger
de sanitización automática que sí tienen `EUDR_MONITOREO`/`EUDR_USO_SUELO`/
`EUDR_INSTALACIONES`).

## Alcance de la interfaz

- `app/dashboard/socios/page.jsx`: tabla con búsqueda en vivo (nombre/DNI/
  código de finca), filtros (`cert_org_estatus` + flags + geografía),
  paginación — lectura vía la anon key existente (`getSupabaseClient()`,
  mismo patrón que `fetchInspecciones`).
- Modal de alta/edición de Socio (`SocioFormModal`) — Zod
  (`lib/validations/socios.js`).
- Modal de alta/edición de Parcela, vinculada a un socio (`ParcelaFormModal`)
  — incluye el campo de carga de geometría.
- Botón "Productores y Parcelas" del sidebar (`components/layout/DashboardSidebar.jsx`)
  ya tiene el placeholder exacto — se conecta a `/dashboard/socios`.
- Banderas de cumplimiento EUDR: se muestran como columnas/badges de solo
  lectura en la tabla (no hay campo `cumple_eudr` en `PADRON_SOCIOS` —
  proviene de `EUDR_MONITOREO` por parcela; se omite el cruce en esta
  versión, ver "Fuera de alcance").

## Fuera de alcance de esta tarea

- Cruce con `cumple_eudr` de `EUDR_MONITOREO` por parcela (dato vive en
  otra tabla, sin vínculo trivial 1:1 con el padrón — requeriría diseño
  propio).
- Prueba de escritura real de punta a punta (bloqueada por la falta de
  `SUPABASE_SERVICE_ROLE_KEY` en este entorno).
- Edición de las 8 columnas de certificación como Sí/No individuales en el
  modal de socio se incluye (son parte del schema), pero no se agrega
  ninguna certificación nueva que no exista ya como columna.

## Criterios de aceptación

- AC1: `lib/geometryImport.js` convierte GeoJSON/KML/CSV a una geometría
  válida; CSV con 1 fila → `Point`, con ≥3 filas → `Polygon` cerrado.
- AC2: `lib/validations/socios.js` valida DNI (8 dígitos, formato peruano
  observado en los datos reales), campos requeridos, y los 8 flags de
  certificación como enum `Sí`/`No`.
- AC3: Las Server Actions nunca escriben si `ID_Organizacion` no se puede
  determinar, y rechazan una edición si la organización del registro
  existente no coincide con la activa (mismo criterio que `saveInspeccion`).
- AC4: `lib/supabaseServerClient.js` nunca se importa desde un archivo
  `'use client'` (verificado por grep, no solo por convención).
- AC5: `npm run build` compila sin errores.

## Actualización Enterprise (2026-08-18/19) — corrección de premisas del prompt

Un prompt posterior ("[PROMPT PARA CLAUDE]") pidió documentar estas
actualizaciones asumiendo tres premisas que no coincidían con el repo real
— verificadas antes de escribir esta sección, mismo criterio que el resto
de este documento:

- **No existe `ryzos_state_of_the_nation_v3.md`** en ningún lugar del
  repositorio (`find` exhaustivo, cero resultados). La bitácora de este
  módulo se agregó a `CLAUDE.md` en su lugar.
- **No existe script `npm test`** (`package.json` no tiene entrada `test`,
  y no hay Jest/Vitest/Playwright entre las dependencias — coincide con lo
  que ya documentaba este mismo `CLAUDE.md`). La suite real de este módulo
  corre con el test runner nativo de Node: `node --test tests/*.mjs`.
- **"177/177 tests pasando" es un número real pero mal atribuido.** 177 es
  el conteo exacto de `node --test tests/*.mjs` (11 archivos, incluye
  `tests/test_padron_csv.mjs` y `tests/test_socios_schema.mjs` de este
  módulo) — no de `npm test` (que no existe). Ese número **tampoco incluye
  la suite Python** (`python -m pytest tests/ -v`, 319 passed + 5 skipped),
  que es la única que corre en CI
  (`.github/workflows/test_and_deploy.yml` invoca únicamente
  `python -m pytest tests/ -v --tb=short`). **Hallazgo no solicitado:** los
  11 archivos `tests/*.mjs` (incluidos los dos de este módulo) no están
  conectados a ningún paso de CI — hoy solo se ejecutan si alguien corre
  `node --test tests/*.mjs` manualmente. Ver `docs/adr/ADR-002-padron-enterprise-y-baja-cascada.md`
  para el detalle de esta brecha y las funcionalidades documentadas.

### Funcionalidades cubiertas por esta actualización

Confirmadas contra `git log` y lectura directa del código (no contra el
prompt) — cinco commits sobre este módulo, del más antiguo al más reciente:
`659548e` (cascada de baja), `8016059` (encabezados humanizados),
`fa183a8` (plantilla dinámica de parcela + `assertSocioExists`), `8923303`
(pre-validación síncrona contra la BD), `b770d38` (no toca este módulo,
fix de columnas en vistas QGIS — mencionado por completitud del rango).

1. **Exportación dividida Socios/Parcelas con encabezados humanizados**
   (`lib/padronCsv.js:47-73`, `exportSociosCsv`/`exportParcelasCsv`). Cada
   export es un fetch independiente (`activo = true` únicamente) sobre su
   propia tabla — no hay un CSV combinado. Los encabezados de columna usan
   `SOCIO_FIELD_LABELS`/`PARCELA_FIELD_LABELS` (ej. `ID_Socio` → "Código de
   Socio"), la misma fuente de texto que ya usan los modales de
   alta/edición (`CERT_FLAG_FIELDS`/`HECTARE_FIELDS` en
   `lib/validations/socios.js`) — evita que el CSV y el formulario diverjan
   con el tiempo.
2. **Plantillas CSV dinámicas pre-calculadas** (`buildSocioTemplateCsv`/
   `buildParcelaTemplateCsv`, `lib/padronCsv.js:150-192`). El `ID_Socio` de
   ejemplo en la plantilla de Socios ya no es el `"JS-00001"` fijo (que
   choca con datos reales de prueba de este proyecto) — se calcula como el
   siguiente correlativo libre a partir del más alto ya usado en la
   organización activa (`computeNextCodes`, `lib/parcelaDefaults.js`), con
   fallback al valor fijo si no hay conexión u organización nueva. La
   plantilla de Parcelas hace lo mismo para `ID_Socio` (usa hasta 2 socios
   reales y activos existentes en vez de un ID inventado) y para
   `ID_Parcela_Fija`/`parcela_codigo` (códigos libres, no `"P-01"` fijo que
   podría chocar con una parcela real).
3. **Pre-validación síncrona en la vista previa de carga masiva**
   (`applySocioDbChecks`/`applyParcelaDbChecks`, `lib/padronCsv.js:358-465`,
   invocadas desde `validateSocioRows`/`validateParcelaRows` cuando se les
   pasa `supabase`/`organizationId`). Antes de este cambio, un DNI/Código de
   Socio/Código de Finca/Parcela Código duplicado contra la base (no solo
   contra el propio archivo) solo se detectaba al confirmar la importación,
   fila por fila. Ahora la vista previa consulta la BD en tiempo real
   (`IN (...)` sobre los valores presentes en el archivo, una sola consulta
   por campo, no N+1) y marca cada fila inválida con el motivo exacto antes
   de que el usuario presione "Confirmar Importación". El chequeo al
   confirmar (`assertDniNotDuplicated`, etc., en
   `lib/actions/sociosActions.js`) se mantiene sin cambios — es la garantía
   real ante una carrera entre la vista previa y la confirmación; la
   pre-validación es una mejora de UX, no un reemplazo.
4. **Baja lógica con sincronización en cascada** (`deactivateSocio`,
   `lib/actions/sociosActions.js:410-439`). Dar de baja un socio
   (`activo = false`) ahora también marca `activo = false` en todas sus
   filas de `PADRON_PARCELAS` en la misma llamada — antes dejaba las
   parcelas del socio dado de baja en `activo = true`, huérfanas en el
   padrón activo. Alcance deliberadamente limitado a `PADRON_PARCELAS`: no
   toca `EUDR_MONITOREO` ni las vistas WebGIS/EUDR (ver ADR-002, sección
   "Consecuencias"). Migración de sincronización retroactiva:
   `supabase/migrations/20260818_sync_parcelas_baja_por_socio_inactivo.sql`
   (aplica el mismo criterio a bajas ya hechas con el flujo viejo, antes de
   la cascada).
5. **Protección multi-tenant e integridad referencial —
   `assertSocioExists`** (`lib/actions/sociosActions.js:195-208`). Antes de
   esta función, `createParcela` podía crear una parcela "huérfana" si el
   `ID_Socio` referenciado no existía en la organización activa (por
   ejemplo, un CSV importado con un ID mal tipeado) — no había ningún
   chequeo explícito de existencia del socio padre, a diferencia de
   `assertMatchesExistingOrg` (que valida el registro que se está
   editando, no una referencia a otra entidad). `assertSocioExists` se
   invoca en `createParcela` y su lógica se adelanta también a la vista
   previa de importación (`applyParcelaDbChecks`, punto 3 arriba).
