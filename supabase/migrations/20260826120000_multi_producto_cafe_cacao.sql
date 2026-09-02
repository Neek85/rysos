-- Implementa el paso 4 de multi-producto (café/cacao): PRODUCTOS,
-- ORGANIZACION_PRODUCTOS, id_producto_predominante en PADRON_PARCELAS
-- (dato maestro, con backfill) y EUDR_USO_SUELO (foto por evento, vía
-- trigger no bloqueante), y la extensión de vw_monitoreo_poligonos/
-- vw_monitoreo_web para exponerlo hasta el exportador DDS.
--
-- Ver docs/adr/ADR-028-multi-producto-cafe-cacao.md,
-- specs/multi_producto_cafe_cacao.md (contrato de datos cerrado en la
-- sección 8) para el diseño completo y la evidencia detrás de cada
-- decisión.
--
-- Puramente ADITIVA salvo el backfill de PADRON_PARCELAS.id_producto_predominante
-- (sección 8.3 de la spec, decisión confirmada explícitamente por el
-- usuario en la ronda 4 -- no estaba cerrada antes). No toca ninguna otra
-- columna existente, ni el JOIN ya roto de vw_monitoreo_web contra
-- PADRON_PARCELAS (sección 8.5 de la spec -- ese bug preexistente queda
-- fuera de alcance).

BEGIN;

-- ============================================================
-- 1. PRODUCTOS -- catálogo, contrato exacto de la spec sección 8.1.
-- ============================================================
CREATE TABLE IF NOT EXISTS public."PRODUCTOS" (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo     text NOT NULL UNIQUE,
    nombre     text NOT NULL,
    vertical   text NOT NULL CHECK (vertical IN ('AGRICOLA', 'PECUARIO')),
    activo     boolean NOT NULL DEFAULT true,
    creado_en  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. ORGANIZACION_PRODUCTOS -- membresía N-a-N, contrato exacto de la
--    spec sección 8.2. Sin seed: se llena por organización cuando
--    corresponda.
-- ============================================================
CREATE TABLE IF NOT EXISTS public."ORGANIZACION_PRODUCTOS" (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_organizacion   text NOT NULL REFERENCES public."ORGANIZACIONES"("ID"),
    id_producto       uuid NOT NULL REFERENCES public."PRODUCTOS"(id),
    activo            boolean NOT NULL DEFAULT true,
    creado_en         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_organizacion, id_producto)
);

-- ============================================================
-- 3. RLS -- PRODUCTOS es catálogo global (mismo patrón que
--    CERTIFICACIONES_CATALOGO, ADR-027 -- USING (true) para anon);
--    ORGANIZACION_PRODUCTOS es org-scoped (mismo patrón que
--    ORGANIZACION_CERTIFICACIONES -- USING (id_organizacion IS NOT NULL)
--    para anon). Ninguna política de escritura para anon -- las
--    escrituras van por Server Action con Service Role Key.
-- ============================================================
ALTER TABLE public."PRODUCTOS"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ORGANIZACION_PRODUCTOS" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_anon_select_productos" ON public."PRODUCTOS";
CREATE POLICY "rls_anon_select_productos" ON public."PRODUCTOS"
FOR SELECT TO anon
USING (true);

DROP POLICY IF EXISTS "rls_anon_select_organizacion_productos" ON public."ORGANIZACION_PRODUCTOS";
CREATE POLICY "rls_anon_select_organizacion_productos" ON public."ORGANIZACION_PRODUCTOS"
FOR SELECT TO anon
USING (id_organizacion IS NOT NULL);

-- ============================================================
-- 4. GRANTs -- mismo patrón defensivo explícito que ADR-027.
-- ============================================================
GRANT SELECT ON public."PRODUCTOS"             TO anon, authenticated;
GRANT SELECT ON public."ORGANIZACION_PRODUCTOS" TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."PRODUCTOS"             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ORGANIZACION_PRODUCTOS" TO service_role;

