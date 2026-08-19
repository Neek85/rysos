# Spec — Ingestor de Capas Espaciales Multiformato (`/dashboard/mapa`)

## Contexto y corrección de premisas (verificado contra el repo antes de diseñar)

Un prompt `[PROMPT PARA CLAUDE]` pidió este módulo asumiendo tres cosas que
no coinciden con el estado real del repo — verificado antes de escribir
código, mismo criterio que el resto de los módulos de esta serie:

- **La Regla "EUDR Art. 9" de bloquear inserts < 4 ha exigiendo Polygon
  reabre una decisión ya tomada y confirmada.** `docs/adr/ADR-001-gis-sanitization-and-eudr-triggers.md`
  documenta explícitamente que el chequeo de área ≥ 4.0 ha es
  **informativo, nunca bloqueante** (`requiere_revision_area`, sin ningún
  `RAISE EXCEPTION`) — confirmado con el usuario porque RYZOS sirve a
  pequeños productores cafetaleros con parcelas reales por debajo de 4 ha.
  El único lugar del sistema donde ≥4ha/Polygon sí bloquea es
  `lib/eudrDdsExporter.js::validatePlotGeometry` (línea 83-91), y solo al
  **exportar la DDS** (el documento de cumplimiento no puede referenciar
  un perímetro sin cerrar para una parcela grande) — nunca al guardar el
  dato. **Se confirmó con el usuario (`AskUserQuestion`) mantener el mismo
  criterio de ADR-001 para este módulo: informativo, no bloqueante.** El
  Reglamento (UE) 2023/1115 tampoco define un umbral de 4 ha como
  requisito de formato de geometría en su Art. 9 (geolocalización) — ese
  número solo aparece en el reglamento para due diligence simplificada de
  operadores grandes (Art. 10), sin relación con esta regla.
- **No existe columna `estado_gestion`** en ninguna tabla del proyecto
  (`grep` exhaustivo sobre `supabase/migrations/`). La columna real que
  usan las 3 tablas EUDR\_\* y que filtra `vw_monitoreo_web` es
  `estado_revision` (valores `PENDIENTE`/`APROBADO`/`RECHAZADO`).
- **GPKG no tiene un parser JS viable en este stack.** No hay ninguna
  dependencia GDAL/GPKG en `package.json`, y GPKG es SQLite+extensión
  espacial internamente — no existe un lector puro-JS liviano equivalente
  a lo que sí existe para GeoJSON/KML/Shapefile. `gdal-async` requiere
  bindings nativos de GDAL que no corren en una función serverless de
  Vercel (el único lugar del proyecto con GDAL instalado es el entorno de
  CI/Python, ver `requirements.txt`/`.github/workflows/test_and_deploy.yml`,
  un runtime completamente distinto al de este módulo Next.js).
  **Confirmado con el usuario (`AskUserQuestion`): GPKG queda
  explícitamente fuera de alcance de esta tarea.**

## Alcance de formatos soportados

`.geojson` / `.json`, `.kml`, `.zip` (Shapefile — `.shp`+`.dbf` dentro del
zip, `.prj` opcional para reproyección automática a WGS84). Parseo 100%
client-side, sin subir el archivo crudo a ningún servidor — solo las
geometrías ya normalizadas a GeoJSON viajan a la Server Action.

- GeoJSON/KML: reutilizan el mismo patrón de conversión que
  `lib/geometryImport.js` (creado para el modal de Parcela de
  `/dashboard/socios`), generalizado en `lib/gisParser.js` para aceptar
  **todas** las Features de una `FeatureCollection` (el módulo de Socios
  solo tomaba la primera — acá una capa completa con N features es el
  caso de uso normal).
- Shapefile-ZIP: nueva dependencia `shpjs` (confirmada en el registro
  npm, v6.2.0, dependencias puras JS — `but-unzip`/`parsedbf`/`proj4`, sin
  binarios nativos, ya usada ampliamente para este propósito exacto en
  proyectos Next.js/browser).
- GPKG: **fuera de alcance**, documentado arriba.

## Tablas destino y ruteo de escritura

El usuario elige la tabla destino en el modal (no se infiere automáticamente
del contenido del archivo — una capa de polígonos de uso de suelo y una de
parcelas son indistinguibles por geometría sola):

- **`PADRON_PARCELAS`**: delega en `createParcela`
  (`lib/actions/sociosActions.js`, ya existente) en vez de reimplementar el
  insert — hereda automáticamente su validación Zod completa
  (`parcelaSchema`, incluida la regla "hectáreas totales > 0", que un
  archivo espacial puro normalmente NO trae como atributo — esas filas
  fallan con el mismo mensaje que ya usa el resto del módulo Socios, no
  uno nuevo) y su sanitización de geometría vía RPC `fn_sanitize_geometry`
  (única de las 4 tablas destino sin trigger de sanitización automático,
  ver `specs/padron_web_socios.md`).
