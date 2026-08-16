import base64
import json
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts.generate_eudr_dds import EUDRDDSGenerator
from scripts.generate_lot_qr import PublicTraceabilityService, _PII_FIELDS

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

POLYGON_GEOM = {
    "type": "Polygon",
    "coordinates": [[
        [-77.612345, -5.612345],
        [-77.601234, -5.612345],
        [-77.601234, -5.621234],
        [-77.612345, -5.621234],
        [-77.612345, -5.612345],
    ]],
}

APPROVED_RECORD = {
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

SECOND_RECORD = {
    **APPROVED_RECORD,
    "id_monitoreo": "c2ffcd00-1d1c-4fa9-cc7e-7ccace491b33",
    "parcela_codigo": "P-203",
    "hectareas_totales": 3.1,
}


def _build_dds_and_hash(org="ORG-001", records=None):
    if records is None:
        records = [APPROVED_RECORD]
    gen = EUDRDDSGenerator(org)
    svc = PublicTraceabilityService()
    dds = gen.build_traces_payload(records)
    lot_hash = svc.generate_lot_hash(dds)
    return gen, svc, dds, lot_hash


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPIISanitization(unittest.TestCase):
    def setUp(self):
        _, self.svc, self.dds, self.lot_hash = _build_dds_and_hash()
        self.public = self.svc.build_public_sanitized_payload(self.dds, self.lot_hash)
        self.props = self.public["geojson"]["features"][0]["properties"]

    def test_socio_dni_absent(self):
        self.assertNotIn("socio_dni", self.props)

    def test_socio_nombre_absent(self):
        self.assertNotIn("socio_nombre", self.props)

    def test_socio_nombre_completo_absent(self):
        self.assertNotIn("socio_nombre_completo", self.props)

    def test_conyuge_dni_absent(self):
        self.assertNotIn("conyuge_dni", self.props)

    def test_all_pii_fields_excluded(self):
        for field in _PII_FIELDS:
            self.assertNotIn(field, self.props, f"Campo PII encontrado: {field}")

    def test_parcela_codigo_present(self):
        self.assertIn("parcela_codigo", self.props)

    def test_cumple_eudr_present(self):
        self.assertIn("cumple_eudr", self.props)

    def test_deforestation_cutoff_date_present(self):
        self.assertIn("deforestation_cutoff_date", self.props)
        self.assertEqual(self.props["deforestation_cutoff_date"], "2020-12-31")

    def test_hectareas_present(self):
        self.assertIn("hectareas", self.props)


class TestLotHash(unittest.TestCase):
    def setUp(self):
        _, self.svc, self.dds, self.lot_hash = _build_dds_and_hash()

    def test_hash_reproducibility(self):
        hash2 = self.svc.generate_lot_hash(self.dds)
        self.assertEqual(self.lot_hash, hash2)

    def test_hash_length_16(self):
        self.assertEqual(len(self.lot_hash), 16)

    def test_hash_is_valid_hex(self):
        int(self.lot_hash, 16)  # raises ValueError if not hex

    def test_different_org_different_hash(self):
        gen2 = EUDRDDSGenerator("ORG-999")
        rec2 = {**APPROVED_RECORD, "ID_Organizacion": "ORG-999"}
        dds2 = gen2.build_traces_payload([rec2])
        hash2 = self.svc.generate_lot_hash(dds2)
        self.assertNotEqual(self.lot_hash, hash2)

    def test_different_records_different_hash(self):
        _, svc2, dds2, hash2 = _build_dds_and_hash(records=[SECOND_RECORD])
        self.assertNotEqual(self.lot_hash, hash2)

    def test_verification_url_contains_hash(self):
        url = self.svc.get_trace_url(self.lot_hash)
        self.assertIn(self.lot_hash, url)
        self.assertTrue(url.startswith("https://app.ryzos.io/trace/"))


class TestPublicPayloadStructure(unittest.TestCase):
    def setUp(self):
        _, self.svc, self.dds, self.lot_hash = _build_dds_and_hash()
        self.public = self.svc.build_public_sanitized_payload(self.dds, self.lot_hash)

    def test_required_top_level_keys(self):
        for key in ("lot_hash", "verification_url", "regulation", "organization_id",
                    "total_plots", "total_hectares", "geojson"):
            self.assertIn(key, self.public, f"Clave faltante: {key}")

    def test_lot_hash_in_payload(self):
        self.assertEqual(self.public["lot_hash"], self.lot_hash)

    def test_feature_collection_type(self):
        self.assertEqual(self.public["geojson"]["type"], "FeatureCollection")

    def test_geometry_preserved(self):
        geom = self.public["geojson"]["features"][0]["geometry"]
        self.assertIsNotNone(geom)
        self.assertEqual(geom["type"], "Polygon")

    def test_regulation_preserved(self):
        self.assertEqual(self.public["regulation"], "EU 2023/1115")

    def test_payload_is_json_serializable(self):
        serialized = json.dumps(self.public)
        parsed = json.loads(serialized)
        self.assertEqual(parsed["lot_hash"], self.lot_hash)


class TestQRCodeGeneration(unittest.TestCase):
    def setUp(self):
        self.svc = PublicTraceabilityService()
        self.lot_hash = "abc123def456abcd"

    def test_trace_url_format(self):
        url = self.svc.get_trace_url(self.lot_hash)
        self.assertEqual(url, f"https://app.ryzos.io/trace/{self.lot_hash}")

    def test_qr_data_url_prefix(self):
        data_url = self.svc.generate_qr_data_url(self.lot_hash)
        self.assertTrue(data_url.startswith("data:image/png;base64,"))

    def test_qr_data_url_valid_base64(self):
        data_url = self.svc.generate_qr_data_url(self.lot_hash)
        b64_part = data_url.split(",", 1)[1]
        decoded = base64.b64decode(b64_part)
        self.assertGreater(len(decoded), 0)

    def test_qr_png_magic_bytes(self):
        data_url = self.svc.generate_qr_data_url(self.lot_hash)
        b64_part = data_url.split(",", 1)[1]
        decoded = base64.b64decode(b64_part)
        # PNG files start with \x89PNG
        self.assertEqual(decoded[:4], b"\x89PNG")


if __name__ == "__main__":
    unittest.main(verbosity=2)
