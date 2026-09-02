-- MIGRACIÓN BASE (adopción, no creación): captura el schema real y exacto
-- de PADRON_SOCIOS/PADRON_PARCELAS en el historial de migraciones de este
-- repo. Ver docs/adr/ADR-023-backend-inspecciones-ya-no-comparte-base.md
-- y specs/padron_baseline_adopcion.md.
--
-- Ambas tablas fueron creadas fuera de este repo (Supabase Studio / otra
-- herramienta) y nunca tuvieron un CREATE TABLE versionado hasta ahora —
-- son, junto con ORGANIZACIONES, las últimas 2 tablas base en esa
-- situación. Confirmado en vivo (introspección OpenAPI de PostgREST,
-- Service Role Key, 2026-08-25) columna por columna, tipo por tipo,
-- nulabilidad y default por default.
--
-- CREATE TABLE IF NOT EXISTS contra una tabla que ya existe es un no-op
-- garantizado por Postgres: la definición de columnas de abajo NUNCA se
-- evalúa si la tabla ya está presente (que es el caso en toda instancia
-- real hoy). No agrega RLS, no agrega índices más allá de la PK, no
-- agrega FKs — solo documenta la forma real de la tabla. Sirve como base
-- conocida para la siguiente tarea de la secuencia
-- (multi_organizacion_codigos_unicos.md), que sí va a alterar la PK.
--
-- Columnas confirmadas pero SIN uso conocido en ningún lugar del repo,
-- incluidas tal cual por fidelidad al schema real (no se elimina nada
-- acá — ver spec para el detalle):
--   - PADRON_SOCIOS.normas_internas_17 (text) — huérfana, sin referencias
--     en código/specs/ADRs/migraciones.
--
-- Discrepancia de tipos real, documentada aquí, NO corregida en esta
-- tarea (cero cambios de comportamiento es el contrato):
--   - PADRON_PARCELAS.hbp y PADRON_PARCELAS.otros_cultivo son `text` en
--     la instancia real, no `numeric` como el resto de las columnas de
--     hectáreas (hcp/hcc/ho/hip/hrp) ni como las trata
--     lib/validations/socios.js (HECTARE_FIELDS, coerción Zod numérica).

BEGIN;

CREATE TABLE IF NOT EXISTS public."PADRON_SOCIOS" (
    "ID_Socio" text PRIMARY KEY,
    "ID_Organizacion" text,
    codigo_finca text,
    socio_nombre_completo text,
    socio_dni text,
    socio_genero text,
    socio_fecha_nacimiento date,
    celular_socio text,
    conyuge_nombre text,
    conyuge_dni text,
    socio_departamento text,
    socio_provincia text,
    socio_distrito text,
    localidad text,
    certificaciones text,
    cert_org_estatus text,
    cert_nop_usda text,
    ue_2018_848 text,
    cor_canada text,
    cert_ds_0442006_ag text,
    cert_lpo_mx text,
    cert_rainforest text,
    cert_comercio_justo text,
    cert_fair_trade_usa text,
    normas_internas_17 text,
    socio_fecha_ingreso date,
    creado_en timestamptz DEFAULT now(),
    actualizado_en timestamptz DEFAULT now(),
    creado_por text,
    activo boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public."PADRON_PARCELAS" (
    "ID_Parcela_Fija" text PRIMARY KEY,
    "ID_Organizacion" text,
    "ID_Socio" text,
    socio_dni text,
    socio_nombre_completo text,
    parcela_codigo text,
    parcela_nombre text,
    hcp numeric,
    hcc numeric,
    ho numeric,
    hip numeric,
    hrp numeric,
    hbp text,
    otros_cultivo text,
    totalh numeric,
    geom public.geometry(MultiPolygon, 4326),
    creado_en timestamptz DEFAULT now(),
    actualizado_en timestamptz DEFAULT now(),
    creado_por text,
    hr text,
    activo boolean NOT NULL DEFAULT true
);

COMMIT;
