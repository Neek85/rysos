-- =====================================================================
-- FIX — vw_pecuario_reemplazo_reproductoras_anual: FROM anclado en la
-- CTE equivocada hacía desaparecer a una organización entera
-- Fecha: 2026-09-28
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (Sección 4.1.2): cubierta en el mismo
-- flujo, por haberse trabajado con Claude desde el principio.
--
-- HALLAZGO REAL DE LA CLI (Claude Code), 2026-09-28, verificación en vivo
-- de 20260928090000_pecuario_panel_indicadores_vistas.sql tras aplicarla:
-- la versión original de vw_pecuario_reemplazo_reproductoras_anual
-- anclaba su FROM en la CTE `activas` (hembras reproductoras con
-- estado IN ('activo','enfermo') HOY). Como el resto de las CTEs se
-- unían con LEFT JOIN *hacia* `activas`, una organización cuya ÚNICA
-- hembra reproductora activa se vende o muere en el período desaparece
-- POR COMPLETO de la vista -- ni la baja ni la tasa se muestran, aunque
-- bajas_mortalidad/bajas_venta sí tengan la fila. Es exactamente el caso
-- que un indicador de "tasa de reemplazo" más necesita mostrar (una
-- organización que se quedó sin reproductoras activas), y quedaba
-- invisible en silencio -- sin ningún error, sin ninguna fila en NULL,
-- directamente ausente. Confirmado por la CLI con una prueba manual
-- determinística (vender la única hembra activa de una organización de
-- prueba y observar que la fila entera desaparece de la vista).
--
-- Mismo bug-class que ya se corrigió antes en este módulo por anclar mal
-- un FROM/JOIN (ver vw_pecuario_poblacion_resumen, 20260924110000 --
-- ancla en una CTE `orgs` que es la UNION de las 4 tablas fuente,
-- precisamente para que una organización sin población en una categoría
-- no desaparezca de las demás).
--
-- FIX: se cambia el ancla del FROM de `activas` a un SELECT DISTINCT
-- directo sobre PECUARIO_REPRODUCTORES filtrado solo por sexo='hembra'
-- (sin filtrar por estado) -- cualquier organización que alguna vez tuvo
-- una hembra reproductora (activa hoy, vendida, muerta o enferma) sigue
-- apareciendo en la vista. Con esto:
--   - hembras_activas_actual puede ser 0 (organización sin reproductoras
--     activas hoy) sin que la fila desaparezca.
--   - tasa_reemplazo_pct pasa a NULL cuando hembras_activas_actual = 0
--     (vía NULLIF, ya existía) -- correcto: un % sobre una base de 0 no
--     tiene un valor con sentido, así que se deja NULL en vez de
--     inventar un 0% o un infinito. bajas_hembras_12m SÍ se sigue
--     mostrando con su valor real en ese caso -- ahí está el dato que
--     antes se perdía.
--
-- No cambia ninguna fórmula, ninguna otra columna, ninguna otra vista de
-- 20260928090000 -- CREATE OR REPLACE VIEW sobre la misma vista, mismas
-- columnas, mismos tipos. Idempotente.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.vw_pecuario_reemplazo_reproductoras_anual') IS NULL THEN
    RAISE EXCEPTION 'Falta vw_pecuario_reemplazo_reproductoras_anual (20260928090000). Corré primero esa migración -- este archivo la corrige, no la reemplaza desde cero.';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.vw_pecuario_reemplazo_reproductoras_anual AS
WITH bajas_mortalidad AS (
    SELECT r."ID_Organizacion", COALESCE(SUM(m.cantidad), 0) AS total
    FROM public."PECUARIO_MORTALIDAD" m
    JOIN public."PECUARIO_REPRODUCTORES" r ON r.id = m.animal_id
    WHERE r.sexo = 'hembra' AND m.fecha_evento >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY r."ID_Organizacion"
),
bajas_venta AS (
    SELECT r."ID_Organizacion", COALESCE(SUM(v.cantidad), 0) AS total
    FROM public."PECUARIO_VENTAS" v
    JOIN public."PECUARIO_REPRODUCTORES" r ON r.id = v.animal_id
    WHERE r.sexo = 'hembra' AND v.tipo_salida = 'reproductor_saca'
      AND v.fecha_venta >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY r."ID_Organizacion"
),
altas AS (
    SELECT "ID_Organizacion", COUNT(*) AS total
    FROM public."PECUARIO_REPRODUCTORES"
    WHERE sexo = 'hembra' AND created_at >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY "ID_Organizacion"
),
activas AS (
    SELECT "ID_Organizacion", COUNT(*) AS total
    FROM public."PECUARIO_REPRODUCTORES"
    WHERE sexo = 'hembra' AND estado IN ('activo', 'enfermo')
    GROUP BY "ID_Organizacion"
)
SELECT
    o."ID_Organizacion",
    COALESCE(alt.total, 0)::int AS altas_hembras_12m,
    (COALESCE(bm.total, 0) + COALESCE(bv.total, 0))::int AS bajas_hembras_12m,
    COALESCE(a.total, 0)::int AS hembras_activas_actual,
    ROUND((COALESCE(bm.total, 0) + COALESCE(bv.total, 0))::numeric / NULLIF(a.total, 0) * 100, 1) AS tasa_reemplazo_pct
FROM (SELECT DISTINCT "ID_Organizacion" FROM public."PECUARIO_REPRODUCTORES" WHERE sexo = 'hembra') o
LEFT JOIN activas a ON a."ID_Organizacion" = o."ID_Organizacion"
LEFT JOIN bajas_mortalidad bm ON bm."ID_Organizacion" = o."ID_Organizacion"
LEFT JOIN bajas_venta bv ON bv."ID_Organizacion" = o."ID_Organizacion"
LEFT JOIN altas alt ON alt."ID_Organizacion" = o."ID_Organizacion"
WHERE (o."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_reemplazo_reproductoras_anual IS
'Tasa de reemplazo anual de HEMBRAS reproductoras (spec §5.1, mismo tema que el ítem 8 del roadmap). bajas_hembras_12m = mortalidad + venta tipo reproductor_saca de los últimos 12 meses. tasa_reemplazo_pct = bajas_12m / hembras_activas_actual * 100 (denominador = stock actual, no promedio del período). altas_hembras_12m es informativo, no entra en la fórmula. FIX 2026-09-28 (20260928110000): el FROM ya no ancla en la CTE activas -- ancla en toda organización que alguna vez tuvo una hembra reproductora (PECUARIO_REPRODUCTORES, sexo=hembra, cualquier estado), para que una organización que se quedó sin hembras activas siga apareciendo (con hembras_activas_actual=0 y tasa_reemplazo_pct=NULL, en vez de desaparecer la fila entera).';

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT * FROM vw_pecuario_reemplazo_reproductoras_anual WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
--
-- Caso de control (el que encontró la CLI):
--   1. Organización de prueba con exactamente 1 hembra reproductora activa.
--   2. Venderla como 'reproductor_saca' (o registrar su mortalidad).
--   3. Confirmar que la organización SIGUE apareciendo en la vista, con
--      hembras_activas_actual=0, bajas_hembras_12m=1, tasa_reemplazo_pct=NULL
--      (antes del fix: la fila desaparecía por completo).
-- ---------------------------------------------------------------------
