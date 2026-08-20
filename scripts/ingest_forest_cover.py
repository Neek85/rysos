"""
CLI de ingesta de datos de cobertura boscosa / pérdida forestal
(MINAM Geobosques, Hansen GFW, PNCBM) a `EUDR_COBERTURA_BOSCOSA_2020`.

Ver specs/eudr_forest_ingestion_cli.md — complementa
supabase/migrations/20260820_eudr_cobertura_boscosa_2020.sql (que crea la
tabla vacía) con el pipeline real para poblarla desde un archivo vectorial
oficial. Este script sigue siendo el ÚNICO paso que falta para que
fn_validar_topologia_eudr empiece a devolver `deforestacion.disponible =
true` con datos reales — nunca se ejecuta automáticamente, es una
operación manual del operador (mismo criterio que
scripts/etl_drive_to_supabase.py, que tampoco corre solo).

Uso:
    python scripts/ingest_forest_cover.py <archivo.geojson|.gpkg|.shp> \
        --fuente HANSEN_GFW [--anio-columna lossyear] \
        [--anio-fijo 2022] [--dataset-version v1.11] \
        [--batch-size 500] [--dry-run]

`--anio-columna` resuelve el año de pérdida por FEATURE desde una columna
del archivo fuente (ej. el campo "lossyear" de Hansen GFW, 1-24 -> 2001-2024
según su convención real, ver nota en resolve_anio_perdida). Si el archivo
no trae año por feature (ej. un solo polígono "cobertura boscosa 2020"
sin discriminar cuándo se perdió), usar --anio-fijo para aplicar el mismo
año a todas las filas. Ninguno de los dos es obligatorio: sin ninguno, se
inserta con anio_perdida NULL (fn_validar_topologia_eudr ignora esas filas
en el cruce post-2020 a propósito, ver la migración).
"""

import argparse
import math
import os
import sys
from pathlib import Path

import geopandas as gpd
from shapely.geometry import MultiPolygon, mapping
from shapely.validation import make_valid

TABLE_NAME = "EUDR_COBERTURA_BOSCOSA_2020"
DEFAULT_BATCH_SIZE = 500
# ~1e-5 grados ~= 1.1m en el ecuador — conservador para no perder detalle
# real de un polígono de pérdida forestal, solo colapsa vértices
# redundantes de la vectorización satelital (a menudo miles por polígono).
SIMPLIFY_TOLERANCE_DEG = 0.00001

# INVARIANTE (garantiza "cero PII"): estas son las ÚNICAS columnas que este
# script puede escribir en la tabla — un shapefile fuente con columnas de
# atributos inesperadas (ej. si alguien reutiliza por error un archivo con
# datos de otro proyecto) nunca las propaga. Mismo criterio de whitelist ya
# usado en el proyecto (EDITABLE_FIELDS en lib/eudrQcActions.js,
# updateRecordAttributes nunca hace un Object.assign genérico).
ALLOWED_COLUMNS = {"geom", "anio_perdida", "fuente", "dataset_version"}


def load_source(path: Path) -> gpd.GeoDataFrame:
    """Lee el archivo vectorial (.geojson/.gpkg/.shp, vía GDAL/Fiona) y lo
    reproyecta a EPSG:4326 si hace falta — mismo patrón que
    scripts/etl_drive_to_supabase.py::load_layer."""
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        raise ValueError(
            f"{path} no declara un CRS — no se puede reproyectar con seguridad. "
            "Verificar el archivo fuente (¿falta el .prj de un Shapefile?)."
        )
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    return gdf


def sanitize_geometry(geom):
    """ST_MakeValid + ST_SimplifyPreserveTopology equivalentes en Shapely,
    y normalización a MultiPolygon (columna real de la tabla). Devuelve
    None para geometrías vacías o no polygonales (líneas/puntos) — este
    dataset es de polígonos de cobertura/pérdida forestal únicamente."""
    if geom is None or geom.is_empty:
        return None
    if not geom.is_valid:
        geom = make_valid(geom)
    if geom.is_empty:
        return None
    geom = geom.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
    if geom.geom_type == "Polygon":
        geom = MultiPolygon([geom])
    if geom.geom_type != "MultiPolygon":
        return None
    return geom


