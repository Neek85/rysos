-- Normaliza las certificaciones de PADRON_SOCIOS hacia 5 tablas nuevas.
-- Ver docs/adr/ADR-027-certificaciones-normalizadas.md,
-- specs/padron_certificaciones_normalizado.md (contrato de datos cerrado
-- en la sección 2, RLS/GRANTs a replicar en la sección 7) para el
-- diseño completo y toda la evidencia detrás de cada decisión.
--
-- Puramente ADITIVA: no toca ninguna columna existente de PADRON_SOCIOS/
-- PADRON_PARCELAS, ni ninguna vista (view_eudr_dashboard_aprobados/
-- vw_monitoreo_eudr_aprobado/vw_socios_web siguen leyendo
-- PADRON_SOCIOS.certificaciones exactamente igual que hoy). Las 8
-- columnas de flags + cert_org_estatus + certificaciones quedan
-- físicamente presentes en PADRON_SOCIOS, sin uso desde el código de
-- aplicación de acá en adelante, como respaldo -- decisión explícita,
-- ver specs/padron_certificaciones_normalizado.md sección 3. Su retiro
-- físico (DROP COLUMN) queda para una tarea de limpieza aparte.

BEGIN;

-- ============================================================
-- 1. Las 5 tablas nuevas -- contrato exacto de la spec, sección 2.
-- ============================================================
CREATE TABLE IF NOT EXISTS public."CERTIFICACIONES_CATALOGO" (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo     text NOT NULL UNIQUE,
    nombre     text NOT NULL,
    activo     boolean NOT NULL DEFAULT true,
    creado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."AGENCIAS_CERTIFICADORAS" (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre     text NOT NULL,
    activo     boolean NOT NULL DEFAULT true,
    creado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."ORGANIZACION_CERTIFICACIONES" (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_organizacion           text NOT NULL REFERENCES public."ORGANIZACIONES"("ID"),
    id_certificacion          uuid NOT NULL REFERENCES public."CERTIFICACIONES_CATALOGO"(id),
    id_agencia_certificadora  uuid REFERENCES public."AGENCIAS_CERTIFICADORAS"(id),
    fecha_obtencion           date,
    fecha_vencimiento         date,
    activo                    boolean NOT NULL DEFAULT true,
    creado_en                 timestamptz NOT NULL DEFAULT now(),
    actualizado_en            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_organizacion, id_certificacion)
);

-- id_organizacion denormalizado, sin FK propia -- se confía en que
-- siempre coincide con PADRON_SOCIOS."ID_Organizacion" vía id_socio,
-- mismo patrón ya usado en PADRON_PARCELAS.socio_dni/socio_nombre_completo.
CREATE TABLE IF NOT EXISTS public."SOCIO_CERTIFICACIONES" (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_socio          uuid NOT NULL REFERENCES public."PADRON_SOCIOS"(id),
    id_organizacion   text NOT NULL,
    id_certificacion  uuid NOT NULL REFERENCES public."CERTIFICACIONES_CATALOGO"(id),
    estado            text,
    creado_en         timestamptz NOT NULL DEFAULT now(),
    actualizado_en    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_socio, id_certificacion)
);

-- Presencia pura -- la fila existe = la parcela tiene esa certificación.
CREATE TABLE IF NOT EXISTS public."PARCELA_CERTIFICACIONES" (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_parcela        uuid NOT NULL REFERENCES public."PADRON_PARCELAS"(id),
    id_organizacion   text NOT NULL,
    id_certificacion  uuid NOT NULL REFERENCES public."CERTIFICACIONES_CATALOGO"(id),
    creado_en         timestamptz NOT NULL DEFAULT now(),
    actualizado_en    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_parcela, id_certificacion)
);

-- ============================================================
-- 2. RLS -- catálogos: lectura pública sin aislamiento (sin dato de
--    organización/socio/parcela, spec sección 7.4). Tablas de relación:
--    replica EXACTAMENTE la política anon de PADRON_SOCIOS/PADRON_PARCELAS
--    (spec sección 7.1) -- SELECT para anon scopeado por
--    "id_organizacion IS NOT NULL", sin política de escritura para anon
--    (las escrituras van por Server Action con Service Role Key).
-- ============================================================
ALTER TABLE public."CERTIFICACIONES_CATALOGO"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AGENCIAS_CERTIFICADORAS"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ORGANIZACION_CERTIFICACIONES"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SOCIO_CERTIFICACIONES"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PARCELA_CERTIFICACIONES"       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_anon_select_certificaciones_catalogo" ON public."CERTIFICACIONES_CATALOGO";
CREATE POLICY "rls_anon_select_certificaciones_catalogo" ON public."CERTIFICACIONES_CATALOGO"
FOR SELECT TO anon
USING (true);

DROP POLICY IF EXISTS "rls_anon_select_agencias_certificadoras" ON public."AGENCIAS_CERTIFICADORAS";
CREATE POLICY "rls_anon_select_agencias_certificadoras" ON public."AGENCIAS_CERTIFICADORAS"
FOR SELECT TO anon
USING (true);

DROP POLICY IF EXISTS "rls_anon_select_organizacion_certificaciones" ON public."ORGANIZACION_CERTIFICACIONES";
CREATE POLICY "rls_anon_select_organizacion_certificaciones" ON public."ORGANIZACION_CERTIFICACIONES"
FOR SELECT TO anon
USING (id_organizacion IS NOT NULL);

DROP POLICY IF EXISTS "rls_anon_select_socio_certificaciones" ON public."SOCIO_CERTIFICACIONES";
CREATE POLICY "rls_anon_select_socio_certificaciones" ON public."SOCIO_CERTIFICACIONES"
FOR SELECT TO anon
USING (id_organizacion IS NOT NULL);

