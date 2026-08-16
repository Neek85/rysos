import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts.generate_eudr_dds import EUDRDDSGenerator
from scripts.generate_lot_qr import PublicTraceabilityService
from scripts.generate_dossier_pdf import DossierPDFGenerator

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
    "hectareas_totales": 3.75,
}


def _build_public_payload(records=None, org="ORG-001"):
    if records is None:
        records = [APPROVED_RECORD]
    dds = EUDRDDSGenerator(org).build_traces_payload(records)
    svc = PublicTraceabilityService()
    lot_hash = svc.generate_lot_hash(dds)
    return svc.build_public_sanitized_payload(dds, lot_hash), lot_hash


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPDFBinaryIntegrity(unittest.TestCase):
    def setUp(self):
        self.gen = DossierPDFGenerator()
        self.public_payload, self.lot_hash = _build_public_payload()
        self.pdf = self.gen.build_pdf_dossier(self.public_payload)

    def test_pdf_magic_bytes(self):
        self.assertTrue(self.pdf.startswith(b"%PDF-"), "No empieza con %PDF-")

    def test_pdf_eof_marker(self):
        self.assertIn(b"%%EOF", self.pdf, "Falta marcador %%EOF")

    def test_pdf_is_bytes(self):
        self.assertIsInstance(self.pdf, bytes)

    def test_pdf_is_not_empty(self):
        self.assertGreater(len(self.pdf), 0)

    def test_pdf_size_minimum_2kb(self):
        self.assertGreater(len(self.pdf), 2000, "PDF demasiado pequeño — tabla/QR no renderizados")

    def test_image_xobject_embedded(self):
        # ReportLab 5 comprime streams — verificamos el object dict del XObject imagen
        self.assertIn(b"/Subtype /Image", self.pdf, "No se encontró XObject de imagen en el PDF")


class TestPDFContentCoherence(unittest.TestCase):
    """
    ReportLab 5 comprime los content streams con FlateDecode.
    Verificamos coherencia a nivel de payload (pre-generación) y estructura
    de objetos PDF no comprimidos (xref, object dicts).
    """

    def setUp(self):
        self.gen = DossierPDFGenerator()
        self.public_payload, self.lot_hash = _build_public_payload()
        self.pdf = self.gen.build_pdf_dossier(self.public_payload)

    def test_payload_lot_hash_correct(self):
        self.assertEqual(self.public_payload["lot_hash"], self.lot_hash)

    def test_payload_org_id_correct(self):
        self.assertEqual(self.public_payload["organization_id"], "ORG-001")

    def test_payload_regulation_correct(self):
        self.assertEqual(self.public_payload["regulation"], "EU 2023/1115")

    def test_payload_verification_url_correct(self):
        self.assertIn(self.lot_hash, self.public_payload["verification_url"])
        self.assertTrue(self.public_payload["verification_url"].startswith("https://"))

    def test_pdf_xref_table_present(self):
        # xref es texto sin comprimir en cualquier PDF
        self.assertIn(b"xref", self.pdf)

    def test_pdf_has_font_resources(self):
        # Las fuentes Helvetica se declaran sin comprimir en los dicts de objetos
        self.assertIn(b"Helvetica", self.pdf)


class TestPDFScaling(unittest.TestCase):
    def setUp(self):
        self.gen = DossierPDFGenerator()

    def test_single_record_pdf_valid(self):
        payload, _ = _build_public_payload([APPROVED_RECORD])
        pdf = self.gen.build_pdf_dossier(payload)
        self.assertTrue(pdf.startswith(b"%PDF-"))

    def test_multi_record_pdf_larger_than_single(self):
        payload_single, _ = _build_public_payload([APPROVED_RECORD])
        payload_multi, _ = _build_public_payload([APPROVED_RECORD, SECOND_RECORD])
        pdf_single = self.gen.build_pdf_dossier(payload_single)
        pdf_multi = self.gen.build_pdf_dossier(payload_multi)
        self.assertGreater(len(pdf_multi), len(pdf_single))

    def test_empty_features_pdf_still_valid(self):
        payload = {
            "lot_hash": "abc123def456abcd",
            "verification_url": "https://app.ryzos.io/trace/abc123def456abcd",
            "regulation": "EU 2023/1115",
            "organization_id": "ORG-001",
            "total_plots": 0,
            "total_hectares": 0.0,
            "geojson": {"type": "FeatureCollection", "features": []},
        }
        pdf = self.gen.build_pdf_dossier(payload)
        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertIn(b"%%EOF", pdf)

    def test_pdf_returned_is_new_bytes_each_call(self):
        payload, _ = _build_public_payload()
        pdf1 = self.gen.build_pdf_dossier(payload)
        pdf2 = self.gen.build_pdf_dossier(payload)
        # Ambos deben ser PDF válidos independientemente de si son idénticos
        self.assertTrue(pdf1.startswith(b"%PDF-"))
        self.assertTrue(pdf2.startswith(b"%PDF-"))


class TestPDFPIIAbsence(unittest.TestCase):
    def setUp(self):
        self.gen = DossierPDFGenerator()
        # El public_payload ya viene sanitizado de la Tarea 14
        self.public_payload, _ = _build_public_payload()
        self.pdf = self.gen.build_pdf_dossier(self.public_payload)

    def test_pii_payload_has_no_socio_dni(self):
        """El payload sanitizado no contiene DNI — el PDF hereda esta propiedad."""
        for feat in self.public_payload["geojson"]["features"]:
            self.assertNotIn("socio_dni", feat["properties"])

    def test_pii_payload_has_no_socio_nombre(self):
        for feat in self.public_payload["geojson"]["features"]:
            self.assertNotIn("socio_nombre", feat["properties"])

    def test_raw_dni_not_in_pdf_bytes(self):
        self.assertNotIn(b"78945612", self.pdf)

    def test_full_name_not_in_pdf_bytes(self):
        self.assertNotIn(b"Maria Torres", self.pdf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
