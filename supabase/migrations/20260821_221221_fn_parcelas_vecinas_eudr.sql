-- MIGRACIÓN IDEMPOTENTE: fn_parcelas_vecinas_eudr — capa de contexto de
-- parcelas vecinas (Monitoreos EUDR APROBADOS dentro de un radio) para la
-- Consola QC (Fase 3, ver docs/adr/ADR-006-capa-contexto-parcelas-vecinas.md).
--
-- CORRECCIÓN DE PREMISAS del contrato original — verificadas contra
-- docs/schema_live.md y contra la instancia real (consulta REST con
-- Service Role Key) antes de escribir esta función, no asumidas:
--
-- 1. `p_organizacion_id` NO es `uuid` — `"ID_Organizacion"` es `text` en
--    todo el schema (códigos como "ORG-COOP-NORTE"), mismo motivo ya
--    corregido en `fn_validar_topologia_eudr`
--    (20260820_fn_validar_topologia_eudr.sql) — la firma original habría
--    fallado en el primer INSERT/SELECT real. Confirmado además con
--    Service Role Key que `ORGANIZACIONES."ID"` (PK real, text — ej.
--    "COOP-JS", "COOP-ND") tampoco es uuid.
-- 2. El filtro de estado NO es `estado = 'APROBADA'` — la columna real es
--    `estado_revision` (no `estado`) y el valor real es `'APROBADO'`
--    (masculino, no `'APROBADA'`) — confirmado en vivo contra
--    `vw_monitoreo_poligonos` (`estado_revision: "APROBADO"` en cada fila
--    real).
-- 3. La columna de geometría de `EUDR_MONITOREO` es `geom_inspeccion`, no
--    `geom` — `geom` es el nombre real en `EUDR_USO_SUELO`/
--    `EUDR_INSTALACIONES`, no en `EUDR_MONITOREO` (ver docs/schema_live.md).
-- 4. La PK real es `id_monitoreo` (uuid — en esto el contrato sí acertó
--    el tipo), no `id` — se alias-ea a `id` en el `RETURN QUERY` para no
--    romper el contrato de nombres pedido, sin renombrar la columna real.
-- 5. El índice GiST (`idx_gist_eudr_monitoreo_geom` sobre `geom_inspeccion`)
--    YA EXISTE desde `20260818_gis_core_sanitization.sql` — se declara
--    igual acá con `IF NOT EXISTS` por idempotencia/defensa, sin asumir
--    que esa migración ya corrió en la instancia real (el resto de esta
--    sesión confirmó repetidamente que las migraciones se aplican
--    manualmente y no siempre en orden).
-- 6. `ORGANIZACIONES.Config` SÍ existe como columna real (confirmado con
--    Service Role Key: `{"ID":"COOP-JS",...,"Config":null,...}`) pero
--    está `NULL` en las 2 organizaciones reales — no hay datos que migrar,
--    el fallback a 500m vive enteramente en la capa de aplicación
--    (Server Action, ver lib/actions/qcActions.js), nunca en SQL.
--
-- NO usa `SECURITY DEFINER` ni `GRANT EXECUTE ... TO anon` — mismo
-- criterio que `fn_validar_topologia_eudr`: se invoca exclusivamente
-- server-side con la Service Role Key (Server Action), que ya bypasea
-- RLS por diseño (ADR-003) — el aislamiento multi-tenant real lo
-- garantiza el filtro explícito por `p_organizacion_id` dentro de la
-- función, resuelto server-side desde un valor ya confiable (nunca
-- expuesto a que el navegador pida datos de otra organización con solo
-- pasar un `p_organizacion_id` distinto vía la anon key).

BEGIN;

-- Índice GiST — ya debería existir (ver corrección de premisa #5), se
-- declara igual con IF NOT EXISTS por idempotencia.
CREATE INDEX IF NOT EXISTS idx_gist_eudr_monitoreo_geom
    ON public."EUDR_MONITOREO" USING GIST (geom_inspeccion);

CREATE OR REPLACE FUNCTION public.fn_parcelas_vecinas_eudr(
    p_organizacion_id text,
    p_geom geometry,
    p_radio_m numeric DEFAULT 500,
    p_excluir_id uuid DEFAULT NULL,
    p_limite integer DEFAULT 25
)
RETURNS TABLE (
    id uuid,
    geom geometry,
    codigo_socio text,
    total_encontrados integer,
    total_devueltos integer
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_total_encontrados integer;
BEGIN
    SELECT COUNT(*) INTO v_total_encontrados
    FROM public."EUDR_MONITOREO" m
    WHERE m."ID_Organizacion" = p_organizacion_id
      AND m.estado_revision = 'APROBADO'
      AND (p_excluir_id IS NULL OR m.id_monitoreo <> p_excluir_id)
      AND ST_DWithin(m.geom_inspeccion::geography, p_geom::geography, p_radio_m);

    RETURN QUERY
    SELECT
        m.id_monitoreo AS id,
        m.geom_inspeccion AS geom,
        m."ID_Socio" AS codigo_socio,
        v_total_encontrados AS total_encontrados,
        LEAST(v_total_encontrados, p_limite) AS total_devueltos
    FROM public."EUDR_MONITOREO" m
    WHERE m."ID_Organizacion" = p_organizacion_id
      AND m.estado_revision = 'APROBADO'
      AND (p_excluir_id IS NULL OR m.id_monitoreo <> p_excluir_id)
      AND ST_DWithin(m.geom_inspeccion::geography, p_geom::geography, p_radio_m)
    ORDER BY ST_Distance(m.geom_inspeccion::geography, p_geom::geography)
    LIMIT p_limite;
END;
$$;

COMMIT;
