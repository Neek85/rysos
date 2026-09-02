-- Migración de mayor riesgo de la secuencia: cambia la PK de
-- PADRON_SOCIOS/PADRON_PARCELAS de global (ID_Socio/ID_Parcela_Fija) a un
-- `id` UUID surrogate + UNIQUE(ID_Organizacion, ID_Socio/ID_Parcela_Fija).
-- Ver docs/adr/ADR-026-pk-surrogate-multiorganizacion.md,
-- specs/multi_organizacion_codigos_unicos.md,
-- plans/multi_organizacion_codigos_unicos_ejecucion.md (auditoría del
-- paso 2, commit 641e028) para el contexto y la evidencia completa.
--
-- Re-verificado en vivo inmediatamente antes de escribir este archivo
-- (2026-08-25, mismo día que la auditoría, sin cambios desde entonces):
-- 0 filas con ID_Organizacion NULL en ambas tablas, gen_random_uuid() en
-- uso real (CONFIGURACION_REPORTES_ORG.id_config, METADATOS_CAMPOS.id_campo),
-- ninguna de las 6 políticas RLS de PADRON_SOCIOS/PADRON_PARCELAS
-- (ryzos_all_*, rls_select_*/rls_write_*, rls_anon_select_*) referencia
-- ID_Socio/ID_Parcela_Fija ni ninguna constraint de PK en su USING/WITH
-- CHECK -- todas son puramente sobre "ID_Organizacion", así que el ALTER
-- de la PK no las afecta. Ninguna anotación FK de PostgREST apunta a
-- estas dos PK desde INSPECCIONES/EUDR_MONITOREO/EUDR_USO_SUELO/
-- EUDR_INSTALACIONES (sigue sin existir ningún FK real).
--
-- El nombre real de la constraint de PK actual nunca quedó capturado en
-- este repo (PADRON_SOCIOS/PADRON_PARCELAS se crearon fuera de este repo,
-- ver ADR-023) -- en vez de asumir el nombre por convención
-- ("PADRON_SOCIOS_pkey"), el bloque de abajo lo resuelve dinámicamente
-- vía pg_constraint antes de dropearlo.
--
-- A diferencia de la migración de hbp/otros_cultivo (ADR-024), dropear y
-- recrear una constraint de PK NO obliga a dropear las vistas
-- dependientes -- solo ALTER COLUMN TYPE fuerza eso. vw_monitoreo_web y
-- view_eudr_dashboard_aprobados dependen de las COLUMNAS ID_Socio/
-- ID_Parcela_Fija (que no cambian de nombre ni de tipo acá), no de la
-- constraint de PK en sí, así que CREATE OR REPLACE VIEW alcanza para
-- agregarles el filtro de organización al JOIN -- sin DROP VIEW, y sin
-- necesidad de recapturar/reaplicar GRANTs (CREATE OR REPLACE VIEW
-- preserva los GRANTs existentes siempre que la lista de columnas de
-- salida no cambie, que es el caso acá: mismas columnas, mismo orden,
-- solo cambia la condición del JOIN).
--
-- vw_parcelas_web/vw_socios_web NO se tocan -- son SELECT planos de
-- columnas, no dependen de la PK ni hacen JOIN, sin riesgo de fan-out.

BEGIN;

-- ============================================================
-- 1. PADRON_SOCIOS: id UUID PK + NOT NULL ID_Organizacion +
--    UNIQUE(ID_Organizacion, ID_Socio)
-- ============================================================
DO $$
DECLARE
    pk_name text;
    pk_col text;
BEGIN
    SELECT c.conname, a.attname
    INTO pk_name, pk_col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'public."PADRON_SOCIOS"'::regclass AND c.contype = 'p';

    IF pk_col IS DISTINCT FROM 'id' THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'PADRON_SOCIOS' AND column_name = 'id'
        ) THEN
            ALTER TABLE public."PADRON_SOCIOS" ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
        END IF;

        IF EXISTS (SELECT 1 FROM public."PADRON_SOCIOS" WHERE "ID_Organizacion" IS NULL) THEN
            RAISE EXCEPTION 'PADRON_SOCIOS: existen filas con ID_Organizacion NULL -- abortando antes de tocar la PK (ver specs/multi_organizacion_codigos_unicos.md, hallazgo 4)';
        END IF;
        ALTER TABLE public."PADRON_SOCIOS" ALTER COLUMN "ID_Organizacion" SET NOT NULL;

        EXECUTE format('ALTER TABLE public."PADRON_SOCIOS" DROP CONSTRAINT %I', pk_name);
        ALTER TABLE public."PADRON_SOCIOS" ADD PRIMARY KEY (id);

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public."PADRON_SOCIOS"'::regclass AND conname = 'padron_socios_org_id_socio_key'
        ) THEN
            ALTER TABLE public."PADRON_SOCIOS"
                ADD CONSTRAINT padron_socios_org_id_socio_key UNIQUE ("ID_Organizacion", "ID_Socio");
        END IF;
    END IF;
