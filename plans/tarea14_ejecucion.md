# PLAN DE EJECUCIÓN: Tarea 14 - Trazabilidad Pública & QR

## 1. Pasos de Desarrollo
1. **Especificación e Invariantes** (`specs/tarea14_trazabilidad_qr.md`): PII prohibida, estructura del payload público y contrato del QR.
2. **Script Generator** (`scripts/generate_lot_qr.py`):
   - `generate_lot_hash()` — SHA-256 determinista del lote.
   - `build_public_sanitized_payload()` — elimina campos PII, preserva geometría y cumplimiento.
   - `generate_qr_data_url()` — imagen PNG Base64 via librería `qrcode[pil]`.
   - `get_trace_url()` — URL pública de verificación.
3. **Suite de Pruebas** (`tests/test_tarea14_trazabilidad.py`):
   - Sanitización PII (ausencia de campos prohibidos).
   - Consistencia e inmutabilidad del hash.
   - Estructura del payload público.
   - Validez del Data URL del QR.
4. **Dependencia:** `pip install qrcode[pil]`.
5. **Ejecución y Confirmación:** `pytest tests/test_tarea14_trazabilidad.py -v`.

## 2. Plan de Rollback
- El servicio de trazabilidad es de solo lectura — no modifica datos en Supabase.
- Si el QR apunta a una URL incorrecta, actualizar `BASE_URL` en `PublicTraceabilityService` y regenerar los QR del lote afectado.
- Los hashes son deterministas — regenerar con los mismos inputs produce el mismo `lot_hash`.
