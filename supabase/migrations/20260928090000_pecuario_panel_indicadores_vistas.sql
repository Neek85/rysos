-- =====================================================================
-- RYZOS · Pecuario Cuyes · Panel de indicadores — backend real
-- Ítem 10 del roadmap Pecuario (mockup -> backend), el último y el más
-- grande (specs/pecuario_panel_indicadores.md, ~2000 líneas en el
-- simulador, §3 + §5 son el alcance de esta migración).
-- Fecha: 2026-09-28
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (Sección 4.1.2): cubierta en el mismo
-- flujo, por haberse trabajado con Claude desde el principio.
--
-- PERFIL DE RIESGO — EL MÁS BAJO DE TODO EL ROADMAP: 10 vistas nuevas,
-- CERO tablas nuevas, CERO columnas nuevas, CERO triggers nuevos, CERO
-- CHECK nuevos. Es una capa de solo lectura sobre datos que ya existen y
-- ya están verificados en vivo (ítems 1-9 + Etapa automática/Compras/
-- Venta pelado). Nada de esto puede romper un INSERT/UPDATE de la app —
-- son SELECT puros. Mismo patrón de seguridad de toda vista de este
-- módulo desde 20260922100000: corre con privilegios del dueño
-- (postgres), NO hereda RLS de las tablas base — el filtro de
-- organización se escribe a mano en el WHERE de cada vista (lección de
-- ADR-001, view_eudr_dashboard_aprobados).
--
-- NO REQUIERE CONTRATO ZOD (mismo criterio que 20260924110000): son
-- vistas de solo lectura para el dashboard web (JS plano, sin Server
-- Actions de Pecuario — confirmado, ítem 9 §10.9). No hay ningún INSERT/
-- UPDATE nuevo que validar. Si en el futuro una de las 3 apps móviles
-- necesita consumir alguno de estos números, ESE consumo sí llevaría su
-- propio contrato Zod en ese momento — no antes.
--
-- LO QUE QUEDA FUERA DE ALCANCE A PROPÓSITO (documentado en la spec §5.4/
-- §5.6/§5.3, no son bugs, son decisiones de negocio sin confirmar o gaps
-- de captura reales):
--   - "Edad al beneficio/saca": requiere trazar un lote de Venta hasta su
--     fecha de nacimiento/destete de origen. Para lotes que vienen de
--     Destete real (recoleccion_origen_id), el origen es AGREGADO/
--     proporcional entre varios partos (spec destete §4) — no hay una
--     única fecha de nacimiento por lote, solo un rango. Calcular una
--     "edad" a partir de eso sería inventar un criterio no pedido. Queda
--     pendiente, igual que ya lo dejaba la spec.
--   - "Incidencia de patologías" V2 (por tratamientos sanitarios en vez
--     de causa de muerte): PECUARIO_TRATAMIENTOS ya existe (v3) pero
--     `diagnostico` es texto libre sin categorías — agregar por causa
--     real requeriría inventar una taxonomía no pedida. Esta migración
--     construye la V1 recomendada por la spec (por causa de muerte,
--     cero captura nueva).
--   - "Fertilidad (%)": la spec (§5.1) es explícita en que solo aplica a
--     `sistema_cria = 'controlado'` — GRANJA-VALENCIA usa 'continuo'
--     (confirmado, migración 20260926090000). Construir esta vista hoy
--     sería una fórmula (ventana de gestación para relacionar un
--     "intento" de empadre con un parto) inventada y sin ningún dato real
--     contra el cual verificarla — se deja fuera hasta que exista una
--     organización con empadre controlado activo.
--   - Ganancia diaria/FCR a nivel de POZA (ficha de lote, spec §2.4): la
--     vista de LOTE de abajo ya expone todo lo necesario (un lote vive en
--     una sola poza a la vez, poza_id de PECUARIO_PESAJES/
--     PECUARIO_INSUMOS_MOVIMIENTOS) — no hace falta una vista aparte, la
--     "ficha de lote" de la spec puede leer directamente
--     vw_pecuario_seguimiento_lote filtrando por lote_id.
--
-- DECISIÓN DE ARQUITECTURA PROPIA (no pedida explícitamente por la spec,
-- pero necesaria para que el nivel granja/galpón sea correcto): el FCR y
-- la ganancia diaria a nivel de galpón/granja NO son un promedio simple
-- de los promedios por lote (cada lote tiene su propio período de
-- pesajes, de distinta duración y con distinta cantidad de animales —
-- promediar promedios subestima a los lotes grandes y sobre-pesa a los
-- chicos). Se agregan con un criterio "pooled" (ponderado por animal-día
-- y por kg real), el estándar correcto para tasas de este tipo:
--   ganancia_diaria_pooled = SUM(ganancia_total_g_periodo) /
--                            SUM(cantidad_actual * dias_periodo)
--   fcr_pooled             = SUM(alimento_consumido_kg) /
--                            SUM(ganancia_total_kg_periodo)
-- Documentado explícitamente porque es un criterio técnico propio, no
-- una decisión de negocio ya confirmada por Neyser — queda abierto a
-- ajuste si al usarlo en producción los técnicos prefieren otro criterio
-- (no bloquea nada: es una vista, cambiarla después no tiene costo de
-- migración de datos).
--
-- LÍMITE DOCUMENTADO SOBRE UNIDADES DE ALIMENTO: el FCR suma
-- PECUARIO_INSUMOS_MOVIMIENTOS.cantidad solo cuando
-- PECUARIO_INSUMOS.unidad_medida = 'kg' (case-insensitive) — un insumo de
-- categoría 'alimento' registrado en otra unidad (ej. "sacos", "bolsas")
-- NO se cuenta, para no mezclar unidades. No hay urgencia detectada:
-- catálogo real de Granja Valencia usa 'kg' para alimento, pero se deja
-- documentado por si se da de alta un insumo de alimento en otra unidad.
--
-- APROXIMACIÓN DOCUMENTADA SOBRE TASAS DE MORTALIDAD (%): el denominador
-- (población en riesgo) se aproxima con la población ACTUAL de esa etapa
-- (vw_pecuario_poblacion_resumen / conteo de reproductores activos), no
-- con un promedio de población durante el período — igual de aproximado
-- que el resto de los % de este panel (spec §2.6: "números de ejemplo" se
-- reemplazan por reales, no por un modelo estadístico nuevo). Si un
-- técnico necesita una tasa más precisa (población promedio del período),
-- queda como refinamiento futuro, no bloquea este cierre.
--
-- Aditiva. Idempotente (CREATE OR REPLACE VIEW).
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_LOTES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_LOTES (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_PESAJES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_PESAJES (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_INSUMOS_MOVIMIENTOS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_INSUMOS_MOVIMIENTOS (v2, 20260911090000...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_REPRODUCTORES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_REPRODUCTORES (v3, 20260911140000...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_VENTAS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_VENTAS (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public.vw_pecuario_poblacion_resumen') IS NULL THEN
    RAISE EXCEPTION 'Falta vw_pecuario_poblacion_resumen (20260924110000). Corré primero esa migración -- esta la reutiliza para los denominadores de % de mortalidad.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auth_org_id') THEN
    RAISE EXCEPTION 'Falta public.auth_org_id() (login real, Fase A). Prerrequisito del filtro manual de organización en estas vistas.';
  END IF;
END $$;

-- =====================================================================
-- BLOQUE A — Ganancia diaria / FCR, 3 niveles (spec §2.3/§2.4/§2.5/§2.7)
-- =====================================================================

-- ---------------------------------------------------------------------
-- A1. vw_pecuario_seguimiento_lote — por lote, período = entre los DOS
-- pesajes más recientes. Usa cantidad_actual EN VIVO (no un snapshot) —
-- esto resuelve estructuralmente el bug-class de la Ronda 26 del
-- simulador (§2.7: FCR quedaba calculado contra la población vieja tras
-- una venta/mortalidad/traslado parcial) sin necesitar ningún trigger de
-- "refresco": al ser una vista, cada consulta ve la población real de
-- HOY, nunca un número que pueda quedar desactualizado.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_seguimiento_lote AS
WITH pesajes_ranked AS (
    SELECT
        p.*,
        ROW_NUMBER() OVER (PARTITION BY p.lote_id ORDER BY p.fecha_pesaje DESC, p.created_at DESC) AS rn
    FROM public."PECUARIO_PESAJES" p
    WHERE p.lote_id IS NOT NULL
),
periodo AS (
    SELECT
        rn_actual.lote_id,
        rn_actual."ID_Organizacion",
        rn_anterior.fecha_pesaje AS fecha_pesaje_anterior,
        rn_anterior.peso_promedio_g AS peso_promedio_anterior_g,
        rn_actual.fecha_pesaje AS fecha_pesaje_reciente,
        rn_actual.peso_promedio_g AS peso_promedio_reciente_g,
        (rn_actual.fecha_pesaje - rn_anterior.fecha_pesaje) AS dias_periodo
    FROM (
        SELECT
            a.lote_id, a."ID_Organizacion", a.fecha_pesaje, a.peso_promedio_g
        FROM pesajes_ranked a WHERE a.rn = 1
    ) AS rn_actual
    JOIN (
        SELECT
            b.lote_id, b.fecha_pesaje, b.peso_promedio_g
        FROM pesajes_ranked b WHERE b.rn = 2
    ) AS rn_anterior ON rn_anterior.lote_id = rn_actual.lote_id
)
SELECT
    l.id AS lote_id,
    l."ID_Organizacion",
    l.codigo_lote,
    l.poza_actual_id,
    j.galpon_id,
    l.cantidad_actual,
    per.fecha_pesaje_anterior,
    per.peso_promedio_anterior_g,
    per.fecha_pesaje_reciente,
    per.peso_promedio_reciente_g,
    per.dias_periodo,
    -- Ganancia diaria promedio por animal (g/día) — no depende de la población.
    CASE WHEN per.dias_periodo > 0
        THEN ROUND((per.peso_promedio_reciente_g - per.peso_promedio_anterior_g) / per.dias_periodo, 2)
        ELSE NULL
    END AS ganancia_diaria_g,
    -- Ganancia TOTAL del lote en el período (kg) — sí depende de la
    -- población actual (spec §2.7: recalculado en vivo, nunca contra una
    -- cantidad vieja).
    CASE WHEN per.dias_periodo > 0
        THEN ROUND(((per.peso_promedio_reciente_g - per.peso_promedio_anterior_g) / 1000.0) * l.cantidad_actual, 3)
        ELSE NULL
    END AS ganancia_total_kg_periodo,
    -- Alimento consumido (kg) DENTRO del período (spec §2.5: fuera de
    -- rango no cuenta). Forraje + Concentrado sumados (fórmula
    -- confirmada, §2.5) — solo insumos categoria='alimento' registrados
    -- en 'kg' (ver limitación documentada arriba).
    COALESCE((
        SELECT SUM(m.cantidad)
        FROM public."PECUARIO_INSUMOS_MOVIMIENTOS" m
        JOIN public."PECUARIO_INSUMOS" i ON i.id = m.insumo_id
        WHERE m.lote_id = l.id
          AND m.tipo_movimiento = 'salida'
          AND i.categoria = 'alimento'
          AND i.unidad_medida ILIKE 'kg'
          AND m.fecha BETWEEN per.fecha_pesaje_anterior AND per.fecha_pesaje_reciente
    ), 0) AS alimento_consumido_kg,
    -- Regla de "datos suficientes" (spec §2.5, versión 33 del simulador):
    -- al menos DOS pesajes (para comparar) Y al menos un movimiento de
    -- alimento dentro de ese mismo período. Con un solo pesaje, o sin
    -- alimento en rango, NO se muestra dato propio -- se usa el de
    -- galpón como referencia (vw_pecuario_seguimiento_galpon).
    (per.dias_periodo IS NOT NULL AND EXISTS (
        SELECT 1 FROM public."PECUARIO_INSUMOS_MOVIMIENTOS" m
        JOIN public."PECUARIO_INSUMOS" i ON i.id = m.insumo_id
        WHERE m.lote_id = l.id
          AND m.tipo_movimiento = 'salida'
          AND i.categoria = 'alimento'
          AND i.unidad_medida ILIKE 'kg'
          AND m.fecha BETWEEN per.fecha_pesaje_anterior AND per.fecha_pesaje_reciente
    )) AS datos_suficientes,
    -- FCR: alimento consumido (kg) / peso total ganado (kg) en el período.
    -- NULL si no hay ganancia positiva que dividir (evita división por
    -- cero/negativo -- un lote que no ganó peso no tiene un FCR con
    -- sentido, no se inventa un número).
    CASE
        WHEN per.dias_periodo > 0
             AND ((per.peso_promedio_reciente_g - per.peso_promedio_anterior_g) / 1000.0) * l.cantidad_actual > 0
        THEN ROUND(
            COALESCE((
                SELECT SUM(m.cantidad)
                FROM public."PECUARIO_INSUMOS_MOVIMIENTOS" m
                JOIN public."PECUARIO_INSUMOS" i ON i.id = m.insumo_id
                WHERE m.lote_id = l.id
                  AND m.tipo_movimiento = 'salida'
                  AND i.categoria = 'alimento'
                  AND i.unidad_medida ILIKE 'kg'
                  AND m.fecha BETWEEN per.fecha_pesaje_anterior AND per.fecha_pesaje_reciente
            ), 0)
            / (((per.peso_promedio_reciente_g - per.peso_promedio_anterior_g) / 1000.0) * l.cantidad_actual),
        2)
        ELSE NULL
    END AS fcr
FROM public."PECUARIO_LOTES" l
LEFT JOIN public."PECUARIO_JAULAS" j ON j.id = l.poza_actual_id
LEFT JOIN periodo per ON per.lote_id = l.id
WHERE (l."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_seguimiento_lote IS
'Ganancia diaria (g/d) y FCR por lote, calculados entre los DOS pesajes más recientes (spec pecuario_panel_indicadores.md §2.5/§2.7/§3). ganancia_total_kg_periodo/fcr usan PECUARIO_LOTES.cantidad_actual EN VIVO -- se recalculan solos tras una venta/mortalidad/traslado parcial, sin necesitar ningún trigger de refresco (resuelve estructuralmente el bug-class de la Ronda 26 del simulador). datos_suficientes = false cuando falta un segundo pesaje o alimento registrado en el período -- en ese caso, el consumidor de esta vista debe mostrar el dato de vw_pecuario_seguimiento_galpon como referencia (spec §2.4), nunca un cero.';

GRANT SELECT ON public.vw_pecuario_seguimiento_lote TO authenticated;

-- ---------------------------------------------------------------------
-- A2. vw_pecuario_seguimiento_galpon — pooled (ver nota de arquitectura
-- arriba), solo sobre lotes con datos_suficientes=true de ese galpón.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_seguimiento_galpon AS
SELECT
    s.galpon_id,
    s."ID_Organizacion",
    COUNT(*)::int AS lotes_con_datos,
    ROUND(SUM((s.peso_promedio_reciente_g - s.peso_promedio_anterior_g) * s.cantidad_actual)
        / NULLIF(SUM(s.cantidad_actual * s.dias_periodo), 0), 2) AS ganancia_diaria_promedio_g,
    ROUND(SUM(s.alimento_consumido_kg) / NULLIF(SUM(s.ganancia_total_kg_periodo), 0), 2) AS fcr_promedio
FROM public.vw_pecuario_seguimiento_lote s
WHERE s.datos_suficientes AND s.galpon_id IS NOT NULL
GROUP BY s.galpon_id, s."ID_Organizacion";

COMMENT ON VIEW public.vw_pecuario_seguimiento_galpon IS
'Ganancia diaria y FCR promedio por galpón (spec §2.3: detalle opcional desplegable en el Panel), agregado "pooled" -- ponderado por animal-día y por kg real, no un promedio simple de los promedios de cada lote (ver nota de arquitectura en el encabezado de la migración 20260928090000). Solo incluye lotes con datos_suficientes=true.';

GRANT SELECT ON public.vw_pecuario_seguimiento_galpon TO authenticated;

-- ---------------------------------------------------------------------
-- A3. vw_pecuario_seguimiento_granja — mismo criterio, org-wide. Es el
-- número resumen del panel principal (spec §2.3: "sigue siendo a nivel
-- de toda la granja").
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_seguimiento_granja AS
SELECT
    s."ID_Organizacion",
    COUNT(*)::int AS lotes_con_datos,
    ROUND(SUM((s.peso_promedio_reciente_g - s.peso_promedio_anterior_g) * s.cantidad_actual)
        / NULLIF(SUM(s.cantidad_actual * s.dias_periodo), 0), 2) AS ganancia_diaria_promedio_g,
    ROUND(SUM(s.alimento_consumido_kg) / NULLIF(SUM(s.ganancia_total_kg_periodo), 0), 2) AS fcr_promedio
FROM public.vw_pecuario_seguimiento_lote s
WHERE s.datos_suficientes
GROUP BY s."ID_Organizacion";

COMMENT ON VIEW public.vw_pecuario_seguimiento_granja IS
'Ganancia diaria y FCR promedio de TODA la granja (spec §2.3, el KPI principal del Panel) -- mismo criterio pooled que vw_pecuario_seguimiento_galpon, a nivel organización.';

GRANT SELECT ON public.vw_pecuario_seguimiento_granja TO authenticated;

-- =====================================================================
-- BLOQUE B — Reproductivos (spec §5.1)
-- =====================================================================

-- ---------------------------------------------------------------------
-- B1. vw_pecuario_reproduccion_mes — partos, crías vivas, prolificidad
-- (= tamaño de camada al nacimiento, confirmado un solo indicador,
-- §5.1) y peso promedio al nacimiento (§5.4, ya resuelto), del MES
-- CALENDARIO actual.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_reproduccion_mes AS
SELECT
    p."ID_Organizacion",
    COUNT(*)::int AS partos_mes,
    COALESCE(SUM(p.n_vivos), 0)::int AS crias_vivas_total_mes,
    ROUND(COALESCE(SUM(p.n_vivos), 0)::numeric / NULLIF(COUNT(*), 0), 2) AS crias_vivas_promedio_parto,
    -- Peso al nacimiento (§5.4): opcional, promedio ponderado solo sobre
    -- los partos que sí lo capturaron -- nunca se rellena con un
    -- supuesto para los que no.
    ROUND(
        (SUM(p.peso_total_camada_g) FILTER (WHERE p.peso_total_camada_g IS NOT NULL))::numeric
        / NULLIF(SUM(p.n_vivos) FILTER (WHERE p.peso_total_camada_g IS NOT NULL), 0)
    , 1) AS peso_promedio_nacimiento_g,
    COUNT(*) FILTER (WHERE p.peso_total_camada_g IS NOT NULL)::int AS partos_con_peso_registrado
FROM public."PECUARIO_PARTOS" p
WHERE p.fecha_parto >= date_trunc('month', CURRENT_DATE)
  AND p.fecha_parto < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
  AND (p."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
GROUP BY p."ID_Organizacion";

COMMENT ON VIEW public.vw_pecuario_reproduccion_mes IS
'Partos, crías vivas y prolificidad (crías vivas/parto -- mismo indicador que "tamaño de camada al nacimiento", confirmado por Neyser, spec §5.1) del mes calendario actual. peso_promedio_nacimiento_g es un promedio ponderado SOLO sobre los partos que capturaron el peso total de la camada (campo opcional, spec §5.4) -- partos_con_peso_registrado indica cuántos entraron en ese promedio, para que el consumidor pueda decidir si mostrarlo o marcarlo como muestra chica.';

GRANT SELECT ON public.vw_pecuario_reproduccion_mes TO authenticated;

-- ---------------------------------------------------------------------
-- B2. vw_pecuario_intervalo_partos — Frecuencia de partos (§5.1),
-- calculado por madre_id individual (ya es FK real desde v3) cuando está
-- disponible, promediado org-wide. Fallback aproximado (partos totales /
-- hembras activas, sin intervalo real) para cuando no hay identificación
-- individual suficiente -- expuesto aparte para que el consumidor elija
-- cuál mostrar según cuántas madres con >=2 partos identificados existan.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_intervalo_partos AS
WITH partos_con_madre AS (
    SELECT
        p."ID_Organizacion",
        p.madre_id,
        p.fecha_parto,
        p.fecha_parto - LAG(p.fecha_parto) OVER (PARTITION BY p.madre_id ORDER BY p.fecha_parto) AS dias_desde_anterior
    FROM public."PECUARIO_PARTOS" p
    WHERE p.madre_id IS NOT NULL
)
SELECT
    o."ID_Organizacion",
    ROUND(AVG(pcm.dias_desde_anterior), 1) AS intervalo_promedio_dias_individual,
    COUNT(DISTINCT pcm.madre_id) FILTER (WHERE pcm.dias_desde_anterior IS NOT NULL) AS madres_con_intervalo_calculado,
    -- Fallback aproximado, sin identificación individual: partos totales
    -- del último año / hembras reproductoras activas hoy. No es un
    -- intervalo real (no mide espaciado), es la aproximación que la
    -- propia spec (§5.1) admite como la única posible sin ID individual.
    (SELECT COUNT(*) FROM public."PECUARIO_PARTOS" pp
        WHERE pp."ID_Organizacion" = o."ID_Organizacion"
          AND pp.fecha_parto >= CURRENT_DATE - INTERVAL '12 months') AS partos_ultimos_12m_total,
    (SELECT COUNT(*) FROM public."PECUARIO_REPRODUCTORES" r
        WHERE r."ID_Organizacion" = o."ID_Organizacion"
          AND r.sexo = 'hembra' AND r.estado IN ('activo', 'enfermo')) AS hembras_activas_actual
FROM (SELECT DISTINCT "ID_Organizacion" FROM public."PECUARIO_PARTOS") o
LEFT JOIN partos_con_madre pcm ON pcm."ID_Organizacion" = o."ID_Organizacion"
WHERE (o."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
GROUP BY o."ID_Organizacion";

COMMENT ON VIEW public.vw_pecuario_intervalo_partos IS
'Frecuencia de partos (spec §5.1, el indicador reproductivo correcto para empadre continuo). intervalo_promedio_dias_individual usa PECUARIO_PARTOS.madre_id (FK real desde v3) cuando la identificación individual está en uso -- promedio de días entre partos consecutivos de la misma madre. Cuando madres_con_intervalo_calculado es bajo o 0 (identificación individual poco usada), el consumidor debe preferir la aproximación partos_ultimos_12m_total/hembras_activas_actual (partos por hembra/año, no un intervalo real -- misma limitación que ya admite la spec).';

GRANT SELECT ON public.vw_pecuario_intervalo_partos TO authenticated;

-- ---------------------------------------------------------------------
-- B3. vw_pecuario_reemplazo_reproductoras_anual (§5.1, solo HEMBRAS --
-- mismo tema que el ítem 8, "Reglas de reemplazo de reproductoras").
-- Tasa = bajas de los últimos 12 meses / hembras activas HOY. Altas
-- expuestas aparte, informativas (spec: "calculable con las altas... y
-- bajas").
-- ---------------------------------------------------------------------

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
    a."ID_Organizacion",
    COALESCE(alt.total, 0)::int AS altas_hembras_12m,
    (COALESCE(bm.total, 0) + COALESCE(bv.total, 0))::int AS bajas_hembras_12m,
    COALESCE(a.total, 0)::int AS hembras_activas_actual,
    ROUND((COALESCE(bm.total, 0) + COALESCE(bv.total, 0))::numeric / NULLIF(a.total, 0) * 100, 1) AS tasa_reemplazo_pct
FROM activas a
LEFT JOIN bajas_mortalidad bm ON bm."ID_Organizacion" = a."ID_Organizacion"
LEFT JOIN bajas_venta bv ON bv."ID_Organizacion" = a."ID_Organizacion"
LEFT JOIN altas alt ON alt."ID_Organizacion" = a."ID_Organizacion"
WHERE (a."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_reemplazo_reproductoras_anual IS
'Tasa de reemplazo anual de HEMBRAS reproductoras (spec §5.1, mismo tema que el ítem 8 del roadmap). bajas_hembras_12m = mortalidad + venta tipo reproductor_saca de los últimos 12 meses. tasa_reemplazo_pct = bajas_12m / hembras_activas_actual * 100 (denominador = stock actual, no promedio del período -- criterio simple documentado, ver encabezado de la migración). altas_hembras_12m es informativo (altas de PECUARIO_REPRODUCTORES en los últimos 12 meses), no entra en la fórmula de la tasa.';

GRANT SELECT ON public.vw_pecuario_reemplazo_reproductoras_anual TO authenticated;

-- =====================================================================
-- BLOQUE C — Sanitarios y bioseguridad (spec §5.3)
-- =====================================================================

-- ---------------------------------------------------------------------
-- C1. vw_pecuario_indicadores_sanitarios_mes — mortalidad por etapa
-- (lactancia/recría+engorde combinado, spec pide ese combinado como un
-- solo indicador) del mes actual + mortalidad de reproductores (anual,
-- spec pide "% anual" para ese uno específicamente). % aproximado contra
-- población ACTUAL (ver limitación documentada en el encabezado).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_indicadores_sanitarios_mes AS
WITH mort_mes AS (
    SELECT
        "ID_Organizacion",
        COALESCE(SUM(cantidad) FILTER (WHERE etapa = 'lactancia'), 0) AS muertes_lactancia,
        COALESCE(SUM(cantidad) FILTER (WHERE etapa IN ('recria', 'engorde')), 0) AS muertes_recria_engorde
    FROM public."PECUARIO_MORTALIDAD"
    WHERE fecha_evento >= date_trunc('month', CURRENT_DATE)
      AND fecha_evento < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
    GROUP BY "ID_Organizacion"
),
mort_reproductores_12m AS (
    SELECT "ID_Organizacion", COALESCE(SUM(cantidad), 0) AS muertes
    FROM public."PECUARIO_MORTALIDAD"
    WHERE etapa = 'reproductor' AND fecha_evento >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY "ID_Organizacion"
),
poblacion AS (
    SELECT "ID_Organizacion", total_lactancia, (total_recria + total_engorde) AS total_recria_engorde, total_reproductores
    FROM public.vw_pecuario_poblacion_resumen
)
SELECT
    p."ID_Organizacion",
    COALESCE(mm.muertes_lactancia, 0)::int AS muertes_lactancia_mes,
    ROUND(COALESCE(mm.muertes_lactancia, 0)::numeric / NULLIF(p.total_lactancia, 0) * 100, 1) AS mortalidad_lactancia_pct_mes,
    COALESCE(mm.muertes_recria_engorde, 0)::int AS muertes_recria_engorde_mes,
    ROUND(COALESCE(mm.muertes_recria_engorde, 0)::numeric / NULLIF(p.total_recria_engorde, 0) * 100, 1) AS mortalidad_recria_engorde_pct_mes,
    COALESCE(mr.muertes, 0)::int AS muertes_reproductores_12m,
    ROUND(COALESCE(mr.muertes, 0)::numeric / NULLIF(p.total_reproductores, 0) * 100, 1) AS mortalidad_reproductores_pct_anual
FROM poblacion p
LEFT JOIN mort_mes mm ON mm."ID_Organizacion" = p."ID_Organizacion"
LEFT JOIN mort_reproductores_12m mr ON mr."ID_Organizacion" = p."ID_Organizacion"
WHERE (p."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_indicadores_sanitarios_mes IS
'Mortalidad en lactancia y recría+engorde (combinados, spec §5.3/§5.5) del mes calendario actual, y mortalidad de reproductores (% anual, ventana rolling 12 meses -- la spec pide "anual" solo para este uno). % aproximado: denominador = población ACTUAL de esa etapa (vw_pecuario_poblacion_resumen), no un promedio del período -- ver limitación documentada en el encabezado de la migración 20260928090000.';

GRANT SELECT ON public.vw_pecuario_indicadores_sanitarios_mes TO authenticated;

-- ---------------------------------------------------------------------
-- C2. vw_pecuario_incidencia_patologias — V1 recomendada por la spec
-- (§5.3): por causa de muerte, mes actual. Cero captura nueva.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_incidencia_patologias AS
WITH base AS (
    SELECT "ID_Organizacion", causa, SUM(cantidad) AS total
    FROM public."PECUARIO_MORTALIDAD"
    WHERE fecha_evento >= date_trunc('month', CURRENT_DATE)
      AND fecha_evento < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
    GROUP BY "ID_Organizacion", causa
),
totales AS (
    SELECT "ID_Organizacion", SUM(total) AS total_mes
    FROM base
    GROUP BY "ID_Organizacion"
)
SELECT
    b."ID_Organizacion",
    b.causa,
    b.total::int AS cantidad_mes,
    ROUND(b.total::numeric / NULLIF(t.total_mes, 0) * 100, 1) AS porcentaje_mes
FROM base b
JOIN totales t ON t."ID_Organizacion" = b."ID_Organizacion"
WHERE (b."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_incidencia_patologias IS
'Incidencia de patologías clave, V1 (spec §5.3: por causa de muerte -- PECUARIO_MORTALIDAD.causa -- cero captura nueva; V2 por tratamientos sanitarios queda pendiente, PECUARIO_TRATAMIENTOS.diagnostico es texto libre sin categorías). Una fila por causa con cantidad y % sobre el total de muertes del mes de esa organización.';

GRANT SELECT ON public.vw_pecuario_incidencia_patologias TO authenticated;

-- =====================================================================
-- BLOQUE D — Productivo (spec §5.2)
-- =====================================================================

-- ---------------------------------------------------------------------
-- D1. vw_pecuario_pesos_promedio_mes — peso promedio al destete (primer
-- pesaje de lotes conformados por Destete real este mes) y peso promedio
-- de engorde (pesaje más reciente de lotes actualmente en etapa
-- calculada 'engorde', foto del momento -- no acotado a un mes, es un
-- estado actual).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_pesos_promedio_mes AS
WITH primer_pesaje_lote AS (
    SELECT DISTINCT ON (pj.lote_id)
        pj.lote_id, pj.peso_promedio_g, pj.fecha_pesaje
    FROM public."PECUARIO_PESAJES" pj
    WHERE pj.lote_id IS NOT NULL
    ORDER BY pj.lote_id, pj.fecha_pesaje ASC, pj.created_at ASC
),
destete_mes AS (
    SELECT
        l."ID_Organizacion",
        SUM(ppl.peso_promedio_g * l.cantidad_inicial) AS suma_ponderada,
        SUM(l.cantidad_inicial) AS total_animales
    FROM public."PECUARIO_LOTES" l
    JOIN primer_pesaje_lote ppl ON ppl.lote_id = l.id
    WHERE l.recoleccion_origen_id IS NOT NULL
      AND l.fecha_destete >= date_trunc('month', CURRENT_DATE)
      AND l.fecha_destete < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
    GROUP BY l."ID_Organizacion"
),
ultimo_pesaje_lote AS (
    SELECT DISTINCT ON (pj.lote_id)
        pj.lote_id, pj.peso_promedio_g
    FROM public."PECUARIO_PESAJES" pj
    WHERE pj.lote_id IS NOT NULL
    ORDER BY pj.lote_id, pj.fecha_pesaje DESC, pj.created_at DESC
),
engorde_actual AS (
    SELECT
        le."ID_Organizacion",
        SUM(upl.peso_promedio_g * le.cantidad_actual) AS suma_ponderada,
        SUM(le.cantidad_actual) AS total_animales
    FROM public.vw_pecuario_lotes_etapa le
    JOIN ultimo_pesaje_lote upl ON upl.lote_id = le.id
    WHERE le.etapa_calculada = 'engorde'
    GROUP BY le."ID_Organizacion"
)
SELECT
    o."ID_Organizacion",
    ROUND(dm.suma_ponderada / NULLIF(dm.total_animales, 0), 1) AS peso_promedio_destete_g_mes,
    ROUND(ea.suma_ponderada / NULLIF(ea.total_animales, 0), 1) AS peso_promedio_engorde_g_actual
FROM (SELECT DISTINCT "ID_Organizacion" FROM public."PECUARIO_LOTES") o
LEFT JOIN destete_mes dm ON dm."ID_Organizacion" = o."ID_Organizacion"
LEFT JOIN engorde_actual ea ON ea."ID_Organizacion" = o."ID_Organizacion"
WHERE (o."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_pesos_promedio_mes IS
'Peso promedio al destete (spec §5.2: peso a la fecha REAL de destete, no una edad fija -- primer pesaje registrado de cada lote conformado por Destete real este mes calendario, PECUARIO_LOTES.recoleccion_origen_id IS NOT NULL) y peso promedio de engorde (foto del momento: pesaje más reciente de los lotes HOY en etapa_calculada=engorde, vw_pecuario_lotes_etapa). Ambos ponderados por cantidad de animales, no promedio simple de lotes.';

GRANT SELECT ON public.vw_pecuario_pesos_promedio_mes TO authenticated;

-- =====================================================================
-- BLOQUE E — Comercial (Ventas del mes + Rendimiento de carcasa, §5.6)
-- =====================================================================

CREATE OR REPLACE VIEW public.vw_pecuario_ventas_mes AS
SELECT
    v."ID_Organizacion",
    COUNT(*)::int AS ventas_mes,
    COALESCE(SUM(v.precio_total), 0)::numeric(12,2) AS monto_total_mes,
    COALESCE(SUM(v.peso_total_kg), 0)::numeric(10,2) AS kg_vendidos_mes,
    ROUND(AVG(v.rendimiento_carcasa_pct) FILTER (WHERE v.rendimiento_carcasa_pct IS NOT NULL), 1) AS rendimiento_carcasa_promedio_pct,
    COUNT(*) FILTER (WHERE v.rendimiento_carcasa_pct IS NOT NULL)::int AS ventas_con_rendimiento_registrado
FROM public."PECUARIO_VENTAS" v
WHERE v.fecha_venta >= date_trunc('month', CURRENT_DATE)
  AND v.fecha_venta < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
  AND (v."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
GROUP BY v."ID_Organizacion";

COMMENT ON VIEW public.vw_pecuario_ventas_mes IS
'Ventas del mes calendario actual: cantidad, monto total, kg vendidos y rendimiento de carcasa promedio (spec §5.6 -- PECUARIO_VENTAS.rendimiento_carcasa_pct ya es una columna GENERATED desde la venta de pelado beneficiado, v9 -- ya se calculaba en pantalla pero no existía un promedio agregado hasta esta vista). Promedio ponderado simple (AVG) sobre las ventas que sí lo registraron -- ventas_con_rendimiento_registrado indica el tamaño de esa muestra.';

GRANT SELECT ON public.vw_pecuario_ventas_mes TO authenticated;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT * FROM vw_pecuario_seguimiento_lote WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
-- SELECT * FROM vw_pecuario_seguimiento_galpon WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
-- SELECT * FROM vw_pecuario_seguimiento_granja WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
-- SELECT * FROM vw_pecuario_reproduccion_mes WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
-- SELECT * FROM vw_pecuario_intervalo_partos WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
-- SELECT * FROM vw_pecuario_reemplazo_reproductoras_anual WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
-- SELECT * FROM vw_pecuario_indicadores_sanitarios_mes WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
-- SELECT * FROM vw_pecuario_incidencia_patologias WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
-- SELECT * FROM vw_pecuario_pesos_promedio_mes WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
-- SELECT * FROM vw_pecuario_ventas_mes WHERE "ID_Organizacion" = 'GRANJA-VALENCIA';
--
-- Caso de control -- FCR/ganancia diaria (vw_pecuario_seguimiento_lote):
--   1. Un lote con un solo pesaje: dias_periodo/ganancia_diaria_g/fcr =
--      NULL, datos_suficientes = false.
--   2. Ese mismo lote con un segundo pesaje pero sin alimento en el
--      rango de fechas entre ambos: datos_suficientes = false, ganancia_
--      diaria_g SÍ calculado (no depende de alimento), fcr = NULL.
--   3. Con alimento dentro del rango: datos_suficientes = true, fcr
--      calculado.
--   4. Vender/dar de baja parte de ese lote (baja cantidad_actual) SIN
--      registrar un pesaje nuevo: fcr debe subir solo por el cambio de
--      cantidad_actual, sin tocar ninguna fila -- confirma que no hay
--      snapshot desactualizado (spec §2.7).
--   5. Alimento registrado ANTES de fecha_pesaje_anterior o DESPUÉS de
--      fecha_pesaje_reciente: no debe sumar a alimento_consumido_kg.
--   6. Un insumo de categoría 'alimento' con unidad_medida != 'kg': no
--      debe sumar (limitación documentada).
--
-- Aislamiento RLS cruzado (obligatorio, Sección 3 del documento maestro):
-- con dos organizaciones de prueba con datos en TODAS las tablas base de
-- este bloque, confirmar que auth_org_id() de la organización A nunca ve
-- filas de la organización B en ninguna de las 10 vistas.
-- ---------------------------------------------------------------------
