# Schema Live — Vertical Agrícola (Parcelas, EUDR, Inspecciones)

> **Split (2026-09-04):** ver [`docs/schema_live_core.md`](schema_live_core.md)
> para la nota de alcance completa, la instancia real y por qué no hay
> `npm run sync-schema`. Este archivo cubre `PADRON_PARCELAS`, las 3
> tablas `EUDR_*`, `INSPECCIONES`/`CAP_*`, las vistas espaciales y las
> migraciones — la parte más grande del schema original. Ver
> [`docs/schema_live_pecuario.md`](schema_live_pecuario.md) para la
> vertical pecuaria (sin tablas propias todavía).
>
> **Igual que `schema_live_core.md`: contenido movido tal cual del
> archivo original, sin reescribir — las notas fechadas conservan su
> fecha. Secciones de RLS acá abajo están desactualizadas en varios
> puntos respecto al estado real post-ADR-034/035** (ver
> `docs/adr/INDEX.md` para el ADR más reciente de cada tabla).

## Tablas base

### `public."PADRON_PARCELAS"`
Schema real completo confirmado en vivo el 2026-08-18: `ID_Parcela_Fija` (PK,
código manual ej. `COOP-JS-001`), `ID_Organizacion`, `ID_Socio`, `socio_dni`/
`socio_nombre_completo` (copias desnormalizadas del socio — más superficie de
PII a cuidar en cualquier vista/export que use esta tabla), `parcela_codigo`,
`parcela_nombre`, `hcp`/`hcc`/`ho`/`hip`/`hrp`/`hbp`/`otros_cultivo` (hectáreas
por categoría de uso, nomenclatura heredada de AppSheet — desde ADR-028
los labels de `hcp`/`hcc` en la UI ya no dicen "Café", ver abajo), `totalh`
(suma de las categorías), `geom` (**`NULL` en la mayoría de registros
reales confirmados** — no asumir que siempre hay geometría), `creado_en`,
`actualizado_en`, `creado_por`, `hr`.
- **RLS (desactualizado — ver `docs/schema_live_core.md`, sección
  `PADRON_SOCIOS`, para el mismo aviso): mismo patrón que `PADRON_SOCIOS`
  — desde ADR-034/036, `rls_select_padron_parcelas`/`rls_write_padron_parcelas`
  son las oficiales para `authenticated`, y `createParcela`/`updateParcela`/
  `deactivateParcela` (`lib/actions/sociosActions.js`) corren con sesión
  real, no Service Role Key.
- **Nuevo (2026-08-26, ADR-028):** `id_producto_predominante uuid NULL
  REFERENCES PRODUCTOS(id)` — dato maestro editable desde
  `ParcelaFormModal.jsx` (`/dashboard/socios`). Backfilleado a `CAFE` para
  todas las filas existentes al aplicar la migración; nuevas parcelas
  pueden quedar `NULL` si el usuario no selecciona producto.

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
- **RLS (desactualizado — ver ADR-034):** el texto original decía
  `rls_select_eudr_monitoreo`/`rls_write_eudr_monitoreo` scopeadas a
  `authenticated` + `ID_Organizacion` (Tarea 9.1) — sigue siendo el
  patrón vigente, pero ADR-034 (2026-09-03) eliminó 3 políticas huérfanas
  adicionales sobre esta misma tabla que existían en producción sin estar
  documentadas acá.
- Trigger `trg_auto_org_eudr_monitoreo` (BEFORE INSERT): auto-inyecta
  `ID_Organizacion` desde el JWT si viene nulo/vacío.
- **Nuevo (2026-08-18):** trigger `trg_gis_sanitize_eudr_monitoreo`
  (BEFORE INSERT OR UPDATE OF `geom_inspeccion`): sanitiza SRID/topología/
  precisión y calcula `area_calculada_ha`/`requiere_revision_area`.
- **Nuevo (2026-08-18):** índice GiST `idx_gist_eudr_monitoreo_geom` sobre
  `geom_inspeccion`; índice btree `idx_eudr_monitoreo_org` sobre
  `"ID_Organizacion"`.
- **Nuevo (2026-08-23):** `qfield_relation_id` — GUID crudo que QField
  genera para el registro padre de una subdivisión/instalación (ver
  ADR-010); índice `idx_eudr_monitoreo_qfield_relation_id`.
