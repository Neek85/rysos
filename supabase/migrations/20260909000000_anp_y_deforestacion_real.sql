-- MIGRACIÓN IDEMPOTENTE: cierra el Motor de Pre-Validación Satelital EUDR
-- pausado en agosto (specs/qc_topological_eudr_validation.md,
-- specs/eudr_forest_cover_2020_schema.md) — conecta datos reales de Áreas
-- Naturales Protegidas (SERNANP) y de pérdida de cobertura boscosa
-- (línea base 31-dic-2020) a fn_validar_topologia_eudr. Ver
-- specs/motor_prevalidacion_satelital_anp_bosque.md para el detalle
-- completo y las correcciones de premisa verificadas antes de escribir
-- esto.
--
-- CORRECCIÓN 1 — EUDR_COBERTURA_BOSCOSA_2020 no existe en la instancia
-- real hoy (confirmado por REST: PGRST205 "Could not find the table").
-- La migración que la crea, 20260820_eudr_cobertura_boscosa_2020.sql,
-- nunca se aplicó manualmente. Esta migración la vuelve a crear con
-- CREATE TABLE IF NOT EXISTS (idempotente, sin riesgo si en algún
-- momento se aplica la de agosto primero) en vez de asumir que ya existe.
--
-- CORRECCIÓN 2 — la definición VIGENTE hoy de fn_validar_topologia_eudr
-- (confirmado invocando la RPC real en vivo) es la de
-- 20260822_173416_fn_validar_topologia_contencion_parcela.sql (con la
-- clave contenido_en_parcela_propia), no la de agosto 20. Esa versión de
-- agosto 22 se escribió sobre la base ORIGINAL de agosto 20 (sin cruce
-- real de deforestación) y nunca incorporó el CREATE OR REPLACE de
-- 20260820_eudr_cobertura_boscosa_2020.sql -- la lógica de deforestación
-- quedó regresionada a {disponible:false} fijo desde agosto 22, sin que
-- ninguna tarea posterior lo notara. Esta migración parte de la versión
-- de agosto 22 (preserva contenido_en_parcela_propia) y le agrega anp/
-- deforestacion reales -- no de la de agosto 20.

BEGIN;

