-- MIGRACIÓN IDEMPOTENTE: Fix RLS 42501 en INSPECCIONES/CAP_* + lectura de
-- padrón para autocompletado (Fase 6, continuación).
--
-- CONTEXTO: supabase/migrations/20260816_fase3_seguridad_rls.sql ya
-- habilitó RLS en PADRON_SOCIOS/PADRON_PARCELAS/EUDR_* con políticas
-- scopeadas a `authenticated`, verificando el claim JWT "ID_Organizacion"
-- vía public.auth_org_id(). Esa arquitectura asume una sesión real de
-- Supabase Auth — que NUNCA se implementó en este proyecto: todo el
-- frontend (incluido este módulo) usa exclusivamente la anon key sin
-- sesión (lib/supabaseClient.js: createClient(url, anonKey), sin
-- signInWithPassword en ningún archivo del repo). Las tablas EUDR_*/
-- PADRON_* son legibles hoy solo porque las VISTAS que las consumen
-- (vw_monitoreo_web, vw_monitoreo_poligonos/puntos,
-- view_eudr_dashboard_aprobados) corren con el privilegio de su dueño
-- (rol `postgres`, que creó las vistas), no del rol que realmente
-- consulta (`anon`) — por eso `current_user = 'postgres'` aparece en cada
-- política de Fase 3 y por qué un SELECT directo a PADRON_PARCELAS con la
-- anon key devuelve 0 filas (content-range: */0, verificado en vivo)
-- mientras que vw_monitoreo_web sí funciona.
--
-- INSPECCIONES/CAP_* no tienen ninguna vista intermedia: el formulario de
-- app/dashboard/inspecciones/ escribe DIRECTO a estas tablas con la anon
-- key. RLS ya estaba habilitado en INSPECCIONES (confirmado en vivo por
-- el error real `{"code":"42501","message":"new row violates row-level
-- security policy for table \"INSPECCIONES\""}` al intentar crear una
-- inspección) sin ninguna política que cubra el rol `anon`.
--
-- ⚠️ DECISIÓN DE SEGURIDAD EXPLÍCITA (no un efecto colateral): esta
-- migración agrega políticas NUEVAS para el rol `anon` sobre estas 9
-- tablas. NO reemplaza ni toca las políticas `authenticated` existentes
-- de Fase 3 sobre PADRON_SOCIOS/PADRON_PARCELAS (siguen intactas, se
-- suman las nuevas). Sobre INSPECCIONES + los 6 CAP_* (que no tenían
-- ninguna política todavía) esto abre lectura/escritura completa a
-- cualquier portador de la anon key — que ya viaja pública en el bundle
-- del navegador, así que el nivel de exposición real es "cualquiera en
-- internet", igual que ya ocurre con el resto del sistema (DDS, QC,
-- trazabilidad pública). Esto incluye campos DNI (CAP_DATOS_SOCIO.socio_dni,
-- FAMILIA si se porta a futuro). Es la única forma de que el formulario
-- funcione sin construir un login real con Supabase Auth (fuera de
-- alcance de esta tarea). Sobre PADRON_SOCIOS/PADRON_PARCELAS —el padrón
-- maestro YA compartido con la línea EUDR/QC de rysos— se agrega
-- deliberadamente SOLO lectura (SELECT) para anon, nunca escritura: el
-- módulo de Inspecciones solo necesita buscarlas para autocompletar, no
-- modificarlas.
--
-- Si en el futuro se implementa autenticación real (Supabase Auth con
-- JWT que lleve ID_Organizacion), esta migración debe revisarse/
-- reemplazarse por políticas `authenticated`-only como las de Fase 3.
--
-- APLICACIÓN: esta migración NO se ejecutó automáticamente contra la
-- instancia en vivo (jhtocgxlozfuzullrtol) — igual que todas las
-- anteriores de este proyecto, requiere correrse manualmente en el SQL
-- Editor de Supabase Studio. No hay Service Role Key ni conexión
-- Postgres directa disponible en el entorno donde se generó esta
-- migración, y aunque la hubiera, un cambio de políticas de seguridad
-- sobre una base de datos compartida con otro repositorio en producción
-- (Neek85/backend-inspecciones) amerita revisión humana antes de
-- ejecutarse.

BEGIN;

