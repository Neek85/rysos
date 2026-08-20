# Schema Live — Snapshot Manual

> **Nota de alcance:** este documento es un snapshot manual derivado de leer
> `supabase/migrations/*.sql` en orden cronológico. No existe ningún script
> `npm run sync-schema` en este repo (no hay conexión Postgres viva ni
> Service Role Key disponible en este entorno de desarrollo) — para mantenerlo
> al día, volver a generarlo a mano tras cada migración nueva, o pedir que se
> regenere leyendo el historial completo de `supabase/migrations/`.
>
> **Instancia Supabase:** `jhtocgxlozfuzullrtol`. Ninguna migración de este
> repo se aplica automáticamente contra esa instancia — todas requieren
> ejecución manual en el SQL Editor de Supabase Studio (ver cada archivo).
>
> Generado: 2026-08-18, tras `20260818_gis_core_sanitization.sql`.
> Actualizado: 2026-08-18, tras auditoría de integración documentada en
> `docs/adr/ADR-001-gis-sanitization-and-eudr-triggers.md`.
> Actualizado: 2026-08-18, tras auditoría del Portal Público de
> Trazabilidad (`specs/trace_public_audit.md`) — sin cambios de schema, ver
> nota en la sección de `vw_monitoreo_web` abajo.
> Actualizado: 2026-08-18, tras auditoría del Exportador TRACES UE / Dossier
> Comercial (`specs/traces_eudr_dossier_audit.md`) — sin cambios de schema,
> ver nota al final de la sección de `vw_monitoreo_web` sobre el estado real
> de `/dashboard/lotes` vs `/dashboard/mapa` y el Dossier PDF.
> Actualizado: 2026-08-18, tras implementar el Dossier PDF nativo en JS
> (`specs/pdf_dossier_native_js.md`) — agrega la ruta
> `/api/trace/[lot_hash]/pdf` (sin cambios de schema) y confirma, por
> primera vez con una consulta REST real, que **`vw_monitoreo_web` SÍ está
> aplicada y devuelve datos reales aprobados en la instancia
> `jhtocgxlozfuzullrtol`** (organización `ORG-COOP-NORTE`, 6 registros/3
> parcelas al momento de la prueba) — al menos en su versión de
> `20260817_refine_vw_monitoreo_web.sql` o anterior. **No confirmado:** si
> alguna de las 5 migraciones nuevas del 2026-08-18 (sanitización GIS, RLS
> fortification, flags de área en las vistas, guardado atómico de
> Inspecciones, fix RLS Inspecciones) ya está aplicada encima — la consulta
> de esta tarea no pidió esas columnas nuevas.
> Actualizado: 2026-08-18, tras construir el Padrón Web de Socios y Fincas
> (`specs/padron_web_socios.md`, `/dashboard/socios`) — confirma el schema
> real completo de `PADRON_SOCIOS`/`PADRON_PARCELAS` (antes solo
> parcialmente documentado) y agrega la primera Server Action del proyecto.
> Actualizado: 2026-08-19, tras polish de `/dashboard/mapa`
> (`specs/gis_mapa_dashboard_polish.md`) — `vw_monitoreo_web` gana
> `productor_nombre` (`20260819_vw_monitoreo_web_productor_nombre.sql`), ver
> nota en la sección de esa vista abajo.

## Tablas base (pre-existentes, no creadas por migraciones de este repo)

Las tablas siguientes existen en la base de datos pero **no** tienen
`CREATE TABLE` en el historial de migraciones — fueron creadas fuera de este
repo (Supabase Studio / otra herramienta). Las columnas listadas son solo las
referenciadas por las migraciones y vistas de este repo; puede haber columnas
adicionales no documentadas aquí.

### `public."ORGANIZACIONES"`
- `"ID"` — PK de tenant (texto), comparado contra el claim JWT `ID_Organizacion`.
- RLS: solo `SELECT` (asimetría deliberada — Tarea 9.1).

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
`cert_lpo_mx`, `cert_rainforest`, `cert_comercio_justo`, `cert_fair_trade_usa`),
`socio_fecha_ingreso`, `creado_en`, `actualizado_en`, `creado_por`.
**No existe ninguna columna `sector`** (verificado — algo a tener presente si
una tarea futura la asume).
- RLS: lectura/escritura para `authenticated` scopeado a `ID_Organizacion`
  (Tarea 9.1) + lectura adicional para `anon` (fix Inspecciones, 2026-08-18).
  **Sin política de escritura para `anon`, por diseño deliberado** — ver
  módulo Padrón Web abajo.

