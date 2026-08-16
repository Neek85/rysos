"""
Motor de Evaluación de Legalidad y Riesgo Nacional EUDR — Arts. 10 & 11 (EU 2023/1115).
Clasifica lotes según cumplimiento legal y determina el tipo de diligencia debida requerida.
"""

from dataclasses import dataclass, field
from datetime import date
from enum import Enum

EUDR_CUTOFF_DATE = date(2020, 12, 31)
EUDR_REGULATION = "EU 2023/1115"
MIN_ANP_DISTANCE_KM = 5.0
MAX_POINTS = 100

# Art. 29 — clasificación de riesgo por país de origen
_HIGH_RISK_COUNTRIES = frozenset({
    "BR",  # Brasil
    "ID",  # Indonesia
    "PG",  # Papúa Nueva Guinea
    "CD",  # R.D. del Congo
    "MY",  # Malasia
    "NG",  # Nigeria
    "CM",  # Camerún
    "GH",  # Ghana
    "CI",  # Costa de Marfil
})

_LOW_RISK_COUNTRIES = frozenset({
    # Estados miembros UE
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
    "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
    "NL", "PL", "PT", "RO", "SE", "SI", "SK",
    # Otros países de riesgo negligible
    "GB", "NO", "CH", "JP", "AU", "NZ", "US", "CA",
})


class RiskLevel(str, Enum):
    NEGLIGIBLE = "NEGLIGIBLE"
    STANDARD = "STANDARD"
    HIGH = "HIGH"


class DueDiligenceType(str, Enum):
    SIMPLIFIED = "SIMPLIFIED"   # Art. 10
    FULL = "FULL"               # Art. 11


class ComplianceStatus(str, Enum):
    COMPLIANT = "COMPLIANT"
    NON_COMPLIANT = "NON_COMPLIANT"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


@dataclass
class ComplianceFinding:
    category: str
    status: ComplianceStatus
    score: int
    max_score: int
    detail: str


@dataclass
class LegalRiskReport:
    id_monitoreo: str
    parcela_codigo: str
    ID_Organizacion: str
    risk_level: RiskLevel
    due_diligence_type: DueDiligenceType
    compliance_score: float
    total_points: int
    max_points: int
    article_applicable: int
    findings: list = field(default_factory=list)
    gaps: list = field(default_factory=list)
    recommendation: str = ""


