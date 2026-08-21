"""Teardown del E2E ETL test (scripts/run_e2e_etl_test.py) — ver
docs/adr/ADR-007-integridad-referencial-id-organizacion.md.

Hallazgo real: run_e2e() insertaba filas reales en EUDR_MONITOREO
(ORG_ID = "ORG-COOP-NORTE") sin limpiarlas al terminar — 6 filas
huerfanas confirmadas acumuladas en la instancia viva tras corridas
repetidas. Estas pruebas verifican que el teardown corre en un
`finally` (exito o fallo), borra solo las filas que ESE run creo (por
id_monitoreo, nunca un DELETE sin acotar por ID), y se salta en modo
simulado (mock_supabase) o con cleanup=False.

Ejecutar con: python -m pytest tests/test_e2e_teardown.py -v
"""

import unittest
from unittest.mock import MagicMock, patch

from scripts.run_e2e_etl_test import run_e2e, teardown_e2e_rows


class TestTeardownE2eRows(unittest.TestCase):
    def test_teardown_borra_cada_id_insertado(self):
        pipeline = MagicMock()
        teardown_e2e_rows(pipeline, ["uuid-1", "uuid-2"])

        table = pipeline.supabase.table
        table.assert_any_call("EUDR_MONITOREO")
        delete_calls = table.return_value.delete.return_value.eq.call_args_list
        self.assertEqual([c.args for c in delete_calls], [("id_monitoreo", "uuid-1"), ("id_monitoreo", "uuid-2")])

    def test_teardown_no_hace_nada_con_lista_vacia(self):
        pipeline = MagicMock()
        teardown_e2e_rows(pipeline, [])
        pipeline.supabase.table.assert_not_called()


class TestRunE2eTeardownIntegration(unittest.TestCase):
    """Mockea las piezas pesadas (geopandas/filesystem/pipeline real) para
    aislar el control de flujo try/finally de run_e2e()."""

    def _patch_common(self, process_package_return, raise_on_archive_check=False):
        patches = {
            "scripts.run_e2e_etl_test.setup_directories": patch(
                "scripts.run_e2e_etl_test.setup_directories", return_value=(MagicMock(), MagicMock())
            ),
            "scripts.run_e2e_etl_test.build_e2e_package": patch(
                "scripts.run_e2e_etl_test.build_e2e_package", return_value=MagicMock()
            ),
            "scripts.run_e2e_etl_test.verify_reprojection": patch(
                "scripts.run_e2e_etl_test.verify_reprojection",
                return_value=MagicMock(crs=MagicMock(to_epsg=lambda: 4326)),
            ),
            "scripts.run_e2e_etl_test.verify_photo_criterion": patch(
                "scripts.run_e2e_etl_test.verify_photo_criterion", return_value="ORG-COOP-NORTE/foto.jpg"
            ),
        }
        started = {name: p.start() for name, p in patches.items()}
        self.addCleanup(lambda: [p.stop() for p in patches.values()])

        if raise_on_archive_check:
            archive_patch = patch(
                "scripts.run_e2e_etl_test.verify_archive_criterion",
                side_effect=AssertionError("zip no encontrado (simulado para el test)"),
            )
        else:
            archive_patch = patch("scripts.run_e2e_etl_test.verify_archive_criterion", return_value=MagicMock())
        started["archive"] = archive_patch.start()
        self.addCleanup(archive_patch.stop)

        pipeline = MagicMock()
        pipeline.process_package.return_value = process_package_return
        build_pipeline_patch = patch("scripts.run_e2e_etl_test.build_pipeline", return_value=pipeline)
        started["build_pipeline"] = build_pipeline_patch.start()
        self.addCleanup(build_pipeline_patch.stop)

        return pipeline

    def test_teardown_corre_cuando_el_test_pasa(self):
        pipeline = self._patch_common(
            process_package_return={"inserted_ids": ["uuid-real-1"], "uploaded_photos": ["x"]}
        )
        pipeline.supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"estado_revision": "PENDIENTE"}
        ]

        run_e2e(base_dir=MagicMock())

        pipeline.supabase.table.return_value.delete.return_value.eq.assert_any_call("id_monitoreo", "uuid-real-1")

    def test_teardown_corre_incluso_si_una_verificacion_intermedia_falla(self):
        pipeline = self._patch_common(
            process_package_return={"inserted_ids": ["uuid-real-2"], "uploaded_photos": ["x"]},
            raise_on_archive_check=True,
        )

        with self.assertRaises(AssertionError):
            run_e2e(base_dir=MagicMock())

        pipeline.supabase.table.return_value.delete.return_value.eq.assert_any_call("id_monitoreo", "uuid-real-2")

    def test_no_hace_teardown_en_modo_simulado_mock_supabase(self):
        pipeline = self._patch_common(
            process_package_return={"inserted_ids": ["uuid-real-3"], "uploaded_photos": ["x"]}
        )
        mock_supabase = MagicMock()
        mock_supabase.table.return_value.upsert.call_args = MagicMock()
        mock_supabase.table.return_value.upsert.call_args.__getitem__ = lambda self, i: [{"estado_revision": "PENDIENTE"}] if i == 0 else {}

        run_e2e(base_dir=MagicMock(), mock_supabase=mock_supabase)

        # El pipeline real (el que SÍ tocaría la base) nunca debería
        # recibir una llamada de delete — el modo simulado no insertó nada real.
        pipeline.supabase.table.return_value.delete.assert_not_called()

    def test_no_hace_teardown_con_cleanup_false(self):
        pipeline = self._patch_common(
            process_package_return={"inserted_ids": ["uuid-real-4"], "uploaded_photos": ["x"]}
        )
        pipeline.supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"estado_revision": "PENDIENTE"}
        ]

        run_e2e(base_dir=MagicMock(), cleanup=False)

        pipeline.supabase.table.return_value.delete.assert_not_called()


if __name__ == "__main__":
    unittest.main()
