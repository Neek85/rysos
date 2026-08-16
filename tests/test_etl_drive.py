import json
import unittest
import zipfile
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from shapely.geometry import Point
import geopandas as gpd
import numpy as np
import pandas as pd


GEOJSON_ORG001 = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "ID_Parcela_Fija": "PARC-001",
                "ID_Socio": "SOC-001",
                "fecha_monitoreo": "2026-08-16",
                "tecnico_responsable": "Ana Gomez",
                "precision_gps": 2.1,
                "evidencia_foto": "foto_01.jpg",
                "cumple_eudr": "SI",
                "observaciones": "",
            },
            "geometry": {"type": "Point", "coordinates": [-77.0, -12.0]},
        }
    ],
}


def make_package_zip(zip_path: Path, geojson: dict, photo_name: str | None = "foto_01.jpg") -> None:
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("inspeccion.geojson", json.dumps(geojson))
        if photo_name:
            zf.writestr(photo_name, b"fake-jpeg-bytes")


def build_pipeline(drive_root: Path):
    from scripts.etl_drive_to_supabase import DriveZipETLPipeline

    with patch("scripts.etl_drive_to_supabase.create_client") as mock_create_client:
        mock_supabase = MagicMock()
        mock_create_client.return_value = mock_supabase
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        pipeline = DriveZipETLPipeline("https://fake.supabase.co", "fake-key", str(drive_root))
    return pipeline, mock_supabase


class TestPackageDiscoveryAndOrgAssignment(unittest.TestCase):
    def test_discover_packages_under_inbox(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            make_package_zip(org_dir / "paquete_01.zip", GEOJSON_ORG001)

            pipeline, _ = build_pipeline(drive_root)
            packages = pipeline.discover_packages()

            self.assertEqual(len(packages), 1)
            self.assertEqual(packages[0].name, "paquete_01.zip")

    def test_discover_packages_missing_inbox_returns_empty(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))
            self.assertEqual(pipeline.discover_packages(), [])

    def test_org_id_derived_from_parent_folder(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            pipeline, _ = build_pipeline(drive_root)

            zip_path = drive_root / "ORG-XYZ" / "RYZOS_INBOX" / "cualquier_nombre.zip"
            org_id = pipeline.get_org_id_from_path(zip_path)

            self.assertEqual(org_id, "ORG-XYZ")


class TestZipExtraction(unittest.TestCase):
    def test_extract_package_and_find_geojson_layer(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            zip_path = drive_root / "paquete.zip"
            make_package_zip(zip_path, GEOJSON_ORG001)

            pipeline, _ = build_pipeline(drive_root)
            extract_to = drive_root / "extracted"
            extract_to.mkdir()
            pipeline.extract_package(zip_path, extract_to)

            geo_path = pipeline.find_geo_layer(extract_to)
            self.assertIsNotNone(geo_path)
            self.assertEqual(geo_path.suffix, ".geojson")

    def test_find_photos_locates_jpg_files(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            zip_path = drive_root / "paquete.zip"
            make_package_zip(zip_path, GEOJSON_ORG001, photo_name="foto_01.jpg")

            pipeline, _ = build_pipeline(drive_root)
            extract_to = drive_root / "extracted"
            extract_to.mkdir()
            pipeline.extract_package(zip_path, extract_to)

            photos = pipeline.find_photos(extract_to)
            self.assertEqual(len(photos), 1)
            self.assertEqual(photos[0].name, "foto_01.jpg")


class TestPayloadRestructuring(unittest.TestCase):
    def test_build_monitoreo_payload_sets_pendiente(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))

        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-001"],
                "ID_Socio": ["SOC-001"],
                "fecha_monitoreo": ["2026-08-16"],
                "tecnico_responsable": ["Ana Gomez"],
                "precision_gps": [2.1],
                "evidencia_foto": ["foto_01.jpg"],
                "cumple_eudr": ["SI"],
                "observaciones": [""],
            },
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        payload = pipeline.build_monitoreo_payload(row, "ORG-001")

        self.assertEqual(payload["estado_revision"], "PENDIENTE")
        self.assertEqual(payload["ID_Organizacion"], "ORG-001")
        self.assertTrue(payload["id_monitoreo"])
        self.assertEqual(payload["fecha_monitoreo"], "2026-08-16")

    def test_build_storage_path_structure(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))

        storage_path = pipeline.build_storage_path(
            "ORG-001", "uuid-monitoreo-123", Path("foto_01.jpg")
        )

        self.assertEqual(storage_path, "ORG-001/uuid-monitoreo-123/foto_01.jpg")
        self.assertEqual(len(storage_path.split("/")), 3)


