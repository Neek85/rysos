"""
Generador de Declaración de Debida Diligencia (DDS) EUDR.
Reglamento UE 2023/1115 — formato compatible con plataforma TRACES EU.
"""

import json
from typing import Any


class EUDRDDSGenerator:
    CUTOFF_DATE = "2020-12-31"
    REGULATION = "EU 2023/1115"
    MIN_POLYGON_HECTARES = 4.0

    def __init__(self, organization_id: str):
        self.organization_id = organization_id

    def build_traces_payload(self, approved_records: list[dict[str, Any]]) -> dict[str, Any]:
        """Transforma registros aprobados en el formato estandarizado TRACES EU."""
        features = []
        total_hectares = 0.0

        for record in approved_records:
            if record.get("ID_Organizacion") != self.organization_id:
                raise ValueError(
                    f"Violación Multi-Tenant: registro {record.get('id_monitoreo')!r} "
                    f"no pertenece a {self.organization_id!r}"
                )

            if record.get("estado_revision") != "APROBADO":
                raise ValueError(
                    f"Violación EUDR: intento de incluir registro con "
                    f"estado_revision={record.get('estado_revision')!r}"
                )

            hectares = float(record.get("hectareas_totales") or 0.0)
            geom = record.get("geom")

            self._validate_geometry_for_hectares(geom or {}, hectares)

            total_hectares += hectares
            features.append({
                "type": "Feature",
                "geometry": self._format_geometry_precision(geom) if geom else None,
                "properties": {
                    "id_monitoreo": record.get("id_monitoreo"),
                    "parcela_codigo": record.get("parcela_codigo"),
                    "parcela_nombre": record.get("parcela_nombre"),
                    "socio_nombre": record.get("socio_nombre_completo"),
                    "socio_dni": record.get("socio_dni"),
                    "cumple_eudr": record.get("cumple_eudr"),
                    "deforestation_cutoff_date": self.CUTOFF_DATE,
                    "hectareas": round(hectares, 4),
                },
            })

        return {
            "declaration_type": "DUE_DILIGENCE_STATEMENT",
            "regulation": self.REGULATION,
            "organization_id": self.organization_id,
            "total_plots": len(features),
            "total_hectares": round(total_hectares, 4),
            "geojson": {
                "type": "FeatureCollection",
                "features": features,
            },
        }

    def _validate_geometry_for_hectares(self, geom: dict, hectares: float) -> None:
        """Parcelas >= 4 Ha deben ser Polygon obligatoriamente."""
        if hectares >= self.MIN_POLYGON_HECTARES:
            geom_type = geom.get("type", "")
            if geom_type != "Polygon":
                raise ValueError(
                    f"Parcela de {hectares} Ha debe exportarse como Polygon, "
                    f"no como {geom_type!r} (EUDR UE 2023/1115)."
                )

    def _format_geometry_precision(self, geom: dict[str, Any], precision: int = 6) -> dict[str, Any]:
        """Redondea recursivamente todas las coordenadas a `precision` decimales."""
        if not geom or "coordinates" not in geom:
            return geom

        def round_coords(coords):
            if isinstance(coords[0], (int, float)):
                return [round(float(c), precision) for c in coords]
            return [round_coords(c) for c in coords]

        return {"type": geom["type"], "coordinates": round_coords(geom["coordinates"])}

    def to_json(self, approved_records: list[dict[str, Any]], indent: int = 2) -> str:
        """Serializa el payload DDS a JSON formateado."""
        return json.dumps(self.build_traces_payload(approved_records), ensure_ascii=False, indent=indent)