-- ============================================================
-- 1. HABILITAR RLS (idempotente: ALTER TABLE es seguro re-ejecutar)
-- ============================================================
ALTER TABLE public."INSPECCIONES"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_DATOS_SOCIO"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_MIC"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_CONSERVACION" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_BIENESTAR"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_RIESGOS"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CAP_GESTION"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PADRON_SOCIOS"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PADRON_PARCELAS"  ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. LIMPIEZA IDEMPOTENTE — solo de las políticas que esta migración
-- introduce. Las `rls_select_padron_socios`/`rls_write_padron_socios`/
-- `rls_select_padron_parcelas`/`rls_write_padron_parcelas` de Fase 3
-- (scopeadas a `authenticated`) NO se tocan.
-- ============================================================
DROP POLICY IF EXISTS "rls_anon_all_inspecciones"     ON public."INSPECCIONES";
DROP POLICY IF EXISTS "rls_anon_all_cap_datos_socio"  ON public."CAP_DATOS_SOCIO";
DROP POLICY IF EXISTS "rls_anon_all_cap_mic"          ON public."CAP_MIC";
DROP POLICY IF EXISTS "rls_anon_all_cap_conservacion" ON public."CAP_CONSERVACION";
DROP POLICY IF EXISTS "rls_anon_all_cap_bienestar"    ON public."CAP_BIENESTAR";
DROP POLICY IF EXISTS "rls_anon_all_cap_riesgos"      ON public."CAP_RIESGOS";
DROP POLICY IF EXISTS "rls_anon_all_cap_gestion"      ON public."CAP_GESTION";
DROP POLICY IF EXISTS "rls_anon_select_padron_socios"   ON public."PADRON_SOCIOS";
DROP POLICY IF EXISTS "rls_anon_select_padron_parcelas" ON public."PADRON_PARCELAS";

-- ============================================================
-- 3. INSPECCIONES: lectura/escritura para anon, exige ID_Organizacion
-- no nulo (evita filas huérfanas sin tenant, sigue el mismo espíritu de
-- "ID_Organizacion coincide" pedido — no hay JWT real que comparar, así
-- que se valida presencia en vez de igualdad contra un claim inexistente).
-- ============================================================
CREATE POLICY "rls_anon_all_inspecciones" ON public."INSPECCIONES"
FOR ALL TO anon, authenticated
USING (
  "ID_Organizacion" IS NOT NULL
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
)
WITH CHECK (
  "ID_Organizacion" IS NOT NULL
  OR auth.role() = 'service_role'
  OR current_user = 'postgres'
);

-- ============================================================
-- 4. Las 6 tablas CAP_*: sin columna ID_Organizacion propia (dependen de
-- ID_Inspeccion → INSPECCIONES.ID_Organizacion). Igual que el resto del
-- sistema (DDS, QC), el aislamiento real de tenant no se aplica a nivel
-- de fila aquí — se confía en que el cliente ya filtró/asignó
-- correctamente ID_Inspeccion. Correlacionar con INSPECCIONES vía
-- subquery no añadiría seguridad real (esa misma anon key ya puede
-- escribir cualquier ID_Organizacion en INSPECCIONES), solo complejidad.
-- ============================================================
CREATE POLICY "rls_anon_all_cap_datos_socio" ON public."CAP_DATOS_SOCIO"
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "rls_anon_all_cap_mic" ON public."CAP_MIC"
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "rls_anon_all_cap_conservacion" ON public."CAP_CONSERVACION"
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "rls_anon_all_cap_bienestar" ON public."CAP_BIENESTAR"
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "rls_anon_all_cap_riesgos" ON public."CAP_RIESGOS"
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "rls_anon_all_cap_gestion" ON public."CAP_GESTION"
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 5. PADRON_SOCIOS / PADRON_PARCELAS: SOLO lectura nueva para anon
-- (habilita el autocompletado). Escritura sigue exclusiva de
-- `authenticated` vía las políticas `rls_write_*` de Fase 3, sin cambios.
-- ============================================================
CREATE POLICY "rls_anon_select_padron_socios" ON public."PADRON_SOCIOS"
FOR SELECT TO anon
USING ("ID_Organizacion" IS NOT NULL);

CREATE POLICY "rls_anon_select_padron_parcelas" ON public."PADRON_PARCELAS"
FOR SELECT TO anon
USING ("ID_Organizacion" IS NOT NULL);

COMMIT;
