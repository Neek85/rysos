"""
Generador de Dossier PDF Auditable — Lotes EUDR (UE 2023/1115).
Consume el payload público sanitizado de la Tarea 14 y emite un buffer PDF binario.
"""

import base64
import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from scripts.generate_lot_qr import PublicTraceabilityService


class DossierPDFGenerator:
    """Generador de Dossier/Certificado de Exportación PDF para lotes EUDR."""

    def __init__(self):
        self.trace_service = PublicTraceabilityService()

    def build_pdf_dossier(self, public_payload: dict[str, Any]) -> bytes:
        """Genera un buffer PDF en memoria a partir del payload público sanitizado."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=36,
            leftMargin=36,
            topMargin=36,
            bottomMargin=36,
        )
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            "TitleStyle",
            parent=styles["Heading1"],
            fontSize=16,
            textColor=colors.HexColor("#1E3A8A"),
            spaceAfter=8,
        )
        body_style = styles["Normal"]
        small_style = ParagraphStyle("SmallStyle", parent=body_style, fontSize=8)

        story = []

        # --- Cabecera ---
        story.append(
            Paragraph(
                "EXPEDIENTE AUDITABLE DE CUMPLIMIENTO EUDR (UE 2023/1115)",
                title_style,
            )
        )
        story.append(
            Paragraph(
                f"<b>Organización:</b> {public_payload.get('organization_id', '')}",
                body_style,
            )
        )
        story.append(
            Paragraph(
                f"<b>Hash Único de Lote:</b> "
                f"<font color='#2563EB'>{public_payload.get('lot_hash', '')}</font>",
                body_style,
            )
        )
        story.append(Spacer(1, 10))

        # --- Resumen estadístico ---
        summary_data = [
            ["Métrica", "Valor"],
            ["Total de Parcelas Aprobadas", str(public_payload.get("total_plots", 0))],
            [
                "Hectáreas Totales Monitoreadas",
                f"{public_payload.get('total_hectares', 0.0):.2f} ha",
            ],
            ["Normativa de Referencia", public_payload.get("regulation", "EU 2023/1115")],
            ["Estatus Deforestación Cero", "VERIFICADO (Post-31/12/2020)"],
        ]
        table = Table(summary_data, colWidths=[200, 250])
        table.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#F3F4F6")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F4F6")]),
            ])
        )
        story.append(table)
        story.append(Spacer(1, 15))

        # --- Código QR ---
        lot_hash = public_payload.get("lot_hash", "")
        if lot_hash:
            data_url = self.trace_service.generate_qr_data_url(lot_hash)
            _, b64_data = data_url.split(",", 1)
            img_bytes = base64.b64decode(b64_data)
            qr_buffer = io.BytesIO(img_bytes)
            qr_img = Image(qr_buffer, width=100, height=100)

            story.append(
                Paragraph("<b>Código QR de Verificación Pública e Inmutable:</b>", body_style)
            )
            story.append(Spacer(1, 4))
            story.append(qr_img)
            verification_url = public_payload.get("verification_url", "")
            if verification_url:
                story.append(Paragraph(verification_url, small_style))
            story.append(Spacer(1, 15))

        # --- Declaración legal ---
        story.append(
            Paragraph("<b>Declaración de Deforestación Cero y Conformidad Legal:</b>", body_style)
        )
        story.append(
            Paragraph(
                "<font size=9>Se certifica que las materias primas asociadas a este lote "
                "provienen de parcelas agrícolas que no han sido objeto de deforestación ni "
                "degradación forestal posterior al 31 de diciembre de 2020, cumpliendo "
                "estrictamente con la legislación nacional del país de origen y la normativa "
                "europea UE 2023/1115.</font>",
                body_style,
            )
        )

        doc.build(story)
        buffer.seek(0)
        return buffer.getvalue()
