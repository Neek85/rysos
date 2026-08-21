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
-- NOT VALID: las 3 tablas EUDR_* tienen filas huérfanas existentes AHORA
-- MISMO — una FK validada de entrada (`ADD CONSTRAINT ... FOREIGN KEY`
-- sin `NOT VALID`) fallaría al aplicar esta migración. `NOT VALID` deja
-- el constraint activo para INSERT/UPDATE nuevos desde el momento en que
-- se aplica (impide que crezcan MÁS huérfanos), sin validar retroactivamente
-- las 14 filas existentes ni bloquear la tabla con un escaneo completo.
-- `VALIDATE CONSTRAINT` (que sí requiere que ya no haya huérfanos) queda
-- como paso separado, condicionado a que se confirme y ejecute la
-- limpieza de esas 14 filas — no incluido en esta migración a propósito
-- (ver ADR, "pendiente de confirmación explícita del usuario").
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

ALTER TABLE public."EUDR_MONITOREO"
    DROP CONSTRAINT IF EXISTS fk_eudr_monitoreo_organizacion;
ALTER TABLE public."EUDR_MONITOREO"
    ADD CONSTRAINT fk_eudr_monitoreo_organizacion
    FOREIGN KEY ("ID_Organizacion") REFERENCES public."ORGANIZACIONES"("ID")
    NOT VALID;

ALTER TABLE public."EUDR_USO_SUELO"
    DROP CONSTRAINT IF EXISTS fk_eudr_uso_suelo_organizacion;
ALTER TABLE public."EUDR_USO_SUELO"
    ADD CONSTRAINT fk_eudr_uso_suelo_organizacion
    FOREIGN KEY ("ID_Organizacion") REFERENCES public."ORGANIZACIONES"("ID")
    NOT VALID;

ALTER TABLE public."EUDR_INSTALACIONES"
    DROP CONSTRAINT IF EXISTS fk_eudr_instalaciones_organizacion;
ALTER TABLE public."EUDR_INSTALACIONES"
    ADD CONSTRAINT fk_eudr_instalaciones_organizacion
    FOREIGN KEY ("ID_Organizacion") REFERENCES public."ORGANIZACIONES"("ID")
    NOT VALID;

COMMIT;
