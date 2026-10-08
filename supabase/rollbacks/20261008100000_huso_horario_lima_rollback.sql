-- =====================================================================
-- supabase/rollbacks/20261008100000_huso_horario_lima_rollback.sql
-- REVIERTE la Migracion 1 del huso horario (America/Lima): las 8 vistas vuelven
-- al texto vivo previo (CURRENT_DATE, huso UTC). Fuente: pg_get_viewdef tomado en
-- solo lectura el 2026-10-07 21:07 hora de Lima (2026-10-08 02:07 UTC), antes de
-- aplicar; guardado fuera del repo en ~/ryzos_scratch/huso_antes/.
-- NO esta en supabase/migrations/ a proposito: no debe correr como migracion.
-- APLICACION MANUAL por Neyser en Supabase Studio. El CLI no aplica nada.
--
-- NOTAS
--   - Idempotente: solo CREATE OR REPLACE VIEW (conserva dueno, ACL y COMMENT).
--     No toca ningun GRANT/REVOKE.
--   - vw_pecuario_ventas_mes CONSERVA la columna animales_vendidos_mes: CREATE OR
--     REPLACE VIEW no puede quitar columnas. Se usa el texto previo con CURRENT_DATE
--     mas esa columna al final (misma expresion que la migracion).
--   - El COMMENT de ventas_mes (que menciona animales_vendidos_mes y Lima) no se
--     revierte: la columna sigue existiendo.
--   - Orden por dependencias: lotes_etapa primero (pesos_promedio_mes e
--     indicadores_sanitarios_mes dependen de ella, directa o via poblacion_resumen).
--   - Las funciones fn_hoy_operativo() y fn_fecha_operativa(timestamptz) NO se
--     eliminan aqui: ver el bloque comentado al final (solo tras revertir las vistas).
-- =====================================================================

BEGIN;

SET LOCAL search_path = public;

-- 1. vw_pecuario_lotes_etapa
CREATE OR REPLACE VIEW public.vw_pecuario_lotes_etapa AS
 SELECT id,
    "ID_Organizacion",
    codigo_lote,
    poza_actual_id,
    poza_origen_id,
    parto_origen_id,
    fecha_destete,
    cantidad_inicial,
    cantidad_actual,
    sexo,
    etapa,
    estado,
    device_id,
    created_offline_at,
    synced_at,
    created_at,
    updated_at,
        CASE
            WHEN ((etapa = 'recria'::etapa_productiva) AND ((estado)::text = 'activo'::text) AND ((CURRENT_DATE - fecha_destete) >= 56)) THEN 'engorde'::etapa_productiva
            ELSE etapa
        END AS etapa_calculada,
        CASE
            WHEN ((etapa = 'recria'::etapa_productiva) AND ((estado)::text = 'activo'::text) AND ((CURRENT_DATE - fecha_destete) < 56)) THEN (56 - (CURRENT_DATE - fecha_destete))
            ELSE NULL::integer
        END AS dias_para_engorde
   FROM "PECUARIO_LOTES" l
  WHERE (("ID_Organizacion" = auth_org_id()) OR (auth.role() = 'service_role'::text) OR (CURRENT_USER = 'postgres'::name));

