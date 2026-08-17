-- MIGRACIÓN IDEMPOTENTE: Vistas de auditoría espacial QC (Tarea 8.1)
-- Consolida EUDR_MONITOREO, EUDR_USO_SUELO y EUDR_INSTALACIONES en tres vistas
-- de solo lectura para el revisor QC y el Dashboard Web:
--   - vw_monitoreo_poligonos: geometrías poligonales (EUDR_MONITOREO + EUDR_USO_SUELO)
--   - vw_monitoreo_puntos:    geometrías puntuales (EUDR_MONITOREO + EUDR_INSTALACIONES)
--   - vw_monitoreo_web:       union filtrada a estado_revision = 'APROBADO'
--
-- INVARIANTE: EUDR_MONITOREO.geom_inspeccion es una columna geometry generica (no
-- restringida a un solo tipo OGC); un mismo formulario QField puede producir un
-- Point (pin GPS) o un Polygon (recorrido del perimetro), segun como el tecnico
-- capturo la evidencia. Por eso ambas vistas enrutan filas de EUDR_MONITOREO por
-- ST_Dimension() (2 = poligonal, 0 = puntual) en vez de asumir un tipo fijo o una
-- tabla fija. ST_Dimension tambien enruta correctamente una GeometryCollection
-- mixta segun su componente de mayor dimension.
--
-- INVARIANTE QGIS/PostgREST: toda columna de geometria se castea explicitamente a
-- geometry(MultiPolygon,4326) / geometry(Point,4326) en TODAS las ramas del UNION
-- ALL de cada vista (no solo una), porque Postgres solo declara un typmod estable
-- en information_schema/geometry_columns cuando todas las ramas coinciden
-- exactamente en tipo y SRID. Sin esto, QGIS Desktop no puede determinar tipo de
-- geometria + SRID desde el catalogo y muestra el dialogo de "reparar capa" al
-- cargar la vista. ST_CollectionExtract(...) + ST_Multi(...) normalizan cualquier
-- GeometryCollection/Polygon suelto a MultiPolygon antes del cast final, para que
-- el cast nunca falle en tiempo de consulta.
--
-- NOTA DE SCHEMA: EUDR_USO_SUELO y EUDR_INSTALACIONES no tienen una PK de negocio
-- expuesta al ETL (ver scripts/etl_drive_to_supabase.py); se usa su columna `fid`
-- (feature id nativo del GeoPackage de origen) como identificador de fila legible
-- en estas vistas, igual que en el upsert idempotente del ETL. vw_monitoreo_poligonos
-- ademas expone `id_monitoreo` explicito (ademas de `registro_id`) por
-- compatibilidad con proyectos QGIS antiguos que apuntaban directo a
-- EUDR_MONITOREO y guardaron esa columna como campo de clave primaria de la capa;
-- para filas de EUDR_USO_SUELO (que no tienen id_monitoreo real) queda NULL.

BEGIN;

DROP VIEW IF EXISTS public.vw_monitoreo_web;
DROP VIEW IF EXISTS public.vw_monitoreo_poligonos;
DROP VIEW IF EXISTS public.vw_monitoreo_puntos;

-- ============================================================
-- 1. vw_monitoreo_poligonos
-- ============================================================
CREATE VIEW public.vw_monitoreo_poligonos AS
SELECT
    'EUDR_MONITOREO'          AS tabla_origen,
    m.id_monitoreo::text      AS registro_id,
    m.id_monitoreo::text      AS id_monitoreo,
    m."ID_Organizacion",
    m."ID_Parcela_Fija",
    COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor,
    NULL::text                AS tipo_uso,
    m.evidencia_foto,
    m.estado_revision,
    m.fecha_monitoreo,
    m.observaciones,
    ST_Multi(ST_CollectionExtract(ST_Transform(m.geom_inspeccion, 4326), 3))
        ::geometry(MultiPolygon, 4326) AS geom
