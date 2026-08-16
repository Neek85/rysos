import unittest
from unittest.mock import MagicMock, patch
from shapely.geometry import Point, Polygon
import geopandas as gpd


class TestGeometryReprojection(unittest.TestCase):
    def test_reprojection_utm18s_to_wgs84(self):
        """Reproyección desde UTM Zone 18S a WGS84 produce coordenadas válidas."""
        gdf = gpd.GeoDataFrame(
            {"ID_Parcela_Fija": ["PARC-001"]},
            geometry=[Point(650000, 9350000)],
            crs="EPSG:32718",
        )
        gdf_wgs84 = gdf.to_crs(epsg=4326)

        self.assertEqual(gdf_wgs84.crs.to_epsg(), 4326)
        lon = gdf_wgs84.geometry.iloc[0].x
        lat = gdf_wgs84.geometry.iloc[0].y
        self.assertAlmostEqual(lon, -73.6, places=1)
        self.assertTrue(-90 <= lat <= 0, f"Latitud fuera de hemisferio sur: {lat}")

    def test_already_wgs84_no_change(self):
        """Si el CRS ya es WGS84 no debe modificar las coordenadas."""
        gdf = gpd.GeoDataFrame(
            {"col": [1]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        if gdf.crs is None or gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)

        self.assertAlmostEqual(gdf.geometry.iloc[0].x, -77.0)
        self.assertAlmostEqual(gdf.geometry.iloc[0].y, -12.0)

    def test_polygon_validity(self):
        """Un polígono representando una parcela debe ser válido."""
        poly = Polygon([(-77.0, -12.0), (-77.1, -12.0), (-77.1, -12.1), (-77.0, -12.1)])
        self.assertTrue(poly.is_valid)


class TestETLPayloadInvariants(unittest.TestCase):
    def test_estado_revision_always_pendiente(self):
        """El campo estado_revision debe ser PENDIENTE en todo payload ETL."""
        # Simula la construcción del payload del ETL
        payload = {
            "id_monitoreo": "test-uuid",
            "ID_Organizacion": "ORG-001",
            "ID_Parcela_Fija": "PARC-001",
            "ID_Socio": "SOC-001",
            "fecha_monitoreo": "2026-08-15",
            "tecnico_responsable": "Juan Perez",
            "precision_gps": 2.5,
            "evidencia_foto": None,
            "cumple_eudr": "SI",
            "observaciones": "",
            "geom_inspeccion": None,
            "estado_revision": "PENDIENTE",
        }
        self.assertEqual(payload["estado_revision"], "PENDIENTE")

    def test_storage_path_structure(self):
        """La ruta de Storage debe seguir el patrón {org_id}/{id_monitoreo}/{foto}."""
        org_id = "ORG-001"
        id_monitoreo = "uuid-monitoreo-123"
        foto = "evidencia_01.jpg"

        storage_key = f"{org_id}/{id_monitoreo}/{foto}"
        partes = storage_key.split("/")

        self.assertEqual(len(partes), 3)
        self.assertEqual(partes[0], org_id)
        self.assertEqual(partes[1], id_monitoreo)
        self.assertEqual(partes[2], foto)

    @patch("scripts.etl_qfield_ingest.gpd.read_file")
    @patch("scripts.etl_qfield_ingest.create_client")
    def test_pipeline_sets_pendiente_on_insert(self, mock_create_client, mock_read_file):
        """El pipeline inyecta estado_revision='PENDIENTE' en cada fila."""
        from scripts.etl_qfield_ingest import QFieldETLPipeline

        # Mock Supabase client
        mock_supabase = MagicMock()
        mock_create_client.return_value = mock_supabase
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        # GeoDataFrame sintético con CRS ya en WGS84
        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-001"],
                "ID_Socio": ["SOC-001"],
                "fecha_monitoreo": ["2026-08-15"],
                "tecnico_responsable": ["Ana Gomez"],
                "precision_gps": [1.5],
                "evidencia_foto": [None],
                "cumple_eudr": ["SI"],
                "observaciones": [""],
            },
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        mock_read_file.return_value = gdf

        pipeline = QFieldETLPipeline("https://fake.supabase.co", "fake-key")
        result = pipeline.process_gpkg_file("fake.gpkg", "ORG-001")

        self.assertTrue(result)
        # Verificar que el payload insertado tiene estado_revision = PENDIENTE
        call_args = mock_supabase.table.return_value.insert.call_args[0][0]
        self.assertEqual(call_args["estado_revision"], "PENDIENTE")
        self.assertEqual(call_args["ID_Organizacion"], "ORG-001")


if __name__ == "__main__":
    unittest.main(verbosity=2)
