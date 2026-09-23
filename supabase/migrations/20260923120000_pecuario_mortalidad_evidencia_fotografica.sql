-- =====================================================================
-- RYZOS · Pecuario Cuyes · Evidencia fotográfica en Mortalidad
-- Fecha: 2026-09-23
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (system prompt Sección 4.1.2): cubierta
-- en el mismo flujo, por haberse trabajado con Claude desde el principio.
--
-- Spec de referencia: specs/pecuario_mortalidad_evidencia_fotografica.md
-- (decisión confirmada por Neyser, 2026-09-15; roadmap de Pecuario
-- 2026-09-23, ítem 2 de Nivel 1 — ver claude/roadmap_pecuario_mockup_a_backend.md
-- del proyecto de Cowork).
--
-- DECISIÓN DE ARQUITECTURA — tabla `PECUARIO_MORTALIDAD_FOTOS` (una fila
-- por foto), NO un array de URLs en una columna de `PECUARIO_MORTALIDAD`.
-- La spec (§4) dejaba esto abierto "a decidir según cuántas fotos por
-- registro se permitan" — el tope todavía no está confirmado (§5,
-- pendiente), así que una tabla normalizada no fuerza ningún límite fijo
-- y deja lugar para metadata por foto a futuro (quién la subió, cuándo)
-- sin tener que migrar un array más adelante. NO se agrega un CHECK/
-- trigger que limite la cantidad de fotos por registro en esta migración
-- — el tope es una decisión de negocio todavía sin confirmar (spec §5),
-- se aplicará donde corresponda (probablemente UI/Server Action) cuando
-- se confirme el número.
--
-- STORAGE — bucket nuevo `evidencias_pecuario`, NO se reutiliza
-- `evidencias_eudr` (ese es del vertical Agrícola/EUDR, otro dominio de
-- datos). Mismo patrón ya probado y en producción para evidencias EUDR
-- (`supabase/migrations/20260815_fase1_security_storage.sql`/
-- `20260816_fase3_seguridad_rls.sql`): bucket privado, políticas RLS de
-- `storage.objects` por prefijo de carpeta igual a `ID_Organizacion`.
-- Convención de ruta: `{ID_Organizacion}/mortalidad/{mortalidad_id}/{filename}`
-- — un nivel más granular que `evidencias_eudr` (que usa
-- `{ID_Organizacion}/{filename}` a secas) porque la spec (§4, último
-- punto) ya anticipa extender esta misma capacidad a otras pantallas
-- (Sanidad, Parto) más adelante — el bucket queda listo para eso sin
-- otra migración, cada pantalla en su propio subdirectorio. El primer
-- segmento de la ruta sigue siendo `ID_Organizacion`, que es lo único
-- que la política RLS evalúa (`(storage.foldername(name))[1]`), así que
-- esto no cambia el mecanismo de aislamiento, solo lo organiza mejor.
--
-- NO incluye compresión/resize de imagen (spec §4/§5: pendiente de
-- confirmar, no se implementa especulativamente) — eso es trabajo del
-- cliente (app móvil) antes de subir, no algo que la base de datos o
-- Storage hagan. `file_size_limit` del bucket sí se fija (10MB, mismo
-- valor que `evidencias_eudr`) como tope defensivo mínimo mientras se
-- confirma el resto.
--
-- Aditiva: no toca PECUARIO_MORTALIDAD ni trg_dar_baja_animal_por_mortalidad.
-- Idempotente.
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_MORTALIDAD"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_MORTALIDAD (20260910160000). Corré primero v1.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auth_org_id') THEN
    RAISE EXCEPTION 'Falta public.auth_org_id() (login real, Fase A). Prerrequisito de las políticas de Storage de esta migración.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. PECUARIO_MORTALIDAD_FOTOS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PECUARIO_MORTALIDAD_FOTOS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS" ADD COLUMN IF NOT EXISTS "ID_Organizacion" text NOT NULL;
ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS" ADD COLUMN IF NOT EXISTS mortalidad_id UUID NOT NULL;
ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS" ADD COLUMN IF NOT EXISTS storage_path TEXT NOT NULL;
ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS" ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS" ADD COLUMN IF NOT EXISTS created_offline_at TIMESTAMPTZ;
ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS" ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public."PECUARIO_MORTALIDAD_FOTOS".storage_path IS
  'Ruta completa del objeto dentro del bucket evidencias_pecuario: {ID_Organizacion}/mortalidad/{mortalidad_id}/{filename}. No es una URL pública — el bucket es privado, se accede vía Signed URL generada server-side.';

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS" ADD CONSTRAINT uq_mortalidad_fotos_storage_path
      UNIQUE (storage_path);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS"
        ADD CONSTRAINT fk_mortalidad_fotos_org FOREIGN KEY ("ID_Organizacion")
        REFERENCES public."ORGANIZACIONES"("ID") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS"
        ADD CONSTRAINT fk_mortalidad_fotos_mortalidad FOREIGN KEY (mortalidad_id)
        REFERENCES public."PECUARIO_MORTALIDAD"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_pecuario_mortalidad_fotos_mortalidad ON public."PECUARIO_MORTALIDAD_FOTOS" (mortalidad_id);