FROM public."EUDR_MONITOREO" m
WHERE ST_Dimension(m.geom_inspeccion) = 2

UNION ALL

SELECT
    'EUDR_USO_SUELO'          AS tabla_origen,
    u.fid::text               AS registro_id,
    NULL::text                AS id_monitoreo,
    u."ID_Organizacion",
    u.id_parcela              AS "ID_Parcela_Fija",
    NULL::text                AS productor,
    u.tipo_uso,
    NULL::text                AS evidencia_foto,
    u.estado_revision,
    NULL::date                AS fecha_monitoreo,
    NULL::text                AS observaciones,
    ST_Multi(ST_CollectionExtract(ST_Transform(u.geom, 4326), 3))
        ::geometry(MultiPolygon, 4326) AS geom
FROM public."EUDR_USO_SUELO" u
WHERE ST_Dimension(u.geom) = 2;

GRANT SELECT ON public.vw_monitoreo_poligonos TO authenticated;

-- ============================================================
-- 2. vw_monitoreo_puntos
-- ============================================================
CREATE VIEW public.vw_monitoreo_puntos AS
SELECT
    'EUDR_MONITOREO'          AS tabla_origen,
    m.id_monitoreo::text      AS registro_id,
    m."ID_Organizacion",
    m."ID_Parcela_Fija",
    COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor,
    NULL::text                AS tipo_infra,
    m.evidencia_foto,
    m.estado_revision,
    m.fecha_monitoreo,
    m.observaciones,
    ST_Transform(m.geom_inspeccion, 4326)::geometry(Point, 4326) AS geom
FROM public."EUDR_MONITOREO" m
WHERE ST_Dimension(m.geom_inspeccion) = 0

UNION ALL

SELECT
    'EUDR_INSTALACIONES'      AS tabla_origen,
    i.fid::text               AS registro_id,
    i."ID_Organizacion",
    i.id_parcela              AS "ID_Parcela_Fija",
    NULL::text                AS productor,
    i.tipo_infra,
    i.evidencia_foto,
    i.estado_revision,
    NULL::date                AS fecha_monitoreo,
    NULL::text                AS observaciones,
    ST_Transform(i.geom, 4326)::geometry(Point, 4326) AS geom
FROM public."EUDR_INSTALACIONES" i
WHERE ST_Dimension(i.geom) = 0;

GRANT SELECT ON public.vw_monitoreo_puntos TO authenticated;

-- ============================================================
-- 3. vw_monitoreo_web
-- INVARIANTE: unico punto de lectura del Dashboard Web — nunca debe exponer
-- registros PENDIENTE ni RECHAZADO. Aplana tipo_uso/tipo_infra en una sola
-- columna "clasificacion" para que el consumidor no tenga que distinguir
-- entre poligonos y puntos. Consolida (UNION ALL) exclusivamente los registros
-- ya APROBADOS de vw_monitoreo_poligonos y vw_monitoreo_puntos.
-- ============================================================
CREATE VIEW public.vw_monitoreo_web AS
SELECT
    'poligono'      AS tipo_geometria,
    tabla_origen,
    registro_id,
    "ID_Organizacion",
    "ID_Parcela_Fija",
    productor,
    tipo_uso        AS clasificacion,
    evidencia_foto,
    estado_revision,
    fecha_monitoreo,
    observaciones,
    geom
FROM public.vw_monitoreo_poligonos
WHERE estado_revision = 'APROBADO'

UNION ALL

SELECT
    'punto'         AS tipo_geometria,
    tabla_origen,
    registro_id,
    "ID_Organizacion",
    "ID_Parcela_Fija",
    productor,
    tipo_infra      AS clasificacion,
    evidencia_foto,
    estado_revision,
    fecha_monitoreo,
    observaciones,
    geom
FROM public.vw_monitoreo_puntos
WHERE estado_revision = 'APROBADO';

GRANT SELECT ON public.vw_monitoreo_web TO authenticated;

COMMIT;
