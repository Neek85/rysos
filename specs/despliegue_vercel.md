# SPEC: Despliegue a Producción en Vercel

## 1. Objetivo
Preparar el frontend Next.js de RYZOS (`https://github.com/Neek85/rysos.git`) para su despliegue en producción en Vercel, incluyendo cabeceras de seguridad HTTP y la validación local del build antes de importar el repositorio en el dashboard de Vercel.

## 2. Invariantes de Despliegue
- **Framework Auto-detectado:** El proyecto no tiene `src/`, usa `app/` router de Next.js 14 (confirmado en `package.json`/`jsconfig.json`) — Vercel lo detecta como `Next.js` sin `buildCommand`/`outputDirectory` custom. `vercel.json` solo declara `framework: "nextjs"` explícitamente y las cabeceras de seguridad; no reemplaza la detección automática.
- **Variables de Entorno Públicas, No Secretas en `vercel.json`:** `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ver `.env.example`/`.env.local.example`) son las únicas variables que el frontend necesita — ambas están diseñadas para exponerse en el bundle del navegador (protegidas por RLS del lado de Supabase, no por secreto), así que se configuran en el dashboard de Vercel (Project → Settings → Environment Variables), nunca hardcodeadas en `vercel.json` ni en ningún archivo versionado.
- **Sin Service Role Key en el Frontend:** `SUPABASE_SERVICE_ROLE_KEY` (usada solo por scripts Python server-side, ver `requirements.txt`/`scripts/`) NO debe configurarse como variable de Vercel — el frontend nunca la necesita y hacerlo expondría un bypass de RLS en el bundle del navegador.
- **Build Reproducible:** `npm run build` debe compilar sin errores localmente antes de importar el repo en Vercel — un fallo de build local es el mismo fallo que bloqueará el deploy remoto.
- **Cabeceras de Seguridad Mínimas:** Toda ruta (`/(.*)`) responde con `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictiva (cámara/micrófono/geolocalización deshabilitados — el WebGIS no usa `navigator.geolocation`, confirmado por búsqueda en el código) y `Strict-Transport-Security` con `preload`.

## 3. Criterios de Aceptación
- [ ] `vercel.json` existe en la raíz con `framework: "nextjs"` y el bloque `headers` descrito arriba.
- [ ] `npm run build` compila exitosamente en local (sin errores de tipo/lint que bloqueen el build de producción).
- [ ] El repositorio `Neek85/rysos` está importado como proyecto en Vercel, con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` configuradas en Environment Variables (Production).
- [ ] El primer deploy en Vercel resuelve `https://<proyecto>.vercel.app/dashboard/mapa` sin errores 500 y con las cabeceras de seguridad presentes en la respuesta (verificable con `curl -I`).

## 4. Pasos Manuales Fuera del Repositorio (Dashboard de Vercel)
Estos pasos requieren la sesión del usuario en vercel.com y **no pueden automatizarse desde este entorno** (login, selección de proyecto y clic en "Deploy" son acciones que solo el usuario puede realizar):
1. Iniciar sesión en Vercel con la cuenta de GitHub (`Neek85`).
2. "Add New…" → "Project" → importar `Neek85/rysos`.
3. En "Environment Variables", agregar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` con los valores reales de la instancia Supabase de producción (ver `.env.local` local, no versionado).
4. Presionar "Deploy" y verificar que el build remoto termine en estado `Ready`.
