-- MIGRACIÓN IDEMPOTENTE: Fix RLS Policies Multi-Tenant RYZOS
-- Aplica DROP POLICY IF EXISTS sobre TODOS los nombres (legacy + ryzos_*)
-- antes de cada CREATE POLICY para evitar error 42710 en re-ejecuciones.

BEGIN;

-- ============================================================
-- 1. LIMPIEZA COMPLETA: políticas legacy Y políticas ryzos_*
-- ============================================================

-- ORGANIZACIONES
DROP POLICY IF EXISTS "Acceso Multi-Tenant RYZOS"     ON public."ORGANIZACIONES";
DROP POLICY IF EXISTS "Acceso por Organizacion"        ON public."ORGANIZACIONES";
DROP POLICY IF EXISTS "ryzos_sel_organizaciones"       ON public."ORGANIZACIONES";

-- PADRON_SOCIOS
DROP POLICY IF EXISTS "Acceso Multi-Tenant RYZOS"     ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "Acceso a Socios por Organizacion" ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "Acceso por Organizacion"        ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "ryzos_all_padron_socios"        ON public."PADRON_SOCIOS";

-- PADRON_PARCELAS
DROP POLICY IF EXISTS "Acceso Multi-Tenant RYZOS"     ON public."PADRON_PARCELAS";
DROP POLICY IF EXISTS "Acceso a Parcelas por Organizacion" ON public."PADRON_PARCELAS";
DROP POLICY IF EXISTS "Acceso por Organizacion"        ON public."PADRON_PARCELAS";
DROP POLICY IF EXISTS "ryzos_all_padron_parcelas"      ON public."PADRON_PARCELAS";

-- EUDR_MONITOREO
DROP POLICY IF EXISTS "Acceso Multi-Tenant RYZOS"     ON public."EUDR_MONITOREO";
DROP POLICY IF EXISTS "Acceso por Organizacion"        ON public."EUDR_MONITOREO";
DROP POLICY IF EXISTS "ryzos_all_eudr_monitoreo"       ON public."EUDR_MONITOREO";

-- EUDR_INSTALACIONES
DROP POLICY IF EXISTS "Acceso Multi-Tenant RYZOS"     ON public."EUDR_INSTALACIONES";
DROP POLICY IF EXISTS "Acceso por Organizacion"        ON public."EUDR_INSTALACIONES";
DROP POLICY IF EXISTS "ryzos_all_eudr_instalaciones"   ON public."EUDR_INSTALACIONES";

-- EUDR_USO_SUELO
DROP POLICY IF EXISTS "Acceso Multi-Tenant RYZOS"     ON public."EUDR_USO_SUELO";
DROP POLICY IF EXISTS "Acceso por Organizacion"        ON public."EUDR_USO_SUELO";
DROP POLICY IF EXISTS "ryzos_all_eudr_uso_suelo"       ON public."EUDR_USO_SUELO";

-- STORAGE
DROP POLICY IF EXISTS "ryzos_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "ryzos_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "ryzos_storage_delete" ON storage.objects;

-- ============================================================
-- 2. FUNCIÓN HELPER: extrae ID_Organizacion del JWT
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(COALESCE(
    auth.jwt() ->> 'ID_Organizacion',
    auth.jwt() -> 'user_metadata' ->> 'ID_Organizacion'
  ), '');
$$;

-- ============================================================
-- 3. HABILITAR RLS (idempotente: ALTER TABLE es seguro re-ejecutar)
-- ============================================================
ALTER TABLE public."ORGANIZACIONES"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PADRON_SOCIOS"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PADRON_PARCELAS"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EUDR_MONITOREO"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EUDR_INSTALACIONES" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EUDR_USO_SUELO"    ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. POLÍTICAS MULTI-TENANT UNIFICADAS
-- ============================================================

-- Solo lectura del registro de la propia organización
CREATE POLICY "ryzos_sel_organizaciones" ON public."ORGANIZACIONES"
FOR SELECT TO authenticated
USING ("ID" = public.get_my_org_id() OR current_user = 'postgres');

-- CRUD completo filtrado por ID_Organizacion
CREATE POLICY "ryzos_all_padron_socios" ON public."PADRON_SOCIOS"
FOR ALL TO authenticated
USING    ("ID_Organizacion" = public.get_my_org_id() OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.get_my_org_id() OR current_user = 'postgres');

CREATE POLICY "ryzos_all_padron_parcelas" ON public."PADRON_PARCELAS"
FOR ALL TO authenticated
USING    ("ID_Organizacion" = public.get_my_org_id() OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.get_my_org_id() OR current_user = 'postgres');

