# Spec — Mejoras al Importador de Padrón Masivo (CSV)

- **Estado:** **Implementado** (ronda 7, 2026-09-01) — ver sección 10 para
  el diseño/implementación de esta ronda (corrección del texto exacto del
  label de `hip` + resumen agrupado de errores en el preview). Rondas 1-6
  (secciones 1-9) quedan cerradas, sin reabrir salvo el label de `hip`
  (10.1, corrige una corrección de la ronda 6/3).
- **Fecha:** 2026-08-31 (ronda 1: diseño; ronda 2: cierre de decisiones +
  implementación; ronda 3, mismo día: hallazgos de la primera carga real
  de producción, COOP-AROMAS-VALLE, 618 socios / 825 parcelas); 2026-09-01
  (ronda 4: corrección de ambigüedad en fecha + extensión a Provincia;
  ronda 5, mismo día: extensión a Distrito; ronda 6, mismo día: más
  hallazgos de la misma carga real + mensajes legibles; ronda 7, mismo
  día: corrección del label exacto de `hip` + resumen agrupado de
  errores)
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
| **Export re-lee un valor congelado, no el que se acaba de importar** — **RESUELTO (ronda 2)** | `exportSociosCsv` (`padronCsv.js:730-765`) hacía `select([...SOCIO_EXPORT_COLUMNS, 'id'])` **directo de `PADRON_SOCIOS`**. Esa columna está congelada desde ADR-027: `createSocio`/`socioPayload()` (`sociosActions.js:263-279`) **nunca la escriben** en el INSERT. Un socio dado de alta por este importador reactivado quedaría con `PADRON_SOCIOS.cert_org_estatus = NULL` aunque el CSV traía `"Organico"` y ese valor sí llegó correctamente a `SOCIO_CERTIFICACIONES.estado` (vía `syncSocioCertificaciones`). | **Se implementa (b): `exportSociosCsv` calcula `cert_org_estatus` en vivo desde `SOCIO_CERTIFICACIONES`, no desde `PADRON_SOCIOS`.** Investigación previa a decidir el criterio de divergencia (ver texto debajo de esta tabla): se confirmó que **no existe ningún camino de escritura independiente** hacia `SOCIO_CERTIFICACIONES.estado` fuera de `syncSocioCertificaciones` (grep de `SOCIO_CERTIFICACIONES` en todo el repo — único `INSERT`/`DELETE`, `sociosActions.js:319,336`, llamado solo desde `createSocio`/`updateSocio`, ambos con estrategia "borrar todo y reinsertar" que escribe el mismo `cert_org_estatus` a las 5 filas orgánicas en la misma operación). La divergencia entre las 5 solo puede originarse por una edición manual directa en Supabase Studio, no por el flujo normal de la app. Criterio adoptado: si las 5 (o las que existan) coinciden, se usa ese valor; si divergen, se usa el valor de la fila con `actualizado_en` más reciente (columna que sí existe en `SOCIO_CERTIFICACIONES`, confirmada en `20260825222933_certificaciones_normalizadas.sql:60` — no es una fuente de verdad perfecta porque el flujo actual nunca hace `UPDATE` in-place, solo `DELETE`+`INSERT`, así que en la práctica `actualizado_en === creado_en` para toda fila escrita por la app; sigue siendo la mejor señal disponible y queda correcta automáticamente si en el futuro se agrega una edición in-place) y se deja un `console.warn` con el `id_socio` y los valores en conflicto, para que la divergencia quede rastreable sin bloquear la descarga. Implementado en la función nueva y exportada `fetchSocioCertOrgEstatus(supabase, socioIds)` (`lib/padronCsv.js`), testeable sin `document`/`Blob` a diferencia de `exportSociosCsv` misma. |
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
| Socios | `codigo_finca`, `socio_dni`, `socio_genero`, `socio_fecha_nacimiento`, `celular_socio`, `socio_departamento`, `socio_provincia`, `socio_distrito`, `localidad`, `socio_fecha_ingreso`, `cert_org_estatus` (ya reactivado, sección 1), y las 8 columnas de certificación (`CERT_FLAG_FIELDS`: `cert_nop_usda`, `ue_2018_848`, `cor_canada`, `cert_ds_0442006_ag`, `cert_lpo_mx`, `cert_rainforest`, `cert_comercio_justo`, `cert_fair_trade_usa`) — cuando el archivo trae la columna de certificación dinámica correspondiente reconocida (catálogo activo + `supabase` provisto); si no está presente en el archivo, la columna simplemente tiene 0 filas con valor y el chequeo la salta sin efecto, no hace falta lógica condicional extra. |
| Parcelas | `parcela_codigo`, `parcela_nombre` — **RESUELTO, corrección de premisa:** `id_producto_predominante` se había listado acá por error; se verificó que **no es una columna reconocida por el importador CSV** hoy (no está en `PARCELA_FIELD_LABELS`/`PARCELA_EXPORT_COLUMNS`, solo en `parcelaSchema` — un CSV con un encabezado literal `id_producto_predominante`, exacto y sensible a mayúsculas, cuela igual por una coincidencia accidental de `normalizeRowKeys` con la clave cruda, pero no es parte de la superficie oficial de columnas). Se excluye del chequeo por no ser parte del conjunto que `findUnrecognizedParcelaColumns`/`PARCELA_FIELD_LABELS` reconocen — igual que el resto del diseño, que deriva la lista de campos a partir de `*_FIELD_LABELS`, no del schema Zod completo. Las 7 columnas de hectárea (`hcp`, `hcc`, `ho`, `hip`, `hrp`, `hbp`, `otros_cultivo`) quedan **excluidas** del chequeo — ver decisión en 3.4. |

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
| **Las 7 columnas de hectárea individuales — RESUELTO: se adopta la Opción B, quedan EXCLUIDAS** | Un archivo real y perfectamente válido puede tener, para una parcela sin cultivo en crecimiento, la celda `hcc` vacía en vez de `0` — en la práctica real de las planillas, "vacío" y "0" son equivalentes en estas columnas (ninguna cooperativa distingue consistentemente fila por fila "no aplica" de "es cero"). Aplicar el chequeo literal a las 7 columnas habría bloqueado la mayoría de los padrones reales de parcelas en el primer intento, sin ningún error real de carga — cada categoría de hectárea que no aplique a una sola fila (esperable: no toda parcela tiene "reserva/protección" o "infraestructura productiva") habría disparado el bloqueo total. | **Decisión adoptada:** las 7 columnas de hectárea quedan fuera de `PARCELA_UNEVEN_CHECK_FIELDS` — el chequeo de columna dispareja para Parcelas cubre solo `parcela_codigo`/`parcela_nombre`. Fundamento: el `nonNegativeNum` de Zod ya trata vacío y `0` como equivalentes a efectos de la suma (`Number(data[key]) || 0`, `parcelaSchema:176`), así que la ambigüedad vacío/cero ya está resuelta en otro nivel para el propósito real (que la suma total sea > 0); el chequeo de dispareja no aporta una señal de calidad tan clara ahí como sí la aporta en campos descriptivos (DNI, departamento, etc.) donde "vacío" es inequívocamente "falta el dato". |
| **Interacción con archivos exportados por el propio sistema** | `exportParcelasCsv`/`exportSociosCsv` siempre escriben **todas** las columnas fijas para **todas** las filas (`arrayToCsv` no omite celdas, escribe `''` si el valor es `null`/`undefined`, `escapeCsvCell:79-84`) — un socio sin `socio_dni` cargado exporta con la celda vacía, no con la columna ausente. Esto significa que un padrón real ya exportado hoy, reimportado tal cual, **puede quedar bloqueado por esta regla nueva** si algunos socios tienen DNI y otros no (escenario común: cooperativa que todavía no completó el DNI de todos sus socios). | Riesgo real, no hipotético — es el caso de uso más probable de "columna dispareja" en la práctica, y es exactamente el que el pedido busca capturar (forzar a completar o borrar la columna). Se documenta acá como comportamiento **esperado**, no como bug — pero vale que el usuario lo tenga presente: el primer re-import de un padrón exportado hoy probablemente falle con este mensaje, no por un error de carga sino porque el padrón real siempre tuvo huecos. |
| **Columnas de certificación (Socios) sí quedan dentro del chequeo — decisión adoptada** | A diferencia de las hectáreas, las 8 columnas de `CERT_FLAG_FIELDS` (`cert_nop_usda`, etc.) **no** se excluyen: `'Sí'`/`'No'` no tiene la misma ambigüedad vacío=cero que un campo numérico — acá "vacío" es inequívocamente "no se cargó el dato", igual que un DNI o un departamento vacíos. Una organización que solo marcó `Sí`/`No` para algunos socios en una certificación puntual (dejando el resto vacío) queda bloqueada, a propósito: fuerza a decidir `Sí`/`No` explícito por certificación en vez de dejarlo ambiguo. La plantilla en blanco (`buildSocioTemplateCsv`) ya precompleta `'No'` por defecto en las 8 (línea 188), lo que evita el problema para quien parte de la plantilla; el caso real de fricción es reimportar un export viejo o un CSV armado a mano con celdas salteadas. | Comportamiento aceptado como correcto — es exactamente la señal de calidad que el punto 3 del pedido busca capturar. Si en la práctica genera fricción alta, ajustar es un cambio de una línea (mover `CERT_FLAG_FIELDS` fuera de `SOCIO_UNEVEN_CHECK_FIELDS`), no un rediseño. |
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

