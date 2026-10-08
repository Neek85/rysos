-- =====================================================================
-- 20261008100000_huso_horario_lima_vistas_pecuario.sql
-- MIGRACION 1 de 2 - Huso horario operativo (America/Lima) en vistas Pecuario
-- =====================================================================
-- PROBLEMA
--   La base corre en UTC y 8 vistas Pecuario usan CURRENT_DATE. Entre las
--   19:00 y las 24:00 hora de Lima, CURRENT_DATE ya es "manana" (UTC), asi que
--   "mes", "ultimos 12 meses" y "56 dias desde destete" se calculan con un dia
--   de adelanto. Lima es UTC-5 fijo (sin horario de verano).
--
-- QUE HACE ESTA MIGRACION
--   1. Crea fn_fecha_operativa(timestamptz) y fn_hoy_operativo() (fecha de
--      calendario en America/Lima). LANGUAGE sql, STABLE, sin SECURITY DEFINER,
--      sin SET, sin argumentos en fn_hoy_operativo => el planner las inlinea.
--   2. Reescribe 8 vistas con CREATE OR REPLACE VIEW. El texto es el de
--      pg_get_viewdef en vivo (reporte de reconocimiento 2026-10-08); SOLO
--      cambian las expresiones de fecha. Mismas columnas, mismo orden, mismos
--      tipos. Unica columna nueva: vw_pecuario_ventas_mes.animales_vendidos_mes
--      (al final).
--        lotes_etapa, reproduccion_mes, intervalo_partos,
--        reemplazo_reproductoras_anual, indicadores_sanitarios_mes,
--        incidencia_patologias, pesos_promedio_mes, ventas_mes
--   3. Actualiza el COMMENT de ventas_mes (agrega la columna nueva, conserva el
--      texto previo; idempotente).
--
-- QUE NO HACE (Migracion 2, aparte)
--   - Los ~15-16 DEFAULT CURRENT_DATE de columnas date de Pecuario.
--   - Las funciones fn_cerrar_historial_macho_anterior,
--     fn_crear_insumo_con_stock_inicial y trg_resolver_retiro_macho_pendiente.
--   - Las vistas SUPERADA (desinfeccion_estado, limpieza_galpon_estado) y
--     retiros_macho_pendientes.
--   - NO toca permisos de las vistas (el hallazgo de escritura anonima en
--     vistas auto-actualizables es una migracion de seguridad separada).
--   Las vistas poblacion_resumen, indicadores_sanitarios_mes (su parte de
--   poblacion), pesos_promedio_mes (su parte de engorde), ocupacion_poza y
--   seguimiento_* dependen de lotes_etapa pero no necesitan cambio de texto.
--
-- PERMISOS DE LAS VISTAS
--   CREATE OR REPLACE VIEW conserva dueno (postgres), ACL y COMMENT. No se
--   re-aplica ningun GRANT sobre las vistas. Las vistas corren con privilegios
--   del dueno, pero las FUNCIONES invocadas desde la vista se chequean contra el
--   rol que consulta: por eso fn_hoy_operativo()/fn_fecha_operativa() reciben
--   EXECUTE para anon, authenticated y service_role.
--
-- DETALLES DE SQL
--   - date_trunc('month', <date>) resuelve al overload timestamptz y depende
--     del huso de sesion; por eso se castea a ::timestamp y se vuelve a ::date.
--     Toda la aritmetica de ventanas queda en fechas puras.
--   - La CTE altas (reemplazo) compara created_at (timestamptz) contra la
--     fecha: se convierte created_at a fecha de Lima con fn_fecha_operativa().
--   - search_path fijo a public dentro de la transaccion (SET LOCAL) para que
--     auth_org_id() y los tipos enum se resuelvan igual que en el texto vivo.
--
-- SEGURIDAD / GUARDAS
--   - Guarda previa: aborta si la lista de columnas de alguna de las 8 vistas
--     difiere de la esperada (deriva de esquema). ventas_mes acepta 6 columnas
--     (antes) o 7 (despues, para poder re-ejecutar la migracion).
--   - Idempotente: CREATE OR REPLACE FUNCTION / VIEW, REVOKE/GRANT repetibles,
--     COMMENT condicionado.
--   - Todo en una transaccion: si algo falla, no queda nada a medias.
--
-- ROLLBACK
--   - Vistas: re-ejecutar los CREATE OR REPLACE VIEW con el texto "antes" que
--     el CLI guarda en el snapshot previo (pg_get_viewdef de las 8 vistas),
--     generado ANTES de aplicar. Es un archivo de reversa, no una migracion.
--   - La columna animales_vendidos_mes de ventas_mes NO se puede quitar con
--     CREATE OR REPLACE VIEW; dejarla es inocuo (no la usa nadie hasta el panel).
--     Quitarla exigiria DROP VIEW + recrear + re-aplicar dueno, ACL y COMMENT:
--     no se hace salvo necesidad real.
--   - Funciones: DROP FUNCTION solo despues de revertir las vistas (dependen).
--
-- APLICACION: MANUAL por Neyser en Supabase Studio, DESPUES de la revision de
-- seguridad. El CLI NO aplica nada contra ninguna base de datos.
-- Redacto: Claude (Cowork) como Arquitecto Senior RYZOS. Revision de seguridad:
-- pendiente de ejecucion (ver docs/ESTADO_PROYECTO.md).
-- =====================================================================