-- 2. vw_pecuario_pesos_promedio_mes
CREATE OR REPLACE VIEW public.vw_pecuario_pesos_promedio_mes AS
 WITH primer_pesaje_lote AS (
         SELECT DISTINCT ON (pj.lote_id) pj.lote_id,
            pj.peso_promedio_g,
            pj.fecha_pesaje
           FROM "PECUARIO_PESAJES" pj
          WHERE (pj.lote_id IS NOT NULL)
          ORDER BY pj.lote_id, pj.fecha_pesaje, pj.created_at
        ), destete_mes AS (
         SELECT l."ID_Organizacion",
            sum((ppl.peso_promedio_g * (l.cantidad_inicial)::numeric)) AS suma_ponderada,
            sum(l.cantidad_inicial) AS total_animales
           FROM ("PECUARIO_LOTES" l
             JOIN primer_pesaje_lote ppl ON ((ppl.lote_id = l.id)))
          WHERE ((l.recoleccion_origen_id IS NOT NULL) AND (l.fecha_destete >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)) AND (l.fecha_destete < (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval)))
          GROUP BY l."ID_Organizacion"
        ), ultimo_pesaje_lote AS (
         SELECT DISTINCT ON (pj.lote_id) pj.lote_id,
            pj.peso_promedio_g
           FROM "PECUARIO_PESAJES" pj
          WHERE (pj.lote_id IS NOT NULL)
          ORDER BY pj.lote_id, pj.fecha_pesaje DESC, pj.created_at DESC
        ), engorde_actual AS (
         SELECT le."ID_Organizacion",
            sum((upl.peso_promedio_g * (le.cantidad_actual)::numeric)) AS suma_ponderada,
            sum(le.cantidad_actual) AS total_animales
           FROM (vw_pecuario_lotes_etapa le
             JOIN ultimo_pesaje_lote upl ON ((upl.lote_id = le.id)))
          WHERE (le.etapa_calculada = 'engorde'::etapa_productiva)
          GROUP BY le."ID_Organizacion"
        )
 SELECT o."ID_Organizacion",
    round((dm.suma_ponderada / (NULLIF(dm.total_animales, 0))::numeric), 1) AS peso_promedio_destete_g_mes,
    round((ea.suma_ponderada / (NULLIF(ea.total_animales, 0))::numeric), 1) AS peso_promedio_engorde_g_actual
   FROM ((( SELECT DISTINCT "PECUARIO_LOTES"."ID_Organizacion"
           FROM "PECUARIO_LOTES") o
     LEFT JOIN destete_mes dm ON ((dm."ID_Organizacion" = o."ID_Organizacion")))
     LEFT JOIN engorde_actual ea ON ((ea."ID_Organizacion" = o."ID_Organizacion")))
  WHERE ((o."ID_Organizacion" = auth_org_id()) OR (auth.role() = 'service_role'::text) OR (CURRENT_USER = 'postgres'::name));

-- 3. vw_pecuario_indicadores_sanitarios_mes
CREATE OR REPLACE VIEW public.vw_pecuario_indicadores_sanitarios_mes AS
 WITH mort_mes AS (
         SELECT "PECUARIO_MORTALIDAD"."ID_Organizacion",
            COALESCE(sum("PECUARIO_MORTALIDAD".cantidad) FILTER (WHERE ("PECUARIO_MORTALIDAD".etapa = 'lactancia'::etapa_productiva)), (0)::bigint) AS muertes_lactancia,
            COALESCE(sum("PECUARIO_MORTALIDAD".cantidad) FILTER (WHERE ("PECUARIO_MORTALIDAD".etapa = ANY (ARRAY['recria'::etapa_productiva, 'engorde'::etapa_productiva]))), (0)::bigint) AS muertes_recria_engorde
           FROM "PECUARIO_MORTALIDAD"
          WHERE (("PECUARIO_MORTALIDAD".fecha_evento >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)) AND ("PECUARIO_MORTALIDAD".fecha_evento < (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval)))
          GROUP BY "PECUARIO_MORTALIDAD"."ID_Organizacion"
        ), mort_reproductores_12m AS (
         SELECT "PECUARIO_MORTALIDAD"."ID_Organizacion",
            COALESCE(sum("PECUARIO_MORTALIDAD".cantidad), (0)::bigint) AS muertes
           FROM "PECUARIO_MORTALIDAD"
          WHERE (("PECUARIO_MORTALIDAD".etapa = 'reproductor'::etapa_productiva) AND ("PECUARIO_MORTALIDAD".fecha_evento >= (CURRENT_DATE - '1 year'::interval)))
          GROUP BY "PECUARIO_MORTALIDAD"."ID_Organizacion"
        ), poblacion AS (
         SELECT vw_pecuario_poblacion_resumen."ID_Organizacion",
            vw_pecuario_poblacion_resumen.total_lactancia,
            (vw_pecuario_poblacion_resumen.total_recria + vw_pecuario_poblacion_resumen.total_engorde) AS total_recria_engorde,
            vw_pecuario_poblacion_resumen.total_reproductores
           FROM vw_pecuario_poblacion_resumen
        )
 SELECT p."ID_Organizacion",
    (COALESCE(mm.muertes_lactancia, (0)::bigint))::integer AS muertes_lactancia_mes,
    round((((COALESCE(mm.muertes_lactancia, (0)::bigint))::numeric / (NULLIF(p.total_lactancia, 0))::numeric) * (100)::numeric), 1) AS mortalidad_lactancia_pct_mes,
    (COALESCE(mm.muertes_recria_engorde, (0)::bigint))::integer AS muertes_recria_engorde_mes,
    round((((COALESCE(mm.muertes_recria_engorde, (0)::bigint))::numeric / (NULLIF(p.total_recria_engorde, 0))::numeric) * (100)::numeric), 1) AS mortalidad_recria_engorde_pct_mes,
    (COALESCE(mr.muertes, (0)::bigint))::integer AS muertes_reproductores_12m,
    round((((COALESCE(mr.muertes, (0)::bigint))::numeric / (NULLIF(p.total_reproductores, 0))::numeric) * (100)::numeric), 1) AS mortalidad_reproductores_pct_anual
   FROM ((poblacion p
     LEFT JOIN mort_mes mm ON ((mm."ID_Organizacion" = p."ID_Organizacion")))
     LEFT JOIN mort_reproductores_12m mr ON ((mr."ID_Organizacion" = p."ID_Organizacion")))
  WHERE ((p."ID_Organizacion" = auth_org_id()) OR (auth.role() = 'service_role'::text) OR (CURRENT_USER = 'postgres'::name));