class LegalRiskEvaluator:
    """
    Evalúa el cumplimiento legal y nivel de riesgo EUDR de un lote de producción.
    Determina si aplica diligencia debida simplificada (Art. 10) o completa (Art. 11).
    """

    # ------------------------------------------------------------------
    # Helpers de clasificación
    # ------------------------------------------------------------------

    def _get_country_risk_level(self, country_code: str) -> RiskLevel:
        code = (country_code or "").strip().upper()
        if code in _LOW_RISK_COUNTRIES:
            return RiskLevel.NEGLIGIBLE
        if code in _HIGH_RISK_COUNTRIES:
            return RiskLevel.HIGH
        return RiskLevel.STANDARD

    # ------------------------------------------------------------------
    # Evaluadores por categoría
    # ------------------------------------------------------------------

    def _evaluate_land_title(self, record: dict) -> ComplianceFinding:
        has_title = record.get("tiene_titulo_propiedad", False)
        fecha = record.get("fecha_titulo")

        if not has_title:
            return ComplianceFinding(
                category="LAND_TITLE",
                status=ComplianceStatus.NON_COMPLIANT,
                score=0, max_score=25,
                detail="Sin título de propiedad registrado",
            )

        score = 20
        if fecha:
            try:
                title_date = date.fromisoformat(str(fecha)) if isinstance(fecha, str) else fecha
                if title_date <= EUDR_CUTOFF_DATE:
                    score = 25
            except (ValueError, TypeError):
                pass

        return ComplianceFinding(
            category="LAND_TITLE",
            status=ComplianceStatus.COMPLIANT,
            score=score, max_score=25,
            detail=f"Título de propiedad verificado (emitido: {fecha or 'sin fecha'})",
        )

    def _evaluate_environmental(self, record: dict) -> ComplianceFinding:
        has_permit = record.get("tiene_permiso_ambiental", False)
        fecha = record.get("fecha_permiso_ambiental")

        if not has_permit:
            return ComplianceFinding(
                category="ENVIRONMENTAL",
                status=ComplianceStatus.NON_COMPLIANT,
                score=0, max_score=20,
                detail="Sin permiso ambiental vigente",
            )

        return ComplianceFinding(
            category="ENVIRONMENTAL",
            status=ComplianceStatus.COMPLIANT,
            score=20, max_score=20,
            detail=f"Permiso ambiental vigente (emitido: {fecha or 'sin fecha'})",
        )

    def _evaluate_deforestation_cutoff(self, record: dict) -> ComplianceFinding:
        fecha_uso = record.get("fecha_ultimo_uso_suelo")
        cumple_eudr = record.get("cumple_eudr")

        # Campo cumple_eudr explícito tiene prioridad si no hay fecha
        if fecha_uso is None:
            if cumple_eudr is True:
                return ComplianceFinding(
                    category="DEFORESTATION_CUTOFF",
                    status=ComplianceStatus.COMPLIANT,
                    score=30, max_score=30,
                    detail="Cumplimiento EUDR verificado por validación satelital previa",
                )
            if cumple_eudr is False:
                return ComplianceFinding(
                    category="DEFORESTATION_CUTOFF",
                    status=ComplianceStatus.NON_COMPLIANT,
                    score=0, max_score=30,
                    detail=f"No cumple corte EUDR ({EUDR_CUTOFF_DATE})",
                )
            return ComplianceFinding(
                category="DEFORESTATION_CUTOFF",
                status=ComplianceStatus.INSUFFICIENT_DATA,
                score=0, max_score=30,
                detail="Fecha de último uso de suelo no disponible",
            )

        try:
            uso_date = date.fromisoformat(str(fecha_uso)) if isinstance(fecha_uso, str) else fecha_uso
        except (ValueError, TypeError):
            return ComplianceFinding(
                category="DEFORESTATION_CUTOFF",
                status=ComplianceStatus.INSUFFICIENT_DATA,
                score=0, max_score=30,
                detail="Fecha de último uso de suelo con formato inválido",
            )

        if uso_date <= EUDR_CUTOFF_DATE:
            return ComplianceFinding(
                category="DEFORESTATION_CUTOFF",
                status=ComplianceStatus.COMPLIANT,
                score=30, max_score=30,
                detail=f"Uso de suelo anterior al corte EUDR ({uso_date})",
            )

        return ComplianceFinding(
            category="DEFORESTATION_CUTOFF",
            status=ComplianceStatus.NON_COMPLIANT,
            score=0, max_score=30,
            detail=f"Uso de suelo posterior al corte EUDR ({uso_date} > {EUDR_CUTOFF_DATE})",
        )

    def _evaluate_protected_area(self, record: dict) -> ComplianceFinding:
        distancia = record.get("distancia_anp_km")

        if distancia is None:
            return ComplianceFinding(
                category="PROTECTED_AREA",
                status=ComplianceStatus.COMPLIANT,
                score=15, max_score=15,
                detail="Sin área natural protegida próxima registrada",
            )

        try:
            dist = float(distancia)
        except (ValueError, TypeError):
            return ComplianceFinding(
                category="PROTECTED_AREA",
                status=ComplianceStatus.INSUFFICIENT_DATA,
                score=0, max_score=15,
                detail="Distancia a ANP con valor inválido",
            )

        if dist >= MIN_ANP_DISTANCE_KM:
            return ComplianceFinding(
                category="PROTECTED_AREA",
                status=ComplianceStatus.COMPLIANT,
                score=15, max_score=15,
                detail=f"Distancia a ANP suficiente ({dist:.1f} km ≥ {MIN_ANP_DISTANCE_KM} km)",
            )
        if dist >= 1.0:
            return ComplianceFinding(
                category="PROTECTED_AREA",
                status=ComplianceStatus.NON_COMPLIANT,
                score=7, max_score=15,
                detail=f"Parcela en zona de amortiguamiento de ANP ({dist:.1f} km)",
            )
        return ComplianceFinding(
            category="PROTECTED_AREA",
            status=ComplianceStatus.NON_COMPLIANT,
            score=0, max_score=15,
            detail=f"Parcela dentro o colindante a ANP ({dist:.1f} km)",
        )

    def _evaluate_country_risk(self, record: dict) -> ComplianceFinding:
        code = (record.get("pais_origen") or "PE").strip().upper()
        level = self._get_country_risk_level(code)
        score_map = {RiskLevel.NEGLIGIBLE: 10, RiskLevel.STANDARD: 5, RiskLevel.HIGH: 0}
        status = (
            ComplianceStatus.NON_COMPLIANT
            if level == RiskLevel.HIGH
            else ComplianceStatus.COMPLIANT
        )
        return ComplianceFinding(
            category="COUNTRY_RISK",
            status=status,
            score=score_map[level], max_score=10,
            detail=f"País {code}: riesgo {level.value} (EUDR Art. 29)",
        )

    # ------------------------------------------------------------------
    # Evaluación principal
    # ------------------------------------------------------------------

    def evaluate_record(self, record: dict) -> LegalRiskReport:
        findings = [
            self._evaluate_land_title(record),
            self._evaluate_environmental(record),
            self._evaluate_deforestation_cutoff(record),
            self._evaluate_protected_area(record),
            self._evaluate_country_risk(record),
        ]

        total_points = sum(f.score for f in findings)
        max_points = sum(f.max_score for f in findings)
        compliance_score = round(total_points / max_points, 4) if max_points else 0.0

        country_code = (record.get("pais_origen") or "PE").strip().upper()
        country_risk = self._get_country_risk_level(country_code)

        # Clasificar nivel de riesgo del lote
        if compliance_score >= 0.80:
            risk_level = RiskLevel.NEGLIGIBLE
        elif compliance_score >= 0.60:
            risk_level = RiskLevel.STANDARD
        else:
            risk_level = RiskLevel.HIGH

        # Invariante: país HIGH nunca puede producir nivel NEGLIGIBLE
        if country_risk == RiskLevel.HIGH and risk_level == RiskLevel.NEGLIGIBLE:
            risk_level = RiskLevel.STANDARD

        # Determinar tipo de diligencia debida
        if risk_level == RiskLevel.NEGLIGIBLE and country_risk == RiskLevel.NEGLIGIBLE:
            dd_type = DueDiligenceType.SIMPLIFIED
            article = 10
        else:
            dd_type = DueDiligenceType.FULL
            article = 11

        gaps = [
            f.detail for f in findings
            if f.status in (ComplianceStatus.NON_COMPLIANT, ComplianceStatus.INSUFFICIENT_DATA)
        ]

        if risk_level == RiskLevel.HIGH:
            recommendation = (
                "Riesgo ALTO: diligencia debida completa requerida (Art. 11 EUDR). "
                "Subsanar todas las brechas antes de emitir declaración DDS."
            )
        elif risk_level == RiskLevel.STANDARD:
            recommendation = (
                "Riesgo ESTÁNDAR: diligencia debida completa requerida (Art. 11 EUDR). "
                "Completar documentación faltante para mejorar nivel de cumplimiento."
            )
        else:
            recommendation = (
                "Riesgo NEGLIGIBLE: apto para diligencia debida simplificada (Art. 10 EUDR)."
            )

        return LegalRiskReport(
            id_monitoreo=record.get("id_monitoreo", ""),
            parcela_codigo=record.get("parcela_codigo", ""),
            ID_Organizacion=record.get("ID_Organizacion", ""),
            risk_level=risk_level,
            due_diligence_type=dd_type,
            compliance_score=compliance_score,
            total_points=total_points,
            max_points=max_points,
            article_applicable=article,
            findings=findings,
            gaps=gaps,
            recommendation=recommendation,
        )

    def evaluate_batch(
        self, records: list, org_id: str | None = None
    ) -> list:
        if org_id is not None:
            records = [r for r in records if r.get("ID_Organizacion") == org_id]
        return [self.evaluate_record(r) for r in records]


if __name__ == "__main__":
    evaluator = LegalRiskEvaluator()
    sample = {
        "id_monitoreo": "550e8400-e29b-41d4-a716-446655440000",
        "parcela_codigo": "LOT-DEMO-001",
        "ID_Organizacion": "org-001",
        "pais_origen": "PE",
        "tiene_titulo_propiedad": True,
        "fecha_titulo": "2018-05-10",
        "tiene_permiso_ambiental": True,
        "fecha_ultimo_uso_suelo": "2019-11-01",
        "distancia_anp_km": 8.0,
    }
    report = evaluator.evaluate_record(sample)
    print(f"Parcela : {report.parcela_codigo}")
    print(f"Riesgo  : {report.risk_level.value}")
    print(f"DD Type : {report.due_diligence_type.value} (Art. {report.article_applicable})")
    print(f"Score   : {report.compliance_score:.0%} ({report.total_points}/{report.max_points} pts)")
    print(f"Gaps    : {report.gaps or 'Ninguna'}")
