# Spec — Soporte de CSV delimitado por punto y coma en el importador de Padrón Masivo

- **Estado:** Implementado (2026-08-31).
- **Fecha:** 2026-08-31
- **Contexto previo:** `specs/mejoras_importador_padron_masivo.md` (ronda
  1 y 2, commits `bee73e5`/`7298844`, ya pusheados a `staging`) — este
  spec no reabre ninguna de esas 3 mejoras, es un cambio nuevo e
  independiente sobre la misma capa de parseo (`lib/padronCsv.js`).
- **Alcance:** `lib/padronCsv.js` únicamente. `lib/validations/socios.js`
  y `ImportPadronModal.jsx` **no se tocan** — se verificó que no hace
  falta (secciones 0 y 3).

## 0. Corrección de premisas del pedido (verificado contra el repo real)

- **Línea de `parseCsv` desactualizada.** El pedido cita
  `lib/padronCsv.js:263-316` — esa era la ubicación **antes** de la ronda
  2 (`7298844`), que agregó ~240 líneas nuevas delante de esa función
  (`fetchSocioCertOrgEstatus`, las funciones de columna
  dispareja/no-reconocida, etc.). Confirmado con `grep`: `parseCsv` vive
  hoy en `lib/padronCsv.js:349-402`. No afecta el diseño, solo la cita.
- **Contrato de datos del pedido es incorrecto — corregido, no adoptado
  tal cual.** El pedido describe la firma actual como
  `parseCsv(fileContent: string): { headers: string[], rows:
  Record<string,string>[] }`. Eso **no es lo que hace hoy la función**:
  `parseCsv(text)` devuelve directamente `Array<Object>` (una fila = un
  objeto `{columna: valor}`, sin un array de `headers` separado ni una
  envoltura `{headers, rows}` — confirmado leyendo el código,
  `padronCsv.js:394-401`) y así lo consumen los ~15 sitios que la llaman
  hoy (`validateSocioRows`, `validateParcelaRows`, `tests/test_padron_csv.mjs`).
  Esta spec **mantiene la firma real** (`Array<Object>`) — cambiarla a
  `{headers, rows}` sería un breaking change no pedido ni necesario para
  el objetivo (soportar `;` como delimitador), y rompería todos los
  callers existentes sin ningún beneficio. Se documenta la corrección
  acá para que quede explícito que no se adoptó el contrato tal como
  venía escrito en el pedido.