- **`UNIQUE("ID_Organizacion", "ID_Parcela_Fija", fecha_monitoreo)`
  (constraint `eudr_monitoreo_org_parcela_fecha_key`) — NO aparece en
  ninguna migración de este repo** (la tabla se creó fuera de él);
  confirmado empíricamente el 2026-08-26 disparando un `23505` real.
  Implicación operativa: 2 visitas de monitoreo de la misma parcela nunca
  pueden compartir `fecha_monitoreo` exacta.
- **Hallazgo abierto (2026-09-03/05, sin causa determinada):** esta tabla
  (y `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`) están completamente vacías
  hoy, para todas las organizaciones — no solo `ORG-TEST-DEMO`. Ver
  `AI_STATE.md` (`2026-09-03f`/`g`, `2026-09-05`) para el detalle.

### `public."EUDR_USO_SUELO"`
- `fid` (feature id nativo del GeoPackage), `id` (PK real de la tabla),
  `"ID_Organizacion"`, `id_parcela`, `tipo_uso`, `estado_revision`, `geom`.
- **Nuevo (2026-08-18):** `area_calculada_ha`, `requiere_revision_area`,
  trigger `trg_gis_sanitize_eudr_uso_suelo`, índices GiST/`ID_Organizacion`.
- **Nuevo (2026-08-26, ADR-028):** `id_producto_predominante uuid NULL
  REFERENCES PRODUCTOS(id)` — foto por evento, NO editable directamente;
  poblada por `trg_set_producto_predominante_uso_suelo` (`BEFORE INSERT`,
  nunca lanza excepción) que copia `PADRON_PARCELAS.id_producto_predominante`
  resolviendo `id_parcela` → `EUDR_MONITOREO.qfield_relation_id` → su
  `ID_Parcela_Fija`. Sin backfill de filas existentes.
- **RLS (desactualizado — ver ADR-034):** mismo aviso que `EUDR_MONITOREO`.

### `public."EUDR_INSTALACIONES"`
- `fid`, `id` (inferido por simetría, no confirmado explícitamente),
  `"ID_Organizacion"`, `id_parcela`, `tipo_infra`, `evidencia_foto`,
  `estado_revision`, `geom` (puntual en la práctica).
- **Nuevo (2026-08-18):** mismo patrón de columnas/trigger/índices que arriba.
- **RLS (desactualizado — ver ADR-034):** mismo aviso.

> **Nuevo path de escritura desde el frontend (2026-08-19, Ingestor de
> Capas Espaciales, `specs/gis_ingestor_web.md`):** hasta entonces estas 3
> tablas solo se escribían desde `scripts/etl_drive_to_supabase.py` y
> ediciones manuales en QGIS Desktop. `lib/actions/gisActions.js::uploadGeoSpatialFeature`
> agrega un tercer origen — **el modal real es `CargaEspacialModal.jsx`,
> invocado desde `/dashboard/qc` (Consola QC), no desde `/dashboard/mapa`
> como decía este párrafo originalmente** (confirmado por `grep` en el
> reconocimiento de Fase A.3 — corrección de premisa, 2026-09-04, ver
> `docs/adr/ADR-036-migracion-parcial-camino-1-sociosactions.md`).
> Escribe con la Service Role Key (bypasea RLS, **sin migrar a sesión
> real todavía — Fase A.3 del piloto Camino 1, ver el ADR-036 arriba,
> queda atada al mismo `resolveOrganizationId(records)` sobre registros
> ya cargados que bloqueó Task 16/ADR-035 antes de resolverse ahí**).
> Nunca calcula `area_calculada_ha` ni sanitiza la geometría por su
> cuenta — confía en el trigger `trg_gis_sanitize_eudr_*`. `estado_revision`
> siempre `'PENDIENTE'`.

### `public."INSPECCIONES"` + `public."CAP_DATOS_SOCIO"` / `"CAP_MIC"` /
`"CAP_CONSERVACION"` / `"CAP_BIENESTAR"` / `"CAP_RIESGOS"` / `"CAP_GESTION"`
(Fase 6 — módulo de inspecciones socioeconómicas)
- `INSPECCIONES."ID_Organizacion"` requerido (no nulo) por política RLS.
- Los 6 `CAP_*` no tienen `ID_Organizacion` propia (dependen de
  `ID_Inspeccion → INSPECCIONES`).