def resolve_anio_perdida(row, anio_columna):
    """Año de pérdida forestal para una fila — NUNCA usa un valor `if
    valor else ...` (patrón "NaN es truthy" ya mordió este proyecto 3
    veces en scripts/etl_drive_to_supabase.py, ver [[project_ryzos]]):
    columnas numéricas leídas por geopandas pueden traer NaN (float),
    que es truthy en Python."""
    if not anio_columna:
        return None
    valor = row.get(anio_columna)
    if valor is None:
        return None
    if isinstance(valor, float) and math.isnan(valor):
        return None
    try:
        return int(valor)
    except (TypeError, ValueError):
        return None


def build_rows(gdf, anio_columna, anio_fijo, fuente, dataset_version):
    """Convierte el GeoDataFrame ya reproyectado a una lista de payloads
    listos para insertar — geometría como GeoJSON (mapping(), mismo
    formato que ya usa scripts/etl_drive_to_supabase.py para insertar en
    columnas `geometry` vía PostgREST, no WKT/WKB)."""
    rows = []
    skipped = 0
    for _, source_row in gdf.iterrows():
        geom = sanitize_geometry(source_row.geometry)
        if geom is None:
            skipped += 1
            continue
        anio = resolve_anio_perdida(source_row, anio_columna) if anio_columna else anio_fijo
        rows.append(
            {
                "geom": mapping(geom),
                "anio_perdida": anio,
                "fuente": fuente,
                "dataset_version": dataset_version,
            }
        )
    assert all(set(r) <= ALLOWED_COLUMNS for r in rows), "Payload con columnas fuera del whitelist — no debería pasar nunca."
    return rows, skipped


def chunked(items, size):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def ingest(
    path,
    fuente,
    anio_columna=None,
    anio_fijo=None,
    dataset_version=None,
    batch_size=DEFAULT_BATCH_SIZE,
    dry_run=False,
    supabase_client=None,
):
    """Orquesta el pipeline completo. `supabase_client` es inyectable para
    tests — evita crear un cliente real (y sus credenciales) en el camino
    puro de transformación de datos."""
    gdf = load_source(Path(path))
    rows, skipped = build_rows(gdf, anio_columna, anio_fijo, fuente, dataset_version)

    print(f"[INGEST-BOSCOSA] {path}: {len(rows)} feature(s) válida(s), {skipped} descartada(s) (geometría vacía o no polygonal).")

    if dry_run:
        print(f"[DRY-RUN] {len(rows)} fila(s) listas para insertar en {TABLE_NAME} — no se escribió nada.")
        return {"total": len(rows), "skipped": skipped, "inserted": 0, "failed": 0}

    supabase = supabase_client
    if supabase is None:
        from supabase import create_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            print("[ERROR] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
            sys.exit(1)
        supabase = create_client(url, key)

    inserted = 0
    failed = 0
    batches = list(chunked(rows, batch_size))
    for i, batch in enumerate(batches, start=1):
        try:
            supabase.table(TABLE_NAME).insert(batch).execute()
            inserted += len(batch)
        except Exception as exc:  # noqa: BLE001 — un lote fallido no debe abortar los siguientes
            failed += len(batch)
            print(f"[ERROR] Lote {i}/{len(batches)} falló ({len(batch)} fila(s)): {exc}")
        print(f"[PROGRESO] Lote {i}/{len(batches)} — {inserted} insertada(s), {failed} fallida(s) hasta ahora.")

    return {"total": len(rows), "skipped": skipped, "inserted": inserted, "failed": failed}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("archivo", help="Ruta al .geojson/.gpkg/.shp con los polígonos de cobertura/pérdida forestal")
    parser.add_argument("--fuente", required=True, help='Ej. "HANSEN_GFW", "MINAM_GEOBOSQUES", "PNCBM"')
    parser.add_argument("--anio-columna", default=None, help="Nombre de columna con el año de pérdida por feature")
    parser.add_argument("--anio-fijo", type=int, default=None, help="Año único a aplicar a todas las filas (si no hay columna por feature)")
    parser.add_argument("--dataset-version", default=None, help="Ej. versión/fecha de publicación del dataset fuente")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--dry-run", action="store_true", help="Parsea y valida sin escribir nada en Supabase")
    args = parser.parse_args()

    result = ingest(
        args.archivo,
        fuente=args.fuente,
        anio_columna=args.anio_columna,
        anio_fijo=args.anio_fijo,
        dataset_version=args.dataset_version,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
    )
    print(f"[RESULTADO] {result}")


if __name__ == "__main__":
    main()
