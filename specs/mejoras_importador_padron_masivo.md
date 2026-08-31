# Spec — Mejoras al Importador de Padrón Masivo (CSV)

- **Estado:** Propuesto — diseño para revisión, **sin implementar** (solo
  este archivo se crea en esta tarea).
- **Fecha:** 2026-08-31
- **Contexto previo:** `ADR-027-certificaciones-normalizadas.md`,
  `specs/padron_certificaciones_normalizado.md` (diseño original de las
  columnas dinámicas y del rechazo por columna no reconocida, sección 6.1),
  `specs/padron_web_socios.md` (diseño original del módulo).
- **Alcance:** `lib/padronCsv.js`, `components/features/socios/ImportPadronModal.jsx`.
  Impacto colateral confirmado en `tests/test_padron_csv.mjs` (ver sección 5).
  `lib/validations/socios.js` y `lib/actions/sociosActions.js` **no se
  tocan** — se verificó que no hace falta (secciones 1 y 5).

## 0. Verificación de premisas del pedido (contra el repo real)

Antes de diseñar se confirmó en el código, no se asumió del prompt:

- `ImportPadronModal.jsx` existe (`components/features/socios/ImportPadronModal.jsx`,
  244 líneas) y hoy llama a `parseCsv`/`validateSocioRows`/`validateParcelaRows`
  tal como las expone `lib/padronCsv.js`.
- `socioSchema` (`lib/validations/socios.js:32-61`) **ya** valida
  `cert_org_estatus` como campo opcional (`str`, línea 51) — no hace falta
  tocar el schema Zod para el punto 1, solo la capa CSV.
- `createSocio` (`lib/actions/sociosActions.js:349-379`) re-parsea con
  `socioSchema.parse(values)` (línea 351) el objeto que le pasa
  `ImportPadronModal.jsx` (`row.data`, ya parseado una vez por
  `validateSocioRows`) — el re-parseo es idempotente, así que no hay
  pérdida de datos en la doble pasada.
- `syncSocioCertificaciones` (`lib/actions/sociosActions.js:311-338`) ya
  lee `parsed.cert_org_estatus` (línea 330) del objeto `parsed` completo
  que le pasa `createSocio` — **no** del recorte `socioPayload()` (que
  deliberadamente lo excluye, ADR-027). Es decir: el camino
  CSV → `row.data` → `createSocio(values, …)` → `parsed` →
  `syncSocioCertificaciones` ya está cableado de punta a punta; lo único
  que falta para que `cert_org_estatus` viaje por ese camino es que la
  capa CSV (`padronCsv.js`) lo reconozca como columna — confirma la
  premisa del punto 1a del pedido: no hay que duplicar lógica en
  `sociosActions.js`.
- `findUnrecognizedSocioColumns`/el `throw` que rechaza el archivo
  completo existen tal como se reportó en la tarea anterior
  (`lib/padronCsv.js:376-382`, invocado en `validateSocioRows:579-584`) —
  confirmado de nuevo al releer el archivo para este diseño.
- **No existe** ningún equivalente para Parcelas hoy — confirmado (grep
  sobre `padronCsv.js`, `validateParcelaRows` no llama a ninguna función
  de detección de columnas desconocidas).
- `validateSocioRows`/`validateParcelaRows` devuelven hoy un **array
  plano** de resultados por fila (no un objeto envolvente) — confirmado
  contra 28 sitios de uso en `tests/test_padron_csv.mjs`, todos con
  `const [result] = await validate...Rows(...)` o
  `const results = await validate...Rows(...)`, más
  `ImportPadronModal.jsx:68` (`setValidated(result)`, tratado como array
  en `validated.filter(...)`/`validated.map(...)` líneas 76-77, 186).
  Este dato es relevante para el punto 2 (cambiar el contrato de retorno
  es un **breaking change**, no aditivo — ver sección 5).

---

## 1. Reactivar `cert_org_estatus` en el CSV de Socios

### 1.1 Diseño