- **RLS (muy desactualizado — ver ADR-032/033):** el texto original decía
  `USING (true)` para las 6 `CAP_*` y que el frontend usa `anon` sin
  sesión. **Ya no es así desde ADR-033 (2026-09-03):** las 7 tablas
  tienen hoy `rls_anon_deny_*` (deniega TODO a `anon`) +
  `rls_write_*_authenticated` (`"ID_Organizacion" = auth_org_id()`) —
  aislamiento real por organización, verificado en vivo. `anon` recibe
  `401`/`42501` al intentar cualquier operación. Las 8 políticas
  huérfanas en español que existían antes de esto (creadas fuera del
  repo) se limpiaron en ADR-032.
- `ID_Inspeccion`/`id_monitoreo` son **`text`**, no `uuid` — fix en
  `20260903045407_fix_tipo_id_inspeccion.sql` (ADR relacionado con
  Task 16), ya aplicado.

> **Guardado atómico (2026-08-18, `20260818_inspecciones_atomic_save.sql`,
> tipos corregidos 2026-09-03):** `lib/inspeccionesActions.js::saveInspeccion()`
> llama a `public.fn_guardar_inspeccion_completa` (ver "Funciones" abajo),
> que envuelve `INSPECCIONES` + las 6 `CAP_*` en una sola transacción.
> `SECURITY INVOKER` — NO valida `p_organizacion` contra la sesión por su
> cuenta (confirmado línea por línea, Task 16); la autoridad real es el
> RLS de ADR-033. `organizationId` en el cliente se resuelve hoy vía
> `supabase.rpc('auth_org_id')` (Task 16, ya no del patrón viejo
> "adivinar de filas ya cargadas").

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

> **Nuevo (2026-08-26, ADR-028):** `vw_monitoreo_poligonos` (solo esta)
> gana `id_producto_predominante` al final de cada rama del `UNION ALL`.

### `public.vw_monitoreo_web`

> **Nuevo (2026-08-26, ADR-028):** rama "poligono" gana
> `id_producto_predominante` más `producto_codigo`/`producto_nombre`
> resueltos con `LEFT JOIN` a `PRODUCTOS`. Rama "punto": las 3 columnas
> `NULL`.

Consumida por `components/gis/MapDashboard.jsx` **y** por
`app/trace/[lot_hash]/page.jsx` (Portal Público de Trazabilidad). El portal
público consulta esta vista **sin filtrar por `ID_Organizacion`** porque la
URL pública no lleva organización — el fetch ocurre enteramente en un
Server Component, así que el resultado multi-organización nunca llega al
navegador: solo el payload ya sanitizado (`lib/traceabilityHash.js::buildPublicSanitizedPayload`)
de la única organización cuyo `lot_hash` recalculado coincide se serializa.

> **Riesgo latente documentado (no explotable hoy):** el hash público
> (`lib/traceabilityHash.js::generateLotHash()`) difiere de
> `scripts/generate_lot_qr.py::generate_lot_hash()` (Python) en el campo
> usado por Feature y en el set de campos PII filtrados. Nunca se ejecutan
> hoy contra el mismo payload real, así que no hay inconsistencia
> observable en producción.

> **Exportador de Paquete de Trazabilidad EUDR (auditado 2026-08-18,
> corregido ADR-017):** el botón real de descarga
> (`downloadTraceabilityPackage`, `lib/eudrDdsExporter.js`) vive en
> `/dashboard/mapa` (`MapDashboard.jsx::handleExportDDS`), **no** en
> `/dashboard/lotes` (solo simulación del QR, "no persiste nada"). Desde
> ADR-017, el GeoJSON descargado ya NO es el mismo objeto que el JSON
> completo — proyección aparte al esquema oficial UE. **Dossier Comercial
> PDF:** cerrado (Opción 1, nativo JS) — `GET /api/trace/[lot_hash]/pdf`,
> `lib/pdf/renderDossierPdf.js` (`@react-pdf/renderer`), deliberadamente
> sin nada del módulo de Inspecciones FED.

Filtra estrictamente `estado_revision = 'APROBADO'`. `LEFT JOIN` a
`PADRON_PARCELAS` (`parcela_codigo`, `parcela_nombre`, `area_ha`) +
`LEFT JOIN LATERAL` a `EUDR_MONITOREO` para resolver `productor`. Expone
`geom_geojson` (`ST_AsGeoJSON(geom)::json`).

