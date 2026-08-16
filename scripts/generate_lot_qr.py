"""
Servicio de Trazabilidad Pública EUDR — Tarea 14.
Genera lot_hash determinista (SHA-256), sanitiza PII y produce QR en Data URL Base64.
"""

import base64
import hashlib
import io
import json
from typing import Any

# Campos PII prohibidos en la respuesta pública (GDPR / privacidad de productores)
_PII_FIELDS = {"socio_dni", "socio_nombre", "socio_nombre_completo", "conyuge_dni"}


class PublicTraceabilityService:
    BASE_URL = "https://app.ryzos.io/trace/"

    def generate_lot_hash(self, dds_payload: dict[str, Any]) -> str:
        """Genera un hash SHA-256 determinista de 16 chars para el lote."""
        parts = [
            str(dds_payload.get("organization_id", "")),
            str(dds_payload.get("total_plots", "")),
            str(dds_payload.get("total_hectares", "")),
        ]
        for feat in dds_payload.get("geojson", {}).get("features", []):
            parts.append(str(feat.get("properties", {}).get("id_monitoreo", "")))

        raw = "_".join(parts)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def build_public_sanitized_payload(
        self, dds_payload: dict[str, Any], lot_hash: str
    ) -> dict[str, Any]:
        """Construye el payload público eliminando todos los campos PII."""
        sanitized_features = []
        for feat in dds_payload.get("geojson", {}).get("features", []):
            props = feat.get("properties", {})
            sanitized_props = {
                k: v for k, v in props.items() if k not in _PII_FIELDS
            }
            sanitized_features.append({
                "type": "Feature",
                "geometry": feat.get("geometry"),
                "properties": sanitized_props,
            })

        return {
            "lot_hash": lot_hash,
            "verification_url": self.get_trace_url(lot_hash),
            "regulation": dds_payload.get("regulation", "EU 2023/1115"),
            "organization_id": dds_payload.get("organization_id"),
            "total_plots": dds_payload.get("total_plots"),
            "total_hectares": dds_payload.get("total_hectares"),
            "geojson": {
                "type": "FeatureCollection",
                "features": sanitized_features,
            },
        }

    def generate_qr_data_url(self, lot_hash: str) -> str:
        """Genera una imagen PNG del QR como Data URL Base64."""
        try:
            import qrcode  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "Instala la dependencia: pip install qrcode[pil]"
            ) from exc

        url = self.get_trace_url(lot_hash)
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")

        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{b64}"

    def get_trace_url(self, lot_hash: str) -> str:
        return f"{self.BASE_URL}{lot_hash}"