### `public."PADRON_PARCELAS"`
Schema real completo confirmado en vivo el 2026-08-18: `ID_Parcela_Fija` (PK,
código manual ej. `COOP-JS-001`), `ID_Organizacion`, `ID_Socio`, `socio_dni`/
`socio_nombre_completo` (copias desnormalizadas del socio — más superficie de
PII a cuidar en cualquier vista/export que use esta tabla), `parcela_codigo`,
`parcela_nombre`, `hcp`/`hcc`/`ho`/`hip`/`hrp`/`hbp`/`otros_cultivo` (hectáreas
por categoría de uso, nomenclatura heredada de AppSheet), `totalh` (suma de
las categorías), `geom` (**`NULL` en la mayoría de registros reales
confirmados** — no asumir que siempre hay geometría), `creado_en`,
`actualizado_en`, `creado_por`, `hr`.
- RLS: igual patrón que `PADRON_SOCIOS` — sin escritura `anon`.

### Módulo Padrón Web de Socios y Fincas (2026-08-18, `/dashboard/socios`)

Primer módulo de escritura del proyecto que **no** usa una política RLS
`anon` nueva. `PADRON_SOCIOS`/`PADRON_PARCELAS` son el padrón maestro,
compartido en vivo con otro repositorio
(`docs/audits/auditoria_backend_inspecciones.md`) — abrir escritura `anon`
expondría DNI/nombre real a cualquiera con la anon key pública. En su lugar:

- **Lectura:** `lib/sociosSearch.js`, vía la anon key existente (mismo
  patrón que `fetchInspecciones` — sin filtro explícito por
  `ID_Organizacion`, la tabla mezcla datos de todas las organizaciones
  visibles a `anon`, mismo comportamiento pre-existente que el resto del
  proyecto).
- **Escritura:** `lib/actions/sociosActions.js` — Server Actions (`'use server'`)
  que usan `lib/supabaseServerClient.js` (cliente con `SUPABASE_SERVICE_ROLE_KEY`,
  bypasea RLS, **nunca** importado desde un archivo `'use client'` —
  verificado por grep). El aislamiento multi-tenant es responsabilidad
  explícita del código (mismo patrón que `saveInspeccion`/
  `fn_guardar_inspeccion_completa`): la organización activa viene del
  cliente, y en edición se valida contra la organización real del registro
  existente antes de escribir.
- **`SUPABASE_SERVICE_ROLE_KEY`:** el usuario la agregó a `.env.local` el
  mismo día (después de que se confirmara faltante) — la escritura real ya
  se probó en vivo (crear/editar socios, ver historial de la sesión). El
  flujo hasta ahí (Server Action → Zod → escritura) fue verificado
  funcionando correctamente antes de que se agregara la clave (fallaba con
  el mensaje claro esperado, cero filas escritas) y después (escritura
  real confirmada por el usuario probando la UI).
- **Geometría de parcela:** carga de archivo `.geojson`/`.json`/`.kml`/`.csv`
  (`lib/geometryImport.js`, incluye `@tmcw/togeojson`+`@xmldom/xmldom` como
  dependencias nuevas para KML), sanitizada server-side vía RPC
  `fn_sanitize_geometry` (`lib/actions/sociosActions.js::sanitizeGeometryForStorage`)
  antes de guardar — mismo mecanismo ya confirmado funcionando en
  `docs/audits/verification_checklist_20260818.md`.
- **Baja lógica (2026-08-18, `20260818_padron_baja_logica.sql`):** columna
  `activo boolean default true` agregada a ambas tablas — decisión
  confirmada con el usuario (no DELETE físico, ya que el padrón es
  compartido con otro repositorio y sus IDs pueden estar referenciados
  desde `INSPECCIONES`/`EUDR_MONITOREO`). `lib/sociosSearch.js` filtra
  `activo = true` por defecto — **requiere esta migración aplicada, sin
  ella las consultas de lectura del módulo fallan** con "column ... activo
  does not exist". `deactivateSocio`/`deactivateParcela`
  (`lib/actions/sociosActions.js`) ponen `activo = false`, con la misma
  validación multi-tenant que el resto de las Server Actions del módulo.
- **Ubigeo Perú (`lib/data/ubigeo_peru.json`):** dataset de 25
  departamentos / 196 provincias / ~1869 distritos generado por el modelo
  a partir de su conocimiento de entrenamiento — **no descargado ni
  verificado contra una fuente oficial INEI en vivo** (sin acceso a
  internet en este entorno), decisión confirmada explícitamente con el
  usuario pese a la advertencia. Ver el campo `_meta` del propio JSON para
  el detalle de confianza por nivel. `components/features/socios/UbigeoSelect.jsx`
  siempre ofrece "Otro / no está en la lista" en los 3 niveles, así que un
  distrito real ausente del dataset nunca bloquea el alta de un socio —
  cae automáticamente a texto libre, incluso al editar un socio existente
  cuyo departamento/provincia/distrito no esté en el JSON.
