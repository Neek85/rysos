-- MIGRACIÓN IDEMPOTENTE: etiqueta es_organizacion_prueba en ORGANIZACIONES
-- + fila real y explícita para el E2E test — ver
-- docs/adr/ADR-008-etiqueta-organizacion-prueba-y-guardarail-e2e.md.
--
-- CONTEXTO: el incidente de ADR-007 (14 filas huérfanas de
-- "ORG-COOP-NORTE" acumuladas por corridas reales de
-- scripts/run_e2e_etl_test.py, borradas en el commit 2391859 tras
-- confirmación explícita del usuario) mostró que no existía ninguna
-- forma de distinguir, a nivel de esquema, una organización de prueba de
-- una real — cualquier borrado/actualización masiva dependía de que
-- alguien recordara verificarlo a mano. Esta migración agrega esa
-- distinción de forma explícita y seguridad-por-defecto.
--
-- DEFAULT false es intencional: cualquier organización sin marcar
-- explícitamente como de prueba se trata como REAL — el lado seguro del
-- error. Las 2 filas reales existentes hoy (COOP-JS, COOP-ND) quedan en
-- false automáticamente por el DEFAULT, sin necesidad de tocarlas.
--
-- La fila 'ORG-TEST-E2E' reemplaza el patrón anterior donde el E2E test
-- usaba un ID_Organizacion ("ORG-COOP-NORTE") sin fila correspondiente en
-- ORGANIZACIONES. A partir de ahora el dato de prueba SÍ tiene una fila
-- real, pero claramente etiquetada — y el propio script aborta si el
-- ID_Organizacion que va a usar no está marcado como de prueba (ver
-- scripts/run_e2e_etl_test.py::assert_org_is_test_marked).
--
-- RUC/Direccion_Fiscal/Representante_Legal se rellenan con placeholders
-- explícitos "N/A — organización sintética" en vez de dejarlos NULL: no
-- se confirmó si esas columnas son NOT NULL en la tabla real (creada
-- fuera de este repo, sin CREATE TABLE en el historial de migraciones —
-- ver docs/schema_live.md), así que se opta por el valor que funciona en
-- cualquiera de los dos casos.

BEGIN;

ALTER TABLE public."ORGANIZACIONES"
    ADD COLUMN IF NOT EXISTS es_organizacion_prueba boolean NOT NULL DEFAULT false;

INSERT INTO public."ORGANIZACIONES" (
    "ID",
    "Nombre_Organizacion",
    "RUC",
    "Direccion_Fiscal",
    "Representante_Legal",
    es_organizacion_prueba
) VALUES (
    'ORG-TEST-E2E',
    'Organización de Prueba — NO ES CLIENTE REAL',
    'N/A — organización sintética',
    'N/A — organización sintética (scripts/run_e2e_etl_test.py)',
    'N/A — organización sintética',
    true
)
ON CONFLICT ("ID") DO UPDATE SET
    "Nombre_Organizacion" = EXCLUDED."Nombre_Organizacion",
    es_organizacion_prueba = true;

COMMIT;
