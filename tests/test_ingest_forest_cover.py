"""
Pruebas de scripts/ingest_forest_cover.py — ver
specs/eudr_forest_ingestion_cli.md.

Sin test de integración contra Supabase real (a diferencia de lo que
pedía el prompt original, "verificar que fn_validar_topologia_eudr
detecte solapamientos reales"): EUDR_COBERTURA_BOSCOSA_2020 todavía no
está aplicada en la instancia real (confirmado en
supabase/migrations/20260820_eudr_cobertura_boscosa_2020.sql, pendiente
de aplicación manual como toda migración de este repo) — un test
NEEDS_SUPABASE que asumiera la tabla ya creada fallaría en CI con
"relation does not exist" en vez de saltarse limpio, hasta que alguien
aplique la migración a mano. Se cubre en cambio el pipeline completo de
transformación (reproyección, reparación/simplificación de geometría,
resolución de año, construcción de payload, chunking/batching) con un
cliente Supabase falso inyectado (mismo patrón que
tests/test_fase2_etl.py::test_pipeline_sets_pendiente_on_insert).
"""

import math
import unittest
from unittest.mock import MagicMock

import geopandas as gpd
from shapely.geometry import LineString, MultiPolygon, Point, Polygon

from scripts.ingest_forest_cover import (
    ALLOWED_COLUMNS,
    build_rows,
    chunked,
    ingest,
    resolve_anio_perdida,
    sanitize_geometry,
)

VALID_SQUARE = Polygon([(-77.0, -6.0), (-77.0, -6.1), (-76.9, -6.1), (-76.9, -6.0)])
# Bowtie clásico — auto-intersección real, ST_IsValid/is_valid lo rechaza.
BOWTIE = Polygon([(0, 0), (1, 1), (1, 0), (0, 1)])


class TestSanitizeGeometry(unittest.TestCase):
    def test_polygon_valido_se_normaliza_a_multipolygon(self):
        """La tabla real es geometry(MultiPolygon,4326) — todo Polygon debe envolverse."""
        result = sanitize_geometry(VALID_SQUARE)
        self.assertEqual(result.geom_type, "MultiPolygon")

    def test_bowtie_invalido_se_repara(self):
        """Un polígono con auto-intersección real (make_valid) queda válido tras sanitize."""
        self.assertFalse(BOWTIE.is_valid)
        result = sanitize_geometry(BOWTIE)
        self.assertIsNotNone(result)
        self.assertTrue(result.is_valid)

    def test_geometria_vacia_devuelve_none(self):
        self.assertIsNone(sanitize_geometry(Polygon()))
        self.assertIsNone(sanitize_geometry(None))

    def test_geometria_no_polygonal_se_descarta(self):
        """Este dataset es de polígonos de cobertura/pérdida forestal — un punto o línea
        (ej. una columna de geometría mal detectada por GDAL) nunca debe llegar a insertarse."""
        self.assertIsNone(sanitize_geometry(Point(-77.0, -6.0)))
        self.assertIsNone(sanitize_geometry(LineString([(-77.0, -6.0), (-76.9, -6.0)])))

    def test_multipolygon_ya_valido_se_mantiene(self):
        mp = MultiPolygon([VALID_SQUARE])
        result = sanitize_geometry(mp)
        self.assertEqual(result.geom_type, "MultiPolygon")


class TestResolveAnioPerdida(unittest.TestCase):
    def test_columna_con_valor_entero(self):
        row = {"lossyear": 22}
        self.assertEqual(resolve_anio_perdida(row, "lossyear"), 22)

    def test_columna_con_nan_devuelve_none(self):
        """Patrón 'NaN es truthy' — ya mordió este proyecto 3 veces en
        scripts/etl_drive_to_supabase.py (ver docs/schema_live.md / memoria),
        se prueba explícitamente acá para no repetirlo una cuarta."""
        row = {"lossyear": float("nan")}
        self.assertIsNone(resolve_anio_perdida(row, "lossyear"))

    def test_sin_columna_configurada_devuelve_none(self):
        self.assertIsNone(resolve_anio_perdida({"lossyear": 22}, None))

    def test_columna_ausente_en_la_fila_devuelve_none(self):
        self.assertIsNone(resolve_anio_perdida({}, "lossyear"))

    def test_valor_no_convertible_devuelve_none_sin_lanzar(self):
        self.assertIsNone(resolve_anio_perdida({"lossyear": "no-es-un-año"}, "lossyear"))


