"""Guardarail de entorno de run_e2e_etl_test.py — ver
docs/adr/ADR-008-etiqueta-organizacion-prueba-y-guardarail-e2e.md.

Motivo: el script escribia contra ORG_ID = "ORG-COOP-NORTE" sin fila
correspondiente en ORGANIZACIONES (ver ADR-007), sin ninguna barrera de
codigo que lo hubiera detectado antes de acumular filas huerfanas reales.
Estas pruebas verifican que assert_org_is_test_marked aborta (sin llamar
a process_package, es decir sin escribir nada) cuando la organizacion no
esta marcada como es_organizacion_prueba=true o no existe la fila, y que
run_e2e() solo la invoca en modo real (nunca en modo simulado).

Ejecutar con: python -m pytest tests/test_e2e_org_guardrail.py -v
"""

import unittest
from unittest.mock import MagicMock, patch

from scripts.run_e2e_etl_test import ORG_ID, UnsafeOrgIdError, assert_org_is_test_marked, run_e2e


class TestAssertOrgIsTestMarked(unittest.TestCase):
    def test_pasa_si_la_fila_existe_y_esta_marcada_como_prueba(self):
        supabase = MagicMock()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"ID": ORG_ID, "es_organizacion_prueba": True}
        ]
        assert_org_is_test_marked(supabase, ORG_ID)  # no debe lanzar

    def test_aborta_si_la_fila_no_existe(self):
        supabase = MagicMock()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
        with self.assertRaises(UnsafeOrgIdError):
            assert_org_is_test_marked(supabase, "ORG-QUE-NO-EXISTE")

    def test_aborta_si_la_fila_existe_pero_es_organizacion_prueba_es_false(self):
        supabase = MagicMock()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"ID": "COOP-JS", "es_organizacion_prueba": False}
        ]
        with self.assertRaises(UnsafeOrgIdError):
            assert_org_is_test_marked(supabase, "COOP-JS")


class TestRunE2eGuardrailIntegration(unittest.TestCase):
    """Confirma que run_e2e() llama al guardarail en modo real ANTES de
    escribir, y que el modo simulado lo salta por completo."""

    def _patch_common(self):
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
        }
        started = {name: p.start() for name, p in patches.items()}
        self.addCleanup(lambda: [p.stop() for p in patches.values()])

        pipeline = MagicMock()
        build_pipeline_patch = patch("scripts.run_e2e_etl_test.build_pipeline", return_value=pipeline)
        started["build_pipeline"] = build_pipeline_patch.start()
        self.addCleanup(build_pipeline_patch.stop)

        return pipeline

    def test_modo_real_aborta_sin_escribir_si_el_guardarail_falla(self):
        pipeline = self._patch_common()
        pipeline.supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

        with self.assertRaises(UnsafeOrgIdError):
            run_e2e(base_dir=MagicMock())

        pipeline.process_package.assert_not_called()

    def test_modo_simulado_no_llama_al_guardarail(self):
        pipeline = self._patch_common()
        pipeline.process_package.return_value = {"inserted_ids": [], "uploaded_photos": ["x"]}

        archive_patch = patch("scripts.run_e2e_etl_test.verify_archive_criterion", return_value=MagicMock())
        archive_patch.start()
        self.addCleanup(archive_patch.stop)
        photo_patch = patch(
            "scripts.run_e2e_etl_test.verify_photo_criterion", return_value=f"{ORG_ID}/foto.jpg"
        )
        photo_patch.start()
        self.addCleanup(photo_patch.stop)

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.upsert.call_args = MagicMock()
        mock_supabase.table.return_value.upsert.call_args.__getitem__ = (
            lambda self, i: [{"estado_revision": "PENDIENTE"}] if i == 0 else {}
        )

        run_e2e(base_dir=MagicMock(), mock_supabase=mock_supabase)

        # En modo simulado no hay ORGANIZACIONES real que consultar — el
        # cliente real (pipeline.supabase) nunca debería recibir una
        # consulta a ORGANIZACIONES.
        pipeline.supabase.table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
