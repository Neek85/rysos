-- MIGRACIÓN IDEMPOTENTE: usa la variable implícita FOUND de PL/pgSQL en
-- vez de `v_geom IS NULL` para distinguir "el registro no existe" de "el
-- registro existe pero geom_inspeccion es NULL".
--
-- BUG REAL YA DOCUMENTADO (AI_STATE.md, 2026-09-08, hallazgo incidental
-- del smoke test de Fase D Paso 2 -- "sigue sin corregir, fuera de
-- alcance de este fix" en esa tarea): `fn_validar_codigo_parcela_unico`
-- (supabase/migrations/20260823_210000_fn_validar_codigo_parcela_unico_contexto_legible.sql,
-- línea 38) usaba la variable de geometría vacía como proxy de "no
-- encontrado" -- pero `geom_inspeccion` puede ser NULL en un
-- EUDR_MONITOREO real que sí existe (confirmado insertando uno en esa
-- tarea), así que un monitoreo real sin geometría capturada todavía
-- (ej. un registro de campo QField sin geom_inspeccion cargado) hacía
-- fallar "Aprobar"/"Rechazar" con un mensaje que apuntaba a la causa
-- equivocada -- mismo patrón de bug ya visto y corregido en ADR-015
-- (`id_origen` ausente confundido con "migración sin aplicar").
--
-- `FOUND` es la forma correcta en PL/pgSQL: la pone TRUE/FALSE el
-- último SELECT INTO según si devolvió alguna fila, sin importar el
-- valor de las columnas seleccionadas -- distingue exactamente "0 filas"
-- de "1 fila con columnas NULL".
--
-- CREATE OR REPLACE sobre la definición vigente hoy (la de
-- 20260823_210000_..._contexto_legible.sql, que agregó fecha_monitoreo/
-- tecnico_responsable) -- misma firma, mismo umbral, misma lógica de
-- detección de conflicto, mismo shape de respuesta. Único cambio: el
-- chequeo de "no encontrado".

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

    IF NOT FOUND THEN
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
    -- mensaje que ve el revisor — id_monitoreo se mantiene en la
    -- respuesta (útil para resolver el conflicto en la base), solo dejó
    -- de usarse en el texto del mensaje.
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