-- ============================================================
-- 5. Seed de PRODUCTOS -- 2 filas, idempotente (ON CONFLICT (codigo)
--    DO NOTHING).
-- ============================================================
INSERT INTO public."PRODUCTOS" (codigo, nombre, vertical) VALUES
    ('CAFE',  'Café',  'AGRICOLA'),
    ('CACAO', 'Cacao', 'AGRICOLA')
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================
-- 6. PADRON_PARCELAS.id_producto_predominante -- dato maestro editable,
--    con backfill a CAFE (spec sección 8.3, decisión nueva de la ronda 4,
--    confirmada explícitamente por el usuario). Backfill idempotente:
--    solo toca filas todavía NULL, así que una segunda corrida no
--    reescribe nada.
-- ============================================================
ALTER TABLE public."PADRON_PARCELAS"
    ADD COLUMN IF NOT EXISTS id_producto_predominante uuid REFERENCES public."PRODUCTOS"(id);

UPDATE public."PADRON_PARCELAS"
SET id_producto_predominante = (SELECT id FROM public."PRODUCTOS" WHERE codigo = 'CAFE')
WHERE id_producto_predominante IS NULL;

-- ============================================================
-- 7. EUDR_USO_SUELO.id_producto_predominante -- foto por evento, nullable,
--    poblada por el trigger de la sección 8 (nunca por el backfill de
--    arriba, que solo toca PADRON_PARCELAS).
-- ============================================================
ALTER TABLE public."EUDR_USO_SUELO"
    ADD COLUMN IF NOT EXISTS id_producto_predominante uuid REFERENCES public."PRODUCTOS"(id);

-- ============================================================
-- 8. Trigger BEFORE INSERT -- resuelve la cadena real de 2 saltos
--    (ADR-010, spec sección 6.1/8.4): EUDR_USO_SUELO.id_parcela (GUID
--    crudo de QField) -> EUDR_MONITOREO.qfield_relation_id -> su
--    ID_Parcela_Fija -> PADRON_PARCELAS (por ID_Parcela_Fija +
--    ID_Organizacion) -> su id_producto_predominante.
--
--    CRÍTICO: nunca lanza una excepción. Si cualquier salto de la
--    cadena no resuelve (parcela no encontrada, sin producto asignado,
--    GUID no matchea ningún monitoreo), NEW.id_producto_predominante
--    queda NULL y el INSERT continúa -- no debe trabar la
--    sincronización offline de la app de Campo (scripts/etl_drive_to_supabase.py
--    inserta EUDR_USO_SUELO en lotes sin supervisión interactiva).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_set_producto_predominante_uso_suelo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_id_parcela_fija text;
    v_id_producto     uuid;
BEGIN
    SELECT m."ID_Parcela_Fija" INTO v_id_parcela_fija
    FROM public."EUDR_MONITOREO" m
    WHERE m.qfield_relation_id = NEW.id_parcela
      AND m."ID_Organizacion" = NEW."ID_Organizacion"
    LIMIT 1;

    IF v_id_parcela_fija IS NOT NULL THEN
        SELECT pp.id_producto_predominante INTO v_id_producto
        FROM public."PADRON_PARCELAS" pp
        WHERE pp."ID_Parcela_Fija" = v_id_parcela_fija
          AND pp."ID_Organizacion" = NEW."ID_Organizacion"
        LIMIT 1;
    END IF;

    NEW.id_producto_predominante := v_id_producto;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_producto_predominante_uso_suelo ON public."EUDR_USO_SUELO";
CREATE TRIGGER trg_set_producto_predominante_uso_suelo
    BEFORE INSERT ON public."EUDR_USO_SUELO"
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_set_producto_predominante_uso_suelo();

-- ============================================================
-- 9. vw_monitoreo_poligonos -- expone id_producto_predominante (spec
--    sección 8.5: se decide exponerlo acá, no solo en vw_monitoreo_web,
--    porque ya vive físicamente en EUDR_USO_SUELO -- mismo criterio ya
--    usado para area_calculada_ha/requiere_revision_area en
--    20260818_fix_views_eudr_flags.sql -- y esta vista sirve además de
--    fuente de auditoría QGIS Desktop, no solo del Dashboard Web).
--    CREATE OR REPLACE VIEW, columna nueva agregada AL FINAL de cada
--    rama del UNION ALL -- ningún join/filtro/columna existente cambia.
--    NULL::uuid en la rama EUDR_MONITOREO (esa tabla no tiene esta
--    columna -- el trigger solo existe sobre EUDR_USO_SUELO).
-- ============================================================
CREATE OR REPLACE VIEW public.vw_monitoreo_poligonos AS
SELECT
    'EUDR_MONITOREO'          AS tabla_origen,
    m.id_monitoreo::text      AS registro_id,
    m.id_monitoreo::text      AS id_origen,
    m.id_monitoreo            AS id_monitoreo,
    m."ID_Organizacion",
    m."ID_Parcela_Fija",
    COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor,
    NULL::text                AS tipo_uso,
    m.evidencia_foto,
    m.estado_revision,
    m.fecha_monitoreo,
    m.observaciones,
    m.cumple_eudr,
    m.area_calculada_ha,
    m.requiere_revision_area,
    ST_Multi(ST_CollectionExtract(ST_Transform(m.geom_inspeccion, 4326), 3))
        ::geometry(MultiPolygon, 4326) AS geom,
    ST_Multi(ST_CollectionExtract(ST_Transform(m.geom_inspeccion, 4326), 3))
        ::geometry(MultiPolygon, 4326) AS geom_inspeccion,
    NULL::uuid                AS id_producto_predominante