---

## 6. Ronda 3 (2026-08-31) — controles de calidad post-carga real + corrección de labels de hectárea

Disparada por la primera carga real de producción: **COOP-AROMAS-VALLE**,
618 socios / 825 parcelas, archivos `Plantilla_Socios_prueba.csv` /
`Plantilla_Parcelas_prueba.csv` (`~/Downloads/`, 2026-08-31). El usuario
reportó que Parcelas salía con "5 columnas no reconocidas" y 0 de 825
filas válidas.

### 6.0 Investigación (antes de tocar código)

**6.0.a — Causa raíz real de "5 columnas no reconocidas": codificación de
caracteres, NO el reverse-label-map.**

Comparación de bytes crudos del encabezado real de `Plantilla_Parcelas_prueba.csv`
contra UTF-8:

```
Bytes reales:  43 f3 64 69 67 6f      → "C" + 0xF3 + "digo"
UTF-8 válido:  43 c3 b3 64 69 67 6f   → "C" + 0xC3 0xB3 + "digo"  ("Código")
```

El archivo está en **Windows-1252/ANSI** (Excel "CSV" plano), no en UTF-8
— el byte suelto `0xF3` no es una secuencia UTF-8 válida. `file.text()`
(`ImportPadronModal.jsx`, único call site) decodifica **siempre** como
UTF-8, así que cada encabezado con tilde se corrompe. Las 5 columnas
reportadas como "no reconocidas" (Código de Parcela, Código de Socio,
Código Interno de Parcela, Ha. En Producción, Ha. Reserva/Protección) son
exactamente — y únicamente — las que tienen tilde en su label canónico;
las que no tienen tilde (Nombre de la Parcela, Ha. En Crecimiento, Ha.
Otros, Ha. Infraestructura Productiva, Ha. Bosque Protector, Ha. Otros
Cultivos) no fallaron. `ID_Parcela_Fija`/`ID_Socio` (los 2 únicos campos
requeridos de Parcelas) están entre las corrompidas → explica el "0 de
825 filas válidas".

**El commit `e031450` (delimitador flexible) no cubre esto** — es un
problema distinto (codificación de caracteres, no delimitador de
columnas). Confirmado que el MISMO usuario, el MISMO día, exportó
`Plantilla_Socios_prueba.csv` en **UTF-8 real con BOM** (`xxd`: `ef bb bf`
+ `c3 b3`) — es decir, Excel generó dos archivos con codificaciones
DISTINTAS el mismo día (probablemente "CSV UTF-8" vs. "CSV" plano, dos
opciones de exportación distintas de Excel). El fix no puede asumir
ninguna codificación fija.

**Corrección de premisa (el prompt original asumía otra causa):** el
renombrado de labels de hip/hrp (pedido en el mismo prompt, ver 6.0.b) NO
es la causa de las 5 columnas no reconocidas — `Ha. Infraestructura
Productiva` (el label VIEJO, sin tilde) no está en la lista de columnas
no reconocidas del usuario; la única de las 7 de hectárea que sí está ahí
es `Ha. Reserva/Protección`, y es por la tilde de "Protección", no por el
texto. El fix de codificación por sí solo resuelve las 5 columnas — el
renombrado de labels es un cambio de negocio real y válido (pedido
explícito), pero no corrige el bug reportado.

**Fix implementado:** `decodeCsvBuffer(buffer)` (`lib/padronCsv.js`,
función pura, exportada) — intenta `TextDecoder('utf-8', {fatal: true})`
primero (rechaza el byte suelto 0xF3, no válido como UTF-8) y si falla
reintenta `TextDecoder('windows-1252')`. `ImportPadronModal.jsx` usa
`file.arrayBuffer()` + `decodeCsvBuffer` en vez de `file.text()`. Un
archivo ya en UTF-8 correcto (con o sin BOM) nunca activa el fallback.

**6.0.b — Mapeo campo→label actual de las 7 hectáreas** (`HECTARE_FIELDS`,
antes de esta ronda):

| Campo | Label (antes de ronda 3) | Label (después, ronda 3) |
|---|---|---|
| `hcp` | Ha. En Producción | *(sin cambio)* |
| `hcc` | Ha. En Crecimiento | *(sin cambio)* |
| `ho` | Ha. Otros | *(sin cambio)* |
| `hip` | Ha. Infraestructura Productiva | **Ha. Invernadero/Pasto** |
| `hrp` | Ha. Reserva/Protección | **Ha. Rastrojo/Purma** |
| `hbp` | Ha. Bosque Protector | *(sin cambio)* |
| `otros_cultivo` | Ha. Otros Cultivos | *(sin cambio)* |

Solo cambia el **label** (texto de display en CSV/plantilla/formulario
manual) — las columnas físicas siguen siendo `hip`/`hrp`, sin migración
de esquema. Un solo punto de cambio (`HECTARE_FIELDS` en
`lib/validations/socios.js`), compartido por `padronCsv.js` **y**
`ParcelaFormModal.jsx:96` (grilla del formulario manual) — mismo patrón
ya usado en ADR-028 para renombrar hcp/hcc.

**Hallazgos adicionales de la data real** (analizada con `python`/csv,
618 filas de Socios y 825 de Parcelas):

