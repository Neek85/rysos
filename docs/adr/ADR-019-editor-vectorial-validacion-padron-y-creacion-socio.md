# ADR-019 — El Editor Vectorial valida socio/parcela contra el Padrón real, permite crear un socio nuevo reutilizando SocioFormModal, y hereda la selección entre geometrías

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-24
- **Código:** `app/dashboard/qc/components/VectorEditorTools.jsx` (autocompletado
  real, overlay de creación de socio, herencia entre geometrías),
  `lib/gisTargetTables.js` (marcador `padronEntity`), `lib/actions/gisActions.js`
  (validación de existencia/activo del lado del servidor)
- **Tests:** `tests/test_gis_padron_validation.mjs` (nuevo, 5 tests)

## El problema (investigación previa, solo-lectura, sin código)

Dos hallazgos de una investigación previa a esta tarea, ya reportados sin
implementar nada: (1) "Código de Socio"/"Código de Parcela" en el Editor
Vectorial eran `<input type="text">` libre, sin validar contra
`PADRON_SOCIOS`/`PADRON_PARCELAS` — `lib/actions/gisActions.js` solo
chequeaba "no vacío" donde `required: true`, nunca existencia real; (2) sin
ningún mecanismo de creación de socio desde el propio editor, y sin
herencia entre geometrías consecutivas (`onFinalize` limpiaba
`fieldValues` a `{}` incondicionalmente en cada geometría nueva).

## La corrección

**1. Autocompletado real (`PadronEntityField`, VectorEditorTools.jsx).**
Un campo con `padronEntity: 'socio' | 'parcela'` en
`TARGET_TABLE_FIELDS` (marcado en `EUDR_MONITOREO.ID_Socio`/
`ID_Parcela_Fija` y `EUDR_USO_SUELO`/`EUDR_INSTALACIONES.id_parcela` —
deliberadamente NO en `PADRON_PARCELAS.ID_Socio`, fuera de alcance: lo
consume el Ingestor de Capas Espaciales, no el Editor Vectorial de la
Consola QC, y `createParcela` ya lo valida por su cuenta) renderiza
`PadronAutocomplete` (`components/features/inspecciones/PadronAutocomplete.jsx`)
en vez de un `<input>`, reutilizando `lib/padronSearch.js` sin tocarlo —
mismo mecanismo exacto que ya usa Inspecciones. `searchSocios`/
`searchParcelas` ya excluyen `activo = false` (ADR-016), así que solo puede
**seleccionarse** (nunca tipearse a mano) un socio/parcela real y activo.
Para un campo `'parcela'` en una tabla que también tiene un campo
`'socio'` (hoy solo `EUDR_MONITOREO`), la búsqueda de parcela se acota al
socio ya elegido (`searchParcelas(supabase, org, socioId, query)`).

**2. "+ Crear socio nuevo" reutiliza SocioFormModal, sin duplicar validación.**
Un botón junto al campo de socio abre `SocioFormModal`
(`components/features/socios/SocioFormModal.jsx`) como overlay — decisión
confirmada explícitamente antes de implementar: nunca se reimplementa la
validación de `sociosActions.js` (DNI/Código de Finca/código PK
duplicados) en un segundo lugar. Al guardar con éxito (`onSaved(result)`,
`result.id` = el `ID_Socio` recién creado), ese código queda escrito
directamente en `fieldValues[socioModalFieldKey]` — el socio nuevo aparece
seleccionado sin que el usuario tenga que volver a buscarlo. El overlay es
solo una capa más de React sobre el mismo árbol: `drawnLayer`/`draft`
viven enteramente en `useVectorEditor`, ajenos al estado local del modal,
así que abrir/cerrar/cancelar el modal nunca toca el borrador de
geometría en curso.

**3. Herencia entre geometrías consecutivas.** `useVectorEditor` gana
`lastIdentityRef` (`{ socio, parcela }`, un `useRef`, no `useState` — nada
en la UI renderiza a partir de esto directamente, solo lo lee `onFinalize`
al precargar la próxima geometría) y `targetTableRef` (mismo motivo:
`onFinalize` se engancha una sola vez, dependencia `[mapReady]` del efecto
que llama `attachVectorEditor`, así que necesita refs para leer valores
*actuales* de `targetTable`/`lastIdentityRef` en vez de los capturados en
el momento del enganche). `handleSave`, al guardar con éxito, actualiza
`lastIdentityRef.current` (solo sobreescribe cuando el guardado actual SÍ
traía ese valor, para no perder la memoria de sesión al guardar una tabla
que no tiene ese campo — ej. `EUDR_USO_SUELO` no tiene `ID_Socio`).
`onFinalize` ya no limpia `fieldValues` a `{}` — llama
`buildInitialFieldValues(targetTableRef.current, lastIdentityRef.current)`,
que solo precarga los campos `padronEntity` que existan para la
`targetTable` ACTUAL (nunca fuerza el valor, sigue siendo editable; y
`tipo_uso`/`tipo_infra` siempre arrancan vacíos, nunca heredados).