FROM public."EUDR_MONITOREO" m
WHERE ST_Dimension(m.geom_inspeccion) = 2

UNION ALL

SELECT
    'EUDR_USO_SUELO'          AS tabla_origen,
    u.fid::text               AS registro_id,
    u.id::text                AS id_origen,
    extensions.uuid_generate_v5(extensions.uuid_ns_url(), 'USO_SUELO_' || u.id::text)
                               AS id_monitoreo,
    u."ID_Organizacion",
    u.id_parcela              AS "ID_Parcela_Fija",
    NULL::text                AS productor,
    u.tipo_uso,
    NULL::text                AS evidencia_foto,
    u.estado_revision,
    NULL::date                AS fecha_monitoreo,
    NULL::text                AS observaciones,
    NULL::text                AS cumple_eudr,
    u.area_calculada_ha,
    u.requiere_revision_area,
    ST_Multi(ST_CollectionExtract(ST_Transform(u.geom, 4326), 3))
        ::geometry(MultiPolygon, 4326) AS geom,
    ST_Multi(ST_CollectionExtract(ST_Transform(u.geom, 4326), 3))
        ::geometry(MultiPolygon, 4326) AS geom_inspeccion,
    u.id_producto_predominante
FROM public."EUDR_USO_SUELO" u
WHERE ST_Dimension(u.geom) = 2;

-- No hace falta GRANT -- CREATE OR REPLACE VIEW preserva los GRANTs
-- existentes (GRANT SELECT ... TO authenticated;) porque la lista de
-- columnas anteriores no cambió (solo se agregó una al final).

-- ============================================================
-- 10. vw_monitoreo_web -- extiende SOLO la rama "poligono" con
--     id_producto_predominante (leído directo de
--     vw_monitoreo_poligonos.id_producto_predominante, ya materializado
--     por el trigger -- NO vía el LEFT JOIN existente contra
--     PADRON_PARCELAS, confirmado roto para filas de origen
--     EUDR_USO_SUELO en la sección 6.1/8.5 de la spec: src."ID_Parcela_Fija"
--     para esas filas es el GUID crudo de QField, no el código real de
--     PADRON_PARCELAS -- ese bug preexistente queda deliberadamente
--     fuera de este alcance) más producto_codigo/producto_nombre
--     resueltos con un LEFT JOIN adicional contra PRODUCTOS (mismo
--     patrón que la vista ya usa para productor_nombre vía PADRON_SOCIOS
--     -- nunca expone el uuid crudo solo, siempre el texto legible
--     también). Rama "punto": las mismas 3 columnas, NULL -- los puntos
--     de EUDR_INSTALACIONES no tienen producto, y hace falta para que el
--     UNION ALL siga alineado en cantidad/tipo de columnas.
--     Definición base idéntica a
--     supabase/migrations/20260825201351_pk_surrogate_multiorganizacion.sql
--     -- ningún otro cambio (mismo WHERE, mismos JOIN existentes).
-- ============================================================
CREATE OR REPLACE VIEW public.vw_monitoreo_web AS
SELECT
    'poligono'      AS tipo_geometria,
    src.tabla_origen,
    src.registro_id,
    src."ID_Organizacion",
    src."ID_Parcela_Fija",
    pp.parcela_codigo,
    pp.parcela_nombre,
    pp.totalh       AS area_ha,
    COALESCE(src.productor, mon.productor) AS productor,
    src.tipo_uso    AS clasificacion,
    src.evidencia_foto,
    src.estado_revision,
    src.fecha_monitoreo,
    src.observaciones,
    src.cumple_eudr,
    src.area_calculada_ha,
    src.requiere_revision_area,
    src.geom,
    ST_AsGeoJSON(src.geom)::json AS geom_geojson,
    COALESCE(
        ps.socio_nombre_completo, ps_parcela.socio_nombre_completo,
        src.productor, mon.productor, 'Socio no asignado'
    ) AS productor_nombre,
    src.id_producto_predominante,
    prod.codigo    AS producto_codigo,
    prod.nombre    AS producto_nombre
