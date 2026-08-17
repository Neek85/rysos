-- MIGRACIÓN IDEMPOTENTE: Seguridad RLS Multi-Tenant Consolidada (Tarea 9.1)
-- Reemplaza el set de politicas de supabase/migrations/20260815_fix_rls_policies.sql
-- con una funcion auxiliar nueva (public.auth_org_id()) y politicas de
-- lectura/escritura separadas por tabla, explicitamente aisladas por
-- "ID_Organizacion" via el claim JWT del mismo nombre.
--
-- INVARIANTE DE COMPATIBILIDAD: public.get_my_org_id() (usada por
-- trg_set_id_organizacion() y por cualquier otro objeto ya desplegado que la
-- referencie) se redefine como un alias delgado sobre public.auth_org_id(), en
-- vez de eliminarse. Esto evita romper el trigger de auto-inyeccion de
-- ID_Organizacion y cualquier vista/funcion existente sin tener que tocarlos en
-- esta migracion.
--
-- INVARIANTE service_role: los requests hechos con la Service Role Key de
-- Supabase ya bypasean RLS a nivel de rol de Postgres (el rol `service_role`
-- tiene BYPASSRLS por defecto en todo proyecto Supabase) — el chequeo explicito
-- `auth.role() = 'service_role'` en las politticas es redundante con ese bypass,
-- pero se incluye de todos modos por claridad y como defensa en profundidad si
-- BYPASSRLS llegara a revocarse alguna vez. `current_user = 'postgres'` se
-- mantiene ademas para no romper el acceso libre desde el SQL Editor de Supabase
-- Studio (que ejecuta como el rol `postgres`, no `service_role`).
--
-- ASIMETRIA DELIBERADA: "ORGANIZACIONES" es la tabla maestra de identidad de
-- tenant (una fila por organizacion); solo recibe politica de LECTURA, igual que
-- en la migracion anterior. Las demas 5 tablas (maestras operativas y
-- transaccionales) reciben lectura + escritura completa. Un usuario tenant no
-- debe poder modificar el registro de su propia organizacion via API.

BEGIN;

-- ============================================================
-- 1. LIMPIEZA: políticas previas que esta migración reemplaza
-- ============================================================
DROP POLICY IF EXISTS "ryzos_sel_organizaciones"     ON public."ORGANIZACIONES";
DROP POLICY IF EXISTS "rls_select_organizaciones"    ON public."ORGANIZACIONES";

DROP POLICY IF EXISTS "ryzos_all_padron_socios"      ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "rls_select_padron_socios"     ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "rls_write_padron_socios"      ON public."PADRON_SOCIOS";

DROP POLICY IF EXISTS "ryzos_all_padron_parcelas"    ON public."PADRON_PARCELAS";
DROP POLICY IF EXISTS "rls_select_padron_parcelas"   ON public."PADRON_PARCELAS";
DROP POLICY IF EXISTS "rls_write_padron_parcelas"    ON public."PADRON_PARCELAS";

DROP POLICY IF EXISTS "ryzos_all_eudr_monitoreo"     ON public."EUDR_MONITOREO";
DROP POLICY IF EXISTS "rls_select_eudr_monitoreo"    ON public."EUDR_MONITOREO";
DROP POLICY IF EXISTS "rls_write_eudr_monitoreo"     ON public."EUDR_MONITOREO";

DROP POLICY IF EXISTS "ryzos_all_eudr_instalaciones" ON public."EUDR_INSTALACIONES";
DROP POLICY IF EXISTS "rls_select_eudr_instalaciones" ON public."EUDR_INSTALACIONES";
DROP POLICY IF EXISTS "rls_write_eudr_instalaciones" ON public."EUDR_INSTALACIONES";

DROP POLICY IF EXISTS "ryzos_all_eudr_uso_suelo"     ON public."EUDR_USO_SUELO";
DROP POLICY IF EXISTS "rls_select_eudr_uso_suelo"    ON public."EUDR_USO_SUELO";
DROP POLICY IF EXISTS "rls_write_eudr_uso_suelo"     ON public."EUDR_USO_SUELO";