-- 4. vw_pecuario_reproduccion_mes
CREATE OR REPLACE VIEW public.vw_pecuario_reproduccion_mes AS
 SELECT "ID_Organizacion",
    (count(*))::integer AS partos_mes,
    (COALESCE(sum(n_vivos), (0)::bigint))::integer AS crias_vivas_total_mes,
    round(((COALESCE(sum(n_vivos), (0)::bigint))::numeric / (NULLIF(count(*), 0))::numeric), 2) AS crias_vivas_promedio_parto,
    round(((sum(peso_total_camada_g) FILTER (WHERE (peso_total_camada_g IS NOT NULL)))::numeric / (NULLIF(sum(n_vivos) FILTER (WHERE (peso_total_camada_g IS NOT NULL)), 0))::numeric), 1) AS peso_promedio_nacimiento_g,
    (count(*) FILTER (WHERE (peso_total_camada_g IS NOT NULL)))::integer AS partos_con_peso_registrado
   FROM "PECUARIO_PARTOS" p
  WHERE ((fecha_parto >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)) AND (fecha_parto < (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval)) AND (("ID_Organizacion" = auth_org_id()) OR (auth.role() = 'service_role'::text) OR (CURRENT_USER = 'postgres'::name)))
  GROUP BY "ID_Organizacion";

