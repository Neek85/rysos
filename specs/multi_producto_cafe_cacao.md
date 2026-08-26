# Spec — Multi-producto (Café/Cacao): auditoría de estado real + primer diseño de `PRODUCTOS`/`ORGANIZACION_PRODUCTOS`

- **Estado:** **Auditoría de solo lectura completa (2026-08-25) — diseño
  propuesto en la sección 2 es una PRIMERA VERSIÓN, sujeta a revisión del
  usuario, NO cerrada.** Sin migración SQL ni cambios de código en esta
  tarea.
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

1. ¿Qué pasa con `PADRON_PARCELAS.hcp`/`hcc` frente a organizaciones
   que solo trabajan cacao? (hallazgo #1 de la sección 3).
2. ¿`vertical` en `PRODUCTOS` es realmente solo `AGRICOLA`/`PECUARIO`
   como texto libre, o conviene un `CHECK`/enum? Sin evidencia de un
   tercer valor real hoy.
3. ¿La membresía `ORGANIZACION_PRODUCTOS` es 1-a-N real (una
   organización puede tener café Y cacao a la vez) o el negocio real
   asume una organización = un producto principal? El nombre de la
   tabla y el boceto original sugieren N-a-N, pero no hay ningún dato
   real (las 3 organizaciones no tienen ningún producto asignado hoy)
   que confirme el caso de uso real de una organización con más de un
   producto simultáneo.
4. ¿`id_producto_predominante` en `EUDR_USO_SUELO` alcanza, o el
   objetivo final necesita el mismo dato también a nivel
   `PADRON_PARCELAS` (la unidad que ve el padrón, no solo el uso de
   suelo aprobado en GIS)? El boceto original solo lo propone en
   `EUDR_USO_SUELO`.
5. ¿Cuándo/cómo se conecta esto al exportador DDS (sección 1.7)? Fuera
   de alcance del diseño de esquema, pero es el consumidor final real
   mencionado en el roadmap original ("selectores de producto +
   certificación antes de generar el paquete").
