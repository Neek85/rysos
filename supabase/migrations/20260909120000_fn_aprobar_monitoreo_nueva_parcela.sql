-- MIGRACIÓN IDEMPOTENTE: alta atómica de PADRON_PARCELAS + asignación de
-- ID_Parcela_Fija al aprobar en la Consola QC un EUDR_MONITOREO capturado
-- en campo (QField) que todavía no tiene código de parcela asignado.
-- Ver spec: specs/asignacion_automatica_codigo_parcela.md.
--
-- CONTEXTO: lib/eudrQcActions.js::approveRecord hacía un único UPDATE
-- sobre EUDR_MONITOREO. Cuando el monitoreo aprobado es una parcela nueva
-- (ID_Parcela_Fija NULO), la lógica de negocio ahora necesita además dar
-- de alta la fila correspondiente en PADRON_PARCELAS -- dos escrituras que
-- deben ser atómicas (un corte a mitad de camino no puede dejar el padrón
-- con una fila sin que el monitoreo quede vinculado, ni viceversa). El
-- cliente Supabase-JS de una Server Action no soporta una transacción
-- multi-tabla -- mismo problema y misma solución ya aplicada en
-- fn_crear_socio_con_certificaciones
-- (supabase/migrations/20260901120000_socio_creacion_atomica.sql): una
-- función Postgres que envuelve ambas escrituras en un solo bloque
-- plpgsql, invocada explícitamente desde la Server Action (no un
-- trigger).
--
-- El cálculo del código de parcela (computeNextParcelaCode/
-- computeSuggestedParcelaId, lib/parcelaDefaults.js) sigue viviendo en JS
-- -- esta función solo recibe el código ya calculado (p_id_parcela_fija)
-- y hace las escrituras atómicas + las revalidaciones server-side que no
-- pueden confiarse a un valor de cliente.
--
-- SECURITY INVOKER (no DEFINER): corre con el rol de la sesión real del
-- auditor QC (lib/actions/qcActions.js::approveQcRecord usa
-- createSessionServerClient, no Service Role Key, desde ADR-039/Fase D) --
-- sujeta a rls_write_padron_parcelas (permite INSERT a cualquier
-- authenticated, ver supabase/migrations/20260906220000_enforce_padron_admin_trigger.sql)
-- y a rls_write_eudr_monitoreo + fn_enforce_qc_approval_roles (exige
-- admin/auditor_qc porque este UPDATE sí cambia estado_revision).

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_aprobar_monitoreo_nueva_parcela(
  p_id_monitoreo uuid,
  p_organizacion text,
  p_id_parcela_fija text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  r_monitoreo RECORD;
BEGIN
  IF p_id_parcela_fija IS NULL OR p_id_parcela_fija = '' THEN
    RAISE EXCEPTION 'Falta el código de parcela a asignar.';
  END IF;

  -- Revalidación server-side, defensa en profundidad (mismo criterio que
  -- approveRecord/rejectRecord en lib/eudrQcActions.js): el monitoreo debe
  -- existir, pertenecer a p_organizacion, seguir PENDIENTE y seguir sin
  -- ID_Parcela_Fija -- si otra sesión ya lo aprobó o le asignó código
  -- mientras se calculaba el correlativo en JS, esta función aborta sin
  -- escribir nada en vez de generar un duplicado.
  SELECT id_monitoreo, "ID_Organizacion", "ID_Socio", area_calculada_ha, estado_revision, "ID_Parcela_Fija"
  INTO r_monitoreo
  FROM public."EUDR_MONITOREO"
  WHERE id_monitoreo = p_id_monitoreo
  FOR UPDATE;

  IF r_monitoreo IS NULL THEN
    RAISE EXCEPTION 'Registro % (EUDR_MONITOREO) no encontrado.', p_id_monitoreo;
  END IF;

  IF r_monitoreo."ID_Organizacion" IS DISTINCT FROM p_organizacion THEN
    RAISE EXCEPTION 'Violación multi-tenant: el monitoreo % no pertenece a la organización %.', p_id_monitoreo, p_organizacion;
  END IF;

  IF r_monitoreo.estado_revision IS DISTINCT FROM 'PENDIENTE' THEN
    RAISE EXCEPTION 'No se pudo aprobar: el registro ya no está en estado PENDIENTE, o fue modificado por otra sesión.';
  END IF;

  IF r_monitoreo."ID_Parcela_Fija" IS NOT NULL AND r_monitoreo."ID_Parcela_Fija" != '' THEN
    RAISE EXCEPTION 'El monitoreo % ya tiene un código de parcela asignado (%).', p_id_monitoreo, r_monitoreo."ID_Parcela_Fija";
  END IF;

  IF r_monitoreo."ID_Socio" IS NULL OR r_monitoreo."ID_Socio" = '' THEN
    RAISE EXCEPTION 'El monitoreo % no tiene ID_Socio -- no se puede dar de alta una parcela sin socio.', p_id_monitoreo;
  END IF;

  -- hcc/ho/hip/hrp/hbp/otros_cultivo en 0 (categorías de hectáreas sin
  -- dato todavía, ver ADR-024 para hbp/otros_cultivo); hcp = totalh =
  -- area_calculada_ha del monitoreo aprobado (única superficie conocida
  -- en este punto). hr / id_producto_predominante se dejan sin setear --
  -- ver spec, corrección 3 (sin evidencia de un valor por defecto real).
  INSERT INTO public."PADRON_PARCELAS" (
    "ID_Parcela_Fija", "ID_Organizacion", "ID_Socio",
    hcp, hcc, ho, hip, hrp, hbp, otros_cultivo, totalh
  ) VALUES (
    p_id_parcela_fija, r_monitoreo."ID_Organizacion", r_monitoreo."ID_Socio",
    COALESCE(r_monitoreo.area_calculada_ha, 0), 0, 0, 0, 0, 0, 0, COALESCE(r_monitoreo.area_calculada_ha, 0)
  );

  UPDATE public."EUDR_MONITOREO"
  SET "ID_Parcela_Fija" = p_id_parcela_fija, estado_revision = 'APROBADO'
  WHERE id_monitoreo = p_id_monitoreo;

  RETURN jsonb_build_object('id_monitoreo', p_id_monitoreo, 'id_parcela_fija', p_id_parcela_fija);
END;
$$;

-- CREATE FUNCTION otorga EXECUTE a PUBLIC por defecto -- sin este REVOKE
-- explícito, cualquiera con la llave anon pública (sin sesión, sin
-- ID_Organizacion en su JWT) podría invocar esta RPC directo contra
-- PostgREST. La RLS real de PADRON_PARCELAS/EUDR_MONITOREO (scopeada a
-- `authenticated`) rechazaría igual las escrituras internas, pero
-- depender solo de eso es frágil (mismo razonamiento documentado en
-- fn_crear_socio_con_certificaciones) -- se cierra también la capa de
-- función.
REVOKE EXECUTE ON FUNCTION public.fn_aprobar_monitoreo_nueva_parcela(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_aprobar_monitoreo_nueva_parcela(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_aprobar_monitoreo_nueva_parcela(uuid, text, text) TO authenticated;

COMMIT;
