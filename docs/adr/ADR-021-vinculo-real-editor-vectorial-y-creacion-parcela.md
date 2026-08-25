# ADR-021 — El Editor Vectorial genera un vínculo real para la cobertura de Fase B, y permite crear una parcela nueva

- **Estado:** Aceptado y verificado en vivo
- **Fecha:** 2026-08-25
- **Código:** `lib/actions/gisActions.js` (`resolveQfieldRelationId`, cambios en
  `insertEudrCoreRecord`/`uploadGeoSpatialFeature`), `lib/actions/sociosActions.js`
  (`createSocio` devuelve `socio_nombre_completo`), `components/features/socios/ParcelaFormModal.jsx`
  (`onParcelaCreated`, opcional), `app/dashboard/qc/components/VectorEditorTools.jsx`
  (botón "+ Crear parcela nueva")
- **Tests:** `tests/test_vinculo_editor_vectorial_y_parcela.mjs` (nuevo, 10 tests)

## El hallazgo (investigación previa a esta tarea, sin código)

Una investigación previa (solo lectura) sobre el flujo de creación de
socio+parcela desde el Editor Vectorial confirmó, con evidencia real, una
colisión de significado seria: `lib/actions/gisActions.js` escribía en
`EUDR_USO_SUELO.id_parcela` el código legible de `PADRON_PARCELAS`
(`ID_Parcela_Fija`, ej. `"COOP-JS-001"`) que el usuario elige vía el
autocompletado de ADR-019. Pero `fn_cobertura_uso_suelo_parcela` (ADR-010/
ADR-011, Fase B) usa esa misma columna con un significado completamente
distinto — el identificador técnico de QField, comparado contra
`EUDR_MONITOREO.qfield_relation_id`:

```sql
-- ya existía, sin cambios en esta tarea
WHERE id_parcela = v_qfield_relation_id
  AND "ID_Organizacion" = v_org
  AND estado_revision = 'APROBADO'
```

Confirmado con datos reales: toda fila de `EUDR_USO_SUELO` que existía
antes de esta tarea tiene `id_parcela` en formato GUID
(`{4166dc2a-4cf0-452b-8eee-d5f68ce05e5c}`), nunca un código de
`PADRON_PARCELAS`. Además, `EUDR_MONITOREO` creado desde el Editor
Vectorial nunca generaba su propio `qfield_relation_id` (quedaba `NULL`
para siempre) — así que ni siquiera el perímetro en sí era vinculable.
**Consecuencia real: cualquier dato de Uso de Suelo creado desde el mapa
quedaba invisible para el cálculo de cobertura de Fase B, en silencio, sin
ningún error.**

## La corrección — Parte 1: vínculo real

**Al crear un `EUDR_MONITOREO`** (`insertEudrCoreRecord`), se genera un
identificador técnico nuevo con `crypto.randomUUID()` (misma API Web
Crypto ya usada para `id_monitoreo`, no la librería `uuid`) y se guarda en
`qfield_relation_id` — deliberadamente **sin** las llaves `{}` que sí
traen los GUID reales de QField, para poder distinguir a simple vista un
vínculo generado acá de uno que vino de campo real. El join en sí es una
comparación de string exacta, así que el formato no le importa a ninguna
consulta:

```js
if (table === 'EUDR_MONITOREO') {
  payload.id_monitoreo = crypto.randomUUID()
  payload.geom_inspeccion = geometryWkt
  payload.qfield_relation_id = crypto.randomUUID()
}
```

**Al crear una subdivisión de `EUDR_USO_SUELO`**, el código legible sigue
validándose exactamente igual que en ADR-019 (existe, activo, misma
organización) — eso no cambia. Lo que cambia es qué se GUARDA: en vez del
código legible, se resuelve el `qfield_relation_id` real del Monitoreo
padre y se guarda ESO:

```js
async function resolveQfieldRelationId(supabase, idParcelaFija, organizationId) {
  if (!idParcelaFija) return null
  const { data, error } = await supabase
    .from('EUDR_MONITOREO')
    .select('qfield_relation_id')
    .eq('ID_Parcela_Fija', idParcelaFija)
    .eq('ID_Organizacion', organizationId)
  if (error) throw error
  if (!data || data.length !== 1) return null
  return data[0].qfield_relation_id || null
}
```

**Decisión de diseño: resolución en vivo (consulta real), no memoria de
sesión del lado del cliente.** El `lastIdentityRef` de ADR-019 (que
propaga el CÓDIGO LEGIBLE entre geometrías consecutivas) sigue funcionando
sin cambios — pero el `id_parcela` técnico que se guarda en
`EUDR_USO_SUELO` se resuelve de nuevo en el servidor en cada guardado, a
partir del código legible actualmente seleccionado en pantalla. Se eligió
así, en vez de propagar el GUID por el lado del cliente, porque:

1. Funciona igual sin importar si el perímetro padre se creó momentos
   antes en la misma sesión, en una carga previa, o llegó por QField.
2. Nunca vincula a un Monitoreo equivocado si el usuario cambia de
   parcela a mitad de sesión — el código legible en pantalla es siempre
   la fuente de verdad para esta búsqueda, no un valor recordado que
   podría quedar desactualizado.
3. **Nunca asume ante ambigüedad** — mismo criterio ya establecido en
   `app/api/qc/cobertura-uso-suelo/route.js` (la misma relación, en
   sentido inverso): si hay 0 o más de 1 `EUDR_MONITOREO` con ese código
   en la organización (confirmado que esto pasa de verdad hoy — varios
   códigos de parcela reales aparecen en más de un Monitoreo, ver
   ADR-014), o el único candidato todavía no tiene su propio
   `qfield_relation_id` (ej. se creó antes de esta corrección), la
   función devuelve `null` — **nunca bloquea el guardado**, coherente con
   `SIN_VINCULO_MENSAJE` (`lib/qcCoberturaUsoSuelo.js`, ya existente): la
   subdivisión se guarda igual, solo queda "sin vínculo" para el cálculo
   de cobertura hasta que alguien lo resuelva a mano — exactamente el
   comportamiento recomendado en la tarea original.

**Fuera de alcance a propósito:** `EUDR_INSTALACIONES.id_parcela` tiene el
mismo patrón (GUID de QField) y potencialmente el mismo riesgo, pero
ninguna función de Fase B lo usa hoy (confirmado en ADR-010, "fuera de
alcance") — no se tocó en esta tarea, sigue guardando el código legible
directo. Vale la pena revisarlo si en algún momento se construye una
función de cobertura equivalente para Instalaciones.

## La corrección — Parte 2: crear una parcela nueva

Mismo patrón exacto que "+ Crear socio nuevo" (ADR-019): un botón
"+ Crear parcela nueva" junto al campo "Código de Parcela", que abre
`ParcelaFormModal` (`components/features/socios/`) como overlay sin
perder el borrador de geometría en curso — reutilizado tal cual, sin
reimplementar `createParcela` ni el correlativo automático
(`lib/parcelaDefaults.js::computeNextParcelaCode`/`computeSuggestedParcelaId`,
ya existentes y ya probados en `/dashboard/socios`).

**Solo disponible cuando el mismo formulario tiene un campo de socio
hermano** (hoy únicamente `EUDR_MONITOREO`, que tiene ambos campos) — sin
un socio en el mismo formulario no hay de quién colgar la parcela nueva
(el correlativo se calcula por socio), así que el botón directamente no
se ofrece en `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` (sin campo de socio).
Con un socio hermano pero sin seleccionar todavía, el botón se muestra
deshabilitado con el texto "Seleccioná o creá un socio primero."

Dos cambios chicos, aditivos, necesarios para que el patrón funcionara
completo:

- **`createSocio` ahora devuelve `socio_nombre_completo`** además de
  `id`/`created` — `ParcelaFormModal` necesita el nombre real del socio
  para el título del modal ("Parcelas de X"), y antes de este cambio
  `createSocio` no lo devolvía. No rompe a `/dashboard/socios/page.jsx`
  (el único otro llamador), que solo lee `result.created`.
- **`ParcelaFormModal` gana `onParcelaCreated` (prop opcional, `undefined`
  en `/dashboard/socios` — comportamiento ahí sin cambios)** — antes de
  esta tarea, el modal no tenía ninguna forma de avisarle a quien lo
  invoca que se creó una parcela nueva; solo recargaba su propia lista
  interna. Se dispara solo en un ALTA real (`result.created`), nunca en
  una edición.

Al guardar exitosamente, el Editor Vectorial escribe el `ID_Parcela_Fija`
recién creado directo en el campo y cierra el overlay — sin que el
usuario tenga que volver a buscarla, mismo comportamiento que "+ Crear
socio nuevo".

**Nota de UX, no un bug:** a diferencia de `SocioFormModal` (que va
directo a un formulario de alta), `ParcelaFormModal` es la pantalla
completa de "gestionar las parcelas de un socio" (lista + alta + edición
+ baja) — reutilizarla tal cual, como pidió la tarea, significa que el
usuario ve primero "Sin parcelas registradas todavía." y tiene que
hacer un clic más en "+ Agregar parcela" antes de llegar al formulario.
Es un clic extra respecto al flujo de socio, pero es exactamente el
mismo componente ya probado en `/dashboard/socios`, sin duplicar nada.

## Verificación en vivo (combinada — Parte 1 y Parte 2 juntas, un solo flujo real)

Reproducido en la Consola QC real (`npm run dev` limpio), con datos 100%
de prueba en `ORG-TEST-E2E`, borrados por completo al final:

1. Dibujé un perímetro (Monitoreo EUDR).
2. "+ Crear socio nuevo" → `TEST-ADR021-SOC`. El campo mostró
   `✓ Seleccionado: TEST-ADR021-SOC`, y "+ Crear parcela nueva" pasó a
   estar habilitado.
3. "+ Crear parcela nueva" → el modal mostró **"Parcelas de SOCIO PRUEBA
   ADR021 VINCULO"** (el nombre real, confirmando que `socio_nombre_completo`
   llega correctamente) → "+ Agregar parcela" → correlativo sugerido real:
   `ID_Parcela_Fija: "TEST-ADR021-SOC-P-00001"`, `parcela_codigo: "P-00001"`
   — razonable para la primera parcela de un socio nuevo. Guardado exitoso.