- **`socio_dni`**: 0 filas vacías; **10 de 618 con 7 dígitos** (perdieron
  el cero inicial — Excel trató la columna como numérica). Con DNI
  requerido + regex de 8 dígitos, esas 10 filas quedarán inválidas al
  reimportar — dato real a corregir en el Excel de origen, no un bug del
  importador.
- **`socio_dni` duplicados**: 0 en este archivo (el chequeo de 1e ya
  existía desde antes, confirmado, no se dispara acá).
- **`celular_socio`**: 618/618 con exactamente 9 dígitos — confirma que
  1d ya estaba resuelto (regex `/^\d{9}$/` condicional,
  `lib/validations/socios.js:25-30`, sin cambios).
- **`socio_departamento`**: único valor en las 618 filas: "Cajamarca".
  **Ya existe un catálogo completo de ubigeo** en el repo
  (`lib/data/ubigeo_peru.json` + `lib/ubigeoData.js`, usado hoy por
  `UbigeoSelect.jsx` en el formulario manual) con los 25 departamentos
  oficiales **y también las ~196 provincias completas** — corrige 2
  premisas del pedido original: no hacía falta crear ningún archivo
  nuevo, y Provincia también podría validarse en el futuro sin inventar
  ningún dataset (queda fuera de esta ronda a propósito, por instrucción
  explícita).
- **Hectáreas ≥1000**: máximo real observado es **30** (suma de las 7
  columnas) — el aviso de 1g no se dispara con este archivo, diseño
  validado para datos futuros.
- **Integridad Parcelas→Socios**: de 616 `ID_Socio` únicos referenciados
  por las 825 parcelas, **1 no existe**: literalmente el string `#N/D`
  (error de fórmula de Excel, tipo VLOOKUP fallido, filtrado a la celda)
  — evidencia real usada para diseñar el mensaje agrupado de 1h.

**Conflicto real resuelto con el usuario antes de implementar (paso 1c):**
`socio_fecha_nacimiento` no tenía ninguna validación de formato hasta
ahora (confirmado, nada que duplicar). El pedido original pedía
DD/MM/AAAA estricto, pero **478 de 544 fechas reales (88%) no matchean**
ese formato — son M/D/AAAA sin ceros (ej. "4/29/1986" = 29 de abril,
inequívoco porque 29 no puede ser mes). Implementar DD/MM/AAAA literal
habría rechazado casi 9 de cada 10 filas con fecha real. Se preguntó
explícitamente al usuario (`AskUserQuestion`) — eligió: **aceptar ambos
formatos (D/M/AAAA o M/D/AAAA), sin exigir ceros, sin distinguir
posicionalmente cuál parte es día y cuál es mes** (el campo es texto
libre de display, nada lo parsea como fecha real en ningún lugar del
repo hoy).

### 6.1 Diseño y decisiones (puntos a-h del pedido)

**a. "Columna dispareja" — Socios: retirado por completo.** No solo los
campos listados explícitamente en el pedido (fecha_nacimiento,
celular_socio, 8 flags, cert_org_estatus) — el pedido decía "TODOS los
campos opcionales de Socios", así que `SOCIO_UNEVEN_CHECK_FIELDS` se
eliminó entero (antes cubría también codigo_finca/socio_genero/
socio_departamento/etc.). Parcelas sin cambios — confirmado en la
investigación que `parcela_codigo`/`parcela_nombre` están 100% completos
en las 825 filas reales, sin riesgo de falso positivo.

**b. DNI obligatorio.** `dniRequerido = z.string().min(1,
'Requerido').regex(/^\d{8}$/, ...)` — nueva constante separada de `dni`
(que sigue opcional, usada solo por `conyuge_dni`) para no volver
obligatorio el DNI del cónyuge por error.

**c. Fecha de nacimiento — formato flexible (decisión confirmada con el
usuario, ver arriba).** Regex `^(\d{1,2})/(\d{1,2})/(\d{4})$` +
`.refine()`: acepta si `max(parte1, parte2) <= 31 && min(parte1, parte2)
<= 12` (existe al menos una lectura día/mes válida). Vacío sigue siendo
válido.

**d. Celular — confirmado sin cambios.** `celular_socio` ya validaba
`/^\d{9}$/` condicional desde antes; 618/618 valores reales lo cumplen.

**e. DNI duplicado en archivo — confirmado ya existente.** `applyDuplicateChecks`
ya incluía `socio_dni` en la lista de campos a chequear por duplicado
interno del archivo (desde antes de esta ronda) — sin cambios de código,
solo confirmación.

**f. Departamento contra catálogo — reusa el catálogo real existente.**
`applyDepartamentoCatalogCheck` (`lib/padronCsv.js`), nueva función,
corre siempre (no depende de `supabase`, el catálogo es JSON estático).
Comparación normalizada (NFD + strip de diacríticos, minúsculas) para
tolerar mayúsculas/tildes. **Decisión de arquitectura importante:** el
chequeo vive en `padronCsv.js`, **no** en `socioSchema` — `socioSchema`
es compartido con el formulario manual (`SocioFormModal.jsx`), y
`UbigeoSelect.jsx` ofrece deliberadamente una opción "Otro / no está en
la lista" que guarda texto libre fuera del catálogo (su propio comentario:
"un distrito real ausente del dataset NUNCA bloquea el alta de un socio
real"). Si el chequeo viviera en `socioSchema`, elegir "Otro" en el
formulario manual rompería el guardado — exactamente el caso que esa
opción existe para evitar. Provincia queda deliberadamente sin validar
(instrucción explícita del pedido), aunque el catálogo ya la tiene
completa — candidato barato para una ronda futura.

**g. Aviso no bloqueante de hectáreas ≥1000.** `findHectareRangeWarnings`
— mismo patrón que `unrecognizedColumns` (ronda 2): array de strings ya
formateados, no bloqueante. Extiende el contrato de retorno de
`validateParcelaRows` con `hectareWarnings: string[]`.

**h. Integridad referencial Parcelas→Socios — mensaje agrupado.**
`applyParcelaDbChecks` ya rechazaba (por fila) toda parcela cuyo
`ID_Socio` no existiera — confirmado, sin cambios en ese comportamiento.
Se agregó agrupación: la función ahora también devuelve un `Map<socioId,
número[]>` de líneas afectadas por cada `ID_Socio` faltante;
`validateParcelaRows` lo formatea en `missingSocioWarnings: string[]` (1
mensaje por `ID_Socio` distinto, con todas sus filas) — mismo patrón que
`unrecognizedColumns`/`hectareWarnings`, no un mecanismo paralelo.

### 6.2 Contrato de datos (extendido, no roto)

```
validateSocioRows(rows, supabase?, organizationId?)
  -> Promise<{ rows: Array, unrecognizedColumns: string[] }>   // SIN CAMBIOS de forma

validateParcelaRows(rows, supabase?, organizationId?)
  -> Promise<{
       rows: Array,
       unrecognizedColumns: string[],
       hectareWarnings: string[],       // NUEVO, ronda 3
       missingSocioWarnings: string[],  // NUEVO, ronda 3
     }>

decodeCsvBuffer(buffer: ArrayBuffer) -> string   // NUEVO, ronda 3, exportada
```

Ningún campo existente cambió de tipo ni se eliminó — extensión aditiva,
no breaking.

