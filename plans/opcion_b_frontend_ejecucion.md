# Plan de Ejecución: Opción B — Frontend WebGIS & Portal de Trazabilidad

## Archivos a crear

| Archivo | Propósito |
|---------|-----------|
| `package.json` | Dependencias Next.js 14, Tailwind, Supabase, Leaflet |
| `next.config.mjs` | Config Next.js (sin cambios especiales necesarios) |
| `tailwind.config.js` | Escanea `app/**` y `components/**` |
| `postcss.config.js` | Plugin Tailwind + Autoprefixer |
| `.env.local.example` | Documenta variables requeridas |
| `app/layout.jsx` | Root layout con metadata y Tailwind globals |
| `app/globals.css` | `@tailwind base/components/utilities` |
| `app/page.jsx` | Dashboard WebGIS (mapa + tabla + realtime) |
| `app/trace/[lot_hash]/page.jsx` | Portal público de trazabilidad (RSC) |
| `lib/supabaseClient.js` | Singleton cliente Supabase anon |
| `components/RiskBadge.jsx` | Semáforo visual de riesgo EUDR |
| `components/EUDRMap.jsx` | Mapa Leaflet (client-only, carga dinámica) |

## Secuencia de instalación y verificación

```bash
npm install
npm run build   # verifica compilación completa
# o: npm run dev  para desarrollo local
```

## Notas de implementación
- `EUDRMap` se importa con `dynamic(..., { ssr: false })` para evitar errores de SSR con Leaflet.
- La suscripción realtime en el dashboard observa la tabla `monitoreo_lotes` y refresca la vista.
- El portal `/trace/[lot_hash]` es un Server Component — no expone la clave anon en el HTML cliente.
- Los íconos de Leaflet se sirven desde CDN de jsDelivr (evita el problema de webpack con archivos de imagen).

## Despliegue a Supabase Live
1. Asegurar política RLS en la vista que permita `role = 'anon'` en SELECT.
2. Configurar en Vercel: `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Habilitar Realtime en Supabase para la tabla `monitoreo_lotes`.
