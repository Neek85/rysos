"""
Suite de tests — Opción C: Motor de Evaluación de Riesgo y Legalidad EUDR (Arts. 10 & 11).
"""

import unittest

from scripts.evaluate_legal_risk import (
    ComplianceStatus,
    DueDiligenceType,
    LegalRiskEvaluator,
    RiskLevel,
)


def _make_record(**kwargs):
    base = {
        "id_monitoreo": "550e8400-e29b-41d4-a716-446655440001",
        "parcela_codigo": "LOT-TEST-001",
        "ID_Organizacion": "org-001",
        "pais_origen": "PE",
        "tiene_titulo_propiedad": True,
        "fecha_titulo": "2018-06-01",
        "tiene_permiso_ambiental": True,
        "fecha_ultimo_uso_suelo": "2019-09-15",
        "distancia_anp_km": 10.0,
    }
    base.update(kwargs)
    return base


class TestCountryRiskClassification(unittest.TestCase):

    def setUp(self):
        self.evaluator = LegalRiskEvaluator()

    def test_eu_country_is_negligible(self):
        self.assertEqual(self.evaluator._get_country_risk_level("DE"), RiskLevel.NEGLIGIBLE)

    def test_usa_is_negligible(self):
        self.assertEqual(self.evaluator._get_country_risk_level("US"), RiskLevel.NEGLIGIBLE)

    def test_peru_is_standard(self):
        self.assertEqual(self.evaluator._get_country_risk_level("PE"), RiskLevel.STANDARD)

    def test_brazil_is_high(self):
        self.assertEqual(self.evaluator._get_country_risk_level("BR"), RiskLevel.HIGH)

    def test_indonesia_is_high(self):
        self.assertEqual(self.evaluator._get_country_risk_level("ID"), RiskLevel.HIGH)

    def test_unknown_country_is_standard(self):
        self.assertEqual(self.evaluator._get_country_risk_level("XX"), RiskLevel.STANDARD)

    def test_empty_country_defaults_standard(self):
        self.assertEqual(self.evaluator._get_country_risk_level(""), RiskLevel.STANDARD)


class TestLandTitleEvaluation(unittest.TestCase):

    def setUp(self):
        self.evaluator = LegalRiskEvaluator()

    def test_no_title_non_compliant_zero_score(self):
        finding = self.evaluator._evaluate_land_title({"tiene_titulo_propiedad": False})
        self.assertEqual(finding.status, ComplianceStatus.NON_COMPLIANT)
        self.assertEqual(finding.score, 0)
        self.assertEqual(finding.max_score, 25)

    def test_title_without_date_scores_20(self):
        finding = self.evaluator._evaluate_land_title({"tiene_titulo_propiedad": True})
        self.assertEqual(finding.status, ComplianceStatus.COMPLIANT)
        self.assertEqual(finding.score, 20)

    def test_title_with_date_before_cutoff_scores_25(self):
        finding = self.evaluator._evaluate_land_title(
            {"tiene_titulo_propiedad": True, "fecha_titulo": "2015-03-01"}
        )
        self.assertEqual(finding.score, 25)

    def test_title_with_date_after_cutoff_scores_20(self):
        finding = self.evaluator._evaluate_land_title(
            {"tiene_titulo_propiedad": True, "fecha_titulo": "2022-01-01"}
        )
        self.assertEqual(finding.score, 20)


class TestEnvironmentalEvaluation(unittest.TestCase):

    def setUp(self):
        self.evaluator = LegalRiskEvaluator()

    def test_no_permit_non_compliant(self):
        finding = self.evaluator._evaluate_environmental({"tiene_permiso_ambiental": False})
        self.assertEqual(finding.status, ComplianceStatus.NON_COMPLIANT)
        self.assertEqual(finding.score, 0)

    def test_has_permit_compliant_full_score(self):
        finding = self.evaluator._evaluate_environmental(
            {"tiene_permiso_ambiental": True, "fecha_permiso_ambiental": "2020-01-15"}
        )
        self.assertEqual(finding.status, ComplianceStatus.COMPLIANT)
        self.assertEqual(finding.score, 20)
        self.assertEqual(finding.max_score, 20)