class TestFechaMonitoreoNullHandling(unittest.TestCase):
    FIXED_NOW = datetime(2026, 8, 16, 9, 0, 0)

    def _pipeline(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))
        return pipeline

    def test_resolve_fecha_monitoreo_preserves_valid_date(self):
        pipeline = self._pipeline()
        self.assertEqual(
            pipeline.resolve_fecha_monitoreo("2026-08-16", now=self.FIXED_NOW), "2026-08-16"
        )

    def test_resolve_fecha_monitoreo_none_falls_back_to_today(self):
        pipeline = self._pipeline()
        self.assertEqual(pipeline.resolve_fecha_monitoreo(None, now=self.FIXED_NOW), "2026-08-16")

    def test_resolve_fecha_monitoreo_string_none_falls_back_to_today(self):
        pipeline = self._pipeline()
        self.assertEqual(
            pipeline.resolve_fecha_monitoreo("None", now=self.FIXED_NOW), "2026-08-16"
        )

    def test_resolve_fecha_monitoreo_empty_string_falls_back_to_today(self):
        pipeline = self._pipeline()
        self.assertEqual(pipeline.resolve_fecha_monitoreo("  ", now=self.FIXED_NOW), "2026-08-16")

    def test_resolve_fecha_monitoreo_nan_falls_back_to_today(self):
        pipeline = self._pipeline()
        self.assertEqual(
            pipeline.resolve_fecha_monitoreo(float("nan"), now=self.FIXED_NOW), "2026-08-16"
        )

    def test_resolve_fecha_monitoreo_nat_falls_back_to_today(self):
        pipeline = self._pipeline()
        self.assertEqual(
            pipeline.resolve_fecha_monitoreo(pd.NaT, now=self.FIXED_NOW), "2026-08-16"
        )

    def test_build_monitoreo_payload_with_missing_date_uses_fallback(self):
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-002"],
                "ID_Socio": ["SOC-002"],
                "fecha_monitoreo": [None],
                "tecnico_responsable": ["Ana Gomez"],
                "precision_gps": [2.1],
                "evidencia_foto": ["foto_01.jpg"],
                "cumple_eudr": ["SI"],
                "observaciones": [""],
            },
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        payload = pipeline.build_monitoreo_payload(row, "ORG-001", now=self.FIXED_NOW)

        self.assertEqual(payload["fecha_monitoreo"], "2026-08-16")
        self.assertNotEqual(payload["fecha_monitoreo"], "None")


class TestPayloadJSONSanitization(unittest.TestCase):
    def _pipeline(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))
        return pipeline

    def test_sanitize_json_value_replaces_nan_with_none(self):
        pipeline = self._pipeline()
        self.assertIsNone(pipeline.sanitize_json_value(float("nan")))
        self.assertIsNone(pipeline.sanitize_json_value(np.float64("nan")))

    def test_sanitize_json_value_replaces_inf_with_none(self):
        pipeline = self._pipeline()
        self.assertIsNone(pipeline.sanitize_json_value(float("inf")))
        self.assertIsNone(pipeline.sanitize_json_value(float("-inf")))

    def test_sanitize_json_value_converts_numpy_float_to_native_float(self):
        pipeline = self._pipeline()
        result = pipeline.sanitize_json_value(np.float64(2.1))
        self.assertEqual(result, 2.1)
        self.assertIs(type(result), float)

    def test_sanitize_json_value_converts_numpy_int_to_native_int(self):
        pipeline = self._pipeline()
        result = pipeline.sanitize_json_value(np.int64(5))
        self.assertEqual(result, 5)
        self.assertIs(type(result), int)

    def test_sanitize_json_value_passes_through_none_and_regular_values(self):
        pipeline = self._pipeline()
        self.assertIsNone(pipeline.sanitize_json_value(None))
        self.assertEqual(pipeline.sanitize_json_value("SI"), "SI")
        self.assertEqual(pipeline.sanitize_json_value(3), 3)

    def test_sanitize_json_value_leaves_geometry_dict_untouched(self):
        pipeline = self._pipeline()
        geom = {"type": "Point", "coordinates": (-77.0, -12.0)}
        self.assertEqual(pipeline.sanitize_json_value(geom), geom)

    def test_build_monitoreo_payload_replaces_nan_precision_with_none(self):
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-003"],
                "ID_Socio": ["SOC-003"],
                "fecha_monitoreo": ["2026-08-16"],
                "tecnico_responsable": ["Ana Gomez"],
                "precision_gps": [float("nan")],
                "evidencia_foto": ["foto_01.jpg"],
                "cumple_eudr": ["SI"],
                "observaciones": [""],
            },
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        payload = pipeline.build_monitoreo_payload(row, "ORG-001")

        self.assertIsNone(payload["precision_gps"])

    def test_build_monitoreo_payload_precision_gps_is_native_float(self):
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-004"],
                "ID_Socio": ["SOC-004"],
                "fecha_monitoreo": ["2026-08-16"],
                "tecnico_responsable": ["Ana Gomez"],
                "precision_gps": [2.1],
                "evidencia_foto": ["foto_01.jpg"],
                "cumple_eudr": ["SI"],
                "observaciones": [""],
            },
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        payload = pipeline.build_monitoreo_payload(row, "ORG-001")

        self.assertIs(type(payload["precision_gps"]), float)
        self.assertNotIsInstance(payload["precision_gps"], np.floating)