BEGIN;

SET LOCAL search_path = public;

-- ---------------------------------------------------------------------
-- 0. GUARDA: la forma (columnas y orden) de las 8 vistas es la esperada
-- ---------------------------------------------------------------------
DO $guarda$
DECLARE
  v_esperado jsonb := jsonb_build_object(
    'vw_pecuario_lotes_etapa', 'id,ID_Organizacion,codigo_lote,poza_actual_id,poza_origen_id,parto_origen_id,fecha_destete,cantidad_inicial,cantidad_actual,sexo,etapa,estado,device_id,created_offline_at,synced_at,created_at,updated_at,etapa_calculada,dias_para_engorde',
    'vw_pecuario_reproduccion_mes', 'ID_Organizacion,partos_mes,crias_vivas_total_mes,crias_vivas_promedio_parto,peso_promedio_nacimiento_g,partos_con_peso_registrado',
    'vw_pecuario_intervalo_partos', 'ID_Organizacion,intervalo_promedio_dias_individual,madres_con_intervalo_calculado,partos_ultimos_12m_total,hembras_activas_actual',
    'vw_pecuario_reemplazo_reproductoras_anual', 'ID_Organizacion,altas_hembras_12m,bajas_hembras_12m,hembras_activas_actual,tasa_reemplazo_pct',
    'vw_pecuario_indicadores_sanitarios_mes', 'ID_Organizacion,muertes_lactancia_mes,mortalidad_lactancia_pct_mes,muertes_recria_engorde_mes,mortalidad_recria_engorde_pct_mes,muertes_reproductores_12m,mortalidad_reproductores_pct_anual',
    'vw_pecuario_incidencia_patologias', 'ID_Organizacion,causa,cantidad_mes,porcentaje_mes',
    'vw_pecuario_pesos_promedio_mes', 'ID_Organizacion,peso_promedio_destete_g_mes,peso_promedio_engorde_g_actual',
    'vw_pecuario_ventas_mes', 'ID_Organizacion,ventas_mes,monto_total_mes,kg_vendidos_mes,rendimiento_carcasa_promedio_pct,ventas_con_rendimiento_registrado'
  );
  v_vista text;
  v_cols  text;
  v_exp   text;
BEGIN
  FOR v_vista, v_exp IN SELECT key, value #>> '{}' FROM jsonb_each(v_esperado) LOOP
    SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
      INTO v_cols
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.' || v_vista)
       AND a.attnum > 0
       AND NOT a.attisdropped;

    IF v_cols IS NULL THEN
      RAISE EXCEPTION 'Guarda huso horario: la vista public.% no existe', v_vista;
    END IF;

    -- ventas_mes puede estar ya migrada (7 columnas): se acepta antes o despues.
    IF v_vista = 'vw_pecuario_ventas_mes'
       AND v_cols = v_exp || ',animales_vendidos_mes' THEN
      CONTINUE;
    END IF;

    IF v_cols IS DISTINCT FROM v_exp THEN
      RAISE EXCEPTION 'Guarda huso horario: deriva de esquema en public.% (esperado: %; actual: %)',
        v_vista, v_exp, v_cols;
    END IF;
  END LOOP;
