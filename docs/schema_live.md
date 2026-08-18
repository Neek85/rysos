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
- `"ID_Organizacion"`, `"ID_Socio"`, `socio_nombre_completo`, `socio_dni`,
  `localidad`, `certificaciones`.
- RLS: lectura/escritura para `authenticated` scopeado a `ID_Organizacion`
  (Tarea 9.1) + lectura adicional para `anon` (fix Inspecciones, 2026-08-18).

### `public."PADRON_PARCELAS"`
- `"ID_Organizacion"`, `"ID_Parcela_Fija"`, `parcela_codigo`, `parcela_nombre`,
  `totalh` (hectáreas totales de la parcela, expuesto como `area_ha` en las
  vistas), `geom`.
- RLS: igual patrón que `PADRON_SOCIOS`.

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

### `public."INSPECCIONES"` + `public."CAP_DATOS_SOCIO"` / `"CAP_MIC"` /
`"CAP_CONSERVACION"` / `"CAP_BIENESTAR"` / `"CAP_RIESGOS"` / `"CAP_GESTION"`
(Fase 6 — módulo de inspecciones socioeconómicas)
- `INSPECCIONES."ID_Organizacion"` requerido (no nulo) por política RLS.
- Los 6 `CAP_*` no tienen `ID_Organizacion` propia (dependen de
  `ID_Inspeccion → INSPECCIONES`); RLS abierta (`USING (true)`) — ver
  `supabase/migrations/20260818_fix_inspecciones_rls.sql` para el razonamiento
  completo (el frontend usa `anon` key sin sesión real, no hay Supabase Auth
  implementado en el proyecto).

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
Consumida por `components/gis/MapDashboard.jsx`. Filtra estrictamente
`estado_revision = 'APROBADO'`. `LEFT JOIN` a `PADRON_PARCELAS` (
`parcela_codigo`, `parcela_nombre`, `area_ha`) + `LEFT JOIN LATERAL` a
`EUDR_MONITOREO` para resolver `productor` en filas de
`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` (que no tienen productor propio, usa la
visita de monitoreo más reciente sobre la misma parcela). Expone
`geom_geojson` (`ST_AsGeoJSON(geom)::json`) porque PostgREST serializa
`geometry` cruda como WKB hex, no como GeoJSON.

> **Gap de integración conocido (auditado 2026-08-18, ver ADR-001):**
> `vw_monitoreo_poligonos`, `vw_monitoreo_puntos` y `vw_monitoreo_web`
> seleccionan columnas explícitas y **ninguna expone `area_calculada_ha` ni
> `requiere_revision_area`** (agregadas por `20260818_gis_core_sanitization.sql`).
> El Dashboard Web y QGIS Desktop no pueden ver el flag de revisión de área
> hoy — solo es consultable directo contra las tablas base. La geometría en
> sí *sí* está bien integrada (el trigger sanitiza en escritura, la vista lee
> el dato ya limpio). Exponer las dos columnas nuevas en las vistas requiere
> una migración de vistas nueva, no incluida en esta tarea.

### `public.view_eudr_dashboard_aprobados`
Vista original de Fase 1 (schema más viejo, columnas `parcela_codigo`/
`hectareas_totales`/`socio_nombre_completo`/`socio_dni` vía joins directos a
`PADRON_PARCELAS`/`PADRON_SOCIOS`) — sigue viva y en uso por `app/page.jsx`,
línea de trabajo distinta de `vw_monitoreo_web`. No confundir una con otra.

## Funciones

| Función | Retorno | Uso |
|---|---|---|
| `public.auth_org_id()` | `text` | Extrae `ID_Organizacion` del claim JWT (`request.jwt.claims`). Autoritativa desde Tarea 9.1. |
| `public.get_my_org_id()` | `text` | Alias delgado sobre `auth_org_id()` — preservado por compatibilidad con `trg_set_id_organizacion()`. |
| `public.trg_set_id_organizacion()` | `trigger` | Auto-inyecta `ID_Organizacion` en INSERT si viene nulo/vacío. |
| `public.fn_sanitize_geometry(geometry)` | `geometry` | **Nuevo (2026-08-18).** SRID 4326 + `ST_MakeValid` + `ST_SnapToGrid` a 6 decimales. |
| `public.fn_calcular_area_ha(geometry)` | `numeric` | **Nuevo (2026-08-18).** Área geodésica en hectáreas; `NULL` para geometrías no poligonales. |
| `public.trg_sanitize_geom_monitoreo/uso_suelo/instalaciones()` | `trigger` | **Nuevo (2026-08-18).** Aplican las dos funciones de arriba a la columna de geometría de su tabla y setean `area_calculada_ha`/`requiere_revision_area`. |

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
7. `20260818_gis_core_sanitization.sql` — **este documento** — sanitización de
   geometría, cálculo de área, índices GiST.

Ninguna de estas migraciones se ha confirmado aplicada contra la instancia
`jhtocgxlozfuzullrtol` desde este entorno de desarrollo — requieren ejecución
manual en Supabase Studio.
