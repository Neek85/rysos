-- MIGRACIÓN IDEMPOTENTE: fn_validar_codigo_parcela_unico — detecta cuando
-- un ID_Parcela_Fija aparece en más de una ubicación físicamente distinta
-- dentro de la misma organización. Ver
-- docs/adr/ADR-014-codigo-parcela-unico-por-ubicacion.md.
--
-- REGLA DE NEGOCIO CONFIRMADA (no una inferencia de datos): un código de
-- parcela es único dentro de una organización y corresponde SIEMPRE a un
-- único lugar físico. Investigación previa a esta tarea confirmó 3 casos
-- reales en la instancia (COOP-JS-001/003/004, ver ADR-014) — los 3 con
-- distancia entre centroides de cientos de metros a kilómetros, ninguno
-- explicable por ruido GPS de campo.
--
-- UMBRAL PROVISORIO: 100 metros. Documentado explícitamente en ADR-014
-- como NO calibrado con un ejemplo real de "mismo lugar, dos capturas con
-- ruido GPS normal" — los 3 casos reales disponibles son todos "claramente
-- otro lugar" (768m es el más cercano), así que no hay dato real para el
-- extremo bajo. 100m se eligió por el margen amplio entre precisión GPS de
-- campo razonable (unas pocas decenas de metros, incluso en mal caso) y el
-- caso real más ajustado (768m) — a recalibrar si aparece un caso real de
-- "mismo lugar, distancia moderada" que lo contradiga.
--
-- Calculado en vivo en cada llamada — NUNCA un flag guardado que pueda
-- quedar desactualizado si se corrige la geometría de un registro después.
-- Mismo patrón que fn_validar_topologia_eudr/fn_cobertura_uso_suelo_parcela.
--
-- No requiere SECURITY DEFINER: se invoca exclusivamente desde
-- app/api/qc/validar-codigo-parcela/route.js con el Service Role Key
-- (lib/supabaseServerClient.js, ya bypassa RLS por diseño), nunca directo
-- desde el navegador con la anon key.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_validar_codigo_parcela_unico(p_monitoreo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_umbral_conflicto_m constant numeric := 100;
    v_geom geometry;
    v_org text;
    v_id_parcela_fija text;
    v_registros_en_conflicto jsonb;
BEGIN
    SELECT geom_inspeccion, "ID_Organizacion", "ID_Parcela_Fija"
    INTO v_geom, v_org, v_id_parcela_fija
    FROM public."EUDR_MONITOREO"
    WHERE id_monitoreo = p_monitoreo_id;

    IF v_geom IS NULL THEN
        RAISE EXCEPTION 'Registro % (EUDR_MONITOREO) no encontrado.', p_monitoreo_id;
    END IF;

    -- Sin ID_Parcela_Fija no hay código que pueda repetirse — nunca es un
    -- conflicto (distinto del caso "sin vínculo" de Fase B, acá simplemente
    -- no aplica la regla).
    IF v_id_parcela_fija IS NULL THEN
        RETURN jsonb_build_object(
            'monitoreo_id', p_monitoreo_id,
            'ID_Parcela_Fija', NULL,
            'tiene_conflicto', false,
            'registros_en_conflicto', '[]'::jsonb
        );
    END IF;

    -- Otros registros de la MISMA organización con el MISMO código, cuya
    -- distancia real entre centroides (geodésica, ::geography) supera el
    -- umbral — excluye siempre el propio registro. Filtra también por
    -- ID_Organizacion aunque ID_Parcela_Fija ya sea, en la práctica,
    -- improbable de colisionar entre organizaciones (defensa en
    -- profundidad, mismo criterio que fn_cobertura_uso_suelo_parcela). No
    -- filtra por estado_revision del otro registro a propósito: un
    -- conflicto sigue siendo un conflicto real sin importar si el otro
    -- registro está PENDIENTE, APROBADO, o RECHAZADO.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_monitoreo', m.id_monitoreo,
        'distancia_m', ROUND(ST_Distance(
            ST_Centroid(v_geom)::geography,
            ST_Centroid(m.geom_inspeccion)::geography
        )::numeric, 2),
        'estado_revision', m.estado_revision
    )), '[]'::jsonb)
    INTO v_registros_en_conflicto
    FROM public."EUDR_MONITOREO" m
    WHERE m.id_monitoreo != p_monitoreo_id
      AND m."ID_Organizacion" = v_org
      AND m."ID_Parcela_Fija" = v_id_parcela_fija
      AND ST_Distance(
            ST_Centroid(v_geom)::geography,
            ST_Centroid(m.geom_inspeccion)::geography
          ) > v_umbral_conflicto_m;

    RETURN jsonb_build_object(
        'monitoreo_id', p_monitoreo_id,
        'ID_Parcela_Fija', v_id_parcela_fija,
        'tiene_conflicto', jsonb_array_length(v_registros_en_conflicto) > 0,
        'registros_en_conflicto', v_registros_en_conflicto
    );
END;
$$;

COMMIT;
