import io
import json
import unittest
import zipfile
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from shapely.geometry import Point, mapping
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


# ADR-020: warn_socio_org_mismatch tambien llama self.supabase.table(...)
# (para PADRON_SOCIOS/PADRON_PARCELAS), asi que mock_supabase.table.call_args_list
# ya no contiene SOLO los 3 nombres de tabla EUDR_* en el mismo orden que los
# upserts reales -- los tests que reconstruyen payload_by_table via
# zip(table_calls, insert_payloads) filtran por este set para no romper esa
# alineacion 1:1 (mismo criterio ya usado antes de ADR-020, solo mas explicito).
EUDR_TABLES = ("EUDR_MONITOREO", "EUDR_USO_SUELO", "EUDR_INSTALACIONES")


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
        mock_supabase.table.return_value.upsert.return_value.execute.return_value = MagicMock()
        # ADR-012: process_layer_rows consulta primero estado_revision existente via
        # .select().eq(...).execute().data — por defecto simula "el registro todavia
        # no existe" (data=[]) para no alterar el comportamiento de los tests previos
        # a este chequeo. Cubre tanto un solo .eq() (EUDR_MONITOREO, conflict target
        # "id_monitoreo") como dos encadenados (EUDR_USO_SUELO/INSTALACIONES,
        # "ID_Organizacion,fid").
        select_mock = mock_supabase.table.return_value.select.return_value
        select_mock.eq.return_value.execute.return_value.data = []
        select_mock.eq.return_value.eq.return_value.execute.return_value.data = []
        # ADR-014: warn_parcela_code_conflicts consulta
        # .select().eq(ID_Organizacion).eq(ID_Parcela_Fija).neq(id_monitoreo).execute()
        # — por defecto simula "sin otros registros con ese codigo" (data=[]).
        select_mock.eq.return_value.eq.return_value.neq.return_value.execute.return_value.data = []
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

    def _make_zip_bytes(self, entries: dict) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zf:
            for name, content in entries.items():
                zf.writestr(name, content)
        return buffer.getvalue()

    def test_extract_package_decompresses_nested_dcim_zip(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            zip_path = drive_root / "paquete.zip"
            dcim_zip_bytes = self._make_zip_bytes({"foto_anidada.jpg": b"fake-jpeg-bytes"})
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("inspeccion.geojson", json.dumps(GEOJSON_ORG001))
                zf.writestr("DCIM.zip", dcim_zip_bytes)

            pipeline, _ = build_pipeline(drive_root)
            extract_to = drive_root / "extracted"
            extract_to.mkdir()
            pipeline.extract_package(zip_path, extract_to)

            photos = pipeline.find_photos(extract_to)
            self.assertEqual(len(photos), 1)
            self.assertEqual(photos[0].name, "foto_anidada.jpg")

    def test_extract_package_decompresses_multiple_levels_of_nested_zips(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            zip_path = drive_root / "paquete.zip"

            innermost_zip_bytes = self._make_zip_bytes({"foto_profunda.png": b"fake-png-bytes"})
            middle_zip_bytes = self._make_zip_bytes({"dcim.zip": innermost_zip_bytes})
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("inspeccion.geojson", json.dumps(GEOJSON_ORG001))
                zf.writestr("adjuntos.zip", middle_zip_bytes)

            pipeline, _ = build_pipeline(drive_root)
            extract_to = drive_root / "extracted"
            extract_to.mkdir()
            pipeline.extract_package(zip_path, extract_to)

            photos = pipeline.find_photos(extract_to)
            self.assertEqual(len(photos), 1)
            self.assertEqual(photos[0].name, "foto_profunda.png")

    def test_extract_package_ignores_corrupt_nested_zip(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            drive_root = Path(tmp)
            zip_path = drive_root / "paquete.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("inspeccion.geojson", json.dumps(GEOJSON_ORG001))
                zf.writestr("DCIM.zip", b"esto-no-es-un-zip-valido")
                zf.writestr("foto_01.jpg", b"fake-jpeg-bytes")

            pipeline, _ = build_pipeline(drive_root)
            extract_to = drive_root / "extracted"
            extract_to.mkdir()
            # No debe lanzar excepcion aunque DCIM.zip este corrupto.
            pipeline.extract_package(zip_path, extract_to)

            photos = pipeline.find_photos(extract_to)
            self.assertEqual(len(photos), 1)
            self.assertEqual(photos[0].name, "foto_01.jpg")


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

    def test_build_monitoreo_payload_preserves_qfield_relation_id_raw_guid(self):
        """Ver docs/adr/ADR-010-vinculo-real-uso-suelo-monitoreo.md: el
        GeoPackage trae su propia columna "id_monitoreo" (el GUID interno
        de QField que EUDR_USO_SUELO/EUDR_INSTALACIONES preservan tal cual
        en su "id_parcela") -- antes de esta columna, ese valor se
        descartaba por completo. Debe guardarse SIN transformar (con las
        llaves incluidas), para que el join contra id_parcela sea exacto.
        """
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {
                "id_monitoreo": ["{4166dc2a-4cf0-452b-8eee-d5f68ce05e5c}"],
                "ID_Parcela_Fija": ["COOP-JS-001"],
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

        self.assertEqual(payload["qfield_relation_id"], "{4166dc2a-4cf0-452b-8eee-d5f68ce05e5c}")
        # El id_monitoreo real (usado como PK/upsert target) nunca debe
        # ser el mismo valor -- se calcula deterministicamente aparte.
        self.assertNotEqual(payload["id_monitoreo"], payload["qfield_relation_id"])

    def test_build_monitoreo_payload_qfield_relation_id_is_none_when_column_missing(self):
        pipeline = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["COOP-JS-001"],
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

        self.assertIsNone(payload["qfield_relation_id"])


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

            table_calls = [c.args[0] for c in mock_supabase.table.call_args_list if c.args[0] in EUDR_TABLES]
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

            table_calls = [c.args[0] for c in mock_supabase.table.call_args_list if c.args[0] in EUDR_TABLES]
            insert_payloads = [
                c.args[0] for c in mock_supabase.table.return_value.upsert.call_args_list
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

            table_calls = [c.args[0] for c in mock_supabase.table.call_args_list if c.args[0] in EUDR_TABLES]
            insert_payloads = [
                c.args[0] for c in mock_supabase.table.return_value.upsert.call_args_list
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

            table_calls = [c.args[0] for c in mock_supabase.table.call_args_list if c.args[0] in EUDR_TABLES]
            insert_payloads = [
                c.args[0] for c in mock_supabase.table.return_value.upsert.call_args_list
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

        ids, photos, _skipped = pipeline.process_layer_rows(gdf, "EUDR_MONITOREO", "ORG-001", {})

        self.assertEqual(photos, [])
        insert_calls = pipeline.supabase.table.return_value.upsert.call_args_list
        self.assertIsNone(insert_calls[-1].args[0]["evidencia_foto"])


class TestEvidenciaFotoBasenameMatching(unittest.TestCase):
    def _pipeline(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, mock_supabase = build_pipeline(Path(tmp))
        return pipeline, mock_supabase

    def test_resolve_photo_basename_rejects_float_nan(self):
        pipeline, _ = self._pipeline()
        self.assertIsNone(pipeline.resolve_photo_basename(float("nan")))
        self.assertIsNone(pipeline.resolve_photo_basename(np.nan))

    def test_resolve_photo_basename_rejects_none_and_numeric_types(self):
        pipeline, _ = self._pipeline()
        self.assertIsNone(pipeline.resolve_photo_basename(None))
        self.assertIsNone(pipeline.resolve_photo_basename(123))
        self.assertIsNone(pipeline.resolve_photo_basename(1.5))
        self.assertIsNone(pipeline.resolve_photo_basename(np.float64(2.1)))

    def test_resolve_photo_basename_rejects_blank_strings(self):
        pipeline, _ = self._pipeline()
        self.assertIsNone(pipeline.resolve_photo_basename(""))
        self.assertIsNone(pipeline.resolve_photo_basename("   "))

    def test_resolve_photo_basename_extracts_basename_from_path(self):
        pipeline, _ = self._pipeline()
        self.assertEqual(pipeline.resolve_photo_basename("DCIM/foto_01.jpg"), "foto_01.jpg")
        self.assertEqual(pipeline.resolve_photo_basename("foto_01.jpg"), "foto_01.jpg")

    def test_process_layer_rows_does_not_raise_when_evidencia_foto_column_is_nan_float(self):
        # INVARIANTE: geopandas puede tipar evidencia_foto como float64 (NaN) cuando
        # todas las filas de la capa vienen sin foto; no debe lanzar TypeError.
        pipeline, _ = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-001"],
                "ID_Socio": ["SOC-001"],
                "fecha_monitoreo": ["2026-08-16"],
                "evidencia_foto": [float("nan")],
            },
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        self.assertEqual(gdf["evidencia_foto"].dtype.kind, "f")

        ids, photos, _skipped = pipeline.process_layer_rows(gdf, "EUDR_MONITOREO", "ORG-001", {})

        self.assertEqual(photos, [])
        insert_calls = pipeline.supabase.table.return_value.upsert.call_args_list
        self.assertIsNone(insert_calls[-1].args[0]["evidencia_foto"])

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

            ids, photos, _skipped = pipeline.process_layer_rows(
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

            ids, photos, _skipped = pipeline.process_layer_rows(
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

    def test_matches_photo_via_foto_column_when_evidencia_foto_absent(self):
        # INVARIANTE: formularios QField mas simples usan la columna "foto" en vez
        # de "evidencia_foto"; ambos nombres deben resolver al mismo archivo.
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))
            photo_file = Path(tmp) / "foto_simple.jpg"
            photo_file.write_bytes(b"fake-jpeg-bytes")

            gdf = gpd.GeoDataFrame(
                {
                    "ID_Parcela_Fija": ["PARC-001"],
                    "ID_Socio": ["SOC-001"],
                    "fecha_monitoreo": ["2026-08-16"],
                    "foto": ["foto_simple.jpg"],
                },
                geometry=[Point(-77.0, -12.0)],
                crs="EPSG:4326",
            )
            photo_map = {"foto_simple.jpg": photo_file}

            ids, photos, _skipped = pipeline.process_layer_rows(
                gdf, "EUDR_MONITOREO", "ORG-001", photo_map
            )

            self.assertEqual(len(photos), 1)
            self.assertEqual(photos[0], "ORG-001/foto_simple.jpg")

    def test_evidencia_foto_column_takes_priority_over_foto(self):
        import tempfile

        from scripts.etl_drive_to_supabase import EVIDENCIA_FOTO_CANDIDATES

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, _ = build_pipeline(Path(tmp))

        gdf = gpd.GeoDataFrame(
            {"evidencia_foto": ["principal.jpg"], "foto": ["alterna.jpg"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        value = pipeline.resolve_field_with_fallback(row, EVIDENCIA_FOTO_CANDIDATES)

        self.assertEqual(value, "principal.jpg")


class TestUpsertIdempotency(unittest.TestCase):
    def _pipeline(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, mock_supabase = build_pipeline(Path(tmp))
        return pipeline, mock_supabase

    def _monitoreo_row(self, **overrides):
        data = {
            "ID_Parcela_Fija": ["PARC-001"],
            "ID_Socio": ["SOC-001"],
            "fecha_monitoreo": ["2026-08-16"],
            "evidencia_foto": [None],
        }
        data.update({k: [v] for k, v in overrides.items()})
        gdf = gpd.GeoDataFrame(
            data, geometry=[Point(-77.0, -12.0)], crs="EPSG:4326"
        )
        return gdf.iloc[0]

    def test_compute_deterministic_id_is_stable_across_calls(self):
        pipeline, _ = self._pipeline()
        id_a = pipeline.compute_deterministic_id("EUDR_MONITOREO", "ORG-001", "PARC-001", "2026-08-16")
        id_b = pipeline.compute_deterministic_id("EUDR_MONITOREO", "ORG-001", "PARC-001", "2026-08-16")
        self.assertEqual(id_a, id_b)

    def test_compute_deterministic_id_differs_for_different_inputs(self):
        pipeline, _ = self._pipeline()
        id_a = pipeline.compute_deterministic_id("EUDR_MONITOREO", "ORG-001", "PARC-001", "2026-08-16")
        id_b = pipeline.compute_deterministic_id("EUDR_MONITOREO", "ORG-001", "PARC-002", "2026-08-16")
        self.assertNotEqual(id_a, id_b)

    def test_build_monitoreo_payload_id_is_deterministic_from_natural_key(self):
        pipeline, _ = self._pipeline()
        row = self._monitoreo_row()

        payload_run1 = pipeline.build_monitoreo_payload(row, "ORG-001", fid=1)
        payload_run2 = pipeline.build_monitoreo_payload(row, "ORG-001", fid=99)

        self.assertEqual(payload_run1["id_monitoreo"], payload_run2["id_monitoreo"])

    def test_build_monitoreo_payload_falls_back_to_fid_when_no_parcela(self):
        pipeline, _ = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"fecha_monitoreo": ["2026-08-16"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]

        payload_run1 = pipeline.build_monitoreo_payload(row, "ORG-001", fid=7)
        payload_run2 = pipeline.build_monitoreo_payload(row, "ORG-001", fid=7)
        payload_other_fid = pipeline.build_monitoreo_payload(row, "ORG-001", fid=8)

        self.assertIsNone(payload_run1["ID_Parcela_Fija"])
        self.assertEqual(payload_run1["id_monitoreo"], payload_run2["id_monitoreo"])
        self.assertNotEqual(payload_run1["id_monitoreo"], payload_other_fid["id_monitoreo"])

    def test_build_monitoreo_payload_never_includes_fid_field(self):
        # INVARIANTE: EUDR_MONITOREO no tiene columna fid; enviarla causa PGRST204
        # ("Column not found in schema cache"). fid puede usarse internamente para
        # derivar id_monitoreo, pero nunca debe aparecer como clave del payload.
        pipeline, _ = self._pipeline()
        row = self._monitoreo_row()

        payload_con_parcela = pipeline.build_monitoreo_payload(row, "ORG-001", fid=1)

        gdf_sin_parcela = gpd.GeoDataFrame(
            {"fecha_monitoreo": ["2026-08-16"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        payload_sin_parcela = pipeline.build_monitoreo_payload(
            gdf_sin_parcela.iloc[0], "ORG-001", fid=1
        )

        self.assertNotIn("fid", payload_con_parcela)
        self.assertNotIn("fid", payload_sin_parcela)

    def test_resolve_upsert_conflict_target_monitoreo_uses_primary_key(self):
        # INVARIANTE: id_monitoreo se deriva deterministicamente (uuid5) de la clave
        # de negocio en build_monitoreo_payload, asi que conflictuar sobre la PK
        # misma es equivalente a conflictuar sobre esa clave, pero sin depender de
        # que ID_Parcela_Fija sea NOT NULL (NULL != NULL en una restriccion UNIQUE
        # compuesta, lo que impedia deduplicar filas sin parcela resuelta).
        pipeline, _ = self._pipeline()
        payload = {"ID_Parcela_Fija": "PARC-001"}
        target = pipeline.resolve_upsert_conflict_target("EUDR_MONITOREO", payload)
        self.assertEqual(target, "id_monitoreo")

    def test_resolve_upsert_conflict_target_monitoreo_never_uses_fid(self):
        # INVARIANTE: EUDR_MONITOREO no tiene columna fid; usarla en on_conflict
        # produce PGRST204. Debe usar SIEMPRE la PK, con o sin parcela.
        pipeline, _ = self._pipeline()
        payload_sin_parcela = {"ID_Parcela_Fija": None}
        payload_con_parcela = {"ID_Parcela_Fija": "PARC-001"}

        target_sin_parcela = pipeline.resolve_upsert_conflict_target(
            "EUDR_MONITOREO", payload_sin_parcela
        )
        target_con_parcela = pipeline.resolve_upsert_conflict_target(
            "EUDR_MONITOREO", payload_con_parcela
        )

        self.assertEqual(target_sin_parcela, "id_monitoreo")
        self.assertEqual(target_con_parcela, "id_monitoreo")

    def test_resolve_upsert_conflict_target_uso_suelo_and_instalaciones_use_fid(self):
        pipeline, _ = self._pipeline()
        self.assertEqual(
            pipeline.resolve_upsert_conflict_target("EUDR_USO_SUELO", {}), "ID_Organizacion,fid"
        )
        self.assertEqual(
            pipeline.resolve_upsert_conflict_target("EUDR_INSTALACIONES", {}),
            "ID_Organizacion,fid",
        )

    def test_build_uso_suelo_payload_includes_fid(self):
        pipeline, _ = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"id_parcela": ["PARC-001"], "tipo_uso": ["Cafetal"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]
        payload = pipeline.build_uso_suelo_payload(row, "ORG-001", fid=5)
        self.assertEqual(payload["fid"], 5)

    def test_build_instalaciones_payload_includes_fid(self):
        pipeline, _ = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"id_parcela": ["PARC-001"], "tipo_infra": ["Beneficio"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        row = gdf.iloc[0]
        payload = pipeline.build_instalaciones_payload(row, "ORG-001", fid=6)
        self.assertEqual(payload["fid"], 6)

    def test_process_layer_rows_calls_upsert_not_insert(self):
        pipeline, mock_supabase = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"id_parcela": ["PARC-001"], "tipo_uso": ["Cafetal"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )

        pipeline.process_layer_rows(gdf, "EUDR_USO_SUELO", "ORG-001", {})

        mock_supabase.table.return_value.upsert.assert_called_once()
        mock_supabase.table.return_value.insert.assert_not_called()
        call_kwargs = mock_supabase.table.return_value.upsert.call_args.kwargs
        self.assertEqual(call_kwargs["on_conflict"], "ID_Organizacion,fid")

    def test_process_layer_rows_monitoreo_without_parcela_never_sends_fid(self):
        # Reproduce el error real PGRST204: una fila EUDR_MONITOREO sin parcela
        # resuelta no debe enviar 'fid' en el payload ni en el on_conflict.
        pipeline, mock_supabase = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"fecha_monitoreo": ["2026-08-16"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )

        pipeline.process_layer_rows(gdf, "EUDR_MONITOREO", "ORG-001", {})

        call_args = mock_supabase.table.return_value.upsert.call_args
        sent_payload = call_args.args[0]
        self.assertNotIn("fid", sent_payload)
        self.assertEqual(call_args.kwargs["on_conflict"], "id_monitoreo")

    def test_process_layer_rows_reruns_produce_same_id_monitoreo(self):
        # INVARIANTE central de esta tarea: reprocesar el mismo paquete debe
        # actualizar el mismo registro, no crear uno nuevo cada vez.
        pipeline, mock_supabase = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-001"],
                "ID_Socio": ["SOC-001"],
                "fecha_monitoreo": ["2026-08-16"],
            },
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )

        ids_run1, _, _ = pipeline.process_layer_rows(gdf, "EUDR_MONITOREO", "ORG-001", {})
        ids_run2, _, _ = pipeline.process_layer_rows(gdf, "EUDR_MONITOREO", "ORG-001", {})

        self.assertEqual(ids_run1, ids_run2)

    def test_process_layer_rows_reruns_dedupe_even_without_parcela_resuelta(self):
        # Cubre la limitacion que existia con el conflict target compuesto: al
        # conflictuar sobre la PK (deterministica via fid), una fila sin parcela
        # resuelta tambien debe deduplicar entre corridas, no solo insertarse de nuevo.
        pipeline, mock_supabase = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"fecha_monitoreo": ["2026-08-16"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )

        ids_run1, _, _ = pipeline.process_layer_rows(gdf, "EUDR_MONITOREO", "ORG-001", {})
        ids_run2, _, _ = pipeline.process_layer_rows(gdf, "EUDR_MONITOREO", "ORG-001", {})

        self.assertEqual(ids_run1, ids_run2)
        for call in mock_supabase.table.return_value.upsert.call_args_list:
            self.assertEqual(call.kwargs["on_conflict"], "id_monitoreo")


class TestParcelaCodeConflictWarning(unittest.TestCase):
    """ADR-014: un ID_Parcela_Fija debe corresponder a un unico lugar fisico.
    warn_parcela_code_conflicts es SOLO informativa (nunca bloquea la ingesta) —
    el bloqueo real de la decision de QC vive en fn_validar_codigo_parcela_unico,
    del lado de la Consola QC, no en el ETL."""

    def _pipeline(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, mock_supabase = build_pipeline(Path(tmp))
        return pipeline, mock_supabase

    def _stub_other_records(self, mock_supabase, others: list[dict]):
        select_mock = mock_supabase.table.return_value.select.return_value
        select_mock.eq.return_value.eq.return_value.neq.return_value.execute.return_value.data = others

    def _monitoreo_gdf(self, lon=-77.0, lat=-12.0):
        return gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-001"],
                "ID_Socio": ["SOC-001"],
                "fecha_monitoreo": ["2026-08-16"],
            },
            geometry=[Point(lon, lat)],
            crs="EPSG:4326",
        )

    def test_no_warning_when_no_other_records_share_the_code(self):
        pipeline, mock_supabase = self._pipeline()
        self._stub_other_records(mock_supabase, [])

        buf = io.StringIO()
        with redirect_stdout(buf):
            pipeline.process_layer_rows(self._monitoreo_gdf(), "EUDR_MONITOREO", "ORG-001", {})

        self.assertNotIn("ADVERTENCIA", buf.getvalue())
        mock_supabase.table.return_value.upsert.assert_called_once()

    def test_warns_when_another_record_with_same_code_is_far_away(self):
        pipeline, mock_supabase = self._pipeline()
        # ~0.02 grados de longitud en el ecuador ~= 2.2km — muy por encima
        # del umbral de 100m.
        other_geom = mapping(Point(-77.02, -12.0))
        self._stub_other_records(
            mock_supabase,
            [{"id_monitoreo": "otro-uuid", "geom_inspeccion": other_geom, "estado_revision": "APROBADO"}],
        )

        buf = io.StringIO()
        with redirect_stdout(buf):
            pipeline.process_layer_rows(self._monitoreo_gdf(), "EUDR_MONITOREO", "ORG-001", {})

        output = buf.getvalue()
        self.assertIn("ADVERTENCIA", output)
        self.assertIn("PARC-001", output)
        self.assertIn("otro-uuid", output)
        self.assertIn("APROBADO", output)
        # Solo informativo: la ingesta sigue normalmente, no se omite el upsert.
        mock_supabase.table.return_value.upsert.assert_called_once()

    def test_no_warning_when_other_record_is_within_threshold(self):
        pipeline, mock_supabase = self._pipeline()
        # ~5.5m de diferencia (0.00005 grados) — ruido GPS normal, por
        # debajo de PARCELA_CONFLICT_THRESHOLD_M (100m).
        other_geom = mapping(Point(-77.00005, -12.0))
        self._stub_other_records(
            mock_supabase,
            [{"id_monitoreo": "otro-uuid", "geom_inspeccion": other_geom, "estado_revision": "PENDIENTE"}],
        )

        buf = io.StringIO()
        with redirect_stdout(buf):
            pipeline.process_layer_rows(self._monitoreo_gdf(), "EUDR_MONITOREO", "ORG-001", {})

        self.assertNotIn("ADVERTENCIA", buf.getvalue())
        mock_supabase.table.return_value.upsert.assert_called_once()

    def test_never_runs_for_uso_suelo_or_instalaciones(self):
        pipeline, mock_supabase = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {"id_parcela": ["PARC-001"], "tipo_uso": ["Cafetal"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        # Si esto se llamara para EUDR_USO_SUELO, el .neq() mockeado no
        # devolvería nada configurado -> MagicMock no iterable -> excepcion.
        # Que no explote (y que no aparezca ninguna advertencia) confirma
        # que la funcion nunca se invoca fuera de EUDR_MONITOREO.
        buf = io.StringIO()
        with redirect_stdout(buf):
            pipeline.process_layer_rows(gdf, "EUDR_USO_SUELO", "ORG-001", {})
        self.assertNotIn("ADVERTENCIA", buf.getvalue())
        self.assertNotIn("AVISO", buf.getvalue())
        mock_supabase.table.return_value.upsert.assert_called_once()

    def test_never_blocks_ingestion_even_if_the_check_itself_raises(self):
        pipeline, mock_supabase = self._pipeline()
        select_mock = mock_supabase.table.return_value.select.return_value
        select_mock.eq.return_value.eq.return_value.neq.return_value.execute.side_effect = RuntimeError(
            "fallo simulado de red"
        )

        buf = io.StringIO()
        with redirect_stdout(buf):
            # No debe lanzar -- best-effort, mismo criterio que audit_logs (ADR-013).
            pipeline.process_layer_rows(self._monitoreo_gdf(), "EUDR_MONITOREO", "ORG-001", {})

        self.assertIn("AVISO", buf.getvalue())
        mock_supabase.table.return_value.upsert.assert_called_once()


class TestSocioOrgMismatchWarning(unittest.TestCase):
    """ADR-020: warn_socio_org_mismatch es SOLO informativa (nunca bloquea la
    ingesta) -- el bloqueo real de la decision de QC vive en
    assertSocioParcelaMismaOrganizacion, lib/eudrQcActions.js, no en el ETL.
    Se prueba llamando la funcion directo (no via process_layer_rows): usa el
    mismo chain de mock de un solo .eq() que fetch_existing_estado_revision
    para EUDR_MONITOREO (on_conflict de una sola columna), asi que probarla
    end-to-end pisaria esa configuracion sin necesidad -- llamarla aislada
    evita esa colision sin cambiar el comportamiento real que se prueba."""

    def _pipeline(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, mock_supabase = build_pipeline(Path(tmp))
        return pipeline, mock_supabase

    def test_no_warning_when_socio_belongs_to_the_same_org(self):
        pipeline, mock_supabase = self._pipeline()
        select_mock = mock_supabase.table.return_value.select.return_value
        select_mock.eq.return_value.execute.return_value.data = [{"ID_Organizacion": "ORG-001"}]

        buf = io.StringIO()
        with redirect_stdout(buf):
            pipeline.warn_socio_org_mismatch("ORG-001", "SOC-001", None, "test-id")

        self.assertNotIn("ADVERTENCIA", buf.getvalue())

    def test_warns_when_socio_belongs_to_a_different_org(self):
        pipeline, mock_supabase = self._pipeline()
        select_mock = mock_supabase.table.return_value.select.return_value
        select_mock.eq.return_value.execute.return_value.data = [{"ID_Organizacion": "COOP-JS"}]

        buf = io.StringIO()
        with redirect_stdout(buf):
            pipeline.warn_socio_org_mismatch("ORG-TEST-E2E", "JS-00001", None, "registro-123")

        output = buf.getvalue()
        self.assertIn("ADVERTENCIA", output)
        self.assertIn("registro-123", output)
        self.assertIn("JS-00001", output)
        self.assertIn("COOP-JS", output)
        self.assertIn("ORG-TEST-E2E", output)
        self.assertIn("no bloquea la ingesta", output)

    def test_warns_when_parcela_belongs_to_a_different_org(self):
        pipeline, mock_supabase = self._pipeline()
        select_mock = mock_supabase.table.return_value.select.return_value
        select_mock.eq.return_value.execute.return_value.data = [{"ID_Organizacion": "COOP-ND"}]

        buf = io.StringIO()
        with redirect_stdout(buf):
            pipeline.warn_socio_org_mismatch("ORG-TEST-E2E", None, "COOP-ND-004", "registro-456")

        output = buf.getvalue()
        self.assertIn("ADVERTENCIA", output)
        self.assertIn("COOP-ND-004", output)
        self.assertIn("COOP-ND", output)

    def test_no_warning_when_socio_or_parcela_do_not_exist_in_the_padron_yet(self):
        # ID_Socio/ID_Parcela_Fija de texto libre que no existen en el padron
        # (ej. un codigo mal tipeado) -- fuera de alcance de esta advertencia,
        # ya cubierto por otras verificaciones (ADR-019 del lado del Editor
        # Vectorial/Cargar Capa Espacial); este ETL nunca los rechaza.
        pipeline, mock_supabase = self._pipeline()
        select_mock = mock_supabase.table.return_value.select.return_value
        select_mock.eq.return_value.execute.return_value.data = []

        buf = io.StringIO()
        with redirect_stdout(buf):
            pipeline.warn_socio_org_mismatch("ORG-001", "SOC-INEXISTENTE", "PARC-INEXISTENTE", "test-id")

        self.assertNotIn("ADVERTENCIA", buf.getvalue())

    def test_no_query_at_all_when_socio_id_and_parcela_id_are_both_empty(self):
        pipeline, mock_supabase = self._pipeline()

        buf = io.StringIO()
        with redirect_stdout(buf):
            pipeline.warn_socio_org_mismatch("ORG-001", None, None, "test-id")

        self.assertNotIn("ADVERTENCIA", buf.getvalue())
        mock_supabase.table.assert_not_called()

    def test_never_raises_even_if_the_check_itself_fails(self):
        pipeline, mock_supabase = self._pipeline()
        select_mock = mock_supabase.table.return_value.select.return_value
        select_mock.eq.return_value.execute.side_effect = RuntimeError("fallo simulado de red")

        buf = io.StringIO()
        with redirect_stdout(buf):
            # No debe lanzar -- best-effort, mismo criterio que audit_logs (ADR-013)
            # y warn_parcela_code_conflicts (ADR-014).
            pipeline.warn_socio_org_mismatch("ORG-001", "SOC-001", "PARC-001", "test-id")

        self.assertIn("AVISO", buf.getvalue())

    def test_wired_into_process_layer_rows_for_the_3_tablas_eudr(self):
        # Confirma que el punto de llamada dentro de process_layer_rows existe
        # para las 3 tablas (no solo EUDR_MONITOREO, a diferencia de
        # warn_parcela_code_conflicts) -- parcheando la funcion misma para no
        # depender de la forma real del mock de Supabase.
        pipeline, mock_supabase = self._pipeline()

        monitoreo_gdf = gpd.GeoDataFrame(
            {"ID_Parcela_Fija": ["PARC-001"], "ID_Socio": ["SOC-001"], "fecha_monitoreo": ["2026-08-16"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        uso_suelo_gdf = gpd.GeoDataFrame(
            {"id_parcela": ["PARC-001"], "tipo_uso": ["Cafetal"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )
        instalaciones_gdf = gpd.GeoDataFrame(
            {"id_parcela": ["PARC-001"], "tipo_infra": ["Beneficio Humedo"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )

        with patch.object(pipeline, "warn_socio_org_mismatch") as mock_warn:
            pipeline.process_layer_rows(monitoreo_gdf, "EUDR_MONITOREO", "ORG-001", {})
            pipeline.process_layer_rows(uso_suelo_gdf, "EUDR_USO_SUELO", "ORG-001", {})
            pipeline.process_layer_rows(instalaciones_gdf, "EUDR_INSTALACIONES", "ORG-001", {})

        self.assertEqual(mock_warn.call_count, 3)
        monitoreo_call, uso_suelo_call, instalaciones_call = mock_warn.call_args_list
        self.assertEqual(monitoreo_call.args[:3], ("ORG-001", "SOC-001", "PARC-001"))
        self.assertEqual(uso_suelo_call.args[:3], ("ORG-001", None, "PARC-001"))
        self.assertEqual(instalaciones_call.args[:3], ("ORG-001", None, "PARC-001"))


class TestProtectsAlreadyReviewedRecords(unittest.TestCase):
    """ADR-012: un registro ya APROBADO/RECHAZADO nunca debe ser tocado por una
    resincronizacion del mismo paquete (o de un paquete posterior del mismo proyecto
    QField activo) — ni siquiera para reescribirle el mismo valor. Solo un registro
    que sigue PENDIENTE (o que todavia no existe) se actualiza con normalidad."""

    def _pipeline(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            pipeline, mock_supabase = build_pipeline(Path(tmp))
        return pipeline, mock_supabase

    def _stub_existing_estado(self, mock_supabase, estado: str | None):
        select_mock = mock_supabase.table.return_value.select.return_value
        data = [{"estado_revision": estado}] if estado is not None else []
        select_mock.eq.return_value.execute.return_value.data = data
        select_mock.eq.return_value.eq.return_value.execute.return_value.data = data

    def _monitoreo_gdf(self):
        return gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-001"],
                "ID_Socio": ["SOC-001"],
                "fecha_monitoreo": ["2026-08-16"],
            },
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )

    def _uso_suelo_gdf(self):
        return gpd.GeoDataFrame(
            {"id_parcela": ["PARC-001"], "tipo_uso": ["Cafetal"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )

    def _instalaciones_gdf(self):
        return gpd.GeoDataFrame(
            {"id_parcela": ["PARC-001"], "tipo_infra": ["Beneficio Humedo"]},
            geometry=[Point(-77.0, -12.0)],
            crs="EPSG:4326",
        )

    def test_monitoreo_aprobado_is_skipped_entirely(self):
        pipeline, mock_supabase = self._pipeline()
        self._stub_existing_estado(mock_supabase, "APROBADO")

        ids, photos, skipped = pipeline.process_layer_rows(
            self._monitoreo_gdf(), "EUDR_MONITOREO", "ORG-001", {}
        )

        mock_supabase.table.return_value.upsert.assert_not_called()
        self.assertEqual(ids, [])
        self.assertEqual(len(skipped), 1)
        self.assertEqual(skipped[0]["table"], "EUDR_MONITOREO")
        self.assertEqual(skipped[0]["estado_revision"], "APROBADO")

    def test_monitoreo_rechazado_is_skipped_entirely(self):
        pipeline, mock_supabase = self._pipeline()
        self._stub_existing_estado(mock_supabase, "RECHAZADO")

        ids, photos, skipped = pipeline.process_layer_rows(
            self._monitoreo_gdf(), "EUDR_MONITOREO", "ORG-001", {}
        )

        mock_supabase.table.return_value.upsert.assert_not_called()
        self.assertEqual(len(skipped), 1)
        self.assertEqual(skipped[0]["estado_revision"], "RECHAZADO")

    def test_uso_suelo_aprobado_is_skipped_entirely(self):
        pipeline, mock_supabase = self._pipeline()
        self._stub_existing_estado(mock_supabase, "APROBADO")

        ids, photos, skipped = pipeline.process_layer_rows(
            self._uso_suelo_gdf(), "EUDR_USO_SUELO", "ORG-001", {}
        )

        mock_supabase.table.return_value.upsert.assert_not_called()
        self.assertEqual(len(skipped), 1)
        self.assertEqual(skipped[0]["table"], "EUDR_USO_SUELO")

    def test_instalaciones_aprobado_is_skipped_entirely(self):
        pipeline, mock_supabase = self._pipeline()
        self._stub_existing_estado(mock_supabase, "APROBADO")

        ids, photos, skipped = pipeline.process_layer_rows(
            self._instalaciones_gdf(), "EUDR_INSTALACIONES", "ORG-001", {}
        )

        mock_supabase.table.return_value.upsert.assert_not_called()
        self.assertEqual(len(skipped), 1)
        self.assertEqual(skipped[0]["table"], "EUDR_INSTALACIONES")

    def test_monitoreo_pendiente_existing_record_still_updates_normally(self):
        pipeline, mock_supabase = self._pipeline()
        self._stub_existing_estado(mock_supabase, "PENDIENTE")

        ids, photos, skipped = pipeline.process_layer_rows(
            self._monitoreo_gdf(), "EUDR_MONITOREO", "ORG-001", {}
        )

        mock_supabase.table.return_value.upsert.assert_called_once()
        self.assertEqual(len(ids), 1)
        self.assertEqual(skipped, [])

    def test_monitoreo_nonexistent_record_still_inserts_normally(self):
        pipeline, mock_supabase = self._pipeline()
        self._stub_existing_estado(mock_supabase, None)

        ids, photos, skipped = pipeline.process_layer_rows(
            self._monitoreo_gdf(), "EUDR_MONITOREO", "ORG-001", {}
        )

        mock_supabase.table.return_value.upsert.assert_called_once()
        self.assertEqual(len(ids), 1)
        self.assertEqual(skipped, [])

    def test_mixed_batch_skips_reviewed_and_updates_pendiente(self):
        # Dos filas con distinta parcela -> distinto id_monitoreo -> cada .eq()
        # devuelve un resultado diferente segun el filtro recibido.
        pipeline, mock_supabase = self._pipeline()
        gdf = gpd.GeoDataFrame(
            {
                "ID_Parcela_Fija": ["PARC-001", "PARC-002"],
                "ID_Socio": ["SOC-001", "SOC-002"],
                "fecha_monitoreo": ["2026-08-16", "2026-08-16"],
            },
            geometry=[Point(-77.0, -12.0), Point(-77.1, -12.1)],
            crs="EPSG:4326",
        )
        id_reviewed = pipeline.compute_deterministic_id(
            "EUDR_MONITOREO", "ORG-001", "PARC-001", "2026-08-16"
        )

        def fake_eq(field, value):
            result = MagicMock()
            estado = "APROBADO" if field == "id_monitoreo" and value == id_reviewed else None
            data = [{"estado_revision": estado}] if estado is not None else []
            result.execute.return_value.data = data
            return result

        mock_supabase.table.return_value.select.return_value.eq.side_effect = fake_eq

        ids, photos, skipped = pipeline.process_layer_rows(
            gdf, "EUDR_MONITOREO", "ORG-001", {}
        )

        self.assertEqual(len(skipped), 1)
        self.assertEqual(skipped[0]["id"], id_reviewed)
        self.assertEqual(len(ids), 1)
        mock_supabase.table.return_value.upsert.assert_called_once()


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

            insert_payload = mock_supabase.table.return_value.upsert.call_args[0][0]
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
