-- MIGRACIÓN IDEMPOTENTE: Blindaje del Modelo Espacial GIS Core
-- Ver spec: specs/gis_core_reengineering.md
--
-- INVARIANTE DE DISEÑO (confirmado con el usuario, no cambiar sin re-confirmar):
-- la validación de área >= 4.0 ha es INFORMATIVA, nunca bloqueante. Un trigger
-- que rechazara geometrías pequeñas con RAISE EXCEPTION rompería la ingesta de
-- fincas reales de pequeños productores cafetaleros (caso de uso central de
-- RYZOS) — EUDR no define un mínimo de 4 ha para registrar una parcela. Por
-- eso el resultado del chequeo de área se guarda en la columna booleana
-- requiere_revision_area, no en una excepción.
--
-- INVARIANTE geometría genérica: EUDR_MONITOREO.geom_inspeccion puede ser
-- Point o Polygon (ver 20260816_fase2_vistas_qc.sql); por eso
-- fn_calcular_area_ha() devuelve NULL para geometrías de dimensión != 2 en vez
-- de asumir que toda fila es un polígono.
--
-- HALLAZGO DE AUDITORÍA: no existía ningún índice GiST sobre columnas de
-- geometría en el historial de migraciones del proyecto (confirmado por
-- búsqueda exhaustiva en supabase/migrations/*.sql antes de escribir esta
-- migración) — cualquier filtro espacial (ST_Intersects/ST_Within, el bounding
-- box del mapa en components/gis/MapDashboard.jsx) hacía table scan completo.

BEGIN;

-- ============================================================
-- 1. Columnas nuevas de auditoría de área (no rompen SELECT * ni el ETL,
--    que inserta con columnas nombradas explícitas — ver
--    scripts/etl_drive_to_supabase.py)
-- ============================================================
ALTER TABLE public."EUDR_MONITOREO"
  ADD COLUMN IF NOT EXISTS area_calculada_ha numeric,
  ADD COLUMN IF NOT EXISTS requiere_revision_area boolean;

ALTER TABLE public."EUDR_USO_SUELO"
  ADD COLUMN IF NOT EXISTS area_calculada_ha numeric,
  ADD COLUMN IF NOT EXISTS requiere_revision_area boolean;

ALTER TABLE public."EUDR_INSTALACIONES"
  ADD COLUMN IF NOT EXISTS area_calculada_ha numeric,
  ADD COLUMN IF NOT EXISTS requiere_revision_area boolean;

-- ============================================================
-- 2. fn_sanitize_geometry: EPSG:4326 + reparación topológica + redondeo
--    a 6 decimales (~11 cm de precisión en el ecuador, suficiente para GPS
--    de mano y sin arrastrar basura de precisión de punto flotante).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_sanitize_geometry(p_geom geometry)
RETURNS geometry
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_geom geometry;
BEGIN
  IF p_geom IS NULL THEN
    RETURN NULL;
  END IF;

  v_geom := p_geom;

  IF ST_SRID(v_geom) = 0 THEN
    v_geom := ST_SetSRID(v_geom, 4326);
  ELSIF ST_SRID(v_geom) <> 4326 THEN
    v_geom := ST_Transform(v_geom, 4326);
  END IF;

  IF NOT ST_IsValid(v_geom) THEN
    v_geom := ST_MakeValid(v_geom);
  END IF;

  v_geom := ST_SnapToGrid(v_geom, 0.000001);

  RETURN v_geom;
END;
$$;

-- ============================================================
-- 3. fn_calcular_area_ha: área geodésica real (geography, no grados planos).
--    NULL para geometrías no poligonales (puntos) — no aplica área a un pin.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_calcular_area_ha(p_geom geometry)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_geom IS NULL OR ST_Dimension(p_geom) <> 2 THEN NULL
    ELSE ROUND((ST_Area(p_geom::geography) / 10000)::numeric, 4)
  END;
$$;

-- ============================================================
-- 4. Triggers por tabla — BEFORE INSERT OR UPDATE OF <col_geom> para no
--    recalcular en updates que no tocan la geometría.
-- ============================================================

-- 4a. EUDR_MONITOREO.geom_inspeccion
CREATE OR REPLACE FUNCTION public.trg_sanitize_geom_monitoreo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.geom_inspeccion := public.fn_sanitize_geometry(NEW.geom_inspeccion);
  NEW.area_calculada_ha := public.fn_calcular_area_ha(NEW.geom_inspeccion);
  NEW.requiere_revision_area := CASE
    WHEN NEW.area_calculada_ha IS NULL THEN NULL
    ELSE NEW.area_calculada_ha < 4.0
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gis_sanitize_eudr_monitoreo ON public."EUDR_MONITOREO";
CREATE TRIGGER trg_gis_sanitize_eudr_monitoreo
  BEFORE INSERT OR UPDATE OF geom_inspeccion ON public."EUDR_MONITOREO"
  FOR EACH ROW EXECUTE FUNCTION public.trg_sanitize_geom_monitoreo();

-- 4b. EUDR_USO_SUELO.geom
CREATE OR REPLACE FUNCTION public.trg_sanitize_geom_uso_suelo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.geom := public.fn_sanitize_geometry(NEW.geom);
  NEW.area_calculada_ha := public.fn_calcular_area_ha(NEW.geom);
  NEW.requiere_revision_area := CASE
    WHEN NEW.area_calculada_ha IS NULL THEN NULL
    ELSE NEW.area_calculada_ha < 4.0
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gis_sanitize_eudr_uso_suelo ON public."EUDR_USO_SUELO";
CREATE TRIGGER trg_gis_sanitize_eudr_uso_suelo
  BEFORE INSERT OR UPDATE OF geom ON public."EUDR_USO_SUELO"
  FOR EACH ROW EXECUTE FUNCTION public.trg_sanitize_geom_uso_suelo();

-- 4c. EUDR_INSTALACIONES.geom (puntual en la práctica — area_calculada_ha
--     queda NULL para estas filas, ver fn_calcular_area_ha)
CREATE OR REPLACE FUNCTION public.trg_sanitize_geom_instalaciones()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.geom := public.fn_sanitize_geometry(NEW.geom);
  NEW.area_calculada_ha := public.fn_calcular_area_ha(NEW.geom);
  NEW.requiere_revision_area := CASE
    WHEN NEW.area_calculada_ha IS NULL THEN NULL
    ELSE NEW.area_calculada_ha < 4.0
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gis_sanitize_eudr_instalaciones ON public."EUDR_INSTALACIONES";
CREATE TRIGGER trg_gis_sanitize_eudr_instalaciones
  BEFORE INSERT OR UPDATE OF geom ON public."EUDR_INSTALACIONES"
  FOR EACH ROW EXECUTE FUNCTION public.trg_sanitize_geom_instalaciones();

-- ============================================================
-- 5. Índices GiST espaciales + índice por organización (multi-tenant).
--    Ninguno existía antes de esta migración.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_gist_eudr_monitoreo_geom
  ON public."EUDR_MONITOREO" USING GIST (geom_inspeccion);

CREATE INDEX IF NOT EXISTS idx_gist_eudr_uso_suelo_geom
  ON public."EUDR_USO_SUELO" USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_gist_eudr_instalaciones_geom
  ON public."EUDR_INSTALACIONES" USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_eudr_monitoreo_org
  ON public."EUDR_MONITOREO" ("ID_Organizacion");

CREATE INDEX IF NOT EXISTS idx_eudr_uso_suelo_org
  ON public."EUDR_USO_SUELO" ("ID_Organizacion");

CREATE INDEX IF NOT EXISTS idx_eudr_instalaciones_org
  ON public."EUDR_INSTALACIONES" ("ID_Organizacion");

-- ============================================================
-- 6. Sanitización retroactiva de filas existentes — reutiliza el mismo
--    UPDATE OF <col> que dispara el trigger, así la lógica de saneo vive en
--    un solo lugar (el trigger), no duplicada aquí.
-- ============================================================
UPDATE public."EUDR_MONITOREO" SET geom_inspeccion = geom_inspeccion WHERE geom_inspeccion IS NOT NULL;
UPDATE public."EUDR_USO_SUELO" SET geom = geom WHERE geom IS NOT NULL;
UPDATE public."EUDR_INSTALACIONES" SET geom = geom WHERE geom IS NOT NULL;

COMMIT;
