# Spec — Editor Vectorial WebGIS (`/dashboard/mapa`)

## Contexto y corrección de premisas (verificado contra el repo antes de diseñar)

- **`app/dashboard/mapa/components/MapDashboard.jsx` no existe** — el
  componente real es `components/gis/MapDashboard.jsx` (`app/dashboard/mapa/page.jsx`
  lo importa desde ahí). El prompt ya contemplaba esto ("o componente
  derivado"); se edita el archivo real.
- **No existe script `npm test`** (mismo hallazgo que las 2 tareas
  anteriores de esta sesión — `package.json` solo tiene
  `dev`/`build`/`start`/`lint`). Verificación real: `node --test tests/*.mjs`
  + `python -m pytest tests/ -v`.
- **`leaflet-draw` vs. `leaflet-geoman-free`:** se eligió
  `@geoman-io/leaflet-geoman-free` (v2.20.0, mantenido activamente —
  `leaflet-draw` v1.0.4 lleva años sin release real). Decisión técnica sin
  impacto de negocio, no requirió pausar: (1) geoman se adjunta al `L.Map`
  vía `L.Map.addInitHook`, igual que el resto del código ya usa Leaflet de
  forma imperativa (`L.map()`, `L.tileLayer()`, refs — nunca componentes
  react-leaflet, aunque `react-leaflet` está en `package.json`); (2) la
  terminología del prompt ("modo de edición de vértices (`editMode`)")
  coincide literalmente con la opción `editMode` de `map.pm.addControls()`
  de geoman, y geoman ya trae `allowSelfIntersection: false` incorporado
  (prevención nativa mientras se dibuja) — se usa además una validación
  `@turf/kinks` explícita como defensa adicional al confirmar el guardado,
  tal como pidió el prompt.
- **`@turf/turf` (paquete meta) vs. subpaquetes:** se instalan
  `@turf/area` + `@turf/kinks` en vez del meta-paquete completo — mismo
  resultado funcional, bundle de cliente más chico (el resto de `@turf/turf`
  no se usa en este módulo).

## Alcance

Un editor de dibujo/edición vectorial embebido en el mapa de
`/dashboard/mapa` (`components/gis/MapDashboard.jsx`), reutilizando la
capa satelital ya existente (Google Satélite Híbrido/Esri World Imagery/
OSM, ya configuradas). Herramientas habilitadas en la barra de geoman:
dibujar Polígono, dibujar Marcador (Punto), modo edición de vértices
(`editMode`), arrastre (`dragMode`), eliminar (`removalMode`). Deliberadamente
**no** se habilitan círculo/rectángulo/polilínea/texto/rotar/cortar — fuera
del alcance pedido ("Polígonos cerrados y Puntos").

## Restricción de tipo de geometría por tabla destino

Reutiliza una regla ya documentada como comentario en el propio
`MapDashboard.jsx` (jerarquía visual de 3 niveles, no inventada para esta
tarea): "`EUDR_USO_SUELO` nunca aporta geometrías puntuales" / "`EUDR_INSTALACIONES`
... siempre punto — nunca aporta polígonos". Extendida a las 4 tablas
destino (`lib/gisTargetTables.js::TARGET_TABLE_GEOMETRY_TYPES`):

- `PADRON_PARCELAS`: solo `Polygon` (una parcela se delimita con un
  perímetro, mismo criterio implícito en `lib/eudrDdsExporter.js`).
- `EUDR_MONITOREO`: `Polygon` o `Point` (geometría genérica según cómo
  capturó el técnico, ya documentado en `docs/schema_live.md`).
- `EUDR_USO_SUELO`: solo `Polygon`.
- `EUDR_INSTALACIONES`: solo `Point`.

La barra de dibujo no restringe qué herramienta usar (dibujar Polígono o
Punto siempre está disponible) — la restricción se aplica **al guardar**:
si el tipo de geometría dibujado no coincide con el permitido para la
tabla destino elegida, se rechaza con un mensaje claro y **la geometría
dibujada no se pierde** (el usuario puede cambiar la tabla destino en vez
de tener que redibujar).

## Validación topológica en tiempo real

`@turf/area` calcula el área en tiempo real mientras se dibuja/edita
(evento `pm:vertexadded` durante el dibujo, `pm:edit`/`pm:markerdragend`
tras finalizar) — **estimación de UI, no autoritativa**: usa una esfera
aproximada (mismo criterio que el resto de `@turf`), mientras que el valor
real que queda en `area_calculada_ha` lo calcula PostGIS server-side con
`ST_Area(geography)` (`fn_calcular_area_ha`, ver ADR-001) — pueden diferir
en la práctica por unos pocos m², sin relevancia para el propósito de
"vista previa mientras dibujas".

`@turf/kinks` detecta auto-intersecciones (kinks) en el polígono dibujado
o editado — si encuentra alguna, el botón "Guardar" queda deshabilitado
con un mensaje explícito. Es una validación **redundante** a la
prevención nativa de geoman (`allowSelfIntersection: false`, que ya
impide completar/arrastrar un polígono a un estado inválido durante la
interacción) — se mantiene como defensa adicional explícita porque el
prompt la pidió por nombre ("kinks/self-intersections") y porque cubre el
caso de que la opción nativa de geoman no alcance a bloquear algún flujo
de edición específico.

**Ninguna de las dos validaciones (área, kinks) bloquea el *dibujo* en
sí** — geoman ya lo hace nativamente donde corresponde. `@turf/kinks`
bloquea específicamente el botón "Guardar" (server round-trip), no la
interacción de dibujo/arrastre en el mapa.

## Flujo de guardado

Al finalizar una geometría (`pm:create` de geoman), aparece un panel
lateral compacto (`VectorEditorPanel`, no un modal de pantalla completa —
el mapa debe seguir visible para que el usuario compare la geometría
dibujada contra la imagen satelital) con:

1. Selector de tabla destino (mismo `GIS_TARGET_TABLES` que
   `CargaEspacialModal.jsx` — ver `specs/gis_ingestor_web.md`).
2. Área estimada (si es Polygon) y aviso de auto-intersección si aplica.
3. Campos manuales por tabla destino (mismos `TARGET_TABLE_FIELDS` que
   `CargaEspacialModal.jsx`, ahora movidos a `lib/gisTargetTables.js`
   para que ambos módulos compartan una sola fuente de verdad — no hay
   properties de archivo que auto-detectar acá, todo es entrada manual).
4. Botones Cancelar (descarta la geometría dibujada) / Guardar.

"Guardar" llama a `uploadGeoSpatialFeature` (`lib/actions/gisActions.js`,
ya existente, sin cambios — reutilizado tal cual del Ingestor de Capas
Espaciales) con la geometría dibujada como si fuera una Feature parseada
de un archivo (`{ geometry, properties: {} }`). Mismo comportamiento
heredado sin duplicar código: `PADRON_PARCELAS` delega en `createParcela`
(hectáreas > 0 requerido, puede fallar si el usuario no las completa —
fuera del alcance de este panel agregar los 7 campos de hectáreas; el
mensaje de error de Zod ya indica qué falta), las 3 tablas EUDR\_\*
insertan con `estado_revision = 'PENDIENTE'` sin calcular área a mano (el
trigger de BD ya existente lo hace).

Tras guardar con éxito, la capa de dibujo temporal se remueve del mapa
(`layer.remove()`) — no se recarga automáticamente
`vw_monitoreo_web` (los registros EUDR\_\* quedan `PENDIENTE`, no
aparecerían de todas formas hasta ser aprobados en QGIS QC).

## Resolución de organización activa

Mismo criterio y misma limitación que `CargaEspacialModal.jsx`:
`resolveOrganizationId(records)` sobre los registros `APROBADO` ya
cargados en el mapa — sin registros aprobados visibles, no hay forma de
resolver la organización activa y el guardado queda bloqueado con un
mensaje claro.

## Fuera de alcance de esta tarea

- Círculo/rectángulo/polilínea/texto/rotar/cortar (geoman los soporta,
  deliberadamente no habilitados).
- Snapping a geometrías ya cargadas en el mapa (geoman lo soporta vía
  `snappable`, no activado en esta iteración — el prompt no lo pidió).
- Recalcular/mostrar en el panel el área geodésica *real* del servidor
  tras guardar (el `area_calculada_ha` que computa el trigger) — el panel
  solo muestra la estimación cliente-side de `@turf/area` mientras se
  dibuja, no hace un round-trip adicional para leer el valor guardado.

## Criterios de aceptación

- AC1: Dibujar un Polígono o un Marcador con geoman genera un evento
  `pm:create` que activa el panel de guardado con el tipo de geometría
  correcto.
- AC2: El área en hectáreas se actualiza en tiempo real mientras se
  agregan vértices a un polígono (no solo al finalizar).
- AC3: Un polígono con auto-intersección (`@turf/kinks` encuentra al
  menos un punto) deshabilita el botón "Guardar" con un mensaje
  explícito.
- AC4: Guardar una geometría cuyo tipo no coincide con
  `TARGET_TABLE_GEOMETRY_TYPES[targetTable]` se rechaza sin perder la
  geometría dibujada (el usuario puede cambiar la tabla destino).
- AC5: `lib/gisTargetTables.js` es la única fuente de
  `TARGET_TABLE_LABELS`/`TARGET_TABLE_FIELDS` — ni `CargaEspacialModal.jsx`
  ni `VectorEditorTools.jsx` las redefinen localmente.
- AC6: `npm run build` compila sin errores.
