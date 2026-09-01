-- HOTFIX -- corrige un bug real encontrado corriendo
-- tests/test_padron_read_functions_live.mjs contra la instancia real
-- recién aplicada (20260901160000_lecturas_padron_security_definer.sql):
-- `fn_listar_padron_socios` declaraba `socio_fecha_nacimiento`/
-- `socio_fecha_ingreso` como `text` en su RETURNS TABLE -- el tipo real
-- de esas 2 columnas en PADRON_SOCIOS es `date` (confirmado contra el
-- OpenAPI de PostgREST, `format: "date"`), no `text`. Toda llamada real
-- a la función fallaba con:
--   {"code":"42804","message":"structure of query does not match
--   function result type","details":"Returned type date does not match
--   expected type text in column 7."}
-- Las otras 9 funciones de la migración no tocan estas 2 columnas --
-- confirmado cruzando el resto de los tipos declarados contra el schema
-- real completo de PADRON_SOCIOS/PADRON_PARCELAS (OpenAPI de PostgREST),
-- sin más discrepancias.
--
-- No se puede corregir con CREATE OR REPLACE FUNCTION -- Postgres no
-- permite cambiar el tipo de una columna de RETURNS TABLE con REPLACE
-- ("cannot change return type of existing function"), hace falta DROP +
-- CREATE. Un DROP resetea los privilegios a los defaults de Postgres
-- (EXECUTE a PUBLIC) -- por eso el REVOKE/GRANT se repite acá completo,
-- no se puede asumir que sigue vigente del CREATE original.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_listar_padron_socios(text, text, text, text, text[], int, int);

CREATE FUNCTION public.fn_listar_padron_socios(
  p_organizacion text,
  p_search text DEFAULT NULL,
  p_cert_org_estatus text DEFAULT NULL,
  p_departamento text DEFAULT NULL,
  p_cert_flags text[] DEFAULT NULL,
  p_page int DEFAULT 0,
  p_page_size int DEFAULT 15
)
RETURNS TABLE (
  "ID_Socio" text, "ID_Organizacion" text, codigo_finca text, socio_nombre_completo text,
  socio_dni text, socio_genero text, socio_fecha_nacimiento date, celular_socio text,
  conyuge_nombre text, conyuge_dni text, socio_departamento text, socio_provincia text,
  socio_distrito text, localidad text, certificaciones text, cert_org_estatus text,
  cert_nop_usda text, ue_2018_848 text, cor_canada text, cert_ds_0442006_ag text,
  cert_lpo_mx text, cert_rainforest text, cert_comercio_justo text, cert_fair_trade_usa text,
  socio_fecha_ingreso date, activo boolean, total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' THEN
    RAISE EXCEPTION 'No se pudo determinar la organización activa.';
  END IF;

  RETURN QUERY
  SELECT
    s."ID_Socio", s."ID_Organizacion", s.codigo_finca, s.socio_nombre_completo,
    s.socio_dni, s.socio_genero, s.socio_fecha_nacimiento, s.celular_socio,
    s.conyuge_nombre, s.conyuge_dni, s.socio_departamento, s.socio_provincia,
    s.socio_distrito, s.localidad, s.certificaciones, s.cert_org_estatus,
    s.cert_nop_usda, s.ue_2018_848, s.cor_canada, s.cert_ds_0442006_ag,
    s.cert_lpo_mx, s.cert_rainforest, s.cert_comercio_justo, s.cert_fair_trade_usa,
    s.socio_fecha_ingreso, s.activo,
    COUNT(*) OVER() AS total_count
  FROM public."PADRON_SOCIOS" s
  WHERE s."ID_Organizacion" = p_organizacion
    AND s.activo = true
    AND (p_search IS NULL OR p_search = '' OR (
      s.socio_nombre_completo ILIKE '%' || p_search || '%'
      OR s.socio_dni ILIKE '%' || p_search || '%'
      OR s.codigo_finca ILIKE '%' || p_search || '%'
      OR s."ID_Socio" ILIKE '%' || p_search || '%'
    ))
    AND (p_cert_org_estatus IS NULL OR p_cert_org_estatus = '' OR s.cert_org_estatus = p_cert_org_estatus)
    AND (p_departamento IS NULL OR p_departamento = '' OR s.socio_departamento = p_departamento)
    AND (p_cert_flags IS NULL OR (
      (NOT ('cert_nop_usda' = ANY(p_cert_flags)) OR s.cert_nop_usda = 'Sí')
      AND (NOT ('ue_2018_848' = ANY(p_cert_flags)) OR s.ue_2018_848 = 'Sí')
      AND (NOT ('cor_canada' = ANY(p_cert_flags)) OR s.cor_canada = 'Sí')
      AND (NOT ('cert_ds_0442006_ag' = ANY(p_cert_flags)) OR s.cert_ds_0442006_ag = 'Sí')
      AND (NOT ('cert_lpo_mx' = ANY(p_cert_flags)) OR s.cert_lpo_mx = 'Sí')
      AND (NOT ('cert_rainforest' = ANY(p_cert_flags)) OR s.cert_rainforest = 'Sí')
      AND (NOT ('cert_comercio_justo' = ANY(p_cert_flags)) OR s.cert_comercio_justo = 'Sí')
      AND (NOT ('cert_fair_trade_usa' = ANY(p_cert_flags)) OR s.cert_fair_trade_usa = 'Sí')
    ))
  ORDER BY s.socio_nombre_completo
  LIMIT p_page_size OFFSET (p_page * p_page_size);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_listar_padron_socios(text, text, text, text, text[], int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_listar_padron_socios(text, text, text, text, text[], int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_listar_padron_socios(text, text, text, text, text[], int, int) TO service_role;

COMMIT;
