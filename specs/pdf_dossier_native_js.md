# Spec — Dossier Comercial EUDR nativo en JS (Opción 1)

Sigue a `specs/traces_eudr_dossier_audit.md` — cierra el gap ahí
identificado ("Dossier Comercial PDF inalcanzable desde la UI") portando
`scripts/generate_dossier_pdf.py` a JS con `@react-pdf/renderer`, opción
confirmada por el usuario entre las 3 evaluadas en esa auditoría.

## Decisión de diseño confirmada con el usuario (crítica, léase antes de tocar este código)

**El Dossier del portal público (`/trace/[lot_hash]`) NO incluye ningún
dato del módulo de Inspecciones FED** (`INSPECCIONES`/6 tablas `CAP_*`).
Ese módulo contiene PII real (DNI, nombre completo, composición familiar,
salarios, datos de salud) y sus políticas RLS para `anon` no la filtran
(`USING (true)` en las `CAP_*` — diseñadas para el formulario interno, no
para consumo público). No existe además ningún vínculo de datos
establecido entre un `lot_hash` (organización+parcela, línea EUDR/GIS) y
una inspección FED (socio+inspección, línea Fase 6) — son dominios de
datos deliberadamente separados en este proyecto. El Dossier se limita a:
mapa/geometría de las parcelas, hash SHA-256, QR de verificación, y el
resumen EUDR (parcelas/hectáreas/normativa/estatus deforestación) — el
mismo contenido que ya tenía `scripts/generate_dossier_pdf.py`, más la
sección de mapa nueva.

## Decisiones técnicas

1. **Librería: `@react-pdf/renderer`** (nueva dependencia de producción,
   `^4.6.1`) — sugerida explícitamente en el prompt, y la más idiomática
   dado que el resto del proyecto ya es 100% JSX/React. `renderToBuffer()`
   corre en Node (Route Handler), no requiere DOM ni headless browser.
2. **`lib/pdf/DossierDocument.js` usa `React.createElement` en vez de JSX**
   — única excepción de estilo a JSX en todo el repo, deliberada: Node no
   puede parsear JSX sin un transpilador, y este proyecto no tiene ninguno
   configurado para tests. Escribirlo así permite un test end-to-end real
   del PDF generado vía `node --test`, sin agregar ninguna dependencia de
   testing nueva (Babel/ts-node/etc.) — coherente con las decisiones de
   "cero dependencias de testing nuevas" de tareas anteriores del día.
3. **Mapa/geometría — solución 100% nativa, sin servicio externo:**
   `lib/pdf/geometryToSvg.js` proyecta las coordenadas GeoJSON (ya
   sanitizadas) a un `<Svg>` esquemático (bounding box + escala lineal,
   sin proyección cartográfica real) usando los primitivos vectoriales de
   `@react-pdf/renderer` (`<Svg>`/`<Polygon>`/`<Circle>`). No es un mapa
   geográfico con basemap/satélite — eso requeriría un servicio de tiles o
   captura de pantalla externa, fuera del alcance "nativo" pedido. Un
   `Point` se dibuja como círculo; `Polygon`/`MultiPolygon` como polígono(s)
   rellenos. Un lote sin geometría muestra un mensaje, no lanza excepción.
4. **`lib/lotLookup.js` nuevo** — la lógica de `findLotByHash()` (antes
   inline en `app/trace/[lot_hash]/page.jsx`) se extrajo a un módulo
   compartido para que la página y el Route Handler nuevo usen exactamente
   la misma búsqueda, evitando el mismo riesgo de drift ya encontrado entre
   el hash JS y el hash Python (ver `specs/trace_public_audit.md`).
5. **Route Handler `app/api/trace/[lot_hash]/pdf/route.js`** —
   `export const runtime = 'nodejs'` explícito (`@react-pdf/renderer` usa
   APIs de Node no disponibles en el runtime Edge). Responde 404 JSON si el
   hash no resuelve a ningún lote (mismo criterio que la página pública),
   o el PDF con `Content-Type: application/pdf` +
   `Content-Disposition: attachment` si sí.
6. **Botón de descarga** agregado en `/trace/[lot_hash]` y
   `/dashboard/lotes` — enlace `<a href="/api/trace/{hash}/pdf">` directo
   (sin JS de por medio), dispara la descarga vía el header
   `Content-Disposition`.

## Verificación real (no solo compilación)

Además de `npm run build`, se levantó el dev server localmente y se probó
el endpoint contra la instancia Supabase real (`jhtocgxlozfuzullrtol`,
que sí tiene datos aprobados en vivo para `ORG-COOP-NORTE`, confirmado por
esta tarea — dato nuevo, no documentado antes):
- `GET /api/trace/<hash-inexistente>/pdf` → `404 {"error":"Lote no encontrado"}`.
- `GET /api/trace/752ef9ab79645546/pdf` (hash real, recalculado con los
  mismos módulos ya probados) → `200`, PDF de 9.566 bytes, magic bytes
  `%PDF-1.3` correctos.
- El PDF se inspeccionó visualmente (vía el lector de PDF de esta
  herramienta): título, organización, hash, tabla de resumen, mapa
  esquemático con 2 polígonos reales visibles, QR funcional apuntando a la
  URL de verificación, y la declaración legal — todo correcto.

## Vulnerabilidades npm pre-existentes (no introducidas por esta tarea)

`npm install @react-pdf/renderer` reveló 2 vulnerabilidades "high"
pre-existentes en `next`/`postcss` (no relacionadas con la librería nueva).
`npm audit fix --force` propone saltar a `next@16` — cambio mayor,
rompería potencialmente toda la app. No se aplica en esta tarea; queda
como una tarea separada a evaluar con tiempo dedicado a testear el upgrade.

## Criterios de aceptación

- AC1: `lib/pdf/geometryToSvg.js` proyecta Polygon/MultiPolygon/Point sin
  desbordar el viewport, sin lanzar excepción con geometría vacía.
- AC2: `renderDossierPdf()` produce un buffer PDF válido (magic bytes,
  `%%EOF`, imagen QR embebida) en todos los casos (con/sin geometría,
  con/sin `verification_url`).
- AC3: el PDF generado nunca contiene ningún string relacionado con
  `INSPECCIONES`/`CAP_*`/PII.
- AC4: `GET /api/trace/[lot_hash]/pdf` responde 404 para un hash inválido
  y 200 + `application/pdf` para uno válido.
- AC5: `node --test tests/test_pdf_dossier.mjs` pasa al 100%.
- AC6: `npm run build` compila sin errores con la ruta nueva registrada.