Agregar `cert_org_estatus` de vuelta a `SOCIO_EXPORT_COLUMNS` como
**columna fija** (no dinámica, a diferencia de las 8 de certificación
booleana — esas siguen viniendo del catálogo `CERTIFICACIONES_CATALOGO`
vía `fetchActiveCertificaciones`). Posición propuesta: al final de la
lista fija, justo antes de donde `buildSociosCsv`/`buildSocioTemplateCsv`
concatenan las columnas dinámicas (`[...SOCIO_EXPORT_COLUMNS,
...certificaciones.map(c => c.id)]`) — mantiene agrupados los campos fijos
de persona/geografía primero, el estatus orgánico general después, y las
8 certificaciones puntuales al final:

```js
// lib/padronCsv.js — SOCIO_EXPORT_COLUMNS (agregar línea nueva al final)
const SOCIO_EXPORT_COLUMNS = [
  'ID_Socio',
  'ID_Organizacion',
  'codigo_finca',
  'socio_nombre_completo',
  'socio_dni',
  'socio_genero',
  'socio_fecha_nacimiento',
  'celular_socio',
  'socio_departamento',
  'socio_provincia',
  'socio_distrito',
  'localidad',
  'socio_fecha_ingreso',
  'cert_org_estatus',   // ← NUEVO (reactivado, ADR-027 lo había retirado)
]
```

```js
// SOCIO_FIELD_LABELS (agregar entrada nueva)
cert_org_estatus: 'Estatus de Certificación Orgánica',
```

`SOCIO_TEMPLATE_COLUMNS` (línea 146, `SOCIO_EXPORT_COLUMNS.filter(c => c
!== 'ID_Organizacion')`) incorpora la columna automáticamente sin cambios
propios. `SOCIO_TEMPLATE_EXAMPLE` necesita una entrada de ejemplo — se
propone `'Organico'`, el valor real observado en producción
(`docs/schema_live.md:154-155`, `specs/padron_certificaciones_normalizado.md`
sección 1.2), consistente con el placeholder ya usado en
`SocioFormModal.jsx:151` (`placeholder="ej: Organico"`).

Texto libre, sin `enum` — mismo comportamiento que ya tiene el campo hoy
en `socioSchema` (`str` = `z.string().optional().nullable()`, sin
`.enum()`) y en `SocioFormModal.jsx:151` (`<input type="text">`, sin
`<select>`). No se propone agregar validación de enum nueva: el ADR-027 y
la auditoría previa (`padron_certificaciones_normalizado.md` sección 1.2)
confirmaron que ni la base ni Zod restringen sus valores hoy, y no hay
pedido explícito de cambiar eso acá.

### 1.2 Contrato de datos

Sin cambios de forma en ninguna función — `arrayToCsv`, `buildSociosCsv`,
`buildSocioTemplateCsv`, `parseCsv`, `normalizeRowKeys` ya son genéricas
sobre la lista de columnas/labels; agregar una entrada a
`SOCIO_EXPORT_COLUMNS`/`SOCIO_FIELD_LABELS` alcanza. `socioSchema` no
cambia (ya acepta el campo). `sociosActions.js` no cambia (confirmado en
la sección 0).

### 1.3 Archivos que toca

- `lib/padronCsv.js` — `SOCIO_EXPORT_COLUMNS`, `SOCIO_FIELD_LABELS`,
  `SOCIO_TEMPLATE_EXAMPLE` (3 ediciones puntuales).
- Ningún otro archivo de producción. `ImportPadronModal.jsx` no necesita
  cambios para este punto específico — ya envía `row.data` completo a
  `createSocio`.

### 1.4 Riesgos / mitigaciones