- **Exportación/Importación CSV (`lib/padronCsv.js`):** exporta todo el
  padrón activo (no solo la página visible) en dos archivos
  (`Padron_Socios_*.csv`, `Padron_Parcelas_*.csv`). La importación
  (`components/features/socios/ImportPadronModal.jsx`) exige una vista
  previa (válidas vs. con error, vía los mismos schemas Zod que el
  formulario) antes de escribir nada — decisión confirmada con el usuario,
  dado que la escritura usa la Service Role Key. Cada fila válida se
  guarda reutilizando `createSocio`/`createParcela` (no una RPC bulk
  nueva), así que hereda automáticamente toda su validación multi-tenant.

### `public."EUDR_MONITOREO"`
- `id_monitoreo` (uuid, PK — **no** tiene columna `fid`, a diferencia de
  `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`), `"ID_Organizacion"`,
  `"ID_Parcela_Fija"`, `"ID_Socio"`, `nuevo_productor_nombre`,
  `fecha_monitoreo`, `tecnico_responsable`, `precision_gps`, `evidencia_foto`,
  `cumple_eudr`, `observaciones`, `estado_revision`,
  `geom_inspeccion` (geometry genérica, Point o Polygon según cómo capturó
  QField).
- **Nuevo (2026-08-18):** `area_calculada_ha numeric`,
  `requiere_revision_area boolean` — ver
  `supabase/migrations/20260818_gis_core_sanitization.sql`.
- RLS: `rls_select_eudr_monitoreo` / `rls_write_eudr_monitoreo`, scopeadas a
  `authenticated` + `ID_Organizacion` (Tarea 9.1).
- Trigger `trg_auto_org_eudr_monitoreo` (BEFORE INSERT): auto-inyecta
  `ID_Organizacion` desde el JWT si viene nulo/vacío.
- **Nuevo (2026-08-18):** trigger `trg_gis_sanitize_eudr_monitoreo`
  (BEFORE INSERT OR UPDATE OF `geom_inspeccion`): sanitiza SRID/topología/
  precisión y calcula `area_calculada_ha`/`requiere_revision_area`.
- **Nuevo (2026-08-18):** índice GiST `idx_gist_eudr_monitoreo_geom` sobre
  `geom_inspeccion`; índice btree `idx_eudr_monitoreo_org` sobre
  `"ID_Organizacion"`.

### `public."EUDR_USO_SUELO"`
- `fid` (feature id nativo del GeoPackage), `id` (PK real de la tabla),
  `"ID_Organizacion"`, `id_parcela`, `tipo_uso`, `estado_revision`, `geom`.
- **Nuevo (2026-08-18):** `area_calculada_ha`, `requiere_revision_area`,
  trigger `trg_gis_sanitize_eudr_uso_suelo`, índices GiST/`ID_Organizacion`
  (mismo patrón que `EUDR_MONITOREO`, ver arriba).

### `public."EUDR_INSTALACIONES"`
- `fid`, `id` (inferido por simetría con `EUDR_USO_SUELO`, no confirmado
  explícitamente contra el schema real), `"ID_Organizacion"`, `id_parcela`,
  `tipo_infra`, `evidencia_foto`, `estado_revision`, `geom` (puntual en la
  práctica).
- **Nuevo (2026-08-18):** mismo patrón de columnas/trigger/índices que arriba.

> **Nuevo path de escritura desde el frontend (2026-08-19, Ingestor de
> Capas Espaciales, `specs/gis_ingestor_web.md`):** hasta ahora estas 3
> tablas solo se escribían desde `scripts/etl_drive_to_supabase.py` (ETL
> de campo) y ediciones manuales en QGIS Desktop. `lib/actions/gisActions.js::uploadGeoSpatialFeature`
> agrega un tercer origen: el modal `CargaEspacialModal.jsx` en
> `/dashboard/mapa`, que sube capas GeoJSON/KML/Shapefile-ZIP subidas a
> mano. Escribe con la Service Role Key (bypasea RLS, igual que
> `sociosActions.js`), nunca calcula `area_calculada_ha` ni sanitiza la
> geometría por su cuenta — confía por completo en el trigger
> `trg_gis_sanitize_eudr_*` ya existente en cada tabla. `estado_revision`
> siempre se fija en `'PENDIENTE'`, así que un registro cargado por este
> path entra al mismo flujo de revisión QGIS QC que los datos de campo, y
> no aparece en `/dashboard/mapa` (que consume `vw_monitoreo_web`,
> filtrado a `APROBADO`) hasta ser aprobado ahí.

### `public."INSPECCIONES"` + `public."CAP_DATOS_SOCIO"` / `"CAP_MIC"` /
`"CAP_CONSERVACION"` / `"CAP_BIENESTAR"` / `"CAP_RIESGOS"` / `"CAP_GESTION"`
(Fase 6 — módulo de inspecciones socioeconómicas)
- `INSPECCIONES."ID_Organizacion"` requerido (no nulo) por política RLS.
- Los 6 `CAP_*` no tienen `ID_Organizacion` propia (dependen de
  `ID_Inspeccion → INSPECCIONES`); RLS abierta (`USING (true)`) — ver
  `supabase/migrations/20260818_fix_inspecciones_rls.sql` para el razonamiento
  completo (el frontend usa `anon` key sin sesión real, no hay Supabase Auth
  implementado en el proyecto).

