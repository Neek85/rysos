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

    def test_find_photos_locates_files_in_nested_dcim_folder(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            zip_path = drive_root / "paquete.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("inspeccion.geojson", json.dumps(GEOJSON_ORG001))
                zf.writestr("DCIM/100QFIELD/foto_anidada.jpg", b"fake-jpeg-bytes")

            pipeline, _ = build_pipeline(drive_root)
            extract_to = drive_root / "extracted"
            extract_to.mkdir()
            pipeline.extract_package(zip_path, extract_to)

            photos = pipeline.find_photos(extract_to)
            self.assertEqual(len(photos), 1)
            self.assertEqual(photos[0].name, "foto_anidada.jpg")

    def test_find_photos_locates_files_in_lowercase_dcim_folder(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            zip_path = drive_root / "paquete.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("inspeccion.geojson", json.dumps(GEOJSON_ORG001))
                zf.writestr("dcim/foto_lowercase.png", b"fake-png-bytes")

            pipeline, _ = build_pipeline(drive_root)
            extract_to = drive_root / "extracted"
            extract_to.mkdir()
            pipeline.extract_package(zip_path, extract_to)

            photos = pipeline.find_photos(extract_to)
            self.assertEqual(len(photos), 1)
            self.assertEqual(photos[0].name, "foto_lowercase.png")


class TestDynamicLayerDetection(unittest.TestCase):
    def _pipeline(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))
        return pipeline

    def _write_gpkg(self, path: Path, layer_name: str, extra_columns: dict | None = None) -> Path:
        columns = {
            "ID_Parcela_Fija": ["PARC-001"],
            "ID_Socio": ["SOC-001"],
            "fecha_monitoreo": ["2026-08-16"],
        }
        if extra_columns:
            columns.update(extra_columns)

        gdf = gpd.GeoDataFrame(columns, geometry=[Point(-77.0, -12.0)], crs="EPSG:4326")
        gdf.to_file(path, layer=layer_name, driver="GPKG")
        return path

    def test_find_monitoreo_layer_matches_dynamic_suffix(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline = self._pipeline()
            gpkg_path = self._write_gpkg(
                Path(tmp) / "inspeccion.gpkg", "EUDR_MONITOREO_2026_08_16"
            )

            layer_name = pipeline.find_monitoreo_layer(gpkg_path)

            self.assertEqual(layer_name, "EUDR_MONITOREO_2026_08_16")

    def test_find_monitoreo_layer_returns_none_when_no_match(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline = self._pipeline()
            gpkg_path = self._write_gpkg(Path(tmp) / "otra_capa.gpkg", "OTRA_CAPA_SIN_RELACION")

            layer_name = pipeline.find_monitoreo_layer(gpkg_path)

            self.assertIsNone(layer_name)

    def test_load_and_reproject_reads_dynamically_named_layer(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline = self._pipeline()
            gpkg_path = self._write_gpkg(
                Path(tmp) / "inspeccion.gpkg", "EUDR_MONITOREO_v2_campo"
            )

            gdf = pipeline.load_and_reproject(gpkg_path)

            self.assertEqual(len(gdf), 1)
            self.assertEqual(gdf.iloc[0]["ID_Parcela_Fija"], "PARC-001")


class TestFieldNameFallback(unittest.TestCase):
    def _pipeline(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))
        return pipeline

    def test_resolve_field_with_fallback_prefers_canonical_name(self):
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"ID_Socio": ["SOC-CANONICAL"], "productor": ["Nombre Productor"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        value = pipeline.resolve_field_with_fallback(row, ("ID_Socio", "productor"))

        self.assertEqual(value, "SOC-CANONICAL")

    def test_resolve_field_with_fallback_uses_qfield_variant_when_canonical_missing(self):
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"nuevo_productor_nombre": ["Juan Perez"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        from scripts.etl_drive_to_supabase import PRODUCTOR_NOMBRE_CANDIDATES

        value = pipeline.resolve_field_with_fallback(row, PRODUCTOR_NOMBRE_CANDIDATES)

        self.assertEqual(value, "Juan Perez")

    def test_resolve_field_with_fallback_covers_expanded_productor_variants(self):
        pipeline = self._pipeline()
        from scripts.etl_drive_to_supabase import PRODUCTOR_NOMBRE_CANDIDATES

        for column_name in ("socio_nombre_completo", "socio_nombre", "Productor", "Nombre"):
            gdf = gpd.GeoDataFrame(
                {column_name: ["Maria Lopez"]},
                geometry=[Point(-77.0, -12.0)],
                crs="EPSG:4326",
            )
            row = gdf.iloc[0]

            value = pipeline.resolve_field_with_fallback(row, PRODUCTOR_NOMBRE_CANDIDATES)

            self.assertEqual(value, "Maria Lopez", f"fallo para columna {column_name}")

    def test_resolve_field_with_fallback_covers_expanded_parcela_variants(self):
        pipeline = self._pipeline()
        from scripts.etl_drive_to_supabase import PARCELA_FIELD_CANDIDATES

        for column_name in ("parcela_codigo", "Parcela", "Codigo"):
            gdf = gpd.GeoDataFrame(
                {column_name: ["VALOR-001"]},
                geometry=[Point(-77.0, -12.0)],
                crs="EPSG:4326",
            )
            row = gdf.iloc[0]

            value = pipeline.resolve_field_with_fallback(row, PARCELA_FIELD_CANDIDATES)

            self.assertEqual(value, "VALOR-001", f"fallo para columna {column_name}")

    def test_id_socio_never_falls_back_to_free_text_name(self):
        # INVARIANTE: ID_Socio es un identificador estricto; un nombre libre de
        # productor nunca debe terminar en esa columna, solo en nuevo_productor_nombre.
        pipeline = self._pipeline()
        from scripts.etl_drive_to_supabase import SOCIO_ID_CANDIDATES

        gdf = gpd.GeoDataFrame(
            {"productor": ["Juan Perez"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        value = pipeline.resolve_field_with_fallback(row, SOCIO_ID_CANDIDATES)

        self.assertIsNone(value)

    def test_resolve_field_with_fallback_skips_blank_and_missing_columns(self):
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"ID_Parcela_Fija": [""], "parcela_nombre": ["Lote El Mirador"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        from scripts.etl_drive_to_supabase import PARCELA_FIELD_CANDIDATES

        value = pipeline.resolve_field_with_fallback(row, PARCELA_FIELD_CANDIDATES)

        self.assertEqual(value, "Lote El Mirador")

    def test_resolve_field_with_fallback_returns_none_when_all_candidates_missing(self):
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"otra_columna": ["valor"]}, geometry=[Point(-77.0, -12.0)], crs="EPSG:4326"
        )
        row = gdf.iloc[0]

        from scripts.etl_drive_to_supabase import PARCELA_FIELD_CANDIDATES

        value = pipeline.resolve_field_with_fallback(row, PARCELA_FIELD_CANDIDATES)

        self.assertIsNone(value)

    def test_build_monitoreo_payload_maps_qfield_variant_columns(self):
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {
                "parcela_nombre": ["Lote El Mirador"],
                "nuevo_productor_nombre": ["Juan Perez"],
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

        self.assertEqual(payload["ID_Parcela_Fija"], "Lote El Mirador")
        self.assertIsNone(payload["ID_Socio"])
        self.assertEqual(payload["nuevo_productor_nombre"], "Juan Perez")
        self.assertIn("Lote El Mirador", payload["observaciones"])

    def test_build_monitoreo_payload_no_annotation_when_strict_parcela_id_present(self):
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-010"],
                "ID_Socio": ["SOC-010"],
                "fecha_monitoreo": ["2026-08-16"],
                "tecnico_responsable": ["Ana Gomez"],
                "precision_gps": [2.1],
                "evidencia_foto": ["foto_01.jpg"],
                "cumple_eudr": ["SI"],
                "observaciones": ["nota original"],
            },
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        payload = pipeline.build_monitoreo_payload(row, "ORG-001")

        self.assertEqual(payload["ID_Parcela_Fija"], "PARC-010")
        self.assertEqual(payload["ID_Socio"], "SOC-010")
        self.assertEqual(payload["observaciones"], "nota original")


class TestMultiLayerIngestion(unittest.TestCase):
    def _build_multilayer_zip(self, org_dir: Path) -> Path:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            gpkg_path = Path(tmp) / "paquete_multicapa.gpkg"

            monitoreo_gdf = gpd.GeoDataFrame(
                {
                    "ID_Parcela_Fija": ["PARC-001"],
                    "ID_Socio": ["SOC-001"],
                    "fecha_monitoreo": ["2026-08-16"],
                    "evidencia_foto": ["foto_monitoreo.jpg"],
                    "cumple_eudr": ["SI"],
                    "observaciones": [""],
                },
                geometry=[Point(-77.0, -12.0)],
                crs="EPSG:4326",
            )
            monitoreo_gdf.to_file(gpkg_path, layer="EUDR_MONITOREO", driver="GPKG")

            uso_suelo_gdf = gpd.GeoDataFrame(
                {"id_parcela": ["PARC-001"], "tipo_uso": ["Cafetal"]},
                geometry=[Point(-77.1, -12.1)],
                crs="EPSG:4326",
            )
            uso_suelo_gdf.to_file(gpkg_path, layer="EUDR_USO_SUELO", driver="GPKG", mode="a")

            instalaciones_gdf = gpd.GeoDataFrame(
                {
                    "id_parcela": ["PARC-001"],
                    "tipo_infra": ["Beneficio Humedo"],
                    "evidencia_foto": ["foto_instalacion.jpg"],
                },
                geometry=[Point(-77.2, -12.2)],
                crs="EPSG:4326",
            )
            instalaciones_gdf.to_file(
                gpkg_path, layer="EUDR_INSTALACIONES", driver="GPKG", mode="a"
            )

            zip_path = org_dir / "paquete_multicapa.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.write(gpkg_path, arcname="paquete_multicapa.gpkg")
                zf.writestr("foto_monitoreo.jpg", b"fake-jpeg-monitoreo")
                zf.writestr("foto_instalacion.jpg", b"fake-jpeg-instalacion")

        return zip_path

    def test_classify_layers_detects_all_three_tables(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            zip_path = self._build_multilayer_zip(org_dir)

            pipeline, _ = build_pipeline(drive_root)
            extract_to = drive_root / "extracted"
            extract_to.mkdir()
            pipeline.extract_package(zip_path, extract_to)
            geo_path = pipeline.find_geo_layer(extract_to)

            classified = pipeline.classify_layers(geo_path)
            tables = {table_name for _, table_name in classified}

            self.assertEqual(len(classified), 3)
            self.assertEqual(tables, {"EUDR_MONITOREO", "EUDR_USO_SUELO", "EUDR_INSTALACIONES"})

    def test_process_package_inserts_into_all_three_tables(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            zip_path = self._build_multilayer_zip(org_dir)

            pipeline, mock_supabase = build_pipeline(drive_root)
            result = pipeline.process_package(zip_path, execute_move=True)

            self.assertEqual(
                result["records_by_table"],
                {"EUDR_MONITOREO": 1, "EUDR_USO_SUELO": 1, "EUDR_INSTALACIONES": 1},
            )
            self.assertEqual(len(result["inserted_ids"]), 3)

            table_calls = [c.args[0] for c in mock_supabase.table.call_args_list]
            self.assertEqual(
                set(table_calls), {"EUDR_MONITOREO", "EUDR_USO_SUELO", "EUDR_INSTALACIONES"}
            )

    def test_process_package_uploads_photos_for_monitoreo_and_instalaciones(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            zip_path = self._build_multilayer_zip(org_dir)

            pipeline, _ = build_pipeline(drive_root)
            result = pipeline.process_package(zip_path, execute_move=True)

            self.assertEqual(len(result["uploaded_photos"]), 2)
            self.assertTrue(any(p.endswith("/foto_monitoreo.jpg") for p in result["uploaded_photos"]))
            self.assertTrue(
                any(p.endswith("/foto_instalacion.jpg") for p in result["uploaded_photos"])
            )

    def test_process_package_evidencia_foto_holds_storage_path_not_raw_filename(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            zip_path = self._build_multilayer_zip(org_dir)

            pipeline, mock_supabase = build_pipeline(drive_root)
            pipeline.process_package(zip_path, execute_move=True)

            table_calls = [c.args[0] for c in mock_supabase.table.call_args_list]
            insert_payloads = [
                c.args[0] for c in mock_supabase.table.return_value.insert.call_args_list
            ]
            payload_by_table = dict(zip(table_calls, insert_payloads))

            monitoreo_foto = payload_by_table["EUDR_MONITOREO"]["evidencia_foto"]
            instalaciones_foto = payload_by_table["EUDR_INSTALACIONES"]["evidencia_foto"]

            self.assertNotEqual(monitoreo_foto, "foto_monitoreo.jpg")
            self.assertTrue(monitoreo_foto.startswith("ORG-001/"))
            self.assertTrue(monitoreo_foto.endswith("/foto_monitoreo.jpg"))

            self.assertNotEqual(instalaciones_foto, "foto_instalacion.jpg")
            self.assertTrue(instalaciones_foto.startswith("ORG-001/"))
            self.assertTrue(instalaciones_foto.endswith("/foto_instalacion.jpg"))

    def test_process_package_uso_suelo_payload_has_no_evidencia_foto(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            zip_path = self._build_multilayer_zip(org_dir)

            pipeline, mock_supabase = build_pipeline(drive_root)
            pipeline.process_package(zip_path, execute_move=True)

            table_calls = [c.args[0] for c in mock_supabase.table.call_args_list]
            insert_payloads = [
                c.args[0] for c in mock_supabase.table.return_value.insert.call_args_list
            ]
            payload_by_table = dict(zip(table_calls, insert_payloads))

            uso_suelo_payload = payload_by_table["EUDR_USO_SUELO"]
            self.assertNotIn("evidencia_foto", uso_suelo_payload)
            self.assertEqual(uso_suelo_payload["id_parcela"], "PARC-001")
            self.assertEqual(uso_suelo_payload["tipo_uso"], "Cafetal")
            self.assertEqual(uso_suelo_payload["ID_Organizacion"], "ORG-001")
            self.assertEqual(uso_suelo_payload["estado_revision"], "PENDIENTE")

    def test_process_package_instalaciones_payload_fields(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            org_dir = drive_root / "ORG-001" / "RYZOS_INBOX"
            org_dir.mkdir(parents=True)
            zip_path = self._build_multilayer_zip(org_dir)

            pipeline, mock_supabase = build_pipeline(drive_root)
            pipeline.process_package(zip_path, execute_move=True)

            table_calls = [c.args[0] for c in mock_supabase.table.call_args_list]
            insert_payloads = [
                c.args[0] for c in mock_supabase.table.return_value.insert.call_args_list
            ]
            payload_by_table = dict(zip(table_calls, insert_payloads))

            instalaciones_payload = payload_by_table["EUDR_INSTALACIONES"]
            self.assertEqual(instalaciones_payload["id_parcela"], "PARC-001")
            self.assertEqual(instalaciones_payload["tipo_infra"], "Beneficio Humedo")
            self.assertEqual(instalaciones_payload["ID_Organizacion"], "ORG-001")
            self.assertEqual(instalaciones_payload["estado_revision"], "PENDIENTE")

    def test_evidencia_foto_is_none_when_no_matching_photo_found(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            pipeline, _ = build_pipeline(drive_root)

        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-001"],
                "ID_Socio": ["SOC-001"],
                "fecha_monitoreo": ["2026-08-16"],
                "evidencia_foto": ["foto_inexistente.jpg"],
            },
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        ids, photos = pipeline.process_layer_rows(gdf, "EUDR_MONITOREO", "ORG-001", {})

        self.assertEqual(photos, [])
        insert_calls = pipeline.supabase.table.return_value.insert.call_args_list
        self.assertIsNone(insert_calls[-1].args[0]["evidencia_foto"])


class TestEvidenciaFotoBasenameMatching(unittest.TestCase):
    def _pipeline(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, mock_supabase = build_pipeline(Path(tmp))
        return pipeline, mock_supabase

    def test_matches_photo_when_evidencia_foto_is_a_relative_dcim_path(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))
            dcim_dir = Path(tmp) / "DCIM"
            dcim_dir.mkdir()
            photo_file = dcim_dir / "foto_01.jpg"
            photo_file.write_bytes(b"fake-jpeg-bytes")

            gdf = gpd.GeoDataFrame(
                {
                    "ID_Parcela_Fija": ["PARC-001"],
                    "ID_Socio": ["SOC-001"],
                    "fecha_monitoreo": ["2026-08-16"],
                    "evidencia_foto": ["DCIM/foto_01.jpg"],
                },
                geometry=[Point(-77.0, -12.0)],
                crs="EPSG:4326",
            )
            photos_by_name = {"foto_01.jpg": photo_file}

            ids, photos = pipeline.process_layer_rows(
                gdf, "EUDR_MONITOREO", "ORG-001", photos_by_name
            )

            self.assertEqual(len(photos), 1)
            self.assertEqual(photos[0], "ORG-001/foto_01.jpg")

    def test_matches_photo_when_evidencia_foto_is_a_deeply_nested_dcim_path(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))
            nested_dir = Path(tmp) / "DCIM" / "100QFIELD"
            nested_dir.mkdir(parents=True)
            photo_file = nested_dir / "foto_instalacion.jpg"
            photo_file.write_bytes(b"fake-jpeg-bytes")

            gdf = gpd.GeoDataFrame(
                {
                    "id_parcela": ["PARC-001"],
                    "tipo_infra": ["Beneficio Humedo"],
                    "evidencia_foto": ["DCIM/100QFIELD/foto_instalacion.jpg"],
                },
                geometry=[Point(-77.0, -12.0)],
                crs="EPSG:4326",
            )
            photos_by_name = {"foto_instalacion.jpg": photo_file}

            ids, photos = pipeline.process_layer_rows(
                gdf, "EUDR_INSTALACIONES", "ORG-001", photos_by_name
            )

            self.assertEqual(len(photos), 1)
            self.assertEqual(photos[0], "ORG-001/foto_instalacion.jpg")

    def test_storage_path_is_org_and_filename_only(self):
        pipeline, _ = self._pipeline()

        storage_path = pipeline.build_storage_path("ORG-COOP-NORTE", Path("foto_campo.jpg"))

        self.assertEqual(storage_path, "ORG-COOP-NORTE/foto_campo.jpg")

    def test_upload_evidence_photo_sets_content_type_and_upsert(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, mock_supabase = build_pipeline(Path(tmp))
            photo_path = Path(tmp) / "foto.png"
            photo_path.write_bytes(b"fake-png-bytes")

            pipeline.upload_evidence_photo(photo_path, "ORG-001/foto.png")

            upload_kwargs = mock_supabase.storage.from_.return_value.upload.call_args.kwargs
            self.assertEqual(upload_kwargs["file_options"]["content-type"], "image/png")
            self.assertEqual(upload_kwargs["file_options"]["upsert"], "true")


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

        storage_path = pipeline.build_storage_path("ORG-001", Path("foto_01.jpg"))

        self.assertEqual(storage_path, "ORG-001/foto_01.jpg")
        self.assertEqual(len(storage_path.split("/")), 2)


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
