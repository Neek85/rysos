# Spec — Multi-producto (Café/Cacao): auditoría de estado real + primer diseño de `PRODUCTOS`/`ORGANIZACION_PRODUCTOS`

- **Estado:** **Las 5 preguntas abiertas de la sección 4 quedan
  cerradas (ronda 3, 2026-08-26) — ver sección 7 para el detalle
  completo de cada decisión.** `hcp`/`hcc` NO se tocan a nivel de base
  de datos (#1, sección 5.1); `vertical` en `PRODUCTOS` usa `CHECK`
  (#2, sección 7.1); `ORGANIZACION_PRODUCTOS` se diseña N-a-N (#3,
  sección 5.2); `id_producto_predominante` va en AMBAS tablas —
  `PADRON_PARCELAS` como dato maestro editable, `EUDR_USO_SUELO` como
  foto copiada al momento de cada evento de monitoreo (#4, sección
  7.2, con la evidencia técnica real del vínculo entre ambas tablas en
  la sección 6); se conecta al exportador DDS en la misma
  implementación (#5, sección 7.3). **Sigue sin existir ninguna
  migración SQL ni cambio de código** — las 3 rondas de esta spec son
  puramente de relevamiento y diseño; la implementación es una tarea
  aparte.
- **Fecha:** 2026-08-25
- **Contexto previo:** `specs/roadmap_padron_multiorganizacion.md`
  (sección 3, boceto original de alto nivel — "PRODUCTOS/ORGANIZACION_PRODUCTOS/EUDR_USO_SUELO.id_producto_predominante"),
  `ADR-027` (certificaciones normalizadas — mismo protocolo de "arrancar
  en blanco, verificar con evidencia antes de asumir" que este
  documento sigue), `ADR-011` (criterio de agregación por subdivisión
  de `EUDR_USO_SUELO`, reutilizado en la sección 2.3), `ADR-006`
  (único precedente real de uso de `ORGANIZACIONES.Config`).

## Metodología

Misma limitación de siempre: sin conexión Postgres directa desde este
entorno — toda la evidencia viene de introspección OpenAPI de
PostgREST (Service Role Key) y consultas REST reales de solo lectura,
nunca de memoria ni de lo que dice `docs/schema_live.md` sin
re-verificar. `docs/schema_live.md` en particular está desactualizado en
al menos un punto relevante para esta auditoría (dice que `"ORG-TEST-E2E"`
y `es_organizacion_prueba` están "pendientes de aplicación manual" —
ambos ya existen en vivo, confirmado abajo) — se cita igual como
contexto histórico, pero cada afirmación de este documento fue
re-verificada contra el estado real, no copiada de ahí.

## 1. Estado real relevado — evidencia cruda

### 1.1 Columnas relacionadas a producto en las tablas núcleo — ninguna existe

Introspección OpenAPI completa (Service Role Key) de las 3 tablas que
pidió el prompt, más las 6 `CAP_*`:

- **`EUDR_USO_SUELO`** (9 columnas): `id`, `geom`, `fid`, `id_parcela`,
  `tipo_uso`, `estado_revision`, `ID_Organizacion`,
  `area_calculada_ha`, `requiere_revision_area`. **Cero columnas
  relacionadas a producto** — no existe `id_producto_predominante` ni
  nada parecido. El boceto del roadmap (sección 3) arranca de cero acá,
  tal cual asumía.
- **`ORGANIZACIONES`** (11 columnas): `ID`, `Nombre_Organizacion`,
  `RUC`, `Direccion_Fiscal`, `Representante_Legal`, `Logo`, `Config`,
  `creado_en`, `actualizado_en`, `creado_por`, `es_organizacion_prueba`.
  **Cero columnas de producto** — nada de tipo `vertical`/`rubro`.
- **`PADRON_PARCELAS`** (22 columnas): la única con algo remotamente
  relacionado es `otros_cultivo` — pero es una categoría de
  **hectáreas** (una de las 7 del desglose de área de la parcela, ver
  sección 1.4 abajo), no un selector de producto/vertical.

### 1.2 `ORGANIZACIONES.Config` — sin estructura de producto, y sin datos en absoluto

Las **3 filas reales** que existen hoy en `ORGANIZACIONES` tienen
`Config = NULL` (confirmado por lectura directa, no por
`docs/schema_live.md`, que documentaba esto en 2026-08-21 para 2 filas
— sigue siendo cierto hoy para las 3):

| `ID` | `Nombre_Organizacion` | `es_organizacion_prueba` | `Config` |
|---|---|---|---|
| `COOP-JS` | COOP. JESUS SOLIDARIO | `false` | `NULL` |
| `COOP-ND` | Asociacion Miladro de Jesus | `false` | `NULL` |
| `ORG-TEST-E2E` | Organización de Prueba — NO ES CLIENTE REAL | `true` | `NULL` |

No hay ninguna clave `producto`/`productos`/`vertical` en `Config` en
ningún registro — no puede haberla, porque `Config` mismo está vacío en
las 3 organizaciones. **El único precedente real de uso de `Config`
en todo el código** es `lib/actions/qcActions.js` (línea ~89):
lee `Config.gis.radio_contexto_vecinos_m`, con `Config` siendo `NULL`
tratado explícitamente como "el campo no existe todavía" y un fallback
seguro a un default — nunca se expone `Config` completo al cliente.
Esto establece el único patrón real a seguir si se decidiera usar
`Config` para membresía de productos: namespace anidado
(`Config.<algo>.<clave>`) + fallback explícito ante `NULL`, nunca asumir
presencia. El boceto del roadmap ya decidía NO usar `Config` para esto
(tabla `ORGANIZACION_PRODUCTOS` dedicada en su lugar) — esta auditoría
confirma que esa decisión es consistente con el único precedente real:
`Config` sigue sin estructura, y cargarle la membresía de productos
encima competiría con cualquier uso futuro del mismo campo para otra
cosa (como ya pasa con `gis.*`).

### 1.3 Tablas `CAP_*` — 3 de las 6 SÍ tienen columnas específicas de café; el resto son genéricas

Introspección completa de las 6 tablas del módulo de Inspecciones
(Fase 6):

- **`CAP_DATOS_SOCIO`** (53 columnas): **`porcent_ingresos_cafe`** y
  `percent_ingresos_otros_cultivo` — un campo específico de café (no
  "producto principal", literalmente "café") junto a un cajón único de
  "otros cultivos" sin desglose, sin equivalente `..._cacao`. Con datos
  reales poblados hoy: una fila real tiene `porcent_ingresos_cafe = 50.0`,
  `percent_ingresos_otros_cultivo = 0.0` — confirma que es un campo
  activamente usado en producción, no un vestigio sin datos.
- **`CAP_MIC`** (Manejo Integrado del Cultivo, 42 columnas): sin
  columna literal "café", pero `diversif_cultivos`/`diversif_cultivos_det`
  registra diversificación de cultivos genérica — con un dato real
  poblado: `diversif_cultivos_det = 'Palta'` (palta = aguacate, ni café
  ni cacao). Esto confirma que el módulo de inspecciones **ya captura
  hoy, en producción, cultivos distintos de café** en un campo de texto
  libre sin estructura — sin que eso implique que la parcela/socio
  "cambia de producto", es solo un dato de diversificación.
- **`CAP_GESTION`** (35 columnas): `ingresos_venta_producto`/
  `ingresos_venta_producto_monto` — nombrados genéricamente
  ("producto", no "café"), sin evidencia de que asuman un producto
  específico.
- **`CAP_CONSERVACION`**, **`CAP_BIENESTAR`**, **`CAP_RIESGOS`**: **cero**
  columnas relacionadas a producto/cultivo — completamente genéricas
  (conservación de ecosistemas, condiciones laborales, riesgos de
  contaminación — ninguna depende del cultivo).
- **`INSPECCIONES`** (tabla padre): tampoco tiene columna de producto.

### 1.4 El hallazgo más profundo: `PADRON_PARCELAS.hcp`/`hcc` están estructuralmente hardcodeadas a café

`lib/validations/socios.js::HECTARE_FIELDS` (fuente única de verdad
para labels, compartida entre el formulario manual y `lib/padronCsv.js`):

```js
export const HECTARE_FIELDS = [
  { field: 'hcp', label: 'Ha. Café Podado' },
  { field: 'hcc', label: 'Ha. Café en Crecimiento' },
  { field: 'ho', label: 'Ha. Otros' },
  { field: 'hip', label: 'Ha. Infraestructura Productiva' },
  { field: 'hrp', label: 'Ha. Reserva/Protección' },
  { field: 'hbp', label: 'Ha. Bosque Protector' },
  { field: 'otros_cultivo', label: 'Ha. Otros Cultivos' },
]
```

2 de las 7 categorías de hectáreas de una parcela (`hcp`/`hcc`) **son,
literalmente, "Café Podado"/"Café en Crecimiento"** — no es una
etiqueta cosmética, son los nombres reales de las columnas físicas de
`PADRON_PARCELAS` (heredados de AppSheet, según `docs/schema_live.md`).
`otros_cultivo` es un cajón único sin desglose para cualquier otro
cultivo (cacao incluido, hoy). Esto es distinto de los hallazgos de
`CAP_*` (sección 1.3): no es un campo de un formulario de inspección
ocasional, es el desglose de área **de la parcela misma**, la unidad
base de todo el sistema EUDR/trazabilidad. Cualquier diseño de
multi-producto que quiera reflejar "esta parcela tiene X ha de café e Y
ha de cacao" con el mismo nivel de detalle que hoy tiene para café
necesita decidir qué pasa con `hcp`/`hcc` — no es un campo que se pueda
ignorar ni generalizar sin tocarlo. **No resuelto en esta auditoría**,
ver sección 3 (hallazgos inesperados) y las preguntas abiertas.

### 1.5 Otras menciones hardcodeadas a "café" en código — cosméticas, no estructurales

Grep completo (`café|Café|cafe|Cafe|CAFE`) sobre `.js`/`.jsx`/`.py`:

- `lib/inspeccionesSchema.js`, `lib/inspeccionesActions.js`,
  `components/features/inspecciones/tabs/TabSocio.jsx`: los 3 solo
  refieren al mismo campo `porcent_ingresos_cafe` de `CAP_DATOS_SOCIO`
  (sección 1.3) — schema Zod, mapeo de payload, y el label `"% Café"`
  del input, respectivamente. Coherente, no hay una segunda fuente de
  verdad divergente.
- `app/page.jsx` (línea 88): `"Regulación EU 2023/1115 · Trazabilidad
  Cafetalera"` — texto del header del dashboard.
- `app/layout.jsx` (línea 5): `description: 'Sistema de trazabilidad
  cafetalera EU 2023/1115'` — meta description de Next.js.

Estos 2 últimos son **puramente cosméticos** (branding/copy de la UI,
sin lógica), fáciles de generalizar cuando corresponda — no bloquean
ni complican el diseño de datos.

### 1.6 `EUDR_USO_SUELO.tipo_uso` — texto libre sin vocabulario controlado en código

Valores reales hoy (las 5 filas que existen en la tabla, conteo
completo, no muestra): `'Produccion'` (3), `'Inverna/Pasto'` (2).
**Ninguno de los dos es específico de café ni de cacao** — son
categorías de uso de suelo (producción vs. pastoreo/ganadería), no de
cultivo. `grep` sobre `scripts/etl_drive_to_supabase.py` no encontró
ninguna lista de valores permitidos para `tipo_uso` — es un passthrough
de texto libre desde el formulario QField, sin vocabulario controlado
en el código de ingesta. La cadena `"Cafetal"` sí aparece, pero
**solo en fixtures de `tests/test_etl_drive.py`** (dato de prueba
ilustrativo del test, nunca en datos reales ni en ningún código de
producción) — mencionar esto para que quede claro que no es evidencia
de un valor real usado hoy, es solo una coincidencia en un test.

### 1.7 Exportador DDS/TRACES UE — confirmado: no existe ningún campo de producto/commodity

Dos archivos, la contraparte cliente (`lib/eudrDdsExporter.js`, 487
líneas) y la contraparte Python (`scripts/generate_eudr_dds.py`) — grep
de `HSHeading|hs_heading|commodity|producto|café|cafe|cacao` sobre
ambos: **cero resultados relevantes** en el Python, y en el JS solo
coincidencias de `productor`/`ProducerName` (el AGRICULTOR, no el
producto/commodity — son conceptos distintos en TRACES NT). Ninguno de
los 2 payloads (interno RYZOS ni el GeoJSON oficial EUDR
`buildOfficialEuGeoJson`) incluye un campo de tipo de producto/código
HS.

Esto significa que el exportador **no está hardcodeado a café** en el
sentido de tener el string "café" incrustado en el payload — está,
más bien, completamente ciego a la noción de producto: el campo
simplemente no existe todavía, en ningún lado. El propio archivo ya
documenta un caso idéntico para otro campo ausente, útil como
precedente exacto a seguir:

```js
// Único país operado hoy por RYZOS — no existe todavía un campo real de país
// en vw_monitoreo_web/PADRON_PARCELAS (confirmado en la investigación previa
// a ADR-017). Si en el futuro se agrega uno, debe reemplazar este literal en
// buildOfficialEuGeoJson, no coexistir con él.
const DEFAULT_PRODUCER_COUNTRY = 'PE'
```

Un campo de producto/commodity seguiría el mismo patrón el día que se
agregue: mientras no exista un dato real, el exportador seguiría
funcionando igual que hoy (sin ese campo en el payload, no con un
literal "Café" inventado) — no hay ningún literal de producto que haya
que "reemplazar" acá, porque no hay ninguno.

### 1.8 Organizaciones y datos reales — arranca completamente en blanco, igual que `PARCELA_CERTIFICACIONES` en el paso 3

- **3 organizaciones reales** existen hoy (tabla de la sección 1.2) —
  ninguna nombra ni menciona cacao en `Nombre_Organizacion` ni en
  ningún otro campo (`Config` está vacío en las 3).
- **11 parcelas reales** en `PADRON_PARCELAS` — **0** mencionan
  "cacao" (case-insensitive) en `ID_Parcela_Fija`, `parcela_codigo` ni
  `parcela_nombre` (los 3 únicos campos de texto libre relevantes,
  chequeados contra las 11 filas completas, no una muestra).
- La única evidencia real de un cultivo distinto de café en toda la
  base es el dato de `CAP_MIC.diversif_cultivos_det = 'Palta'`
  (sección 1.3) — palta, no cacao, y es un campo de diversificación de
  una inspección puntual, no un atributo estructural de la parcela ni
  de la organización.

**Conclusión:** no hay ningún dato real de cacao que migrar. El paso 4
arranca en blanco, igual que `ORGANIZACION_CERTIFICACIONES`/
`PARCELA_CERTIFICACIONES` en el paso 3 (ADR-027) — cualquier tabla
nueva puede diseñarse sin preocuparse por un backfill de datos
existentes, solo por la migración de esquema en sí.

## 2. Diseño propuesto — PRIMERA VERSIÓN, sujeta a revisión, NO cerrada

Punto de partida: el boceto original de
`specs/roadmap_padron_multiorganizacion.md` sección 3. Esta sección lo
refina con la evidencia de arriba, pero **ninguna decisión acá está
cerrada** — a diferencia de la spec de certificaciones (que llegó a un
contrato final tras 5 rondas), este documento es la ronda 1.

### 2.1 `PRODUCTOS` — catálogo, mismo patrón que `CERTIFICACIONES_CATALOGO` (ADR-027)

```
codigo      text NOT NULL UNIQUE   -- ej. 'CAFE', 'CACAO'
nombre      text NOT NULL          -- ej. 'Café', 'Cacao'
vertical    text NOT NULL          -- 'AGRICOLA' | 'PECUARIO' (columna fija, boceto original)
activo      boolean NOT NULL DEFAULT true
```

Coherente con el boceto original ("columna fija, no tabla propia" para
`vertical`) y con el patrón ya usado en `CERTIFICACIONES_CATALOGO`. Sin
evidencia real de un tercer valor de `vertical` hoy (el roadmap
menciona "pecuario/cuyes después" como un paso futuro separado, fuera
de alcance de esta auditoría) — `vertical` como `text` libre en vez de
un `CHECK`/enum es una decisión a confirmar, no asumida acá.

### 2.2 `ORGANIZACION_PRODUCTOS` — membresía, mismo patrón que `ORGANIZACION_CERTIFICACIONES` (ADR-027)

```
id_organizacion   text NOT NULL REFERENCES ORGANIZACIONES("ID")
id_producto       uuid NOT NULL REFERENCES PRODUCTOS(id)
UNIQUE(id_organizacion, id_producto)
```

Reutiliza el mismo patrón de FK real a `ORGANIZACIONES("ID")` ya
validado en el paso 3 (`ORGANIZACION_CERTIFICACIONES`), no `Config`
(sección 1.2 confirma que `Config` no tiene ninguna estructura que
proteger ni ningún precedente de uso para esto). RLS/GRANTs: mismo
patrón esperable que las tablas de certificación — a relevar con el
mismo protocolo de la ronda 5 de esa spec cuando se llegue a esa etapa,
no asumido acá todavía.

### 2.3 `EUDR_USO_SUELO.id_producto_predominante` — nullable, aditivo

```
ALTER TABLE EUDR_USO_SUELO ADD COLUMN IF NOT EXISTS id_producto_predominante uuid REFERENCES PRODUCTOS(id);
```

"Predominante" (no exclusivo): una subdivisión de uso de suelo puede
tener un cultivo mixto, pero se etiqueta con el dominante — mismo
criterio de agregación por subdivisión que ya usa
`fn_cobertura_uso_suelo_parcela` (ADR-011): el mix real de productos de
una parcela se derivaría sumando `area_calculada_ha` de sus
subdivisiones `EUDR_USO_SUELO` aprobadas, agrupadas por
`id_producto_predominante`, en vez de necesitar un campo nuevo a nivel
parcela. Nullable porque el dato histórico (statu quo hoy: todo es
café, implícito, sin ninguna fila etiquetada) no puede rellenarse
automáticamente sin una decisión de producto explícita de qué asumir
para las filas existentes — ver pregunta abierta abajo.

### 2.4 Fuera de alcance de este diseño preliminar (a decidir en una ronda futura, no bloqueante para arrancar)

- RLS/GRANTs exactos de `PRODUCTOS`/`ORGANIZACION_PRODUCTOS` (mismo
  protocolo de relevamiento que la ronda 5 de certificaciones).
- Qué hace la UI (`/dashboard/socios`, `/dashboard/mapa`) con esto —
  selector de producto en el alta de parcela/organización, filtros,
  etc. Ninguna pantalla hoy tiene ningún lugar donde mostrar esto.
- El exportador DDS (sección 1.7) eventualmente necesitaría un campo de
  producto/commodity en el payload oficial (`buildOfficialEuGeoJson`) —
  no diseñado acá, solo señalado como un consumidor futuro real.

## 3. Hallazgos inesperados — para revisión del usuario, no resueltos acá

1. **`PADRON_PARCELAS.hcp`/`hcc` están hardcodeadas a "Café Podado"/
   "Café en Crecimiento"** (sección 1.4) — es el hallazgo más profundo
   de esta auditoría, no anticipado por el boceto original del roadmap.
   El nuevo diseño de `PRODUCTOS`/`ORGANIZACION_PRODUCTOS`/
   `id_producto_predominante` (sección 2) puede convivir con `hcp`/`hcc`
   sin tocarlas (quedan como están, específicas de café, igual que las
   8 columnas de certificación quedaron congeladas en ADR-027) — pero
   eso significa que un socio/organización que trabaje SOLO cacao
   seguiría teniendo 2 columnas de área literalmente rotuladas "Café"
   en su padrón, sin ningún lugar equivalente para reportar hectáreas
   de cacao con el mismo nivel de detalle (poda vs. crecimiento). Esto
   no bloquea empezar el diseño de las 2 tablas nuevas, pero si el
   objetivo real de "multi-producto" incluye reportar áreas de cacao
   con la misma granularidad que hoy tiene café, hace falta una
   decisión explícita sobre qué pasa con `hcp`/`hcc` — generalizarlas,
   dejarlas como están y agregar sus equivalentes de cacao aparte, o
   otra cosa. **No decidido todavía, y no es una decisión que este
   documento deba tomar solo.**
2. **`CAP_DATOS_SOCIO.porcent_ingresos_cafe`** (sección 1.3) es un
   campo activo con datos reales, específico de café, sin equivalente
   de cacao — mismo tipo de decisión que el punto anterior pero en el
   módulo de Inspecciones en vez del padrón. Menor urgencia (es un
   campo de un formulario de inspección socioeconómica, no de la
   unidad base "parcela"), pero mismo patrón de gap.
3. **`EUDR_USO_SUELO.tipo_uso` es texto libre sin vocabulario
   controlado** (sección 1.6) — hoy nadie valida qué valores puede
   tomar. Si en el futuro se quisiera usar `tipo_uso` en vez de (o
   junto con) un `id_producto_predominante` dedicado para distinguir
   café de cacao, hoy no hay ninguna barrera de código que lo impida
   ni lo intente — cualquier técnico de campo puede escribir lo que
   sea. No es un problema de esta tarea, pero es relevante tenerlo
   presente al diseñar `id_producto_predominante`: ese campo nuevo
   nacería con más estructura (FK a un catálogo) que `tipo_uso` tiene
   hoy, lo cual es una mejora, no un problema — solo señalado para que
   quede claro que no hay ninguna migración de datos de `tipo_uso`
   hacia el nuevo campo que tenga sentido automatizar (los valores
   reales hoy, `'Produccion'`/`'Inverna/Pasto'`, no cargan ninguna
   señal de producto que se pueda mapear).

## 4. Preguntas abiertas (sin evidencia clara — no asumidas, no resueltas en esta spec)

1. ~~¿Qué pasa con `PADRON_PARCELAS.hcp`/`hcc` frente a organizaciones
   que solo trabajan cacao? (hallazgo #1 de la sección 3).~~
   **RESUELTA, ronda 2 — ver sección 5.1.**
2. ~~¿`vertical` en `PRODUCTOS` es realmente solo `AGRICOLA`/`PECUARIO`
   como texto libre, o conviene un `CHECK`/enum? Sin evidencia de un
   tercer valor real hoy.~~ **RESUELTA, ronda 3 — ver sección 7.1.**
3. ~~¿La membresía `ORGANIZACION_PRODUCTOS` es 1-a-N real (una
   organización puede tener café Y cacao a la vez) o el negocio real
   asume una organización = un producto principal? El nombre de la
   tabla y el boceto original sugieren N-a-N, pero no hay ningún dato
   real (las 3 organizaciones no tienen ningún producto asignado hoy)
   que confirme el caso de uso real de una organización con más de un
   producto simultáneo.~~ **RESUELTA (pendiente de confirmación final
   del usuario), ronda 2 — ver sección 5.2.**
4. ~~¿`id_producto_predominante` en `EUDR_USO_SUELO` alcanza, o el
   objetivo final necesita el mismo dato también a nivel
   `PADRON_PARCELAS` (la unidad que ve el padrón, no solo el uso de
   suelo aprobado en GIS)? El boceto original solo lo propone en
   `EUDR_USO_SUELO`.~~ **RESUELTA, ronda 3 — ver sección 7.2.**
5. ~~¿Cuándo/cómo se conecta esto al exportador DDS (sección 1.7)? Fuera
   de alcance del diseño de esquema, pero es el consumidor final real
   mencionado en el roadmap original ("selectores de producto +
   certificación antes de generar el paquete").~~ **RESUELTA, ronda 3
   — ver sección 7.3.**

## 5. Decisiones cerradas — ronda 2 (2026-08-25)

### 5.1 `PADRON_PARCELAS.hcp`/`hcc` — NO se tocan a nivel de base de datos (resuelve pregunta #1)

**Decisión:** `hcp`/`hcc` representan un concepto universal ("en
producción"/"en crecimiento"), aplicable a cualquier producto, no
exclusivo de café — no requieren ningún cambio de esquema ni migración
en el paso 4. Se mantienen tal cual, sin agregar columnas equivalentes
de cacao ni generalizarlas a nivel de columna.

Lo que SÍ es específico de café es únicamente el **texto de la UI**
("Café Podado"/"Café en Crecimiento"), no el concepto ni la columna.
Grep completo (`Café Podado|Café en Crecimiento|Ha\. Café|hcp|hcc`
sobre `.js`/`.jsx`) confirma exactamente 2 sitios fuente y 2 sitios de
consumo, sin ninguna otra ocurrencia hardcodeada por fuera de esta
única fuente de verdad:

- **`lib/validations/socios.js:131`** — `{ field: 'hcp', label: 'Ha. Café Podado' }`
- **`lib/validations/socios.js:132`** — `{ field: 'hcc', label: 'Ha. Café en Crecimiento' }`
- **`components/features/socios/ParcelaFormModal.jsx:80`** —
  `{HECTARE_FIELDS.map(({ field, label }) => (<FormField key={field} label={label} ...>` —
  renderiza esos labels como el texto visible de cada input en el
  formulario manual de alta/edición de parcela.
- **`lib/padronCsv.js:75`** —
  `...Object.fromEntries(HECTARE_FIELDS.map(({ field, label }) => [field, label]))`
  dentro de `PARCELA_FIELD_LABELS` — los mismos labels se convierten en
  encabezados de columna del CSV de exportación/plantilla/importación
  de parcelas.

Ambos sitios de consumo leen `HECTARE_FIELDS` como única fuente — no
hay ningún texto "Café" duplicado o divergente en otro lugar del
código (confirmado, no asumido).

**Alcance de la corrección (para la tarea de implementación del paso
4, NO esta tarea de relevamiento):** el texto se corrige para que sea
genérico o condicional al producto de la parcela — por ejemplo "Ha. En
Producción"/"Ha. En Crecimiento" genérico, o un label que varíe según
el/los producto(s) de la organización dueña de la parcela. Es un
cambio de UI/texto en `lib/validations/socios.js` (y por herencia,
`ParcelaFormModal.jsx`/`lib/padronCsv.js` sin tocarlos directamente),
**no una migración de base de datos** — `hcp`/`hcc` siguen siendo las
mismas 2 columnas físicas, solo cambia cómo se rotulan.

### 5.2 `ORGANIZACION_PRODUCTOS` — diseño N-a-N (resuelve pregunta #3, pendiente de confirmación final)

**Decisión (criterio a usar para redactar el contrato de datos,
pendiente de confirmación final del usuario):** una organización puede
tener más de un producto a la vez (café Y cacao simultáneamente, no
una relación excluyente 1-a-1 organización↔producto). El diseño de la
sección 2.2 (`ORGANIZACION_PRODUCTOS` con `UNIQUE(id_organizacion,
id_producto)`, sin ninguna restricción adicional que limite a una sola
fila por organización) ya era estructuralmente N-a-N — esta decisión
confirma que ese es el comportamiento de negocio deseado, no solo un
artefacto del patrón reutilizado de `ORGANIZACION_CERTIFICACIONES`.

## 6. Evidencia técnica del vínculo `EUDR_USO_SUELO` ↔ `PADRON_PARCELAS` (ronda 3, 2026-08-26)

Relevada para poder diseñar `id_producto_predominante` con conocimiento
real de cómo se conecta cada tabla — necesaria antes de cerrar la
pregunta #4.

### 6.1 `EUDR_USO_SUELO.id_parcela` — corrección de premisa importante: NO es una FK a `PADRON_PARCELAS`, pese al nombre

Introspección OpenAPI confirma que `id_parcela` (`character varying`)
**no tiene ninguna anotación de Foreign Key** — a diferencia de
`ID_Organizacion` en la misma tabla, que sí la tiene
(`REFERENCES ORGANIZACIONES.ID`, agregada en algún punto posterior a
`docs/schema_live.md`, que todavía documentaba "sin FK real desde
ninguna tabla transaccional" — desactualizado en ese punto puntual,
confirmado y corregido acá con evidencia fresca).

Más importante: **el contenido real de `id_parcela` no es un código de
`PADRON_PARCELAS` en absoluto.** `ADR-010`/`ADR-021` (ya documentados
en este repo, releídos para esta ronda) explican la causa raíz: pese a
su nombre, `EUDR_USO_SUELO.id_parcela` guarda el **GUID crudo que
QField genera para el `EUDR_MONITOREO` padre** de esa subdivisión
(formato `{xxxxxxxx-xxxx-...}`), preservado tal cual desde el
GeoPackage — nunca fue pensado para llevar `PADRON_PARCELAS.ID_Parcela_Fija`.
El vínculo real hacia la parcela es una cadena de 2 saltos, ninguno
con FK real a nivel de base de datos, ambos por convención de texto:

```
EUDR_USO_SUELO.id_parcela  =  EUDR_MONITOREO.qfield_relation_id
                                        ↓
                          EUDR_MONITOREO.ID_Parcela_Fija
                                        ↓
                          PADRON_PARCELAS.ID_Parcela_Fija   (texto, sin FK)
```

**Verificado empíricamente contra las 5 filas reales de
`EUDR_USO_SUELO`**, sin asumir que el mecanismo documentado en los ADR
siga funcionando en los datos actuales: las 5 resuelven correctamente
la cadena completa hasta un `ID_Parcela_Fija` real y activo de
`PADRON_PARCELAS`:

| `EUDR_USO_SUELO.id` | `id_parcela` (crudo) | → `EUDR_MONITOREO.id_monitoreo` | → `ID_Parcela_Fija` |
|---|---|---|---|
| 18 | `{4166dc2a-...}` | `425fdcca-ddb0-...` | `COOP-JS-003` |
| 19 | `{29ba74a4-...}` | `10425cbd-3d3e-...` | `COOP-JS-003` |
| 20 | `{29ba74a4-...}` | `10425cbd-3d3e-...` | `COOP-JS-003` |
| 32 | `{6323b5e0-...}` | `2947810c-e191-...` | `COOP-JS-001` |
| 33 | `{6323b5e0-...}` | `2947810c-e191-...` | `COOP-JS-001` |

Confirma, además, que **el criterio "1 fila EUDR_MONITOREO → N filas
EUDR_USO_SUELO" ya es la realidad hoy** (filas 19+20 comparten el
mismo monitoreo; 32+33 también) — la relación EUDR_MONITOREO↔EUDR_USO_SUELO
es 1-a-N, no 1-a-1, consistente con el concepto de "subdivisiones" de
ADR-011.

### 6.2 Múltiples monitoreos por parcela a lo largo del tiempo — confirmado, no es 1:1

`EUDR_MONITOREO` agrupado por `ID_Parcela_Fija` (19 filas reales
totales):

| `ID_Parcela_Fija` | monitoreos |
|---|---|
| `COOP-JS-003` | 4 |
| `COOP-JS-004` | 3 |
| `COOP-JS-001` | 3 |
| `COOP-ND-001` | 1 |
| `COOP-ND-004` | 1 |
| `COOP-JS-002` | 1 |
| `PARC-E2E-001` | 1 |
| *(sin parcela asignada)* | 5 |

**Confirmado: en la práctica ya hay múltiples eventos de monitoreo
para la misma parcela a lo largo del tiempo** (hasta 4 para
`COOP-JS-003`) — no es un caso hipotético ni 1:1. Esto respalda
directamente el criterio "foto por evento" de la pregunta #4: si una
parcela cambiara de producto predominante entre dos visitas de campo
(ej. se arranca café y se replanta cacao), cada `EUDR_USO_SUELO`
histórico debe conservar el producto que tenía AL MOMENTO de ESE
monitoreo, no el valor actual de `PADRON_PARCELAS` (que para ese
entonces ya cambió) — un campo `id_producto_predominante` copiado en
el momento de creación, no una vista/JOIN en vivo hacia el padrón,
es la única forma de preservar esa foto histórica.

### 6.3 Exportador DDS/TRACES — confirmado: lee de `vw_monitoreo_web`, no directamente de las tablas núcleo

`components/gis/MapDashboard.jsx` (el componente real de
`/dashboard/mapa`) consulta `.from('vw_monitoreo_web')` (líneas 452 y
468), guarda el resultado en `records`, y se lo pasa tal cual a
`buildTracesPayload(records, organizationId)` (línea 378, de
`lib/eudrDdsExporter.js`) — cuyo resultado se descarga vía
`downloadTraceabilityPackage`. Es decir: **el payload de exportación
nunca consulta `EUDR_USO_SUELO`/`PADRON_PARCELAS` directamente** — todo
pasa por la vista consolidada `vw_monitoreo_web` (el mismo `UNION ALL`
de `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`, filtrado a
`estado_revision = 'APROBADO'`, con los `JOIN` a `PADRON_PARCELAS` que
ya trae `parcela_codigo`/área, documentados en `docs/schema_live.md`).

**Consecuencia directa para la implementación:** conectar
`id_producto_predominante` al exportador DDS no es un cambio en
`lib/eudrDdsExporter.js` en primera instancia — es agregar la columna
a `vw_monitoreo_web` (`CREATE OR REPLACE VIEW`, mismo patrón sin
`DROP VIEW` ya usado en ADR-026 para esa misma vista) para que el
dato llegue hasta `records` en `MapDashboard.jsx`; recién ahí
`buildTracesPayload`/`buildOfficialEuGeoJson` pueden empezar a usarlo.

### 6.4 Dónde se crea hoy un `EUDR_USO_SUELO` nuevo — 2 sitios reales de código

1. **`lib/actions/gisActions.js::uploadGeoSpatialFeature`** (rama
   `EUDR_USO_SUELO`, líneas 244-263) — el Ingestor de Capas Espaciales
   de `/dashboard/mapa` (carga manual de GeoJSON/KML/Shapefile-ZIP).
   Ya resuelve `fieldOverrides.id_parcela` (el código legible que
   escribe el usuario) contra `PADRON_PARCELAS` en
   `assertParcelaActivaOSinValor` (línea 256) **antes** de armar el
   payload — este es el punto natural para, en la misma consulta o una
   adicional inmediatamente después, leer
   `PADRON_PARCELAS.id_producto_predominante` de esa parcela y copiarlo
   al payload de `insertEudrCoreRecord` (línea 258-261) como
   `id_producto_predominante` de la nueva fila.
2. **`scripts/etl_drive_to_supabase.py::build_uso_suelo_payload`**
   (línea 357) — la ingesta real de campo (GeoPackage vía QField), la
   vía principal por volumen. A diferencia del sitio anterior, **hoy no
   hace ninguna consulta a Supabase** para construir el payload de
   `EUDR_USO_SUELO` — solo lee campos de la fila del GeoPackage
   (`row.get(...)`) vía `resolve_field_with_fallback`. Copiar el
   producto de la parcela acá requeriría agregar una consulta nueva
   (resolver primero el `ID_Parcela_Fija` real, mismo problema de la
   sección 6.1 — hoy el `id_parcela` de esta fila todavía es el GUID
   crudo de QField en este punto del pipeline, no el código legible) —
   más trabajo que el sitio 1, a diseñar con cuidado en la tarea de
   implementación, no en esta auditoría.

## 7. Decisiones cerradas — ronda 3 (2026-08-26)

### 7.1 `vertical` en `PRODUCTOS` usa `CHECK` (resuelve pregunta #2)

**Decisión:** `vertical` se restringe con un `CHECK` (`IN ('AGRICOLA', 'PECUARIO')`
o equivalente), no queda como texto libre sin validar — mismo criterio
de rigor que el resto del schema versionado de este repo (ej. los
`CHECK` ya existentes en otras tablas Fase 6). Sin evidencia de un
tercer valor real hoy (sección 1 de esta spec no encontró ninguno), así
que el `CHECK` arranca con exactamente esos 2 valores; ampliarlo a
futuro (ej. el "pecuario/cuyes" que menciona el roadmap original como
paso posterior) es una migración `ALTER TABLE ... DROP CONSTRAINT` +
`ADD CONSTRAINT` cuando corresponda, no algo a resolver en esta spec.

### 7.2 `id_producto_predominante` en AMBAS tablas — `PADRON_PARCELAS` maestro, `EUDR_USO_SUELO` foto por evento (resuelve pregunta #4)

**Decisión:** el campo se agrega en las 2 tablas, con roles distintos:

- **`PADRON_PARCELAS.id_producto_predominante`** (nullable, FK a
  `PRODUCTOS`) — el dato **maestro editable**, la fuente de verdad de
  "qué produce esta parcela hoy". Se edita desde el padrón
  (`/dashboard/socios`, mismo lugar que el resto de los atributos de
  la parcela), sin relación con ningún evento de monitoreo puntual.
- **`EUDR_USO_SUELO.id_producto_predominante`** (nullable, FK a
  `PRODUCTOS`) — una **foto**, copiada del valor de
  `PADRON_PARCELAS.id_producto_predominante` al momento exacto de crear
  cada registro de uso de suelo (sección 6.4: en
  `uploadGeoSpatialFeature` y, con más trabajo, en
  `build_uso_suelo_payload`), y nunca vuelta a sincronizar
  automáticamente después. Esto preserva el producto real que tenía la
  parcela en cada evento histórico de monitoreo, incluso si
  `PADRON_PARCELAS.id_producto_predominante` cambia más adelante —
  justificado con evidencia real en la sección 6.2 (múltiples
  monitoreos reales por parcela a lo largo del tiempo, no un caso
  hipotético).

El boceto original del roadmap (sección 3) solo proponía el campo en
`EUDR_USO_SUELO` — esta decisión lo amplía a `PADRON_PARCELAS` también,
con `PADRON_PARCELAS` como maestro y `EUDR_USO_SUELO` como copia
histórica, no al revés.

### 7.3 Conectado al exportador DDS en la misma implementación (resuelve pregunta #5)

**Decisión:** el paso 4 de implementación incluye conectar
`id_producto_predominante` hasta el exportador DDS, no queda como una
tarea separada futura. Según la evidencia técnica real de la sección
6.3, el camino concreto es: agregar la columna a `vw_monitoreo_web`
(la única fuente real de datos de `MapDashboard.jsx`/`buildTracesPayload`,
confirmado que el exportador nunca consulta `EUDR_USO_SUELO`/
`PADRON_PARCELAS` directamente) — desde ahí, `lib/eudrDdsExporter.js`
puede incorporar el producto al payload interno y/o al GeoJSON oficial
(`buildOfficialEuGeoJson`), con el mismo criterio ya usado para
`DEFAULT_PRODUCER_COUNTRY` (sección 1.7): mientras no haya dato real
para una fila, el campo se omite del payload en vez de inventar un
valor.