> **`productor_nombre` (2026-08-19):** `LEFT JOIN` a `PADRON_SOCIOS` —
> **esta vista sigue sin filtrar por `ID_Organizacion`** (el cierre del
> riesgo cross-tenant para el nombre se hizo del lado del cliente,
> `MapDashboard.jsx`, no en la vista). Cascada final con default literal:
> `COALESCE(ps.socio_nombre_completo, ps_parcela.socio_nombre_completo,
> src.productor, mon.productor, 'Socio no asignado')` — nunca `NULL`.

> **Gap de integración cerrado (2026-08-18):** las 3 vistas exponen
> `area_calculada_ha`/`requiere_revision_area` en cada rama de su
> `UNION ALL`.

### `public.view_eudr_dashboard_aprobados`
Vista original de Fase 1 (schema más viejo, columnas `parcela_codigo`/
`hectareas_totales` vía joins directos) — sigue viva y en uso por
`app/page.jsx`, línea de trabajo distinta de `vw_monitoreo_web`.

> **Fix de seguridad (2026-08-18):** exponía PII (`socio_nombre_completo`/
> `socio_dni`) sin filtro por `ID_Organizacion` — corregido, removidas las
> 2 columnas PII y agregado `WHERE ... AND "ID_Organizacion" = public.auth_org_id()`.

> **Fix de columnas rotas + `geom_geojson` (2026-08-18):** `hectareas`/
> `riesgo_satelital`/`lot_hash` no existían — corregido a
> `hectareas_totales`, `riesgo_satelital` removido del todo,
> `geom_geojson` agregado.

## Tablas nuevas fuera del núcleo EUDR/Padrón

- **`public.qc_validation_audit_log`** (2026-08-20): auditoría de
  `fn_validar_topologia_eudr` — `tabla_origen`, `registro_id`,
  `"ID_Organizacion"`, `resultado jsonb`, `created_at`. RLS habilitada sin
  políticas (solo Service Role Key la toca).
- **`public."EUDR_COBERTURA_BOSCOSA_2020"`** (2026-08-20): dataset de
  referencia compartido (sin `ID_Organizacion`) de eventos de pérdida de
  cobertura forestal — `id`, `geom geometry(MultiPolygon,4326)`,
  `anio_perdida integer` (Hansen GFW), `fuente text`, `dataset_version
  text`, `created_at`. RLS: `SELECT` para `authenticated`. **Sigue
  vacía** — cargar un dataset real es tarea de ingesta aparte.
- **`public.audit_logs`** (2026-08-20): traza inmutable de decisiones
  Aprobar/Rechazar de la Consola QC — `"ID_Organizacion" text`, `accion
  text CHECK IN ('APROBADO','RECHAZADO')`, `tabla_origen text CHECK IN
  ('EUDR_MONITOREO','EUDR_USO_SUELO','EUDR_INSTALACIONES')`, `entidad_id
  text`, `detalles jsonb`, `created_at`. Trigger `BEFORE UPDATE OR
  DELETE` rechaza cualquier modificación/borrado. Escritura best-effort,
  no atómica con el `UPDATE` de `estado_revision`.
- **`public."PRODUCTOS"`** (2026-08-26, ADR-028): catálogo global — `id
  uuid PK`, `codigo text UNIQUE`, `nombre text`, `vertical text CHECK IN
  ('AGRICOLA','PECUARIO')` (**el único uso real hoy es `AGRICOLA`** —
  `CAFE`/`CACAO`, ver `docs/schema_live_pecuario.md`), `activo boolean`,
  `creado_en timestamptz`. RLS: `SELECT` abierto para `anon`.
- **`public."ORGANIZACION_PRODUCTOS"`** (2026-08-26, ADR-028): membresía
  N-a-N organización↔producto — `id uuid PK`, `id_organizacion text NOT
  NULL REFERENCES ORGANIZACIONES("ID")`, `id_producto uuid NOT NULL
  REFERENCES PRODUCTOS(id)`, `activo boolean`, `creado_en timestamptz`,
  `UNIQUE(id_organizacion, id_producto)`. RLS: `SELECT` para `anon` con
  `USING (id_organizacion IS NOT NULL)`.

## Índices espaciales

