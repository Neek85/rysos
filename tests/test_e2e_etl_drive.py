import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from scripts.etl_drive_to_supabase import EVIDENCIA_BUCKET
from scripts.run_e2e_etl_test import (
    ORG_ID,
    PHOTO_NAME,
    build_e2e_package,
    build_pipeline,
    setup_directories,
    verify_archive_criterion,
    verify_photo_criterion,
    verify_reprojection,
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def make_mock_supabase() -> MagicMock:
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.upsert.return_value.execute.return_value = MagicMock()
    # ADR-012: simula "el registro todavia no existe" (data=[]) para el chequeo de
    # estado_revision previo al upsert — ver el mismo patron en tests/test_etl_drive.py.
    select_mock = mock_supabase.table.return_value.select.return_value
    select_mock.eq.return_value.execute.return_value.data = []
    select_mock.eq.return_value.eq.return_value.execute.return_value.data = []
    return mock_supabase


class TestE2EDirectoryScaffolding(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_setup_directories_creates_org_scoped_inbox_and_archive(self):
        inbox_dir, archive_dir = setup_directories(self.base_dir)

        self.assertTrue(inbox_dir.exists())
        self.assertTrue(archive_dir.exists())
        self.assertEqual(inbox_dir, self.base_dir / ORG_ID / "RYZOS_INBOX")
        self.assertEqual(archive_dir, self.base_dir / ORG_ID / "RYZOS_ARCHIVE")


class TestE2EPipelineOrchestration(unittest.TestCase):
    """Verifica los 3 criterios de exito E2E con un cliente Supabase simulado (sin red)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_criterio_1_zip_movido_y_renombrado(self):
        inbox_dir, archive_dir = setup_directories(self.base_dir)
        zip_path = build_e2e_package(inbox_dir)

        mock_supabase = make_mock_supabase()
        pipeline = build_pipeline(self.base_dir, "https://fake.supabase.co", "fake-key", mock_supabase=mock_supabase)

        result = pipeline.process_package(zip_path, execute_move=True)

        archived_zip = verify_archive_criterion(archive_dir)
        self.assertEqual(result["archive_dest"], archived_zip)
        self.assertFalse(zip_path.exists())
        self.assertTrue(archived_zip.name.endswith("_monitoreo_campo_e2e.zip"))

    def test_criterio_2_fotos_identificadas_para_bucket(self):
        inbox_dir, archive_dir = setup_directories(self.base_dir)
        zip_path = build_e2e_package(inbox_dir)

        mock_supabase = make_mock_supabase()
        pipeline = build_pipeline(self.base_dir, "https://fake.supabase.co", "fake-key", mock_supabase=mock_supabase)

        result = pipeline.process_package(zip_path, execute_move=True)

        storage_path = verify_photo_criterion(result)
        self.assertEqual(storage_path, f"{ORG_ID}/{PHOTO_NAME}")
        mock_supabase.storage.from_.assert_called_with(EVIDENCIA_BUCKET)

    def test_criterio_3_geometria_wgs84_y_estado_pendiente(self):
        inbox_dir, archive_dir = setup_directories(self.base_dir)
        zip_path = build_e2e_package(inbox_dir)

        gdf_reprojected = verify_reprojection(zip_path, self.base_dir / "_verify_reproj")
        self.assertEqual(gdf_reprojected.crs.to_epsg(), 4326)

        mock_supabase = make_mock_supabase()
        pipeline = build_pipeline(self.base_dir, "https://fake.supabase.co", "fake-key", mock_supabase=mock_supabase)
        pipeline.process_package(zip_path, execute_move=True)

        insert_payload = mock_supabase.table.return_value.upsert.call_args[0][0]
        self.assertEqual(insert_payload["estado_revision"], "PENDIENTE")
        self.assertIsNotNone(insert_payload["geom_inspeccion"])
        self.assertEqual(insert_payload["ID_Organizacion"], ORG_ID)


@unittest.skipUnless(
    SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY,
    "Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (credenciales live) para el E2E real",
)
class TestE2ELiveSupabase(unittest.TestCase):
    """E2E real contra Supabase PostGIS + Storage. Solo corre con credenciales live."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_e2e_ingesta_real_supabase(self):
        inbox_dir, archive_dir = setup_directories(self.base_dir)
        zip_path = build_e2e_package(inbox_dir)

        pipeline = build_pipeline(self.base_dir, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        result = pipeline.process_package(zip_path, execute_move=True)

        verify_archive_criterion(archive_dir)
        verify_photo_criterion(result)

        response = (
            pipeline.supabase.table("EUDR_MONITOREO")
            .select("estado_revision")
            .eq("id_monitoreo", result["inserted_ids"][0])
            .execute()
        )
        self.assertEqual(response.data[0]["estado_revision"], "PENDIENTE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
