-- MIGRACIÓN IDEMPOTENTE (NO APLICADA TODAVÍA -- pendiente de revisión).
--
-- Fix "cert_org_estatus desactualizado" (ver AI_STATE.md, entradas
-- "Fix cert_org_estatus desactualizado" y su ampliación -- Parte A ya
-- implementada y testeada en lib/actions/sociosActions.js, sin SQL).
-- Cubre 2 hallazgos sobre fn_listar_padron_socios (ADR-031, fase 1 del
-- incidente, SECURITY DEFINER), los dos con la misma causa raíz:
--
-- (1) cert_org_estatus -- devuelve HOY `s.cert_org_estatus` directo de
--     PADRON_SOCIOS, columna CONGELADA desde ADR-027 (socioPayload() ya
--     no la escribe). El valor real vive en SOCIO_CERTIFICACIONES.estado
--     (las 5 certificaciones de equivalencia orgánica, ORGANIC_CERT_CODES:
--     NOP_USDA/UE_2018_848/COR_CANADA/DS_0442006_AG/LPO_MX -- verificados
--     estos 5 códigos contra lib/validations/socios.js Y contra una
--     consulta real a CERTIFICACIONES_CATALOGO (activo=true) antes de
--     tocar este archivo, ver AI_STATE.md -- sin discrepancia, los 5
--     están, activos, mismo string exacto).
-- (2) Los 8 flags (cert_nop_usda/ue_2018_848/cor_canada/cert_ds_0442006_ag/
--     cert_lpo_mx/cert_rainforest/cert_comercio_justo/cert_fair_trade_usa)
--     -- mismo defecto: columnas congeladas de PADRON_SOCIOS. El filtro
--     p_cert_flags (botones "NOP USDA"/"UE 2018/848"/etc. de
--     /dashboard/socios) también compara contra esas mismas columnas
--     congeladas, así que el filtro por certificación da resultados
--     desactualizados. Criterio correcto para los 8 flags: PRESENCIA --
--     ¿existe una fila en SOCIO_CERTIFICACIONES para ese id_socio +
--     código, sin importar `estado`? (mismo criterio que ya usa
--     resolveSocioCertFlags en JS, lib/actions/sociosActions.js).
--
-- Esto afecta tanto lo que se ve en pantalla (columna "CERTIFICACIÓN" +
-- las 8 columnas internas) como los 2 filtros de la misma pantalla
-- (p_cert_org_estatus, los botones de certificación / p_cert_flags) --
-- dejar cualquiera de los filtros comparando contra el valor viejo
-- mientras la columna visible ya muestra el valor real habría dejado la
-- función internamente inconsistente, así que los 2 pares (columna +
-- filtro) quedan corregidos juntos acá.
--
-- Criterio de cert_org_estatus (idéntico a fetchSocioCertOrgEstatus,
-- lib/padronCsv.js, ya usado por exportSociosCsv y por
-- resolveSocioCertFlags): de las filas de SOCIO_CERTIFICACIONES del
-- socio cuya certificación sea una de las 5 orgánicas Y tengan `estado`
-- no nulo, se usa la MÁS RECIENTE por `actualizado_en`. Nota:
-- `syncSocioCertificaciones` siempre escribe el mismo `estado` a las 5
-- filas orgánicas en la misma operación (borrar-todo-y-reinsertar), así
-- que en el caso normal las 5 coinciden y "la más reciente" es
-- trivialmente ese mismo valor -- por eso "más reciente" alcanza para
-- replicar el criterio completo de fetchSocioCertOrgEstatus (incluida
-- su rama de divergencia, que en JS solo agrega un console.warn
-- informativo, no cambia el valor devuelto) sin necesitar 2 ramas
-- separadas en SQL. Si no hay ninguna fila (0 certificaciones orgánicas
-- activas), COALESCE a '' -- mismo default que fetchSocioCertOrgEstatus,
-- no NULL.
--
-- Implementación: 2 LEFT JOIN LATERAL (uno por hallazgo, cada uno
-- calculado 1 vez por fila y reusado tanto en el SELECT como en el
-- WHERE -- no duplicado como subquery repetida):
--   - cert_real: la fila de estado orgánico más reciente (hallazgo 1).
--   - owned: array_agg de TODOS los códigos con una fila en
--     SOCIO_CERTIFICACIONES para ese socio, sin filtrar por estado
--     (hallazgo 2, PRESENCIA pura -- no reutiliza cert_real porque ese
--     ya viene filtrado a las 5 orgánicas Y a estado no nulo, dos
--     filtros que NO aplican acá).
--
-- Caso de prueba real verificado hoy (solo lectura, sin escribir nada
-- -- ver AI_STATE.md 2026-09-01r para el detalle completo, incluida la
-- corrección de una verificación previa incompleta en 2026-09-01p):
-- COOP-AROMAS-VALLE-002 (ABEL AGUILAR GUEVARA, DNI 44102527) tiene 7
-- filas reales en SOCIO_CERTIFICACIONES -- las 5 orgánicas
-- (NOP_USDA/UE_2018_848/COR_CANADA/DS_0442006_AG/LPO_MX, estado='E') más
-- COMERCIO_JUSTO y FAIR_TRADE_USA (estado=NULL pero presentes -- una
-- fila con estado NULL sigue contando como presente para el criterio de
-- los 8 flags). No existe fila para RAINFOREST. Esperado tras aplicar:
-- cert_nop_usda = Sí, ue_2018_848 = Sí, cor_canada = Sí,
-- cert_ds_0442006_ag = Sí, cert_lpo_mx = Sí, cert_rainforest = No,
-- cert_comercio_justo = Sí, cert_fair_trade_usa = Sí,
-- cert_org_estatus = 'E'.
--
-- RETURNS TABLE no cambia de forma ni de tipos (mismas columnas, mismo
-- orden, las 8 columnas de certificación y cert_org_estatus siguen
-- siendo text) -- CREATE OR REPLACE FUNCTION es válido acá, a
-- diferencia del hotfix de fase 1 (20260901161000_...sql), que sí
-- necesitó DROP+CREATE por cambiar el tipo de 2 columnas (date, no
-- text). Postgres preserva ownership/privilegios en un REPLACE que no
-- cambia la firma de retorno -- comportamiento documentado, pero esta
-- migración igual REDECLARA el REVOKE/GRANT explícito acá abajo (no se
-- asume sin volver a declararlo). Verificación empírica real: el test
-- ya existente "EXECUTE de fn_listar_padron_socios está revocado para
-- anon" (tests/test_padron_read_functions_live.mjs) prueba contra la
-- función tal cual esté aplicada en cada corrida -- no está gateado a
-- esta migración en particular, así que vuelve a correr solo (y
-- confirma o refuta el REVOKE) en cuanto esto se aplique, sin tocar ese
-- archivo de test.

