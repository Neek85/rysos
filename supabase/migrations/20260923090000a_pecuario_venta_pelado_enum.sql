-- =====================================================================
-- RYZOS · Pecuario Cuyes · Venta pelado — PARTE A: agregar el valor de
-- enum (debe correrse SOLA y confirmarse antes de la parte B)
-- Fecha: 2026-09-23 (partida en dos archivos el 2026-09-23, corrección
-- propia de Claude Cowork sobre su propia migración original)
--
-- POR QUÉ ESTE ARCHIVO EXISTE SEPARADO: Postgres no permite usar
-- (comparar, castear) un valor de enum recién agregado con
-- `ALTER TYPE ... ADD VALUE` dentro de la MISMA transacción en que se
-- agregó — solo después de que esa transacción esté confirmada
-- (`ERROR: unsafe use of new value of enum type` si se intenta antes).
-- La migración original de esta tarea (ahora "parte B") agregaba el
-- valor 'pelado_beneficiado' Y lo usaba en el mismo archivo, dentro del
-- CHECK chk_ventas_base_precio_coherente — como Supabase Studio corre
-- todo el texto pegado como una sola transacción implícita, eso podía
-- fallar al crear ese CHECK. Se separa en dos pasos para que el valor
-- quede confirmado antes de usarse.
--
-- Este archivo, solo, es la única parte de las dos que debe pegarse y
-- correrse PRIMERO, sola, en Supabase Studio — sin la parte B pegada
-- en el mismo Run.
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('public."PECUARIO_VENTAS"') IS NULL THEN
    RAISE EXCEPTION 'Falta PECUARIO_VENTAS (20260910160000). Corré primero v1.';
  END IF;
END $$;

ALTER TYPE tipo_venta_cuy ADD VALUE IF NOT EXISTS 'pelado_beneficiado';

-- ---------------------------------------------------------------------
-- Verificación rápida (ejecutar a mano en Studio, en un Run APARTE
-- después de que este archivo haya corrido):
--
-- SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--   WHERE t.typname = 'tipo_venta_cuy' ORDER BY e.enumsortorder;
--   -- esperado: carne, pie_cria, reproductor_saca, guano, pelado_beneficiado
--
-- Recién con ese resultado confirmado, pegar y correr la parte B
-- (20260923090000b_pecuario_venta_pelado_beneficiado.sql) en un Run
-- nuevo y separado.
-- ---------------------------------------------------------------------