-- Normaliza el tipo de PADRON_PARCELAS.hbp y PADRON_PARCELAS.otros_cultivo
-- de text a numeric, alineando el schema real con lo que la aplicación ya
-- asume (lib/validations/socios.js las trata como numéricas desde
-- siempre, junto con hcp/hcc/ho/hip/hrp que sí son numeric en la
-- instancia real). Ver docs/adr/ADR-024-normaliza-tipo-hbp-otros-cultivo.md.
--
-- Hallazgo surgido durante la auditoría en vivo de la migración base
-- (commit 6ff1daf, supabase/migrations/20260825183000_baseline_padron_socios_parcelas.sql)
-- y confirmado de nuevo en vivo (introspección OpenAPI de PostgREST,
-- 2026-08-25) inmediatamente antes de escribir este archivo: hbp/
-- otros_cultivo siguen en text hoy.
--
-- Verificación de solo lectura contra las 11 filas reales (2026-08-25):
-- todos los valores no nulos son strings enteros simples ('0'/'1') o NULL
-- — ningún string vacío, ninguna coma decimal, ningún texto no numérico.
-- El USING de abajo igual cubre esos casos (NULLIF(TRIM(x), '') convierte
-- un string vacío/solo-espacios en NULL en vez de tumbar la migración) por
-- si una fila futura, antes de que esta migración se aplique en un
-- entorno dado, llegara a tener uno.
--
-- Idempotente: cada ALTER COLUMN va envuelto en un chequeo contra
-- information_schema.columns que lo saltea si la columna ya es numeric —
-- no-op garantizado en una segunda corrida. No toca ninguna otra columna
-- ni tabla.

BEGIN;

DO $$
BEGIN
    IF (
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'PADRON_PARCELAS' AND column_name = 'hbp'
    ) IS DISTINCT FROM 'numeric' THEN
        ALTER TABLE public."PADRON_PARCELAS"
            ALTER COLUMN hbp TYPE numeric USING NULLIF(TRIM(hbp), '')::numeric;
    END IF;
END $$;

DO $$
BEGIN
    IF (
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'PADRON_PARCELAS' AND column_name = 'otros_cultivo'
    ) IS DISTINCT FROM 'numeric' THEN
        ALTER TABLE public."PADRON_PARCELAS"
            ALTER COLUMN otros_cultivo TYPE numeric USING NULLIF(TRIM(otros_cultivo), '')::numeric;
    END IF;
END $$;

COMMIT;
