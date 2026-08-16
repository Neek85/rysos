"""
Motor de Pre-Validación Satelital de Deforestación — RYZOS.
Cruza geometrías de parcelas contra capas de pérdida forestal (Hansen GFW / PNCBM)
y Áreas Naturales Protegidas (ANP SERNANP).
Fecha de corte normativa EUDR: 31 de diciembre de 2020 (year > 2020 = incumplimiento).
"""

from typing import Any

from shapely.geometry import shape
from shapely.validation import make_valid

EUDR_CUTOFF_YEAR = 2020  # Eventos con year > 2020 invalidan conformidad EUDR

RISK_PRIORITY = {"CRITICO": 3, "ALTO": 2, "BAJO": 1}


class SatellitePrevalidationEngine:
    """Análisis espacial de deforestación y ANP para pre-validación EUDR."""

    def evaluate_plot(
        self,
        plot_feature: dict[str, Any],
        forest_loss_events: list[dict[str, Any]],
        anp_polygons: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """
        Evalúa una parcela contra eventos de pérdida forestal y zonas protegidas.

        forest_loss_events: [{"geom": ..., "year": 2022}, ...]
        anp_polygons:       [{"geom": ..., "nombre": "Parque Nacional X"}, ...]
        """
        geom_plot = make_valid(shape(plot_feature["geom"]))
        anp_polygons = anp_polygons or []

        has_post2020 = False
        has_pre2020 = False
        has_anp = False
        deforested_m2 = 0.0
        anp_m2 = 0.0
        anp_names: list[str] = []

        # 1. Pérdida de cobertura forestal
        for event in forest_loss_events:
            geom_loss = make_valid(shape(event["geom"]))
            if not geom_plot.intersects(geom_loss):
                continue
            area = geom_plot.intersection(geom_loss).area
            if area <= 0:
                continue
            if int(event.get("year", 0)) > EUDR_CUTOFF_YEAR:
                has_post2020 = True
                deforested_m2 += area
            else:
                has_pre2020 = True

        # 2. Áreas Naturales Protegidas
        for anp in anp_polygons:
            geom_anp = make_valid(shape(anp["geom"]))
            if not geom_plot.intersects(geom_anp):
                continue
            area = geom_plot.intersection(geom_anp).area
            if area <= 0:
                continue
            has_anp = True
            anp_m2 += area
            anp_names.append(anp.get("nombre", "ANP Sin Nombre"))

        # 3. Clasificación de riesgo (ANP tiene prioridad sobre deforestación)
        if has_anp:
            risk = "CRITICO"
            cumple = "NO"
        elif has_post2020:
            risk = "ALTO"
            cumple = "NO"
        else:
            risk = "BAJO"
            cumple = "SI"

        parcela_id = (
            plot_feature.get("properties", {}).get("ID_Parcela_Fija")
            or plot_feature.get("id")
        )

        return {
            "parcela_id": parcela_id,
            "cumple_eudr": cumple,
            "nivel_riesgo": risk,
            "alerta_deforestacion": has_post2020,
            "alerta_anp": has_anp,
            "deforested_area_post2020_m2": round(deforested_m2, 2),
            "anp_overlap_m2": round(anp_m2, 2),
            "anp_nombres": anp_names,
            "deforestacion_historica_pre2020": has_pre2020,
        }

    def evaluate_batch(
        self,
        plots: list[dict[str, Any]],
        forest_loss_events: list[dict[str, Any]],
        anp_polygons: list[dict[str, Any]] | None = None,
        org_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Evalúa un lote de parcelas. Si se especifica org_id, filtra por ID_Organizacion
        (aislamiento Multi-Tenant).
        """
        results = []
        for plot in plots:
            plot_org = (
                plot.get("properties", {}).get("ID_Organizacion")
                or plot.get("ID_Organizacion")
            )
            if org_id and plot_org != org_id:
                continue
            results.append(self.evaluate_plot(plot, forest_loss_events, anp_polygons))
        return results
