# Spec — Motor de Pre-Validación Satelital EUDR: ANP real + deforestación real

Retoma y cierra lo pausado en `specs/qc_topological_eudr_validation.md` y
`specs/eudr_forest_cover_2020_schema.md` (donde se pausó explícitamente con
`AskUserQuestion` para no fabricar un veredicto de cumplimiento EUDR falso
sin datos reales detrás) y en `specs/modulo_prevalidacion_satelital.md`
(el motor Python `scripts/satellite_prevalidation.py::SatellitePrevalidationEngine`,
que ya sabe evaluar ANP/deforestación pero solo recibe polígonos como
parámetro del caller, nunca los lee de una tabla propia — esta tarea es
la contraparte SQL/en vivo para `fn_validar_topologia_eudr`, la Consola QC
WebGIS). Sentinel-2/NDVI queda fuera de alcance a propósito, para una spec
aparte.

## Correcciones de premisa (verificadas en vivo antes de escribir código)

1. **`EUDR_COBERTURA_BOSCOSA_2020` NO EXISTE en la instancia real hoy**
   (confirmado por REST: `PGRST205 "Could not find the table
   'public.EUDR_COBERTURA_BOSCOSA_2020' in the schema cache"`). La
   migración que la crea (`20260820_eudr_cobertura_boscosa_2020.sql`)
   nunca se aplicó manualmente — sigue pendiente desde agosto, igual que
   toda migración de este repo (paso manual del usuario en Supabase
   Studio). El prompt original asumía que esta tabla "ya existe" (pedía
   "no recrear tabla/índice que ya existen") — la migración nueva de esta
   tarea SÍ vuelve a crearla (`CREATE TABLE IF NOT EXISTS`, idempotente,
   sin riesgo si en algún momento se aplica la de agosto primero), para
   que esta tarea no dependa silenciosamente de que alguien aplique antes
   una migración de hace 3 semanas que nunca se aplicó.
2. **La definición REAL y VIGENTE hoy de `fn_validar_topologia_eudr` no es
   la de `20260820_fn_validar_topologia_eudr.sql`/
   `20260820_eudr_cobertura_boscosa_2020.sql` que cita el prompt — es la de
   `20260822_173416_fn_validar_topologia_contencion_parcela.sql`**
   (confirmado invocando la RPC real en vivo: la respuesta real incluye
   la clave `contenido_en_parcela_propia`, que solo existe en esa versión
   de agosto 22, la más reciente de las 3 que reemplazan esta función).
   Esa versión de agosto 22 fue escrita sobre la base de la de agosto 20
   *original* (sin cruce real de deforestación) — nunca incorporó el
   `CREATE OR REPLACE` de `20260820_eudr_cobertura_boscosa_2020.sql`, así
   que **la lógica real de deforestación quedó regresionada a
   `{disponible:false}` fijo** desde agosto 22, sin que ninguna tarea
   posterior lo notara (confirmado en vivo: el `motivo` real devuelto por
   la RPC hoy es literalmente el texto de la versión de agosto 20 sin el
   cruce, `"Sin fuente de datos de cobertura boscosa integrada — ver
   specs/qc_topological_eudr_validation.md."`). La migración de esta tarea
   parte de la versión de **agosto 22** (con `contenido_en_parcela_propia`
   intacto) y le agrega `anp`/`deforestacion` reales — no de la de agosto
   20 como decía el prompt, para no volver a regresionar la contención.
3. **`scripts/ingest_forest_loss_layer.py` (paso 4, segundo script) ya
   existe — como `scripts/ingest_forest_cover.py`** (completo: lee
   GeoJSON/GPKG/Shapefile vía GeoPandas, reproyecta a 4326,
   `ST_MakeValid`+simplifica+normaliza a MultiPolygon, resuelve
   `anio_perdida` por columna o fijo, inserta en lotes a
   `EUDR_COBERTURA_BOSCOSA_2020` con `SUPABASE_SERVICE_ROLE_KEY` desde
   variable de entorno). Esta tarea **no crea un script duplicado** — en
   cambio, le agrega la propiedad de idempotencia por `dataset_version`
   que el prompt pedía y que el script original no tenía (hacía un
   `INSERT` liso; re-correrlo duplicaba filas). `scripts/ingest_anp_layer.py`
   sí es genuinamente nuevo (no existía nada equivalente para ANP).
   - **Idempotencia sin `DELETE` ciego de "la versión anterior":** antes
     de insertar, si se pasó `--dataset-version`, se borran (con Service
     Role Key, un `DELETE ... WHERE dataset_version = <esa misma versión
     exacta>`) solo las filas de ESA MISMA versión que se está
     re-ingestando — nunca las de otra versión, y nunca un `DELETE` sin
     `dataset_version` (si no se pasó ese flag, no hay forma segura de
     acotar el borrado, así que no se borra nada y re-correr sin
     `--dataset-version` duplica filas a propósito, documentado en el
     `--help`).
4. **Formato de retorno confirmado compatible:** `lib/qcTopologyValidation.js::describeDeforestationBadge`
   ya existe exactamente como lo describe el prompt (`ok:null` mientras
   `disponible:false`) — se reutiliza el mismo criterio, sin cambios, para
   `describeAnpBadge` nueva.
5. **El umbral de 5 km de `specs/opcion_c_evaluacion_riesgo_legalidad.md`
   (`PROTECTED_AREA`, 15 pts) es real** — confirmado leyendo esa spec. La
   columna `distancia_minima_km` de `fn_evaluar_anp_eudr` queda calculada
   siempre (no solo cuando hay alerta) para que ese motor futuro pueda
   reusarla sin repetir el cruce espacial.

## Diseño (sin cambios respecto al prompt salvo lo anterior)

- `EUDR_AREAS_PROTEGIDAS`: dataset de referencia compartido (no
  multi-tenant), mismo criterio ya documentado para
  `EUDR_COBERTURA_BOSCOSA_2020` (verdad geográfica compartida, no
  propiedad de una organización).
- `fn_evaluar_deforestacion_eudr(p_geom)` / `fn_evaluar_anp_eudr(p_geom)`:
  funciones utilitarias `STABLE`, reusan `fn_calcular_area_ha` (nunca
  reimplementan el cálculo de área).
- `fn_validar_topologia_eudr`: `CREATE OR REPLACE` sobre la base real
  (agosto 22, con `contenido_en_parcela_propia`), agrega `anp` y
  `deforestacion` reales vía las 2 funciones de arriba — el resto de la
  lógica (topología, solapamiento, contención propia) intacto.
- `describeAnpBadge` (`lib/qcTopologyValidation.js`), render en
  `QcDetailEditor.jsx` junto al badge de deforestación existente
  (mismo bloque, `validationResult && (...)`, línea ~409 de ese archivo).

## Fuera de alcance (a propósito)

- Sentinel-2/NDVI (spec aparte, según el prompt original).
- Motor de riesgo legal completo de `specs/opcion_c_evaluacion_riesgo_legalidad.md`
  — `distancia_minima_km` queda disponible para cuando se construya, no
  se integra acá.
- Backfill/carga real de datos SERNANP/MINAM Geobosques — los scripts de
  ingesta son manuales, el operador decide cuándo correrlos (mismo
  criterio que `scripts/etl_drive_to_supabase.py`).