- **`EUDR_MONITOREO` / `EUDR_USO_SUELO` / `EUDR_INSTALACIONES`**: primer
  path de escritura del frontend hacia estas 3 tablas (antes solo las
  escribían el ETL de Python y ediciones manuales en QGIS Desktop, ver
  `CLAUDE.md`). Insert nuevo en `lib/actions/gisActions.js`, deliberadamente
  **sin** llamar a `fn_sanitize_geometry` ni calcular área a mano — las 3
  tablas ya tienen un trigger `BEFORE INSERT OR UPDATE OF <col_geom>`
  (`trg_sanitize_geom_monitoreo/uso_suelo/instalaciones`,
  `supabase/migrations/20260818_gis_core_sanitization.sql`) que sanitiza
  la geometría (SRID 4326, `ST_MakeValid`, 6 decimales) y calcula
  `area_calculada_ha`/`requiere_revision_area` automáticamente en cuanto
  llega el WKT — duplicar esa lógica en la Server Action sería redundante
  y arriesgaría desincronizarse del trigger real si alguna vez cambia.
  `estado_revision` se fija **siempre** en `'PENDIENTE'` (nunca
  `'APROBADO'` directo) — un registro subido desde este módulo entra al
  mismo flujo de revisión QGIS QC (Fase 3, ver `CLAUDE.md`) que ya usan
  los datos capturados en campo vía QField; por eso **no aparecerá en
  `/dashboard/mapa`** (que consume `vw_monitoreo_web`, filtrado
  estrictamente a `estado_revision = 'APROBADO'`) hasta que alguien lo
  apruebe en QGIS Desktop — el modal lo indica explícitamente en el toast
  de confirmación para que no se lea como un bug ("¿por qué no veo lo que
  subí?").

## Auto-vinculación de propiedades del archivo

`lib/gisParser.js::autoMatchProperties` inspecciona las propiedades de
cada Feature (case-insensitive) contra una lista de candidatos por campo
destino — mismo patrón "candidate-list" ya usado en
`scripts/etl_drive_to_supabase.py::resolve_field_with_fallback`, porque
los nombres de atributo varían según el software de origen del archivo
(QGIS, ArcGIS, Google Earth, etc.):

- `PADRON_PARCELAS`: `ID_Socio`, `parcela_codigo`.
- `EUDR_MONITOREO`: `ID_Socio`, `ID_Parcela_Fija`.
- `EUDR_USO_SUELO`: `id_parcela`, `tipo_uso`.
- `EUDR_INSTALACIONES`: `id_parcela`, `tipo_infra`.

Todos los valores auto-detectados quedan editables en la tabla de vista
previa del modal antes de confirmar — ningún campo se escribe a ciegas.

## Vista previa obligatoria antes de escribir

Mismo criterio que `ImportPadronModal.jsx` (CSV masivo de Socios): el
archivo se parsea y se muestra en una tabla fila-por-Feature con el tipo
de geometría, los campos auto-detectados (editables), y validación básica
(campos requeridos por tabla destino no vacíos) **antes** de habilitar
"Confirmar Carga". Un error en una fila individual no aborta el resto del
lote (`uploadGeoSpatialBatch` en `lib/actions/gisActions.js` — mismo
patrón de "creados/fallidos con detalle" que `handleConfirmImport` en
`ImportPadronModal.jsx`).

## Resolución de organización activa

Este visor no tiene selector de organización propio — igual que
`handleExportDDS` en `components/gis/MapDashboard.jsx`, se reutiliza
`resolveOrganizationId` (`lib/eudrDdsExporter.js`) sobre los registros
`vw_monitoreo_web` ya cargados en el mapa. **Limitación heredada:** si la
organización activa todavía no tiene ningún registro `APROBADO` visible
en el mapa, no hay forma de resolver su `ID_Organizacion` desde este
componente — la carga queda bloqueada con un mensaje claro, mismo límite
que ya tiene hoy el botón "Exportar DDS". No se agregó un selector de
organización nuevo (fuera de alcance; el proyecto no tiene aún un
concepto de "organización activa" centralizado fuera de los datos ya
cargados, ver el gotcha de RLS en `CLAUDE.md`).

## Fuera de alcance de esta tarea

- Soporte GPKG (requiere un servicio servidor con GDAL, no existe hoy).
- Un selector de organización activa centralizado (no existe en ningún
  otro módulo del proyecto tampoco).
- Reproyección de sistemas de coordenadas distintos a los que `shpjs`
  resuelve automáticamente vía `.prj` — si el `.prj` falta o usa un CRS
  que `proj4` (dependencia interna de `shpjs`) no reconoce, la Feature se
  descarta con un error explícito en la vista previa, no se asume WGS84
  a ciegas.

## Criterios de aceptación

- AC1: `lib/gisParser.js` parsea GeoJSON/KML/Shapefile-ZIP a un array de
  `{ geometry, properties }` — todas las Features de la colección, no
  solo la primera.
- AC2: `autoMatchProperties` detecta las propiedades relevantes
  case-insensitive según la tabla destino, sin lanzar si no encuentra
  ninguna coincidencia (devuelve `null` por campo, no un error).
- AC3: El área/polígono ≥4ha nunca bloquea un insert — ninguna función de
  `lib/actions/gisActions.js` calcula ni valida área; ese cálculo vive
  exclusivamente en el trigger de base de datos (EUDR\_\*) o no aplica
  (`PADRON_PARCELAS`, que no relaciona geometría con hectáreas).
- AC4: Toda carga hacia `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`
  fija `estado_revision = 'PENDIENTE'` sin excepción — no hay ningún path
  de código en `gisActions.js` que pueda escribir `'APROBADO'` directo.
- AC5: Una Feature inválida (tabla destino `PADRON_PARCELAS` sin
  hectáreas, o campo requerido vacío en tablas EUDR\_\*) no aborta el
  resto del lote — se reporta individualmente en el resumen de carga.
- AC6: `npm run build` compila sin errores.