FROM public.vw_monitoreo_poligonos src
LEFT JOIN public."PADRON_PARCELAS" pp
    ON src."ID_Parcela_Fija" = pp."ID_Parcela_Fija" AND src."ID_Organizacion" = pp."ID_Organizacion"
LEFT JOIN LATERAL (
    SELECT COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor
    FROM public."EUDR_MONITOREO" m
    WHERE m."ID_Parcela_Fija" = src."ID_Parcela_Fija"
      AND m."ID_Organizacion" = src."ID_Organizacion"
    ORDER BY m.fecha_monitoreo DESC NULLS LAST
    LIMIT 1
) mon ON true
LEFT JOIN public."PADRON_SOCIOS" ps
    ON ps."ID_Socio" = COALESCE(src.productor, mon.productor) AND ps."ID_Organizacion" = src."ID_Organizacion"
LEFT JOIN public."PADRON_SOCIOS" ps_parcela
    ON ps_parcela."ID_Socio" = pp."ID_Socio" AND ps_parcela."ID_Organizacion" = src."ID_Organizacion"
LEFT JOIN public."PRODUCTOS" prod
    ON prod.id = src.id_producto_predominante
WHERE src.estado_revision = 'APROBADO'

UNION ALL

SELECT
    'punto'         AS tipo_geometria,
    src.tabla_origen,
    src.registro_id,
    src."ID_Organizacion",
    src."ID_Parcela_Fija",
    pp.parcela_codigo,
    pp.parcela_nombre,
    pp.totalh       AS area_ha,
    COALESCE(src.productor, mon.productor) AS productor,
    src.tipo_infra  AS clasificacion,
    src.evidencia_foto,
    src.estado_revision,
    src.fecha_monitoreo,
    src.observaciones,
    src.cumple_eudr,
    src.area_calculada_ha,
    src.requiere_revision_area,
    src.geom,
    ST_AsGeoJSON(src.geom)::json AS geom_geojson,
    COALESCE(
        ps.socio_nombre_completo, ps_parcela.socio_nombre_completo,
        src.productor, mon.productor, 'Socio no asignado'
    ) AS productor_nombre,
    NULL::uuid AS id_producto_predominante,
    NULL::text AS producto_codigo,
    NULL::text AS producto_nombre
FROM public.vw_monitoreo_puntos src
LEFT JOIN public."PADRON_PARCELAS" pp
    ON src."ID_Parcela_Fija" = pp."ID_Parcela_Fija" AND src."ID_Organizacion" = pp."ID_Organizacion"
LEFT JOIN LATERAL (
    SELECT COALESCE(m."ID_Socio", m.nuevo_productor_nombre) AS productor
    FROM public."EUDR_MONITOREO" m
    WHERE m."ID_Parcela_Fija" = src."ID_Parcela_Fija"
      AND m."ID_Organizacion" = src."ID_Organizacion"
    ORDER BY m.fecha_monitoreo DESC NULLS LAST
    LIMIT 1
) mon ON true
LEFT JOIN public."PADRON_SOCIOS" ps
    ON ps."ID_Socio" = COALESCE(src.productor, mon.productor) AND ps."ID_Organizacion" = src."ID_Organizacion"
LEFT JOIN public."PADRON_SOCIOS" ps_parcela
    ON ps_parcela."ID_Socio" = pp."ID_Socio" AND ps_parcela."ID_Organizacion" = src."ID_Organizacion"
WHERE src.estado_revision = 'APROBADO';

-- No hace falta GRANT -- CREATE OR REPLACE VIEW preserva los GRANTs
-- existentes (GRANT SELECT ... TO authenticated;) porque las columnas
-- anteriores no cambiaron (solo se agregaron 3 al final de cada rama).

COMMIT;