-- 5. vw_pecuario_intervalo_partos
CREATE OR REPLACE VIEW public.vw_pecuario_intervalo_partos AS
 WITH partos_con_madre AS (
         SELECT p."ID_Organizacion",
            p.madre_id,
            p.fecha_parto,
            (p.fecha_parto - lag(p.fecha_parto) OVER (PARTITION BY p.madre_id ORDER BY p.fecha_parto)) AS dias_desde_anterior
           FROM "PECUARIO_PARTOS" p
          WHERE (p.madre_id IS NOT NULL)
        )
 SELECT o."ID_Organizacion",
    round(avg(pcm.dias_desde_anterior), 1) AS intervalo_promedio_dias_individual,
    count(DISTINCT pcm.madre_id) FILTER (WHERE (pcm.dias_desde_anterior IS NOT NULL)) AS madres_con_intervalo_calculado,
    ( SELECT count(*) AS count
           FROM "PECUARIO_PARTOS" pp
          WHERE ((pp."ID_Organizacion" = o."ID_Organizacion") AND (pp.fecha_parto >= (CURRENT_DATE - '1 year'::interval)))) AS partos_ultimos_12m_total,
    ( SELECT count(*) AS count
           FROM "PECUARIO_REPRODUCTORES" r
          WHERE ((r."ID_Organizacion" = o."ID_Organizacion") AND (r.sexo = 'hembra'::sexo_cuy) AND (r.estado = ANY (ARRAY['activo'::estado_animal, 'enfermo'::estado_animal])))) AS hembras_activas_actual
   FROM (( SELECT DISTINCT "PECUARIO_PARTOS"."ID_Organizacion"
           FROM "PECUARIO_PARTOS") o
     LEFT JOIN partos_con_madre pcm ON ((pcm."ID_Organizacion" = o."ID_Organizacion")))
  WHERE ((o."ID_Organizacion" = auth_org_id()) OR (auth.role() = 'service_role'::text) OR (CURRENT_USER = 'postgres'::name))
  GROUP BY o."ID_Organizacion";

-- 6. vw_pecuario_reemplazo_reproductoras_anual
CREATE OR REPLACE VIEW public.vw_pecuario_reemplazo_reproductoras_anual AS
 WITH bajas_mortalidad AS (
         SELECT r."ID_Organizacion",
            COALESCE(sum(m.cantidad), (0)::bigint) AS total
           FROM ("PECUARIO_MORTALIDAD" m
             JOIN "PECUARIO_REPRODUCTORES" r ON ((r.id = m.animal_id)))
          WHERE ((r.sexo = 'hembra'::sexo_cuy) AND (m.fecha_evento >= (CURRENT_DATE - '1 year'::interval)))
          GROUP BY r."ID_Organizacion"
        ), bajas_venta AS (
         SELECT r."ID_Organizacion",
            COALESCE(sum(v.cantidad), (0)::bigint) AS total
           FROM ("PECUARIO_VENTAS" v
             JOIN "PECUARIO_REPRODUCTORES" r ON ((r.id = v.animal_id)))
          WHERE ((r.sexo = 'hembra'::sexo_cuy) AND (v.tipo_salida = 'reproductor_saca'::tipo_venta_cuy) AND (v.fecha_venta >= (CURRENT_DATE - '1 year'::interval)))
          GROUP BY r."ID_Organizacion"
        ), altas AS (
         SELECT "PECUARIO_REPRODUCTORES"."ID_Organizacion",
            count(*) AS total
           FROM "PECUARIO_REPRODUCTORES"
          WHERE (("PECUARIO_REPRODUCTORES".sexo = 'hembra'::sexo_cuy) AND ("PECUARIO_REPRODUCTORES".created_at >= (CURRENT_DATE - '1 year'::interval)))
          GROUP BY "PECUARIO_REPRODUCTORES"."ID_Organizacion"
        ), activas AS (
         SELECT "PECUARIO_REPRODUCTORES"."ID_Organizacion",
            count(*) AS total
           FROM "PECUARIO_REPRODUCTORES"
          WHERE (("PECUARIO_REPRODUCTORES".sexo = 'hembra'::sexo_cuy) AND ("PECUARIO_REPRODUCTORES".estado = ANY (ARRAY['activo'::estado_animal, 'enfermo'::estado_animal])))
          GROUP BY "PECUARIO_REPRODUCTORES"."ID_Organizacion"
        )
 SELECT o."ID_Organizacion",
    (COALESCE(alt.total, (0)::bigint))::integer AS altas_hembras_12m,
    ((COALESCE(bm.total, (0)::bigint) + COALESCE(bv.total, (0)::bigint)))::integer AS bajas_hembras_12m,
    (COALESCE(a.total, (0)::bigint))::integer AS hembras_activas_actual,
    round(((((COALESCE(bm.total, (0)::bigint) + COALESCE(bv.total, (0)::bigint)))::numeric / (NULLIF(a.total, 0))::numeric) * (100)::numeric), 1) AS tasa_reemplazo_pct
   FROM ((((( SELECT DISTINCT "PECUARIO_REPRODUCTORES"."ID_Organizacion"
           FROM "PECUARIO_REPRODUCTORES"
          WHERE ("PECUARIO_REPRODUCTORES".sexo = 'hembra'::sexo_cuy)) o
     LEFT JOIN activas a ON ((a."ID_Organizacion" = o."ID_Organizacion")))
     LEFT JOIN bajas_mortalidad bm ON ((bm."ID_Organizacion" = o."ID_Organizacion")))
     LEFT JOIN bajas_venta bv ON ((bv."ID_Organizacion" = o."ID_Organizacion")))
     LEFT JOIN altas alt ON ((alt."ID_Organizacion" = o."ID_Organizacion")))
  WHERE ((o."ID_Organizacion" = auth_org_id()) OR (auth.role() = 'service_role'::text) OR (CURRENT_USER = 'postgres'::name));

