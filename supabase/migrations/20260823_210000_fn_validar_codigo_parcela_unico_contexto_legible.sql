-- MIGRACIÓN IDEMPOTENTE: agrega contexto legible (fecha_monitoreo,
-- tecnico_responsable) a cada registro de registros_en_conflicto que ya
-- devuelve fn_validar_codigo_parcela_unico — ver
-- docs/adr/ADR-014-codigo-parcela-unico-por-ubicacion.md.
--
-- MOTIVO: el mensaje de bloqueo que ve el revisor en la Consola QC
-- (lib/qcCodigoParcelaUnico.js::buildConflictoParcelaMensaje) mostraba el
-- id_monitoreo crudo (un UUID) del otro registro en conflicto — un
-- identificador técnico sin significado para alguien no técnico. Se
-- reemplaza, en el mensaje, por la fecha de captura y el técnico
-- responsable del otro registro (datos que sí existen y ya se cargan
-- desde QField, ver scripts/etl_drive_to_supabase.py::build_monitoreo_payload)
-- — el id_monitoreo real sigue disponible en la respuesta de la RPC (no se
-- quita, sigue siendo útil para quien resuelva el conflicto directamente en
-- la base), simplemente ya no se usa para armar el texto que ve el usuario.
--
-- Mismo umbral, misma lógica de detección — CREATE OR REPLACE únicamente
-- para agregar 2 campos al jsonb_build_object de cada registro en conflicto.

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
    --
    -- fecha_monitoreo/tecnico_responsable: contexto legible para el
    -- mensaje que ve el revisor (ver motivo arriba) — id_monitoreo se
    -- mantiene en la respuesta (útil para resolver el conflicto en la
    -- base), solo dejó de usarse en el texto del mensaje.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_monitoreo', m.id_monitoreo,
        'distancia_m', ROUND(ST_Distance(
            ST_Centroid(v_geom)::geography,
            ST_Centroid(m.geom_inspeccion)::geography
        )::numeric, 2),
        'estado_revision', m.estado_revision,
        'fecha_monitoreo', m.fecha_monitoreo,
        'tecnico_responsable', m.tecnico_responsable
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
