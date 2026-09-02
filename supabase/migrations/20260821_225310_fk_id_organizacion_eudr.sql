-- MIGRACIÓN IDEMPOTENTE: FK de "ID_Organizacion" hacia ORGANIZACIONES("ID")
-- en EUDR_MONITOREO / EUDR_USO_SUELO / EUDR_INSTALACIONES — ver
-- docs/adr/ADR-007-integridad-referencial-id-organizacion.md.
--
-- CONTEXTO: auditoría real (2026-08-21) encontró que "ID_Organizacion" no
-- tenía NINGUNA FK en todo el schema (confirmado con PostgREST — 5 tablas
-- consultadas, "no matches were found" en las 5). El único huérfano real
-- encontrado en TODO el esquema (EUDR_MONITOREO/EUDR_USO_SUELO/
-- EUDR_INSTALACIONES/PADRON_SOCIOS/PADRON_PARCELAS/INSPECCIONES — los 6
-- CAP_* no tienen columna ID_Organizacion propia, PECUARIO_*/SYNC_QUEUE/
-- PRECIOS_PRODUCTO todavía no existen en la instancia real) es
-- "ORG-COOP-NORTE" (6+4+4 = 14 filas en las 3 tablas EUDR_*, dato real de
-- `scripts/run_e2e_etl_test.py` corrido repetidas veces contra la
-- instancia viva, sin fila correspondiente en ORGANIZACIONES — ver ADR).
--
-- ACTUALIZACIÓN 2026-08-21: el usuario confirmó el borrado y las 14 filas
-- huérfanas ("ORG-COOP-NORTE") ya fueron eliminadas de la instancia viva
-- (6 EUDR_MONITOREO + 4 EUDR_USO_SUELO + 4 EUDR_INSTALACIONES, conteos
-- verificados en 0 tras el DELETE — ver ADR). Por eso esta migración ahora
-- incluye también el DELETE (idempotente — no falla si ya no hay filas
-- que borrar, para que este archivo sea reproducible en cualquier entorno)
-- y el VALIDATE CONSTRAINT al final, en la misma transacción: sin
-- huérfanos, no hay motivo para dejar la FK sin validar.
--
-- NOT VALID en el ADD CONSTRAINT sigue siendo necesario aunque el DELETE
-- vaya primero en este mismo archivo: es la única forma de agregar una FK
-- en Postgres sin que el ADD CONSTRAINT dispare automáticamente un escaneo
-- de validación completo de la tabla en el mismo paso (no hay una opción
-- "ADD CONSTRAINT ... VALIDATED" directa) — por eso se separa en dos
-- sentencias, ADD CONSTRAINT NOT VALID seguido de VALIDATE CONSTRAINT.
--
-- PADRON_SOCIOS / PADRON_PARCELAS deliberadamente FUERA de esta migración
-- pese a tener 0 huérfanos hoy: son el padrón maestro, documentado en
-- CLAUDE.md como "compartido en vivo con otro repositorio" — una FK ahí
-- (aunque sea NOT VALID) empezaría a RECHAZAR inserts nuevos de ese otro
-- repositorio si alguna vez escribe un ID_Organizacion que todavía no
-- existe en ORGANIZACIONES de este lado, un riesgo de coordinación
-- cross-repo real que no corresponde asumir unilateralmente acá. Ver ADR
-- para el detalle completo de esta decisión.

BEGIN;

-- Limpieza de datos de prueba (idempotente: DELETE de un ID_Organizacion
-- que ya no existe en la tabla simplemente no afecta filas).
DELETE FROM public."EUDR_MONITOREO" WHERE "ID_Organizacion" = 'ORG-COOP-NORTE';
DELETE FROM public."EUDR_USO_SUELO" WHERE "ID_Organizacion" = 'ORG-COOP-NORTE';
DELETE FROM public."EUDR_INSTALACIONES" WHERE "ID_Organizacion" = 'ORG-COOP-NORTE';

ALTER TABLE public."EUDR_MONITOREO"
    DROP CONSTRAINT IF EXISTS fk_eudr_monitoreo_organizacion;
ALTER TABLE public."EUDR_MONITOREO"
    ADD CONSTRAINT fk_eudr_monitoreo_organizacion
    FOREIGN KEY ("ID_Organizacion") REFERENCES public."ORGANIZACIONES"("ID")
    NOT VALID;
ALTER TABLE public."EUDR_MONITOREO"
    VALIDATE CONSTRAINT fk_eudr_monitoreo_organizacion;

ALTER TABLE public."EUDR_USO_SUELO"
    DROP CONSTRAINT IF EXISTS fk_eudr_uso_suelo_organizacion;
ALTER TABLE public."EUDR_USO_SUELO"
    ADD CONSTRAINT fk_eudr_uso_suelo_organizacion
    FOREIGN KEY ("ID_Organizacion") REFERENCES public."ORGANIZACIONES"("ID")
    NOT VALID;
ALTER TABLE public."EUDR_USO_SUELO"
    VALIDATE CONSTRAINT fk_eudr_uso_suelo_organizacion;

ALTER TABLE public."EUDR_INSTALACIONES"
    DROP CONSTRAINT IF EXISTS fk_eudr_instalaciones_organizacion;
ALTER TABLE public."EUDR_INSTALACIONES"
    ADD CONSTRAINT fk_eudr_instalaciones_organizacion
    FOREIGN KEY ("ID_Organizacion") REFERENCES public."ORGANIZACIONES"("ID")
    NOT VALID;
ALTER TABLE public."EUDR_INSTALACIONES"
    VALIDATE CONSTRAINT fk_eudr_instalaciones_organizacion;

COMMIT;
