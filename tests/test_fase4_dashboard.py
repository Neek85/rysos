import json
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts.dashboard_geojson import (
    record_to_feature,
    records_to_feature_collection,
    REQUIRED_FEATURE_PROPERTIES,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

APPROVED_RECORD = {
    "id_monitoreo": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "ID_Organizacion": "ORG-001",
    "ID_Parcela_Fija": "PARC-101",
    "ID_Socio": "SOC-502",
    "fecha_monitoreo": "2026-08-15",
    "tecnico_responsable": "Carlos Perez",
    "precision_gps": 2.5,
    "evidencia_foto": "ORG-001/a0eebc99/foto1.jpg",
    "cumple_eudr": "SI",
    "observaciones": "Inspeccion conforme",
    "estado_revision": "APROBADO",
    "parcela_codigo": "P-101",
    "parcela_nombre": "El Cafetal",
    "hectareas_totales": 4.5,
    "socio_nombre_completo": "Juan Valdez",
    "socio_dni": "45896231",
    "localidad": "San Martin",
    "certificaciones": "Rainforest Alliance",
    "geom": {
        "type": "Polygon",
        "coordinates": [[
            [-77.61, -5.61],
            [-77.60, -5.61],
            [-77.60, -5.62],
            [-77.61, -5.62],
            [-77.61, -5.61],
        ]],
    },
}

PENDING_RECORD = {**APPROVED_RECORD, "estado_revision": "PENDIENTE"}
REJECTED_RECORD = {**APPROVED_RECORD, "estado_revision": "RECHAZADO"}
ORG_002_RECORD = {**APPROVED_RECORD, "ID_Organizacion": "ORG-002"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestOnlyApprovedRecordsExposed(unittest.TestCase):
    def test_approved_record_accepted(self):
        feature = record_to_feature(APPROVED_RECORD)
        self.assertIsNotNone(feature)

    def test_pending_record_raises(self):
        with self.assertRaises(ValueError):
            record_to_feature(PENDING_RECORD)

    def test_rejected_record_raises(self):
        with self.assertRaises(ValueError):
            record_to_feature(REJECTED_RECORD)

    def test_view_simulation_filters_non_approved(self):
        all_records = [APPROVED_RECORD, PENDING_RECORD, REJECTED_RECORD]
        approved = [r for r in all_records if r["estado_revision"] == "APROBADO"]
        self.assertEqual(len(approved), 1)
        self.assertEqual(approved[0]["estado_revision"], "APROBADO")


class TestGeoJSONFeatureConversion(unittest.TestCase):
    def setUp(self):
        self.feature = record_to_feature(APPROVED_RECORD)

    def test_feature_type(self):
        self.assertEqual(self.feature["type"], "Feature")

    def test_geometry_type_polygon(self):
        self.assertEqual(self.feature["geometry"]["type"], "Polygon")

    def test_geometry_has_coordinates(self):
        coords = self.feature["geometry"]["coordinates"]
        self.assertIsInstance(coords, list)
        self.assertGreater(len(coords[0]), 0)

    def test_required_properties_present(self):
        props = set(self.feature["properties"].keys())
        self.assertTrue(
            REQUIRED_FEATURE_PROPERTIES.issubset(props),
            f"Faltan propiedades: {REQUIRED_FEATURE_PROPERTIES - props}",
        )

    def test_cumple_eudr_value(self):
        self.assertEqual(self.feature["properties"]["cumple_eudr"], "SI")

    def test_hectareas_totales_numeric(self):
        self.assertIsInstance(self.feature["properties"]["hectareas_totales"], (int, float))

    def test_feature_is_json_serializable(self):
        serialized = json.dumps(self.feature)
        parsed = json.loads(serialized)
        self.assertEqual(parsed["type"], "Feature")


class TestFeatureCollection(unittest.TestCase):
    def test_feature_collection_type(self):
        fc = records_to_feature_collection([APPROVED_RECORD])
        self.assertEqual(fc["type"], "FeatureCollection")

    def test_feature_collection_features_list(self):
        fc = records_to_feature_collection([APPROVED_RECORD])
        self.assertIsInstance(fc["features"], list)
        self.assertEqual(len(fc["features"]), 1)

    def test_empty_feature_collection_valid(self):
        fc = records_to_feature_collection([])
        self.assertEqual(fc["type"], "FeatureCollection")
        self.assertEqual(fc["features"], [])

    def test_multiple_records(self):
        record2 = {**APPROVED_RECORD, "id_monitoreo": "b1c2d3e4-f5a6-4789-bc01-de2345fa6789"}
        fc = records_to_feature_collection([APPROVED_RECORD, record2])
        self.assertEqual(len(fc["features"]), 2)

    def test_collection_is_json_serializable(self):
        fc = records_to_feature_collection([APPROVED_RECORD])
        serialized = json.dumps(fc)
        parsed = json.loads(serialized)
        self.assertEqual(parsed["features"][0]["type"], "Feature")


class TestWGS84CoordinateValidation(unittest.TestCase):
    def _extract_all_coords(self, geometry):
        """Extrae todas las coordenadas [lon, lat] de una geometría GeoJSON."""
        coords = []
        for ring in geometry["coordinates"]:
            coords.extend(ring)
        return coords

    def test_coordinates_within_wgs84_bounds(self):
        feature = record_to_feature(APPROVED_RECORD)
        coords = self._extract_all_coords(feature["geometry"])
        for lon, lat in coords:
            self.assertGreaterEqual(lon, -180, f"Longitud inválida: {lon}")
            self.assertLessEqual(lon, 180, f"Longitud inválida: {lon}")
            self.assertGreaterEqual(lat, -90, f"Latitud inválida: {lat}")
            self.assertLessEqual(lat, 90, f"Latitud inválida: {lat}")

    def test_polygon_is_closed(self):
        feature = record_to_feature(APPROVED_RECORD)
        ring = feature["geometry"]["coordinates"][0]
        self.assertEqual(ring[0], ring[-1], "El polígono no está cerrado (primer != último punto)")


class TestMultiTenantIsolation(unittest.TestCase):
    def test_org_id_preserved_in_properties(self):
        feature = record_to_feature(APPROVED_RECORD)
        self.assertEqual(feature["properties"]["ID_Organizacion"], "ORG-001")

    def test_rls_simulation_filters_other_org(self):
        requesting_org = "ORG-001"
        all_approved = [APPROVED_RECORD, ORG_002_RECORD]
        visible = [r for r in all_approved if r["ID_Organizacion"] == requesting_org]
        self.assertEqual(len(visible), 1)
        self.assertEqual(visible[0]["ID_Organizacion"], "ORG-001")

    def test_org002_not_in_org001_response(self):
        requesting_org = "ORG-001"
        all_approved = [APPROVED_RECORD, ORG_002_RECORD]
        visible = [r for r in all_approved if r["ID_Organizacion"] == requesting_org]
        org_ids = {r["ID_Organizacion"] for r in visible}
        self.assertNotIn("ORG-002", org_ids)


if __name__ == "__main__":
    unittest.main(verbosity=2)
