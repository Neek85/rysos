"""
CLI de ingesta de polígonos oficiales de Áreas Naturales Protegidas
(SERNANP) a `EUDR_AREAS_PROTEGIDAS`.

Ver specs/motor_prevalidacion_satelital_anp_bosque.md — complementa
supabase/migrations/20260909000000_anp_y_deforestacion_real.sql (que crea
la tabla vacía) con el pipeline real para poblarla desde un archivo
vectorial oficial. Mismo patrón exacto que scripts/ingest_forest_cover.py
(que cumple el mismo rol para EUDR_COBERTURA_BOSCOSA_2020) — nunca corre
automáticamente, es una operación manual del operador.

Uso:
    python scripts/ingest_anp_layer.py <archivo.geojson|.gpkg|.shp> \
        [--nombre-columna nombre] [--categoria-columna categoria] \
        [--base-legal-columna base_legal] [--fuente SERNANP] \
        [--dataset-version 2026-09] [--batch-size 500] [--dry-run]

Idempotente por `--dataset-version`: si se pasa, antes de insertar se
borran (Service Role Key) solo las filas que ya tengan ESA MISMA versión
exacta — nunca las de otra versión, y nunca un DELETE sin
`--dataset-version` (sin ese flag no hay forma segura de acotar el
borrado; re-correr sin él duplica filas a propósito, no se asume cuál
sería "la versión anterior" a reemplazar).
"""

import argparse
import math
import os
import sys
from pathlib import Path

import geopandas as gpd
from shapely.geometry import MultiPolygon, mapping
from shapely.validation import make_valid

TABLE_NAME = "EUDR_AREAS_PROTEGIDAS"
DEFAULT_BATCH_SIZE = 500
DEFAULT_FUENTE = "SERNANP"
# Mismo criterio que scripts/ingest_forest_cover.py::SIMPLIFY_TOLERANCE_DEG.
SIMPLIFY_TOLERANCE_DEG = 0.00001

# INVARIANTE (garantiza "cero PII"): ver el mismo criterio en
# scripts/ingest_forest_cover.py::ALLOWED_COLUMNS.
ALLOWED_COLUMNS = {"geom", "nombre", "categoria", "base_legal", "fuente", "dataset_version"}


def load_source(path: Path) -> gpd.GeoDataFrame:
    """Mismo patrón que scripts/ingest_forest_cover.py::load_source."""
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
    """Mismo patrón que scripts/ingest_forest_cover.py::sanitize_geometry."""
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


def resolve_text_field(row, columna):
    """Igual criterio anti-"NaN es truthy" que
    scripts/ingest_forest_cover.py::resolve_anio_perdida — un valor NaN
    (float) leído de una columna de texto vacía por geopandas nunca debe
    guardarse como el string "nan"."""
    if not columna:
        return None
    valor = row.get(columna)
    if valor is None:
        return None
    if isinstance(valor, float) and math.isnan(valor):
        return None
    valor = str(valor).strip()
    return valor or None


def build_rows(gdf, nombre_columna, categoria_columna, base_legal_columna, fuente, dataset_version):
    """Mismo patrón que scripts/ingest_forest_cover.py::build_rows."""
    rows = []
    skipped = 0
    for _, source_row in gdf.iterrows():
        geom = sanitize_geometry(source_row.geometry)
        if geom is None:
            skipped += 1
            continue
        rows.append(
            {
                "geom": mapping(geom),
                "nombre": resolve_text_field(source_row, nombre_columna),
                "categoria": resolve_text_field(source_row, categoria_columna),
                "base_legal": resolve_text_field(source_row, base_legal_columna),
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
    nombre_columna=None,
    categoria_columna=None,
    base_legal_columna=None,
    fuente=DEFAULT_FUENTE,
    dataset_version=None,
    batch_size=DEFAULT_BATCH_SIZE,
    dry_run=False,
    supabase_client=None,
):
    """Orquesta el pipeline completo. `supabase_client` es inyectable para
    tests — mismo criterio que scripts/ingest_forest_cover.py::ingest."""
    gdf = load_source(Path(path))
    rows, skipped = build_rows(gdf, nombre_columna, categoria_columna, base_legal_columna, fuente, dataset_version)

    print(f"[INGEST-ANP] {path}: {len(rows)} feature(s) válida(s), {skipped} descartada(s) (geometría vacía o no polygonal).")

    if dry_run:
        print(f"[DRY-RUN] {len(rows)} fila(s) listas para insertar en {TABLE_NAME} — no se escribió nada.")
        return {"total": len(rows), "skipped": skipped, "deleted_previous_same_version": 0, "inserted": 0, "failed": 0}

    supabase = supabase_client
    if supabase is None:
        from supabase import create_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            print("[ERROR] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
            sys.exit(1)
        supabase = create_client(url, key)

    deleted_previous_same_version = 0
    if dataset_version:
        # Idempotente por dataset_version: solo borra filas de ESA MISMA
        # versión exacta (nunca "la versión anterior" en general, ver
        # docstring del módulo) para que re-correr el mismo comando no
        # duplique filas.
        del_res = supabase.table(TABLE_NAME).delete().eq("dataset_version", dataset_version).execute()
        deleted_previous_same_version = len(del_res.data or [])
        if deleted_previous_same_version:
            print(f"[IDEMPOTENCIA] Borradas {deleted_previous_same_version} fila(s) previas de dataset_version={dataset_version!r} antes de re-insertar.")

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

    return {
        "total": len(rows),
        "skipped": skipped,
        "deleted_previous_same_version": deleted_previous_same_version,
        "inserted": inserted,
        "failed": failed,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("archivo", help="Ruta al .geojson/.gpkg/.shp con los polígonos oficiales de ANP")
    parser.add_argument("--nombre-columna", default=None, help="Nombre de columna con el nombre del ANP")
    parser.add_argument("--categoria-columna", default=None, help="Nombre de columna con la categoría (Parque Nacional, Reserva, etc.)")
    parser.add_argument("--base-legal-columna", default=None, help="Nombre de columna con la norma legal de creación")
    parser.add_argument("--fuente", default=DEFAULT_FUENTE, help=f'Default: "{DEFAULT_FUENTE}"')
    parser.add_argument("--dataset-version", default=None, help="Ej. versión/fecha de publicación del dataset fuente")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--dry-run", action="store_true", help="Parsea y valida sin escribir nada en Supabase")
    args = parser.parse_args()

    result = ingest(
        args.archivo,
        nombre_columna=args.nombre_columna,
        categoria_columna=args.categoria_columna,
        base_legal_columna=args.base_legal_columna,
        fuente=args.fuente,
        dataset_version=args.dataset_version,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
    )
    print(f"[RESULTADO] {result}")


if __name__ == "__main__":
    main()