BEGIN;

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
    s.socio_distrito, s.localidad, s.certificaciones,
    COALESCE(cert_real.estado, '') AS cert_org_estatus,
    CASE WHEN 'NOP_USDA' = ANY(owned.codigos) THEN 'Sí' ELSE 'No' END AS cert_nop_usda,
    CASE WHEN 'UE_2018_848' = ANY(owned.codigos) THEN 'Sí' ELSE 'No' END AS ue_2018_848,
    CASE WHEN 'COR_CANADA' = ANY(owned.codigos) THEN 'Sí' ELSE 'No' END AS cor_canada,
    CASE WHEN 'DS_0442006_AG' = ANY(owned.codigos) THEN 'Sí' ELSE 'No' END AS cert_ds_0442006_ag,
    CASE WHEN 'LPO_MX' = ANY(owned.codigos) THEN 'Sí' ELSE 'No' END AS cert_lpo_mx,
    CASE WHEN 'RAINFOREST' = ANY(owned.codigos) THEN 'Sí' ELSE 'No' END AS cert_rainforest,
    CASE WHEN 'COMERCIO_JUSTO' = ANY(owned.codigos) THEN 'Sí' ELSE 'No' END AS cert_comercio_justo,
    CASE WHEN 'FAIR_TRADE_USA' = ANY(owned.codigos) THEN 'Sí' ELSE 'No' END AS cert_fair_trade_usa,
    s.socio_fecha_ingreso, s.activo,
    COUNT(*) OVER() AS total_count
  FROM public."PADRON_SOCIOS" s
  LEFT JOIN LATERAL (
    SELECT sc.estado
    FROM public."SOCIO_CERTIFICACIONES" sc
    JOIN public."CERTIFICACIONES_CATALOGO" cc ON cc.id = sc.id_certificacion
    WHERE sc.id_socio = s.id
      AND cc.codigo IN ('NOP_USDA', 'UE_2018_848', 'COR_CANADA', 'DS_0442006_AG', 'LPO_MX')
      AND sc.estado IS NOT NULL
    ORDER BY sc.actualizado_en DESC
    LIMIT 1
  ) cert_real ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(cc.codigo) AS codigos
    FROM public."SOCIO_CERTIFICACIONES" sc
    JOIN public."CERTIFICACIONES_CATALOGO" cc ON cc.id = sc.id_certificacion
    WHERE sc.id_socio = s.id
  ) owned ON true
  WHERE s."ID_Organizacion" = p_organizacion
    AND s.activo = true
    AND (p_search IS NULL OR p_search = '' OR (
      s.socio_nombre_completo ILIKE '%' || p_search || '%'
      OR s.socio_dni ILIKE '%' || p_search || '%'
      OR s.codigo_finca ILIKE '%' || p_search || '%'
      OR s."ID_Socio" ILIKE '%' || p_search || '%'
    ))
    AND (p_cert_org_estatus IS NULL OR p_cert_org_estatus = '' OR COALESCE(cert_real.estado, '') = p_cert_org_estatus)
    AND (p_departamento IS NULL OR p_departamento = '' OR s.socio_departamento = p_departamento)
    AND (p_cert_flags IS NULL OR (
      (NOT ('cert_nop_usda' = ANY(p_cert_flags)) OR 'NOP_USDA' = ANY(owned.codigos))
      AND (NOT ('ue_2018_848' = ANY(p_cert_flags)) OR 'UE_2018_848' = ANY(owned.codigos))
      AND (NOT ('cor_canada' = ANY(p_cert_flags)) OR 'COR_CANADA' = ANY(owned.codigos))
      AND (NOT ('cert_ds_0442006_ag' = ANY(p_cert_flags)) OR 'DS_0442006_AG' = ANY(owned.codigos))
      AND (NOT ('cert_lpo_mx' = ANY(p_cert_flags)) OR 'LPO_MX' = ANY(owned.codigos))
      AND (NOT ('cert_rainforest' = ANY(p_cert_flags)) OR 'RAINFOREST' = ANY(owned.codigos))
      AND (NOT ('cert_comercio_justo' = ANY(p_cert_flags)) OR 'COMERCIO_JUSTO' = ANY(owned.codigos))
      AND (NOT ('cert_fair_trade_usa' = ANY(p_cert_flags)) OR 'FAIR_TRADE_USA' = ANY(owned.codigos))
    ))
  ORDER BY s.socio_nombre_completo
  LIMIT p_page_size OFFSET (p_page * p_page_size);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_listar_padron_socios(text, text, text, text, text[], int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_listar_padron_socios(text, text, text, text, text[], int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_listar_padron_socios(text, text, text, text, text[], int, int) TO service_role;

COMMIT;