### 6.3 Archivos tocados

- `lib/validations/socios.js` — `dniRequerido`, `fechaNacimiento` +
  `FECHA_NACIMIENTO_REGEX`, `socio_dni`/`socio_fecha_nacimiento` en
  `socioSchema`, labels de `hip`/`hrp` en `HECTARE_FIELDS`.
- `lib/padronCsv.js` — `decodeCsvBuffer` (nueva, exportada),
  `applyDepartamentoCatalogCheck` + `normalizeForCatalogMatch` +
  `DEPARTAMENTOS_NORMALIZADOS` (nuevas), `findHectareRangeWarnings`
  (nueva), `applyParcelaDbChecks` extendida (agrupa missing socios),
  `SOCIO_UNEVEN_CHECK_FIELDS`/`SOCIO_REQUIRED_FIELDS` eliminadas + su
  invocación en `validateSocioRows`, `SOCIO_TEMPLATE_EXAMPLE.socio_fecha_nacimiento`
  actualizado a formato slash, import de `getDepartamentos` desde
  `./ubigeoData.js`.
- `components/features/socios/ImportPadronModal.jsx` — `readFileAsText`
  (usa `decodeCsvBuffer`), 2 banners nuevos (`missingSocioWarnings`,
  `hectareWarnings`), estado nuevo.
