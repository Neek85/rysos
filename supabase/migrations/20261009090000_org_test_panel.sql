-- =====================================================================
-- 20261009090000_org_test_panel.sql
-- Organizacion de prueba dedicada ORG-TEST-PANEL (FASE 1 de 2)
-- =====================================================================
-- PROBLEMA
--   tests/test_pecuario_panel_indicadores.py siembra datos de prueba en la
--   organizacion REAL GRANJA-VALENCIA (ORG_A). Cada corrida escribe y borra
--   filas en una organizacion de produccion. Este repo ya tiene organizaciones
--   de prueba dedicadas (GRANJA-TEST, ORG-TEST-DEMO, ORG-TEST-E2E) etiquetadas
--   con es_organizacion_prueba=true (ADR-008, migracion 20260822_021532).
--
-- QUE HACE ESTA MIGRACION
--   1. Inserta UNA fila en public."ORGANIZACIONES":
--        "ID" = 'ORG-TEST-PANEL'
--        "Nombre_Organizacion" = 'Organizacion de prueba - Panel de indicadores (NO ES CLIENTE REAL)'
--        es_organizacion_prueba = true
--      El resto de las columnas queda NULL / con su default de columna (RUC,
--      Direccion_Fiscal, Representante_Legal, Logo, Config y creado_por son
--      nullable: confirmado en catalogo, information_schema.columns, 2026-10-09;
--      creado_en y actualizado_en tienen DEFAULT now()). Solo se usan columnas
--      confirmadas en docs/schema_live_core.md y en el catalogo.
--   2. Es IDEMPOTENTE y NO pisa nada: ON CONFLICT ("ID") DO NOTHING. A diferencia
--      de la migracion de ORG-TEST-E2E, NO hace DO UPDATE: si ya existiera una fila
--      con ese ID que NO fuera de prueba, no se la convierte; la verificacion final
--      aborta la transaccion.
--   3. Verificacion final: aborta si la fila no existe o no quedo con
--      es_organizacion_prueba = true.
--
-- NO SE SIEMBRA OTRA FILA PREVIA (analisis del test, solo lectura):
--   - PECUARIO_CONFIGURACION: no hace falta. Hoy no tiene ninguna fila en ninguna
--     organizacion y el unico trigger que la lee (trg_partos_evaluar_sugerencia_reemplazo)
--     usa los defaults de columna (4 partos / 2 crias) cuando la organizacion no
--     tiene fila propia.
--   - TAREAS: la tabla no existe; fn_crear_tarea_destete sale sin insertar.
--   - Galpones, jaulas, lotes, reproductores, insumos, etc.: los siembra el propio
--     test con prefijo TEST-PANEL- (y los borra por UUID).
--   - Usuarios / PERFILES_USUARIO_INTERNOS: no hacen falta. El test siembra y lee
--     con service_role; la unica sesion real es la de ORG-TEST-DEMO (la "otra
--     organizacion" del aislamiento cruzado), que no depende de esta organizacion.
--   Lo unico que exige la base es la fila de ORGANIZACIONES: 34 tablas tienen
--   FOREIGN KEY ("ID_Organizacion" -> ORGANIZACIONES."ID"), p. ej. fk_pecuario_lotes_org.
--
-- PRIVILEGIOS (esta migracion NO cambia ningun GRANT, politica ni RLS)
--   public."ORGANIZACIONES" (dueno postgres, RLS activada, no forzada):
--     - postgres (Studio, donde la aplica Neyser) y service_role: SELECT/INSERT/
--       UPDATE/DELETE (saltan la RLS).
--     - authenticated: privilegio de tabla completo, pero solo hay politicas de
--       SELECT (ryzos_sel_organizaciones, rls_select_organizaciones): ve unicamente
--       su propia organizacion. No ve ORG-TEST-PANEL salvo que tenga perfil en ella.
--     - anon: privilegio de tabla, sin politica => ve 0 filas y no puede escribir.
--   Trigger existente: set_timestamp_organizaciones (BEFORE UPDATE); no se dispara
--   con un INSERT.
--
-- QUE NO HACE
--   - No toca el test (FASE 2, aparte, con revision de Cowork).
--   - No crea usuarios ni perfiles; no cambia RLS ni privilegios.
--
-- ROLLBACK: supabase/rollbacks/20261009090000_org_test_panel_rollback.sql
--
-- APLICACION: MANUAL por Neyser en Supabase Studio. El CLI NO aplica nada.
-- Redacto: Claude (Cowork) / Claude Code CLI. Revision de seguridad: pendiente.
-- =====================================================================

BEGIN;

INSERT INTO public."ORGANIZACIONES" (
    "ID",
    "Nombre_Organizacion",
    es_organizacion_prueba
) VALUES (
    'ORG-TEST-PANEL',
    'Organizacion de prueba - Panel de indicadores (NO ES CLIENTE REAL)',
    true
)
ON CONFLICT ("ID") DO NOTHING;

DO $verif$
DECLARE
  v_prueba boolean;
BEGIN
  SELECT es_organizacion_prueba INTO v_prueba
    FROM public."ORGANIZACIONES"
   WHERE "ID" = 'ORG-TEST-PANEL';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORG-TEST-PANEL no existe despues del INSERT';
  END IF;
  IF v_prueba IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ORG-TEST-PANEL existe pero NO esta marcada es_organizacion_prueba=true (es %): no se modifica; revisar a mano', v_prueba;
  END IF;
END
$verif$;

COMMIT;
