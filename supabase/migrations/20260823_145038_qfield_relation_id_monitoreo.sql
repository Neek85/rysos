-- MIGRACIÓN IDEMPOTENTE: agrega qfield_relation_id a EUDR_MONITOREO —
-- reemplaza el heurístico espacial temporal de ADR-005 (Fase A) por un
-- vínculo real entre una subdivisión de EUDR_USO_SUELO y el perímetro de
-- EUDR_MONITOREO al que pertenece. Ver
-- docs/adr/ADR-010-vinculo-real-uso-suelo-monitoreo.md.
--
-- CONTEXTO: en el GeoPackage original que sube cada técnico de campo, la
-- capa "EUDR_MONITOREO" trae su propia columna `id_monitoreo` — el GUID
-- interno que QField genera para la relación padre/hijo entre el
-- perímetro de Monitoreo y sus subdivisiones de Uso de Suelo/
-- Instalaciones (ej. "{4166dc2a-4cf0-452b-8eee-d5f68ce05e5c}"). Ese mismo
-- GUID SÍ se preserva tal cual en `EUDR_USO_SUELO.id_parcela` /
-- `EUDR_INSTALACIONES.id_parcela` — pero `scripts/etl_drive_to_supabase.py`
-- (`build_monitoreo_payload`) nunca lo lee del lado de `EUDR_MONITOREO`:
-- calcula un `id_monitoreo` propio, determinístico, a partir de
-- (organización, ID_Parcela_Fija, fecha) para poder hacer upsert
-- idempotente — un identificador completamente distinto, nunca igual al
-- GUID original de QField. El GUID quedaba disponible en la fila del
-- GeoPackage pero jamás se guardaba en ningún lado.
--
-- Esta columna es un identificador EXTERNO (generado por QField, no por
-- este sistema) — por eso lleva un índice para el JOIN, pero
-- deliberadamente NO una FK: no hay ninguna tabla local cuya PK sea este
-- valor, y el ETL no debe poder fallar por una referencia que no le
-- corresponde validar.

BEGIN;

ALTER TABLE public."EUDR_MONITOREO"
    ADD COLUMN IF NOT EXISTS qfield_relation_id text;

CREATE INDEX IF NOT EXISTS idx_eudr_monitoreo_qfield_relation_id
    ON public."EUDR_MONITOREO" (qfield_relation_id);

COMMIT;
