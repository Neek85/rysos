# Plan de Ejecución — Dossier Comercial EUDR nativo en JS

Ver spec: `specs/pdf_dossier_native_js.md`.

## Pasos (en el orden real seguido)

1. **Decisión bloqueante resuelta primero:** confirmar con el usuario si el
   Dossier público incluye "resumen de inspección FED" — respuesta:
   omitirlo por completo (riesgo de PII, sin vínculo de datos establecido).
2. Leer `scripts/generate_dossier_pdf.py` completo (plantilla a portar) y
   `package.json` (confirmar que no había ninguna librería de PDF JS
   instalada todavía).
3. `npm install @react-pdf/renderer` — revisar `npm audit` resultante,
   confirmar que las vulnerabilidades son pre-existentes de `next`/`postcss`,
   no de la librería nueva.
4. Extraer `findLotByHash()` de `app/trace/[lot_hash]/page.jsx` a
   `lib/lotLookup.js` (compartido entre la página y el Route Handler nuevo).
5. `lib/pdf/geometryToSvg.js` — funciones puras de proyección GeoJSON→SVG
   (bounding box, escala, inversión de eje Y).
6. `lib/pdf/DossierDocument.js` — plantilla del Dossier (React.createElement,
   ver justificación en la spec), port de `generate_dossier_pdf.py` +
   sección de mapa nueva.
7. `lib/pdf/renderDossierPdf.js` — genera el QR y llama `renderToBuffer`.
8. `app/api/trace/[lot_hash]/pdf/route.js` — Route Handler `nodejs` runtime.
9. Botón de descarga en `app/trace/[lot_hash]/page.jsx` y
   `app/dashboard/lotes/page.jsx`.
10. `tests/test_pdf_dossier.mjs` (`node --test`) — geometría pura +
    render end-to-end (magic bytes, EOF, tamaño, XObject de imagen,
    ausencia de strings de Inspecciones FED).
11. **Verificación real, no solo compilación:** `npm run build`, luego
    `npm run dev` + `curl` contra la instancia Supabase real, con un
    `lot_hash` recalculado con los mismos módulos ya probados —
    confirmado 404 para hash inválido y 200 + PDF válido para uno real
    (con datos reales de `ORG-COOP-NORTE`, ya aplicados en producción).
    Inspección visual del PDF resultante. Dev server detenido y limpiado
    al terminar.
12. Correr `node --test tests/*.mjs` (suite JS completa) y
    `python -m pytest tests/ -q` (sin regresión).
13. Actualizar `docs/schema_live.md`: nueva ruta `/api/trace/[lot_hash]/pdf`,
    nueva dependencia, dato nuevo confirmado (hay datos reales aprobados en
    vivo para `ORG-COOP-NORTE`).
14. Commit a `main` (sin push).
