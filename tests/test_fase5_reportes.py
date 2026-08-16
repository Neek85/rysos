import json
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts.generate_eudr_dds import EUDRDDSGenerator

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

POLYGON_GEOM = {
    "type": "Polygon",
    "coordinates": [[
        [-77.61234567, -5.61234567],
        [-77.60123456, -5.61234567],
        [-77.60123456, -5.62123456],
        [-77.61234567, -5.62123456],
        [-77.61234567, -5.61234567],
    ]],
}

POINT_GEOM = {"type": "Point", "coordinates": [-77.61234567, -5.61234567]}

BASE_RECORD = {
    "id_monitoreo": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
    "ID_Organizacion": "ORG-001",
    "ID_Parcela_Fija": "PARC-202",
    "ID_Socio": "SOC-808",
    "estado_revision": "APROBADO",
    "parcela_codigo": "P-202",
    "parcela_nombre": "La Finca El Sol",
    "hectareas_totales": 5.25,
    "socio_nombre_completo": "Maria Torres",
    "socio_dni": "78945612",
    "cumple_eudr": "SI",
    "geom": POLYGON_GEOM,
}

SMALL_PARCEL_RECORD = {
    **BASE_RECORD,
    "id_monitoreo": "c2ffcd00-1d1c-4fa9-cc7e-7ccace491b33",
    "hectareas_totales": 2.0,
    "geom": POINT_GEOM,
}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestDDSPayloadStructure(unittest.TestCase):
    def setUp(self):
        self.gen = EUDRDDSGenerator("ORG-001")

    def test_declaration_type(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        self.assertEqual(p["declaration_type"], "DUE_DILIGENCE_STATEMENT")

    def test_regulation_field(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        self.assertEqual(p["regulation"], "EU 2023/1115")

    def test_organization_id_field(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        self.assertEqual(p["organization_id"], "ORG-001")

    def test_total_plots_count(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        self.assertEqual(p["total_plots"], 1)

    def test_total_hectares_value(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        self.assertEqual(p["total_hectares"], 5.25)

    def test_total_hectares_sum_multiple(self):
        p = self.gen.build_traces_payload([BASE_RECORD, SMALL_PARCEL_RECORD])
        self.assertAlmostEqual(p["total_hectares"], 7.25, places=4)

    def test_geojson_feature_collection_type(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        self.assertEqual(p["geojson"]["type"], "FeatureCollection")

    def test_empty_records_returns_valid_payload(self):
        p = self.gen.build_traces_payload([])
        self.assertEqual(p["total_plots"], 0)
        self.assertEqual(p["geojson"]["features"], [])

    def test_payload_is_json_serializable(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        serialized = json.dumps(p)
        parsed = json.loads(serialized)
        self.assertEqual(parsed["declaration_type"], "DUE_DILIGENCE_STATEMENT")

    def test_to_json_method_returns_string(self):
        result = self.gen.to_json([BASE_RECORD])
        self.assertIsInstance(result, str)
        self.assertIn("DUE_DILIGENCE_STATEMENT", result)


class TestCoordinatePrecision(unittest.TestCase):
    def setUp(self):
        self.gen = EUDRDDSGenerator("ORG-001")

    def test_polygon_coords_rounded_to_6_decimals(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        first_coord = p["geojson"]["features"][0]["geometry"]["coordinates"][0][0]
        self.assertEqual(first_coord[0], -77.612346)
        self.assertEqual(first_coord[1], -5.612346)

    def test_point_coords_rounded_to_6_decimals(self):
        p = self.gen.build_traces_payload([SMALL_PARCEL_RECORD])
        coord = p["geojson"]["features"][0]["geometry"]["coordinates"]
        self.assertEqual(coord[0], -77.612346)
        self.assertEqual(coord[1], -5.612346)

    def test_all_polygon_ring_coords_have_6_decimals(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        ring = p["geojson"]["features"][0]["geometry"]["coordinates"][0]
        for lon, lat in ring:
            self.assertLessEqual(len(str(lon).split(".")[-1]), 6)
            self.assertLessEqual(len(str(lat).split(".")[-1]), 6)

    def test_no_geom_handled_gracefully(self):
        record = {**BASE_RECORD, "geom": None, "hectareas_totales": 1.0}
        p = self.gen.build_traces_payload([record])
        self.assertIsNone(p["geojson"]["features"][0]["geometry"])


class TestEUDRBusinessRules(unittest.TestCase):
    def setUp(self):
        self.gen = EUDRDDSGenerator("ORG-001")

    def test_cutoff_date_in_each_feature(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        props = p["geojson"]["features"][0]["properties"]
        self.assertEqual(props["deforestation_cutoff_date"], "2020-12-31")

    def test_large_parcel_must_be_polygon(self):
        invalid = {**BASE_RECORD, "geom": POINT_GEOM, "hectareas_totales": 5.0}
        with self.assertRaises(ValueError) as ctx:
            self.gen.build_traces_payload([invalid])
        self.assertIn("Polygon", str(ctx.exception))

    def test_small_parcel_accepts_point(self):
        p = self.gen.build_traces_payload([SMALL_PARCEL_RECORD])
        self.assertEqual(p["geojson"]["features"][0]["geometry"]["type"], "Point")

    def test_cumple_eudr_in_feature_properties(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        self.assertEqual(p["geojson"]["features"][0]["properties"]["cumple_eudr"], "SI")

    def test_hectares_rounded_to_4_decimals_in_properties(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        h = p["geojson"]["features"][0]["properties"]["hectareas"]
        self.assertEqual(h, 5.25)


class TestApprovalEnforcement(unittest.TestCase):
    def setUp(self):
        self.gen = EUDRDDSGenerator("ORG-001")

    def test_pending_record_raises_value_error(self):
        record = {**BASE_RECORD, "estado_revision": "PENDIENTE"}
        with self.assertRaises(ValueError):
            self.gen.build_traces_payload([record])

    def test_rejected_record_raises_value_error(self):
        record = {**BASE_RECORD, "estado_revision": "RECHAZADO"}
        with self.assertRaises(ValueError):
            self.gen.build_traces_payload([record])

    def test_mixed_batch_raises_on_first_non_approved(self):
        pending = {**BASE_RECORD, "estado_revision": "PENDIENTE"}
        with self.assertRaises(ValueError):
            self.gen.build_traces_payload([BASE_RECORD, pending])


class TestMultiTenantIsolation(unittest.TestCase):
    def setUp(self):
        self.gen = EUDRDDSGenerator("ORG-001")

    def test_other_org_record_raises_value_error(self):
        record = {**BASE_RECORD, "ID_Organizacion": "ORG-999"}
        with self.assertRaises(ValueError) as ctx:
            self.gen.build_traces_payload([record])
        self.assertIn("Multi-Tenant", str(ctx.exception))

    def test_correct_org_record_accepted(self):
        p = self.gen.build_traces_payload([BASE_RECORD])
        self.assertEqual(p["organization_id"], "ORG-001")

    def test_generator_org_id_stored(self):
        gen = EUDRDDSGenerator("ORG-XYZ")
        self.assertEqual(gen.organization_id, "ORG-XYZ")


if __name__ == "__main__":
    unittest.main(verbosity=2)
