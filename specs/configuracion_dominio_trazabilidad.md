# Spec: Dominio configurable para trazabilidad pública y QR de lote

## Contexto

`lib/traceabilityHash.js::getTraceUrl()` (y su contraparte Python
`scripts/generate_lot_qr.py::PublicTraceabilityService.get_trace_url()`)
construyen la URL de verificación pública que se imprime en el QR de
cada lote de exportación (`/dashboard/lotes`, Tarea 14, ver
`specs/tarea14_trazabilidad_qr.md`/`ADR-017`). Hasta esta tarea, ambas
tenían el dominio **hardcodeado como `https://app.ryzos.io`**.

**Confirmado con el usuario antes de escribir código:** el dominio
oficial real es ahora **`https://ryzosagri.com`** — reemplaza a
`app.ryzos.io` en todo el sistema (no es un hallazgo del prompt sin
verificar: `ryzosagri.com` no tenía ninguna referencia previa en el
repo, así que se confirmó explícitamente que es el dominio real antes
de tocar código que termina impreso en QRs de embarques reales,
consumidos por auditores/importadores europeos).

## Decisión: una sola variable de entorno, sin lógica de detección de ambiente en el código

`NEXT_PUBLIC_APP_URL` es simplemente una variable de entorno más —
"dinámico según el entorno" se logra de la forma estándar de
Next.js/Vercel: **cada entorno (desarrollo local, preview/staging,
producción) le asigna su propio valor** a esa misma variable (Vercel
permite valores distintos por entorno para la misma env var; en local
se define en `.env.local`, no commiteado). El código nunca intenta
adivinar en qué entorno corre — solo lee `process.env.NEXT_PUBLIC_APP_URL`,
con un *fallback* fijo a `https://ryzosagri.com` (el dominio de
producción real) si la variable no está definida en absoluto, para que
un despliegue con la variable olvidada falle hacia la URL pública
correcta en vez de hacia `localhost` (que sería mucho peor: un QR real
impreso con una URL que ningún usuario externo puede resolver).

## Alcance real de los archivos a tocar

El prompt original listaba `lib/eudrDdsExporter.js` como archivo a
revisar — **no requiere ningún cambio**: no contiene ninguna
referencia al dominio ni construye ninguna URL (confirmado por
`grep`); solo arma el payload DDS crudo que `traceabilityHash.js`
consume. El dominio vive en un único lugar del lado JS
(`TRACE_BASE_URL`, `lib/traceabilityHash.js`) y un único lugar del
lado Python (`PublicTraceabilityService.BASE_URL`,
`scripts/generate_lot_qr.py`) — este último **no estaba en la lista
del prompt, pero se corrige igual**: dejarlo con `app.ryzos.io`
mientras el lado JS cambia a `ryzosagri.com` rompería el invariante ya
documentado ("debe coincidir EXACTO" — hasta ahora sobre el algoritmo
de hash, extendido acá al dominio: dos QRs del mismo lote generados
por el path JS vs. el path Python por lotes ya no coincidirían).

Consecuencia: 3 archivos con la URL literal vieja
(`tests/test_trace_public.mjs`, `tests/test_tarea14_trazabilidad.py`,
`specs/tarea14_trazabilidad_qr.md`) además de los 2 módulos reales —
se actualizan todos para no dejar aserciones de test rotas ni
documentación desactualizada sobre el dominio real.

## Invariantes

1. `getTraceUrl(lotHash)`/`get_trace_url(lot_hash)` siguen devolviendo
   exactamente el mismo formato (`<base>/trace/<lot_hash>`), solo
   cambia de dónde sale `<base>`.
2. El algoritmo de `generateLotHash`/`generate_lot_hash` (SHA-256,
   16 chars) **no cambia** — el dominio no forma parte del hash, así
   que lotes ya generados no cambian de hash por este cambio.
3. `NEXT_PUBLIC_APP_URL` con prefijo `NEXT_PUBLIC_` porque
   `lib/traceabilityHash.js` corre tanto server-side como
   client-side (`'use client'` en `app/dashboard/lotes/page.jsx`) —
   sin ese prefijo, Next.js no expone la variable al bundle del
   navegador.
4. `scripts/generate_lot_qr.py` lee la variable de entorno del
   sistema operativo (`os.environ`), no de ningún `.env` de Next.js —
   quien ejecute ese script batch debe exportar
   `NEXT_PUBLIC_APP_URL` en su propio shell si quiere sobreescribir el
   default (mismo nombre de variable por consistencia entre ambos
   lenguajes, aunque el mecanismo de carga sea distinto).

## Fuera de alcance

- Cualquier configuración de dominio custom en Vercel (`vercel.json`,
  DNS) — eso ya está resuelto fuera de este repo, según confirmó el
  usuario.
- Cualquier cambio al algoritmo de `generateLotHash` o al formato del
  payload sanitizado — sin cambios, ver invariante 2.
