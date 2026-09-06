# Plan de ejecución: dominio configurable `ryzosagri.com`

Ver `specs/configuracion_dominio_trazabilidad.md` para el contexto y
las decisiones ya tomadas (una sola env var, sin detección de
ambiente en código, `eudrDdsExporter.js` fuera de alcance real,
`scripts/generate_lot_qr.py` agregado al alcance real).

1. `lib/traceabilityHash.js` — `TRACE_BASE_URL` lee
   `process.env.NEXT_PUBLIC_APP_URL`, fallback `https://ryzosagri.com`.
2. `scripts/generate_lot_qr.py` — `PublicTraceabilityService.BASE_URL`
   sigue siendo un atributo de clase, pero su valor se resuelve con
   `os.environ.get('NEXT_PUBLIC_APP_URL', 'https://ryzosagri.com')` en
   vez de estar hardcodeado (se evalúa una vez al importar el módulo,
   igual que `process.env.NEXT_PUBLIC_APP_URL` del lado JS).
3. `tests/test_trace_public.mjs` — actualizar la aserción literal de
   `getTraceUrl('abc123')` al nuevo dominio default.
4. `tests/test_tarea14_trazabilidad.py` — actualizar las 2 aserciones
   literales del dominio viejo.
5. `specs/tarea14_trazabilidad_qr.md` — actualizar el invariante de URL
   documentado (`https://app.ryzos.io/trace/{lot_hash}` →
   `https://ryzosagri.com/trace/{lot_hash}`, con nota de que ahora es
   configurable vía `NEXT_PUBLIC_APP_URL`).
6. `.env.example` — agregar `NEXT_PUBLIC_APP_URL=https://ryzosagri.com`
   con comentario explicando el mecanismo por entorno.
7. Verificación:
   - `node --test tests/test_trace_public.mjs` (11 archivos de test en
     el repo corren igual, pero solo este archivo toca el dominio).
   - `python -m pytest tests/test_tarea14_trazabilidad.py -v`.
   - `npm run build` / `npm run lint`.
8. `docs/ESTADO_PROYECTO.md` — nueva entrada documentando el dominio
   oficial y el mecanismo de configuración.
9. Commit + push a `staging`.
