# Spec — Ingestión de Paquete QField ZIP (.gpkg + DCIM/) en `/dashboard/mapa`

## Contexto y corrección de premisas (verificado contra el repo antes de diseñar)

Un prompt `[PROMPT PARA CLAUDE]` pidió un Route Handler Next.js
(`app/api/gis/qfield-upload/route.js`) que reciba un `.zip` QField
(`data.gpkg` + carpeta `DCIM/`), lo parsee con **Fiona/GeoPandas** y suba
las fotos a Supabase Storage, insertando en PostGIS en estado `PENDIENTE`.

**Esta tarea NO agrega código nuevo.** Dos premisas verificadas antes de
escribir nada:

1. **La misma sesión, dos tareas antes, ya se confirmó explícitamente con
   el usuario (`AskUserQuestion`, ver `specs/gis_ingestor_web.md`) dejar
   GPKG fuera de alcance del Ingestor de Capas Espaciales web** —
   `gdal-async` (el único camino real para leer GPKG, que es
   SQLite+extensión espacial internamente) requiere bindings nativos de
   GDAL que **no corren en una función serverless de Vercel**, el hosting
   real de este proyecto Next.js. No existe ninguna dependencia
   GDAL/Fiona/GeoPandas en `package.json`, y no puede haberla en un Route
   Handler Next.js — Fiona/GeoPandas son librerías **Python**, no
   ejecutables desde JavaScript/Node.js sin un puente externo (proceso
   Python separado o servicio HTTP aparte). El prompt pide textualmente lo
   que ya se descartó, con el mismo motivo técnico ya documentado.
2. **La ingestión de paquetes QField ZIP (`.gpkg` + `DCIM/`) ya existe,
   está completa y probada:** `scripts/etl_drive_to_supabase.py` (Python,
   Fiona/GeoPandas reales, GDAL disponible en el entorno de CI/scripts —
   ver `requirements.txt`) ya hace exactamente lo que pide el prompt:
   - Descomprime el `.zip`, resuelve `data.gpkg` por prefijo de capa
     (`find_monitoreo_layer`, `classify_layers`), tolera zips anidados
     (`extract_nested_zips`, ej. `DCIM.zip` dentro del paquete principal).
   - Extrae fotos de `DCIM/` (o donde estén) y las sube a Supabase Storage
     (bucket `evidencias_eudr`), emparejando por `os.path.basename()` y
     guardando el `storage_path` real en `evidencia_foto`
     (`resolve_photo_basename`, endurecido contra el patrón "NaN es
     truthy" — ver `[[project_ryzos]]`).
   - Inserta en las 3 tablas EUDR_MONITOREO/USO_SUELO/EUDR_INSTALACIONES,
     siempre con `estado_revision = 'PENDIENTE'` (nunca `APROBADO`
     directo), listas para auditoría en la Consola QC — el mismo
     requisito del paso 4 de este prompt.
   - Geometría insertada en `EPSG:4326` (reproyectada si hace falta) —
     mismo requisito del prompt, ya cubierto.
   - Cubierto por `tests/test_fase2_etl.py`, `tests/test_gis_core_sanitization.py`
     y el harness E2E (`scripts/run_e2e_etl_test.py`,
     `tests/test_e2e_etl_drive.py`).
   La única diferencia real con lo que pide el prompt es el **disparador**:
   hoy corre vía polling de una carpeta tenant-first de Google Drive
   (`RYZOS_CLIENTES/{ID_Organizacion}/RYZOS_INBOX/*.zip`), no vía un botón
   de carga directo en `/dashboard/mapa`. Ese es un cambio de UX/disparador
   (exponer el mismo pipeline por un botón web en vez de una carpeta
   vigilada), no un parser nuevo — y requeriría de todos modos alguna de
   las 2 opciones de arquitectura de abajo para conectar un botón del
   navegador con un proceso Python real.

## Decisión (confirmada con el usuario vía `AskUserQuestion`)

Se evaluaron 3 caminos posibles para reconciliar "subida web" con "el
parser real es Python/GDAL":

1. **No construir nada nuevo (elegida).** El pipeline ya existe y
   funciona — se documenta esta realidad en vez de escribir un Route
   Handler que no podría ejecutar Fiona/GeoPandas en el runtime real
   (Vercel serverless, sin GDAL), o un parser GPKG paralelo redundante.
2. Microservicio HTTP Python aparte (FastAPI/Flask + GDAL) hosteado por
   separado (Render/Railway/VM propia), con un Route Handler delgado en
   Next.js que reenvíe el `.zip` — arquitectura real y viable, pero
   requiere aprovisionar infraestructura nueva que no se puede decidir
   unilateralmente (mismo tipo de decisión ya diferida una vez para el
   Dossier PDF, ver `specs/traces_eudr_dossier_audit.md`).
3. Parser GPKG en JS/WASM puro (`sql.js` + parseo manual del binary header
   GeoPackage sobre las columnas de geometría WKB) — técnicamente viable
   sin bindings nativos, pero nunca antes evaluado en este proyecto; mayor
   riesgo de bugs sutiles de geometría/CRS que Fiona/GDAL ya resuelven de
   forma robusta y probada.

**El usuario confirmó la opción 1.** Si en el futuro se quiere de verdad
un botón de carga web para paquetes QField (no solo Drive), retomar esta
spec y elegir entre las opciones 2/3 — ninguna implementada hoy.

## Fuera de alcance de esta tarea

- `app/api/gis/qfield-upload/route.js` — no se crea (no puede ejecutar
  Fiona/GeoPandas en el runtime real).
- Cambios a `app/dashboard/mapa/components/CargaEspacialModal.jsx` — no se
  agrega la opción "Proyecto QField (.zip con .gpkg + DCIM)" a los
  formatos aceptados, porque no habría ningún parser real detrás
  funcionando en producción; agregarla sería una opción de UI que siempre
  falla.
- `lib/actions/gisActions.js` — sin cambios (mismo motivo que las 3 tareas
  anteriores de esta sesión: no hay ninguna lógica de parseo de servidor
  que agregar ahí para este caso).
- `tests/test_qfield_zip_ingestor.mjs` — no se crea; no hay código
  nuevo que probar. La cobertura real de este flujo (Python) ya existe en
  `tests/test_fase2_etl.py` y afines.

## Verificación

`python -m pytest tests/ -v` y `node --test tests/*.mjs` se ejecutan igual
para confirmar que no hay regresión (no se tocó ningún archivo de
producción) — ver conteos en el commit de esta tarea.

## Formalización de la decisión (2026-08-19, misma sesión, dos tareas después)

Un prompt de seguimiento pidió exactamente la opción 3 de arriba (parser
GPKG en JS/WASM vía `jszip`+`sql.js`) — se pausó de nuevo con
`AskUserQuestion` para confirmar que era un cambio de dirección real y no
el generador de prompts re-proponiendo lo ya descartado. El usuario
interrumpió esa pregunta y envió en su lugar un prompt nuevo
(`specs/drive_sync_trigger.md`) que **reafirma explícitamente esta
decisión** ("la ingesta de paquetes QField se mantiene de forma exclusiva
vía Google Drive / Python ETL para evitar limitaciones de Vercel/WASM") —
confirma que la opción 1 sigue siendo la vigente. Ver
`specs/drive_sync_trigger.md` para el siguiente intento relacionado
(disparar el mismo script Python vía un botón web) y por qué tampoco es
viable, con una razón todavía más definitiva que la de este documento.
