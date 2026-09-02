-- MIGRACIÓN IDEMPOTENTE: fn_cobertura_uso_suelo_parcela — Fase B, cálculo
-- de cobertura completa de subdivisiones de Uso de Suelo por parcela, con
-- bloqueo de aprobación cuando corresponda. Ver
-- docs/adr/ADR-011-cobertura-completa-uso-suelo.md.
--
-- CONTEXTO: usa el vínculo REAL de ADR-010 (qfield_relation_id), nunca el
-- heurístico espacial temporal de ADR-005/Fase A — ese heurístico solo se
-- usó como mecanismo puntual de backfill, nunca como lógica de runtime.
--
-- REGLA DE NEGOCIO CLAVE (confirmada tras detectar un riesgo real con
-- datos reales — NO renegociable en esta migración): PADRON_PARCELAS.totalh
-- NUNCA participa en la decisión de bloqueo, en ninguna dirección. Motivo:
-- el caso real "COOP-JS-003" (ver ADR-011) tiene totalh=2.25ha mientras el
-- área real del perímetro de Monitoreo es 24.6072ha (totalh subestima por
-- un factor de ~10x) — si totalh hubiera participado en la decisión,
-- habría enmascarado un hueco de cobertura real del 38.9%. totalh se
-- calcula y devuelve SOLO como dato informativo aparte
-- (divergencia_totalh_pct), etiquetado explícitamente como "puede no ser
-- confiable" del lado del frontend.
--
-- p_monitoreo_id ya debe ser un EUDR_MONITOREO real y resuelto — la
-- resolución "dado un EUDR_USO_SUELO, encontrar su EUDR_MONITOREO padre
-- vía qfield_relation_id" (y el caso "sin vínculo, no se puede determinar
-- la parcela madre") vive en app/api/qc/cobertura-uso-suelo/route.js, no
-- acá — esta función asume que ya se resolvió sin ambigüedad, igual que
-- fn_validar_topologia_eudr asume (tabla_origen, registro_id) ya
-- resueltos por el caller.
--
-- No requiere SECURITY DEFINER: se invoca exclusivamente desde
-- app/api/qc/cobertura-uso-suelo/route.js con el Service Role Key
-- (lib/supabaseServerClient.js, ya bypassa RLS por diseño — mismo patrón
-- que fn_validar_topologia_eudr/fn_parcelas_vecinas_eudr), nunca directo
-- desde el navegador con la anon key.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_cobertura_uso_suelo_parcela(p_monitoreo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    -- Mismo umbral (5%) ya usado y confirmado para Fase B — nombrado, no
    -- un número mágico inline.
    v_umbral_hueco_pct constant numeric := 0.05;
    v_geom geometry;
    v_org text;
    v_id_parcela_fija text;
    v_qfield_relation_id text;
    v_area_monitoreo_ha numeric;
    v_totalh_padron_ha numeric;
    v_suma_uso_suelo_ha numeric;
    v_hueco_cobertura boolean;
    v_divergencia_totalh_pct numeric;
BEGIN
    SELECT geom_inspeccion, "ID_Organizacion", "ID_Parcela_Fija", qfield_relation_id
    INTO v_geom, v_org, v_id_parcela_fija, v_qfield_relation_id
    FROM public."EUDR_MONITOREO"
    WHERE id_monitoreo = p_monitoreo_id;

    IF v_geom IS NULL THEN
        RAISE EXCEPTION 'Registro % (EUDR_MONITOREO) no encontrado.', p_monitoreo_id;
    END IF;

    v_area_monitoreo_ha := public.fn_calcular_area_ha(v_geom);

    -- totalh NULL o 0 se trata como "no disponible", NUNCA como 0 real
    -- (un 0 real significaría "esta parcela no tiene hectáreas", que no
    -- es lo mismo que "el dato no está cargado").
    SELECT NULLIF(totalh, 0) INTO v_totalh_padron_ha
    FROM public."PADRON_PARCELAS"
    WHERE "ID_Parcela_Fija" = v_id_parcela_fija;

    -- Suma de área de las subdivisiones APROBADAS vinculadas vía el join
    -- REAL (qfield_relation_id = id_parcela) — nunca el heurístico
    -- espacial de ADR-005. Filtrada también por ID_Organizacion (defensa
    -- en profundidad — CLAUDE.md exige ID_Organizacion en toda consulta a
    -- tablas transaccionales, aunque qfield_relation_id ya sea, en la
    -- práctica, un GUID improbable de colisionar entre organizaciones).
    SELECT COALESCE(SUM(area_calculada_ha), 0) INTO v_suma_uso_suelo_ha
    FROM public."EUDR_USO_SUELO"
    WHERE id_parcela = v_qfield_relation_id
      AND "ID_Organizacion" = v_org
      AND estado_revision = 'APROBADO';

    -- ÚNICO criterio de bloqueo (ver cabecera): el hueco real contra el
    -- área de Monitoreo. totalh NO aparece en esta fórmula.
    v_hueco_cobertura := v_area_monitoreo_ha > 0
        AND ((v_area_monitoreo_ha - v_suma_uso_suelo_ha) / v_area_monitoreo_ha) > v_umbral_hueco_pct;

    -- Divergencia informativa: nunca influye en v_hueco_cobertura.
    v_divergencia_totalh_pct := CASE
        WHEN v_totalh_padron_ha IS NOT NULL AND v_area_monitoreo_ha > 0
        THEN ROUND((ABS(v_area_monitoreo_ha - v_totalh_padron_ha) / v_area_monitoreo_ha * 100)::numeric, 2)
        ELSE NULL
    END;

    RETURN jsonb_build_object(
        'monitoreo_id', p_monitoreo_id,
        'ID_Organizacion', v_org,
        'area_monitoreo_ha', v_area_monitoreo_ha,
        'totalh_padron_ha', v_totalh_padron_ha,
        'suma_uso_suelo_aprobado_ha', v_suma_uso_suelo_ha,
        'hueco_cobertura', v_hueco_cobertura,
        -- Idéntico a hueco_cobertura a propósito: no existe ninguna otra
        -- condición que participe en el bloqueo (ver ADR-011).
        'bloquea_aprobacion', v_hueco_cobertura,
        'divergencia_totalh_pct', v_divergencia_totalh_pct
    );
END;
$$;

-- Soporta el join real (EUDR_USO_SUELO.id_parcela = EUDR_MONITOREO.qfield_relation_id)
-- como patrón de consulta permanente a partir de ahora, no solo del backfill puntual de ADR-010.
CREATE INDEX IF NOT EXISTS idx_eudr_uso_suelo_id_parcela
    ON public."EUDR_USO_SUELO" (id_parcela);

COMMIT;
