-- MIGRACIÓN IDEMPOTENTE: fn_validar_topologia_eudr — excluye del cálculo
-- de solapamiento la contención esperada de una subdivisión de
-- EUDR_USO_SUELO dentro del perímetro de Monitoreo de SU PROPIA parcela.
-- Ver docs/adr/ADR-005-qc-editor-geometria-y-solapamiento.md (Fase A).
--
-- CONTEXTO Y PREMISA VERIFICADA ANTES DE ESCRIBIR ESTA MIGRACIÓN: el
-- prompt original asumía que EUDR_USO_SUELO.id_parcela se podía comparar
-- contra EUDR_MONITOREO."ID_Parcela_Fija" para determinar "misma
-- parcela". Confirmado FALSO contra datos reales (REST en vivo + el
-- GeoPackage real de un paquete de prueba ingresado en la sesión):
-- id_parcela es el GUID interno de QField del Monitoreo padre (ej.
-- "{4166dc2a-...}"), mientras que id_monitoreo en EUDR_MONITOREO se
-- RECALCULA de forma determinística en el ETL
-- (scripts/etl_drive_to_supabase.py::build_monitoreo_payload) a partir de
-- (org, ID_Parcela_Fija, fecha) — el GUID original nunca se persiste en
-- ningún lado. HOY no existe ningún campo que vincule ambas tablas por
-- identidad.
--
-- DECISIÓN (confirmada con el usuario): usar un heurístico ESPACIAL en
-- vez de un join por ID, con una condición de seguridad estricta —
-- "misma parcela" = el ÚNICO perímetro de EUDR_MONITOREO APROBADO (misma
-- organización) cuya contención de la subdivisión alcanza el umbral
-- v_umbral_contencion_pct (ver DECLARE — inicialmente ST_Contains
-- estricto/100%, ajustado a 98% en "Fase A — Seguimiento" tras confirmar
-- en vivo que el 100% casi nunca calza por ruido GPS real entre
-- capturas). Si CERO o MÁS DE UNO de esos perímetros superan el umbral,
-- NO se excluye nada — el comportamiento vuelve a ser el de antes (se
-- sigue marcando como solapamiento); nunca se asume silenciosamente cuál
-- es "la" parcela correcta ante ambigüedad, el error va siempre hacia
-- "seguir mostrando la alerta", nunca hacia "ocultarla de más" — esta
-- condición de ambigüedad (count(*) = 1 exacto) no se relajó junto con
-- el umbral de contención.
--
-- ESTO ES UN HEURÍSTICO TEMPORAL, NO UNA RELACIÓN REAL DE DATOS: depende
-- de que las parcelas vecinas no se solapen físicamente entre sí en la
-- práctica (si dos perímetros de parcelas vecinas sí se solapan y ambos
-- contienen la subdivisión, el caso cae en "más de uno" y se sigue
-- marcando — correcto por el lado seguro, pero también implica que una
-- contención genuina y sin ambigüedad en una zona con parcelas vecinas
-- solapadas seguiría alertando sin necesidad). Antes de la Fase B
-- (cobertura completa, que sí bloquea aprobaciones según ya se decidió)
-- hace falta resolver el vínculo real vía GUID — usar un match
-- geométrico para decidir qué áreas sumar y bloquear una aprobación es
-- un riesgo mucho mayor que usarlo acá solo para suprimir una alerta
-- informativa.
--
-- Reglas de negocio (confirmadas con el usuario):
-- 1. Subdivisión de Uso de Suelo contenida en el perímetro de Monitoreo
--    de SU MISMA parcela (containment exclusivo) -> NO es conflicto.
-- 2. Dos subdivisiones de Uso de Suelo de la MISMA parcela solapadas
--    ENTRE SÍ -> SÍ es conflicto (sin cambios — nunca se excluyen
--    comparaciones EUDR_USO_SUELO vs EUDR_USO_SUELO).
-- 3. Solapamiento contra geometrías de OTRA parcela (Monitoreo o Uso de
--    Suelo) -> SÍ es conflicto (sin cambios).

BEGIN;

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
    -- Margen de tolerancia del heurístico de contención (ver ADR-005,
    -- sección "Fase A — Seguimiento"): ST_Contains estricto (0% de
    -- margen) casi nunca calza en la práctica por el ruido GPS típico
    -- entre dos capturas de campo distintas (perímetro de Monitoreo vs.
    -- subdivisión de Uso de Suelo) — confirmado en vivo con un caso real
    -- (99.64% de contención, ST_Contains devolvió false). 0.98 = 98% del
    -- área de la subdivisión debe caer dentro del perímetro para
    -- considerarlo "su propia parcela". Ajustable si en el futuro se
    -- observan casos reales por debajo de este umbral.
    v_umbral_contencion_pct constant numeric := 0.98;
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

    -- Heurístico de contención exclusiva CON MARGEN DE TOLERANCIA (ver
    -- comentario de cabecera y ADR-005 "Fase A — Seguimiento"): solo para
    -- EUDR_USO_SUELO, identifica el ÚNICO perímetro de Monitoreo APROBADO
    -- cuya intersección cubre al menos v_umbral_contencion_pct del área
    -- de esta subdivisión (en vez de exigir ST_Contains estricto = 100%).
    -- La condición de ambigüedad NO se relaja: sigue siendo count(*) = 1
    -- exacto — si DOS perímetros (ej. parcelas vecinas que se solapan
    -- entre sí) superan igual el umbral, v_contenedor_exclusivo queda
    -- NULL y no se excluye nada, mismo comportamiento seguro de antes,
    -- ahora aplicado al criterio con margen.
    v_contenedor_exclusivo := NULL;
    IF p_tabla_origen = 'EUDR_USO_SUELO' THEN
        -- MIN(uuid) no existe en Postgres (uuid no tiene orden por defecto)
        -- — array_agg(...)[1] evita depender de un agregado de orden;
        -- count(*) = 1 ya garantiza que es el único elemento del array.
        SELECT CASE WHEN count(*) = 1 THEN (array_agg(id_monitoreo))[1] ELSE NULL END
        INTO v_contenedor_exclusivo
        FROM public."EUDR_MONITOREO"
        WHERE "ID_Organizacion" = v_org
          AND estado_revision = 'APROBADO'
          AND ST_Dimension(geom_inspeccion) = 2
          AND ST_Area(ST_Intersection(geom_inspeccion, v_geom)::geography)
              / NULLIF(ST_Area(v_geom::geography), 0) >= v_umbral_contencion_pct;
    END IF;

    -- Solapamiento contra otros polígonos APROBADOS de la MISMA
    -- organización (nunca la propia fila, resuelta por (tabla,id)) —
    -- ST_Overlaps exige que ninguna geometría contenga completamente a la
    -- otra (dos polígonos idénticos no "solapan" por su definición
    -- estricta en PostGIS); se usa igual porque interesa detectar
    -- invasión parcial real entre parcelas vecinas, no duplicados exactos
    -- (esos ya los previene el flujo de ingesta). El perímetro de
    -- Monitoreo que contiene EXCLUSIVAMENTE esta subdivisión (su propia
    -- parcela, ver heurístico arriba) se excluye a propósito — es la
    -- estructura esperada, no un conflicto.
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
        'deforestacion', jsonb_build_object(
            'disponible', false,
            'motivo', 'Sin fuente de datos de cobertura boscosa integrada — ver specs/qc_topological_eudr_validation.md.'
        )
    );
END;
$$;

COMMIT;