DROP POLICY IF EXISTS "rls_anon_select_parcela_certificaciones" ON public."PARCELA_CERTIFICACIONES";
CREATE POLICY "rls_anon_select_parcela_certificaciones" ON public."PARCELA_CERTIFICACIONES"
FOR SELECT TO anon
USING (id_organizacion IS NOT NULL);

-- ============================================================
-- 3. GRANTs -- defensivo (spec sección 7.2: no hay GRANT explícito
--    versionado para PADRON_SOCIOS/PADRON_PARCELAS, ni forma de
--    confirmar el privilegio por defecto de Supabase sin SQL crudo; acá
--    sí se declara explícito para las tablas nuevas).
--
--    EXCEDE la instrucción original en un punto, documentado acá:
--    SOCIO_CERTIFICACIONES recibe además GRANT DELETE para service_role
--    -- lib/actions/sociosActions.js::updateSocio necesita poder quitar
--    una certificación desestildada en una edición (sincroniza el set
--    completo por socio en cada guardado), y la tabla no tiene columna
--    de baja lógica -- sin DELETE, "destildar" una certificación en el
--    formulario de edición sería imposible de guardar. Ver
--    docs/adr/ADR-027-certificaciones-normalizadas.md para el detalle.
-- ============================================================
GRANT SELECT ON public."CERTIFICACIONES_CATALOGO"    TO anon, authenticated;
GRANT SELECT ON public."AGENCIAS_CERTIFICADORAS"      TO anon, authenticated;
GRANT SELECT ON public."ORGANIZACION_CERTIFICACIONES" TO anon, authenticated;
GRANT SELECT ON public."SOCIO_CERTIFICACIONES"        TO anon, authenticated;
GRANT SELECT ON public."PARCELA_CERTIFICACIONES"      TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public."CERTIFICACIONES_CATALOGO"    TO service_role;
GRANT SELECT, INSERT, UPDATE ON public."AGENCIAS_CERTIFICADORAS"      TO service_role;
GRANT SELECT, INSERT, UPDATE ON public."ORGANIZACION_CERTIFICACIONES" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SOCIO_CERTIFICACIONES" TO service_role;
GRANT SELECT, INSERT, UPDATE ON public."PARCELA_CERTIFICACIONES"      TO service_role;

-- ============================================================
-- 4. Seed de CERTIFICACIONES_CATALOGO -- 8 filas, mapeo field/label
--    citado literal de specs/padron_certificaciones_normalizado.md
--    sección 7.3 (a su vez, lib/validations/socios.js::CERT_FLAG_FIELDS).
--    Idempotente: ON CONFLICT (codigo) DO NOTHING.
-- ============================================================
INSERT INTO public."CERTIFICACIONES_CATALOGO" (codigo, nombre) VALUES
    ('NOP_USDA',      'NOP USDA'),
    ('UE_2018_848',   'UE 2018/848'),
    ('COR_CANADA',    'COR Canadá'),
    ('DS_0442006_AG', 'DS 044-2006-AG'),
    ('LPO_MX',        'LPO México'),
    ('RAINFOREST',    'Rainforest Alliance'),
    ('COMERCIO_JUSTO','Comercio Justo'),
    ('FAIR_TRADE_USA','Fair Trade USA')
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================
-- 5. Backfill de SOCIO_CERTIFICACIONES -- por cada socio real x cada una
--    de las 8 columnas de flag en 'Sí', una fila nueva. estado toma
--    cert_org_estatus del socio SOLO para las 5 certificaciones de tipo
--    orgánico (NOP_USDA/UE_2018_848/COR_CANADA/DS_0442006_AG/LPO_MX,
--    ver spec sección 3.4) -- las otras 3 (Rainforest/Comercio Justo/
--    Fair Trade USA) quedan con estado NULL.
--
--    Idempotente por socio (no por fila): si SOCIO_CERTIFICACIONES ya
--    tiene AL MENOS UNA fila para un id_socio dado, ese socio se saltea
--    por completo en una segunda corrida -- no reinserta ni duplica.
-- ============================================================
INSERT INTO public."SOCIO_CERTIFICACIONES" (id_socio, id_organizacion, id_certificacion, estado)
SELECT
    ps.id,
    ps."ID_Organizacion",
    cat.id,
    CASE WHEN v.codigo IN ('NOP_USDA', 'UE_2018_848', 'COR_CANADA', 'DS_0442006_AG', 'LPO_MX')
         THEN ps.cert_org_estatus
         ELSE NULL
    END
FROM public."PADRON_SOCIOS" ps
CROSS JOIN LATERAL (VALUES
    ('NOP_USDA',       ps.cert_nop_usda),
    ('UE_2018_848',    ps.ue_2018_848),
    ('COR_CANADA',     ps.cor_canada),
    ('DS_0442006_AG',  ps.cert_ds_0442006_ag),
    ('LPO_MX',         ps.cert_lpo_mx),
    ('RAINFOREST',     ps.cert_rainforest),
    ('COMERCIO_JUSTO', ps.cert_comercio_justo),
    ('FAIR_TRADE_USA', ps.cert_fair_trade_usa)
) AS v(codigo, valor)
JOIN public."CERTIFICACIONES_CATALOGO" cat ON cat.codigo = v.codigo
WHERE v.valor = 'Sí'
  AND NOT EXISTS (
    SELECT 1 FROM public."SOCIO_CERTIFICACIONES" sc WHERE sc.id_socio = ps.id
  );

COMMIT;
