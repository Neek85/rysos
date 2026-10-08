-- =====================================================================
-- supabase/rollbacks/20261009090000_org_test_panel_rollback.sql
-- Revierte 20261009090000_org_test_panel.sql: elimina la fila ORG-TEST-PANEL.
-- =====================================================================
-- ATENCION - REGLA DE CONFIRMACION DE BORRADOS: esto es un DELETE contra una base
-- real. Aunque la organizacion este marcada es_organizacion_prueba=true, cae bajo la
-- regla de confirmacion explicita de borrados (Neyser debe confirmarlo antes de
-- ejecutarlo). El CLI no lo ejecuta.
--
-- ALCANCE: SOLO la fila "ID" = 'ORG-TEST-PANEL' de public."ORGANIZACIONES" (la unica
-- que sembro la migracion). Sin TRUNCATE. El DELETE lleva ademas el filtro
-- es_organizacion_prueba = true, asi que NO puede borrar una organizacion real.
--
-- PROTECCION CONTRA CASCADE: varias tablas hijas tienen FOREIGN KEY a ORGANIZACIONES
-- (algunas con ON DELETE CASCADE, p. ej. PECUARIO_SUGERENCIAS_REEMPLAZO). Antes de
-- borrar, el bloque cuenta las filas hijas de ORG-TEST-PANEL en TODAS las tablas con FK
-- a ORGANIZACIONES y ABORTA si hay alguna: nunca arrastra datos en cascada. Si el test
-- (fase 2) dejo residuos, hay que limpiarlos primero (con confirmacion).
--
-- NO TOCA: privilegios, RLS, politicas, usuarios.
-- IDEMPOTENTE: si la fila ya no existe, no hace nada. Transaccional.
-- Redactó: Claude Code CLI (Claude Sonnet 5.5). Visto bueno de seguridad: Claude (Cowork), 2026-10-09.
-- APLICACION MANUAL por Neyser en Supabase Studio.
-- =====================================================================

BEGIN;

DO $rollback$
DECLARE
  v_prueba boolean;
  r        record;
  v_n      bigint;
BEGIN
  SELECT es_organizacion_prueba INTO v_prueba
    FROM public."ORGANIZACIONES"
   WHERE "ID" = 'ORG-TEST-PANEL';

  IF NOT FOUND THEN
    RAISE NOTICE 'ORG-TEST-PANEL no existe: nada que borrar';
    RETURN;
  END IF;

  IF v_prueba IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ORG-TEST-PANEL NO esta marcada es_organizacion_prueba=true: no se borra';
  END IF;

  -- Filas hijas en cualquier tabla con FK a ORGANIZACIONES (solo conteo)
  FOR r IN
    SELECT c.conrelid::regclass AS rel, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'public."ORGANIZACIONES"'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.rel, r.col)
       INTO v_n USING 'ORG-TEST-PANEL';
    IF v_n > 0 THEN
      RAISE EXCEPTION 'No se borra ORG-TEST-PANEL: % tiene % fila(s) de ORG-TEST-PANEL (limpiar primero, con confirmacion)', r.rel, v_n;
    END IF;
  END LOOP;

  DELETE FROM public."ORGANIZACIONES"
   WHERE "ID" = 'ORG-TEST-PANEL'
     AND es_organizacion_prueba = true;
END
$rollback$;

COMMIT;