-- 7. vw_pecuario_incidencia_patologias
CREATE OR REPLACE VIEW public.vw_pecuario_incidencia_patologias AS
 WITH base AS (
         SELECT "PECUARIO_MORTALIDAD"."ID_Organizacion",
            "PECUARIO_MORTALIDAD".causa,
            sum("PECUARIO_MORTALIDAD".cantidad) AS total
           FROM "PECUARIO_MORTALIDAD"
          WHERE (("PECUARIO_MORTALIDAD".fecha_evento >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)) AND ("PECUARIO_MORTALIDAD".fecha_evento < (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval)))
          GROUP BY "PECUARIO_MORTALIDAD"."ID_Organizacion", "PECUARIO_MORTALIDAD".causa
        ), totales AS (
         SELECT base."ID_Organizacion",
            sum(base.total) AS total_mes
           FROM base
          GROUP BY base."ID_Organizacion"
        )
 SELECT b."ID_Organizacion",
    b.causa,
    (b.total)::integer AS cantidad_mes,
    round((((b.total)::numeric / NULLIF(t.total_mes, (0)::numeric)) * (100)::numeric), 1) AS porcentaje_mes
   FROM (base b
     JOIN totales t ON ((t."ID_Organizacion" = b."ID_Organizacion")))
  WHERE ((b."ID_Organizacion" = auth_org_id()) OR (auth.role() = 'service_role'::text) OR (CURRENT_USER = 'postgres'::name));

-- 8. vw_pecuario_ventas_mes (CONSERVA animales_vendidos_mes)
CREATE OR REPLACE VIEW public.vw_pecuario_ventas_mes AS
 SELECT "ID_Organizacion",
    (count(*))::integer AS ventas_mes,
    (COALESCE(sum(precio_total), (0)::numeric))::numeric(12,2) AS monto_total_mes,
    (COALESCE(sum(peso_total_kg), (0)::numeric))::numeric(10,2) AS kg_vendidos_mes,
    round(avg(rendimiento_carcasa_pct) FILTER (WHERE (rendimiento_carcasa_pct IS NOT NULL)), 1) AS rendimiento_carcasa_promedio_pct,
    (count(*) FILTER (WHERE (rendimiento_carcasa_pct IS NOT NULL)))::integer AS ventas_con_rendimiento_registrado,
    COALESCE(sum(cantidad) FILTER (WHERE tipo_salida <> 'guano'::tipo_venta_cuy), 0)::integer AS animales_vendidos_mes
   FROM "PECUARIO_VENTAS" v
  WHERE ((fecha_venta >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)) AND (fecha_venta < (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval)) AND (("ID_Organizacion" = auth_org_id()) OR (auth.role() = 'service_role'::text) OR (CURRENT_USER = 'postgres'::name)))
  GROUP BY "ID_Organizacion";

COMMIT;

-- ---------------------------------------------------------------------
-- SOLO TRAS REVERTIR LAS VISTAS (dependen de las funciones). Descomentar a mano.
-- ---------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.fn_hoy_operativo();
-- DROP FUNCTION IF EXISTS public.fn_fecha_operativa(timestamptz);