- **El BOM UTF-8 YA se strippea hoy** (`padronCsv.js:355`, `const clean =
  text.replace(/^﻿/, '')`, con un test ya pasando: "parseCsv ignora un
  BOM UTF-8 al inicio"). El pedido lo describe como algo a agregar; en
  realidad ya existe desde antes de esta tarea — lo único nuevo acá es
  confirmar que sigue funcionando correctamente una vez que el parseo
  también sniffea el delimitador (el sniffing debe correr sobre el texto
  YA sin BOM, no antes — ver sección 1.1) y agregar un test explícito con
  `;` para cerrar la combinación BOM+delimitador no cubierta hasta ahora.
- **Campos numéricos que necesitan tolerancia de coma decimal: confirmado
  que son SOLO las 7 de hectárea, ninguno en `socioSchema`.**
  `lib/validations/socios.js` define dos helpers de coerción numérica:
  `num` (línea 9, `z.coerce.number().optional().nullable()`) y
  `nonNegativeNum` (línea 13, con `.min(0, ...)` agregado). Un `grep` de
  `\bnum\b` en todo el archivo (`lib/validations/socios.js`) confirma que
  **`num` está definido pero nunca usado como tipo de ningún campo** —
  código muerto preexistente, no tocado en esta tarea (fuera de alcance,
  no fue pedido limpiarlo). `nonNegativeNum` es el único coercionador
  numérico realmente usado, y solo en las 7 columnas de `HECTARE_FIELD_KEYS`
  de `parcelaSchema` (`hcp`/`hcc`/`ho`/`hip`/`hrp`/`hbp`/`otros_cultivo`,
  líneas 157-163). `socioSchema` no tiene ningún campo numérico — todos
  sus campos son `string`/`enum` (confirmado en la tarea anterior de esta
  misma sesión). Conclusión: la tolerancia de coma decimal solo necesita
  aplicarse en el camino de importación de Parcelas.

## 1. Diseño

### 1.1 Detección de delimitador (una vez por archivo, nunca fila por fila)

`parseCsv` sniffea la **primera línea** del texto (ya sin BOM) contando
`,` y `;` **fuera de comillas** (mismo criterio que ya usa el tokenizador
principal para no confundir un delimitador real con uno embebido en un
valor entre comillas). Si hay más `;` que `,` en esa línea, el archivo
completo se parsea con `;`; en cualquier otro caso (incluido un empate o
0 de cada uno) se usa `,` — **comportamiento idéntico al actual** para
todo archivo separado por comas, incluidos los que no traen ningún `;` en
absoluto.

```js
function detectDelimiter(text) {
  let inQuotes = false
  let commaCount = 0
  let semicolonCount = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') { inQuotes = !inQuotes; continue }
    if (inQuotes) continue
    if (char === '\n' || char === '\r') break // fin de la primera línea
    if (char === ',') commaCount++
    else if (char === ';') semicolonCount++
  }
  return semicolonCount > commaCount ? ';' : ','
}
```

El delimitador se detecta **una sola vez, sobre la cabecera**, y se usa
para tokenizar el archivo entero — nunca se vuelve a sniffear fila por
fila (evita el escenario "cada fila decide su propio delimitador", que
sería mucho más difícil de razonar y de dar un error claro).

El tokenizador principal (el `for` que ya existe, comillas/escapes sin
cambios) reemplaza el `char === ','` fijo por `char === delimiter`
(la variable resuelta por `detectDelimiter`) — es el único cambio real al
bucle existente.

### 1.2 BOM UTF-8 (ya existía, se preserva el orden correcto)

`clean = text.replace(/^﻿/, '')` sigue corriendo **antes** de
`detectDelimiter(clean)` — el sniffing nunca ve el BOM. Sin cambios de
comportamiento respecto a hoy, solo se agrega un test que cubre BOM + `;`
combinados (no cubierto hasta ahora, ver sección 4).

### 1.3 Delimitador inconsistente entre filas → error explícito, no adivinar

Una vez elegido el delimitador único de la cabecera, se tokeniza todo el
archivo con ese delimitador. Si alguna fila de datos resulta con un
**número de columnas distinto al de la cabecera**, es la señal de un
archivo malformado (mezcla real de `,`/`;` entre filas, o cualquier otro
problema de formato) — se **rechaza el archivo completo** con un mensaje
que identifica la cabecera y cada fila en conflicto, mismo criterio de
"nunca fila por fila en silencio" que ya usa el resto del módulo
(`findUnevenColumns`/`findUnrecognizedSocioColumns` de la ronda anterior).

```js
const mismatched = []
nonEmptyRows.slice(1).forEach((cells, i) => {
  if (cells.length !== header.length) mismatched.push({ line: i + 2, count: cells.length })
})
if (mismatched.length > 0) {
  throw new Error(
    `El archivo tiene un número de columnas inconsistente entre filas (posible delimitador mezclado ',' / ';'): ` +
    `el encabezado tiene ${header.length} columna(s), pero ` +
    mismatched.map((m) => `la fila ${m.line} tiene ${m.count}`).join(', ') +
    `. Revisá que todo el archivo use el mismo separador.`
  )
}
```

Numeración de fila: `i + 2` (fila 1 = encabezado), mismo criterio que ya
usan `applyDuplicateChecks`/`findUnevenColumns` en el resto del archivo —
consistente en todo el módulo, no una convención nueva.

**Este chequeo corre dentro de `parseCsv`, antes de que existan objetos
por fila** — es una capa más temprana y más baja en el pipeline que los
chequeos de "columna no reconocida"/"columna dispareja" de la ronda
anterior (que operan sobre los objetos ya parseados, dentro de
`validateSocioRows`/`validateParcelaRows`). No hay solapamiento ni orden
ambiguo entre ambos: si `parseCsv` lanza, el pipeline nunca llega a
`validateSocioRows`/`validateParcelaRows`. `ImportPadronModal.jsx` no
necesita ningún cambio — el `try/catch` que ya envuelve la llamada a
`parseCsv(text)` (`handleFileChange`, `ImportPadronModal.jsx`) ya
captura y muestra cualquier `Error` que lance, incluido este nuevo caso.

### 1.4 Separador decimal en las 7 columnas de hectárea

Normalización pura, texto → texto, ANTES de que el valor llegue a
`parcelaSchema.safeParse` (no se toca `nonNegativeNum` ni ningún otro
tipo de `lib/validations/socios.js` — decisión explícita, ver sección 2):
si el valor es un string con **exactamente una coma y ningún punto**, se
reemplaza la coma por un punto. Cualquier otro caso (ya tiene punto, no
tiene coma, tiene ambos — ej. `"1.234,56"` con agrupación de miles, o
tiene más de una coma) se deja tal cual, sin adivinar — si termina
resultando en `NaN` para `Number(...)`, el error de Zod existente
("Expected number...") ya lo comunica, no hace falta un mensaje nuevo
para ese caso ambiguo (fuera de alcance: los valores reales de hectárea
son montos chicos, sin agrupación de miles, ver `docs/schema_live.md`).

```js
function normalizeDecimalComma(value) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === '') return trimmed
  const hasSingleComma = (trimmed.match(/,/g) || []).length === 1
  if (hasSingleComma && !trimmed.includes('.')) {
    return trimmed.replace(',', '.')
  }
  return trimmed
}
```

Se aplica en `validateParcelaRows`, en el mismo lugar donde ya corre la
conversión `'' -> null` de `HECTARE_FIELD_KEYS`:

```js
for (const key of HECTARE_FIELD_KEYS) {
  const value = normalizeDecimalComma(normalized[key])
  normalized[key] = value === '' ? null : value
}
```

Independiente del delimitador detectado del archivo (`,` o `;`) — un
archivo separado por `;` con hectáreas en `"1,5"` es exactamente el caso
real que motiva esta tarea (configuración regional de Perú/Excel), pero
la normalización de coma decimal corre siempre, incluso en un archivo
separado por `,` (un usuario podría pegar `"1,5"` a mano en un CSV que
por lo demás usa comas como separador de columnas, sin que eso choque:
el separador de columnas ya fue consumido por el tokenizador antes de
que `normalizeDecimalComma` vea el valor de la celda).

## 2. Dónde vive la normalización — decisión (pedido explícito de revisar)

**100% en `lib/padronCsv.js`, nada en `lib/validations/socios.js`.**
Motivo: `nonNegativeNum`/`parcelaSchema` son compartidos por el formulario
manual (`ParcelaFormModal.jsx`, vía `react-hook-form`) además del
importador CSV — ese formulario nunca produce un string con coma decimal
(input numérico HTML, o un `<input type="text">` con formato ya
controlado por el propio componente, no un archivo de Excel con
configuración regional). Tocar `nonNegativeNum` para tolerar comas
habría cambiado el comportamiento del formulario manual también, sin
necesidad — la tolerancia de coma decimal es un problema específico de
"un archivo CSV externo, posiblemente exportado por Excel en configuración
regional de Perú", no del schema Zod en general. Mantener la normalización
en la capa de importación (`padronCsv.js`) es más quirúrgico y no arriesga
ningún comportamiento fuera del importador masivo.

## 3. Contrato de datos

- `parseCsv(text: string): Array<Record<string, string>>` — **sin
  cambios de firma respecto a la real actual** (ver corrección de premisa,
  sección 0). Comportamiento nuevo: detecta `,`/`;` automáticamente: y
  **puede lanzar** (`throw new Error(...)`) si el archivo tiene un número
  de columnas inconsistente entre filas — antes nunca lanzaba por este
  motivo (ver riesgos, sección 5).
- `validateParcelaRows` — sin cambios de firma (sigue devolviendo
  `{ rows, unrecognizedColumns }`, contrato de la ronda anterior). Cambia
  únicamente el valor que `normalized.hcp`/etc. tienen antes de llegar a
  Zod (coma reemplazada por punto cuando aplica).
- `validateSocioRows` — **sin cambios de ningún tipo** (confirmado en la
  sección 0: no tiene campos numéricos).

## 4. Plan de tests (`tests/test_padron_csv.mjs`)

Los 5 casos pedidos explícitamente, más 2 adicionales para cerrar la
combinación con el chequeo de columna dispareja de la ronda anterior:

1. **Archivo 100% coma** — regresión: `parseCsv('a,b\n1,2')` sigue
   funcionando exactamente igual que hoy (ya cubierto por los tests
   existentes de `parseCsv`, se agrega uno explícito con encabezados
   reales de Socios/Parcelas para blindar el caso real de uso).
2. **Archivo 100% punto y coma** — `parseCsv('a;b\n1;2')` debe producir
   el mismo resultado que el equivalente en coma.
3. **Hectáreas en formato `"1,5"` bajo delimitador `;`** — un CSV de
   Parcelas separado por `;` con `hcp` = `"1,5"` debe validar como `1.5`
   (vía `validateParcelaRows`, no `parseCsv` solo — la normalización de
   coma decimal vive un nivel más arriba).
4. **BOM presente y BOM ausente**, cruzado con `;` (el caso con `,`+BOM
   ya estaba cubierto antes de esta tarea).
5. **Delimitador inconsistente entre filas** — un archivo cuya cabecera
   sniffea `;` pero una fila de datos trae menos/más campos que la
   cabecera (ej. una fila que en realidad usa `,` en vez de `;`) debe
   lanzar con un mensaje que mencione la fila y el conteo de columnas.
6. **(agregado) Interacción con "columna dispareja"** — un archivo `;`
   con hectáreas mixtas `"1,5"`/`"2"`/vacío no debe bloquearse por la
   validación de columna dispareja de la ronda anterior (las 7 de
   hectárea siguen excluidas de ese chequeo, sección 3.4 del spec
   anterior) — confirma que ambos cambios conviven sin interferirse.
7. **(agregado) `;` con comillas y `,` embebida en un valor** — ej. un
   `socio_nombre_completo` con valor `"Pérez, Juan"` dentro de un archivo
   separado por `;` no debe confundirse: la coma embebida está entre
   comillas, no debe contarse como delimitador ni cortar el campo.

## 5. Riesgos / mitigaciones

| Riesgo | Detalle | Mitigación |
|---|---|---|
| **`parseCsv` ahora puede lanzar por un motivo nuevo (columnas inconsistentes) — cambio de comportamiento retroactivo** | Hoy, una fila con menos celdas que la cabecera se tolera en silencio (las celdas faltantes se completan con `''`); una fila con más celdas simplemente ignora las de más. Un archivo real que hoy "funciona" a pesar de ser ligeramente ragged (ej. una fila con una coma de más al final por un error de formato en Excel, sin que afecte los datos que importan) **empieza a rechazarse por completo** con este cambio. | Riesgo aceptado por diseño explícito del pedido ("tratarlo como error explícito y visible, no adivinar fila por fila") — es exactamente el comportamiento pedido. Documentado acá para que quede claro que es un cambio de comportamiento consciente, no un efecto secundario no buscado. Si en la práctica genera fricción con archivos reales que hoy "funcionan" a pesar de ser ragged, ajustar el mensaje/criterio es un cambio acotado a esta única función. |
| **Ambigüedad de miles vs. decimal (`"1.234,56"`)** | Fuera de alcance a propósito (sección 1.4) — un valor así queda tal cual, y termina fallando la coerción de Zod con un mensaje genérico, no uno que explique la ambigüedad. | Aceptado — los valores reales de hectárea observados son montos chicos sin agrupación de miles (`docs/schema_live.md`); si en el futuro aparece un caso real, es una extensión acotada de `normalizeDecimalComma`. |
| **Un archivo con una sola columna, sin `,` ni `;` en ningún lado** | `detectDelimiter` cuenta 0 y 0 → cae a `,` por defecto (rama `else`) — el archivo se tokeniza buscando comas que no existen, cada fila queda como un único campo, igual que hoy. | Sin cambio de comportamiento — mismo resultado que el parser actual para este caso, ya era así antes de esta tarea. |
| **Interacción con la validación de "columna dispareja" (ronda anterior)** | Las 7 de hectárea siguen excluidas de ese chequeo (decisión ya tomada, spec anterior sección 3.4) — la normalización de coma decimal no cambia esa exclusión, solo cambia qué valor de texto llega a Zod para esos 7 campos. Verificado con un test cruzado (sección 4, caso 6). | Sin riesgo adicional — ambos mecanismos operan en capas distintas del pipeline (parseo vs. validación por fila) sin pisarse. |
| **Archivos ya exportados/en uso con el formato viejo (solo `,`, sin BOM, sin comas decimales)** | Comportamiento 100% preservado — `detectDelimiter` elige `,` para cualquier archivo sin `;`, y `normalizeDecimalComma` no toca un valor que ya usa `.` o que no tiene coma. | Sin impacto retroactivo confirmado por los tests de regresión (caso 1 del plan). |
