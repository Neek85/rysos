import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shapely.geometry import Polygon, mapping, LineString
from shapely.geometry import shape as shapely_shape
from scripts.detect_overlaps import TopologicalOverlapDetector, TOLERANCE_PERCENTAGE

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
# poly_a: cuadrado 100x100 → área = 10 000
POLY_A = Polygon([(0, 0), (100, 0), (100, 100), (0, 100)])

# poly_micro_b: overlap con poly_a de 0.4×100=40 → pct_a=0.4% < 0.5% (MINOR)
POLY_MICRO_B = Polygon([(99.6, 0), (200, 0), (200, 100), (99.6, 100)])

# poly_macro_c: overlap con poly_a de 10×100=1000 → pct_a=10% ≥ 0.5% (MACRO)
POLY_MACRO_C = Polygon([(90, 0), (200, 0), (200, 100), (90, 100)])

# poly_disjoint: completamente separado de poly_a
POLY_FAR = Polygon([(300, 0), (400, 0), (400, 100), (300, 100)])

# poly_touching: comparte solo el borde x=100 con poly_a (área de intersección = 0)
POLY_TOUCH = Polygon([(100, 0), (200, 0), (200, 100), (100, 100)])


def _feat(poly, fid="PARC-X", org="ORG-001"):
    return {"id": fid, "ID_Organizacion": org, "geom": mapping(poly)}


FEAT_A = _feat(POLY_A, "PARC-001")
FEAT_MICRO_B = _feat(POLY_MICRO_B, "PARC-002")
FEAT_MACRO_C = _feat(POLY_MACRO_C, "PARC-003")
FEAT_FAR = _feat(POLY_FAR, "PARC-FAR")
FEAT_TOUCH = _feat(POLY_TOUCH, "PARC-TOUCH")
FEAT_ORG2 = _feat(POLY_MICRO_B, "PARC-ORG2", org="ORG-002")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestOverlapDetection(unittest.TestCase):
    def setUp(self):
        self.d = TopologicalOverlapDetector()

    def test_no_overlap_disjoint_polygons(self):
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_FAR)
        self.assertFalse(res["has_overlap"])

    def test_no_overlap_touching_polygons(self):
        # Comparten el borde x=100 — área de intersección = 0
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_TOUCH)
        self.assertFalse(res["has_overlap"])

    def test_minor_overlap_detected(self):
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_MICRO_B)
        self.assertTrue(res["has_overlap"])

    def test_minor_overlap_is_minor(self):
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_MICRO_B)
        self.assertTrue(res["is_minor"])

    def test_minor_overlap_no_manual_review(self):
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_MICRO_B)
        self.assertFalse(res["requires_manual_review"])

    def test_minor_overlap_pct_below_tolerance(self):
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_MICRO_B)
        self.assertLess(res["pct_overlap_a"], TOLERANCE_PERCENTAGE)

    def test_macro_overlap_detected(self):
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_MACRO_C)
        self.assertTrue(res["has_overlap"])

    def test_macro_overlap_is_not_minor(self):
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_MACRO_C)
        self.assertFalse(res["is_minor"])

    def test_macro_overlap_requires_manual_review(self):
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_MACRO_C)
        self.assertTrue(res["requires_manual_review"])

    def test_macro_overlap_pct_above_tolerance(self):
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_MACRO_C)
        self.assertGreaterEqual(res["pct_overlap_a"], TOLERANCE_PERCENTAGE)

    def test_overlap_area_is_positive(self):
        res = self.d.analyze_pair_overlap(FEAT_A, FEAT_MICRO_B)
        self.assertGreater(res["overlap_area"], 0.0)

    def test_identical_polygons_100pct_overlap(self):
        feat_copy = _feat(POLY_A, "PARC-COPY")
        res = self.d.analyze_pair_overlap(FEAT_A, feat_copy)
        self.assertTrue(res["has_overlap"])
        self.assertAlmostEqual(res["pct_overlap_a"], 100.0, places=2)
        self.assertTrue(res["requires_manual_review"])


class TestGeometryCorrection(unittest.TestCase):
    def setUp(self):
        self.d = TopologicalOverlapDetector()
        self.cleaned = self.d.resolve_minor_overlap(FEAT_A, FEAT_MICRO_B)

    def test_cleaned_topologically_flag(self):
        self.assertTrue(self.cleaned.get("cleaned_topologically"))

    def test_cleaned_returns_dict(self):
        self.assertIsInstance(self.cleaned, dict)

    def test_cleaned_geometry_is_valid(self):
        geom = shapely_shape(self.cleaned["geom"])
        self.assertTrue(geom.is_valid)

    def test_cleaned_geometry_smaller_than_original(self):
        original_area = POLY_MICRO_B.area
        cleaned_area = shapely_shape(self.cleaned["geom"]).area
        self.assertLess(cleaned_area, original_area)

    def test_cleaned_geometry_no_residual_overlap(self):
        cleaned_geom = shapely_shape(self.cleaned["geom"])
        base_geom = shapely_shape(FEAT_A["geom"])
        residual_area = cleaned_geom.intersection(base_geom).area
        self.assertAlmostEqual(residual_area, 0.0, places=8)

    def test_base_feature_not_modified(self):
        # La geometría base no debe cambiar tras la corrección
        base_after = shapely_shape(FEAT_A["geom"])
        self.assertAlmostEqual(base_after.area, POLY_A.area, places=6)


class TestOrganizationIsolation(unittest.TestCase):
    def setUp(self):
        self.d = TopologicalOverlapDetector()

    def test_check_overlaps_different_orgs_ignored(self):
        # FEAT_MICRO_B (ORG-001) vs FEAT_ORG2 (ORG-002) → no deben compararse
        results = self.d.check_overlaps_for_organization([FEAT_A, FEAT_ORG2])
        self.assertEqual(len(results), 0)

    def test_check_overlaps_same_org_detected(self):
        results = self.d.check_overlaps_for_organization([FEAT_A, FEAT_MICRO_B])
        self.assertEqual(len(results), 1)

    def test_check_overlaps_empty_records(self):
        results = self.d.check_overlaps_for_organization([])
        self.assertEqual(results, [])

    def test_check_overlaps_single_record(self):
        results = self.d.check_overlaps_for_organization([FEAT_A])
        self.assertEqual(results, [])

    def test_check_overlaps_result_has_ids(self):
        results = self.d.check_overlaps_for_organization([FEAT_A, FEAT_MICRO_B])
        self.assertIn("id_a", results[0])
        self.assertIn("id_b", results[0])

    def test_check_overlaps_three_records_two_pairs(self):
        # poly_micro_b y poly_macro_c también se solapan con poly_a
        results = self.d.check_overlaps_for_organization([FEAT_A, FEAT_MICRO_B, FEAT_MACRO_C])
        self.assertGreaterEqual(len(results), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