| Riesgo | Detalle | Mitigación propuesta |
|---|---|---|
| **Export re-lee un valor congelado, no el que se acaba de importar** | `exportSociosCsv` (`padronCsv.js:730-765`) hace `select([...SOCIO_EXPORT_COLUMNS, 'id'])` **directo de `PADRON_SOCIOS`**. Esa columna está congelada desde ADR-027: `createSocio`/`socioPayload()` (`sociosActions.js:263-279`) **nunca la escriben** en el INSERT. Un socio dado de alta por este importador reactivado quedará con `PADRON_SOCIOS.cert_org_estatus = NULL` aunque el CSV traía `"Organico"` y ese valor sí llegó correctamente a `SOCIO_CERTIFICACIONES.estado` (vía `syncSocioCertificaciones`). Si el usuario reexporta el padrón para revisar/reimportar, va a ver la columna vacía para todo socio creado después de ADR-027 — parece "se perdió el dato" aunque en realidad vive en la tabla nueva. | **Decisión pendiente, recomendada antes de implementar** (fuera del alcance literal de los 3 puntos pedidos, pero descubierta al verificar el camino de datos completo): (a) dejar el export tal cual, documentando la limitación en el propio código (mismo patrón de comentario ya usado en el ADR); o (b) hacer que `exportSociosCsv` calcule `cert_org_estatus` a partir de `SOCIO_CERTIFICACIONES.estado` (tomando cualquiera de las 5 filas "equivalencia orgánica" del socio, ya que `syncSocioCertificaciones` copia el mismo valor a las 5) en vez de leerlo de `PADRON_SOCIOS`. La opción (b) es la más correcta pero es un cambio de alcance mayor al pedido explícito de esta tarea — se deja como decisión abierta para la sesión de implementación. |
| **Reimportar un CSV exportado antes de este cambio** | Un CSV exportado con el formato viejo (sin columna `cert_org_estatus`) sigue siendo válido para reimportar: la columna nueva es opcional (`str`), su ausencia no dispara ni el rechazo por "columna no reconocida" (no es una columna *sobrante*, es una *faltante*) ni ningún error de Zod. | Ninguna acción necesaria — comportamiento ya correcto por diseño de Zod `.optional()`. |
| **Convivencia con el punto 3 (columna dispareja)** | Si se implementa también la sección 3 de este spec, una columna `cert_org_estatus` con algunas filas completas y otras vacías en el mismo archivo pasaría a **bloquear el archivo completo** (no es de los campos obligatorios listados en el pedido). | Documentado como comportamiento esperado en la sección 3 — no es un riesgo nuevo, es la interacción prevista entre ambos puntos. |
| **Nombre de columna igual a la de la UI, pero editable ahora también por CSV** | El campo ya era editable manualmente vía `SocioFormModal.jsx:151` — reactivarlo en CSV no abre superficie nueva de escritura, solo un segundo canal hacia el mismo campo que ya existía. | Ninguna acción necesaria. |

---

## 2. Columna no reconocida → aviso no bloqueante, parejo en Socios y Parcelas

### 2.1 Diseño

**`parseCsv` no cambia.** No tiene (ni debería tener) noción de qué
columna es "reconocida" — eso es conocimiento de schema/labels, que vive
en `validateSocioRows`/`validateParcelaRows`. Mantener esa separación de
responsabilidades (mismo criterio que ya usa el archivo hoy: `parseCsv`
es un parser genérico texto→objetos, `normalizeRowKeys`/`findUnrecognized*`
son las que conocen los campos del dominio).

**`validateSocioRows`:**
- `findUnrecognizedSocioColumns` (línea 376-382) deja de usarse solo para
  lanzar — su resultado (`unrecognized: string[]`) se transporta en el
  valor de retorno en vez de disparar un `throw` que aborta todo.
- Se elimina el `throw new Error(...)` de las líneas 581-584.
- El resto del flujo (Zod por fila, duplicados internos, chequeos contra
  DB) sigue exactamente igual — las columnas no reconocidas simplemente
  se ignoran en el parseo de cada fila (ya es lo que hace
  `normalizeRowKeys`, que deja pasar una clave no mapeada tal cual y Zod
  la descarta al no estar declarada en el schema).

**`validateParcelaRows`:** hoy no tiene ningún chequeo de columnas
desconocidas (confirmado en la sección 0). Se agrega una función nueva,
**simétrica** a `findUnrecognizedSocioColumns` pero sin dependencia de
`supabase` (Parcelas no tiene columnas dinámicas de catálogo — su mapa de
encabezados, `PARCELA_REVERSE_LABELS`, es estático):

```js
// lib/padronCsv.js — nueva función, mismo criterio que
// findUnrecognizedSocioColumns pero sin necesitar supabase
function findUnrecognizedParcelaColumns(rows) {
  const rawKeys = new Set()
  for (const row of rows || []) {
    for (const key of Object.keys(row)) rawKeys.add(key.trim())
  }
  return [...rawKeys].filter((key) => key && !PARCELA_REVERSE_LABELS.has(key.toLowerCase()))
}
```

