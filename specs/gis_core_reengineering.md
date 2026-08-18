# Spec — Reingeniería y Blindaje del Modelo Espacial GIS Core

## Contexto

`EUDR_MONITOREO`, `EUDR_USO_SUELO` y `EUDR_INSTALACIONES` reciben geometrías desde
QField (vía `scripts/etl_drive_to_supabase.py`) y desde ediciones manuales en QGIS
Desktop (vía `vw_monitoreo_poligonos`/`vw_monitoreo_puntos`, Tarea 8.1). Ninguna de
las dos vías garantiza hoy que la geometría almacenada sea válida topológicamente,
esté en EPSG:4326, o tenga una precisión de coordenadas acotada. Tampoco existe
ningún índice GiST sobre las columnas de geometría en el historial de migraciones
(`supabase/migrations/*.sql`) — confirmado por búsqueda exhaustiva antes de esta
tarea — lo que implica que cualquier filtro espacial (`ST_Intersects`, `ST_Within`,
bounding-box del mapa en `MapDashboard.jsx`) hace table scan completo.

## Objetivo

Sanitizar y blindar el núcleo espacial sin romper la ingesta real de parcelas
pequeñas de productores cafetaleros (caso de uso central de RYZOS).

## Decisiones de diseño (confirmadas con el usuario)

1. **Validación de área ≥ 4.0 ha es informativa, no bloqueante.** Un polígono con
   área calculada menor a 4.0 ha se marca (`requiere_revision_area = true`) pero
   el INSERT/UPDATE se completa normalmente. Un trigger que rechazara geometrías
   pequeñas rompería la ingesta de fincas reales — RYZOS sirve a pequeños
   productores, y EUDR no define un mínimo de 4 ha para registrar una parcela.
2. **La sanitización de geometría (SRID, validez topológica, precisión) sí es
   incondicional** — se aplica siempre, sin excepción, porque nunca es correcto
   almacenar una geometría inválida o en un SRID distinto al de las vistas.
3. Las geometrías puntuales (`ST_Dimension = 0`, ej. `EUDR_INSTALACIONES`, pines
   GPS de `EUDR_MONITOREO`) no tienen área — `area_calculada_ha` y
   `requiere_revision_area` quedan en `NULL` para esas filas, no en `false`.
4. `docs/schema_live.md` se documenta como snapshot manual (no hay script
   `npm run sync-schema` en este repo — no existía antes de esta tarea y no se
   inventa uno nuevo fuera de alcance).
5. La migración se entrega como archivo versionado para aplicar manualmente en
   el SQL Editor de la instancia Supabase (`jhtocgxlozfuzullrtol`), siguiendo el
   mismo patrón que todas las migraciones previas del proyecto — este entorno no
   tiene credenciales ni conexión viva a Postgres.

## Alcance funcional

### 1. Función `public.fn_sanitize_geometry(geometry) RETURNS geometry`

- `NULL` en, `NULL` afuera (no fuerza geometría en filas sin geometría).
- Si `ST_SRID = 0` (sin SRID declarado): asigna 4326 (`ST_SetSRID`), asumiendo
  que el dato ya viene en grados decimales sin metadato de SRID (caso típico de
  GeoPackage QField mal configurado).
- Si `ST_SRID` es distinto de 4326 y distinto de 0: reproyecta con `ST_Transform`.
- Si la geometría no es válida (`ST_IsValid = false`): repara con `ST_MakeValid`
  (resuelve auto-intersecciones, anillos duplicados, etc. — reparación
  topológica pedida en la tarea).
- Redondea coordenadas a 6 decimales (`ST_SnapToGrid(geom, 0.000001)`, ~11 cm de
  precisión en el ecuador — suficiente para GPS de mano, evita basura de
  precisión de punto flotante de más de 6 decimales).

### 2. Función `public.fn_calcular_area_ha(geometry) RETURNS numeric`

- Devuelve `NULL` si la geometría es `NULL` o no es de dimensión 2 (no aplica a
  puntos).
- Para polígonos, calcula área geodésica real (`ST_Area(geom::geography) / 10000`,
  no área plana en grados) redondeada a 4 decimales.

### 3. Triggers `BEFORE INSERT OR UPDATE OF <col_geom>` en las 3 tablas

Por cada tabla (`EUDR_MONITOREO.geom_inspeccion`, `EUDR_USO_SUELO.geom`,
`EUDR_INSTALACIONES.geom`):
- Reemplaza `NEW.<col_geom>` por `fn_sanitize_geometry(NEW.<col_geom>)`.
- Calcula `NEW.area_calculada_ha := fn_calcular_area_ha(...)`.
- Setea `NEW.requiere_revision_area := area_calculada_ha < 4.0` (o `NULL` si el
  área es `NULL`).

Requiere `ALTER TABLE ... ADD COLUMN IF NOT EXISTS area_calculada_ha numeric` y
`requiere_revision_area boolean` en las 3 tablas — columnas nuevas, no rompen
`SELECT *` existentes ni el ETL (que hace INSERT con columnas nombradas
explícitas, ver `scripts/etl_drive_to_supabase.py`).

### 4. Índices GiST + índice por organización

`CREATE INDEX IF NOT EXISTS ... USING GIST (<col_geom>)` en las 3 tablas, más un
índice btree sobre `"ID_Organizacion"` en las 3 tablas (soporta el filtro
multi-tenant de RLS y de las vistas `vw_monitoreo_*`). Ninguno existía antes de
esta migración.

## Fuera de alcance

- No se modifican `vw_monitoreo_web`, `vw_monitoreo_poligonos`, `vw_monitoreo_puntos`
  — ya filtran correctamente por `estado_revision`/RLS; el hallazgo real de esta
  auditoría fue la ausencia de índice GiST, no un problema en las vistas mismas.
- No se agrega ningún rechazo duro (`RAISE EXCEPTION`) por área — ver decisión 1.
- No se crea `CLAUDE.md` ni `npm run sync-schema` — no existían y no son parte
  del alcance real confirmado con el usuario.

## Criterios de aceptación

- AC1: `fn_sanitize_geometry(geom)` con SRID 0 devuelve geometría en SRID 4326.
- AC2: `fn_sanitize_geometry(geom)` con una geometría autointersectada devuelve
  `ST_IsValid = true`.
- AC3: Insertar un polígono de ~1 ha en `EUDR_USO_SUELO` no lanza excepción y
  deja `requiere_revision_area = true`.
- AC4: Insertar un punto en `EUDR_INSTALACIONES` deja `area_calculada_ha IS NULL`
  y `requiere_revision_area IS NULL`.
- AC5: Existe un índice GiST sobre cada una de las 3 columnas de geometría
  (verificable vía `pg_indexes`).
- AC6: La migración es idempotente (re-ejecutable sin error contra un estado ya
  migrado) — `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` en todo el archivo.
