# PLAN DE EJECUCIÓN: Módulo Dossier PDF Auditable

## 1. Pasos de Desarrollo
1. **Especificación e Invariantes** (`specs/modulo_dossier_pdf.md`): Estructura visual y contrato binario del PDF.
2. **Dependencia:** `pip install reportlab`.
3. **Generador de PDF** (`scripts/generate_dossier_pdf.py`):
   - Cabecera con `organization_id` y `lot_hash`.
   - Tabla resumen: parcelas, hectáreas, normativa, estado deforestación.
   - Imagen QR PNG incrustada desde `generate_qr_data_url()`.
   - Pie de página con `verification_url`.
   - Declaración legal de deforestación cero.
4. **Suite de Pruebas** (`tests/test_modulo_dossier_pdf.py`):
   - Magic bytes PDF (`%PDF-`) y EOF (`%%EOF`).
   - PNG embebido del QR (`\x89PNG` en el binario).
   - Tamaño mínimo > 2 KB.
   - Escalado: PDF multi-parcela más grande que uni-parcela.
   - Payload vacío sigue produciendo PDF válido.
   - Coherencia `organization_id` y `lot_hash` en el output.
5. **Ejecución:** `pytest tests/test_modulo_dossier_pdf.py -v`.

## 2. Plan de Rollback
- El generador es de solo lectura — no modifica Supabase.
- Si ReportLab falla en producción, el buffer devuelto será vacío o lanzará excepción; capturar en el API route y retornar HTTP 500.
- Los PDFs generados no se almacenan en Supabase Storage por defecto; si se persisten, usar un bucket `dossiers_eudr` separado de `evidencias_eudr`.
