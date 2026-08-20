# Spec — Botón "Sincronizar Google Drive"

## Contexto

Un prompt `[PROMPT PARA CLAUDE]` pidió un `Route Handler`
(`app/api/gis/sync-drive/route.js`) que invoque
`scripts/etl_drive_to_supabase.py --once` vía `child_process.spawn`, más
un botón `<DriveSyncButton />` en `/dashboard/qc` y `/dashboard/mapa` para
dispararlo manualmente. Llega inmediatamente después de que el usuario
reafirmara (ver addendum en `specs/qfield_zip_ingestor.md`) que la ingesta
QField se mantiene exclusiva vía Google Drive / Python ETL — este prompt
propone exponer ESE MISMO script desde el navegador con un botón.

**Esta tarea NO agrega código nuevo** (salvo esta spec y el addendum en
`qfield_zip_ingestor.md`, ambos pedidos explícitamente en los pasos 1-2
del prompt). No se pausó con `AskUserQuestion` esta vez porque, a
diferencia de la ronda anterior (WASM, una elección de ingeniería
razonable pero costosa), acá hay un hecho técnico verificable que hace
la propuesta **imposible**, no solo arriesgada — no es una decisión de
producto que el usuario deba arbitrar, es una restricción real del script
ya existente.

## Premisas verificadas — dos falsas, una decisiva

1. **`scripts/etl_drive_to_supabase.py` no tiene ningún flag `--once`.**
   Su bloque `if __name__ == "__main__":` (línea 529) espera un argumento
   posicional: `python etl_drive_to_supabase.py <ruta_RYZOS_CLIENTES> [--dry-run]`
   — ni `--once` ni ningún otro flag de "correr una vez" existen en su
   interfaz real.
2. **"Procesa los proyectos... de la organización activa (`ID_Organizacion`)"
   no corresponde a como funciona el script.** `DriveETL.__init__` recibe
   `drive_root` (la carpeta `RYZOS_CLIENTES` completa) y
   `list_pending_zips()` hace `self.drive_root.glob(f"*/{INBOX_DIRNAME}/*.zip")`
   — procesa **todas** las organizaciones bajo esa carpeta en una sola
   corrida (la organización de cada zip se deriva de su propia ruta,
   `RYZOS_CLIENTES/{ID_Organizacion}/RYZOS_INBOX/`), no una organización
   elegida por el llamador. No hay ningún parámetro para acotarlo a una
   sola.
3. **Decisivo: `drive_root` es una ruta de FILESYSTEM LOCAL, no una
   integración real con la API de Google Drive.** No hay ningún SDK de
   Google Drive, OAuth, ni Service Account en este proyecto — "Google
   Drive" acá significa la carpeta que **Google Drive Desktop** sincroniza
   en el disco de una máquina de desarrollador específica (confirmado en
   `[[project_ryzos]]`: `C:\Users\dneys\Mi unidad\RYZOS_CLIENTES\...`). Un
   `Route Handler` de Next.js desplegado (Vercel u otro hosting) **no tiene
   ningún acceso a ese disco** — no es una cuestión de "podría fallar",
   es una ruta que sencillamente no existe fuera de esa máquina. Ni
   siquiera en desarrollo local sería razonable: `child_process.spawn`
   desde el servidor de `npm run dev` requeriría que ESE mismo proceso
   tenga Python + todas las dependencias de `requirements.txt` (incluido
   GDAL, con instalación no trivial en Windows — ver
   `.github/workflows/test_and_deploy.yml`) disponibles en el `PATH`,
   duplicando una herramienta que ya corre perfectamente bien como script
   standalone, a cambio de un acoplamiento frágil nuevo.

## Decisión (primera ronda)

No se construye `app/api/gis/sync-drive/route.js` ni `DriveSyncButton.jsx`
ni se tocan `app/dashboard/qc/page.jsx`/`app/dashboard/mapa/page.jsx`. La
sincronización de Google Drive sigue siendo una operación que el
desarrollador/operador corre manualmente
(`python scripts/etl_drive_to_supabase.py <ruta>`), no algo disparable
desde la aplicación web desplegada.

Si en el futuro se quiere de verdad un botón real de sincronización desde
la web accesible para cualquier usuario/organización, el camino viable
requeriría **una integración real con la API de Google Drive** (OAuth o
Service Account, `google-api-python-client` o equivalente, sin depender
de un mount de Google Drive Desktop en una máquina particular) — una
feature nueva y mucho más grande que "agregar un botón". La ronda
siguiente (ver "Reversión de la decisión" abajo) construyó una versión
más acotada: un botón que solo funciona como conveniencia en desarrollo
local, no una integración real multiusuario.

## Fuera de alcance de la primera ronda (rechazada — ver reversión abajo)

