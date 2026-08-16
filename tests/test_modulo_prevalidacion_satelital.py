import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shapely.geometry import Polygon, mapping
from scripts.satellite_prevalidation import SatellitePrevalidationEngine

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

PLOT_POLY = Polygon([(0, 0), (100, 0), (100, 100), (0, 100)])

PLOT_FEATURE = {
    "id": "PARC-101",
    "properties": {"ID_Parcela_Fija": "PARC-101", "ID_Organizacion": "ORG-001"},
    "geom": mapping(PLOT_POLY),
}

PLOT_FEATURE_ORG2 = {
    "id": "PARC-202",
    "properties": {"ID_Parcela_Fija": "PARC-202", "ID_Organizacion": "ORG-002"},
    "geom": mapping(PLOT_POLY),
}

# Loss events
LOSS_2018 = {"geom": mapping(Polygon([(10, 10), (30, 10), (30, 30), (10, 30)])), "year": 2018}
LOSS_2020 = {"geom": mapping(Polygon([(10, 10), (30, 10), (30, 30), (10, 30)])), "year": 2020}
LOSS_2021 = {"geom": mapping(Polygon([(10, 10), (30, 10), (30, 30), (10, 30)])), "year": 2021}
LOSS_2022 = {"geom": mapping(Polygon([(40, 40), (60, 40), (60, 60), (40, 60)])), "year": 2022}
LOSS_OUTSIDE = {"geom": mapping(Polygon([(200, 200), (300, 200), (300, 300), (200, 300)])), "year": 2022}

# ANP
ANP_CUTERVO = {
    "geom": mapping(Polygon([(50, 0), (150, 0), (150, 100), (50, 100)])),
    "nombre": "Parque Nacional Cutervo",
}
ANP_OUTSIDE = {
    "geom": mapping(Polygon([(500, 500), (600, 500), (600, 600), (500, 600)])),
    "nombre": "ANP Lejana",
}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestCleanPlot(unittest.TestCase):
    def setUp(self):
        self.e = SatellitePrevalidationEngine()
        self.res = self.e.evaluate_plot(PLOT_FEATURE, [], [])

    def test_clean_plot_cumple_si(self):
        self.assertEqual(self.res["cumple_eudr"], "SI")

    def test_clean_plot_risk_bajo(self):
        self.assertEqual(self.res["nivel_riesgo"], "BAJO")

    def test_clean_plot_no_deforestation_alert(self):
        self.assertFalse(self.res["alerta_deforestacion"])

    def test_clean_plot_no_anp_alert(self):
        self.assertFalse(self.res["alerta_anp"])

    def test_clean_plot_zero_deforested_area(self):
        self.assertEqual(self.res["deforested_area_post2020_m2"], 0.0)

    def test_clean_plot_parcela_id(self):
        self.assertEqual(self.res["parcela_id"], "PARC-101")


class TestHistoricalDeforestation(unittest.TestCase):
    def setUp(self):
        self.e = SatellitePrevalidationEngine()

    def test_pre2020_compliant(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2018], [])
        self.assertEqual(res["cumple_eudr"], "SI")

    def test_pre2020_risk_bajo(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2018], [])
        self.assertEqual(res["nivel_riesgo"], "BAJO")

    def test_pre2020_flag_set(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2018], [])
        self.assertTrue(res["deforestacion_historica_pre2020"])

    def test_pre2020_no_deforestation_alert(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2018], [])
        self.assertFalse(res["alerta_deforestacion"])

    def test_cutoff_year_2020_is_compliant(self):
        # Año exacto del corte (31/12/2020) → conforme
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2020], [])
        self.assertEqual(res["cumple_eudr"], "SI")
        self.assertFalse(res["alerta_deforestacion"])


class TestPostCutoffDeforestation(unittest.TestCase):
    def setUp(self):
        self.e = SatellitePrevalidationEngine()

    def test_post2020_non_compliant(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2021], [])
        self.assertEqual(res["cumple_eudr"], "NO")

    def test_post2020_risk_alto(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2021], [])
        self.assertEqual(res["nivel_riesgo"], "ALTO")

    def test_post2020_deforestation_flag(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2021], [])
        self.assertTrue(res["alerta_deforestacion"])

    def test_post2020_area_positive(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2021], [])
        self.assertGreater(res["deforested_area_post2020_m2"], 0.0)

    def test_multiple_post2020_events_area_accumulated(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2021, LOSS_2022], [])
        area_single = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2021], [])["deforested_area_post2020_m2"]
        self.assertGreater(res["deforested_area_post2020_m2"], area_single)

    def test_outside_plot_loss_ignored(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_OUTSIDE], [])
        self.assertEqual(res["cumple_eudr"], "SI")
        self.assertFalse(res["alerta_deforestacion"])


class TestANPConflict(unittest.TestCase):
    def setUp(self):
        self.e = SatellitePrevalidationEngine()

    def test_anp_critical_risk(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [], [ANP_CUTERVO])
        self.assertEqual(res["nivel_riesgo"], "CRITICO")

    def test_anp_cumple_no(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [], [ANP_CUTERVO])
        self.assertEqual(res["cumple_eudr"], "NO")

    def test_anp_flag(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [], [ANP_CUTERVO])
        self.assertTrue(res["alerta_anp"])

    def test_anp_name_in_result(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [], [ANP_CUTERVO])
        self.assertIn("Parque Nacional Cutervo", res["anp_nombres"])

    def test_anp_priority_over_post2020_deforestation(self):
        # Ambos: ANP + deforestación post-2020 → nivel debe ser CRITICO, no ALTO
        res = self.e.evaluate_plot(PLOT_FEATURE, [LOSS_2022], [ANP_CUTERVO])
        self.assertEqual(res["nivel_riesgo"], "CRITICO")
        self.assertTrue(res["alerta_deforestacion"])
        self.assertTrue(res["alerta_anp"])

    def test_disjoint_anp_ignored(self):
        res = self.e.evaluate_plot(PLOT_FEATURE, [], [ANP_OUTSIDE])
        self.assertFalse(res["alerta_anp"])
        self.assertEqual(res["nivel_riesgo"], "BAJO")


class TestBatchAndMultiTenant(unittest.TestCase):
    def setUp(self):
        self.e = SatellitePrevalidationEngine()

    def test_batch_processes_all_same_org(self):
        plots = [PLOT_FEATURE, PLOT_FEATURE]
        results = self.e.evaluate_batch(plots, [], [], org_id="ORG-001")
        self.assertEqual(len(results), 2)

    def test_batch_filters_other_org(self):
        plots = [PLOT_FEATURE, PLOT_FEATURE_ORG2]
        results = self.e.evaluate_batch(plots, [], [], org_id="ORG-001")
        self.assertEqual(len(results), 1)

    def test_batch_empty_plots(self):
        results = self.e.evaluate_batch([], [LOSS_2022], [ANP_CUTERVO], org_id="ORG-001")
        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