> **Guardado atómico (2026-08-18, `20260818_inspecciones_atomic_save.sql`):**
> `lib/inspeccionesActions.js::saveInspeccion()` ya no hace 7 INSERT/UPDATE
> independientes vía REST — llama a `public.fn_guardar_inspeccion_completa`
> (ver sección Funciones), que envuelve `INSPECCIONES` + las 6 `CAP_*` en
> una sola transacción. Antes, una falla a mitad de camino podía dejar
> registros huérfanos (fila en `INSPECCIONES` sin todas sus tablas hijas).

## Vistas

### `public.vw_monitoreo_poligonos` / `public.vw_monitoreo_puntos`
Auditoría QGIS. `UNION ALL` de `EUDR_MONITOREO` (filtrado por
`ST_Dimension(geom_inspeccion)`) + `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`. Cast
explícito a `geometry(MultiPolygon,4326)` / `geometry(Point,4326)` en cada
rama del `UNION ALL` para que QGIS Desktop resuelva el tipo/SRID desde el
catálogo sin pedir "reparar capa". Exponen `geom` y `geom_inspeccion` (alias
duplicado por compatibilidad con proyectos QGIS antiguos) e `id_monitoreo`
(uuid nunca nulo — sintético vía `uuid_generate_v5` para filas que no son de
`EUDR_MONITOREO`).

### `public.vw_monitoreo_web`
Consumida por `components/gis/MapDashboard.jsx` **y** por
`app/trace/[lot_hash]/page.jsx` (Portal Público de Trazabilidad,
auditado 2026-08-18 — ver `specs/trace_public_audit.md`). El portal público
consulta esta vista **sin filtrar por `ID_Organizacion`** (trae registros de
todas las organizaciones) porque la URL pública no lleva organización — el
fetch ocurre enteramente en un Server Component (`findLotByHash()`, sin
`'use client'`), así que el resultado multi-organización nunca llega al
navegador: solo el payload ya sanitizado (vía
`lib/traceabilityHash.js::buildPublicSanitizedPayload`, remueve `socio_dni`/
`socio_nombre`/`socio_nombre_completo`/`conyuge_dni`/`productor`/
`id_parcela`) de la única organización cuyo `lot_hash` recalculado coincide
se serializa en la respuesta HTML. Sin gaps encontrados en esta auditoría.

> **Riesgo latente documentado (no explotable hoy):** el hash público se
> calcula con `lib/traceabilityHash.js::generateLotHash()`, que difiere de
> `scripts/generate_lot_qr.py::generate_lot_hash()` (Python, Tarea 14) en el
> campo usado por Feature (`id_parcela` en JS vs. solo `id_monitoreo` en
> Python — esta vista nunca expone `id_monitoreo`) y en el set de campos PII
> filtrados (`_PII_FIELDS` de Python no incluye `productor`/`id_parcela`).
> El script Python nunca se ejecuta hoy contra payloads con la forma real de
> `vw_monitoreo_web` (sus tests usan fixtures con `id_monitoreo` explícito),
> así que no hay inconsistencia observable en producción — pero si alguien
> reutiliza el script Python contra este schema, debe alinear ambos primero
> o los hashes Python/JS del mismo lote no coincidirán. Ver
> `specs/trace_public_audit.md` para el detalle completo.

> **Exportador TRACES UE — dónde vive realmente cada pieza (auditado
> 2026-08-18, `specs/traces_eudr_dossier_audit.md`):** el botón real de
> descarga DDS (`exportTracesDDS`, JSON + GeoJSON con coordenadas a 6
> decimales y regla de polígono obligatorio ≥ 4 ha, `lib/eudrDdsExporter.js`)
> vive en `/dashboard/mapa` (`components/gis/MapDashboard.jsx::handleExportDDS`),
> **no** en `/dashboard/lotes` — esa ruta es solo una vista de simulación
> del QR de trazabilidad pública (dice explícitamente "no persiste nada" en
> su propio código). Ambos consumen `vw_monitoreo_web`, que ya filtra
> `estado_revision = 'APROBADO'`. **Dossier Comercial PDF (`scripts/generate_dossier_pdf.py`)
> no tiene ningún punto de entrada desde la aplicación web** — es una clase
> Python pura, probada, sin `if __name__ == "__main__"`, y esta app Next.js
> no tiene ningún Route Handler (`find app -iname "route.js"` → vacío) que
> pudiera invocarla. Generar un Dossier PDF hoy solo es posible ejecutando
> Python manualmente. Cerrar esto requiere una decisión de arquitectura
> (portar a JS, exponer un Route Handler que llame a Python, o un servicio
> HTTP aparte) — ver la spec para las opciones evaluadas, ninguna
> implementada todavía.
>
> **Actualización 2026-08-18 — cerrado (Opción 1: nativo JS):** el Dossier
> Comercial ya es generable desde la app real. Nueva ruta
> `GET /api/trace/[lot_hash]/pdf` (`app/api/trace/[lot_hash]/pdf/route.js`,
> `runtime = 'nodejs'`) — reusa `lib/lotLookup.js::findLotByHash` (extraído
> de la página pública para no duplicar la lógica de resolución de hash) y
> `lib/pdf/renderDossierPdf.js` (`@react-pdf/renderer`, nueva dependencia
> de producción) para devolver `application/pdf`. Botón "Descargar Dossier
> EUDR (PDF)" agregado en `/trace/[lot_hash]` y `/dashboard/lotes`. El PDF
> incluye un mapa esquemático de las parcelas (`lib/pdf/geometryToSvg.js`,
> proyección vectorial simple, sin basemap externo) pero **deliberadamente
> no incluye nada del módulo de Inspecciones FED** (`INSPECCIONES`/`CAP_*`)
> — decisión de seguridad confirmada con el usuario, ver
> `specs/pdf_dossier_native_js.md`. Probado contra la instancia real con
> datos aprobados en vivo, no solo con fixtures.