-- ============================================================
-- 1. EUDR_AREAS_PROTEGIDAS — dataset de referencia compartido (no
--    multi-tenant), mismo criterio ya usado para
--    EUDR_COBERTURA_BOSCOSA_2020: un polígono SERNANP en una coordenada
--    dada es una verdad geográfica compartida, relevante para cualquier
--    organización cuya parcela caiga ahí -- no un registro propiedad de
--    una organización particular (mismo criterio que lib/data/ubigeo_peru.json).
-- ============================================================
CREATE TABLE IF NOT EXISTS public."EUDR_AREAS_PROTEGIDAS" (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    geom          geometry(MultiPolygon, 4326) NOT NULL,
    nombre        text,
    categoria     text,
    base_legal    text,
    fuente        text NOT NULL DEFAULT 'SERNANP',
    dataset_version text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."EUDR_AREAS_PROTEGIDAS" IS
    'Dataset de referencia compartido (no multi-tenant) de Áreas Naturales Protegidas (SERNANP) para el cruce EUDR de riesgo de ANP. Vacía hasta que se cargue el dataset real (scripts/ingest_anp_layer.py) — ver specs/motor_prevalidacion_satelital_anp_bosque.md.';

CREATE INDEX IF NOT EXISTS idx_gist_eudr_areas_protegidas_geom
    ON public."EUDR_AREAS_PROTEGIDAS" USING GIST (geom);

ALTER TABLE public."EUDR_AREAS_PROTEGIDAS" ENABLE ROW LEVEL SECURITY;

-- Higiene/least-privilege, mismo criterio que EUDR_COBERTURA_BOSCOSA_2020:
-- el acceso real es vía Service Role Key desde
-- app/api/qc/validate-spatial/route.js, que bypasea RLS de todas formas.
DROP POLICY IF EXISTS rls_select_areas_protegidas ON public."EUDR_AREAS_PROTEGIDAS";
CREATE POLICY rls_select_areas_protegidas
    ON public."EUDR_AREAS_PROTEGIDAS"
    FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- 2. EUDR_COBERTURA_BOSCOSA_2020 -- CREATE TABLE IF NOT EXISTS (ver
--    CORRECCIÓN 1 arriba). Idéntica a 20260820_eudr_cobertura_boscosa_2020.sql
--    -- si esa migración ya se aplicó, este bloque es un no-op real.
-- ============================================================
CREATE TABLE IF NOT EXISTS public."EUDR_COBERTURA_BOSCOSA_2020" (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    geom          geometry(MultiPolygon, 4326) NOT NULL,
    anio_perdida  integer,
    fuente        text NOT NULL DEFAULT 'DESCONOCIDA',
    dataset_version text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."EUDR_COBERTURA_BOSCOSA_2020" IS
    'Dataset de referencia compartido (no multi-tenant) de eventos de pérdida de cobertura forestal, para el cruce EUDR post-31/12/2020. Ver specs/eudr_forest_cover_2020_schema.md.';

CREATE INDEX IF NOT EXISTS idx_gist_eudr_cobertura_boscosa_2020_geom
    ON public."EUDR_COBERTURA_BOSCOSA_2020" USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_eudr_cobertura_boscosa_2020_anio_perdida
    ON public."EUDR_COBERTURA_BOSCOSA_2020" (anio_perdida);

ALTER TABLE public."EUDR_COBERTURA_BOSCOSA_2020" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_select_cobertura_boscosa ON public."EUDR_COBERTURA_BOSCOSA_2020";
CREATE POLICY rls_select_cobertura_boscosa
    ON public."EUDR_COBERTURA_BOSCOSA_2020"
    FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- 3. fn_evaluar_deforestacion_eudr -- cruce real contra
--    EUDR_COBERTURA_BOSCOSA_2020. disponible:false si la tabla sigue
--    vacía (nunca inventa un resultado). ST_Union de las intersecciones
--    (no SUM de áreas por evento) para no contar dos veces un área donde
--    2 polígonos de pérdida se solapen entre sí.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_evaluar_deforestacion_eudr(p_geom geometry)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
    v_geom geometry := p_geom;
    v_geometria_corregida boolean := false;
    v_hay_datos boolean;
    v_ha_deforestadas numeric;
    v_area_ha numeric;
    v_pct numeric;
    v_anio_max integer;
    v_detalles jsonb;
BEGIN
    SELECT EXISTS(SELECT 1 FROM public."EUDR_COBERTURA_BOSCOSA_2020") INTO v_hay_datos;
    IF NOT v_hay_datos THEN
        RETURN jsonb_build_object(
            'disponible', false,
            'ha_deforestadas', 0,
            'pct_solapamiento', 0,
            'anio_evento_max', NULL,
            'geometria_corregida', false,
            'detalles', '[]'::jsonb
        );
    END IF;

    IF NOT ST_IsValid(v_geom) THEN
        v_geom := ST_MakeValid(v_geom);
        v_geometria_corregida := true;
    END IF;

    v_area_ha := public.fn_calcular_area_ha(v_geom);

    WITH intersectados AS (
        SELECT
            id, anio_perdida, fuente,
            ST_Intersection(v_geom, geom) AS inter_geom
        FROM public."EUDR_COBERTURA_BOSCOSA_2020"
        WHERE anio_perdida IS NOT NULL
          AND anio_perdida >= 2021
          AND ST_Intersects(v_geom, geom)
    ),
    agregado AS (
        SELECT
            ST_Union(inter_geom) AS combinado,
            MAX(anio_perdida) AS anio_max,
            COALESCE(jsonb_agg(jsonb_build_object(
                'id', id,
                'anio_perdida', anio_perdida,
                'fuente', fuente,
                'ha_afectada', ROUND((ST_Area(inter_geom::geography) / 10000)::numeric, 4)
            )), '[]'::jsonb) AS detalles
        FROM intersectados
    )
    SELECT
        COALESCE(ST_Area(combinado::geography) / 10000, 0),
        anio_max,
        detalles
    INTO v_ha_deforestadas, v_anio_max, v_detalles
    FROM agregado;

    v_pct := CASE WHEN v_area_ha > 0 THEN ROUND((v_ha_deforestadas / v_area_ha * 100)::numeric, 2) ELSE 0 END;

    RETURN jsonb_build_object(
        'disponible', true,
        'ha_deforestadas', ROUND(v_ha_deforestadas::numeric, 4),
        'pct_solapamiento', v_pct,
        'anio_evento_max', v_anio_max,
        'geometria_corregida', v_geometria_corregida,
        'detalles', v_detalles
    );
END;
$$;

-- ============================================================
-- 4. fn_evaluar_anp_eudr -- ST_Intersects para alerta_anp (tolerancia
--    cero, cualquier superposición real cuenta) y distancia geodésica al
--    ANP más cercano (sirve al badge de hoy y al futuro motor de riesgo
--    legal de specs/opcion_c_evaluacion_riesgo_legalidad.md, umbral de
--    5 km, sin duplicar el cruce espacial el día que se construya). El
--    operador KNN `<->` (sobre geometry, distancia planar en grados)
--    elige el candidato más cercano usando el índice GiST antes de medir
--    la distancia geodésica real solo para ese candidato -- evita un
--    escaneo secuencial completo del dataset.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_evaluar_anp_eudr(p_geom geometry)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
    v_geom geometry := p_geom;
    v_hay_datos boolean;
    v_alerta boolean;
    v_distancia_km numeric;
    v_intersecciones jsonb;
    v_area_parcela_ha numeric;
BEGIN
    SELECT EXISTS(SELECT 1 FROM public."EUDR_AREAS_PROTEGIDAS") INTO v_hay_datos;
    IF NOT v_hay_datos THEN
        RETURN jsonb_build_object(
            'disponible', false,
            'alerta_anp', false,
            'distancia_minima_km', NULL,
            'intersecciones', '[]'::jsonb
        );
    END IF;

    IF NOT ST_IsValid(v_geom) THEN
        v_geom := ST_MakeValid(v_geom);
    END IF;

    v_area_parcela_ha := public.fn_calcular_area_ha(v_geom);

    WITH intersectados AS (
        SELECT
            id, nombre, categoria,
            ST_Area(ST_Intersection(v_geom, geom)::geography) / 10000 AS area_solapada_ha
        FROM public."EUDR_AREAS_PROTEGIDAS"
        WHERE ST_Intersects(v_geom, geom)
    )
    SELECT
        COALESCE(jsonb_agg(jsonb_build_object(
            'anp_id', id,
            'nombre', nombre,
            'categoria', categoria,
            'area_solapada_ha', ROUND(area_solapada_ha::numeric, 4),
            'porcentaje_parcela', CASE WHEN v_area_parcela_ha > 0
                THEN ROUND((area_solapada_ha / v_area_parcela_ha * 100)::numeric, 2)
                ELSE 0 END
        )), '[]'::jsonb),
        COUNT(*) > 0
    INTO v_intersecciones, v_alerta
    FROM intersectados;

    SELECT ST_Distance(v_geom::geography, geom::geography) / 1000
    INTO v_distancia_km
    FROM public."EUDR_AREAS_PROTEGIDAS"
    ORDER BY v_geom <-> geom
    LIMIT 1;

    RETURN jsonb_build_object(
        'disponible', true,
        'alerta_anp', v_alerta,
        'distancia_minima_km', ROUND(v_distancia_km::numeric, 3),
        'intersecciones', v_intersecciones
    );
END;
$$;

-- ============================================================
-- 5. fn_validar_topologia_eudr -- CREATE OR REPLACE sobre la base REAL
--    vigente (agosto 22, con contenido_en_parcela_propia -- ver
--    CORRECCIÓN 2 arriba). Único cambio real: anp/deforestacion pasan de
--    fijas a los resultados reales de las 2 funciones de arriba. Resto
--    de la lógica (topología, solapamiento, contención propia) idéntico,
--    carácter por carácter, a 20260822_173416_fn_validar_topologia_contencion_parcela.sql.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_validar_topologia_eudr(
    p_tabla_origen text,
    p_registro_id text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_geom geometry;
    v_org text;
    v_es_valido boolean;
    v_motivo_invalidez text;
    v_es_simple boolean;
    v_area_ha numeric;
    v_solapamientos jsonb;
    v_max_solapamiento_pct numeric := 0;
    v_contenedor_exclusivo uuid;
    v_umbral_contencion_pct constant numeric := 0.98;
    v_deforestacion jsonb;
    v_anp jsonb;
BEGIN
    IF p_tabla_origen NOT IN ('EUDR_MONITOREO', 'EUDR_USO_SUELO') THEN
        RAISE EXCEPTION
            'fn_validar_topologia_eudr solo aplica a EUDR_MONITOREO/EUDR_USO_SUELO (siempre polígono) — % no tiene topología de área que validar.',
            p_tabla_origen;
    END IF;

    IF p_tabla_origen = 'EUDR_MONITOREO' THEN
        SELECT geom_inspeccion, "ID_Organizacion" INTO v_geom, v_org
        FROM public."EUDR_MONITOREO"
        WHERE id_monitoreo::text = p_registro_id;
    ELSE
        SELECT geom, "ID_Organizacion" INTO v_geom, v_org
        FROM public."EUDR_USO_SUELO"
        WHERE id::text = p_registro_id;
    END IF;

    IF v_geom IS NULL THEN
        RAISE EXCEPTION 'Registro % (%) no encontrado.', p_registro_id, p_tabla_origen;
    END IF;

    IF ST_Dimension(v_geom) <> 2 THEN
        RAISE EXCEPTION
            'El registro % (%) no tiene una geometría poligonal (dimensión %) — nada que validar topológicamente.',
            p_registro_id, p_tabla_origen, ST_Dimension(v_geom);
    END IF;

    v_es_valido := ST_IsValid(v_geom);
    v_motivo_invalidez := CASE WHEN v_es_valido THEN NULL ELSE ST_IsValidReason(v_geom) END;
    v_es_simple := ST_IsSimple(v_geom);
    v_area_ha := public.fn_calcular_area_ha(v_geom);

    v_contenedor_exclusivo := NULL;
    IF p_tabla_origen = 'EUDR_USO_SUELO' THEN
        SELECT CASE WHEN count(*) = 1 THEN (array_agg(id_monitoreo))[1] ELSE NULL END
        INTO v_contenedor_exclusivo
        FROM public."EUDR_MONITOREO"
        WHERE "ID_Organizacion" = v_org
          AND estado_revision = 'APROBADO'
          AND ST_Dimension(geom_inspeccion) = 2
          AND ST_Area(ST_Intersection(geom_inspeccion, v_geom)::geography)
              / NULLIF(ST_Area(v_geom::geography), 0) >= v_umbral_contencion_pct;
    END IF;

    WITH candidatos AS (
        SELECT 'EUDR_MONITOREO'::text AS tabla_origen, id_monitoreo::text AS registro_id, geom_inspeccion AS geom
        FROM public."EUDR_MONITOREO"
        WHERE "ID_Organizacion" = v_org
          AND estado_revision = 'APROBADO'
          AND ST_Dimension(geom_inspeccion) = 2
          AND NOT (p_tabla_origen = 'EUDR_MONITOREO' AND id_monitoreo::text = p_registro_id)
          AND (v_contenedor_exclusivo IS NULL OR id_monitoreo <> v_contenedor_exclusivo)
        UNION ALL
        SELECT 'EUDR_USO_SUELO'::text, id::text, geom
        FROM public."EUDR_USO_SUELO"
        WHERE "ID_Organizacion" = v_org
          AND estado_revision = 'APROBADO'
          AND ST_Dimension(geom) = 2
          AND NOT (p_tabla_origen = 'EUDR_USO_SUELO' AND id::text = p_registro_id)
    ),
    solapados AS (
        SELECT
            tabla_origen,
            registro_id,
            ROUND((ST_Area(ST_Intersection(v_geom, geom)::geography) / NULLIF(ST_Area(v_geom::geography), 0) * 100)::numeric, 2)
                AS solapamiento_pct
        FROM candidatos
        WHERE ST_Overlaps(v_geom, geom) OR ST_Contains(geom, v_geom) OR ST_Contains(v_geom, geom)
    )
    SELECT
        COALESCE(jsonb_agg(jsonb_build_object(
            'tabla_origen', tabla_origen,
            'registro_id', registro_id,
            'solapamiento_pct', solapamiento_pct
        )), '[]'::jsonb),
        COALESCE(MAX(solapamiento_pct), 0)
    INTO v_solapamientos, v_max_solapamiento_pct
    FROM solapados;

    v_deforestacion := public.fn_evaluar_deforestacion_eudr(v_geom);
    v_anp := public.fn_evaluar_anp_eudr(v_geom);

    RETURN jsonb_build_object(
        'tabla_origen', p_tabla_origen,
        'registro_id', p_registro_id,
        'ID_Organizacion', v_org,
        'es_valido', v_es_valido,
        'motivo_invalidez', v_motivo_invalidez,
        'es_simple', v_es_simple,
        'area_ha', v_area_ha,
        'solapa', jsonb_array_length(v_solapamientos) > 0,
        'solapamiento_max_pct', v_max_solapamiento_pct,
        'registros_solapados', v_solapamientos,
        'contenido_en_parcela_propia', v_contenedor_exclusivo IS NOT NULL,
        'deforestacion', v_deforestacion,
        'anp', v_anp
    );
END;
$$;

COMMIT;