**Asimetría que se mantiene a propósito (no es un descuido):** para
Socios, la detección de columnas de certificación dinámicas sigue
necesitando `supabase` (para resolver el catálogo activo vía
`fetchActiveCertificaciones` — sin eso no hay forma de distinguir una
columna de certificación real de un typo). En **modo offline** (sin
`supabase`), Socios sigue sin poder emitir ese warning con precisión —
mismo criterio de degradación que ya documenta el comentario de
`validateSocioRows` hoy (`padronCsv.js:565-566`, "sin `supabase`, esta
validación específica se omite"). Para Parcelas, en cambio, el chequeo
nuevo **no depende de `supabase`** (su mapa de encabezados es estático) —
corre siempre, con o sin conexión.

**Contrato de datos nuevo — cambia la forma de retorno de ambas
funciones** (breaking change, ver migración de tests en sección 5):

```js
/**
 * @returns {Promise<{
 *   rows: Array<{ index, raw, normalized, valid, data, errors }>,  // igual que hoy
 *   unrecognizedColumns: string[],  // encabezados crudos ignorados, [] si ninguno
 * }>}
 */
export async function validateSocioRows(rows, supabase, organizationId) { … }
export async function validateParcelaRows(rows, supabase, organizationId) { … }
```

`rows` conserva exactamente la misma forma de objeto por fila que hoy
devuelve el array raíz — el único cambio es que ahora está anidado bajo
`.rows` en vez de ser el valor de retorno directo.

**`ImportPadronModal.jsx`:**

```js
// antes:
const result = tab === 'socios'
  ? await validateSocioRows(rows, supabase, organizationId)
  : await validateParcelaRows(rows, supabase, organizationId)
setValidated(result)

// después:
const { rows: result, unrecognizedColumns } = tab === 'socios'
  ? await validateSocioRows(rows, supabase, organizationId)
  : await validateParcelaRows(rows, supabase, organizationId)
setValidated(result)
setUnrecognizedColumns(unrecognizedColumns)  // useState nuevo
```

UI nueva (arriba de la tabla de preview, mismo lugar donde hoy vive
`parseError`, línea 164): banner amarillo no bloqueante, visible solo si
`unrecognizedColumns.length > 0`:

```jsx
{unrecognizedColumns.length > 0 && (
  <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
    {unrecognizedColumns.length} columna(s) no reconocida(s), fueron ignoradas: {unrecognizedColumns.join(', ')}
  </p>
)}
```

No bloquea `handleConfirmImport` — el botón "Confirmar Importación" sigue
habilitándose según `validRows.length` como hoy (línea 232), sin nueva
condición.

### 2.2 Archivos que toca

- `lib/padronCsv.js` — `validateSocioRows` (quita el `throw`, agrega
  `unrecognizedColumns` al retorno), `validateParcelaRows` (agrega el
  chequeo nuevo + `unrecognizedColumns` al retorno), función nueva
  `findUnrecognizedParcelaColumns`.
- `components/features/socios/ImportPadronModal.jsx` — destructuring del
  nuevo retorno, `useState` nuevo, banner de warning en el JSX.
- `tests/test_padron_csv.mjs` — **26-28 sitios de llamada** necesitan
  actualizarse por el cambio de forma de retorno (detalle en sección 5).
  2 tests específicos cambian de intención: los que hoy esperan
  `assert.rejects(...)` por columna no reconocida (líneas 468-478,
  480-490) pasan a esperar `result.unrecognizedColumns` con el encabezado
  correspondiente, **no** un rechazo.

### 2.3 Riesgos / mitigaciones

| Riesgo | Detalle | Mitigación propuesta |
|---|---|---|
| **Breaking change de contrato — no es retrocompatible** | Cualquier código (o test) que trate el resultado de `validate...Rows` como array directo (`.filter()`, `.map()`, `[0]`, `.length`) se rompe en tiempo de ejecución si no se actualiza (obtendría `undefined.filter is not a function` sobre un objeto `{rows, unrecognizedColumns}` en vez de un array). | Confirmado que el único caller de producción es `ImportPadronModal.jsx` (grep de la sección 0) — cambio acotado y controlado. `tests/test_padron_csv.mjs` requiere una pasada de actualización mecánica (mismo patrón repetido ~28 veces: `const [result] = await X` → `const { rows: [result] } = await X`, o `const results = await X` → `const { rows: results } = await X`). Se detalla en sección 5 como parte del plan de implementación, no de este spec. |
| **Se pierde la garantía "un typo nunca se pierde en silencio"** (motivación original de ADR-027 sección 6.1: *"nunca se ignora en silencio, para que un typo o una certificación desactivada no se pierdan sin que el usuario se entere"*) | El pedido explícito de esta tarea es exactamente relajar esa garantía (de bloqueante a aviso) — se documenta acá como una **reversión consciente** de una decisión de ADR-027, no un descuido. El usuario sigue enterándose (vía el banner), solo que ya no se le impide continuar. | Ninguna mitigación adicional más allá de que el banner sea visualmente inevitable (no un tooltip oculto) — ya diseñado así (banner arriba de la tabla, no un ícono discreto). |
| **Un CSV con un typo en una columna de certificación ahora IMPORTA igual, sin esa certificación** | Ej.: encabezado `"Rainforezt Alliance"` (typo) — antes rechazaba el archivo completo; ahora la fila se importa con esa certificación simplemente ausente (la columna se ignora, no hay campo `cert_rainforest` en `row.data` para esa fila) y el usuario ve el aviso solo si lee el banner. | Riesgo aceptado por diseño explícito del punto 2 del pedido — mismo criterio que ya aplica hoy a **cualquier otra** columna no reconocida en Parcelas (donde nunca hubo bloqueo). Si se quiere un resguardo adicional, podría evaluarse (fuera de alcance de este spec) resaltar en la fila de la tabla de preview qué certificaciones quedaron sin marcar por este motivo — no diseñado acá por no haber sido pedido. |
| **Archivos ya en uso / exportados con el formato viejo** | No hay cambio de formato de columnas en este punto (a diferencia del punto 1) — un CSV viejo sigue funcionando exactamente igual, solo cambia qué pasa cuando algo *no* matchea. | Sin impacto retroactivo. |

---

## 3. Validación nueva de "columna dispareja"

### 3.1 Diseño

**Definición operativa** (tal como la especifica el pedido): para cada
campo **no obligatorio** de la fila, contar cuántas filas del archivo
tienen ese campo con valor no vacío (`filledCount`) y cuántas lo tienen
vacío (`emptyCount`, sobre el total de filas del archivo, no solo las que
tienen *algún* dato). Si `filledCount === 0` → no se valida nada, pasa
normal (la organización no cargó ese dato). Si `filledCount > 0 &&
emptyCount > 0` → **se bloquea el archivo completo** (no solo esas filas)
con un mensaje que identifica columna(s) + fila(s) vacías.

**Campos obligatorios excluidos del chequeo (sin cambios, tal como los
fija el pedido):**
- Socios: `ID_Socio`, `socio_nombre_completo` (los únicos con `min(1,
  'Requerido')` en `socioSchema`, confirmado en la tarea anterior).
- Parcelas: `ID_Parcela_Fija`, `ID_Socio` (los `min(1, ...)` de
  `parcelaSchema`), más la validación de conjunto "suma de hectáreas > 0"
  (el `.refine` de `parcelaSchema:175-178`) — este último **no es un
  campo individual**, así que no aplica al chequeo columna-por-columna;
  sigue resolviéndose donde ya se resuelve hoy (Zod, por fila).

**Campos que SÍ entran en el chequeo (propuesta, a confirmar):**

| Entidad | Campos a chequear |
|---|---|
| Socios | `codigo_finca`, `socio_dni`, `socio_genero`, `socio_fecha_nacimiento`, `celular_socio`, `socio_departamento`, `socio_provincia`, `socio_distrito`, `localidad`, `socio_fecha_ingreso`, `cert_org_estatus` (si se implementa el punto 1), y **cada columna de certificación dinámica presente en el archivo** (`cert_nop_usda`, `ue_2018_848`, …, resueltas vía el mismo mapeo `CODIGO_TO_FIELD` que ya usa `buildSocioReverseLabelsWithCertificaciones`). |
| Parcelas | `parcela_codigo`, `parcela_nombre`, `id_producto_predominante`, y **cada una de las 7 columnas de hectárea individuales** (`hcp`, `hcc`, `ho`, `hip`, `hrp`, `hbp`, `otros_cultivo`) — ver el riesgo específico sobre esto en 3.4, es el punto más delicado del diseño. |

**Dónde corre en el pipeline (respuesta directa a lo pedido):** el
chequeo corre **antes** de todo lo demás — antes del parseo Zod por fila,
antes de los chequeos de duplicados internos, y antes de los chequeos
contra la base. Orden final propuesto para `validateSocioRows`/
`validateParcelaRows`:

1. `parseCsv` (sin cambios).
2. `normalizeRowKeys` por fila (sin cambios, ya resuelto hoy).
3. **Detección de columnas no reconocidas** (punto 2 de este spec) — no
   bloqueante, se acumula en `unrecognizedColumns`.
4. **Detección de columna dispareja (punto 3, nuevo)** — bloqueante: si
   encuentra algo, `throw` inmediato, no se sigue procesando el archivo.
5. Validación Zod por fila (`socioSchema`/`parcelaSchema.safeParse`).
6. Chequeo de duplicados internos (`applyDuplicateChecks`, sin cambios).
7. Chequeos contra la base (`applySocioDbChecks`/`applyParcelaDbChecks`,
   sin cambios, solo si `supabase`+`organizationId`).

Razón del orden: es el chequeo más barato (memoria pura, sin red) y el
más "todo o nada" — no tiene sentido gastar una ida y vuelta a la base
(paso 7) validando duplicados contra socios reales si el archivo va a
rechazarse igual por columnas incompletas. Corre **independiente** de
`supabase`/`organizationId` (no depende de la base, salvo indirectamente
para Socios: sin `supabase`, las columnas dinámicas de certificación no
se resuelven a un campo conocido — mismo criterio de degradación que el
punto 2 — así que en modo offline el chequeo de dispareja para Socios
cubre menos columnas, pero sigue corriendo para las fijas).

### 3.2 Contrato de datos / mensaje exacto

Función nueva, compartida entre Socios y Parcelas:

```js
/**
 * @param {Array<Object>} normalizedRows
 * @param {Array<{key: string, label: string}>} fieldsToCheck
 * @returns {Array<{key, label, emptyRowNumbers: number[], filledCount: number, totalRows: number}>}
 */
function findUnevenColumns(normalizedRows, fieldsToCheck) {
  const offenders = []
  for (const { key, label } of fieldsToCheck) {
    const emptyRowNumbers = []
    let filledCount = 0
    normalizedRows.forEach((row, i) => {
      const value = (row[key] ?? '').toString().trim()
      if (value) filledCount += 1
      else emptyRowNumbers.push(i + 2) // fila 1 = encabezado, mismo criterio que applyDuplicateChecks
    })
    if (filledCount > 0 && emptyRowNumbers.length > 0) {
      offenders.push({ key, label, emptyRowNumbers, filledCount, totalRows: normalizedRows.length })
    }
  }
  return offenders
}
```

Invocación (esquema, dentro de `validateSocioRows`/`validateParcelaRows`,
paso 4 del pipeline de 3.1):

```js
const uneven = findUnevenColumns(normalizedRows, SOCIO_UNEVEN_CHECK_FIELDS)
if (uneven.length > 0) {
  throw new Error(formatUnevenColumnsError(uneven))
}
```

**Formato exacto del mensaje** (una línea de cabecera + una línea por
columna afectada, en español, mismo tono que los mensajes ya existentes
del archivo, ej. `applySocioDbChecks`):

```
El archivo tiene columna(s) con datos incompletos — completá el dato faltante
en el Excel de origen o borrá la columna entera si no vas a cargar ese dato
todavía:
- DNI: 12 de 15 fila(s) tienen valor, vacío en fila(s) 3, 7, 12.
- Departamento: 14 de 15 fila(s) tienen valor, vacío en fila(s) 9.
```

Generado por:

```js
function formatUnevenColumnsError(offenders) {
  const lines = offenders.map(
    (o) => `- ${o.label}: ${o.filledCount} de ${o.totalRows} fila(s) tienen valor, vacío en fila(s) ${o.emptyRowNumbers.join(', ')}.`
  )
  return [
    'El archivo tiene columna(s) con datos incompletos — completá el dato faltante',
    'en el Excel de origen o borrá la columna entera si no vas a cargar ese dato',
    'todavía:',
    ...lines,
  ].join('\n')
}
```

`ImportPadronModal.jsx` no necesita cambios de UI nuevos para este punto
— el `throw` cae en el mismo `catch` que ya existe (línea 69-70,
`setParseError(err?.message || …)`), y `parseError` ya se renderiza en un
bloque rojo (línea 164) — consistente con que esta es una condición
**bloqueante** (a diferencia del punto 2, que es un banner amarillo no
bloqueante aparte).

### 3.3 Archivos que toca

- `lib/padronCsv.js` — función nueva `findUnevenColumns` +
  `formatUnevenColumnsError`, listas `SOCIO_UNEVEN_CHECK_FIELDS`/
  `PARCELA_UNEVEN_CHECK_FIELDS`, invocación nueva al inicio de
  `validateSocioRows`/`validateParcelaRows`.
- `components/features/socios/ImportPadronModal.jsx` — sin cambios (el
  `catch` existente ya cubre este caso).
- `tests/test_padron_csv.mjs` — casos nuevos a agregar (no builtins, no
  modifica los existentes salvo por el punto 2).

### 3.4 Riesgos / mitigaciones

| Riesgo | Detalle | Mitigación propuesta |
|---|---|---|
| **Punto más delicado del diseño: las 7 columnas de hectárea individuales son las más propensas a "dispareja" legítima, no por error** | Un archivo real y perfectamente válido puede tener, para una parcela sin cultivo en crecimiento, la celda `hcc` vacía en vez de `0` — es una diferencia semántica sutil (¿"no sé/no aplica" vs. "es cero"?) que muchas planillas reales no distinguen consistentemente fila por fila. Con la regla tal como la pide el prompt (aplicada literalmente a las 7 columnas), **es probable que la mayoría de los padrones reales de parcelas queden bloqueados** en el primer intento, incluso sin ningún error real de carga — cada categoría de hectárea que no aplique a una sola fila (algo esperable: no toda parcela tiene "reserva/protección" o "infraestructura productiva") dispara el bloqueo total. | **No se decide en este spec — se deja como pregunta abierta para antes de implementar.** Dos alternativas concretas: **(A)** aplicar el chequeo tal como lo pide el prompt, literal, a las 7 columnas — riesgo de fricción alta en el primer uso real, pero exactamente lo pedido. **(B)** excluir las 7 columnas de hectárea del chequeo de "dispareja" (dejar solo `parcela_codigo`/`parcela_nombre`/`id_producto_predominante`) — el `nonNegativeNum` de Zod ya trata vacío y `0` como equivalentes a efectos de la suma (`Number(data[key]) || 0`, `parcelaSchema:176`), así que la ambigüedad vacío/cero ya está resuelta en otro nivel para el propósito real (que la suma sea > 0), y el chequeo de dispareja no aportaría una señal de calidad tan clara ahí como sí la aporta en campos descriptivos (DNI, departamento, etc.) donde "vacío" es inequívocamente "falta el dato". Se **recomienda (B)**, pero la decisión final queda para el usuario antes de implementar. |
| **Interacción con archivos exportados por el propio sistema** | `exportParcelasCsv`/`exportSociosCsv` siempre escriben **todas** las columnas fijas para **todas** las filas (`arrayToCsv` no omite celdas, escribe `''` si el valor es `null`/`undefined`, `escapeCsvCell:79-84`) — un socio sin `socio_dni` cargado exporta con la celda vacía, no con la columna ausente. Esto significa que un padrón real ya exportado hoy, reimportado tal cual, **puede quedar bloqueado por esta regla nueva** si algunos socios tienen DNI y otros no (escenario común: cooperativa que todavía no completó el DNI de todos sus socios). | Riesgo real, no hipotético — es el caso de uso más probable de "columna dispareja" en la práctica, y es exactamente el que el pedido busca capturar (forzar a completar o borrar la columna). Se documenta acá como comportamiento **esperado**, no como bug — pero vale que el usuario lo tenga presente: el primer re-import de un padrón exportado hoy probablemente falle con este mensaje, no por un error de carga sino porque el padrón real siempre tuvo huecos. |
| **Columnas dinámicas de certificación (Socios) con el chequeo activado** | Si se incluyen (tabla de 3.1), una organización que solo marcó `Sí`/`No` para algunos socios en una certificación puntual (dejando el resto vacío en vez de `'No'` explícito) también quedaría bloqueada. La plantilla en blanco (`buildSocioTemplateCsv`) ya precompleta `'No'` por defecto en las 8 (línea 188: `for (const cert of certificaciones) example[cert.id] = 'No'`) — mitiga el caso de quien parte de la plantilla, pero no el de quien arma el CSV a mano o reimporta un export viejo. | Mismo tipo de decisión que el riesgo anterior — aceptar como comportamiento esperado (fuerza a decidir `Sí`/`No` explícito por certificación) o excluir del chequeo. Se deja abierto junto con el punto de hectáreas, misma naturaleza de riesgo. |
| **Mensaje de error para archivos grandes con muchas columnas dispares** | Si el archivo tiene, por ejemplo, 5 columnas incompletas con 20 filas vacías cada una, el mensaje de error tendría 5 líneas con hasta 20 números de fila cada una — legible pero potencialmente largo. | No se propone truncar en este diseño (los mensajes de error existentes del archivo tampoco truncan, ej. `applySocioDbChecks` lista organización/socio completos) — si en la práctica resulta demasiado largo, es un ajuste de UI menor a resolver en implementación, no de contrato de datos. |
| **Convivencia con el punto 2 (avisos no bloqueantes)** | Una columna que el punto 2 marcaría como "no reconocida" (typo, certificación inactiva) **no** debe entrar en el chequeo de "dispareja" del punto 3 — no tiene un campo canónico contra el cual medir vacío/lleno. | Ya reflejado en el diseño: `findUnevenColumns` solo itera sobre `fieldsToCheck` (campos canónicos conocidos), nunca sobre las claves crudas no reconocidas — una columna no reconocida simplemente no participa de este chequeo, coherente con que tampoco participa de la validación Zod. |

---

## 4. Contrato final combinado (resumen)

| Función | Firma hoy | Firma propuesta | Tipo de cambio |
|---|---|---|---|
| `parseCsv(text)` | `Array<Object>` | **sin cambios** | — |
| `validateSocioRows(rows, supabase?, organizationId?)` | `Promise<Array<RowResult>>` | `Promise<{ rows: Array<RowResult>, unrecognizedColumns: string[] }>` — y ya no lanza por columna no reconocida (sí sigue lanzando, con mensaje distinto, por columna dispareja) | **Breaking** |
| `validateParcelaRows(rows, supabase?, organizationId?)` | `Promise<Array<RowResult>>` | `Promise<{ rows: Array<RowResult>, unrecognizedColumns: string[] }>` — gana detección de no-reconocidas (nueva) y de dispareja (nueva, lanza) | **Breaking** |

`RowResult` (forma de cada elemento de `.rows`, sin cambios respecto a
hoy): `{ index, raw, normalized, valid, data, errors }`.

---

## 5. Impacto en tests existentes (a resolver en la implementación, no en este spec)

`tests/test_padron_csv.mjs` tiene **28 sitios** que llaman a
`validateSocioRows`/`validateParcelaRows` esperando el array directo
(`const [result] = await …`, `const results = await …`, y 2 asserts de
igualdad contra `[]`). Todos requieren el mismo ajuste mecánico:

```js
// antes
const [result] = await validateSocioRows([...])
// después
const { rows: [result] } = await validateSocioRows([...])

// antes
const results = await validateParcelaRows([...])
// después
const { rows: results } = await validateParcelaRows([...])

// antes
assert.deepEqual(await validateSocioRows([]), [])
// después
assert.deepEqual((await validateSocioRows([])).rows, [])
```

Dos tests cambian de **intención**, no solo de sintaxis (líneas 468-478 y
480-490 del archivo actual): hoy usan `assert.rejects(...)` esperando que
`validateSocioRows` lance por columna no reconocida — con el punto 2
implementado, esas dos aserciones deben reescribirse para esperar
`result.unrecognizedColumns` conteniendo el encabezado correspondiente,
**sin** rechazo. Se agregan, además, casos nuevos para: `unrecognizedColumns`
vacío en el caso feliz, la detección simétrica en Parcelas
(`findUnrecognizedParcelaColumns`), y los casos bloqueantes/no bloqueantes
de `findUnevenColumns` (columna con 0 filas llenas → pasa; con todas
llenas → pasa; con mezcla → bloquea con el mensaje exacto).