class TestDeforestationCutoff(unittest.TestCase):

    def setUp(self):
        self.evaluator = LegalRiskEvaluator()

    def test_land_use_before_cutoff_compliant(self):
        finding = self.evaluator._evaluate_deforestation_cutoff(
            {"fecha_ultimo_uso_suelo": "2019-06-01"}
        )
        self.assertEqual(finding.status, ComplianceStatus.COMPLIANT)
        self.assertEqual(finding.score, 30)

    def test_land_use_on_cutoff_date_compliant(self):
        finding = self.evaluator._evaluate_deforestation_cutoff(
            {"fecha_ultimo_uso_suelo": "2020-12-31"}
        )
        self.assertEqual(finding.status, ComplianceStatus.COMPLIANT)

    def test_land_use_after_cutoff_non_compliant(self):
        finding = self.evaluator._evaluate_deforestation_cutoff(
            {"fecha_ultimo_uso_suelo": "2021-03-15"}
        )
        self.assertEqual(finding.status, ComplianceStatus.NON_COMPLIANT)
        self.assertEqual(finding.score, 0)

    def test_no_date_cumple_eudr_true_compliant(self):
        finding = self.evaluator._evaluate_deforestation_cutoff({"cumple_eudr": True})
        self.assertEqual(finding.status, ComplianceStatus.COMPLIANT)
        self.assertEqual(finding.score, 30)

    def test_no_date_cumple_eudr_false_non_compliant(self):
        finding = self.evaluator._evaluate_deforestation_cutoff({"cumple_eudr": False})
        self.assertEqual(finding.status, ComplianceStatus.NON_COMPLIANT)

    def test_no_date_no_eudr_field_insufficient_data(self):
        finding = self.evaluator._evaluate_deforestation_cutoff({})
        self.assertEqual(finding.status, ComplianceStatus.INSUFFICIENT_DATA)
        self.assertEqual(finding.score, 0)

    def test_invalid_date_format_insufficient_data(self):
        finding = self.evaluator._evaluate_deforestation_cutoff(
            {"fecha_ultimo_uso_suelo": "not-a-date"}
        )
        self.assertEqual(finding.status, ComplianceStatus.INSUFFICIENT_DATA)


class TestProtectedAreaEvaluation(unittest.TestCase):

    def setUp(self):
        self.evaluator = LegalRiskEvaluator()

    def test_no_anp_nearby_full_score(self):
        finding = self.evaluator._evaluate_protected_area({"distancia_anp_km": None})
        self.assertEqual(finding.status, ComplianceStatus.COMPLIANT)
        self.assertEqual(finding.score, 15)

    def test_far_from_anp_full_score(self):
        finding = self.evaluator._evaluate_protected_area({"distancia_anp_km": 12.0})
        self.assertEqual(finding.score, 15)

    def test_exactly_at_minimum_distance_full_score(self):
        finding = self.evaluator._evaluate_protected_area({"distancia_anp_km": 5.0})
        self.assertEqual(finding.score, 15)

    def test_buffer_zone_partial_score(self):
        finding = self.evaluator._evaluate_protected_area({"distancia_anp_km": 2.5})
        self.assertEqual(finding.status, ComplianceStatus.NON_COMPLIANT)
        self.assertEqual(finding.score, 7)

    def test_within_anp_zero_score(self):
        finding = self.evaluator._evaluate_protected_area({"distancia_anp_km": 0.3})
        self.assertEqual(finding.status, ComplianceStatus.NON_COMPLIANT)
        self.assertEqual(finding.score, 0)

    def test_invalid_distance_insufficient_data(self):
        finding = self.evaluator._evaluate_protected_area({"distancia_anp_km": "cerca"})
        self.assertEqual(finding.status, ComplianceStatus.INSUFFICIENT_DATA)


class TestOverallRiskEvaluation(unittest.TestCase):

    def setUp(self):
        self.evaluator = LegalRiskEvaluator()

    def test_fully_compliant_eu_country_negligible_art10(self):
        record = _make_record(pais_origen="DE", fecha_titulo="2015-01-01")
        report = self.evaluator.evaluate_record(record)
        self.assertEqual(report.risk_level, RiskLevel.NEGLIGIBLE)
        self.assertEqual(report.due_diligence_type, DueDiligenceType.SIMPLIFIED)
        self.assertEqual(report.article_applicable, 10)

    def test_fully_compliant_peru_negligible_score_but_full_dd(self):
        record = _make_record(pais_origen="PE", fecha_titulo="2015-01-01")
        report = self.evaluator.evaluate_record(record)
        # Score ≥ 0.80 pero país STANDARD → Art. 11
        self.assertEqual(report.due_diligence_type, DueDiligenceType.FULL)
        self.assertEqual(report.article_applicable, 11)

    def test_no_title_no_permit_high_risk(self):
        record = _make_record(
            tiene_titulo_propiedad=False,
            tiene_permiso_ambiental=False,
            fecha_ultimo_uso_suelo="2022-01-01",
        )
        report = self.evaluator.evaluate_record(record)
        self.assertEqual(report.risk_level, RiskLevel.HIGH)
        self.assertEqual(report.due_diligence_type, DueDiligenceType.FULL)

    def test_partial_compliance_standard_risk(self):
        record = _make_record(
            tiene_titulo_propiedad=False,
            fecha_ultimo_uso_suelo="2019-01-01",
            distancia_anp_km=8.0,
        )
        report = self.evaluator.evaluate_record(record)
        self.assertIn(report.risk_level, (RiskLevel.STANDARD, RiskLevel.HIGH))
        self.assertEqual(report.article_applicable, 11)