class TestArchiveRenaming(unittest.TestCase):
    def test_build_archive_destination_pattern(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            pipeline, _ = build_pipeline(drive_root)

            zip_path = drive_root / "ORG-001" / "RYZOS_INBOX" / "paquete_01.zip"
            fixed_ts = datetime(2026, 8, 16, 15, 30, 0)

            dest = pipeline.build_archive_destination(zip_path, "ORG-001", timestamp=fixed_ts)

            self.assertEqual(dest.name, "PROCESADO_20260816_153000_paquete_01.zip")
            self.assertEqual(dest.parent, drive_root / "ORG-001" / "RYZOS_ARCHIVE")

            from scripts.etl_drive_to_supabase import ARCHIVE_FILENAME_PATTERN
            self.assertRegex(dest.name, ARCHIVE_FILENAME_PATTERN.pattern)

    def test_archive_package_execute_move_moves_file(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            zip_path = org_dir / "paquete_01.zip"
            make_package_zip(zip_path, GEOJSON_ORG001)

            pipeline, _ = build_pipeline(drive_root)
            fixed_ts = datetime(2026, 8, 16, 15, 30, 0)

            dest = pipeline.archive_package(zip_path, "ORG-001", execute_move=True, timestamp=fixed_ts)

            self.assertFalse(zip_path.exists())
            self.assertTrue(dest.exists())
            self.assertEqual(dest.name, "PROCESADO_20260816_153000_paquete_01.zip")

    def test_archive_package_dry_run_does_not_move_file(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            zip_path = org_dir / "paquete_01.zip"
            make_package_zip(zip_path, GEOJSON_ORG001)

            pipeline, _ = build_pipeline(drive_root)
            fixed_ts = datetime(2026, 8, 16, 15, 30, 0)

            dest = pipeline.archive_package(zip_path, "ORG-001", execute_move=False, timestamp=fixed_ts)

            self.assertTrue(zip_path.exists())
            self.assertFalse(dest.exists())


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

    def test_load_and_reproject_forces_wgs84_from_geojson(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            pipeline, _ = build_pipeline(drive_root)

            geo_path = drive_root / "inspeccion.geojson"
            geo_path.write_text(json.dumps(GEOJSON_ORG001))

            gdf = pipeline.load_and_reproject(geo_path)

            self.assertEqual(gdf.crs.to_epsg(), 4326)


class TestPipelineIntegration(unittest.TestCase):
    def test_process_package_end_to_end(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            zip_path = org_dir / "paquete_01.zip"
            make_package_zip(zip_path, GEOJSON_ORG001)

            pipeline, mock_supabase = build_pipeline(drive_root)

            result = pipeline.process_package(zip_path, execute_move=True)

            self.assertEqual(result["org_id"], "ORG-001")
            self.assertEqual(len(result["inserted_ids"]), 1)
            self.assertEqual(len(result["uploaded_photos"]), 1)
            self.assertTrue(result["archive_dest"].exists())
            self.assertFalse(zip_path.exists())

            insert_payload = mock_supabase.table.return_value.insert.call_args[0][0]
            self.assertEqual(insert_payload["estado_revision"], "PENDIENTE")
            self.assertEqual(insert_payload["ID_Organizacion"], "ORG-001")

            uploaded_path = result["uploaded_photos"][0]
            self.assertTrue(uploaded_path.startswith("ORG-001/"))
            self.assertTrue(uploaded_path.endswith("/foto_01.jpg"))

            mock_supabase.storage.from_.assert_called_with("evidencias_eudr")

    def test_process_package_raises_when_no_geo_layer_found(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            zip_path = org_dir / "vacio.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("readme.txt", "sin capa geoespacial")

            pipeline, _ = build_pipeline(drive_root)

            with self.assertRaises(FileNotFoundError):
                pipeline.process_package(zip_path, execute_move=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