**4. Rechazo real del lado del servidor (`lib/actions/gisActions.js`).**
`assertSocioActivoOSinValor`/`assertParcelaActivaOSinValor` (nuevas,
locales a este archivo — no exportadas desde `sociosActions.js` para no
ensanchar innecesariamente esa API 'use server') consultan
`ID_Organizacion, activo` sin filtrar la organización en la query
(mismo patrón que `assertSocioExists` en `sociosActions.js`: se compara
con `orgIdsMatch`, tolerante a mayúsculas/espacios, en vez de un `.eq()`
crudo) y rechazan con un mensaje claro si el código no existe, no
pertenece a la organización activa, o está dado de baja. Se invocan antes
de cada insert en `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`
(nunca en la rama `PADRON_PARCELAS`, que delega en `createParcela` y ya
valida por su cuenta) — no hacen nada si el campo viene vacío, porque
`ID_Socio`/`ID_Parcela_Fija` siguen siendo opcionales en
`EUDR_MONITOREO`. Como `gisActions.js` es compartido, esta validación
también protege el path de carga masiva del Ingestor de Capas Espaciales
(`uploadGeoSpatialBatch` llama a la misma `uploadGeoSpatialFeature` por
cada fila) — efecto secundario deliberado, no un descuido: la instrucción
pedía la validación en este archivo sin acotarla a un solo llamador, y es
exactamente el mismo problema (código inventado en `ID_Socio`/
`ID_Parcela_Fija`) el que existía ahí también.

## Verificación en vivo (Consola QC real, `/dashboard/qc` + `/dashboard/socios`, sin mocks)

Reproducido con clicks/eventos reales sobre `npm run dev` levantado limpio.
El único org con registros PENDIENTE visibles en la consola es
`ORG-TEST-E2E`, que no tenía ningún socio/parcela real en el padrón
(confirmado con una consulta de solo lectura antes de tocar nada) — la
verificación se hizo creando y luego **eliminando por completo** un socio
y una parcela de prueba dentro de ese mismo org de prueba, sin tocar en
ningún momento datos de `COOP-JS` (el org con socios reales). Se descartó
deliberadamente la alternativa de reasignar `ID_Organizacion` en registros
reales ya existentes, aunque fuera reversible — mismo criterio que evitó
el incidente de reasignación del ETL al principio de esta sesión: si la
reversión se corta a mitad de camino, quedan datos reales mezclados entre
organizaciones. Crear-y-borrar datos 100% de prueba dentro de un org de
prueba no tiene ese riesgo.

**1. Autocompletado real, solo activo/existente seleccionable:**
`searchSocios`/`searchParcelas` confirmadas en vivo con la request real
capturada (`ID_Organizacion=eq.ORG-TEST-E2E&activo=eq.true&or=(...)`) antes
de crear ningún dato de prueba — la ausencia total de resultados en ese
momento era la evidencia correcta (el org de prueba no tenía padrón
propio), no un bug. Tras crear el socio y la parcela de prueba, la misma
búsqueda los encontró y seleccionarlos escribió el código real
(`✓ Seleccionado: TEST-ADR019-01` / `TEST-ADR019-P01`) — nunca fue posible
escribir un código a mano.

**2. "+ Crear socio nuevo" — overlay, mismas validaciones, auto-selección:**
con un polígono ya dibujado (borrador activo, "Área estimada: 19.4662 ha"
visible), se abrió el overlay y se creó `TEST-ADR019-01` — el borrador
siguió intacto detrás del modal durante y después de la operación. Antes
de terminar, se probaron las 2 validaciones reales pedidas, ambas
disparadas por `sociosActions.js` sin ningún código nuevo:
  - DNI duplicado (reutilizando el DNI de `TEST-ADR019-01` en un segundo
    alta): `"El DNI 99990001 ya está registrado para el socio
    "TEST-ADR019-01" en esta organización."` (mensaje real de
    `assertDniNotDuplicated`).
  - Código duplicado (reutilizando el mismo `ID_Socio`):
    `"Ya existe un socio con el código "TEST-ADR019-01"."` (mensaje real
    de la violación de PK de Postgres, vía `friendlyDuplicateError`).

  Ambos intentos fallidos se cancelaron sin persistir nada; el campo del
  Editor Vectorial siguió mostrando `TEST-ADR019-01` (el alta exitosa
  anterior) sin ninguna interferencia. Tras el alta exitosa real, el campo
  quedó en `✓ Seleccionado: TEST-ADR019-01` automáticamente, sin volver a
  buscar.