- `app/api/gis/sync-drive/route.js` — no se creó en esta ronda (no tenía
  forma de alcanzar `drive_root` desde un Route Handler desplegado sin
  degradación explícita).
- `app/dashboard/qc/components/DriveSyncButton.jsx` — no se creó (no
  habría ningún endpoint funcional detrás).
- `tests/test_drive_sync_trigger.mjs` — no se creó; no había código nuevo
  que probar todavía.

Ver "Reversión de la decisión" abajo — la ronda siguiente sí implementó
una versión acotada y viable de todo esto.

## Verificación

`python -m pytest tests/ -v` y `node --test tests/*.mjs` se ejecutan igual
para confirmar que no hay regresión (no se tocó ningún archivo de
producción).

## Reversión de la decisión (2026-08-20, prompt de seguimiento)

Un prompt posterior pidió lo mismo, esta vez con degradación EXPLÍCITA:
*"Si no está en entorno local o la ruta no existe, retorna una respuesta
JSON explicativa con estado 200... en lugar de fallar"*. Esto resuelve
exactamente la objeción decisiva de arriba — ya no pretende que
`child_process.spawn` funcione en cualquier entorno; pide que el endpoint
se comporte como una **conveniencia de desarrollo local únicamente**, sin
fingir funcionar donde no puede. Esa es una propuesta distinta y sí
implementable:

- El check de disponibilidad no infiere "¿estoy en local?" a partir de
  `NODE_ENV`/`process.env.VERCEL` (frágil, cada hosting los define
  distinto) — verifica directamente la única condición que importa:
  `fs.existsSync(RYZOS_DRIVE_ROOT)`. Si la variable no está seteada o la
  ruta no existe en el filesystem del proceso Node que atiende el
  request, responde `{ available: false, message: '...' }` con **200**,
  nunca intenta el spawn.
- `RYZOS_DRIVE_ROOT` es una variable de entorno nueva (`.env.local`, no
  commiteada — ver `.env.example`), no una ruta hardcodeada en el código
  fuente (el prompt no la pedía explícitamente, pero hardcodear
  `C:\Users\dneys\Mi unidad\...` en un archivo commiteado habría acoplado
  el repo a la máquina de un desarrollador específico).
- El script Python lee `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (sin
  prefijo `NEXT_PUBLIC_`, ver `CLAUDE.md`) — `.env.local` ya tiene
  `SUPABASE_SERVICE_ROLE_KEY` (agregada en la tarea del Padrón de Socios)
  pero no `SUPABASE_URL` sin prefijo; el Route Handler pasa
  `SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL`
  explícitamente al child process en vez de asumir que ya está en el
  entorno.
- Se corrigen 2 ubicaciones del prompt original: `DriveSyncButton.jsx` va
  en `components/gis/` (no `app/dashboard/qc/components/`) porque se
  reutiliza en 2 páginas de secciones distintas — mismo criterio que
  `MapDashboard.jsx`/`QcConsoleMap.jsx`. La integración en `/dashboard/mapa`
  ("junto al selector de exportación DDS") va dentro de
  `components/gis/MapDashboard.jsx` (donde ese selector realmente vive),
  no en `app/dashboard/mapa/page.jsx` (un wrapper delgado sin esos
  controles) — `app/dashboard/mapa/page.jsx` NO se toca, a pesar de estar
  en la lista de archivos del prompt.
- `lib/driveSyncTrigger.js` (no pedido explícitamente) separa la lógica
  pura (parseo del resumen JSON de stdout, mensaje del toast) de los
  efectos de lado reales del Route Handler (`fs.existsSync`,
  `child_process.spawn`) — necesario para que `tests/test_drive_sync_trigger.mjs`
  pruebe algo real con `node --test`, a diferencia de las 2 tareas
  anteriores sobre este tema (que no tenían ninguna lógica JS nueva que
  probar).
- `scripts/etl_drive_to_supabase.py` gana una única línea nueva de stdout
  al final (`RYZOS_ETL_RESULT_JSON:{...}`) para que el disparador tenga
  métricas estructuradas sin parsear los prints humanos existentes (que
  no cambiaron).
- `components/gis/MapDashboard.jsx::fetchRecords` se extrajo de su
  `useEffect` de montaje a una función del componente, para poder
  reinvocarla como refresh manual tras un sync exitoso — pierde el guard
  `cancelled` que tenía dentro del efecto (mismo criterio ya aceptado en
  `loadPending` de `app/dashboard/qc/page.jsx`, que tampoco lo tiene).

Sigue sin ser una integración real con la API de Google Drive — solo
funciona en la máquina de un desarrollador con `RYZOS_DRIVE_ROOT`
configurada y Python/GDAL instalados. Documentado explícitamente en cada
archivo nuevo para que quede claro en cualquier lectura futura.
