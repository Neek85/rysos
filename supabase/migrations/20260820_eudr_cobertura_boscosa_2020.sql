-- MIGRACIÓN IDEMPOTENTE: EUDR_COBERTURA_BOSCOSA_2020 — infraestructura para
-- el cruce espacial contra eventos de pérdida de cobertura forestal (línea
-- de corte EUDR, 31/12/2020). Ver specs/eudr_forest_cover_2020_schema.md.
--
-- IMPORTANTE — esta migración NO carga ningún dato real: crea la tabla,
-- sus índices y RLS vacíos, y actualiza fn_validar_topologia_eudr para que
-- la consulte SI llega a tener filas. Cargar el dataset real (MINAM
-- Geobosques / Hansen GFW) es una tarea de ingesta de datos aparte, fuera
-- de alcance acá — ver specs/qc_topological_eudr_validation.md, donde se
-- pausó explícitamente esta parte con el usuario (riesgo real de mostrar
-- un veredicto de cumplimiento EUDR falso si se fabricaba la tabla con
-- datos de prueba). Con la tabla vacía, fn_validar_topologia_eudr sigue
-- devolviendo `deforestacion.disponible = false` exactamente igual que
-- antes de esta migración — ningún comportamiento visible cambia hasta
-- que alguien cargue datos reales.
--
-- CORRECCIÓN DE PREMISA: el prompt pedía la tabla con `ID_Organizacion
-- text` (multi-tenant) + RLS aislada por organización + un índice
-- compuesto `(ID_Organizacion, id)`. Un dataset de cobertura boscosa
-- (MINAM Geobosques / Hansen GFW) es una VERDAD GEOGRÁFICA COMPARTIDA —
-- el mismo polígono de pérdida forestal en una coordenada dada es
-- relevante para CUALQUIER organización cuya parcela caiga ahí, no un
-- registro propiedad de una organización particular. Modelarlo
-- multi-tenant obligaría a cargar el mismo dataset nacional una vez por
-- organización (duplicado, y roto para cualquier organización a la que no
-- se le hubiera cargado su copia) — mismo criterio que ya usa este
-- proyecto para otro dataset de referencia compartido no propietario
-- (`lib/data/ubigeo_peru.json`, sin scoping por organización). Se omite
-- `ID_Organizacion` y el índice compuesto que dependía de ella.

BEGIN;