CREATE INDEX IF NOT EXISTS idx_pecuario_mortalidad_fotos_org ON public."PECUARIO_MORTALIDAD_FOTOS" ("ID_Organizacion");

ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_all_pecuario_mortalidad_fotos" ON public."PECUARIO_MORTALIDAD_FOTOS";
CREATE POLICY "rls_all_pecuario_mortalidad_fotos" ON public."PECUARIO_MORTALIDAD_FOTOS"
FOR ALL TO authenticated
USING ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
WITH CHECK ("ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

-- ---------------------------------------------------------------------
-- 2. Storage — bucket privado + políticas RLS por org (mismo patrón que
--    evidencias_eudr, ver cabecera de esta migración)
-- ---------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidencias_pecuario',
  'evidencias_pecuario',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "rls_storage_select_evidencias_pecuario" ON storage.objects;
CREATE POLICY "rls_storage_select_evidencias_pecuario" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'evidencias_pecuario'
  AND (
    (storage.foldername(name))[1] = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
);

DROP POLICY IF EXISTS "rls_storage_insert_evidencias_pecuario" ON storage.objects;
CREATE POLICY "rls_storage_insert_evidencias_pecuario" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'evidencias_pecuario'
  AND (
    (storage.foldername(name))[1] = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
);

DROP POLICY IF EXISTS "rls_storage_update_evidencias_pecuario" ON storage.objects;
CREATE POLICY "rls_storage_update_evidencias_pecuario" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'evidencias_pecuario'
  AND (
    (storage.foldername(name))[1] = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
)
WITH CHECK (
  bucket_id = 'evidencias_pecuario'
  AND (
    (storage.foldername(name))[1] = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
);

DROP POLICY IF EXISTS "rls_storage_delete_evidencias_pecuario" ON storage.objects;
CREATE POLICY "rls_storage_delete_evidencias_pecuario" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'evidencias_pecuario'
  AND (
    (storage.foldername(name))[1] = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
);

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'PECUARIO_MORTALIDAD_FOTOS' ORDER BY ordinal_position;
--
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets
--   WHERE id = 'evidencias_pecuario';
--
-- SELECT policyname FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE '%evidencias_pecuario%';
--   -- esperado: 4 filas (select/insert/update/delete)
--
-- INSERT INTO "PECUARIO_MORTALIDAD_FOTOS" ("ID_Organizacion", mortalidad_id, storage_path)
--   VALUES ('<org de prueba>', '<mortalidad_id real de esa org>', '<org de prueba>/mortalidad/<mortalidad_id>/foto1.jpg');
--   -- esperado: fila creada
--
-- Debe fallar por uq_mortalidad_fotos_storage_path (mismo storage_path dos veces):
-- INSERT INTO "PECUARIO_MORTALIDAD_FOTOS" ("ID_Organizacion", mortalidad_id, storage_path)
--   VALUES ('<org de prueba>', '<mortalidad_id real de esa org>', '<org de prueba>/mortalidad/<mortalidad_id>/foto1.jpg');
-- ---------------------------------------------------------------------