DROP POLICY IF EXISTS "ryzos_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "ryzos_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "ryzos_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "ryzos_storage_delete" ON storage.objects;

-- ============================================================
-- 2. FUNCIÓN AUXILIAR: extrae el claim ID_Organizacion del JWT
-- ============================================================
CREATE OR REPLACE FUNCTION public.auth_org_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'ID_Organizacion', '')::text;
$$;

-- Alias de compatibilidad: no romper trg_set_id_organizacion() ni otros objetos
-- ya desplegados que llaman a public.get_my_org_id().
CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_org_id();
$$;

-- ============================================================
-- 3. HABILITAR RLS (idempotente: ALTER TABLE es seguro re-ejecutar)
-- ============================================================
ALTER TABLE public."ORGANIZACIONES"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PADRON_SOCIOS"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PADRON_PARCELAS"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EUDR_MONITOREO"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EUDR_INSTALACIONES" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EUDR_USO_SUELO"     ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. POLÍTICAS DE LECTURA Y ESCRITURA POR TABLA
-- ============================================================

-- ORGANIZACIONES: solo lectura del registro de la propia organización.
CREATE POLICY "rls_select_organizaciones" ON public."ORGANIZACIONES"
FOR SELECT TO authenticated
USING (
  "ID" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- PADRON_SOCIOS
CREATE POLICY "rls_select_padron_socios" ON public."PADRON_SOCIOS"
FOR SELECT TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

CREATE POLICY "rls_write_padron_socios" ON public."PADRON_SOCIOS"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- PADRON_PARCELAS
CREATE POLICY "rls_select_padron_parcelas" ON public."PADRON_PARCELAS"
FOR SELECT TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

CREATE POLICY "rls_write_padron_parcelas" ON public."PADRON_PARCELAS"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- EUDR_MONITOREO
CREATE POLICY "rls_select_eudr_monitoreo" ON public."EUDR_MONITOREO"
FOR SELECT TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

CREATE POLICY "rls_write_eudr_monitoreo" ON public."EUDR_MONITOREO"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- EUDR_INSTALACIONES
CREATE POLICY "rls_select_eudr_instalaciones" ON public."EUDR_INSTALACIONES"
FOR SELECT TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

CREATE POLICY "rls_write_eudr_instalaciones" ON public."EUDR_INSTALACIONES"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- EUDR_USO_SUELO
CREATE POLICY "rls_select_eudr_uso_suelo" ON public."EUDR_USO_SUELO"
FOR SELECT TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

CREATE POLICY "rls_write_eudr_uso_suelo" ON public."EUDR_USO_SUELO"
FOR ALL TO authenticated
USING (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" = public.auth_org_id()
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- ============================================================
-- 5. STORAGE: aislamiento multi-tenant por prefijo de carpeta
-- INVARIANTE: la ruta de todo objeto en el bucket evidencias_eudr es
-- {ID_Organizacion}/{filename} (ver scripts/etl_drive_to_supabase.py); el primer
-- segmento de la ruta ((storage.foldername(name))[1]) debe coincidir con el
-- claim ID_Organizacion del usuario autenticado. Se agrega politica de UPDATE
-- (ausente en la migracion anterior), necesaria porque upload_evidence_photo()
-- sube con upsert=true, que en un re-procesamiento ejecuta un UPDATE sobre el
-- objeto existente ademas del INSERT inicial.
-- ============================================================
CREATE POLICY "rls_storage_select_evidencias" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'evidencias_eudr'
  AND (
    (storage.foldername(name))[1] = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
);

CREATE POLICY "rls_storage_insert_evidencias" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'evidencias_eudr'
  AND (
    (storage.foldername(name))[1] = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
);

CREATE POLICY "rls_storage_update_evidencias" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'evidencias_eudr'
  AND (
    (storage.foldername(name))[1] = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
)
WITH CHECK (
  bucket_id = 'evidencias_eudr'
  AND (
    (storage.foldername(name))[1] = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
);

CREATE POLICY "rls_storage_delete_evidencias" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'evidencias_eudr'
  AND (
    (storage.foldername(name))[1] = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
);

COMMIT;