4. El campo "Código de Parcela" del Editor Vectorial pasó a
   `✓ Seleccionado: TEST-ADR021-SOC-P-00001` automáticamente — sin buscar.
5. Guardé el perímetro: `"Geometría guardada correctamente..."`.
6. Cambié a "Uso de Suelo", dibujé una subdivisión: el campo "Código de
   Parcela" heredó `TEST-ADR021-SOC-P-00001` solo (mecanismo de ADR-019,
   sin cambios). Elegí "Producción" y guardé.
7. **Consulta real, directa a la base:**

   ```
   EUDR_MONITOREO.qfield_relation_id = "be8b5e14-ba35-4d3c-8064-4e25f5d1b20c"
   EUDR_USO_SUELO.id_parcela        = "be8b5e14-ba35-4d3c-8064-4e25f5d1b20c"
   ```

   Coinciden exactamente — nunca el código legible
   `"TEST-ADR021-SOC-P-00001"`.
8. **`fn_cobertura_uso_suelo_parcela` real, antes y después de aprobar la
   subdivisión de prueba:**

   | | `suma_uso_suelo_aprobado_ha` |
   |---|---|
   | Antes (subdivisión PENDIENTE) | `0` |
   | Después (subdivisión APROBADO) | `29371.0207` |

   Antes de esta tarea, este número se habría quedado en `0` para
   siempre, sin importar cuántas subdivisiones se aprobaran — el join
   nunca encontraba nada.

**Limpieza — conteo antes/después:**

| Tabla | Antes | Después |
|---|---|---|
| `EUDR_MONITOREO` PENDIENTE (todas las orgs) | 14 | 13 (idéntico al valor previo a esta tarea) |
| `EUDR_USO_SUELO` (todas las orgs) | 6 | 5 |
| Rastros de `TEST-ADR021-*` (`PADRON_SOCIOS`/`PADRON_PARCELAS`/`EUDR_MONITOREO`) | — | 0 |

## Verificación no visual

- `npm run build`: compiló sin errores.
- `node --test tests/*.mjs`: 535/535 (10 tests nuevos en
  `tests/test_vinculo_editor_vectorial_y_parcela.mjs`: generación de
  `qfield_relation_id`, resolución sin asumir ante ambigüedad, que
  `EUDR_USO_SUELO` ya no guarda el código legible, que
  `EUDR_INSTALACIONES` queda fuera de alcance a propósito, el retorno
  nuevo de `createSocio`, `onParcelaCreated` en `ParcelaFormModal`, el
  botón condicionado a un socio hermano, deshabilitado sin socio, la
  auto-selección al guardar, y que no se reimplementó ninguna lógica de
  `parcelaDefaults.js`/`sociosActions.js`).
- `python -m pytest tests/ -v --tb=short`: 370 passed, 5 skipped (sin
  código Python tocado en esta tarea).

## Fuera de alcance de esta tarea (a propósito)

- **`EUDR_INSTALACIONES.id_parcela`** — mismo riesgo potencial, sin
  función de Fase B que lo use hoy, no corregido acá (ver arriba).
- **Backfill de `EUDR_MONITOREO` con `qfield_relation_id = NULL` creados
  desde el Editor Vectorial antes de esta corrección** — no se investigó
  si existen filas reales en ese estado hoy fuera de los datos de prueba
  de esta sesión (todos ya borrados); no se pidió backfill en esta tarea.
- **Unificar el formato de `qfield_relation_id`** (con o sin llaves `{}`)
  entre el ETL de Python y el Editor Vectorial — se documentó la
  diferencia deliberada arriba, no se homogeneizó.
