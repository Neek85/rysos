-- Infraestructura de base de datos para sincronización móvil offline-first
-- (ver specs/mobile_offline_sync.md, docs/adr/ADR-040-infraestructura-
-- sincronizacion-movil-offline.md). Ninguna app React Native/Expo existe
-- todavía en este repo -- esto es solo la base de datos que esas apps
-- necesitarán.
--
-- DECISIÓN DE ALCANCE (confirmada con el usuario antes de escribir esto):
-- el prompt original pedía RLS de lectura para "socios/técnicos" en
-- PRECIOS_PRODUCTO, pero PERFILES_USUARIO_INTERNOS.rol no admite 'socio'
-- (CHECK solo admin/tecnico_campo/auditor_qc) y specs/login_real_organizacion_rol.md
-- confirma que la app del Socio (DNI+PIN) nunca usa ese login -- hoy no
-- existe ningún mecanismo para que un socio tenga auth.uid(). El RLS de
-- las 3 tablas nuevas cubre únicamente admin/tecnico_campo/auditor_qc
-- (los roles que sí tienen sesión real desde ADR-035-039). El acceso de
-- la App del Socio queda fuera de alcance, para cuando exista ese
-- mecanismo de sesión.

BEGIN;

-- ============================================================
-- 1. SYNC_QUEUE -- cola genérica de mutaciones offline por dispositivo.
--    Cualquier miembro autenticado de la organización lee/escribe su
--    propia cola -- sin restricción de rol (el prompt tampoco la pedía
--    para esta tabla).
-- ============================================================

CREATE TABLE IF NOT EXISTS public."SYNC_QUEUE" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_organizacion  text NOT NULL DEFAULT public.auth_org_id() REFERENCES public."ORGANIZACIONES"("ID"),
  device_id        text NOT NULL,
  creado_por       uuid REFERENCES auth.users(id),
  entity_type      text NOT NULL,
  operation        text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  payload          jsonb NOT NULL,
  estado           text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'PROCESADO', 'ERROR')),
  error_mensaje    text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  procesado_en     timestamptz
);

ALTER TABLE public."SYNC_QUEUE" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_org_sync_queue" ON public."SYNC_QUEUE";
CREATE POLICY "rls_org_sync_queue" ON public."SYNC_QUEUE"
  FOR ALL
  TO authenticated
  USING (
    id_organizacion = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
  WITH CHECK (
    id_organizacion = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  );

-- ============================================================
-- 2. PRECIOS_PRODUCTO -- lectura por organización para cualquier
--    miembro autenticado, escritura exclusiva para admin.
-- ============================================================

CREATE TABLE IF NOT EXISTS public."PRECIOS_PRODUCTO" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_organizacion  text NOT NULL DEFAULT public.auth_org_id() REFERENCES public."ORGANIZACIONES"("ID"),
  id_producto      uuid NOT NULL REFERENCES public."PRODUCTOS"(id),
  precio           numeric NOT NULL CHECK (precio >= 0),
  unidad           text NOT NULL DEFAULT 'kg',
  vigente_desde    date NOT NULL DEFAULT current_date,
  vigente_hasta    date,
  creado_por       uuid REFERENCES auth.users(id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."PRECIOS_PRODUCTO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_select_precios_producto" ON public."PRECIOS_PRODUCTO";
CREATE POLICY "rls_select_precios_producto" ON public."PRECIOS_PRODUCTO"
  FOR SELECT
  TO authenticated
  USING (
    id_organizacion = public.auth_org_id()
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  );

DROP POLICY IF EXISTS "rls_write_precios_producto" ON public."PRECIOS_PRODUCTO";
CREATE POLICY "rls_write_precios_producto" ON public."PRECIOS_PRODUCTO"
  FOR ALL
  TO authenticated
  USING (
    (public.auth_role() = 'admin' AND id_organizacion = public.auth_org_id())
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
  WITH CHECK (
    (public.auth_role() = 'admin' AND id_organizacion = public.auth_org_id())
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  );

-- ============================================================
-- 3. SOCIO_ACTIVACION_CODES -- dato sensible (token de activación de
--    cuenta), exclusivo admin -- ni lectura para tecnico_campo/auditor_qc.
--    id_socio referencia el PK real de PADRON_SOCIOS (surrogate `id`
--    uuid desde ADR-026, confirmado en vivo -- NO "ID_Socio").
-- ============================================================

CREATE TABLE IF NOT EXISTS public."SOCIO_ACTIVACION_CODES" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_organizacion    text NOT NULL DEFAULT public.auth_org_id() REFERENCES public."ORGANIZACIONES"("ID"),
  id_socio           uuid NOT NULL REFERENCES public."PADRON_SOCIOS"(id) ON DELETE CASCADE,
  codigo_activacion  text NOT NULL UNIQUE,
  estado             text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'USADO', 'EXPIRADO')),
  generado_en        timestamptz NOT NULL DEFAULT now(),
  generado_por       uuid REFERENCES auth.users(id),
  usado_en           timestamptz,
  expira_en          timestamptz
);

ALTER TABLE public."SOCIO_ACTIVACION_CODES" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_admin_socio_activacion_codes" ON public."SOCIO_ACTIVACION_CODES";
CREATE POLICY "rls_admin_socio_activacion_codes" ON public."SOCIO_ACTIVACION_CODES"
  FOR ALL
  TO authenticated
  USING (
    (public.auth_role() = 'admin' AND id_organizacion = public.auth_org_id())
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  )
  WITH CHECK (
    (public.auth_role() = 'admin' AND id_organizacion = public.auth_org_id())
    OR auth.role() = 'service_role'
    OR current_user = 'postgres'
  );

-- ============================================================
-- 4. PADRON_SOCIOS -- columnas nuevas para el PIN de la App del Socio.
--    Se intentó un REVOKE de columna en pin_hash (defensa en
--    profundidad) y se descartó: Supabase ya otorga SELECT de tabla
--    completa a authenticated/anon sobre PADRON_SOCIOS (GRANT estándar
--    del proyecto, confirmado en vivo con information_schema.table_privileges),
--    y un REVOKE de columna no anula un GRANT de tabla ya existente
--    (confirmado con has_column_privilege -- el REVOKE no tuvo ningún
--    efecto real). Restringirlo de verdad exigiría revocar el SELECT de
--    tabla completa y re-otorgarlo columna por columna -- cambio mucho
--    más invasivo que el alcance de esta tarea, con el riesgo de que una
--    columna futura quede invisible por descuido. pin_hash queda
--    protegido al mismo nivel que socio_dni/celular_socio: por RLS de
--    organización (ADR-034), no por ACL de columna.
-- ============================================================

ALTER TABLE public."PADRON_SOCIOS"
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_configurado_en timestamptz;

COMMIT;
