# Spec — CLI de Ingesta de Cobertura Boscosa/Pérdida Forestal

## Contexto

Cierra el último paso pendiente de `specs/eudr_forest_cover_2020_schema.md`:
la tabla `EUDR_COBERTURA_BOSCOSA_2020` y el cruce en
`fn_validar_topologia_eudr` ya existen (vacíos), este script es el
mecanismo real para poblarla desde un archivo vectorial oficial (MINAM
Geobosques / Hansen GFW / PNCBM). Sigue sin ejecutarse automáticamente —
es una operación manual del operador, mismo criterio que
`scripts/etl_drive_to_supabase.py`.

## Corrección de premisa: sin test de integración contra Supabase real

El prompt pedía verificar con un test "que el pipeline puebla la tabla
correctamente y que `fn_validar_topologia_eudr` detecta solapamientos
reales" — eso requeriría una tabla `EUDR_COBERTURA_BOSCOSA_2020` real en
la instancia (`jhtocgxlozfuzullrtol`), y **esa migración todavía no está
aplicada** (confirmado, sigue pendiente de aplicación manual). Un test
`NEEDS_SUPABASE` que asumiera la tabla ya creada fallaría en CI con
"relation does not exist" en vez de saltarse limpio hasta que alguien la
aplique — un resultado peor que no tener el test. Se cubre en cambio el
pipeline de transformación completo (reproyección, reparación/
simplificación de geometría, resolución de año, construcción de payload,
chunking, manejo de error por lote) con un cliente Supabase falso
inyectado — mismo patrón ya usado en
`tests/test_fase2_etl.py::test_pipeline_sets_pendiente_on_insert`.

## Diseño

- **`scripts/ingest_forest_cover.py`**: CLI (`argparse`) — un archivo
  `.geojson`/`.gpkg`/`.shp` vía `geopandas.read_file` (mismo mecanismo que
  `scripts/etl_drive_to_supabase.py`, GDAL/Fiona ya en `requirements.txt`,
  sin dependencia nueva).
  - `load_source`: reproyecta a EPSG:4326 si el CRS de origen es distinto
    (UTM 17S/18S u otro) — mismo patrón `to_crs(epsg=4326)` ya usado.
  - `sanitize_geometry`: `shapely.validation.make_valid` (equivalente a
    `ST_MakeValid`) + `simplify(tolerance, preserve_topology=True)`
    (equivalente a `ST_SimplifyPreserveTopology`) + normalización a
    `MultiPolygon` (la columna real de la tabla) — geometrías vacías o no
    polygonales (líneas/puntos, un dataset de cobertura forestal nunca
    debería traerlas, pero se descartan explícitamente si aparecen) se
    excluyen, nunca lanzan.
  - `resolve_anio_perdida`: mismo cuidado "NaN es truthy" ya documentado 3
    veces en `scripts/etl_drive_to_supabase.py` — nunca confía en
    `if valor else ...` sobre una columna numérica de geopandas.
  - `build_rows`: arma el payload — geometría como GeoJSON
    (`shapely.geometry.mapping()`, el mismo formato que ya usa el ETL de
    QField para insertar en columnas `geometry` vía PostgREST, no
    WKT/WKB) — y **whitelist explícito** (`ALLOWED_COLUMNS`) de las 4
    columnas reales de la tabla, para garantizar "cero PII" incluso si el
    archivo fuente trajera columnas de atributos inesperadas.
  - `ingest`: carga por lotes (`chunked`, tamaño configurable vía
    `--batch-size`) usando el cliente `supabase-py` ya estándar en este
    proyecto (no se agrega SQLAlchemy como alternativa — mantiene un solo
    cliente de base de datos en todo el código Python del repo). Un lote
    fallido se reporta y NO detiene los siguientes. Progreso impreso a
    stdout por lote (`[PROGRESO] Lote X/Y — ...`) — sin agregar `tqdm`
    como dependencia nueva, mismo criterio conservador de dependencias ya
    aplicado varias veces en este proyecto.
  - `--dry-run`: parsea/valida/transforma sin escribir nada ni requerir
    credenciales — para revisar cuántas features quedarían antes de
    correr la carga real.

## Fuera de alcance

- Descargar el dataset MINAM Geobosques/Hansen GFW automáticamente (el
  operador provee el archivo ya descargado).
- Aplicar la migración `20260820_eudr_cobertura_boscosa_2020.sql` en la
  instancia real (manual, como toda migración de este repo) — sin eso,
  correr este script fallaría con "relation does not exist".

## Criterios de aceptación

- AC1: `sanitize_geometry` nunca devuelve una geometría inválida ni no
  polygonal.
- AC2: `build_rows` nunca produce un payload con una clave fuera de
  `ALLOWED_COLUMNS`.
- AC3: Un lote fallido no impide que se procesen los lotes siguientes.
- AC4: `--dry-run` no requiere `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.