**3. Herencia entre geometrías consecutivas:** con `TEST-ADR019-01`/
`TEST-ADR019-P01` seleccionados, se guardó el perímetro (`EUDR_MONITOREO`,
aceptado por el servidor: `"Geometría guardada correctamente..."`). Se
cambió "Tabla destino" a "Uso de Suelo" y se dibujó una subdivisión nueva
— **sin buscar nada**, el campo "Código de Parcela" ya mostraba
`✓ Seleccionado: TEST-ADR019-P01` apenas terminó el dibujo (`onFinalize`
precargó desde `lastIdentityRef`). Se completó "Tipo de Uso" y se guardó
con éxito también.

**4. Rechazo real del servidor ante un código inactivo (defensa en
profundidad):** se dibujó una tercera geometría (`EUDR_MONITOREO`), que
heredó `TEST-ADR019-01`/`TEST-ADR019-P01` del guardado anterior — sin
tocar la UI, se dio de baja a `TEST-ADR019-01` desde `/dashboard/socios`
(botón real "Dar de baja", que confirmó en vivo la cascada documentada en
ADR-016: la parcela `TEST-ADR019-P01` también quedó `activo: false`). Con
la referencia ya obsoleta todavía precargada en el formulario (el cliente
nunca vuelve a consultar el padrón por su cuenta), se hizo clic en
"Guardar": el servidor rechazó el insert con el mensaje real de
`assertSocioActivoOSinValor`: `"El Código de Socio "TEST-ADR019-01" no
existe, no pertenece a esta organización, o está dado de baja."` — no se
creó ninguna fila nueva (el contador "Monitoreos" de la consola se
mantuvo en 4, no subió a 5).

**Limpieza — conteo antes/después:**

| Tabla | Antes | Después |
|---|---|---|
| `EUDR_MONITOREO` PENDIENTE (todas las orgs) | 3 (mismos `id_monitoreo`: `2947810c…`/`6b1c9ec5…`/`6367110b…`) | 3 (idénticos, sin cambios) |
| `EUDR_USO_SUELO` PENDIENTE (todas las orgs) | 0 | 0 |
| `PADRON_SOCIOS` de `COOP-JS` | `JS-00001`/`JS-00002`, ambos activos | Idéntico, sin tocar |
| Rastros de `TEST-ADR019-*` en `PADRON_SOCIOS`/`PADRON_PARCELAS` | — | 0 (eliminados por completo: socio, parcela, y las 2 filas `EUDR_MONITOREO`/`EUDR_USO_SUELO` de prueba) |

La consola QC, recargada al final, muestra exactamente los mismos 3
registros PENDIENTE originales — estado idéntico al de antes de empezar.

## Verificación no visual

- `npm run build`: compiló sin errores.
- `node --test tests/*.mjs`: 509/509 (incluye `tests/test_gis_padron_validation.mjs`,
  nuevo, 5 tests: marcado `padronEntity` correcto y acotado a las 3
  tablas reales; `gisActions.js` valida antes de cada insert EUDR_\*, nunca
  cuando el campo viene vacío; `VectorEditorTools.jsx` reutiliza
  `padronSearch.js`/`PadronAutocomplete`/`SocioFormModal` sin duplicar
  validación; la herencia usa refs, no closures directas sobre estado).
- `python -m pytest tests/ -v --tb=short`: 363 passed, 5 skipped (sin
  código Python tocado en esta tarea).

## Fuera de alcance de esta tarea (a propósito)

- **"+ Crear parcela nueva"** — no existe una opción equivalente para el
  campo de parcela; solo se puede seleccionar una parcela ya existente y
  activa. Confirmado como decisión explícita de la tarea (solo
  `SocioFormModal` se reutiliza, nunca `ParcelaFormModal`).
- **`PADRON_PARCELAS.ID_Socio`** (consumido por el Ingestor de Capas
  Espaciales, `/dashboard/mapa`) — sigue siendo texto libre ahí; `createParcela`
  ya lo valida del lado del servidor (`assertSocioExists`), y ese flujo
  queda fuera del alcance de esta tarea (nunca pasa por el Editor
  Vectorial de la Consola QC).
- **Reactivar automáticamente** un socio/parcela dado de baja al
  seleccionarlo — no se pidió, y `searchSocios`/`searchParcelas` ya lo
  excluyen a propósito por decisión de negocio (ADR-016).
