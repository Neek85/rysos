-- Normaliza el tipo de PADRON_PARCELAS.hbp y PADRON_PARCELAS.otros_cultivo
-- de text a numeric, alineando el schema real con lo que la aplicación ya
-- asume (lib/validations/socios.js las trata como numéricas desde
-- siempre, junto con hcp/hcc/ho/hip/hrp que sí son numeric en la
-- instancia real). Ver docs/adr/ADR-024-normaliza-tipo-hbp-otros-cultivo.md.
--
-- Primer intento (sin DROP/CREATE VIEW) falló en Supabase Studio:
-- "cannot alter type of a column used by a view or rule — rule _RETURN on
-- view vw_parcelas_web depends on column hbp". Corregido acá con evidencia
-- real capturada en vivo (pg_depend/pg_get_viewdef/GRANTs vía Supabase
-- Studio SQL Editor, no una suposición): vw_parcelas_web es la única
-- dependencia real de estas dos columnas (confirmado también por
-- introspección OpenAPI de PostgREST — ningún otro objeto expuesto toca
-- hbp/otros_cultivo heredados de PADRON_PARCELAS), security_invoker=on,
-- sin ninguna referencia en el código de este repo (grep literal, cero
-- resultados), con GRANTs completos (SELECT/INSERT/UPDATE/DELETE/
-- REFERENCES/TRIGGER/TRUNCATE) a anon/authenticated/service_role.
--
-- Verificación de solo lectura contra las 11 filas reales (2026-08-25):
-- todos los valores no nulos son strings enteros simples ('0'/'1') o NULL
-- — ningún string vacío, ninguna coma decimal, ningún texto no numérico.
-- El USING de abajo igual cubre esos casos (NULLIF(TRIM(x), '') convierte
-- un string vacío/solo-espacios en NULL en vez de tumbar la migración).
--
-- Idempotente: todo el bloque (DROP VIEW, ambos ALTER COLUMN, CREATE VIEW,
-- GRANTs) va envuelto en un chequeo contra information_schema.columns que
-- lo saltea completo si hbp ya es numeric — no-op garantizado en una
-- segunda corrida (no deja la vista recreada de más ni reaplica GRANTs
-- innecesariamente). No toca ninguna otra columna ni tabla.

BEGIN;

DO $$
BEGIN
    IF (
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'PADRON_PARCELAS' AND column_name = 'hbp'
    ) IS DISTINCT FROM 'numeric' THEN

        DROP VIEW IF EXISTS public.vw_parcelas_web;

        ALTER TABLE public."PADRON_PARCELAS"
            ALTER COLUMN hbp TYPE numeric USING NULLIF(TRIM(hbp), '')::numeric;
        ALTER TABLE public."PADRON_PARCELAS"
            ALTER COLUMN otros_cultivo TYPE numeric USING NULLIF(TRIM(otros_cultivo), '')::numeric;

        CREATE VIEW public.vw_parcelas_web
        WITH (security_invoker = true)
        AS
        SELECT "ID_Parcela_Fija",
            "ID_Organizacion",
            "ID_Socio",
            socio_dni,
            socio_nombre_completo,
            parcela_codigo,
            parcela_nombre,
            hcp,
            hcc,
            ho,
            hip,
            hrp,
            hbp,
            otros_cultivo,
            totalh,
            geom,
            creado_en,
            actualizado_en,
            creado_por
        FROM "PADRON_PARCELAS";

        GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
            ON public.vw_parcelas_web TO anon;
        GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
            ON public.vw_parcelas_web TO authenticated;
        GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
            ON public.vw_parcelas_web TO service_role;

    END IF;
END $$;

COMMIT;
