-- MIGRACIÓN IDEMPOTENTE: fn_validar_topologia_eudr — validación topológica
-- bajo demanda para un registro EUDR_MONITOREO/EUDR_USO_SUELO desde la
-- Consola QC. Ver specs/qc_topological_eudr_validation.md.
--
-- CONTEXTO Y CORRECCIÓN DE PREMISAS: un prompt pidió esta función con la
-- firma `fn_validar_topologia_eudr(p_monitoreo_id UUID, p_id_organizacion
-- UUID)` más un cruce espacial contra una tabla `EUDR_COBERTURA_BOSCOSA_2020`
-- y cálculo de área reproyectando a UTM 17S (EPSG:32717). Verificado antes
-- de escribir código:
--
-- 1. `EUDR_COBERTURA_BOSCOSA_2020` NO EXISTE, y no hay ninguna fuente de
--    datos satelital real conectada a esta base (Hansen GFW/PNCBM MINAM/
--    SERNANP) — el motor ya construido para esto
--    (`scripts/satellite_prevalidation.py::SatellitePrevalidationEngine`)
--    recibe los polígonos de pérdida forestal/ANP como PARÁMETRO del
--    caller, nunca los leyó de una tabla propia. Implementar el cruce acá
--    habría significado, o fabricar una tabla vacía (el badge "Apto EUDR"
--    mostraría un veredicto de cumplimiento legal sin ningún dato real
--    detrás — riesgo real de inducir a error en una decisión de
--    cumplimiento EUDR), o inventar datos de prueba (peor). **Pausado con
--    `AskUserQuestion` antes de implementar; el usuario confirmó dejar
--    esta parte fuera de alcance por ahora** — el frontend muestra el
--    badge correspondiente como "Sin datos — no integrado", nunca un
--    resultado inventado. Ver specs/qc_topological_eudr_validation.md.
-- 2. `ID_Organizacion` es `text` en todo el schema (códigos como
--    "ORG-COOP-NORTE"), nunca `uuid` — la firma original habría fallado
--    en el primer INSERT/SELECT real.
-- 3. La validación topológica no aplica solo a "un id de monitoreo": los
--    registros de `EUDR_USO_SUELO` (subdivisiones de uso de suelo,
--    siempre polígono) tienen exactamente el mismo tipo de problema
--    potencial (auto-intersección, solapamiento) y son, si acaso, MÁS
--    propensos a solaparse entre sí que los perímetros. `EUDR_INSTALACIONES`
--    se excluye a propósito (siempre puntual, sin topología de área que
--    validar). Firma corregida: `p_tabla_origen text, p_registro_id text`
--    (mismo par ya usado en `lib/eudrQcActions.js::resolveUpdateTarget`
--    para ubicar cualquier registro de las 3 tablas), sin parámetro de
--    organización — la función la resuelve ella misma leyendo la fila
--    real, más robusto que confiar en un valor que el cliente podría
--    enviar desincronizado.
-- 4. El área ya se calcula automáticamente y se mantiene actualizada por
--    trigger desde `20260818_gis_core_sanitization.sql`
--    (`fn_calcular_area_ha`, geodésica real vía `::geography`, no una
--    reproyección UTM de zona fija — más precisa porque no depende de
--    elegir la zona UTM "correcta" para cada geometría). Se reutiliza esa
--    misma función en vez de reimplementar el cálculo con
--    `ST_Transform(..., 32717)`, que además asume una única zona UTM
--    (17S) para todo el territorio, no necesariamente correcta según
--    dónde caiga cada parcela.
--
-- No requiere SECURITY DEFINER: se invoca exclusivamente desde
-- app/api/qc/validate-spatial/route.js con el Service Role Key
-- (lib/supabaseServerClient.js, ya bypassa RLS por diseño — mismo patrón
-- que fn_guardar_inspeccion_completa), nunca directo desde el navegador
-- con la anon key.

BEGIN;

-- ============================================================
-- 1. Tabla de auditoría (sin PII) — no existía ninguna tabla audit_logs
--    en el proyecto antes de esta migración.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.qc_validation_audit_log (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tabla_origen      text NOT NULL,
    registro_id       text NOT NULL,
    "ID_Organizacion" text NOT NULL,
    resultado         jsonb NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qc_validation_audit_log_registro
    ON public.qc_validation_audit_log (tabla_origen, registro_id);

-- Sin políticas anon/authenticated: esta tabla solo la escribe/lee el
-- Route Handler server-side vía Service Role Key, que bypassa RLS.
ALTER TABLE public.qc_validation_audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. fn_validar_topologia_eudr
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

    -- Solapamiento contra otros polígonos APROBADOS de la MISMA
    -- organización (nunca la propia fila, resuelta por (tabla,id)) —
    -- ST_Overlaps exige que ninguna geometría contenga completamente a la
    -- otra (dos polígonos idénticos no "solapan" por su definición
    -- estricta en PostGIS); se usa igual porque interesa detectar
    -- invasión parcial real entre parcelas vecinas, no duplicados exactos
    -- (esos ya los previene el flujo de ingesta).
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
        'deforestacion', jsonb_build_object(
            'disponible', false,
            'motivo', 'Sin fuente de datos de cobertura boscosa integrada — ver specs/qc_topological_eudr_validation.md.'
        )
    );
END;
$$;

COMMIT;