class TestBuildRows(unittest.TestCase):
    def _gdf(self, geometries):
        return gpd.GeoDataFrame({"lossyear": [22] * len(geometries)}, geometry=geometries, crs="EPSG:4326")

    def test_payload_respeta_el_whitelist_de_columnas(self):
        gdf = self._gdf([VALID_SQUARE])
        rows, _ = build_rows(gdf, anio_columna="lossyear", anio_fijo=None, fuente="HANSEN_GFW", dataset_version="v1")
        self.assertTrue(all(set(r) <= ALLOWED_COLUMNS for r in rows))

    def test_geometrias_invalidas_o_no_polygonales_se_descartan_del_conteo(self):
        gdf = self._gdf([VALID_SQUARE, Point(-77.0, -6.0)])
        rows, skipped = build_rows(gdf, anio_columna="lossyear", anio_fijo=None, fuente="HANSEN_GFW", dataset_version=None)
        self.assertEqual(len(rows), 1)
        self.assertEqual(skipped, 1)

    def test_anio_fijo_se_aplica_cuando_no_hay_columna(self):
        gdf = gpd.GeoDataFrame({"col": [1]}, geometry=[VALID_SQUARE], crs="EPSG:4326")
        rows, _ = build_rows(gdf, anio_columna=None, anio_fijo=2022, fuente="MINAM_GEOBOSQUES", dataset_version=None)
        self.assertEqual(rows[0]["anio_perdida"], 2022)

    def test_geom_serializado_como_geojson_no_wkt(self):
        """Mismo formato que scripts/etl_drive_to_supabase.py (mapping(), no WKT/WKB) —
        es lo que PostgREST acepta de verdad para una columna `geometry`."""
        gdf = self._gdf([VALID_SQUARE])
        rows, _ = build_rows(gdf, anio_columna="lossyear", anio_fijo=None, fuente="HANSEN_GFW", dataset_version=None)
        self.assertIsInstance(rows[0]["geom"], dict)
        self.assertEqual(rows[0]["geom"]["type"], "MultiPolygon")


class TestChunked(unittest.TestCase):
    def test_divide_en_lotes_del_tamano_pedido(self):
        items = list(range(11))
        batches = list(chunked(items, 5))
        self.assertEqual([len(b) for b in batches], [5, 5, 1])

    def test_lista_vacia_no_produce_lotes(self):
        self.assertEqual(list(chunked([], 5)), [])


class TestIngestDryRun(unittest.TestCase):
    def test_dry_run_no_requiere_credenciales_ni_escribe_nada(self):
        gdf = gpd.GeoDataFrame({"lossyear": [22]}, geometry=[VALID_SQUARE], crs="EPSG:4326")
        with unittest.mock.patch("scripts.ingest_forest_cover.load_source", return_value=gdf):
            result = ingest("archivo-ficticio.geojson", fuente="HANSEN_GFW", anio_columna="lossyear", dry_run=True)
        self.assertEqual(result["inserted"], 0)
        self.assertEqual(result["total"], 1)


class TestIngestWithFakeSupabase(unittest.TestCase):
    def test_batching_y_conteo_de_insertados(self):
        """3 features, batch_size=2 -> 2 lotes (2+1) — verifica chunking real end-to-end
        con un cliente Supabase falso inyectado (nunca toca la red)."""
        gdf = gpd.GeoDataFrame(
            {"lossyear": [21, 22, 23]},
            geometry=[VALID_SQUARE, VALID_SQUARE, VALID_SQUARE],
            crs="EPSG:4326",
        )
        fake_supabase = MagicMock()
        fake_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        with unittest.mock.patch("scripts.ingest_forest_cover.load_source", return_value=gdf):
            result = ingest(
                "archivo-ficticio.geojson",
                fuente="HANSEN_GFW",
                anio_columna="lossyear",
                batch_size=2,
                supabase_client=fake_supabase,
            )

        self.assertEqual(result["total"], 3)
        self.assertEqual(result["inserted"], 3)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(fake_supabase.table.return_value.insert.call_count, 2)

    def test_un_lote_fallido_no_detiene_los_siguientes(self):
        gdf = gpd.GeoDataFrame(
            {"lossyear": [21, 22]},
            geometry=[VALID_SQUARE, VALID_SQUARE],
            crs="EPSG:4326",
        )
        fake_supabase = MagicMock()
        fake_supabase.table.return_value.insert.return_value.execute.side_effect = [
            RuntimeError("fallo de red simulado"),
            MagicMock(),
        ]

        with unittest.mock.patch("scripts.ingest_forest_cover.load_source", return_value=gdf):
            result = ingest(
                "archivo-ficticio.geojson",
                fuente="HANSEN_GFW",
                anio_columna="lossyear",
                batch_size=1,
                supabase_client=fake_supabase,
            )

        self.assertEqual(result["inserted"], 1)
        self.assertEqual(result["failed"], 1)


if __name__ == "__main__":
    unittest.main()
