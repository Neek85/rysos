# Spec — Botón "Sincronizar Google Drive" (rechazado)

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

## Decisión

No se construye `app/api/gis/sync-drive/route.js` ni `DriveSyncButton.jsx`
ni se tocan `app/dashboard/qc/page.jsx`/`app/dashboard/mapa/page.jsx`. La
sincronización de Google Drive sigue siendo una operación que el
desarrollador/operador corre manualmente
(`python scripts/etl_drive_to_supabase.py <ruta>`), no algo disparable
desde la aplicación web desplegada.

Si en el futuro se quiere de verdad un botón real de sincronización desde
la web, el camino viable requeriría **una integración real con la API de
Google Drive** (OAuth o Service Account, `google-api-python-client` o
equivalente, sin depender de un mount de Google Drive Desktop en una
máquina particular) — una feature nueva y mucho más grande que "agregar un
botón", fuera de alcance de este prompt, y que necesitaría su propia spec
y decisión explícita del usuario antes de empezar.

## Fuera de alcance de esta tarea

- `app/api/gis/sync-drive/route.js` — no se crea (no tiene forma de
  alcanzar `drive_root` desde un Route Handler desplegado).
- `app/dashboard/qc/components/DriveSyncButton.jsx` — no se crea (no
  habría ningún endpoint funcional detrás).
- `app/dashboard/qc/page.jsx` / `app/dashboard/mapa/page.jsx` — sin
  cambios.
- `tests/test_drive_sync_trigger.mjs` — no se crea; no hay código nuevo
  que probar.

## Verificación

`python -m pytest tests/ -v` y `node --test tests/*.mjs` se ejecutan igual
para confirmar que no hay regresión (no se tocó ningún archivo de
producción).