Antes de `20260818_gis_core_sanitization.sql` **no existía ningún índice
GiST** sobre columnas de geometría. Esa migración agrega:
- `idx_gist_eudr_monitoreo_geom` (GiST, `EUDR_MONITOREO.geom_inspeccion`)
- `idx_gist_eudr_uso_suelo_geom` (GiST, `EUDR_USO_SUELO.geom`)
- `idx_gist_eudr_instalaciones_geom` (GiST, `EUDR_INSTALACIONES.geom`)
- `idx_eudr_monitoreo_org` / `idx_eudr_uso_suelo_org` / `idx_eudr_instalaciones_org`
  (btree sobre `"ID_Organizacion"`)

## RLS — estado real (muy desactualizado, ver `docs/adr/INDEX.md` primero)

**Esta sección completa quedó desactualizada por ADR-031/032/033/034 —
leerla solo como contexto histórico de por qué el proyecto llegó a donde
está, no como estado real actual.** El frontend históricamente usaba
solo la anon key sin sesión de Supabase Auth — eso cambió con Fase B
(login real, `/login`, `middleware.js` exige sesión válida en
`/dashboard/**` desde 2026-09-03).

> **Corrección (2026-09-01, ADR-031):** el párrafo original decía "un
> `SELECT` directo a `PADRON_PARCELAS` con la anon key devuelve 0 filas"
> — falso desde 2026-08-18: la condición real era efectivamente sin
> restricción, exponiendo el padrón completo de todas las organizaciones
> sin sesión. Cerrado con `USING (false)` + funciones `SECURITY DEFINER`.

### Auditoría RLS Multi-Tenant (2026-08-18)

| Tabla | Motivo (histórico — ver ADR-032/033 para el estado real) |
|---|---|
| `INSPECCIONES` | Ya resuelto — ver ADR-033. |
| `CAP_DATOS_SOCIO`, `CAP_MIC`, `CAP_CONSERVACION`, `CAP_BIENESTAR`, `CAP_RIESGOS`, `CAP_GESTION` | Ya resuelto — ver ADR-033. |
| ~~`PADRON_SOCIOS` / `PADRON_PARCELAS`~~ | **CERRADO (ADR-031/034/036)** — ver `docs/schema_live_core.md`. |

**Hallazgo y fix no solicitado (2026-08-18):** `view_eudr_dashboard_aprobados`
exponía PII sin filtro de tenant — ver esa vista arriba.

## Storage

Bucket `evidencias_eudr` (privado). Ruta: `{ID_Organizacion}/{filename}`.
Políticas `rls_storage_*_evidencias` (SELECT/INSERT/UPDATE/DELETE) scopeadas
a `authenticated` + coincidencia de `(storage.foldername(name))[1]` con
`auth_org_id()`.

## Funciones (EUDR, geometría, Inspecciones, parcelas)