Filtra estrictamente
`estado_revision = 'APROBADO'`. `LEFT JOIN` a `PADRON_PARCELAS` (
`parcela_codigo`, `parcela_nombre`, `area_ha`) + `LEFT JOIN LATERAL` a
`EUDR_MONITOREO` para resolver `productor` en filas de
`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` (que no tienen productor propio, usa la
visita de monitoreo más reciente sobre la misma parcela). Expone
`geom_geojson` (`ST_AsGeoJSON(geom)::json`) porque PostgREST serializa
`geometry` cruda como WKB hex, no como GeoJSON.

> **`productor_nombre` agregado (2026-08-19,
> `20260819_vw_monitoreo_web_productor_nombre.sql`):** `productor` (el
> valor crudo, `ID_Socio` o texto libre) se conserva sin cambios;
> `productor_nombre` es un `LEFT JOIN` nuevo a `PADRON_SOCIOS` que resuelve
> `socio_nombre_completo` cuando `productor` matchea un `ID_Socio` real
> (PII, catalogada desde Tarea 14). **Esta vista sigue sin filtrar por
> `ID_Organizacion`** (no cambió con esta migración) — el cierre del riesgo
> cross-tenant para el nombre se hizo del lado del cliente
> (`components/gis/MapDashboard.jsx` ahora resuelve la organización activa
> en un fetch previo liviano y filtra la consulta completa por ella, ver
> `specs/gis_mapa_dashboard_polish.md`), no en la vista — cualquier otro
> consumidor futuro de esta vista sin ese mismo filtro cliente-side
> quedaría expuesto al mismo riesgo que ya se corrigió una vez en
> `view_eudr_dashboard_aprobados`.

> **Fallback de `productor_nombre` vía dueño de parcela (2026-08-19,
> `20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql`):** el
> primer intento de resolución (JOIN sobre el `productor` ya resuelto —
> `ID_Socio` de la visita EUDR_MONITOREO más reciente de la parcela) deja
> "Sin registrar" a cualquier Subdivisión/Infraestructura cuya parcela nunca
> tuvo una visita EUDR_MONITOREO registrada (común si se cargó vía el
> Ingestor de Capas Espaciales o el Editor Vectorial, sin perímetro QField
> previo). Se agrega un segundo `LEFT JOIN` independiente a `PADRON_SOCIOS`
> (alias `ps_parcela`) sobre `PADRON_PARCELAS."ID_Socio"` (el dueño
> REGISTRADO de la parcela — `pp` ya estaba joineada en esta vista, no hace
> falta un JOIN nuevo a `PADRON_PARCELAS`), como fallback independiente del
> primero (no se fusionan las llaves en un solo JOIN porque un `productor`
> de texto libre no debe bloquear el intento de resolver por el dueño real
> de la parcela).
>
> **Cascada final con default literal (2026-08-19, misma migración,
> actualizada el mismo día):** `productor_nombre` ya nunca es `NULL` —
> `COALESCE(ps.socio_nombre_completo, ps_parcela.socio_nombre_completo,
> src.productor, mon.productor, 'Socio no asignado')`. El texto libre
> (`nuevo_productor_nombre`, cuando un técnico QField anotó un nombre sin
> `ID_Socio` formal) se conserva ANTES del default — solo cae a "Socio no
> asignado" cuando no hay absolutamente ningún dato de productor. Se evaluó
> y descartó un "parche defensivo" client-side en `MapDashboard.jsx` que
> buscara en otras filas de `records` la misma parcela: como esta cascada es
> determinística por parcela+organización, todas las filas de una misma
> parcela ya comparten el mismo `productor_nombre` calculado por la vista —
> no hay ningún valor mejor que un parche así pudiera encontrar.

