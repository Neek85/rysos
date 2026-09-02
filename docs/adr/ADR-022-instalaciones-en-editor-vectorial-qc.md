# ADR-022 — `EUDR_INSTALACIONES` como tabla destino en el Editor Vectorial de la Consola QC

## Contexto

Una investigación previa de esta sesión (SOLO INVESTIGACIÓN, sin código)
confirmó que `EUDR_INSTALACIONES` nunca aparecía en el `<select>` "Tabla
destino" del Editor Vectorial de `/dashboard/qc`, a pesar de que
`lib/gisTargetTables.js` ya la reconocía como una de las 4 tablas destino
del módulo GIS, con su propio campo `tipo_infra`, su propia restricción de
geometría (`Point`) y su propia validación real contra el padrón
(`padronEntity: 'parcela'`, ADR-019).

## La conclusión de esa investigación: omisión de scope, no decisión de negocio

`QC_DRAWABLE_TABLES` (`components/gis/QcConsoleMap.jsx`) apareció ya
restringida a `['EUDR_MONITOREO', 'EUDR_USO_SUELO']` desde el primer commit
que introdujo el Editor Vectorial en la Consola QC (tarea de
`specs/ui_reorganization_geoman.md`, moviendo el editor desde
`/dashboard/mapa`) — nunca hubo un commit posterior que la agregara y la
quitara. El único rastro documentado es una línea en esa spec: "nunca
`EUDR_INSTALACIONES`/`PADRON_PARCELAS` desde acá (pedido explícito del
prompt)" — confirma que fue intencional para *esa tarea puntual*, pero no
da ninguna razón de negocio.

No se encontró en ningún ADR/spec ninguna afirmación de que Instalaciones
deba manejarse solo vía Drive/QField por diseño — de hecho la evidencia
contradice esa hipótesis: la rama de escritura de `EUDR_INSTALACIONES` en
`lib/actions/gisActions.js` (consumida por `CargaEspacialModal.jsx`) ya
existía, completa y validada contra el padrón real (ADR-019), antes de esta
tarea. El patrón real es: el Editor Vectorial se diseñó primero para las 4
tablas en `/dashboard/mapa` (`specs/gis_vector_editor.md`), y cuando se
restringió al moverse a la Consola QC, el prompt de esa tarea puntual pidió
solo 2 tablas por acotar su propio alcance — no porque Instalaciones tuviera
algo estructuralmente distinto.

## La corrección

Un solo cambio real: `QC_DRAWABLE_TABLES` pasa de
`['EUDR_MONITOREO', 'EUDR_USO_SUELO']` a
`['EUDR_MONITOREO', 'EUDR_USO_SUELO', 'EUDR_INSTALACIONES']`
(`components/gis/QcConsoleMap.jsx`), con el comentario que documentaba la
exclusión actualizado para explicar por qué ya no aplica. `PADRON_PARCELAS`
sigue fuera — ese sí es un criterio que no cambió: la consume el Ingestor
de Capas Espaciales (`CargaEspacialModal.jsx`), no el Editor Vectorial.

Cero cambios en `lib/gisTargetTables.js` ni en `lib/actions/gisActions.js`
— ambos ya soportaban `EUDR_INSTALACIONES` por completo desde antes de esta
tarea (confirmado leyendo el código real, no asumido):

- `TARGET_TABLE_FIELDS.EUDR_INSTALACIONES` ya definía `id_parcela`
  (`padronEntity: 'parcela'`, autocompletado real contra `PADRON_PARCELAS`,
  igual que `EUDR_USO_SUELO`) y `tipo_infra` (texto libre).
- `TARGET_TABLE_GEOMETRY_TYPES.EUDR_INSTALACIONES` ya era `['Point']` —
  mecanismo genérico de ADR-018 (deshabilita el botón "Dibujar Polígono" en
  el toolbar de geoman cuando la tabla destino elegida no acepta polígonos),
  sin ningún caso especial para esta tabla.
- `gisActions.js::uploadGeoSpatialFeature`, rama `EUDR_INSTALACIONES`, ya
  llamaba `assertParcelaActivaOSinValor` antes de insertar (ADR-019).

También se actualizaron los comentarios ya desactualizados en
`specs/ui_reorganization_geoman.md` (AC2 y el punto 3 de "Cambios"), dejando
constancia de que fueron superados por este ADR sin reescribir la spec
original (que sigue siendo un registro histórico correcto de lo que esa
tarea entregó en su momento).

## Verificación en vivo (datos de prueba desechables, `ORG-TEST-E2E`)

1. Seleccionado "Instalaciones" en "Tabla destino": el panel muestra
   "Acepta geometría: Point." — restricción correcta sin tocar código.
