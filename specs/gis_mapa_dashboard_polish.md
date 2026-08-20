# Spec — Polish de `/dashboard/mapa`: modal, geoman en español, nombre de productor, export DDS

## Contexto y corrección de premisas (verificado contra el repo antes de diseñar)

Un prompt `[PROMPT PARA CLAUDE]` pidió 4 correcciones sobre `/dashboard/mapa`.
Verificado antes de escribir código:

- **Rutas de archivo incorrectas.** El prompt lista
  `app/dashboard/mapa/components/MapDashboard.jsx` y
  `app/dashboard/mapa/components/DdsExportButton.jsx` — el primero en
  realidad vive en `components/gis/MapDashboard.jsx`, y el segundo **no
  existe**: el botón de exportar DDS está inline dentro de
  `MapDashboard.jsx` (`handleExportDDS`), no en un componente aparte.
- **`socio_nombre`/`socio_apellido` no existen.** `PADRON_SOCIOS` tiene un
  único campo de nombre: `socio_nombre_completo` (confirmado en
  `docs/schema_live.md`), ya catalogado como PII desde Tarea 14.
- **El campo `productor` de `vw_monitoreo_web` ya resuelve algo, pero nunca
  un nombre real:** es `COALESCE(EUDR_MONITOREO."ID_Socio",
  EUDR_MONITOREO.nuevo_productor_nombre)` — un código interno (ej.
  "JS-00002") o texto libre del técnico, nunca `PADRON_SOCIOS.socio_nombre_completo`.
  Confirmado en vivo contra el dev server: el popup de una instalación real
  mostraba "Productor: Sin registrar" (esa parcela no tiene ninguna visita
  de EUDR_MONITOREO con productor cargado) — el síntoma del prompt es real,
  aunque la causa exacta ("dice JS-00002") no se pudo reproducir con los
  datos actuales de `ORG-COOP-NORTE`.
- **Gap real no mencionado por el prompt, encontrado al diseñar la
  corrección anterior:** `MapDashboard.jsx` consulta `vw_monitoreo_web`
  **sin ningún filtro `ID_Organizacion`** — el mismo patrón de exposición
  cross-tenant ya encontrado y corregido una vez en
  `view_eudr_dashboard_aprobados`
  (`20260818_rls_multi_tenant_fortification.sql`). Agregar el nombre real
  del socio a esta vista sin acompañarlo de un filtro hace que ese nombre
  (PII) quede expuesto a cualquier organización que cargue el dashboard, no
  solo a la propia. **Se pausó con `AskUserQuestion` antes de implementar**
  — el usuario confirmó: agregar el nombre real igual, pero acompañado de
  un fetch en dos pasos que cierre el gap del lado del cliente (ver abajo).
  No existe hoy ningún mecanismo de sesión/organización activa en el
  frontend (anon key sin Supabase Auth) — no se puede filtrar server-side
  sin antes saber qué organización es "la del usuario", así que se
  reutiliza la misma heurística ya usada en otros módulos ("primera
  organización de los registros cargados"), pero resuelta con una consulta
  liviana (`select('ID_Organizacion').limit(1)`) ANTES de la consulta
  completa — a diferencia del patrón existente en `resolveOrganizationId`
  (que deriva la organización de datos YA cargados de todas las orgs), acá
  la organización se resuelve primero y la consulta completa (con nombres,
  geometrías, fotos) se filtra por ella — ninguna fila de otra organización
  llega nunca al navegador.
- **No existe un formato "CSV TRACES UE" ni "Puntos de Lista de
  Productores".** El exportador real (`lib/eudrDdsExporter.js::exportTracesDDS`)
  genera y descarga automáticamente DOS archivos en cada click: un JSON
  (declaración completa, agrupada por parcela) y un GeoJSON (solo las
  geometrías) — eso sí es el problema real que describe el prompt
  ("descarga automática simultánea"), pero las dos modalidades que propone
  como solución (polígonos GeoJSON/CSV vs. puntos/lista de productores CSV)
  no corresponden a ningún formato real ni documentado en este proyecto.
  **Corrección de alcance:** se deja que el usuario elija explícitamente
  entre las DOS modalidades que sí existen — "DDS Completo (JSON)" y
  "Geometrías (GeoJSON)" — sin inventar un esquema CSV nuevo sin
  especificación real detrás.
- **No existe `npm test`** (ya documentado en `CLAUDE.md`/ADR-002) — se usa
  `node --test tests/*.mjs` + `python -m pytest tests/ -v`.

## Cambios

1. **`supabase/migrations/20260819_vw_monitoreo_web_productor_nombre.sql`**:
   agrega `productor_nombre` a `vw_monitoreo_web` vía
   `LEFT JOIN PADRON_SOCIOS ps ON ps."ID_Socio" = COALESCE(src.productor, mon.productor)`,
   `COALESCE(ps.socio_nombre_completo, src.productor, mon.productor)`. `productor`
   (el valor crudo) se conserva sin cambios.
2. **`components/gis/MapDashboard.jsx`**:
   - Fetch en dos pasos: `select('ID_Organizacion').limit(1)` para resolver
     la organización activa, luego el fetch completo con
     `.eq('ID_Organizacion', orgId)` — cierra el gap cross-tenant para esta
     página.
   - `tooltipHtml`/`popupHtml` usan `record.productor_nombre` (con el mismo
     fallback "Sin registrar" que ya existía).
   - `map.pm.setLang('es')` tras inicializar geoman (afecta también al
     Editor Vectorial).
   - Selector de modalidad de exportación DDS (`<select>` + botón) en vez
     de un solo botón que descarga los 2 archivos siempre.
3. **`app/dashboard/mapa/components/VectorEditorTools.jsx`**: sin cambios
   de comportamiento — `map.pm.setLang('es')` ya cubre sus controles
   porque comparten la misma instancia de mapa que `MapDashboard.jsx`.
4. **`components/gis/QcConsoleMap.jsx`** (fuera del alcance original del
   prompt, agregado por consistencia): también llama
   `map.pm.setLang('es')` — usa geoman para el modo de edición de vértices
   de la Consola QC; dejarlo en inglés mientras `/dashboard/mapa` pasa a
   español habría sido inconsistente.
5. **`lib/eudrDdsExporter.js`**: `exportTracesDDS(records, organizationId, format)`
   — `format` es `'json'` (default) o `'geojson'`, descarga SOLO ese
   archivo. Se agrega `EXPORT_FORMATS` (array `{value, label}`) para que la
   UI no hardcodee las opciones dos veces.
6. **`app/dashboard/mapa/components/CargaEspacialModal.jsx`**: la tabla de
   vista previa gana `overflow-x-auto` propio (antes solo el modal entero
   tenía `overflow-y-auto`, sin guarda horizontal) y las celdas de texto
   pierden el ancho fijo `w-28` a favor de `min-w-[7rem]` — evita que el
   navegador comprima/trunque el contenido cuando los labels son largos
   ("Código Interno de Parcela") en vez de mostrar scroll horizontal.

## Criterios de aceptación

- AC1: `EXPORT_FORMATS` tiene exactamente 2 modalidades reales (json,
  geojson) — ninguna llamada a `exportTracesDDS` descarga más de un
  archivo.
- AC2: `MapDashboard.jsx` nunca solicita registros de más de una
  organización en la consulta completa (columna `productor_nombre`
  incluida).
- AC3: `npm run build` compila sin errores.
