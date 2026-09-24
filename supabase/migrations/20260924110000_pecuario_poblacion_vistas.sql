-- =====================================================================
-- RYZOS · Pecuario Cuyes · Vistas de población real (ficha de poza +
-- KPIs de Inicio/Dashboard)
-- Fecha: 2026-09-24
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (Sección 4.1.2): cubierta en el mismo
-- flujo, por haberse trabajado con Claude desde el principio. Esta
-- migración es de SOLO LECTURA (3 vistas, sin tablas nuevas, sin
-- triggers, sin políticas RLS nuevas que escriban) -- no requiere
-- contrato Zod (Sección 9 del documento maestro aplica a datos de
-- entrada; acá no hay ningún INSERT/UPDATE nuevo que validar).
--
-- Spec de referencia: specs/pecuario_ficha_poza_y_calculo_poblacion.md
-- (decisiones confirmadas por Neyser, 2026-09-21; roadmap de Pecuario,
-- ítem 5 de Nivel 2 -- ver claude/roadmap_pecuario_mockup_a_backend.md
-- del proyecto de Cowork).
--
-- HALLAZGO DE ESQUEMA #1 (verificado contra 20260910160000 antes de
-- diseñar esto) -- la spec (§2, decisión 1) describe como "hueco de
-- fondo" que "PECUARIO_PARTOS todavía no está vinculado hacia adelante
-- con el lote que se arma al destete". Eso ya NO es cierto contra el
-- esquema real: PECUARIO_LOTES.parto_origen_id (FK -> PECUARIO_PARTOS)
-- existe desde la v1 (2026-09-10), antes incluso de que se escribiera
-- esta spec en el simulador (2026-09-21). El "hueco" real de la spec
-- (madre_id sin FK en PECUARIO_PARTOS, ver 20260911140000) es sobre
-- genealogía individual, un tema distinto -- no bloquea el vínculo
-- lote<->parto que sí hace falta para calcular lactancia real. Por eso
-- esta migración NO reproduce `CAMADAS_LACTANCIA` (el arreglo cargado a
-- mano del simulador, ver spec §3.4bis) -- calcula lactancia real desde
-- PECUARIO_PARTOS/PECUARIO_LOTES.parto_origen_id.
--
-- HALLAZGO DE ESQUEMA #2 -- ya existe `vw_pecuario_lotes_etapa`
-- (20260922100000), que calcula la etapa EFECTIVA de cada lote
-- (recría -> engorde automático a las 8 semanas desde fecha_destete,
-- decisión de Neyser 2026-09-22). "Población por etapa" (spec §3.5)
-- tiene que agrupar por esa etapa CALCULADA, no por la columna cruda
-- PECUARIO_LOTES.etapa -- si no, el panel de población mostraría un
-- desglose recría/engorde inconsistente con el resto de la app, que ya
-- usa la etapa automática desde hace dos días. Esta migración reutiliza
-- esa vista en vez de duplicar su lógica.
--
-- DECISIÓN DE ARQUITECTURA -- 3 vistas de solo lectura, mismo patrón de
-- seguridad ya usado en vw_pecuario_lotes_etapa/vw_pecuario_insumos_stock
-- (vista corre con privilegios del dueño/postgres, NO hereda RLS de las
-- tablas base -- el filtro de organización se escribe a mano en el
-- WHERE, nunca se asume heredado; lección de ADR-001):
--
--   1. vw_pecuario_lactancia_restante -- reemplaza CAMADAS_LACTANCIA.
--      Por cada parto con crías vivas aún no completamente destetadas:
--      cantidad_restante = n_vivos - SUM(cantidad_inicial de los lotes
--      con parto_origen_id = este parto). Un parto totalmente destetado
--      desaparece de la vista (HAVING > 0), igual que un parto sin
--      ninguna cría "actualmente en lactancia" desaparecía de
--      CAMADAS_LACTANCIA en el simulador.
--      LIMITACIÓN DOCUMENTADA (a confirmar con técnicos, spec §5 ya deja
--      varias preguntas abiertas de este tipo): esta vista NO descuenta
--      mortalidad en etapa de lactancia. PECUARIO_MORTALIDAD registra
--      contra poza_id (nunca contra parto_id), así que si dos partos
--      están en lactancia simultánea en la misma poza, una muerte
--      registrada ahí no se puede atribuir con certeza a uno u otro sin
--      adivinar -- se prefiere no adivinar. La vista de resumen (#3) sí
--      la descuenta, pero solo a nivel organización completa, donde la
--      atribución no hace falta (ver esa vista).
--   2. vw_pecuario_ocupacion_poza -- una fila por poza/jaula real, con
--      el desglose que pide la ficha de poza (spec §3.3): lotes
--      (población), reproductores activos por sexo, lactancia (vista
--      #1), total, y `sobre_capacidad` (total > capacidad_max) para el
--      badge de alerta visual (spec §3.2) -- spec §4 deja para después
--      decidir si esto además dispara una alerta en Inicio; esta
--      migración solo expone el booleano, no construye ninguna alerta
--      nueva.
--   3. vw_pecuario_poblacion_resumen -- una fila por organización, con
--      los mismos 4 números que pide el Dashboard (spec §3.5: Lactancia/
--      Recría/Engorde/Reproductores) más el total general (spec §3.4bis,
--      confirmado por Neyser: la lactancia SÍ va incluida en el total).
--      Acá sí se descuenta mortalidad de lactancia (org completa, sin
--      atribuir a un parto ni a una poza puntual).
--
-- DECISIÓN -- reproductores con estado='enfermo' cuentan como población
-- presente. El simulador solo filtraba `estado === 'activo'` (spec
-- §3.4), pero el esquema real tiene 4 estados (activo/vendido/muerto/
-- enfermo, ver 20260911140000) y un reproductor enfermo sigue físicamente
-- en la granja -- excluirlo de "Población total" la subcontaría. Se
-- cuenta activo+enfermo como "presente", solo vendido/muerto se excluyen.
-- Ningún cambio de comportamiento para PECUARIO_LOTES: cantidad_actual
-- ya refleja el conteo real (baja a 0 con mortalidad/venta/traslado
-- total, spec §3.7/§3.9), sumarla no requiere filtrar por su columna
-- `estado` (texto libre, no enum, no confiable para esto).
--
-- NO IMPLEMENTADO A PROPÓSITO (fuera de alcance, spec §4/§5 lo dejan
-- como decisión pendiente, no como bug): alerta de sobrepoblación en la
-- superficie de Alertas de Inicio; desglose de "Población total" por
-- galpón; capacidad_max individual por poza distinta del default por
-- tipo_uso (spec §5, pendiente de confirmar con técnicos).
--
-- NOTA (agregada por Claude Code CLI, no en la redacción original de
-- Cowork): se envuelve el archivo en BEGIN;/COMMIT; -- todas las demás
-- migraciones de este repo lo hacen (ver CLAUDE.md). Sin riesgo
-- funcional acá: esta migración solo tiene CREATE OR REPLACE VIEW (sin
-- ningún CREATE TYPE/ALTER TYPE ADD VALUE), así que ni siquiera aplica
-- la restricción de "unsafe use of new value of enum type" que forzó
-- partir en 2 archivos la migración de venta pelado.
--
-- Aditiva. Idempotente (CREATE OR REPLACE VIEW).
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_JAULAS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_JAULAS (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_PARTOS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_PARTOS (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_LOTES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_LOTES (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_REPRODUCTORES"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_REPRODUCTORES (v3, 20260911140000...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public."PECUARIO_MORTALIDAD"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_MORTALIDAD (v1, 20260910...). Corré primero esa migración.';
  END IF;
  IF to_regclass('public.vw_pecuario_lotes_etapa') IS NULL THEN
    RAISE EXCEPTION 'Falta vw_pecuario_lotes_etapa (20260922100000_pecuario_vista_etapa_automatica.sql). Corré primero esa migración -- esta vista reutiliza su etapa_calculada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auth_org_id') THEN
    RAISE EXCEPTION 'Falta public.auth_org_id() (login real, Fase A). Prerrequisito del filtro manual de organización en estas vistas.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. vw_pecuario_lactancia_restante
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_lactancia_restante AS
SELECT
    p.id AS parto_id,
    p."ID_Organizacion",
    p.poza_id,
    p.fecha_parto,
    p.n_vivos,
    COALESCE(SUM(l.cantidad_inicial), 0)::int AS cantidad_destetada,
    GREATEST(p.n_vivos - COALESCE(SUM(l.cantidad_inicial), 0), 0)::int AS cantidad_restante
FROM public."PECUARIO_PARTOS" p
LEFT JOIN public."PECUARIO_LOTES" l ON l.parto_origen_id = p.id
WHERE (p."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres')
GROUP BY p.id, p."ID_Organizacion", p.poza_id, p.fecha_parto, p.n_vivos
HAVING p.n_vivos - COALESCE(SUM(l.cantidad_inicial), 0) > 0;

COMMENT ON VIEW public.vw_pecuario_lactancia_restante IS
'Camadas todavía en lactancia (crías vivas sin destetar por completo), calculado en vivo desde PECUARIO_PARTOS/PECUARIO_LOTES.parto_origen_id -- reemplaza el CAMADAS_LACTANCIA cargado a mano del simulador (specs/pecuario_ficha_poza_y_calculo_poblacion.md §3.4bis). NO descuenta mortalidad en lactancia (PECUARIO_MORTALIDAD no referencia parto_id, solo poza_id -- no se puede atribuir con certeza entre partos concurrentes de la misma poza). Un parto ya destetado por completo desaparece de esta vista.';

GRANT SELECT ON public.vw_pecuario_lactancia_restante TO authenticated;

-- ---------------------------------------------------------------------
-- 2. vw_pecuario_ocupacion_poza
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_ocupacion_poza AS
SELECT
    j.id,
    j."ID_Organizacion",
    j.codigo_poza,
    j.galpon_id,
    j.tipo_uso,
    j.capacidad_max,
    COALESCE(lotes.total, 0)::int AS total_lotes,
    COALESCE(reprod.hembras, 0)::int AS total_hembras,
    COALESCE(reprod.machos, 0)::int AS total_machos,
    (COALESCE(reprod.hembras, 0) + COALESCE(reprod.machos, 0))::int AS total_reproductores,
    COALESCE(lact.total, 0)::int AS total_lactancia,
    (COALESCE(lotes.total, 0) + COALESCE(reprod.hembras, 0) + COALESCE(reprod.machos, 0) + COALESCE(lact.total, 0))::int AS total_animales,
    ((COALESCE(lotes.total, 0) + COALESCE(reprod.hembras, 0) + COALESCE(reprod.machos, 0) + COALESCE(lact.total, 0)) > j.capacidad_max) AS sobre_capacidad
FROM public."PECUARIO_JAULAS" j
LEFT JOIN (
    SELECT poza_actual_id, SUM(cantidad_actual) AS total
    FROM public."PECUARIO_LOTES"
    GROUP BY poza_actual_id
) lotes ON lotes.poza_actual_id = j.id
LEFT JOIN (
    SELECT jaula_actual_id,
        COUNT(*) FILTER (WHERE sexo = 'hembra') AS hembras,
        COUNT(*) FILTER (WHERE sexo = 'macho') AS machos
    FROM public."PECUARIO_REPRODUCTORES"
    WHERE estado IN ('activo', 'enfermo')
    GROUP BY jaula_actual_id
) reprod ON reprod.jaula_actual_id = j.id
LEFT JOIN (
    SELECT poza_id, SUM(cantidad_restante) AS total
    FROM public.vw_pecuario_lactancia_restante
    GROUP BY poza_id
) lact ON lact.poza_id = j.id
WHERE (j."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_ocupacion_poza IS
'Ocupación real de cada poza/jaula, para la ficha de poza (specs/pecuario_ficha_poza_y_calculo_poblacion.md §3.3): lotes de población, reproductores activos/enfermos por sexo, lactancia en curso, total y alerta de sobre_capacidad. estado=enfermo cuenta como presente (sigue en la granja); vendido/muerto no.';

GRANT SELECT ON public.vw_pecuario_ocupacion_poza TO authenticated;

-- ---------------------------------------------------------------------
-- 3. vw_pecuario_poblacion_resumen
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_pecuario_poblacion_resumen AS
WITH orgs AS (
    SELECT "ID_Organizacion" FROM public."PECUARIO_JAULAS"
    UNION
    SELECT "ID_Organizacion" FROM public."PECUARIO_LOTES"
    UNION
    SELECT "ID_Organizacion" FROM public."PECUARIO_REPRODUCTORES"
    UNION
    SELECT "ID_Organizacion" FROM public."PECUARIO_PARTOS"
),
lactancia_bruta AS (
    SELECT "ID_Organizacion", SUM(cantidad_restante) AS total
    FROM public.vw_pecuario_lactancia_restante
    GROUP BY "ID_Organizacion"
),
mortalidad_lactancia AS (
    SELECT "ID_Organizacion", SUM(cantidad) AS total
    FROM public."PECUARIO_MORTALIDAD"
    WHERE etapa = 'lactancia'
    GROUP BY "ID_Organizacion"
),
lotes_etapa AS (
    SELECT "ID_Organizacion",
        SUM(cantidad_actual) FILTER (WHERE etapa_calculada = 'recria') AS recria,
        SUM(cantidad_actual) FILTER (WHERE etapa_calculada = 'engorde') AS engorde
    FROM public.vw_pecuario_lotes_etapa
    GROUP BY "ID_Organizacion"
),
reproductores AS (
    SELECT "ID_Organizacion",
        COUNT(*) AS total
    FROM public."PECUARIO_REPRODUCTORES"
    WHERE estado IN ('activo', 'enfermo')
    GROUP BY "ID_Organizacion"
)
SELECT
    o."ID_Organizacion",
    GREATEST(COALESCE(lb.total, 0) - COALESCE(ml.total, 0), 0)::int AS total_lactancia,
    COALESCE(le.recria, 0)::int AS total_recria,
    COALESCE(le.engorde, 0)::int AS total_engorde,
    COALESCE(r.total, 0)::int AS total_reproductores,
    (GREATEST(COALESCE(lb.total, 0) - COALESCE(ml.total, 0), 0)
        + COALESCE(le.recria, 0) + COALESCE(le.engorde, 0) + COALESCE(r.total, 0))::int AS total_poblacion
FROM orgs o
LEFT JOIN lactancia_bruta lb ON lb."ID_Organizacion" = o."ID_Organizacion"
LEFT JOIN mortalidad_lactancia ml ON ml."ID_Organizacion" = o."ID_Organizacion"
LEFT JOIN lotes_etapa le ON le."ID_Organizacion" = o."ID_Organizacion"
LEFT JOIN reproductores r ON r."ID_Organizacion" = o."ID_Organizacion"
WHERE (o."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_poblacion_resumen IS
'Una fila por organización con los 4 números del Dashboard (specs/pecuario_ficha_poza_y_calculo_poblacion.md §3.5: Lactancia/Recría/Engorde/Reproductores) y el total general (§3.4bis, confirmado por Neyser: incluye lactancia). Recría/Engorde vienen de vw_pecuario_lotes_etapa.etapa_calculada (etapa automática a las 8 semanas), no de PECUARIO_LOTES.etapa cruda. Lactancia sí descuenta mortalidad de esa etapa acá (a nivel organización, sin atribuir a poza/parto puntual -- ver limitación documentada en vw_pecuario_lactancia_restante).';

GRANT SELECT ON public.vw_pecuario_poblacion_resumen TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación rápida post-migración (ejecutar a mano en Studio):
--
-- SELECT * FROM vw_pecuario_lactancia_restante WHERE "ID_Organizacion" = '<org de prueba>';
-- SELECT * FROM vw_pecuario_ocupacion_poza WHERE "ID_Organizacion" = '<org de prueba>';
-- SELECT * FROM vw_pecuario_poblacion_resumen WHERE "ID_Organizacion" = '<org de prueba>';
-- ---------------------------------------------------------------------