END $$;

-- ============================================================
-- 2. PADRON_PARCELAS: mismo patrón
-- ============================================================
DO $$
DECLARE
    pk_name text;
    pk_col text;
BEGIN
    SELECT c.conname, a.attname
    INTO pk_name, pk_col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'public."PADRON_PARCELAS"'::regclass AND c.contype = 'p';

    IF pk_col IS DISTINCT FROM 'id' THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'PADRON_PARCELAS' AND column_name = 'id'
        ) THEN
            ALTER TABLE public."PADRON_PARCELAS" ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
        END IF;

        IF EXISTS (SELECT 1 FROM public."PADRON_PARCELAS" WHERE "ID_Organizacion" IS NULL) THEN
            RAISE EXCEPTION 'PADRON_PARCELAS: existen filas con ID_Organizacion NULL -- abortando antes de tocar la PK (ver specs/multi_organizacion_codigos_unicos.md, hallazgo 4)';
        END IF;
        ALTER TABLE public."PADRON_PARCELAS" ALTER COLUMN "ID_Organizacion" SET NOT NULL;

        EXECUTE format('ALTER TABLE public."PADRON_PARCELAS" DROP CONSTRAINT %I', pk_name);
        ALTER TABLE public."PADRON_PARCELAS" ADD PRIMARY KEY (id);

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public."PADRON_PARCELAS"'::regclass AND conname = 'padron_parcelas_org_id_parcela_key'
        ) THEN
            ALTER TABLE public."PADRON_PARCELAS"
                ADD CONSTRAINT padron_parcelas_org_id_parcela_key UNIQUE ("ID_Organizacion", "ID_Parcela_Fija");
        END IF;
    END IF;
END $$;

-- ============================================================
-- 3. vw_monitoreo_web: agrega ID_Organizacion a los 3 JOIN contra
--    PADRON_PARCELAS/PADRON_SOCIOS, en ambas ramas (poligono/punto).
--    Definición base idéntica a
--    supabase/migrations/20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql
--    -- ningún otro cambio.
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
    ) AS productor_nombre
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
    ) AS productor_nombre
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
-- existentes (GRANT SELECT ... TO authenticated;) porque la lista de
-- columnas de salida no cambió.

-- ============================================================
-- 4. view_eudr_dashboard_aprobados: agrega ID_Organizacion a los 2 JOIN.
--    Definición base idéntica a
--    supabase/migrations/20260818_fix_dashboard_view_columns.sql --
--    ningún otro cambio (mismo WHERE, mismo GRANT implícito).
-- ============================================================
CREATE OR REPLACE VIEW public.view_eudr_dashboard_aprobados AS
SELECT
    m.id_monitoreo,
    m."ID_Organizacion",
    m."ID_Parcela_Fija",
    m."ID_Socio",
    m.fecha_monitoreo,
    m.tecnico_responsable,
    m.precision_gps,
    m.evidencia_foto,
    m.cumple_eudr,
    m.observaciones,
    m.estado_revision,
    p.parcela_codigo,
    p.parcela_nombre,
    p.totalh AS hectareas_totales,
    s.localidad,
    s.certificaciones,
    COALESCE(m.geom_inspeccion, p.geom) AS geom,
    ST_AsGeoJSON(COALESCE(m.geom_inspeccion, p.geom))::json AS geom_geojson
FROM public."EUDR_MONITOREO" m
LEFT JOIN public."PADRON_PARCELAS" p
    ON m."ID_Parcela_Fija" = p."ID_Parcela_Fija" AND m."ID_Organizacion" = p."ID_Organizacion"
LEFT JOIN public."PADRON_SOCIOS" s
    ON m."ID_Socio" = s."ID_Socio" AND m."ID_Organizacion" = s."ID_Organizacion"
WHERE m.estado_revision = 'APROBADO'
  AND (
    m."ID_Organizacion" = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  );

COMMIT;