- `tests/test_padron_csv.mjs` — 13 tests existentes actualizados (DNI
  ahora requerido en sus fixtures, 2 tests de "columna dispareja para
  Socios" reescritos de "bloquea" a "NO bloquea"), ~30 tests nuevos.
- `tests/test_socios_schema.mjs` — `validSocio()` helper actualizado con
  DNI válido por defecto, 1 test reescrito (DNI vacío: de "acepta" a
  "rechaza"), 3 tests nuevos (conyuge_dni sigue opcional,
  fecha_nacimiento válida/inválida).
- **No creado:** `lib/data/peru_departamentos.js` — el catálogo ya
  existía (`lib/data/ubigeo_peru.json`), confirmado en la investigación
  0.b antes de crear nada nuevo.

### 6.4 Riesgos / notas para la reimportación real

| Riesgo | Detalle |
|---|---|
| **10 de 618 socios reales quedarán inválidos por DNI de 7 dígitos** | No es un bug — Excel les comió el cero inicial. El usuario va a necesitar corregir esas 10 filas en el Excel de origen (agregar el 0) antes de que esos socios puedan importarse. |
| **Reimportar un CSV exportado ANTES de esta ronda con hip/hrp** | El label viejo (Ha. Infraestructura Productiva/Ha. Reserva/Protección) ya no matchea `PARCELA_REVERSE_LABELS` → esas 2 columnas pasan a `unrecognizedColumns` (aviso no bloqueante desde la ronda 2, no bloquea) pero sus valores se pierden silenciosamente para esas filas si el usuario no nota el banner amarillo. |
| **Los otros 3 archivos en `~/Downloads/`** (`Padron_Parcelas_20260818*.csv`, `Padron_Socios_20260818*.csv`, `Plantilla_Parcelas.csv`/`Plantilla_Socios.csv`) | No se analizaron en esta ronda (son exports/plantillas más viejos, sin relación con el reporte "5 columnas no reconocidas" que motivó esta tarea, que apuntaba específicamente a los archivos `_prueba`). Si el usuario los va a reimportar también, valen las mismas 2 filas de riesgo de arriba. |
| **`socio_departamento` ahora rechaza fila si no matchea el catálogo** | Más estricto que el formulario manual (que tiene la opción "Otro"). Aceptado por diseño explícito del pedido — documentado en 6.1.f como asimetría consciente, no un descuido. |

---

## 7. Ronda 4 (2026-09-01) — fecha de nacimiento determinística + validación de Provincia

### 7.1 Corrección: fecha de nacimiento — de "acepta ambos órdenes" a formato ÚNICO M/D/AAAA

**Problema con el diseño de la ronda 3:** `fechaNacimiento` aceptaba
D/M/AAAA o M/D/AAAA indistintamente (`max(parte1,parte2) <= 31 &&
min(parte1,parte2) <= 12`). Esto es **ambiguo y silenciosamente
incorrecto** para cualquier fecha donde ambas partes son ≤12 — ej.
`"3/4/1990"`: ¿4 de marzo o 3 de abril? Ambas son fechas válidas, no hay
forma de saber cuál es la real sin más contexto. El diseño de la ronda 3
nunca fallaba de forma RUIDOSA (rechazando) en ese caso — fallaba de
forma SILENCIOSA (aceptando con una interpretación arbitraria que podía
estar invertida respecto a la real).

**Corrección:** formato único y determinístico **M/D/AAAA** (mes
primero), sin exigir ceros de relleno. Basado en la misma evidencia real
de la ronda 3 (sección 0, sin cambios: la primera carga real de
COOP-AROMAS-VALLE trae fechas en M/D/AAAA sin padding, ej. `"4/29/1986"`
= 29 de abril, inequívoco porque 29 no puede ser mes) — nunca hubo
evidencia real de D/M en este dataset, así que ya no hace falta
tolerarlo. Un valor en orden D/M (ej. `"29/4/1986"`, día primero) ahora
se **rechaza explícito** como formato inválido — no se acepta con un
fallback silencioso.

```js
// lib/validations/socios.js
const FECHA_NACIMIENTO_REGEX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const fechaNacimiento = z.string().optional().nullable().or(z.literal('')).refine(
  (val) => {
    if (!val) return true
    const match = val.match(FECHA_NACIMIENTO_REGEX)
    if (!match) return false
    const month = Number(match[1])
    const day = Number(match[2])
    return month >= 1 && month <= 12 && day >= 1 && day <= 31
  },
  { message: 'Formato de fecha inválido (usar M/D/AAAA, mes primero, ej. 4/29/1986)' }
)
```

**Por qué "aceptar ambos" es inaceptable, no solo subóptimo:** un
importador de datos reales no puede adivinar la intención del usuario
cuando existen dos lecturas igualmente válidas — hacerlo con un fallback
silencioso significa que una fracción desconocida de fechas quedaría
GUARDADA MAL sin que nadie se entere (a diferencia de un rechazo, que sí
se nota y se corrige). El único diseño seguro para un campo de fecha
ambiguo es fijar una convención única y rechazar explícitamente lo que no
la cumpla — obliga a corregir el dato en el origen (Excel) en vez de
adivinar en el importador.

**Impacto retroactivo:** cualquier fila real que dependiera del fallback
D/M (fecha con día >12, ej. `"25/3/1980"`) que antes pasaba por la
interpretación D/M ahora se **rechaza** — no hay evidencia de que el
dataset real de COOP-AROMAS-VALLE tenga casos así (todas las fechas
muestreadas son M/D consistentes), pero si aparece alguno al reimportar,
es la señal correcta de que esa fila necesita corregirse a mano sabiendo
que el sistema espera mes primero, no un bug del importador.

**Ejemplo de plantilla actualizado:** `SOCIO_TEMPLATE_EXAMPLE.socio_fecha_nacimiento`
(`lib/padronCsv.js`) pasó de `'14/5/1980'` (válida en cualquier orden, a
propósito no ambigua bajo el diseño viejo) a `'5/14/1980'` (14 de mayo —
solo válida como M/D, ya que 14 no puede ser mes).

### 7.2 Extensión: validación de Provincia contra el catálogo real

**Sin catálogo nuevo** — reusa `getProvincias(departamentoNombre)`,
función ya existente en `lib/ubigeoData.js` (confirmado antes de escribir
código, mismo criterio que la ronda 3 con Departamento). El JSON
subyacente (`lib/data/ubigeo_peru.json`) ya tenía las ~196 provincias
completas — la ronda 3 solo no las usaba porque no había sido pedido
todavía.

**Regla:** `socio_provincia` (si no está vacía) debe pertenecer al
`socio_departamento` declarado **en la misma fila** — no alcanza con que
la provincia exista en el catálogo general, tiene que existir DENTRO de
ese departamento específico. `applyDepartamentoCatalogCheck` se renombró
a `applyUbigeoCatalogChecks` (mismo archivo, `lib/padronCsv.js`) y ahora
resuelve primero el nombre canónico del departamento (necesario porque
`getProvincias()` requiere el nombre exacto del catálogo, no uno
normalizado) y luego valida la provincia contra esa lista específica.

**Caso de borde diseñado, no pedido explícitamente pero necesario:**
Provincia con valor pero SIN Departamento en la misma fila se **rechaza**
— no hay forma de validar pertenencia sin saber a qué departamento
debería pertenecer. Si el Departamento está presente pero es inválido
(no está en el catálogo), ese error ya cubre la fila — no se duplica un
segundo mensaje de Provincia sobre un Departamento que ya se sabe que
está mal.

**Misma decisión de arquitectura que Departamento (sección 6.1.f, sin
cambios):** el chequeo vive en `padronCsv.js`, no en `socioSchema` —
`UbigeoSelect.jsx` (formulario manual) sigue ofreciendo "Otro / no está
en la lista" tanto para Departamento como para Provincia, y ese escape
hatch no debe romperse.

**Ejemplo real usado para los tests** (`lib/ubigeoData.js`, catálogo
real): Cajamarca → `Cutervo`/`Jaén` (provincias reales observadas en la
muestra de `Plantilla_Socios_prueba.csv`, sección 0); `Cañete` (provincia
real, pero de Lima) usada como caso "existe en el catálogo pero no
pertenece a ese departamento".

### 7.3 Contrato de datos

Sin cambios de forma en `validateSocioRows`/`validateParcelaRows` (sigue
`{ rows, unrecognizedColumns }` para Socios) — ambos cambios de esta
ronda son reglas de validación nuevas/corregidas dentro del mismo
pipeline existente, no un campo nuevo en el retorno.

### 7.4 Archivos tocados

- `lib/validations/socios.js` — `fechaNacimiento`/`FECHA_NACIMIENTO_REGEX`
  reescritos (mes primero, sin fallback ambiguo).
- `lib/padronCsv.js` — `applyDepartamentoCatalogCheck` renombrada a
  `applyUbigeoCatalogChecks` y extendida con la validación de Provincia;
  `DEPARTAMENTOS_NORMALIZADOS` (Set) reemplazado por
  `DEPARTAMENTOS_CANONICOS_POR_NORMALIZADO` (Map normalizado → nombre
  canónico, necesario para poder llamar `getProvincias()`); import de
  `getProvincias` agregado; `SOCIO_TEMPLATE_EXAMPLE.socio_fecha_nacimiento`
  actualizado a `'5/14/1980'`.
- `tests/test_padron_csv.mjs` — 2 tests de fecha reescritos (el que
  aceptaba D/M ahora prueba que se rechaza), 2 tests nuevos de fecha
  (ambigüedad determinística, "13/4/1990" solo válida como D/M rechazada),
  6 tests nuevos de Provincia.
- `tests/test_socios_schema.mjs` — 1 test de fecha reescrito, 1 test
  nuevo (rechaza orden D/M).

### 7.5 Riesgos / notas

| Riesgo | Detalle |
|---|---|
| **Filas reales que dependían del fallback D/M ahora se rechazan** | Sin evidencia de que existan en el dataset real de COOP-AROMAS-VALLE (todas las fechas muestreadas son M/D consistentes) — pero si aparece alguna al reimportar, hay que corregirla a mano en el Excel, no es un bug. |
| **Provincia más estricta que el formulario manual** | Misma asimetría ya aceptada para Departamento en la ronda 3 (sección 6.1.f) — el importador masivo es más estricto a propósito; el formulario manual sigue teniendo la opción "Otro" sin cambios. |
| **Reimportar un CSV con Provincia pero sin Departamento (columna eliminada a mano, por ejemplo)** | Ahora se rechaza esa fila explícitamente, con un mensaje que indica el motivo — antes de esta ronda, Provincia no se validaba en absoluto, así que este es un caso nuevo de rechazo, no una regresión de algo que antes funcionaba. |

---

## 8. Ronda 5 (2026-09-01) — validación de Distrito (tercer nivel de ubigeo)

### 8.0 Investigación (antes de implementar)

Pedido explícito de investigar 2 cosas antes de tocar código:

**a. ¿`Distrito` ya existe como campo, sin validar?** Sí, en los 3
lugares donde correspondía revisar:
- `PADRON_SOCIOS.socio_distrito` — columna real confirmada
  (`docs/schema_live.md:153`).
- `socioSchema.socio_distrito: str` (`lib/validations/socios.js:100`) —
  texto libre, sin ninguna validación de formato/catálogo, exactamente el
  mismo estado en que estaba `socio_provincia` antes de la ronda 4.
- Columna reconocida del CSV desde siempre: `SOCIO_EXPORT_COLUMNS`
  (`lib/padronCsv.js:35`) y `SOCIO_FIELD_LABELS.socio_distrito =
  'Distrito'` (`lib/padronCsv.js:78`).

**b. ¿El catálogo ya tiene datos de Distrito?** Sí, completos:
`lib/ubigeoData.js:19-25` ya exponía `getDistritos(departamentoNombre,
provinciaNombre)`, resolviendo sobre `lib/data/ubigeo_peru.json` — 25
departamentos / 196 provincias / **1869 distritos**. No se creó ningún
archivo ni dataset nuevo.

**Salvedad documentada explícitamente (no bloqueante, pero real):** a
diferencia de Departamento/Provincia ("alta confianza" según el propio
`_meta` del JSON), el dato de Distrito tiene confianza MENOR — el
`_meta` dice textual: *"La lista de distritos es un esfuerzo de buena fe
pero puede tener omisiones o algún nombre desactualizado, sobre todo en
provincias con muchos distritos pequeños/rurales"*. `docs/schema_live.md:234-238`
documenta que este riesgo ya fue aceptado explícitamente con el usuario
en una ronda anterior del proyecto (no algo nuevo de esta tarea). Se
documenta acá para que quede claro: si empiezan a aparecer rechazos
falsos de Distrito en producción, la causa más probable es una omisión
real del dataset (no un bug del validador) — candidato a contrastar
contra el Ubigeo oficial del INEI si se vuelve un problema recurrente
(misma recomendación que ya trae el propio `_meta`).

**Conclusión:** escenario simple (extender validación existente, no
agregar campo ni dataset nuevo) — se procedió a implementar en la misma
tarea, tal como preveía el pedido para este caso.

### 8.1 Diseño

Extiende `applyUbigeoCatalogChecks` (`lib/padronCsv.js`, ya existente
desde la ronda 4) con un tercer nivel en cascada: `socio_distrito` (si no
está vacío) debe pertenecer a la `socio_provincia` declarada **en la
misma fila** — mismo criterio exacto que Provincia→Departamento:

- Resuelve `provinciaCanonica` (ya lo hacía la ronda 4 solo para validar
  membresía; ahora además se **retiene** el nombre canónico, porque
  `getDistritos(departamentoCanonico, provinciaCanonica)` necesita el
  nombre EXACTO del catálogo, no uno normalizado).
- Distrito con valor pero sin Provincia válida en la misma fila →
  rechazo, con mensaje propio SOLO si la Provincia estaba vacía (si ya
  estaba inválida o sin Departamento, ese error de arriba alcanza — no
  se duplica, mismo patrón que Provincia sin Departamento).
- Comparación normalizada (NFD + strip de diacríticos, minúsculas) igual
  que los otros 2 niveles.

### 8.2 Contrato de datos

Sin cambios de forma — misma firma que las rondas 3-4
(`{ rows, unrecognizedColumns }` para Socios). Distrito es una regla de
validación más dentro del mismo `applyUbigeoCatalogChecks`.

### 8.3 Archivos tocados

- `lib/padronCsv.js` — `applyUbigeoCatalogChecks` extendida con el nivel
  Distrito; import de `getDistritos` agregado.
- `tests/test_padron_csv.mjs` — 7 tests nuevos (válido, existe pero en
  otra provincia, inexistente, tolerancia mayúsculas/tildes, sin
  Provincia en la fila, sin Departamento ni Provincia -- no duplica
  error, vacío sigue siendo válido).

### 8.4 Riesgos

| Riesgo | Detalle |
|---|---|
| **Falsos rechazos por dataset de Distrito incompleto** | Riesgo real y mayor que en Departamento/Provincia (ver 8.0.b) — el propio `_meta` del JSON lo advierte. Si aparece en producción, no es un bug del validador, es una omisión del dataset — corregible agregando el distrito faltante a `lib/data/ubigeo_peru.json` o contrastando contra el INEI. |
| **Distrito más estricto que el formulario manual** | Misma asimetría ya aceptada para Departamento/Provincia (secciones 6.1.f/7.2) — `UbigeoSelect.jsx` sigue teniendo "Otro" en los 3 niveles, sin cambios. |

---

## 9. Ronda 6 (2026-09-01) — tolerancia Sí/No, confirmación de tildes, alias hip/hrp, mensajes legibles, error de fórmula de Excel

5 hallazgos, todos con evidencia real ya confirmada por el usuario antes de esta ronda (no requirió investigación nueva de archivo).

### 9.1 Flags de certificación — tolerancia Sí/No sin tilde

**Evidencia real (dada, no investigada de nuevo):** el archivo real del
usuario usa `"Si"` (sin tilde) y `"No"`, con la columna Rainforest
Alliance usando `"SI"` en mayúsculas — `"Sí"` con tilde nunca aparece en
los datos reales.

**Verificación previa a implementar (pedido explícito del prompt, "verifica
cuál es ese valor canónico real... antes de asumir 'Sí' con tilde"):**
`lib/actions/sociosActions.js:322` — `syncSocioCertificaciones` decide
qué certificaciones sincronizar con
`CERT_FLAG_FIELDS.filter(({ field }) => parsed[field] === 'Sí')`,
comparación **literal con tilde**. Confirmado: el canónico real que el
resto del sistema ya espera es `'Sí'` **con** tilde, no `'Si'` sin tilde
como sugería el prompt como posibilidad. Esto determinó la dirección de
la normalización.

**Fix:** `normalizeSiNo(value)` (`lib/padronCsv.js`) — reusa
`normalizeForCatalogMatch` (NFD + strip de diacríticos + minúsculas, ya
existente para ubigeo) para mapear cualquier variante
(`Si`/`si`/`SI`/`Sí`/`sí`) al canónico `'Sí'`, y (`No`/`no`/`NO`) a
`'No'`. Corre en `validateSocioRows`, sobre las 8 columnas de
`CERT_FLAG_FIELDS`, **antes** de `socioSchema.safeParse` — mismo patrón
exacto que `normalizeDecimalComma` para hectáreas (ronda "delimitador
flexible"). Un valor que no matchea ninguna variante reconocible se deja
pasar tal cual y lo rechaza el `siNo` de Zod (ver 9.4) con un mensaje
legible.

**Cambio de implementación en `socioSchema`:** `siNo` pasó de
`z.enum(['Sí', 'No'])` a `.refine()` (`lib/validations/socios.js`) — Zod
no ofrece una forma simple de fijar un mensaje propio para "valor fuera
del enum" sin pelear con su `errorMap`; `.refine()` es el mismo idioma
que ya usa el archivo para `fechaNacimiento`/la suma de hectáreas. Sin
cambio de comportamiento para valores ya canónicos.

**`sociosActions.js` no se tocó** — confirmado innecesario: normalizando
antes de Zod, el payload que llega a `createSocio`/`syncSocioCertificaciones`
ya tiene el valor canónico de siempre.

### 9.2 Validación de ubigeo — confirmado que la tolerancia a tildes YA funcionaba

Investigado antes de tocar código: `normalizeForCatalogMatch`
(`lib/padronCsv.js`, desde la ronda 3) ya aplica `.normalize('NFD')` +
strip de diacríticos + minúsculas a **ambos lados** de la comparación
(valor del archivo Y valor del catálogo) desde que se implementó
Departamento. El catálogo real (`lib/data/ubigeo_peru.json`) SÍ tiene
tildes (`"Jaén"`, `"San José de Lourdes"`, confirmado con `getDistritos()`
en vivo) — igual que el archivo real del usuario. **No se necesitó
ningún cambio de código** — se agregaron tests con los valores reales
exactos (`"Jaén"`, `"San José de Lourdes"`, y sus versiones sin tilde)
para dejar la confirmación documentada y blindada contra una regresión
futura, en vez de solo afirmarlo sin evidencia ejecutable.

### 9.3 Alias del label viejo de hip/hrp

Defensivo, pedido explícito por si queda algún archivo exportado con el
label de ANTES de la corrección semántica de la ronda 3
(`"Ha. Infraestructura Productiva"`/`"Ha. Reserva/Protección"`).
`PARCELA_REVERSE_LABELS` (Map construido desde `PARCELA_FIELD_LABELS`,
que solo tiene el label nuevo) recibe 2 entradas extra vía `.set()`
después de construirse — el label viejo sigue resolviendo a `hip`/`hrp`,
sin tocar `PARCELA_FIELD_LABELS` (que sigue siendo la única fuente de
verdad para lo que se EXPORTA — el alias es solo de reconocimiento en
import, nunca aparece en un CSV nuevo generado por el sistema).

### 9.4 Mensajes de error legibles (Socios y Parcelas)

**Antes:** `${i.path.join('.')}: ${i.message}` — ej. `"socio_dni: DNI
debe tener 8 dígitos"`, `"hcp: El total de hectáreas debe ser mayor a
0.00 ha."`.

**Después:** `formatZodIssues(issues, labels)` (`lib/padronCsv.js`)
traduce `i.path[0]` (la clave técnica) a su label humano vía
`SOCIO_ERROR_LABELS` (= `SOCIO_FIELD_LABELS` + las 8 de
`CERT_FLAG_FIELDS`, que no viven en `SOCIO_FIELD_LABELS` por ser
columnas dinámicas del CSV) o `PARCELA_FIELD_LABELS` según corresponda.
Los mensajes de Zod en sí también se reescribieron en
`lib/validations/socios.js` para ser legibles de por sí:

| Caso | Mensaje antes | Mensaje ahora |
|---|---|---|
| Campo requerido vacío (`ID_Socio`, `socio_nombre_completo`, `socio_dni`, `ID_Parcela_Fija`) | `Requerido` | `Este campo es obligatorio` |
| DNI inválido | `DNI debe tener 8 dígitos` | `El DNI debe tener 8 dígitos` |
| Celular inválido | `Celular debe tener 9 dígitos` | `El celular debe tener 9 dígitos` |
| Fecha inválida | `Formato de fecha inválido (usar M/D/AAAA, mes primero, ej. 4/29/1986)` | `La fecha debe tener el formato M/D/AAAA (ej: 4/29/1986)` |
| Flag de certificación inválido | *(mensaje de enum de Zod, técnico)* | `Debe ser Sí o No` |
| Ubigeo fuera de catálogo (Departamento) | `El Departamento "X" no es un departamento válido de Perú.` | `"X" no se reconoce como Departamento válido de Perú.` |
| Hectáreas en 0 | `hcp: El total de hectáreas debe ser mayor a 0.00 ha.` | `Ha. En Producción: El total de hectáreas debe ser mayor a 0.00 ha.` (mensaje sin cambios, solo el prefijo) |

**Excepción deliberada, documentada en el propio código:**
`parcelaSchema.ID_Socio` (el socio dueño de la parcela) conserva su
mensaje contextual `"Selecciona un socio"` en vez de unificarse a
"Este campo es obligatorio" — es específico del formulario manual (hay
un dropdown real que seleccionar ahí), y en el importador CSV este campo
casi nunca aparece vacío sin más contexto (rompe la relación
Parcela→Socio) — cuando sí aparece un problema de socio, ya hay un
mensaje más específico aparte (`applyParcelaDbChecks`/9.5). No es una
inconsistencia accidental, es una decisión de diseño explícita.

**Mensajes de Provincia/Distrito "no pertenece a X" (rondas 4-5) NO se
reescribieron** al patrón genérico "no se reconoce como... válido de
Perú" — se mantuvieron tal cual porque ya son más informativos (indican
a qué departamento/provincia SÍ debería pertenecer), y el pedido daba
esos mensajes como ejemplos de patrón, no como texto literal obligatorio
para cada caso.

### 9.5 Distinción de error de fórmula de Excel en "socio no encontrado"

**Evidencia real (ronda 3):** 1 de 616 `ID_Socio` referenciados por las
825 parcelas de la primera carga real era literalmente `"#N/D"` — un
error de fórmula de Excel (VLOOKUP roto) filtrado a la celda, no un
código de socio real mal tipeado.

**Fix:** `isExcelFormulaError(value)` (`lib/padronCsv.js`) — Set de
valores literales que Excel/Sheets escriben cuando una fórmula falla
(`#N/D`, `#N/A`, `#REF!`, `#VALUE!`, `#DIV/0!`, `#NULL!`, `#NOMBRE?`,
`#NUM!` — ninguno podría ser jamás un `ID_Socio` real). Aplicado tanto
al mensaje **por fila** (`applyParcelaDbChecks`) como al **resumen
agrupado** (`missingSocioWarnings`, ronda 3) — antes solo el resumen
agrupado existía, el mensaje por fila seguía siendo el genérico
"no existe en la organización activa" incluso para `"#N/D"`.

```
Antes:  El Código de Socio "#N/D" no existe en la organización activa (fila(s) 3, 4).
Ahora:  Valor de socio inválido: "#N/D" — revisá esta celda en tu Excel de
        origen (parece un error de fórmula, no un código real) (fila(s) 3, 4).
```

Un `ID_Socio` faltante REAL (no un error de fórmula) sigue con el
mensaje genérico de siempre, sin cambios.

### 9.6 Contrato de datos

Sin cambios de forma en ninguna función — todos los cambios de esta ronda
son de contenido de mensajes (texto de error) o de tolerancia de
parseo/normalización, no de la estructura `{ rows, unrecognizedColumns,
hectareWarnings, missingSocioWarnings }`.

### 9.7 Archivos tocados

- `lib/validations/socios.js` — `siNo` reescrito como `.refine()`;
  mensajes de `dni`/`dniRequerido`/`celular`/`fechaNacimiento`/`ID_Socio`/
  `socio_nombre_completo`/`ID_Parcela_Fija` (parcela) reescritos a texto
  legible.
- `lib/padronCsv.js` — `normalizeSiNo` (nueva) + aplicada en
  `validateSocioRows`; `PARCELA_REVERSE_LABELS` extendido con los 2 alias
  viejos de hip/hrp; `SOCIO_ERROR_LABELS` + `formatZodIssues` (nuevas),
  reemplazan el `${path}: ${message}` crudo en `validateSocioRows`/
  `validateParcelaRows`; `isExcelFormulaError` (nueva) + aplicada en
  `applyParcelaDbChecks` (mensaje por fila) y `validateParcelaRows`
  (mensaje agrupado); mensaje de Departamento fuera de catálogo
  reescrito.
- `components/features/socios/ImportPadronModal.jsx` — **sin cambios**:
  los mensajes ya legibles fluyen automáticamente por el mismo
  `r.errors.join('; ')` que ya existía, no hizo falta tocar la UI.
- `lib/ubigeoData.js` — **sin cambios**: confirmado en 9.2 que la
  tolerancia a tildes ya funcionaba correctamente.
- `tests/test_padron_csv.mjs` — ~25 tests nuevos cubriendo los 5 puntos,
  con valores reales exactos (`"Si"`, `"SI"`, `"Jaén"`, `"San José de
  Lourdes"`, `"#N/D"`) donde aplica.

### 9.8 Riesgos

| Riesgo | Detalle |
|---|---|
| **Reimportar un CSV con `cert_org_estatus`/certificaciones ya en "Sí" con tilde** | Sin impacto — `normalizeSiNo` no toca un valor que ya es canónico (`stripped === 'si'` matchea tanto `"Si"` como `"Sí"`, ambos se normalizan al mismo `'Sí'`). |
| **Un archivo con "Verdadero"/"Falso"/"1"/"0" en vez de Sí/No** | Fuera de alcance a propósito — no hay evidencia real de esas variantes; `normalizeSiNo` las deja pasar tal cual y el `.refine()` las rechaza con "Debe ser Sí o No", consistente con el resto del diseño (no adivinar más allá de la evidencia real confirmada). |
| **Mensajes legibles cambiaron texto exacto que algún test/integración externa pudiera estar comparando** | Ningún consumidor fuera de este módulo compara el texto exacto de estos mensajes (confirmado: solo se muestran en `ImportPadronModal.jsx` vía `.join('; ')`, nunca se parsean de vuelta). |

---

## 10. Ronda 7 (2026-09-01) — corrección del label exacto de `hip` + resumen agrupado de errores

### 10.1 Fix urgente: label exacto de `hip` — "Ha. Inverna/Pasto", no "Ha. Invernadero/Pasto"

**Corrección de una corrección:** la ronda 3 (2026-08-31) había cambiado
el label de `hip` de `"Ha. Infraestructura Productiva"` a `"Ha.
Invernadero/Pasto"` (palabra completa) por pedido explícito del usuario.
El usuario indicó en esta ronda que ese texto seguía sin ser exacto — el
real, con evidencia directa de su archivo, es `"Ha. Inverna/Pasto"`
(abreviado).

**Corroboración encontrada en el propio repo, no pedida:** `lib/gisLandUseStyles.js:18`
(módulo de estilos de uso de suelo del mapa GIS — `EUDR_USO_SUELO`,
completamente independiente del Padrón/CSV) **ya usaba** `'Inverna/Pasto'`
como label de categoría (`{ key: 'inverna pasto', label: 'Inverna/Pasto',
... }`), igual que `'Rastrojo/Purma'` en la línea siguiente. Este módulo
no se tocó nunca en las rondas anteriores del importador — es evidencia
independiente, ya existente en el código antes de esta tarea, que
corrobora que `"Inverna/Pasto"` es la terminología real del sistema, no
un texto inventado para esta corrección puntual.

**Fix:** `HECTARE_FIELDS` (`lib/validations/socios.js`) — label de `hip`
cambiado a `'Ha. Inverna/Pasto'` (única fuente de verdad, propaga
automáticamente a `PARCELA_FIELD_LABELS`/CSV export/`ParcelaFormModal.jsx`,
mismo mecanismo de siempre). `hrp` (`"Ha. Rastrojo/Purma"`) **no se
tocó** — no fue parte de este pedido, y no hay evidencia de que esté mal.

**Alias extendidos** (`PARCELA_REVERSE_LABELS`, `lib/padronCsv.js`): hip
ahora reconoce **3** encabezados como equivalentes al mismo campo
técnico:

| Encabezado reconocido | Origen |
|---|---|
| `"Ha. Inverna/Pasto"` | Canónico actual (ronda 7) — el que se exporta/muestra |
| `"Ha. Invernadero/Pasto"` | Alias — corrección de la ronda 3, resultó tener el texto exacto mal |
| `"Ha. Infraestructura Productiva"` | Alias — label original, antes de la ronda 3 |

Los 3 mapean a `hip`. `hrp` sigue con su único alias de la ronda 6
(`"Ha. Reserva/Protección"`).

### 10.2 Resumen agrupado de errores en el preview

**Problema:** con un archivo real de cientos de filas, el usuario tenía
que desplazarse fila por fila en la tabla del preview para entender qué
tipos de error tenía el archivo — sin una vista agregada, un patrón como
"28 filas con la misma Provincia mal declarada" no era visible de un
vistazo.

**Fix:** `groupValidationErrors(results, codeKey)` (`lib/padronCsv.js`,
exportada, función pura) — agrupa las filas inválidas de `results` (el
array `rows` que ya devuelven `validateSocioRows`/`validateParcelaRows`)
por el **texto exacto** de cada mensaje de error. Mismo mensaje = mismo
grupo, sin importar la fila. `codeKey` (`'ID_Socio'` o
`'ID_Parcela_Fija'` según la entidad) determina qué campo de cada fila
usar como "código" visible en la lista de afectados; si ese campo está
vacío (puede pasar justo cuando ESE es el error), cae a `"fila N"`.

**Una fila con más de un error aparece en cada grupo correspondiente**
(pedido explícito) — `groupValidationErrors` itera `r.errors` completo
por fila, no solo el primero, así que una fila con 2 errores distintos
contribuye a 2 grupos distintos, cada uno con su propio conteo.

**Orden:** grupos de mayor a menor cantidad de filas afectadas — decisión
de diseño (el problema más extendido primero), no pedida literal pero
razonable para el propósito de triage.

**UI (`ImportPadronModal.jsx`):** un bloque nuevo arriba de la tabla,
siempre visible cuando hay errores, mostrando por grupo: el mensaje
completo, la cantidad de filas, y hasta 10 códigos (`MAX_CODES_PREVIEW`)
seguidos de `"+N más"` si hay más. La tabla fila-por-fila que ya existía
**no se eliminó** — quedó detrás de un toggle (`"Ver todas las filas
(N)"` / `"Ocultar el detalle fila por fila"`), colapsada por defecto:
el resumen es el triage rápido, la tabla sigue disponible para el
detalle bajo demanda (una de las 2 opciones que daba el pedido —
"debajo del resumen" o "detrás de un toggle" — se implementó el toggle,
porque con cientos de filas mantener la tabla siempre visible además del
resumen sería demasiado scroll).

**Ejemplo real verificado con un test** (`"Utcubamba"` es una provincia
real, pero de Amazonas, no de Cajamarca — confirmado contra
`lib/ubigeoData.js` antes de escribir el test): 28 filas con
`socio_provincia: 'Utcubamba'` y `socio_departamento: 'Cajamarca'`
quedan agrupadas en un solo mensaje con `count: 28` y los 28 códigos de
socio en `codes`.

### 10.3 Contrato de datos

`groupValidationErrors` es una función nueva, no modifica el retorno de
`validateSocioRows`/`validateParcelaRows` — el modal la llama aparte,
sobre el array `rows` ya obtenido.

```
groupValidationErrors(results: Array<{valid, index, normalized, errors}>, codeKey: string)
  -> Array<{ message: string, count: number, codes: string[] }>
```

### 10.4 Archivos tocados

- `lib/validations/socios.js` — label de `hip` en `HECTARE_FIELDS`
  corregido a `'Ha. Inverna/Pasto'`.
- `lib/padronCsv.js` — `PARCELA_REVERSE_LABELS` con el alias nuevo
  (`'ha. invernadero/pasto'` -> `hip`); `groupValidationErrors` (nueva,
  exportada).
- `components/features/socios/ImportPadronModal.jsx` — import de
  `groupValidationErrors`, estado `showAllRows` (toggle), bloque de
  resumen agrupado arriba de la tabla, tabla existente detrás del toggle.
- `tests/test_padron_csv.mjs` — tests de label/alias actualizados al
  nuevo canónico (`"Ha. Inverna/Pasto"`) + alias viejo (`"Ha.
  Invernadero/Pasto"`) confirmado como alias, no canónico; 6 tests
  nuevos de `groupValidationErrors` (agrupación básica, fila con
  múltiples errores en múltiples grupos, filas válidas no aportan,
  fallback a `"fila N"`, orden por cantidad, escenario real de 28 filas).

### 10.5 Riesgos

| Riesgo | Detalle |
|---|---|
| **Reimportar un CSV exportado durante la ventana de la ronda 3-6 (con el label "Ha. Invernadero/Pasto")** | Sin impacto — ahora es un alias reconocido explícitamente, no cae en `unrecognizedColumns`. |
| **Un tercer cambio de texto futuro para hip/hrp** | El patrón de alias ya está establecido (`PARCELA_REVERSE_LABELS.set(...)` después de construir el mapa) — extenderlo a un futuro label nuevo es una línea, no un rediseño. |
| **El resumen agrupado no reemplaza los chequeos de calidad ya existentes** | Es puramente una vista de agregación sobre errores que YA se calculaban fila por fila (rondas 1-6) — no cambia qué se considera válido/inválido, solo cómo se presenta. |