> **Gap de integración cerrado (2026-08-18):** `vw_monitoreo_poligonos`,
> `vw_monitoreo_puntos` y `vw_monitoreo_web` ahora exponen `area_calculada_ha`
> y `requiere_revision_area` en cada rama de su `UNION ALL` — ver
> `supabase/migrations/20260818_fix_views_eudr_flags.sql` y el addendum en
> `docs/adr/ADR-001-gis-sanitization-and-eudr-triggers.md`. El gap original
> (detectado el mismo día, columnas del trigger de sanitización invisibles
> para las vistas) queda documentado ahí como referencia histórica.

### `public.view_eudr_dashboard_aprobados`
Vista original de Fase 1 (schema más viejo, columnas `parcela_codigo`/
`hectareas_totales` vía joins directos a `PADRON_PARCELAS`/`PADRON_SOCIOS`)
— sigue viva y en uso por `app/page.jsx`, línea de trabajo distinta de
`vw_monitoreo_web`. No confundir una con otra.

> **Fix de seguridad (2026-08-18, `20260818_rls_multi_tenant_fortification.sql`):**
> esta vista exponía `socio_nombre_completo`/`socio_dni` (PII) **sin ningún
> filtro por `ID_Organizacion`** — cualquier sesión que pudiera consultarla
> veía nombre y DNI de productores de todas las organizaciones cliente, no
> solo la propia (la vista corre con privilegio de su dueño `postgres`,
> igual que el resto de vistas del proyecto). Corregido: se removieron las
> dos columnas PII (`app/page.jsx`, el único consumidor real, no las usaba)
> y se agregó `WHERE ... AND "ID_Organizacion" = public.auth_org_id()`.
> `localidad`/`certificaciones` se conservaron (no forman parte del set de
> PII ya establecido por Tarea 14 — `socio_dni`, `socio_nombre_completo`,
> `socio_nombre`, `conyuge_dni`).

> **Fix de columnas rotas + geom_geojson (2026-08-18,
> `20260818_fix_dashboard_view_columns.sql`):** `app/page.jsx` pedía
> `hectareas`/`riesgo_satelital`/`lot_hash` — ninguna existía en esta
> vista, confirmado por error real en vivo
> (`column view_eudr_dashboard_aprobados.hectareas does not exist`).
> Corregido: `app/page.jsx` ahora usa `hectareas_totales` (columna real);
> `riesgo_satelital` se removió del todo (nunca se calculó ni persistió en
> ningún lado de este schema, no solo faltaba en el SELECT); `lot_hash` se
> removió de la tabla por fila (es un concepto agregado por organización,
> no por parcela, y por diseño nunca se persiste) — el enlace a
> trazabilidad pública se movió a un único link de sección hacia
> `/dashboard/lotes`, que ya cubre esa función correctamente.
> `components/RiskBadge.jsx` se eliminó (quedó sin ningún consumidor).
> También se agregó `geom_geojson` a la vista (mismo patrón que
> `vw_monitoreo_web`) porque `components/EUDRMap.jsx` hacía
> `JSON.parse(record.geom)` directo sobre geometry cruda (WKB hex, no
> GeoJSON) — fallaba silenciosamente para cada fila, el mapa nunca
> mostraba ningún polígono. **Esta migración (`20260818_fix_dashboard_view_columns.sql`)
> no estaba aplicada al momento de escribir esta nota** — confirmado en
> vivo: `hectareas_totales` ya funciona, `geom_geojson` todavía no existe
> hasta que se aplique.

## Funciones

| Función | Retorno | Uso |
|---|---|---|
| `public.auth_org_id()` | `text` | Extrae `ID_Organizacion` del claim JWT (`request.jwt.claims`). Autoritativa desde Tarea 9.1. |
| `public.get_my_org_id()` | `text` | Alias delgado sobre `auth_org_id()` — preservado por compatibilidad con `trg_set_id_organizacion()`. |
| `public.trg_set_id_organizacion()` | `trigger` | Auto-inyecta `ID_Organizacion` en INSERT si viene nulo/vacío. |
| `public.fn_sanitize_geometry(geometry)` | `geometry` | **Nuevo (2026-08-18).** SRID 4326 + `ST_MakeValid` + `ST_SnapToGrid` a 6 decimales. |
| `public.fn_calcular_area_ha(geometry)` | `numeric` | **Nuevo (2026-08-18).** Área geodésica en hectáreas; `NULL` para geometrías no poligonales. |
| `public.trg_sanitize_geom_monitoreo/uso_suelo/instalaciones()` | `trigger` | **Nuevo (2026-08-18).** Aplican las dos funciones de arriba a la columna de geometría de su tabla y setean `area_calculada_ha`/`requiere_revision_area`. |
| `public.fn_guardar_inspeccion_completa(...)` | `jsonb` (`{id, created}`) | **Nuevo (2026-08-18).** Guardado atómico de `INSPECCIONES` + 6 `CAP_*` en una sola transacción — reemplaza 7 llamadas REST independientes que antes no eran atómicas. Sin `SECURITY DEFINER` (corre con el rol del llamador). Llamada desde `lib/inspeccionesActions.js::saveInspeccion()` vía `supabase.rpc(...)`. |
| `public.fn_validar_topologia_eudr(p_tabla_origen text, p_registro_id text)` | `jsonb` | **Nuevo (2026-08-20), actualizada el mismo día.** Validación topológica bajo demanda (`ST_IsValid`/`ST_IsSimple`/solapamiento contra otros `APROBADO` de la misma org/`fn_calcular_area_ha`) para un registro `EUDR_MONITOREO`/`EUDR_USO_SUELO` — rechaza `EUDR_INSTALACIONES` (siempre puntual). Sin `SECURITY DEFINER`; se llama solo desde `app/api/qc/validate-spatial/route.js` con el Service Role Key. El campo `deforestacion` cruza contra `EUDR_COBERTURA_BOSCOSA_2020` SI esa tabla tiene filas (`anio_perdida > 2020` + `ST_Intersects`) — mientras siga vacía (estado por defecto), sigue devolviendo `{disponible:false,...}` igual que su primera versión. |