CREATE POLICY "ryzos_all_eudr_monitoreo" ON public."EUDR_MONITOREO"
FOR ALL TO authenticated
USING    ("ID_Organizacion" = public.get_my_org_id() OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.get_my_org_id() OR current_user = 'postgres');

CREATE POLICY "ryzos_all_eudr_instalaciones" ON public."EUDR_INSTALACIONES"
FOR ALL TO authenticated
USING    ("ID_Organizacion" = public.get_my_org_id() OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.get_my_org_id() OR current_user = 'postgres');

CREATE POLICY "ryzos_all_eudr_uso_suelo" ON public."EUDR_USO_SUELO"
FOR ALL TO authenticated
USING    ("ID_Organizacion" = public.get_my_org_id() OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.get_my_org_id() OR current_user = 'postgres');

-- ============================================================
-- 5. TRIGGER DE INYECCIÓN AUTOMÁTICA DE ID_Organizacion
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_set_id_organizacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW."ID_Organizacion" IS NULL OR NEW."ID_Organizacion" = '' THEN
    NEW."ID_Organizacion" := public.get_my_org_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_org_padron_socios       ON public."PADRON_SOCIOS";
CREATE TRIGGER trg_auto_org_padron_socios
  BEFORE INSERT ON public."PADRON_SOCIOS"
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_id_organizacion();

DROP TRIGGER IF EXISTS trg_auto_org_padron_parcelas     ON public."PADRON_PARCELAS";
CREATE TRIGGER trg_auto_org_padron_parcelas
  BEFORE INSERT ON public."PADRON_PARCELAS"
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_id_organizacion();

DROP TRIGGER IF EXISTS trg_auto_org_eudr_monitoreo      ON public."EUDR_MONITOREO";
CREATE TRIGGER trg_auto_org_eudr_monitoreo
  BEFORE INSERT ON public."EUDR_MONITOREO"
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_id_organizacion();

DROP TRIGGER IF EXISTS trg_auto_org_eudr_instalaciones  ON public."EUDR_INSTALACIONES";
CREATE TRIGGER trg_auto_org_eudr_instalaciones
  BEFORE INSERT ON public."EUDR_INSTALACIONES"
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_id_organizacion();

DROP TRIGGER IF EXISTS trg_auto_org_eudr_uso_suelo      ON public."EUDR_USO_SUELO";
CREATE TRIGGER trg_auto_org_eudr_uso_suelo
  BEFORE INSERT ON public."EUDR_USO_SUELO"
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_id_organizacion();

-- ============================================================
-- 6. VISTA QC — solo registros APROBADOS
-- ============================================================
DROP VIEW IF EXISTS public.view_eudr_dashboard_aprobados;

CREATE VIEW public.view_eudr_dashboard_aprobados AS
SELECT
    m.id_monitoreo,
    m."ID_Organizacion",
    m."ID_Parcela_Fija",
    m."ID_Socio",
    m.fecha_monitoreo,
    m.tecnico_responsable,
    m.precision_gps,
    m.evidencia_foto,
    m.cumple_eudr,
    m.observaciones,
    m.estado_revision,
    p.parcela_codigo,
    p.parcela_nombre,
    p.totalh AS hectareas_totales,
    s.socio_nombre_completo,
    s.socio_dni,
    s.localidad,
    s.certificaciones,
    COALESCE(m.geom_inspeccion, p.geom) AS geom
FROM public."EUDR_MONITOREO" m
LEFT JOIN public."PADRON_PARCELAS" p ON m."ID_Parcela_Fija" = p."ID_Parcela_Fija"
LEFT JOIN public."PADRON_SOCIOS"   s ON m."ID_Socio"        = s."ID_Socio"
WHERE m.estado_revision = 'APROBADO';

GRANT SELECT ON public.view_eudr_dashboard_aprobados TO authenticated;

-- ============================================================
-- 7. STORAGE: bucket privado + políticas RLS por org path
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidencias_eudr',
  'evidencias_eudr',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- Políticas ya eliminadas en bloque 1; se recrean limpias aquí
CREATE POLICY "ryzos_storage_select" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'evidencias_eudr'
  AND (storage.foldername(name))[1] = public.get_my_org_id());

CREATE POLICY "ryzos_storage_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'evidencias_eudr'
  AND (storage.foldername(name))[1] = public.get_my_org_id());

CREATE POLICY "ryzos_storage_delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'evidencias_eudr'
  AND (storage.foldername(name))[1] = public.get_my_org_id());

COMMIT;
