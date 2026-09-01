-- MIGRACIÓN IDEMPOTENTE (NO APLICADA TODAVÍA — pendiente de revisión).
-- Restaura exportSociosCsv/exportParcelasCsv (lib/padronCsv.js), que
-- quedaron devolviendo CSV vacío tras el lockdown de
-- 20260901160000_lecturas_padron_security_definer.sql (ADR-031, fase 1
-- del incidente) -- esas 2 funciones consultaban PADRON_SOCIOS/
-- PADRON_PARCELAS directo con `anon`, camino que ya está cerrado
-- (`USING (false)`), y a diferencia de los 6 caminos de la fase 1, no
-- estaban en el alcance de esa tarea.
--
-- Mismo patrón exacto que la fase 1: SECURITY DEFINER + SET search_path
-- = public + REVOKE EXECUTE explícito de PUBLIC/anon/authenticated +
-- GRANT único a service_role, consumidas vía
-- lib/actions/padronReadActions.js (Server Actions, nunca directo desde
-- el navegador). DROP FUNCTION IF EXISTS antes de CREATE (no
-- CREATE OR REPLACE) -- mismo motivo que el hotfix de la fase 1: si en
-- el futuro cambia el RETURNS TABLE, REPLACE no permite cambiar el tipo
-- de una columna, así que se usa DROP+CREATE desde el principio acá
-- para no repetir ese problema.
--
-- CONTRATO REAL (verificado leyendo el código actual de
-- exportSociosCsv/exportParcelasCsv, no asumido -- ver AI_STATE.md
-- 2026-09-01m para el detalle completo): ninguna de las 2 funciones
-- originales respeta ningún filtro de la UI (búsqueda/departamento/
-- certOrgEstatus/certFlags) -- exportan SIEMPRE el padrón activo
-- completo de la organización. Por eso estas 2 funciones nuevas NO
-- tienen parámetros de filtro, solo `p_organizacion`. Las columnas que
-- devuelven son las que exportSociosCsv/exportParcelasCsv REALMENTE
-- seleccionaban (SOCIO_EXPORT_COLUMNS/PARCELA_EXPORT_COLUMNS de
-- lib/padronCsv.js) -- un subconjunto MÁS CHICO que
-- fn_listar_padron_socios/fn_listar_padron_parcelas_por_socio (fase 1),
-- no una copia de esas con una columna menos. `socio_fecha_nacimiento`/
-- `socio_fecha_ingreso` van como `date` desde el principio (no `text`)
-- -- lección aprendida del hotfix 20260901161000 de la fase 1.

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- fn_exportar_padron_socios — reemplaza la 1ra consulta de
-- lib/padronCsv.js::exportSociosCsv (el resto de esa función -- el
-- enriquecimiento con SOCIO_CERTIFICACIONES/fetchActiveCertificaciones/
-- fetchSocioCertOrgEstatus -- sigue igual, esas tablas no fueron parte
-- del lockdown de la fase 1).
-- ════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.fn_exportar_padron_socios(text);

CREATE FUNCTION public.fn_exportar_padron_socios(p_organizacion text)
RETURNS TABLE (
  "ID_Socio" text, "ID_Organizacion" text, codigo_finca text, socio_nombre_completo text,
  socio_dni text, socio_genero text, socio_fecha_nacimiento date, celular_socio text,
  socio_departamento text, socio_provincia text, socio_distrito text, localidad text,
  socio_fecha_ingreso date, cert_org_estatus text, id uuid
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
    s.socio_departamento, s.socio_provincia, s.socio_distrito, s.localidad,
    s.socio_fecha_ingreso, s.cert_org_estatus, s.id
  FROM public."PADRON_SOCIOS" s
  WHERE s."ID_Organizacion" = p_organizacion
    AND s.activo = true
  ORDER BY s.socio_nombre_completo;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_exportar_padron_socios(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_exportar_padron_socios(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_exportar_padron_socios(text) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- fn_exportar_padron_parcelas — reemplaza
-- lib/padronCsv.js::exportParcelasCsv por completo (esa función no
-- tiene ningún paso posterior). A diferencia de
-- fn_listar_padron_parcelas_por_socio (fase 1, filtra por
-- p_socio_id), esta cubre TODA la organización -- función nueva, no
-- una reutilización.
-- ════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.fn_exportar_padron_parcelas(text);

CREATE FUNCTION public.fn_exportar_padron_parcelas(p_organizacion text)
RETURNS TABLE (
  "ID_Parcela_Fija" text, "ID_Organizacion" text, "ID_Socio" text, parcela_codigo text,
  parcela_nombre text, hcp numeric, hcc numeric, ho numeric, hip numeric, hrp numeric,
  hbp numeric, otros_cultivo numeric, totalh numeric
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
    p."ID_Parcela_Fija", p."ID_Organizacion", p."ID_Socio", p.parcela_codigo,
    p.parcela_nombre, p.hcp, p.hcc, p.ho, p.hip, p.hrp, p.hbp, p.otros_cultivo, p.totalh
  FROM public."PADRON_PARCELAS" p
  WHERE p."ID_Organizacion" = p_organizacion
    AND p.activo = true
  ORDER BY p.parcela_codigo;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_exportar_padron_parcelas(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_exportar_padron_parcelas(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_exportar_padron_parcelas(text) TO service_role;

COMMIT;
