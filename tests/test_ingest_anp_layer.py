"""
Pruebas de scripts/ingest_anp_layer.py — ver
specs/motor_prevalidacion_satelital_anp_bosque.md.

Mismo criterio exacto que tests/test_ingest_forest_cover.py (su hermano
para EUDR_COBERTURA_BOSCOSA_2020): sin test de integración contra
Supabase real — EUDR_AREAS_PROTEGIDAS tampoco existe todavía en la
instancia real (confirmado por REST en vivo, ver la migración de esta
tarea), pendiente de aplicación manual como toda migración de este repo.
Se cubre el pipeline completo de transformación (reproyección,
reparación/simplificación de geometría, resolución de campos de texto,
construcción de payload, chunking/batching, idempotencia por
dataset_version) con un cliente Supabase falso inyectado.
"""

import math
import unittest
from unittest.mock import MagicMock

import geopandas as gpd
from shapely.geometry import LineString, MultiPolygon, Point, Polygon

from scripts.ingest_anp_layer import (
    ALLOWED_COLUMNS,
    build_rows,
    chunked,
    ingest,
    resolve_text_field,
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
        self.assertFalse(BOWTIE.is_valid)
        result = sanitize_geometry(BOWTIE)
        self.assertIsNotNone(result)
        self.assertTrue(result.is_valid)

    def test_geometria_vacia_devuelve_none(self):
        self.assertIsNone(sanitize_geometry(Polygon()))
        self.assertIsNone(sanitize_geometry(None))

    def test_geometria_no_polygonal_se_descarta(self):
        self.assertIsNone(sanitize_geometry(Point(-77.0, -6.0)))
        self.assertIsNone(sanitize_geometry(LineString([(-77.0, -6.0), (-76.9, -6.0)])))

    def test_multipolygon_ya_valido_se_mantiene(self):
        mp = MultiPolygon([VALID_SQUARE])
        result = sanitize_geometry(mp)
        self.assertEqual(result.geom_type, "MultiPolygon")


class TestResolveTextField(unittest.TestCase):
    def test_columna_con_valor_string(self):
        row = {"nombre": "Parque Nacional Cutervo"}
        self.assertEqual(resolve_text_field(row, "nombre"), "Parque Nacional Cutervo")

    def test_columna_con_nan_devuelve_none(self):
        """Mismo patrón 'NaN es truthy' que resolve_anio_perdida en
        scripts/ingest_forest_cover.py — una columna de texto vacía leída
        por geopandas puede traer NaN (float), nunca debe guardarse como
        el string "nan"."""
        row = {"nombre": float("nan")}
        self.assertIsNone(resolve_text_field(row, "nombre"))

    def test_sin_columna_configurada_devuelve_none(self):
        self.assertIsNone(resolve_text_field({"nombre": "X"}, None))

    def test_columna_ausente_en_la_fila_devuelve_none(self):
        self.assertIsNone(resolve_text_field({}, "nombre"))

    def test_string_vacio_o_solo_espacios_devuelve_none(self):
        self.assertIsNone(resolve_text_field({"nombre": "   "}, "nombre"))

    def test_valor_numerico_se_convierte_a_string(self):
        """Una columna de categoría codificada como entero (ej. un ID de
        categoría) no debe lanzar — se guarda como string, igual que
        cualquier otro texto."""
        self.assertEqual(resolve_text_field({"categoria": 5}, "categoria"), "5")


class TestBuildRows(unittest.TestCase):
    def _gdf(self, geometries, **cols):
        data = {"nombre": ["ANP Test"] * len(geometries)}
        data.update(cols)
        return gpd.GeoDataFrame(data, geometry=geometries, crs="EPSG:4326")

    def test_payload_respeta_el_whitelist_de_columnas(self):
        gdf = self._gdf([VALID_SQUARE])
        rows, _ = build_rows(gdf, "nombre", None, None, "SERNANP", "v1")
        self.assertTrue(all(set(r) <= ALLOWED_COLUMNS for r in rows))

    def test_geometrias_invalidas_o_no_polygonales_se_descartan_del_conteo(self):
        gdf = self._gdf([VALID_SQUARE, Point(-77.0, -6.0)])
        rows, skipped = build_rows(gdf, "nombre", None, None, "SERNANP", None)
        self.assertEqual(len(rows), 1)
        self.assertEqual(skipped, 1)

    def test_categoria_y_base_legal_se_resuelven_por_columna(self):
        gdf = self._gdf([VALID_SQUARE], categoria=["Parque Nacional"], ley=["D.S. 001-2026"])
        rows, _ = build_rows(gdf, "nombre", "categoria", "ley", "SERNANP", None)
        self.assertEqual(rows[0]["categoria"], "Parque Nacional")
        self.assertEqual(rows[0]["base_legal"], "D.S. 001-2026")

    def test_geom_serializado_como_geojson_no_wkt(self):
        gdf = self._gdf([VALID_SQUARE])
        rows, _ = build_rows(gdf, "nombre", None, None, "SERNANP", None)
        self.assertIsInstance(rows[0]["geom"], dict)
        self.assertEqual(rows[0]["geom"]["type"], "MultiPolygon")

    def test_fuente_default_sernanp(self):
        gdf = self._gdf([VALID_SQUARE])
        rows, _ = build_rows(gdf, "nombre", None, None, "SERNANP", None)
        self.assertEqual(rows[0]["fuente"], "SERNANP")


class TestChunked(unittest.TestCase):
    def test_divide_en_lotes_del_tamano_pedido(self):
        items = list(range(11))
        batches = list(chunked(items, 5))
        self.assertEqual([len(b) for b in batches], [5, 5, 1])

    def test_lista_vacia_no_produce_lotes(self):
        self.assertEqual(list(chunked([], 5)), [])


class TestIngestDryRun(unittest.TestCase):
    def test_dry_run_no_requiere_credenciales_ni_escribe_nada(self):
        gdf = gpd.GeoDataFrame({"nombre": ["ANP Test"]}, geometry=[VALID_SQUARE], crs="EPSG:4326")
        with unittest.mock.patch("scripts.ingest_anp_layer.load_source", return_value=gdf):
            result = ingest("archivo-ficticio.geojson", nombre_columna="nombre", dry_run=True)
        self.assertEqual(result["inserted"], 0)
        self.assertEqual(result["total"], 1)


class TestIngestWithFakeSupabase(unittest.TestCase):
    def test_batching_y_conteo_de_insertados(self):
        gdf = gpd.GeoDataFrame(
            {"nombre": ["A", "B", "C"]},
            geometry=[VALID_SQUARE, VALID_SQUARE, VALID_SQUARE],
            crs="EPSG:4326",
        )
        fake_supabase = MagicMock()
        fake_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        with unittest.mock.patch("scripts.ingest_anp_layer.load_source", return_value=gdf):
            result = ingest(
                "archivo-ficticio.geojson",
                nombre_columna="nombre",
                batch_size=2,
                supabase_client=fake_supabase,
            )

        self.assertEqual(result["total"], 3)
        self.assertEqual(result["inserted"], 3)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(fake_supabase.table.return_value.insert.call_count, 2)

    def test_un_lote_fallido_no_detiene_los_siguientes(self):
        gdf = gpd.GeoDataFrame(
            {"nombre": ["A", "B"]},
            geometry=[VALID_SQUARE, VALID_SQUARE],
            crs="EPSG:4326",
        )
        fake_supabase = MagicMock()
        fake_supabase.table.return_value.insert.return_value.execute.side_effect = [
            RuntimeError("fallo de red simulado"),
            MagicMock(),
        ]

        with unittest.mock.patch("scripts.ingest_anp_layer.load_source", return_value=gdf):
            result = ingest(
                "archivo-ficticio.geojson",
                nombre_columna="nombre",
                batch_size=1,
                supabase_client=fake_supabase,
            )

        self.assertEqual(result["inserted"], 1)
        self.assertEqual(result["failed"], 1)

    def test_dataset_version_borra_solo_esa_misma_version_antes_de_insertar(self):
        """Idempotencia: re-correr con el mismo --dataset-version no debe
        duplicar filas — borra (con Service Role Key, vía el cliente
        inyectado) solo las filas de ESA versión exacta antes de
        insertar de nuevo."""
        gdf = gpd.GeoDataFrame({"nombre": ["A"]}, geometry=[VALID_SQUARE], crs="EPSG:4326")
        fake_supabase = MagicMock()
        fake_supabase.table.return_value.delete.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"id": 1}, {"id": 2}])
        fake_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        with unittest.mock.patch("scripts.ingest_anp_layer.load_source", return_value=gdf):
            result = ingest(
                "archivo-ficticio.geojson",
                nombre_columna="nombre",
                dataset_version="v1",
                supabase_client=fake_supabase,
            )

        fake_supabase.table.return_value.delete.return_value.eq.assert_called_with("dataset_version", "v1")
        self.assertEqual(result["deleted_previous_same_version"], 2)
        self.assertEqual(result["inserted"], 1)

    def test_sin_dataset_version_no_borra_nada(self):
        gdf = gpd.GeoDataFrame({"nombre": ["A"]}, geometry=[VALID_SQUARE], crs="EPSG:4326")
        fake_supabase = MagicMock()
        fake_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        with unittest.mock.patch("scripts.ingest_anp_layer.load_source", return_value=gdf):
            result = ingest("archivo-ficticio.geojson", nombre_columna="nombre", supabase_client=fake_supabase)

        fake_supabase.table.return_value.delete.assert_not_called()
        self.assertEqual(result["deleted_previous_same_version"], 0)
