-- MIGRACIÓN IDEMPOTENTE (NO APLICADA TODAVÍA — pendiente de revisión del
-- arquitecto, ver AI_STATE.md entrada "Reemplazo SECURITY DEFINER para
-- lecturas de PADRON_SOCIOS/PADRON_PARCELAS").
--
-- Reemplaza los 6 caminos de lectura que hoy dependen de que `anon`
-- pueda leer PADRON_SOCIOS/PADRON_PARCELAS directo (RLS efectivamente
-- sin restricción, ver AI_STATE.md 2026-09-01g/h) por funciones
-- SECURITY DEFINER parametrizadas por organización, y en la MISMA
-- transacción bloquea el SELECT `anon` directo sobre esas 2 tablas
-- (USING (false)) -- el reemplazo y el cierre del hueco viajan juntos,
-- nunca uno sin el otro (pedido explícito de la tarea).
--
-- Mismo patrón que fn_crear_socio_con_certificaciones
-- (20260901120000_socio_creacion_atomica.sql), con la corrección de
-- seguridad ya aplicada ahí desde el día uno acá: SECURITY DEFINER +
-- SET search_path = public (mismo patrón que las funciones SECURITY
-- DEFINER preexistentes del proyecto, ej. 20260815_fase1_security_storage.sql)
-- + REVOKE EXECUTE explícito de PUBLIC/anon/authenticated + GRANT
-- únicamente a service_role. A diferencia de fn_crear_socio_con_certificaciones
-- (que SOLO se llama con Service Role Key desde una Server Action), estas
-- SÍ necesitan SECURITY DEFINER: se siguen invocando en última instancia
-- desde componentes que hoy corren en el navegador, pero el GRANT a
-- service_role únicamente obliga a que esa invocación pase primero por
-- una Server Action (Service Role Key) -- el navegador nunca llama a
-- estas funciones directo con la llave `anon`, exactamente igual que ya
-- no puede insertar directo en PADRON_SOCIOS. Ver lib/actions/padronReadActions.js
-- (código nuevo de esta misma tarea) para las Server Actions que las
-- envuelven.
--
-- SECURITY DEFINER corre con los privilegios del DUEÑO de la función
-- (quien la crea, típicamente `postgres` en Supabase), no con los del
-- llamador -- por eso puede leer PADRON_SOCIOS/PADRON_PARCELAS aunque la
-- política `anon`/`authenticated` sea USING(false)/no exista. El único
-- filtro real de aislamiento multi-tenant es el `WHERE ..._Organizacion
-- = p_organizacion` explícito dentro de cada función -- no hay ninguna
-- otra barrera una vez que se entra a la función, así que cada una
-- filtra por organización en la primera cláusula de su WHERE, sin
-- excepción.

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- 1. fn_listar_padron_socios — reemplaza lib/sociosSearch.js::fetchSocios
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_listar_padron_socios(
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
  socio_dni text, socio_genero text, socio_fecha_nacimiento text, celular_socio text,
  conyuge_nombre text, conyuge_dni text, socio_departamento text, socio_provincia text,
  socio_distrito text, localidad text, certificaciones text, cert_org_estatus text,
  cert_nop_usda text, ue_2018_848 text, cor_canada text, cert_ds_0442006_ag text,
  cert_lpo_mx text, cert_rainforest text, cert_comercio_justo text, cert_fair_trade_usa text,
  socio_fecha_ingreso text, activo boolean, total_count bigint
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

-- ════════════════════════════════════════════════════════════════════
-- 2. fn_listar_padron_parcelas_por_socio — reemplaza fetchParcelasBySocio
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_listar_padron_parcelas_por_socio(
  p_organizacion text,
  p_socio_id text
)
RETURNS TABLE (
  "ID_Parcela_Fija" text, "ID_Organizacion" text, "ID_Socio" text, parcela_codigo text,
  parcela_nombre text, hcp numeric, hcc numeric, ho numeric, hip numeric, hrp numeric,
  hbp numeric, otros_cultivo numeric, totalh numeric, geom geometry, activo boolean,
  id_producto_predominante uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' OR p_socio_id IS NULL OR p_socio_id = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p."ID_Parcela_Fija", p."ID_Organizacion", p."ID_Socio", p.parcela_codigo,
    p.parcela_nombre, p.hcp, p.hcc, p.ho, p.hip, p.hrp, p.hbp, p.otros_cultivo,
    p.totalh, p.geom, p.activo, p.id_producto_predominante
  FROM public."PADRON_PARCELAS" p
  WHERE p."ID_Organizacion" = p_organizacion
    AND p."ID_Socio" = p_socio_id
    AND p.activo = true
  ORDER BY p.parcela_codigo;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_listar_padron_parcelas_por_socio(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_listar_padron_parcelas_por_socio(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_listar_padron_parcelas_por_socio(text, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 3-4. Autocompletado de Inspecciones — reemplaza lib/padronSearch.js
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_buscar_padron_socios(
  p_organizacion text,
  p_query text
)
RETURNS TABLE (
  "ID_Socio" text, "ID_Organizacion" text, codigo_finca text, socio_nombre_completo text, socio_dni text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' OR p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s."ID_Socio", s."ID_Organizacion", s.codigo_finca, s.socio_nombre_completo, s.socio_dni
  FROM public."PADRON_SOCIOS" s
  WHERE s."ID_Organizacion" = p_organizacion
    AND s.activo = true
    AND (
      s.socio_nombre_completo ILIKE '%' || trim(p_query) || '%'
      OR s.socio_dni ILIKE '%' || trim(p_query) || '%'
      OR s.codigo_finca ILIKE '%' || trim(p_query) || '%'
    )
  LIMIT 8;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_buscar_padron_socios(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_buscar_padron_socios(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_buscar_padron_socios(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_buscar_padron_parcelas(
  p_organizacion text,
  p_socio_id text DEFAULT NULL,
  p_query text DEFAULT NULL
)
RETURNS TABLE (
  "ID_Parcela_Fija" text, "ID_Organizacion" text, "ID_Socio" text, parcela_codigo text,
  parcela_nombre text, totalh numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p."ID_Parcela_Fija", p."ID_Organizacion", p."ID_Socio", p.parcela_codigo, p.parcela_nombre, p.totalh
  FROM public."PADRON_PARCELAS" p
  WHERE p."ID_Organizacion" = p_organizacion
    AND p.activo = true
    AND (p_socio_id IS NULL OR p."ID_Socio" = p_socio_id)
    AND (p_query IS NULL OR length(trim(p_query)) < 2 OR (
      p.parcela_codigo ILIKE '%' || trim(p_query) || '%'
      OR p.parcela_nombre ILIKE '%' || trim(p_query) || '%'
    ))
  LIMIT 8;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_buscar_padron_parcelas(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_buscar_padron_parcelas(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_buscar_padron_parcelas(text, text, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 5-6. Detección de duplicados en preview de importación CSV — reemplaza
-- applySocioDbChecks/applyParcelaDbChecks (lib/padronCsv.js)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_padron_socios_existentes(
  p_organizacion text,
  p_id_socios text[] DEFAULT '{}',
  p_dnis text[] DEFAULT '{}',
  p_codigos_finca text[] DEFAULT '{}'
)
RETURNS TABLE ("ID_Socio" text, socio_dni text, codigo_finca text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s."ID_Socio", s.socio_dni, s.codigo_finca
  FROM public."PADRON_SOCIOS" s
  WHERE s."ID_Organizacion" = p_organizacion
    AND (
      s."ID_Socio" = ANY(p_id_socios)
      OR s.socio_dni = ANY(p_dnis)
      OR s.codigo_finca = ANY(p_codigos_finca)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_padron_socios_existentes(text, text[], text[], text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_padron_socios_existentes(text, text[], text[], text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_padron_socios_existentes(text, text[], text[], text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_padron_parcelas_existentes(
  p_organizacion text,
  p_ids text[] DEFAULT '{}',
  p_codigos text[] DEFAULT '{}'
)
RETURNS TABLE ("ID_Parcela_Fija" text, parcela_codigo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p."ID_Parcela_Fija", p.parcela_codigo
  FROM public."PADRON_PARCELAS" p
  WHERE p."ID_Organizacion" = p_organizacion
    AND (
      p."ID_Parcela_Fija" = ANY(p_ids)
      OR p.parcela_codigo = ANY(p_codigos)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_padron_parcelas_existentes(text, text[], text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_padron_parcelas_existentes(text, text[], text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_padron_parcelas_existentes(text, text[], text[]) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- Plantilla de socios/parcelas — reemplaza fetchSampleSocioIds/
-- fetchExistingCodes (lib/padronCsv.js)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_padron_socios_ids_todos(p_organizacion text)
RETURNS TABLE ("ID_Socio" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s."ID_Socio" FROM public."PADRON_SOCIOS" s WHERE s."ID_Organizacion" = p_organizacion;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_padron_socios_ids_todos(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_padron_socios_ids_todos(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_padron_socios_ids_todos(text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_padron_socios_sample_activos(p_organizacion text, p_limit int DEFAULT 2)
RETURNS TABLE ("ID_Socio" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s."ID_Socio" FROM public."PADRON_SOCIOS" s
  WHERE s."ID_Organizacion" = p_organizacion AND s.activo = true
  ORDER BY s."ID_Socio"
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_padron_socios_sample_activos(text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_padron_socios_sample_activos(text, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_padron_socios_sample_activos(text, int) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_padron_parcelas_codigos_e_ids(p_organizacion text)
RETURNS TABLE (parcela_codigo text, "ID_Parcela_Fija" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.parcela_codigo, p."ID_Parcela_Fija" FROM public."PADRON_PARCELAS" p
  WHERE p."ID_Organizacion" = p_organizacion;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_padron_parcelas_codigos_e_ids(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_padron_parcelas_codigos_e_ids(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_padron_parcelas_codigos_e_ids(text) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 10. Enriquecimiento de código/nombre de parcela en Consola QC —
-- reemplaza enrichWithParcelaInfo (lib/eudrQcActions.js)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_enriquecer_parcela_qc(p_organizacion text, p_ids text[])
RETURNS TABLE ("ID_Parcela_Fija" text, parcela_codigo text, parcela_nombre text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' OR p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p."ID_Parcela_Fija", p.parcela_codigo, p.parcela_nombre
  FROM public."PADRON_PARCELAS" p
  WHERE p."ID_Organizacion" = p_organizacion
    AND p."ID_Parcela_Fija" = ANY(p_ids);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_enriquecer_parcela_qc(text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_enriquecer_parcela_qc(text, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_enriquecer_parcela_qc(text, text[]) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 11. Lockdown — SELECT anon de PADRON_SOCIOS/PADRON_PARCELAS a USING(false).
-- Diseñado en AI_STATE.md 2026-09-01h, aplicado acá en la MISMA
-- transacción que el reemplazo -- nunca uno sin el otro.
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rls_anon_select_padron_socios"   ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "rls_anon_select_padron_parcelas" ON public."PADRON_PARCELAS";

CREATE POLICY "rls_anon_select_padron_socios" ON public."PADRON_SOCIOS"
FOR SELECT TO anon
USING (false);

CREATE POLICY "rls_anon_select_padron_parcelas" ON public."PADRON_PARCELAS"
FOR SELECT TO anon
USING (false);

COMMIT;