END
$guarda$;

-- ---------------------------------------------------------------------
-- 1. FUNCIONES DE FECHA OPERATIVA (America/Lima)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_fecha_operativa(p_ts timestamptz)
RETURNS date
LANGUAGE sql
STABLE
AS $$ SELECT (p_ts AT TIME ZONE 'America/Lima')::date $$;

CREATE OR REPLACE FUNCTION public.fn_hoy_operativo()
RETURNS date
LANGUAGE sql
STABLE
AS $$ SELECT public.fn_fecha_operativa(now()) $$;

REVOKE ALL ON FUNCTION public.fn_fecha_operativa(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_hoy_operativo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_fecha_operativa(timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_hoy_operativo() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.fn_fecha_operativa(timestamptz) IS
  'Fecha de calendario en America/Lima (UTC-5 fijo, sin DST) de un instante. Usar en vistas/consultas Pecuario en lugar de CURRENT_DATE o ::date sobre timestamptz. STABLE, sin SECURITY DEFINER ni SET: el planner la inlinea.';
COMMENT ON FUNCTION public.fn_hoy_operativo() IS
  'Hoy en America/Lima (date). Reemplaza CURRENT_DATE en vistas Pecuario: la base corre en UTC y entre 19:00 y 24:00 de Lima CURRENT_DATE ya es manana. STABLE, sin argumentos, sin SECURITY DEFINER ni SET: el planner la inlinea.';

-- ---------------------------------------------------------------------
-- 2. VISTAS (orden por dependencias: lotes_etapa primero)
-- ---------------------------------------------------------------------

-- 2.1 vw_pecuario_lotes_etapa  (56 dias desde destete, en fechas de Lima)
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
            WHEN etapa = 'recria'::etapa_productiva AND estado::text = 'activo'::text AND (public.fn_hoy_operativo() - fecha_destete) >= 56 THEN 'engorde'::etapa_productiva
            ELSE etapa
        END AS etapa_calculada,
        CASE
            WHEN etapa = 'recria'::etapa_productiva AND estado::text = 'activo'::text AND (public.fn_hoy_operativo() - fecha_destete) < 56 THEN 56 - (public.fn_hoy_operativo() - fecha_destete)
            ELSE NULL::integer
        END AS dias_para_engorde
   FROM "PECUARIO_LOTES" l
  WHERE "ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role'::text OR CURRENT_USER = 'postgres'::name;

-- 2.2 vw_pecuario_reproduccion_mes  (mes calendario de Lima)
CREATE OR REPLACE VIEW public.vw_pecuario_reproduccion_mes AS
 SELECT "ID_Organizacion",
    count(*)::integer AS partos_mes,
    COALESCE(sum(n_vivos), 0::bigint)::integer AS crias_vivas_total_mes,
    round(COALESCE(sum(n_vivos), 0::bigint)::numeric / NULLIF(count(*), 0)::numeric, 2) AS crias_vivas_promedio_parto,
    round(sum(peso_total_camada_g) FILTER (WHERE peso_total_camada_g IS NOT NULL)::numeric / NULLIF(sum(n_vivos) FILTER (WHERE peso_total_camada_g IS NOT NULL), 0)::numeric, 1) AS peso_promedio_nacimiento_g,
    count(*) FILTER (WHERE peso_total_camada_g IS NOT NULL)::integer AS partos_con_peso_registrado
   FROM "PECUARIO_PARTOS" p
  WHERE fecha_parto >= date_trunc('month'::text, public.fn_hoy_operativo()::timestamp)::date AND fecha_parto < (date_trunc('month'::text, public.fn_hoy_operativo()::timestamp) + '1 mon'::interval)::date AND ("ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role'::text OR CURRENT_USER = 'postgres'::name)
  GROUP BY "ID_Organizacion";

-- 2.3 vw_pecuario_intervalo_partos  (ultimos 12 meses desde hoy de Lima)
CREATE OR REPLACE VIEW public.vw_pecuario_intervalo_partos AS
 WITH partos_con_madre AS (
         SELECT p."ID_Organizacion",
            p.madre_id,
            p.fecha_parto,
            p.fecha_parto - lag(p.fecha_parto) OVER (PARTITION BY p.madre_id ORDER BY p.fecha_parto) AS dias_desde_anterior
           FROM "PECUARIO_PARTOS" p
          WHERE p.madre_id IS NOT NULL
        )
 SELECT o."ID_Organizacion",
    round(avg(pcm.dias_desde_anterior), 1) AS intervalo_promedio_dias_individual,
    count(DISTINCT pcm.madre_id) FILTER (WHERE pcm.dias_desde_anterior IS NOT NULL) AS madres_con_intervalo_calculado,
    ( SELECT count(*) AS count
           FROM "PECUARIO_PARTOS" pp
          WHERE pp."ID_Organizacion" = o."ID_Organizacion" AND pp.fecha_parto >= (public.fn_hoy_operativo() - '1 year'::interval)::date) AS partos_ultimos_12m_total,
    ( SELECT count(*) AS count
           FROM "PECUARIO_REPRODUCTORES" r
          WHERE r."ID_Organizacion" = o."ID_Organizacion" AND r.sexo = 'hembra'::sexo_cuy AND (r.estado = ANY (ARRAY['activo'::estado_animal, 'enfermo'::estado_animal]))) AS hembras_activas_actual
   FROM ( SELECT DISTINCT "PECUARIO_PARTOS"."ID_Organizacion"
           FROM "PECUARIO_PARTOS") o
     LEFT JOIN partos_con_madre pcm ON pcm."ID_Organizacion" = o."ID_Organizacion"
  WHERE o."ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role'::text OR CURRENT_USER = 'postgres'::name
  GROUP BY o."ID_Organizacion";

-- 2.4 vw_pecuario_reemplazo_reproductoras_anual  (12 meses; altas por created_at en fecha de Lima)
CREATE OR REPLACE VIEW public.vw_pecuario_reemplazo_reproductoras_anual AS
 WITH bajas_mortalidad AS (
         SELECT r."ID_Organizacion",
            COALESCE(sum(m.cantidad), 0::bigint) AS total
           FROM "PECUARIO_MORTALIDAD" m
             JOIN "PECUARIO_REPRODUCTORES" r ON r.id = m.animal_id
          WHERE r.sexo = 'hembra'::sexo_cuy AND m.fecha_evento >= (public.fn_hoy_operativo() - '1 year'::interval)::date
          GROUP BY r."ID_Organizacion"
        ), bajas_venta AS (
         SELECT r."ID_Organizacion",
            COALESCE(sum(v.cantidad), 0::bigint) AS total
           FROM "PECUARIO_VENTAS" v
             JOIN "PECUARIO_REPRODUCTORES" r ON r.id = v.animal_id
          WHERE r.sexo = 'hembra'::sexo_cuy AND v.tipo_salida = 'reproductor_saca'::tipo_venta_cuy AND v.fecha_venta >= (public.fn_hoy_operativo() - '1 year'::interval)::date
          GROUP BY r."ID_Organizacion"
        ), altas AS (
         SELECT "PECUARIO_REPRODUCTORES"."ID_Organizacion",
            count(*) AS total
           FROM "PECUARIO_REPRODUCTORES"
          WHERE "PECUARIO_REPRODUCTORES".sexo = 'hembra'::sexo_cuy AND public.fn_fecha_operativa("PECUARIO_REPRODUCTORES".created_at) >= (public.fn_hoy_operativo() - '1 year'::interval)::date
          GROUP BY "PECUARIO_REPRODUCTORES"."ID_Organizacion"
        ), activas AS (
         SELECT "PECUARIO_REPRODUCTORES"."ID_Organizacion",
            count(*) AS total
           FROM "PECUARIO_REPRODUCTORES"
          WHERE "PECUARIO_REPRODUCTORES".sexo = 'hembra'::sexo_cuy AND ("PECUARIO_REPRODUCTORES".estado = ANY (ARRAY['activo'::estado_animal, 'enfermo'::estado_animal]))
          GROUP BY "PECUARIO_REPRODUCTORES"."ID_Organizacion"
        )
 SELECT o."ID_Organizacion",
    COALESCE(alt.total, 0::bigint)::integer AS altas_hembras_12m,
    (COALESCE(bm.total, 0::bigint) + COALESCE(bv.total, 0::bigint))::integer AS bajas_hembras_12m,
    COALESCE(a.total, 0::bigint)::integer AS hembras_activas_actual,
    round((COALESCE(bm.total, 0::bigint) + COALESCE(bv.total, 0::bigint))::numeric / NULLIF(a.total, 0)::numeric * 100::numeric, 1) AS tasa_reemplazo_pct
   FROM ( SELECT DISTINCT "PECUARIO_REPRODUCTORES"."ID_Organizacion"
           FROM "PECUARIO_REPRODUCTORES"
          WHERE "PECUARIO_REPRODUCTORES".sexo = 'hembra'::sexo_cuy) o
     LEFT JOIN activas a ON a."ID_Organizacion" = o."ID_Organizacion"
     LEFT JOIN bajas_mortalidad bm ON bm."ID_Organizacion" = o."ID_Organizacion"
     LEFT JOIN bajas_venta bv ON bv."ID_Organizacion" = o."ID_Organizacion"
     LEFT JOIN altas alt ON alt."ID_Organizacion" = o."ID_Organizacion"
  WHERE o."ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role'::text OR CURRENT_USER = 'postgres'::name;

-- 2.5 vw_pecuario_indicadores_sanitarios_mes  (mes y 12 meses de Lima; poblacion sin cambio)
CREATE OR REPLACE VIEW public.vw_pecuario_indicadores_sanitarios_mes AS
 WITH mort_mes AS (
         SELECT "PECUARIO_MORTALIDAD"."ID_Organizacion",
            COALESCE(sum("PECUARIO_MORTALIDAD".cantidad) FILTER (WHERE "PECUARIO_MORTALIDAD".etapa = 'lactancia'::etapa_productiva), 0::bigint) AS muertes_lactancia,
            COALESCE(sum("PECUARIO_MORTALIDAD".cantidad) FILTER (WHERE "PECUARIO_MORTALIDAD".etapa = ANY (ARRAY['recria'::etapa_productiva, 'engorde'::etapa_productiva])), 0::bigint) AS muertes_recria_engorde
           FROM "PECUARIO_MORTALIDAD"
          WHERE "PECUARIO_MORTALIDAD".fecha_evento >= date_trunc('month'::text, public.fn_hoy_operativo()::timestamp)::date AND "PECUARIO_MORTALIDAD".fecha_evento < (date_trunc('month'::text, public.fn_hoy_operativo()::timestamp) + '1 mon'::interval)::date
          GROUP BY "PECUARIO_MORTALIDAD"."ID_Organizacion"
        ), mort_reproductores_12m AS (
         SELECT "PECUARIO_MORTALIDAD"."ID_Organizacion",
            COALESCE(sum("PECUARIO_MORTALIDAD".cantidad), 0::bigint) AS muertes
           FROM "PECUARIO_MORTALIDAD"
          WHERE "PECUARIO_MORTALIDAD".etapa = 'reproductor'::etapa_productiva AND "PECUARIO_MORTALIDAD".fecha_evento >= (public.fn_hoy_operativo() - '1 year'::interval)::date
          GROUP BY "PECUARIO_MORTALIDAD"."ID_Organizacion"
        ), poblacion AS (
         SELECT vw_pecuario_poblacion_resumen."ID_Organizacion",
            vw_pecuario_poblacion_resumen.total_lactancia,
            vw_pecuario_poblacion_resumen.total_recria + vw_pecuario_poblacion_resumen.total_engorde AS total_recria_engorde,
            vw_pecuario_poblacion_resumen.total_reproductores
           FROM vw_pecuario_poblacion_resumen
        )
 SELECT p."ID_Organizacion",
    COALESCE(mm.muertes_lactancia, 0::bigint)::integer AS muertes_lactancia_mes,
    round(COALESCE(mm.muertes_lactancia, 0::bigint)::numeric / NULLIF(p.total_lactancia, 0)::numeric * 100::numeric, 1) AS mortalidad_lactancia_pct_mes,
    COALESCE(mm.muertes_recria_engorde, 0::bigint)::integer AS muertes_recria_engorde_mes,
    round(COALESCE(mm.muertes_recria_engorde, 0::bigint)::numeric / NULLIF(p.total_recria_engorde, 0)::numeric * 100::numeric, 1) AS mortalidad_recria_engorde_pct_mes,
    COALESCE(mr.muertes, 0::bigint)::integer AS muertes_reproductores_12m,
    round(COALESCE(mr.muertes, 0::bigint)::numeric / NULLIF(p.total_reproductores, 0)::numeric * 100::numeric, 1) AS mortalidad_reproductores_pct_anual
   FROM poblacion p
     LEFT JOIN mort_mes mm ON mm."ID_Organizacion" = p."ID_Organizacion"
     LEFT JOIN mort_reproductores_12m mr ON mr."ID_Organizacion" = p."ID_Organizacion"
  WHERE p."ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role'::text OR CURRENT_USER = 'postgres'::name;

-- 2.6 vw_pecuario_incidencia_patologias  (mes calendario de Lima)
CREATE OR REPLACE VIEW public.vw_pecuario_incidencia_patologias AS
 WITH base AS (
         SELECT "PECUARIO_MORTALIDAD"."ID_Organizacion",
            "PECUARIO_MORTALIDAD".causa,
            sum("PECUARIO_MORTALIDAD".cantidad) AS total
           FROM "PECUARIO_MORTALIDAD"
          WHERE "PECUARIO_MORTALIDAD".fecha_evento >= date_trunc('month'::text, public.fn_hoy_operativo()::timestamp)::date AND "PECUARIO_MORTALIDAD".fecha_evento < (date_trunc('month'::text, public.fn_hoy_operativo()::timestamp) + '1 mon'::interval)::date
          GROUP BY "PECUARIO_MORTALIDAD"."ID_Organizacion", "PECUARIO_MORTALIDAD".causa
        ), totales AS (
         SELECT base."ID_Organizacion",
            sum(base.total) AS total_mes
           FROM base
          GROUP BY base."ID_Organizacion"
        )
 SELECT b."ID_Organizacion",
    b.causa,
    b.total::integer AS cantidad_mes,
    round(b.total::numeric / NULLIF(t.total_mes, 0::numeric) * 100::numeric, 1) AS porcentaje_mes
   FROM base b
     JOIN totales t ON t."ID_Organizacion" = b."ID_Organizacion"
  WHERE b."ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role'::text OR CURRENT_USER = 'postgres'::name;

-- 2.7 vw_pecuario_pesos_promedio_mes  (mes de destete en Lima; engorde via lotes_etapa)
CREATE OR REPLACE VIEW public.vw_pecuario_pesos_promedio_mes AS
 WITH primer_pesaje_lote AS (
         SELECT DISTINCT ON (pj.lote_id) pj.lote_id,
            pj.peso_promedio_g,
            pj.fecha_pesaje
           FROM "PECUARIO_PESAJES" pj
          WHERE pj.lote_id IS NOT NULL
          ORDER BY pj.lote_id, pj.fecha_pesaje, pj.created_at
        ), destete_mes AS (
         SELECT l."ID_Organizacion",
            sum(ppl.peso_promedio_g * l.cantidad_inicial::numeric) AS suma_ponderada,
            sum(l.cantidad_inicial) AS total_animales
           FROM "PECUARIO_LOTES" l
             JOIN primer_pesaje_lote ppl ON ppl.lote_id = l.id
          WHERE l.recoleccion_origen_id IS NOT NULL AND l.fecha_destete >= date_trunc('month'::text, public.fn_hoy_operativo()::timestamp)::date AND l.fecha_destete < (date_trunc('month'::text, public.fn_hoy_operativo()::timestamp) + '1 mon'::interval)::date
          GROUP BY l."ID_Organizacion"
        ), ultimo_pesaje_lote AS (
         SELECT DISTINCT ON (pj.lote_id) pj.lote_id,
            pj.peso_promedio_g
           FROM "PECUARIO_PESAJES" pj
          WHERE pj.lote_id IS NOT NULL
          ORDER BY pj.lote_id, pj.fecha_pesaje DESC, pj.created_at DESC
        ), engorde_actual AS (
         SELECT le."ID_Organizacion",
            sum(upl.peso_promedio_g * le.cantidad_actual::numeric) AS suma_ponderada,
            sum(le.cantidad_actual) AS total_animales
           FROM vw_pecuario_lotes_etapa le
             JOIN ultimo_pesaje_lote upl ON upl.lote_id = le.id
          WHERE le.etapa_calculada = 'engorde'::etapa_productiva
          GROUP BY le."ID_Organizacion"
        )
 SELECT o."ID_Organizacion",
    round(dm.suma_ponderada / NULLIF(dm.total_animales, 0)::numeric, 1) AS peso_promedio_destete_g_mes,
    round(ea.suma_ponderada / NULLIF(ea.total_animales, 0)::numeric, 1) AS peso_promedio_engorde_g_actual
   FROM ( SELECT DISTINCT "PECUARIO_LOTES"."ID_Organizacion"
           FROM "PECUARIO_LOTES") o
     LEFT JOIN destete_mes dm ON dm."ID_Organizacion" = o."ID_Organizacion"
     LEFT JOIN engorde_actual ea ON ea."ID_Organizacion" = o."ID_Organizacion"
  WHERE o."ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role'::text OR CURRENT_USER = 'postgres'::name;

-- 2.8 vw_pecuario_ventas_mes  (mes de Lima + columna nueva AL FINAL: animales_vendidos_mes)
--     monto_total_mes sigue sumando solo PECUARIO_VENTAS (no incluye subproductos/guano).
--     animales_vendidos_mes = suma de cantidad de ventas de animales (excluye el valor
--     vestigial 'guano' del enum, defensivo: hoy hay 0 filas de ese tipo).
CREATE OR REPLACE VIEW public.vw_pecuario_ventas_mes AS
 SELECT "ID_Organizacion",
    count(*)::integer AS ventas_mes,
    COALESCE(sum(precio_total), 0::numeric)::numeric(12,2) AS monto_total_mes,
    COALESCE(sum(peso_total_kg), 0::numeric)::numeric(10,2) AS kg_vendidos_mes,
    round(avg(rendimiento_carcasa_pct) FILTER (WHERE rendimiento_carcasa_pct IS NOT NULL), 1) AS rendimiento_carcasa_promedio_pct,
    count(*) FILTER (WHERE rendimiento_carcasa_pct IS NOT NULL)::integer AS ventas_con_rendimiento_registrado,
    COALESCE(sum(cantidad) FILTER (WHERE tipo_salida <> 'guano'::tipo_venta_cuy), 0)::integer AS animales_vendidos_mes
   FROM "PECUARIO_VENTAS" v
  WHERE fecha_venta >= date_trunc('month'::text, public.fn_hoy_operativo()::timestamp)::date AND fecha_venta < (date_trunc('month'::text, public.fn_hoy_operativo()::timestamp) + '1 mon'::interval)::date AND ("ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role'::text OR CURRENT_USER = 'postgres'::name)
  GROUP BY "ID_Organizacion";

-- ---------------------------------------------------------------------
-- 3. COMMENT de ventas_mes: agrega la columna nueva sin perder el texto previo
-- ---------------------------------------------------------------------
DO $comentario$
DECLARE
  v_actual text;
BEGIN
  v_actual := obj_description('public.vw_pecuario_ventas_mes'::regclass, 'pg_class');
  IF v_actual IS NULL THEN
    v_actual := 'Ventas del mes (calendario de Lima) por organizacion.';
  END IF;
  IF position('animales_vendidos_mes' IN v_actual) = 0 THEN
    EXECUTE format(
      'COMMENT ON VIEW public.vw_pecuario_ventas_mes IS %L',
      v_actual || ' | animales_vendidos_mes: total de animales vendidos en el mes (suma de cantidad, excluye tipo guano). El mes y "hoy" se calculan en America/Lima (fn_hoy_operativo()). monto_total_mes no incluye PECUARIO_VENTAS_SUBPRODUCTOS.'
    );
  END IF;
END
$comentario$;

COMMIT;