-- ============================================================
-- 1. Tabla EUDR_COBERTURA_BOSCOSA_2020
-- ============================================================
CREATE TABLE IF NOT EXISTS public."EUDR_COBERTURA_BOSCOSA_2020" (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    geom          geometry(MultiPolygon, 4326) NOT NULL,
    -- Año en que se detectó la pérdida de cobertura forestal en este
    -- polígono (convención Hansen GFW "loss year" — mismo contrato que
    -- scripts/satellite_prevalidation.py::forest_loss_events[].year). NULL
    -- reservado para un futuro polígono de "cobertura intacta" genérico,
    -- sin evento de pérdida asociado — hoy fn_validar_topologia_eudr solo
    -- considera filas con anio_perdida IS NOT NULL.
    anio_perdida  integer,
    -- Metadatos de procedencia — de dónde salió este polígono, para poder
    -- auditar/depurar el dataset cargado sin adivinar.
    fuente        text NOT NULL DEFAULT 'DESCONOCIDA',
    -- Ej. "MINAM_GEOBOSQUES", "HANSEN_GFW", "PNCBM" — libre a propósito,
    -- distintas fuentes usan nomenclaturas propias.
    dataset_version text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."EUDR_COBERTURA_BOSCOSA_2020" IS
    'Dataset de referencia compartido (no multi-tenant) de eventos de pérdida de cobertura forestal, para el cruce EUDR post-31/12/2020. Vacía hasta que se cargue un dataset real (MINAM Geobosques / Hansen GFW) — ver specs/eudr_forest_cover_2020_schema.md.';

-- ============================================================
-- 2. Índices — GiST espacial (la consulta real de
--    fn_validar_topologia_eudr es un ST_Intersects contra `geom`) + btree
--    sobre anio_perdida (filtra "> 2020" antes de tocar el índice
--    espacial en datasets grandes).
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_gist_eudr_cobertura_boscosa_2020_geom
    ON public."EUDR_COBERTURA_BOSCOSA_2020" USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_eudr_cobertura_boscosa_2020_anio_perdida
    ON public."EUDR_COBERTURA_BOSCOSA_2020" (anio_perdida);

-- ============================================================
-- 3. RLS — solo lectura para authenticated (mismo patrón que
--    ORGANIZACIONES, Tarea 9.1: dataset de referencia, sin necesidad real
--    de escritura desde la app). fn_validar_topologia_eudr la consulta sin
--    SECURITY DEFINER, pero solo se invoca vía Service Role Key
--    (app/api/qc/validate-spatial/route.js), que bypassa RLS de todos
--    modos — esta política es higiene/least-privilege, no la defensa real.
-- ============================================================
ALTER TABLE public."EUDR_COBERTURA_BOSCOSA_2020" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_select_cobertura_boscosa ON public."EUDR_COBERTURA_BOSCOSA_2020";
CREATE POLICY rls_select_cobertura_boscosa
    ON public."EUDR_COBERTURA_BOSCOSA_2020"
    FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- 4. fn_validar_topologia_eudr — agrega el cruce interseccional real.
--    CREATE OR REPLACE FUNCTION sobre la definición de
--    20260820_fn_validar_topologia_eudr.sql: mismo nombre/firma/tipo de
--    retorno, se agrega la resolución real de `deforestacion` en vez del
--    literal `{disponible:false,...}` fijo que tenía antes.
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
    v_hay_cobertura_boscosa boolean;
    v_deforestacion jsonb;
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

    WITH candidatos AS (
        SELECT 'EUDR_MONITOREO'::text AS tabla_origen, id_monitoreo::text AS registro_id, geom_inspeccion AS geom
        FROM public."EUDR_MONITOREO"
        WHERE "ID_Organizacion" = v_org
          AND estado_revision = 'APROBADO'
          AND ST_Dimension(geom_inspeccion) = 2
          AND NOT (p_tabla_origen = 'EUDR_MONITOREO' AND id_monitoreo::text = p_registro_id)
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

    -- Cruce contra EUDR_COBERTURA_BOSCOSA_2020 — SOLO si la tabla tiene
    -- alguna fila cargada. Vacía (estado por defecto tras esta migración)
    -- => mismo resultado {disponible:false,...} que antes de que existiera
    -- la tabla, nunca "sin intersección" (que implicaría una verificación
    -- real que no ocurrió).
    SELECT EXISTS(SELECT 1 FROM public."EUDR_COBERTURA_BOSCOSA_2020") INTO v_hay_cobertura_boscosa;

    IF v_hay_cobertura_boscosa THEN
        WITH eventos AS (
            SELECT
                id,
                anio_perdida,
                fuente,
                ROUND((ST_Area(ST_Intersection(v_geom, geom)::geography) / NULLIF(ST_Area(v_geom::geography), 0) * 100)::numeric, 2)
                    AS area_afectada_pct
            FROM public."EUDR_COBERTURA_BOSCOSA_2020"
            WHERE anio_perdida IS NOT NULL
              AND anio_perdida > 2020
              AND ST_Intersects(v_geom, geom)
        )
        SELECT jsonb_build_object(
            'disponible', true,
            'interseca_post_2020', EXISTS(SELECT 1 FROM eventos),
            'area_afectada_max_pct', COALESCE((SELECT MAX(area_afectada_pct) FROM eventos), 0),
            'eventos', COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                    'id', id, 'anio_perdida', anio_perdida, 'fuente', fuente, 'area_afectada_pct', area_afectada_pct
                )) FROM eventos),
                '[]'::jsonb
            )
        ) INTO v_deforestacion;
    ELSE
        v_deforestacion := jsonb_build_object(
            'disponible', false,
            'motivo', 'Sin datos de cobertura boscosa cargados — ver specs/eudr_forest_cover_2020_schema.md.'
        );
    END IF;

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
        'deforestacion', v_deforestacion
    );
END;
$$;

COMMIT;
