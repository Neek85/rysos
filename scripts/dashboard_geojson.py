"""
Helper: convierte filas de view_eudr_dashboard_aprobados a FeatureCollection GeoJSON.
Usado por la API route de Next.js (/api/dashboard/geojson).
"""

from typing import Any

REQUIRED_FEATURE_PROPERTIES = {
    "id_monitoreo",
    "ID_Parcela_Fija",
    "parcela_nombre",
    "socio_nombre_completo",
    "cumple_eudr",
    "hectareas_totales",
}


def record_to_feature(record: dict[str, Any]) -> dict[str, Any]:
    """Convierte una fila de la vista a un GeoJSON Feature."""
    if record.get("estado_revision") != "APROBADO":
        raise ValueError(
            f"Solo registros APROBADOS pueden exponerse. "
            f"estado_revision={record.get('estado_revision')!r}"
        )
    return {
        "type": "Feature",
        "geometry": record.get("geom"),
        "properties": {
            "id_monitoreo": record["id_monitoreo"],
            "ID_Organizacion": record["ID_Organizacion"],
            "ID_Parcela_Fija": record["ID_Parcela_Fija"],
            "parcela_nombre": record.get("parcela_nombre"),
            "socio_nombre_completo": record.get("socio_nombre_completo"),
            "cumple_eudr": record.get("cumple_eudr"),
            "hectareas_totales": record.get("hectareas_totales"),
            "fecha_monitoreo": record.get("fecha_monitoreo"),
            "tecnico_responsable": record.get("tecnico_responsable"),
            "evidencia_foto": record.get("evidencia_foto"),
        },
    }


def records_to_feature_collection(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Convierte una lista de filas aprobadas a un FeatureCollection GeoJSON."""
    return {
        "type": "FeatureCollection",
        "features": [record_to_feature(r) for r in records],
    }
