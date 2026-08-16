# Especificación: Opción B — Frontend WebGIS & Portal de Trazabilidad Pública

## Contexto
RYZOS expone los datos EUDR aprobados a dos audiencias:
1. **Operadores internos** (dashboard WebGIS con semáforo de riesgo satelital)
2. **Público general** (portal de trazabilidad por QR/hash, sin PII)

## Invariantes de seguridad
- La vista `view_eudr_dashboard_aprobados` solo retorna filas con `estado_revision = 'APROBADO'`.
- **Ninguna respuesta pública expone**: `socio_dni`, `socio_nombre`, `socio_nombre_completo`, `conyuge_dni`.
- La clave `NEXT_PUBLIC_SUPABASE_ANON_KEY` es la única expuesta al browser; la service role key nunca sale al frontend.
- El acceso a la vista pública requiere que la política RLS de Supabase permita `anon` en modo lectura.

## Componentes

### 1. Dashboard WebGIS (`app/page.jsx`)
- Consume `view_eudr_dashboard_aprobados` con el cliente Supabase anon.
- Suscripción realtime a la tabla `monitoreo_lotes` para refetch automático.
- Mapa Leaflet (`react-leaflet`) con polígonos coloreados por semáforo de riesgo satelital:
  - `CRITICO` → rojo `#ef4444`
  - `ALTO` → naranja `#f97316`
  - `BAJO` → verde `#22c55e`
  - `null` / pendiente → gris `#94a3b8`
- Tabla de lotes con columnas: Código Parcela, Hectáreas, Estado, Riesgo EUDR, Hash Lote, enlace → Trazabilidad.

### 2. Portal de Trazabilidad Pública (`app/trace/[lot_hash]/page.jsx`)
- Server Component (RSC) — sin estado cliente.
- Busca `lot_hash` en `view_eudr_dashboard_aprobados`.
- Muestra: código parcela, hectáreas, estado, riesgo satelital, regulación, fecha de corte.
- **No muestra** campos PII.
- Si el lote no existe o no está aprobado: mensaje de "no encontrado".

## Variables de entorno requeridas
```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

## Stack técnico
- Next.js 14+ (App Router)
- Tailwind CSS 3
- `@supabase/supabase-js` ^2
- `leaflet` ^1.9 + `react-leaflet` ^4 (carga dinámica `ssr: false`)

## Criterios de Aceptación
- AC1: El dashboard muestra solo filas con `estado_revision = 'APROBADO'`.
- AC2: El mapa colorea polígonos según `riesgo_satelital` con el semáforo definido.
- AC3: `/trace/<hash>` muestra datos del lote sin ningún campo PII.
- AC4: `/trace/<hash_inexistente>` retorna mensaje de lote no encontrado.
- AC5: `next build` completa sin errores de TypeScript/ESLint bloqueantes.