2. Confirmado por inspección directa del DOM que el botón "Dibujar
   Polígono" del toolbar de geoman tiene la clase `pm-disabled`
   (mecanismo de ADR-018) mientras "Dibujar Marcador" no la tiene — el
   usuario ni siquiera puede empezar a dibujar un polígono con Instalaciones
   seleccionada, no hace falta un rechazo posterior al guardar.
3. Sembrados un socio (`TEST-ADR022-SOC`) y una parcela activa
   (`TEST-ADR022-SOC-P-00001`, 3 ha) en `ORG-TEST-E2E`. Con "Instalaciones"
   seleccionada, se dibujó un marcador real: el formulario renderizó
   "Código de Parcela \*" (autocompletado) y "Tipo de Infraestructura"
   (texto libre) correctamente.
4. Tipeado "TEST-ADR022" en "Código de Parcela": una request real
   (confirmada en Network) contra
   `PADRON_PARCELAS?ID_Organizacion=eq.ORG-TEST-E2E&activo=eq.true&or=(...ilike...)`
   devolvió el resultado real, con el mismo componente
   `PadronAutocomplete`/`lib/padronSearch.js` ya usado para Uso de Suelo —
   sin código nuevo. Seleccionada la sugerencia, "Tipo de Infraestructura"
   completado con "Beneficio húmedo", y guardado.
5. Confirmado por consulta directa a Supabase: se creó una fila real en
   `EUDR_INSTALACIONES` (`id: 45`) con `geom` tipo `Point`,
   `id_parcela: "TEST-ADR022-SOC-P-00001"` (el código legible, tal como se
   documenta abajo que corresponde para esta tabla), `tipo_infra: "Beneficio
   húmedo"`, `estado_revision: "PENDIENTE"`, `ID_Organizacion:
   "ORG-TEST-E2E"`. El contador "Instalaciones (1)" de la Consola QC
   reflejó el alta de inmediato.
6. Limpieza completa confirmada con conteos antes/después:
   `EUDR_INSTALACIONES` PENDIENTE de `ORG-TEST-E2E` `1 → 0`, filas
   `TEST-ADR022%` en `PADRON_PARCELAS`/`PADRON_SOCIOS` `1 → 0` en ambas.

## Pendiente de investigación futura (no incluido acá, a propósito)

`EUDR_INSTALACIONES.id_parcela` sigue guardando el código legible de
`PADRON_PARCELAS` directo, exactamente como antes de esta tarea — el vínculo
real de ADR-021 Parte 1 (resolver y guardar `qfield_relation_id`, el GUID
técnico de QField, en vez del código legible) **no se extendió a esta
tabla**. Esto es intencional y ya estaba documentado dos veces antes de esta
tarea (ADR-010, ADR-021): `EUDR_INSTALACIONES.id_parcela` tiene el mismo
patrón de GUID de QField y potencialmente el mismo riesgo estructural, pero
hoy **no existe ninguna función de cobertura (Fase B) que la use** —
`fn_cobertura_uso_suelo_parcela` solo lee `EUDR_USO_SUELO`. Aplicar el fix
de ADR-021 acá sin que exista un consumidor sería trabajo sin efecto
observable.

**Queda anotado explícitamente:** si en el futuro se construye una función
de cobertura equivalente para Instalaciones (por ejemplo, para validar que
la infraestructura reportada de un socio está dentro de una parcela
vinculada de verdad y no solo por coincidencia de texto), hay que revisar
si `resolveQfieldRelationId` (`lib/actions/gisActions.js`) debe aplicarse
también a la rama `EUDR_INSTALACIONES` de `uploadGeoSpatialFeature` en ese
momento — no antes.

## Impacto

- `components/gis/QcConsoleMap.jsx`: 1 línea de constante + comentario.
- `specs/ui_reorganization_geoman.md`: 2 notas de "superado por ADR-022",
  sin reescribir el contenido histórico.
- `tests/test_ui_reorganization.mjs`: el test que fijaba el array de 2
  elementos se actualizó a 3; se agregó un test nuevo que confirma (import
  real, no regex) que `lib/gisTargetTables.js`/`gisActions.js` no
  necesitaron ningún cambio.
- `lib/gisTargetTables.js`, `lib/actions/gisActions.js`: sin cambios.

## Verificado, no una premisa falsa

- `npm run build`: compila sin errores (`/dashboard/qc` 59.9 kB, sin
  cambios de tamaño relevantes).
- `node --test tests/*.mjs`: 536/536 tests, 0 fallos.
- `python -m pytest tests/ -v`: 370 passed, 5 skipped (gate real de
  credenciales Supabase, ver `NEEDS_SUPABASE`).
