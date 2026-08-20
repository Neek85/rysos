# Spec — Esquema `EUDR_COBERTURA_BOSCOSA_2020` (infraestructura, sin datos)

## Contexto

Continuación de `specs/qc_topological_eudr_validation.md`, donde se pausó
con `AskUserQuestion` la parte de cruce contra deforestación y el usuario
confirmó dejarla fuera de alcance ("solo topología por ahora") porque no
había ninguna tabla ni fuente de datos real. Este prompt pide construir
esa infraestructura — la tabla, sus índices, y conectarla a
`fn_validar_topologia_eudr` — **sin cargar ningún dato real todavía**
("cuando existan registros en dicha tabla", condicional explícito en el
prompt). Esto es distinto y sí seguro de implementar: con la tabla vacía,
el comportamiento visible no cambia (`deforestacion.disponible` sigue
siendo `false`) hasta que una tarea de ingesta de datos aparte cargue un
dataset real.

## Corrección de premisa: NO es una tabla multi-tenant

El prompt pedía `ID_Organizacion text` + RLS aislada por organización +
un índice compuesto `(ID_Organizacion, id)`. **Se omite deliberadamente.**
Un dataset de cobertura boscosa/pérdida forestal (MINAM Geobosques /
Hansen GFW) es una **verdad geográfica compartida**: el mismo polígono de
deforestación en una coordenada dada es relevante para cualquier
organización cuya parcela caiga ahí, no un registro que "pertenece" a una
organización. Modelarlo multi-tenant tendría 2 problemas reales: (1)
obligaría a cargar el mismo dataset nacional una vez POR organización
(duplicado, con más superficie de desincronización); (2) cualquier
organización sin su "copia" cargada quedaría con el cruce siempre
`disponible:false`, aunque el dataset real sí exista en la base para
otras organizaciones — un bug de disponibilidad, no de datos.

Precedente ya existente en el proyecto para este mismo patrón: `lib/data/ubigeo_peru.json`
(departamentos/provincias/distritos de Perú) es otro dataset de
referencia compartido, sin ningún scoping por organización, consumido
igual por todas.

## Diseño

- **`EUDR_COBERTURA_BOSCOSA_2020`**: `id` (PK), `geom
  geometry(MultiPolygon,4326)`, `anio_perdida integer` (año de pérdida
  detectada — mismo contrato que
  `scripts/satellite_prevalidation.py::forest_loss_events[].year`, la
  convención "loss year" de Hansen GFW), `fuente text` (`MINAM_GEOBOSQUES`/
  `HANSEN_GFW`/`PNCBM`/etc., libre), `dataset_version text`, `created_at`.
- Índices: `GIST` sobre `geom` (la consulta real es `ST_Intersects`) +
  btree sobre `anio_perdida` (filtra `> 2020` antes del cruce espacial).
- RLS: `SELECT` para `authenticated` — higiene/least-privilege, no la
  defensa real (la función que la consulta se invoca solo con el Service
  Role Key, que bypassa RLS de todas formas).
- **`fn_validar_topologia_eudr`** (misma firma, `CREATE OR REPLACE`):
  antes de calcular `deforestacion`, verifica
  `EXISTS(SELECT 1 FROM EUDR_COBERTURA_BOSCOSA_2020)`. Si la tabla está
  vacía → mismo `{disponible:false, motivo:...}` de antes (sin cambio de
  comportamiento). Si tiene filas → cruza `ST_Intersects` contra las filas
  con `anio_perdida > 2020`, devuelve `interseca_post_2020` (boolean),
  `area_afectada_max_pct`, y el detalle de cada evento que intersecta.
- **`lib/qcTopologyValidation.js::describeDeforestationBadge(deforestacion)`**
  (nuevo): deriva el badge de la Consola QC a partir de esa respuesta —
  `ok:null` (neutro) mientras `disponible:false`, `ok:true`/`false` recién
  cuando hay un cruce real. `QcDetailEditor.jsx` lo usa en vez del texto
  estático que tenía antes; el banner de advertencia junto a
  Aprobar/Rechazar ahora también se activa si
  `deforestacion.interseca_post_2020` es `true`.

## Sigue fuera de alcance

Cargar datos reales de MINAM Geobosques/Hansen GFW/SERNANP a esta tabla —
requiere decidir la fuente concreta (API vs. dataset descargado vs. carga
manual) y construir el pipeline de ingesta, una tarea aparte.

## Criterios de aceptación

- AC1: Con la tabla vacía (estado tras esta migración), el resultado de
  `fn_validar_topologia_eudr` es idéntico al de antes de esta migración
  para `deforestacion` (`{disponible:false, motivo:...}`).
- AC2: `EUDR_COBERTURA_BOSCOSA_2020` no tiene columna `ID_Organizacion` ni
  ninguna política RLS que dependa de una.
- AC3: `describeDeforestationBadge` nunca devuelve `ok:true`/`ok:false`
  cuando `disponible` es `false`.
- AC4: `npm run build` compila sin errores.
