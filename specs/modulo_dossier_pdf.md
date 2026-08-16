# SPEC: Generador de Dossier PDF / Certificado de Exportación Auditable EUDR

## 1. Objetivo
Generar automáticamente un expediente oficial en formato PDF para cada lote de exportación aprobado, proporcionando a compradores, importadores europeos y entidades bancarias un documento físico/digital verificado con estadísticas de origen, declaración de no deforestación y código QR de trazabilidad inmutable.

## 2. Invariantes de Negocio
- **Inmutabilidad del Hash de Lote:** El Dossier PDF debe incluir explícitamente el `lot_hash` SHA-256 en la cabecera del documento.
- **Integración QR (Tarea 14):** El documento debe renderizar la imagen del Código QR generado por `PublicTraceabilityService.generate_qr_data_url()`.
- **Sanitización de PII:** El expediente recibe el payload ya sanitizado de la Tarea 14 — no introduce ni expone datos personales (DNI, nombres de socios).
- **Validez de Formato Binario:** La salida debe ser un buffer binario que inicie con `%PDF-` y termine con `%%EOF`.
- **Coherencia Multi-Tenant:** El PDF incluye el `organization_id` del payload recibido sin modificarlo.

## 3. Criterios de Aceptación
- [ ] `generate_dossier_pdf.py` produce bytes que inician con `%PDF-`.
- [ ] El buffer PDF finaliza con el marcador estándar `%%EOF`.
- [ ] El PDF contiene la imagen PNG del QR (magic bytes `\x89PNG` embebidos en el binario).
- [ ] El tamaño del buffer es superior a 2 KB (confirma que se renderizaron tabla y QR).
- [ ] El PDF no contiene campos PII (el payload recibido ya fue sanitizado por la Tarea 14).
- [ ] Todos los tests en `tests/test_modulo_dossier_pdf.py` pasan correctamente.