class TestHighRiskCountryOverride(unittest.TestCase):

    def setUp(self):
        self.evaluator = LegalRiskEvaluator()

    def test_high_risk_country_cannot_be_negligible(self):
        record = _make_record(
            pais_origen="BR",
            fecha_titulo="2015-01-01",
            distancia_anp_km=20.0,
        )
        report = self.evaluator.evaluate_record(record)
        self.assertNotEqual(report.risk_level, RiskLevel.NEGLIGIBLE)

    def test_high_risk_country_always_full_dd(self):
        record = _make_record(pais_origen="BR", fecha_titulo="2015-01-01")
        report = self.evaluator.evaluate_record(record)
        self.assertEqual(report.due_diligence_type, DueDiligenceType.FULL)
        self.assertEqual(report.article_applicable, 11)


class TestComplianceScoreAndGaps(unittest.TestCase):

    def setUp(self):
        self.evaluator = LegalRiskEvaluator()

    def test_max_points_always_100(self):
        report = self.evaluator.evaluate_record(_make_record())
        self.assertEqual(report.max_points, MAX_POINTS := 100)

    def test_total_points_equals_sum_of_finding_scores(self):
        report = self.evaluator.evaluate_record(_make_record())
        expected = sum(f.score for f in report.findings)
        self.assertEqual(report.total_points, expected)

    def test_compliance_score_range(self):
        report = self.evaluator.evaluate_record(_make_record())
        self.assertGreaterEqual(report.compliance_score, 0.0)
        self.assertLessEqual(report.compliance_score, 1.0)

    def test_no_gaps_for_fully_compliant_record(self):
        record = _make_record(pais_origen="DE", fecha_titulo="2015-01-01")
        report = self.evaluator.evaluate_record(record)
        self.assertEqual(len(report.gaps), 0)

    def test_gaps_collected_for_non_compliant_findings(self):
        record = _make_record(
            tiene_titulo_propiedad=False,
            tiene_permiso_ambiental=False,
        )
        report = self.evaluator.evaluate_record(record)
        self.assertGreaterEqual(len(report.gaps), 2)

    def test_recommendation_contains_article_reference(self):
        report = self.evaluator.evaluate_record(_make_record())
        self.assertIn("Art.", report.recommendation)


class TestBatchEvaluation(unittest.TestCase):

    def setUp(self):
        self.evaluator = LegalRiskEvaluator()
        self.records = [
            _make_record(id_monitoreo="uuid-1", parcela_codigo="LOT-A", ID_Organizacion="org-001"),
            _make_record(id_monitoreo="uuid-2", parcela_codigo="LOT-B", ID_Organizacion="org-001"),
            _make_record(id_monitoreo="uuid-3", parcela_codigo="LOT-C", ID_Organizacion="org-002"),
        ]

    def test_batch_without_filter_returns_all(self):
        reports = self.evaluator.evaluate_batch(self.records)
        self.assertEqual(len(reports), 3)

    def test_batch_filters_by_org_id(self):
        reports = self.evaluator.evaluate_batch(self.records, org_id="org-001")
        self.assertEqual(len(reports), 2)
        self.assertTrue(all(r.ID_Organizacion == "org-001" for r in reports))

    def test_batch_other_org_excluded(self):
        reports = self.evaluator.evaluate_batch(self.records, org_id="org-002")
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0].parcela_codigo, "LOT-C")

    def test_batch_empty_input_returns_empty(self):
        reports = self.evaluator.evaluate_batch([], org_id="org-001")
        self.assertEqual(reports, [])

    def test_batch_all_reports_have_findings(self):
        reports = self.evaluator.evaluate_batch(self.records)
        for report in reports:
            self.assertEqual(len(report.findings), 5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
