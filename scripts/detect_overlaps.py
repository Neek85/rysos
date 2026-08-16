"""
Motor de Detección y Limpieza de Solapamientos Topológicos — RYZOS.
Analiza intersecciones entre polígonos de parcelas/monitoreos EUDR usando Shapely.
"""

from typing import Any

from shapely.geometry import mapping, shape
from shapely.validation import make_valid

# Tipos de geometría que representan intersecciones sin área (bordes compartidos)
_ZERO_AREA_TYPES = {"LineString", "MultiLineString", "Point", "MultiPoint", "GeometryCollection"}

TOLERANCE_PERCENTAGE = 0.5  # 0.5 % del área de la parcela


class TopologicalOverlapDetector:
    """Detecta y corrige solapamientos topológicos entre parcelas EUDR."""

    def analyze_pair_overlap(
        self, feature_a: dict[str, Any], feature_b: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Analiza si dos parcelas tienen solapamiento de área.
        Intersecciones de borde (línea/punto) no se cuentan como overlap.
        """
        geom_a = make_valid(shape(feature_a["geom"]))
        geom_b = make_valid(shape(feature_b["geom"]))

        _no_overlap = {
            "has_overlap": False,
            "overlap_area": 0.0,
            "pct_overlap_a": 0.0,
            "pct_overlap_b": 0.0,
            "is_minor": False,
            "requires_manual_review": False,
        }

        if not geom_a.intersects(geom_b):
            return _no_overlap

        intersection = geom_a.intersection(geom_b)

        # Ignorar intersecciones sin área (bordes/vértices compartidos)
        if intersection.geom_type in _ZERO_AREA_TYPES or intersection.area == 0:
            return _no_overlap

        overlap_area = intersection.area
        area_a = geom_a.area
        area_b = geom_b.area

        pct_a = (overlap_area / area_a * 100) if area_a > 0 else 0.0
        pct_b = (overlap_area / area_b * 100) if area_b > 0 else 0.0

        is_minor = pct_a < TOLERANCE_PERCENTAGE and pct_b < TOLERANCE_PERCENTAGE

        return {
            "has_overlap": True,
            "overlap_area": overlap_area,
            "pct_overlap_a": round(pct_a, 4),
            "pct_overlap_b": round(pct_b, 4),
            "is_minor": is_minor,
            "requires_manual_review": not is_minor,
        }

    def resolve_minor_overlap(
        self, base_feature: dict[str, Any], target_feature: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Aplica `difference()` para restar el solapamiento de target_feature usando base_feature.
        La geometría base no se modifica — solo target_feature recibe la corrección.
        """
        geom_base = make_valid(shape(base_feature["geom"]))
        geom_target = make_valid(shape(target_feature["geom"]))

        cleaned = geom_target.difference(geom_base)

        if not cleaned.is_valid:
            cleaned = make_valid(cleaned)

        result = dict(target_feature)
        result["geom"] = mapping(cleaned)
        result["cleaned_topologically"] = True
        return result

    def check_overlaps_for_organization(
        self, records: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Itera todos los pares de registros dentro de la misma organización y
        retorna los pares con solapamiento de área detectado.
        """
        results = []
        for i in range(len(records)):
            for j in range(i + 1, len(records)):
                a, b = records[i], records[j]
                if a.get("ID_Organizacion") != b.get("ID_Organizacion"):
                    continue  # Aislamiento Multi-Tenant
                analysis = self.analyze_pair_overlap(a, b)
                if analysis["has_overlap"]:
                    results.append({
                        "id_a": a.get("id"),
                        "id_b": b.get("id"),
                        **analysis,
                    })
        return results