## Tablas nuevas fuera del núcleo EUDR/Padrón

- **`public.qc_validation_audit_log`** (2026-08-20): auditoría de
  `fn_validar_topologia_eudr` — `tabla_origen`, `registro_id`,
  `"ID_Organizacion"` (código, no PII), `resultado jsonb`, `created_at`.
  RLS habilitada sin políticas (solo Service Role Key la toca).
- **`public."EUDR_COBERTURA_BOSCOSA_2020"`** (2026-08-20,
  `specs/eudr_forest_cover_2020_schema.md`): dataset de referencia
  COMPARTIDO (deliberadamente **sin** `ID_Organizacion` — es una verdad
  geográfica, no un dato propiedad de una organización, mismo criterio
  que `lib/data/ubigeo_peru.json`) de eventos de pérdida de cobertura
  forestal — `id`, `geom geometry(MultiPolygon,4326)`, `anio_perdida
  integer` (convención "loss year" de Hansen GFW), `fuente text`,
  `dataset_version text`, `created_at`. Índice GiST sobre `geom` + btree
  sobre `anio_perdida`. RLS: `SELECT` para `authenticated` (higiene, no
  la defensa real). **Sigue vacía** — cargar un dataset real (MINAM
  Geobosques/Hansen GFW/SERNANP) es una tarea de ingesta de datos aparte,
  no incluida en esta migración.

## Índices espaciales

Antes de `20260818_gis_core_sanitization.sql` **no existía ningún índice
GiST** sobre columnas de geometría en el historial de migraciones del
proyecto. Esa migración agrega:
- `idx_gist_eudr_monitoreo_geom` (GiST, `EUDR_MONITOREO.geom_inspeccion`)
- `idx_gist_eudr_uso_suelo_geom` (GiST, `EUDR_USO_SUELO.geom`)
- `idx_gist_eudr_instalaciones_geom` (GiST, `EUDR_INSTALACIONES.geom`)
- `idx_eudr_monitoreo_org` / `idx_eudr_uso_suelo_org` / `idx_eudr_instalaciones_org`
  (btree sobre `"ID_Organizacion"`, soporta el filtro multi-tenant de RLS/vistas)

## RLS — estado real (importante, no obvio desde las migraciones solas)

El frontend (`lib/supabaseClient.js`) usa **solo la anon key, sin sesión de
Supabase Auth** (`signInWithPassword` no aparece en ningún archivo del repo).
Las políticas `authenticated`-only de Tarea 9.1 sobre `EUDR_*`/`PADRON_*`
**no aplican** al tráfico real del frontend — ese tráfico funciona porque las
vistas (`vw_monitoreo_web`, etc.) corren con el privilegio de su dueño
(`postgres`), no del rol que realmente consulta (`anon`). Un `SELECT` directo
a `PADRON_PARCELAS` con la anon key devuelve 0 filas. El módulo de
Inspecciones (`INSPECCIONES` + `CAP_*`) sí escribe directo con la anon key, y
por eso tiene políticas `anon`-abiertas explícitas (`fix_inspecciones_rls`,
2026-08-18) — ver ese archivo para el razonamiento de seguridad completo.

### Auditoría RLS Multi-Tenant (2026-08-18, `20260818_rls_multi_tenant_fortification.sql`)

Se re-certificaron de forma idempotente (mismas políticas, sin cambio de
comportamiento) las políticas Zero-Trust ya existentes de Tarea 9.1 sobre
`ORGANIZACIONES`/`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`,
usando `public.auth_org_id()` (no se creó ninguna función helper nueva). Se
formaliza aquí, explícitamente, qué tablas quedan **fuera** del modelo
Zero-Trust y por qué — **riesgo aceptado por diseño, no un descuido**:

| Tabla | Motivo |
|---|---|
| `INSPECCIONES` | Frontend escribe con anon key sin sesión real; política exige solo `ID_Organizacion IS NOT NULL`, no coincidencia contra JWT (no hay JWT real que comparar). |
| `CAP_DATOS_SOCIO`, `CAP_MIC`, `CAP_CONSERVACION`, `CAP_BIENESTAR`, `CAP_RIESGOS`, `CAP_GESTION` | No tienen columna `ID_Organizacion` propia (dependen de `ID_Inspeccion → INSPECCIONES`); política `USING (true)` para `anon`+`authenticated`. |
| `PADRON_SOCIOS` / `PADRON_PARCELAS` (solo la política `anon` de lectura) | Habilitada para autocompletado del formulario de Inspecciones; la escritura sigue exclusiva de `authenticated` + `auth_org_id()` desde Tarea 9.1, sin cambios. |

Cerrar este riesgo requiere implementar Supabase Auth real (sesión con JWT
que lleve el claim `ID_Organizacion`) — no está en el alcance de ninguna
tarea hasta ahora.

**Hallazgo y fix no solicitado, encontrado durante esta auditoría:**
`view_eudr_dashboard_aprobados` exponía PII (`socio_dni`,
`socio_nombre_completo`) de **todas** las organizaciones, sin ningún filtro
de tenant — ver la sección de esa vista arriba para el detalle completo del
fix.

## Storage

Bucket `evidencias_eudr` (privado). Ruta: `{ID_Organizacion}/{filename}`.
Políticas `rls_storage_*_evidencias` (SELECT/INSERT/UPDATE/DELETE) scopeadas
a `authenticated` + coincidencia de `(storage.foldername(name))[1]` con
`auth_org_id()`.

## Migraciones (orden cronológico)

1. `20260815_fase1_security_storage.sql` — RLS inicial + bucket + vista Fase 1.
2. `20260815_fix_rls_policies.sql` — fix idempotente de políticas Fase 1.
3. `20260816_fase2_vistas_qc.sql` — `vw_monitoreo_poligonos/puntos/web`.
4. `20260816_fase3_seguridad_rls.sql` — RLS consolidado (`auth_org_id()`).
5. `20260817_refine_vw_monitoreo_web.sql` — `parcela_codigo` + productor lateral join.
6. `20260818_fix_inspecciones_rls.sql` — políticas `anon` para Inspecciones/CAP_*.
7. `20260818_gis_core_sanitization.sql` — sanitización de geometría, cálculo
   de área, índices GiST.
8. `20260818_fix_views_eudr_flags.sql` — expone `area_calculada_ha`/
   `requiere_revision_area` en `vw_monitoreo_poligonos/puntos/web` (cierra
   el gap detectado tras la migración anterior).
9. `20260818_rls_multi_tenant_fortification.sql` —
   re-certificación idempotente de RLS Zero-Trust en `ORGANIZACIONES`/
   `EUDR_*` + fix de PII/tenant en `view_eudr_dashboard_aprobados`.
10. `20260818_inspecciones_atomic_save.sql` —
    `public.fn_guardar_inspeccion_completa`, guardado atómico de
    `INSPECCIONES` + 6 `CAP_*` (reemplaza 7 llamadas REST no atómicas).
11. `20260818_fix_dashboard_view_columns.sql` — agrega
    `geom_geojson` a `view_eudr_dashboard_aprobados` (fix del error real
    `column view_eudr_dashboard_aprobados.hectareas does not exist` en
    `app/page.jsx`, ver sección de esa vista arriba).
12. `20260818_padron_baja_logica.sql` — **este documento** — agrega
    `activo boolean default true` a `PADRON_SOCIOS`/`PADRON_PARCELAS` (baja
    lógica desde `/dashboard/socios`, nunca DELETE físico).

**No confirmadas aplicadas todavía** (escritas después de la verificación
de `docs/audits/verification_checklist_20260818.md`): la 11 y la 12.

**Las migraciones 1–10 SÍ se confirmaron aplicadas y funcionando en vivo**
contra `jhtocgxlozfuzullrtol` (ver
`docs/audits/verification_checklist_20260818.md` para la evidencia
completa de cada una — consultas REST reales, sin necesitar Service Role
Key). **Nota de orden de aplicación:** `20260818_gis_core_sanitization.sql`
debe aplicarse antes que `20260818_fix_views_eudr_flags.sql` (esta última
selecciona columnas que la primera crea). `20260818_inspecciones_atomic_save.sql`
depende de que `20260818_fix_inspecciones_rls.sql` ya esté aplicada (las
políticas RLS que permiten escritura `anon` en `INSPECCIONES`/`CAP_*` deben
existir antes, ya que la función nueva no usa `SECURITY DEFINER`).
