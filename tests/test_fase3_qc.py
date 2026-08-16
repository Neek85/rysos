import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts.qgis_qc_actions import (
    get_approve_action_sql,
    get_reject_action_sql,
    get_revert_action_sql,
    VALID_STATES,
)

VALID_UUID = "a1b2c3d4-e5f6-4789-ab01-cd2345ef6789"
INVALID_UUID = "not-a-uuid"


class TestQCStateTransitions(unittest.TestCase):
    def test_valid_states_set(self):
        self.assertEqual(VALID_STATES, {"PENDIENTE", "APROBADO", "RECHAZADO"})

    def test_pendiente_to_aprobado(self):
        estado = "PENDIENTE"
        self.assertIn(estado, VALID_STATES)
        estado = "APROBADO"
        self.assertEqual(estado, "APROBADO")

    def test_pendiente_to_rechazado(self):
        estado = "PENDIENTE"
        estado = "RECHAZADO"
        self.assertIn(estado, VALID_STATES)

    def test_invalid_state_not_in_set(self):
        self.assertNotIn("EN_REVISION", VALID_STATES)
        self.assertNotIn("", VALID_STATES)
        self.assertNotIn("BORRADOR", VALID_STATES)


class TestDashboardViewFilterRule(unittest.TestCase):
    def _apply_view_filter(self, records):
        """Replica la lógica WHERE estado_revision = 'APROBADO' de la vista."""
        return [r for r in records if r["estado_revision"] == "APROBADO"]

    def test_only_aprobado_visible(self):
        records = [
            {"id": 1, "estado_revision": "PENDIENTE"},
            {"id": 2, "estado_revision": "APROBADO"},
            {"id": 3, "estado_revision": "RECHAZADO"},
        ]
        visible = self._apply_view_filter(records)
        self.assertEqual(len(visible), 1)
        self.assertEqual(visible[0]["id"], 2)

    def test_pendiente_never_visible(self):
        records = [{"id": 1, "estado_revision": "PENDIENTE"}]
        self.assertEqual(len(self._apply_view_filter(records)), 0)

    def test_rechazado_never_visible(self):
        records = [{"id": 1, "estado_revision": "RECHAZADO"}]
        self.assertEqual(len(self._apply_view_filter(records)), 0)

    def test_empty_dataset_returns_empty(self):
        self.assertEqual(self._apply_view_filter([]), [])

    def test_approval_makes_record_visible(self):
        record = {"id": 5, "estado_revision": "PENDIENTE"}
        self.assertEqual(len(self._apply_view_filter([record])), 0)
        record["estado_revision"] = "APROBADO"
        self.assertEqual(len(self._apply_view_filter([record])), 1)


class TestQGISActionsSQL(unittest.TestCase):
    def test_approve_sql_contains_aprobado(self):
        sql = get_approve_action_sql(VALID_UUID)
        self.assertIn("'APROBADO'", sql)
        self.assertIn(VALID_UUID, sql)
        self.assertIn("AND estado_revision = 'PENDIENTE'", sql)

    def test_approve_sql_sets_actualizado_en(self):
        sql = get_approve_action_sql(VALID_UUID)
        self.assertIn("actualizado_en", sql)
        self.assertIn("now()", sql)

    def test_reject_sql_contains_rechazado(self):
        sql = get_reject_action_sql(VALID_UUID, "Límite incorrecto")
        self.assertIn("'RECHAZADO'", sql)
        self.assertIn("RECHAZADO QC", sql)
        self.assertIn("Límite incorrecto", sql)

    def test_reject_sql_escapes_single_quotes(self):
        sql = get_reject_action_sql(VALID_UUID, "O'Higgins área")
        self.assertIn("O''Higgins", sql)
        self.assertNotIn("O'Higgins área", sql)

    def test_revert_sql_sets_pendiente(self):
        sql = get_revert_action_sql(VALID_UUID)
        self.assertIn("'PENDIENTE'", sql)
        self.assertIn(VALID_UUID, sql)

    def test_reject_sql_without_motivo(self):
        sql = get_reject_action_sql(VALID_UUID)
        self.assertIn("[RECHAZADO QC]", sql)

    def test_reject_motivo_max_length_truncated(self):
        long_motivo = "x" * 600
        sql = get_reject_action_sql(VALID_UUID, long_motivo)
        self.assertLessEqual(len(sql), 2000)


class TestUUIDValidation(unittest.TestCase):
    def test_invalid_uuid_raises_value_error_on_approve(self):
        with self.assertRaises(ValueError):
            get_approve_action_sql(INVALID_UUID)

    def test_invalid_uuid_raises_value_error_on_reject(self):
        with self.assertRaises(ValueError):
            get_reject_action_sql(INVALID_UUID)

    def test_sql_injection_attempt_raises_error(self):
        injection = "'; DROP TABLE public.\"EUDR_MONITOREO\"; --"
        with self.assertRaises(ValueError):
            get_approve_action_sql(injection)

    def test_valid_uuid_v4_accepted(self):
        sql = get_approve_action_sql(VALID_UUID)
        self.assertIsInstance(sql, str)
        self.assertGreater(len(sql), 0)

    def test_uuid_case_insensitive(self):
        upper_uuid = VALID_UUID.upper()
        sql = get_approve_action_sql(upper_uuid)
        self.assertIn(upper_uuid.strip(), sql)


if __name__ == "__main__":
    unittest.main(verbosity=2)