| Función | Retorno | Uso |
|---|---|---|
| `public.fn_sanitize_geometry(geometry)` | `geometry` | SRID 4326 + `ST_MakeValid` + `ST_SnapToGrid` a 6 decimales. `STABLE`, `SECURITY INVOKER`, `EXECUTE` para `anon`+`authenticated`. Usada tanto por los triggers `EUDR_*` como por `sociosActions.js::sanitizeGeometryForStorage` (`PADRON_PARCELAS.geom`). |
| `public.fn_calcular_area_ha(geometry)` | `numeric` | Área geodésica en hectáreas; `NULL` para geometrías no poligonales. |
| `public.trg_sanitize_geom_monitoreo/uso_suelo/instalaciones()` | `trigger` | Aplican las 2 funciones de arriba a la columna de geometría de su tabla y setean `area_calculada_ha`/`requiere_revision_area`. |
| `public.fn_guardar_inspeccion_completa(...)` | `jsonb` (`{id, created}`) | Guardado atómico de `INSPECCIONES` + 6 `CAP_*`. `SECURITY INVOKER` — no valida `p_organizacion` contra la sesión (Task 16, confirmado línea por línea); la autoridad real es el RLS de ADR-033. `ID_Inspeccion`/`p_id` son `text` (fix 2026-09-03). |
| `public.fn_validar_topologia_eudr(p_tabla_origen text, p_registro_id text)` | `jsonb` | Validación topológica bajo demanda para un registro `EUDR_MONITOREO`/`EUDR_USO_SUELO` — rechaza `EUDR_INSTALACIONES`. Sin `SECURITY DEFINER`; llamada desde `/api/qc/validate-spatial` con Service Role Key. |
| `public.fn_parcelas_vecinas_eudr(...)` | `TABLE(id, geom, codigo_socio, total_encontrados, total_devueltos)` | Capa de contexto de parcelas vecinas (Consola QC). Sin `SECURITY DEFINER`; llamada desde `lib/actions/qcActions.js::fetchParcelasVecinas` con Service Role Key. |
| `public.fn_set_producto_predominante_uso_suelo()` | `trigger` | `BEFORE INSERT` sobre `EUDR_USO_SUELO` — resuelve `id_parcela` → `qfield_relation_id` → `ID_Parcela_Fija` → `PADRON_PARCELAS.id_producto_predominante`. Nunca lanza excepción. |
| `public.fn_listar_padron_parcelas_por_socio(p_organizacion text, p_socio_id text)` | `TABLE(...)` | `SECURITY DEFINER`. Reemplaza `lib/sociosSearch.js::fetchParcelasBySocio`. |
| `public.fn_buscar_padron_parcelas(...)` | `TABLE(ID_Parcela_Fija, ID_Organizacion, ID_Socio, parcela_codigo, parcela_nombre, totalh)` | `SECURITY DEFINER`. Reemplaza `lib/padronSearch.js::searchParcelas`. |
| `public.fn_padron_parcelas_existentes(...)` | `TABLE(ID_Parcela_Fija, parcela_codigo)` | `SECURITY DEFINER`. Duplicados en preview de importación masiva. |
| `public.fn_padron_parcelas_codigos_e_ids(p_organizacion text)` | `TABLE(parcela_codigo, ID_Parcela_Fija)` | `SECURITY DEFINER`. Códigos/IDs ya usados, para la plantilla de Parcelas. |
| `public.fn_enriquecer_parcela_qc(p_organizacion text, p_ids text[])` | `TABLE(ID_Parcela_Fija, parcela_codigo, parcela_nombre)` | `SECURITY DEFINER`. Reemplaza `lib/eudrQcActions.js::enrichWithParcelaInfo` — la versión anterior no filtraba por organización en absoluto. |
| `public.fn_exportar_padron_parcelas(p_organizacion text)` | `TABLE(...)` | `SECURITY DEFINER`, sin filtro (exporta todo). Reemplaza `lib/padronCsv.js::exportParcelasCsv` directo con `anon`. |

## Migraciones (orden cronológico, primeras 12 — ver `supabase/migrations/` para el resto)

1. `20260815_fase1_security_storage.sql` — RLS inicial + bucket + vista Fase 1.
2. `20260815_fix_rls_policies.sql` — fix idempotente de políticas Fase 1.
3. `20260816_fase2_vistas_qc.sql` — `vw_monitoreo_poligonos/puntos/web`.
4. `20260816_fase3_seguridad_rls.sql` — RLS consolidado (`auth_org_id()`).
5. `20260817_refine_vw_monitoreo_web.sql` — `parcela_codigo` + productor lateral join.
6. `20260818_fix_inspecciones_rls.sql` — políticas `anon` para Inspecciones/CAP_* (superadas por ADR-032/033).
7. `20260818_gis_core_sanitization.sql` — sanitización de geometría, cálculo
   de área, índices GiST.
8. `20260818_fix_views_eudr_flags.sql` — expone `area_calculada_ha`/
   `requiere_revision_area` en las 3 vistas.
9. `20260818_rls_multi_tenant_fortification.sql` —
   re-certificación idempotente de RLS Zero-Trust + fix de PII/tenant en
   `view_eudr_dashboard_aprobados`.
10. `20260818_inspecciones_atomic_save.sql` —
    `public.fn_guardar_inspeccion_completa`.
11. `20260818_fix_dashboard_view_columns.sql` — agrega `geom_geojson` a
    `view_eudr_dashboard_aprobados`.
12. `20260818_padron_baja_logica.sql` — agrega `activo boolean default
    true` a `PADRON_SOCIOS`/`PADRON_PARCELAS`.

Para el historial completo posterior (2026-08-19 en adelante — más de 40
migraciones), leer `supabase/migrations/*.sql` en orden por nombre de
archivo (prefijo `YYYYMMDD[HHMMSS]_`), o `docs/adr/INDEX.md` para el ADR
asociado a cada cambio relevante.
