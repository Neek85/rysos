# SPEC: Endpoint de Trazabilidad Pública & Códigos QR de Lote (Tarea 14)

## 1. Objetivo
Permitir a compradores, importadores europeos y auditores escanear un Código QR impreso en el embarque o consultar la URL `/trace/[lot_hash]` para verificar en tiempo real la declaración de debida diligencia (EUDR), certificado de deforestación cero y polígonos de origen de manera pública e inmutable.

## 2. Invariantes de Negocio y Privacidad
- **Sanitización Estricta de PII (Protección de Datos):** La vista pública NUNCA debe exponer números de DNI, cédulas ni nombres completos de los pequeños productores. Únicamente expondrá el código anonimizado de la finca, hectáreas, estatus de cumplimiento EUDR y geometría del polígono.
- **Campos PII prohibidos en payload público:** `socio_dni`, `socio_nombre`, `socio_nombre_completo`, `conyuge_dni`.
- **Inmutabilidad del Hash de Lote:** El `lot_hash` debe ser único por lote de exportación y derivarse de forma determinista (SHA-256) combinando la organización, número de parcelas, hectáreas totales y la lista de UUIDs de monitoreos aprobados.
- **Generación de QR Estándar:** El script genera una imagen PNG (Data URL Base64) del código QR apuntando al dominio `https://app.ryzos.io/trace/{lot_hash}`.

## 3. Criterios de Aceptación
- [ ] El payload de la API pública excluye campos sensibles: `socio_dni`, `socio_nombre`, `socio_nombre_completo`, `conyuge_dni`.
- [ ] El `lot_hash` SHA-256 (16 chars hex) es determinista — el mismo lote siempre produce el mismo hash.
- [ ] La URL de verificación sigue el patrón `https://app.ryzos.io/trace/{lot_hash}`.
- [ ] El método `generate_qr_data_url()` devuelve un string con prefijo `data:image/png;base64,` y contenido Base64 válido.
- [ ] Todos los tests en `tests/test_tarea14_trazabilidad.py` pasan correctamente.
