-- =====================================================================
-- PECUARIO — Vista de etapa productiva automática (Recría -> Engorde, 8 semanas)
-- Fecha: 2026-09-22
-- Redactado por: Claude (Cowork), Arquitecto Senior RYZOS.
-- Segunda revisión de seguridad (system prompt Sección 4.1.2): cubierta en
-- el mismo flujo, por haberse trabajado con Claude desde el principio.
--
-- CONTEXTO: decisión de negocio confirmada por Neyser el 2026-09-22
-- (specs/pecuario_panel_indicadores.md §2.27, punto 1 — "Confirmar 8
-- semanas"): el corte entre "Recría" y "Engorde" es de 8 semanas
-- (56 días) contadas desde la fecha de destete del lote
-- (PECUARIO_LOTES.fecha_destete). Ver también
-- specs/pecuario_etapa_automatica_8_semanas.md.
--
-- fecha_destete YA EXISTE como columna NOT NULL DEFAULT CURRENT_DATE desde
-- la migración v1 (20260910160000_pecuario_cuyes_core.sql) — no requiere
-- backfill: todo lote ya tiene una fecha válida (el lote se crea
-- precisamente en el momento del destete, ver
-- specs/pecuario_destete_recoleccion_semanal.md).
--
-- ADITIVA, NO DESTRUCTIVA: esta migración NO modifica ni escribe nunca
-- PECUARIO_LOTES.etapa. Esa columna sigue existiendo tal cual, sigue
-- pudiendo fijarse a mano (alta de lote, "reproductor" cuando se aparta
-- como pie de cría, etc.) y sigue siendo la que ya validan
-- MortalidadRegistroSchema y el resto del código existente. En vez de
-- mutar esa columna con un cron/job (que además Postgres no soporta como
-- columna GENERATED, porque CURRENT_DATE es una función volátil), se
-- agrega una VISTA de solo lectura que calcula la etapa EFECTIVA en el
-- momento de cada consulta — siempre exacta, sin infraestructura de
-- scheduling adicional que pueda dejar de correr en silencio.
--
-- Mismo criterio de seguridad ya usado en las vistas anteriores del
-- módulo (vw_pecuario_insumos_stock, vw_pecuario_desinfeccion_estado,
-- vw_pecuario_limpieza_galpon_estado): una vista corre con privilegios
-- del dueño (postgres) y NO hereda RLS de la tabla base (lección real de
-- ADR-001, view_eudr_dashboard_aprobados, fuga de datos entre
-- organizaciones corregida 2026-08-18) — el filtro de organización se
-- escribe a mano en el WHERE, nunca se asume heredado.
--
-- REGLA (solo se auto-avanza recría -> engorde; cualquier otro estado
-- guardado se respeta tal cual):
--   etapa = 'recria' AND estado = 'activo'
--     AND (CURRENT_DATE - fecha_destete) >= 56  =>  etapa_calculada = 'engorde'
--   cualquier otro caso (lactancia, reproductor, engorde ya fijado a
--   mano, o lote no activo)                      =>  etapa_calculada = etapa
--
-- Idempotente: CREATE OR REPLACE VIEW.
-- =====================================================================

CREATE OR REPLACE VIEW public.vw_pecuario_lotes_etapa AS
SELECT
    l.*,
    CASE
        WHEN l.etapa = 'recria'
             AND l.estado = 'activo'
             AND (CURRENT_DATE - l.fecha_destete) >= 56
            THEN 'engorde'::etapa_productiva
        ELSE l.etapa
    END AS etapa_calculada,
    -- Días que faltan para el corte de engorde; NULL cuando no aplica
    -- (el lote no está en recría activa, o ya pasó el corte).
    CASE
        WHEN l.etapa = 'recria'
             AND l.estado = 'activo'
             AND (CURRENT_DATE - l.fecha_destete) < 56
            THEN 56 - (CURRENT_DATE - l.fecha_destete)
        ELSE NULL
    END AS dias_para_engorde
FROM public."PECUARIO_LOTES" l
WHERE (l."ID_Organizacion" = public.auth_org_id() OR auth.role() = 'service_role' OR current_user = 'postgres');

COMMENT ON VIEW public.vw_pecuario_lotes_etapa IS
'Etapa productiva EFECTIVA de cada lote (lactancia/recría/engorde/reproductor), calculada en el momento de la consulta. No modifica PECUARIO_LOTES.etapa, que sigue siendo la columna editable a mano. Regla: recría -> engorde a las 8 semanas (56 días) desde fecha_destete, confirmada por Neyser el 2026-09-22 (specs/pecuario_panel_indicadores.md §2.27, specs/pecuario_etapa_automatica_8_semanas.md).';

GRANT SELECT ON public.vw_pecuario_lotes_etapa TO authenticated;
