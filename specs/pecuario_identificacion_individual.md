# Spec — Identificación individual de reproductoras/reproductores (v3 del módulo Pecuario Cuyes)

## Origen de este documento

El usuario tenía un desarrollo previo, más avanzado pero inconcluso, del mismo
módulo pecuario construido en **Google AppSheet** ("CuyManager SaaS V1" — 23
tablas, 310 columnas, 56 vistas, 111 acciones, sobre una Google Sheet). Pidió
analizarlo a fondo y proponer qué rescatar para soportar **ambos modos** a la
vez:

1. Manejo poblacional por poza/lote (lo ya construido en v1/v2, sin cambios).
2. Identificación individual de reproductoras (hembras) y reproductores
   (machos) — el plan original que no llegó a terminarse en AppSheet.

Se leyeron las 297 páginas de la documentación exportada (tabla por tabla,
columna por columna, vistas, las 111 acciones y los 2 Format Rules) antes de
escribir esta propuesta — el mismo criterio de "verificar antes de asumir"
que ya corrigió el diseño original de Gemini en v1 aplica igual aquí: un app
inconcluso puede tener tanto buenas ideas de modelo de datos como bugs reales
en su lógica, y hay que separar las dos cosas.

## Veredicto general sobre el app donante (AppSheet)

**Multi-tenancy: más débil que lo que ya tiene RYZOS, no un modelo a copiar.**
El aislamiento por `id_empresa` en ese app es solo de capa de aplicación
(`Initial value = LOOKUP(USEREMAIL(),"usuarios_sistema","email","id_empresa")`
al crear cada fila) — no hay ningún filtro de lectura equivalente a RLS. Es
literalmente el mismo nivel de rigor que hoy tiene la web de RYZOS con la
llave `anon` (que el propio proyecto documenta como una limitación conocida,
no como el objetivo). La app móvil de Granja Valencia ya está diseñada para
ser más estricta (usuario interno autenticado + RLS con `auth_org_id()`), así
que en esto no hay nada que rescatar — al contrario, hay que evitar bajar el
nivel de seguridad ya decidido para este módulo.

**Modelo de datos: sí hay ideas valiosas, y una de ellas ya estaba anticipada
en el diseño actual.** El patrón que se repite tres veces en el app donante
(`mortalidad`, `sanidad_eventos`, `ventas`) es siempre el mismo: una
transacción es **o individual o poblacional**, nunca ambas, decidido por qué
columna Ref viene llena (`id_animal` vs `id_lote`/`id_poza`). Esto es
exactamente lo que ya se dejó preparado en v1 sin saber que se iba a necesitar
tan pronto: `PECUARIO_PARTOS.madre_id` y `PECUARIO_MORTALIDAD.animal_id` son
columnas reservadas para esto mismo desde el primer día (ver
`specs/pecuario_cuyes_mvp.md`, sección "Fuera de alcance de este MVP").

**Automatizaciones: dos ideas buenas, una de ellas con un bug real que no hay
que copiar.**
- *Descontar insumo al aplicar un tratamiento sanitario* (bot "Descontar
  Medicina del Stock" en el app donante): correctamente encadenado — cada
  tratamiento resta el insumo usado del kardex. **Vale la pena portar esta
  idea**, y encaja perfecto con `PECUARIO_INSUMOS_MOVIMIENTOS` ya construido
  en v2.
- *Dar de baja un animal automáticamente al registrar su muerte o venta* (bot
  "Auto-Baja Mortalidad"): **está mal armado en el app donante** — las dos
  acciones encadenadas quedan invertidas, así que cualquier muerte termina
  marcando al animal como `estado="Vendido"` en vez de `"Muerto"`. No se debe
  replicar tal cual; se implementa la versión que sí hace lo que se
  pretendía, directamente como trigger de Postgres.

**IoT: no es algo para rescatar, sería trabajo nuevo.** Las tablas
`iot_dispositivos`/`iot_lecturas` del app donante solo miden temperatura,
humedad y amoniaco por galpón — nunca se llegó a construir un sensor de peso
ni ningún vínculo entre una lectura IoT y un animal o lote. Si esto interesa
a futuro es una fase aparte, no algo que este análisis esté rescatando de
código ya hecho.

**Genealogía/consanguinidad:** el app donante evita cruzar una hembra con un
macho pariente comparando un `ancestros_string` (texto plano concatenado
recursivamente) con `CONTAINS()`. Funciona, pero es frágil (un ID que
aparezca como substring de otro rompe la comparación). Se rescata la *idea*
(bloquear el cruce si hay parentesco), no la implementación — en Postgres
esto se hace mejor con una función recursiva (`WITH RECURSIVE`) sobre
`id_madre`/`id_padre`.

## Decisión arquitectónica: overlay opcional, no un esquema paralelo

La identificación individual **no reemplaza** el manejo poblacional — se
activa **por organización** (columna `Config` JSON de `ORGANIZACIONES`, mismo
mecanismo "Core + Verticals" que ya usa el resto de RYZOS para prender/apagar
módulos) y solo aplica a los animales que la organización decida identificar
(en la práctica: reproductoras y reproductores — no tiene sentido poner arete
a cada cuy de engorde). Un lote de recría/engorde sigue existiendo exactamente
igual que hoy; lo único nuevo es que **puede** tener un `parto_origen_id` que
a su vez apunta a una madre identificada — el puente ya construido en v1
(`PECUARIO_LOTES.parto_origen_id`) es exactamente ese puente, y ya sale
correcto sin cambios.

### Tablas nuevas

**`PECUARIO_REPRODUCTORES`** (solo hembras/machos identificados individualmente):
- `id` uuid, `ID_Organizacion` text, `codigo_arete` text (escaneable por QR —
  mismo patrón ya decidido para poza/galpón/lote en v2, no requiere diseño
  nuevo), `sexo` enum (macho/hembra), `raza` text, `fecha_nacimiento` date,
  `id_madre` uuid (auto-referencia a esta misma tabla), `id_padre` uuid
  (auto-referencia), `jaula_actual_id` uuid → `PECUARIO_JAULAS`, `proposito`
  enum (reproductor/engorde/reemplazo/descarte), `estado` enum
  (activo/vendido/muerto/enfermo), `foto_url`, `notas`, más
  `device_id`/`created_offline_at`/`synced_at` (es una tabla operativa, se
  edita desde el celular en el galpón).
- RLS con el mismo patrón `auth_org_id()` de siempre.

**`PECUARIO_HISTORIAL_MACHOS`** (auditoría de qué macho estuvo en qué jaula,
para consanguinidad y para inferir paternidad):
- `id`, `ID_Organizacion`, `macho_id` → `PECUARIO_REPRODUCTORES`, `jaula_id` →
  `PECUARIO_JAULAS`, `fecha_entrada`, `fecha_salida` (a diferencia del app
  donante, **no** se le pone `TODAY()` por defecto — ese fue justamente uno de
  los bugs detectados; queda `NULL` hasta que el macho realmente sale).
- Trigger `fn_cerrar_historial_macho_anterior()`: al asignar un nuevo macho a
  una jaula que ya tenía uno activo (`fecha_salida IS NULL`), cierra
  automáticamente el registro anterior con `fecha_salida = hoy` antes de abrir
  el nuevo — evita que dos registros queden "abiertos" a la vez, que es la
  clase de inconsistencia que el app donante no prevenía.

### Columnas nuevas en tablas ya existentes (no rompen nada — `ADD COLUMN IF NOT EXISTS`)

- `PECUARIO_PARTOS.macho_id` uuid → `PECUARIO_REPRODUCTORES` (complementa al
  ya existente `macho_activo_codigo` de texto libre; cuando el modo
  individual está activo, se llena automáticamente igual que
  `id_macho_vigente` en el app donante: el macho que estaba asignado a esa
  jaula en la fecha del parto, vía `PECUARIO_HISTORIAL_MACHOS`).
- `PECUARIO_MORTALIDAD.animal_id` ya existía reservada desde v1 — se empieza
  a usar de verdad (FK real a `PECUARIO_REPRODUCTORES` en vez de columna
  suelta). Se agrega un `CHECK` de "individual XOR poblacional": si
  `animal_id` está lleno, `lote_id`/`poza_id` deben estar vacíos, y si
  `animal_id` está vacío debe haber al menos uno de `lote_id`/`poza_id` — el
  propio análisis del app donante mostró que dejar esto sin restricción es
  fuente de datos inconsistentes.
- `PECUARIO_VENTAS.animal_id` (nueva) uuid → `PECUARIO_REPRODUCTORES`, con el
  mismo criterio "exactamente uno" entre `animal_id`/`lote_id` (`poza_id`
  queda como dato de contexto opcional, no participa del `CHECK`).

### Triggers correctos (versión corregida de los dos bots rescatables)

- `fn_dar_baja_animal_por_mortalidad()` AFTER INSERT en `PECUARIO_MORTALIDAD`
  cuando `animal_id IS NOT NULL`: `estado='muerto'`, `jaula_actual_id=NULL`,
  `fecha_salida=fecha del evento` — una sola operación correcta, no las dos
  acciones encadenadas e invertidas del app donante.
- `fn_dar_baja_animal_por_venta()` AFTER INSERT en `PECUARIO_VENTAS` cuando
  `animal_id IS NOT NULL`: `estado='vendido'`, `jaula_actual_id=NULL`,
  `fecha_salida=fecha del evento`.
- `fn_descontar_insumo_tratamiento()`: se define junto con la tabla de
  tratamientos sanitarios individuales/por lote (ver abajo) — inserta un
  movimiento de salida en `PECUARIO_INSUMOS_MOVIMIENTOS` cuando se registra un
  tratamiento que consume un insumo. Esta es la idea del bot que sí funcionaba
  bien en el app donante.

### Tratamientos sanitarios con alcance (galpón/lote/individual)

El app donante tenía `sanidad_eventos` con un selector `alcance`
(Galpon/Lote/Individual) que muestra el campo Ref correspondiente — el
patrón más limpio de los tres que se repiten en ese app. Esto es distinto de
`PECUARIO_CONTROL_SANITARIO` (desinfección recurrente, v2) y de
`PECUARIO_LIMPIEZA_GALPON` (limpieza recurrente, v2), que son tareas de
mantenimiento, no tratamientos veterinarios puntuales. Se propone una tabla
nueva **`PECUARIO_TRATAMIENTOS`**: `id`, `ID_Organizacion`, `alcance` enum
(galpon/lote/individual), `galpon_id`/`lote_id`/`animal_id` (exactamente uno
según `alcance`, con `CHECK`), `fecha`, `tipo_tratamiento` enum
(preventivo/curativo/vitaminas), `diagnostico` text, `insumo_id` →
`PECUARIO_INSUMOS`, `cantidad_dosis`, `costo_estimado`, `device_id` +
offline. El trigger de descuento de stock se cuelga de esta tabla.

### Consanguinidad

Función `fn_son_parientes(animal_a uuid, animal_b uuid, generaciones int
default 3)` con `WITH RECURSIVE` sobre `id_madre`/`id_padre`, usada como
`CHECK`/validación en la app (no en la base, para no bloquear escritura
offline) antes de asignar un macho a una jaula donde hay hembras
emparentadas — reemplaza el `ancestros_string` + `CONTAINS()` del app donante
por algo que no se rompe si un UUID es substring de otro.

## Qué se descarta explícitamente (y por qué)

- IoT de sensores ambientales (`iot_dispositivos`/`iot_lecturas`): nunca se
  conectó a nada útil en el app donante; queda fuera de esta propuesta, no
  fuera de la conversación a futuro.
- Duplicar la lógica exacta de "Auto-Baja Mortalidad": tenía el bug de dejar
  `estado="Vendido"` en una muerte — se reemplaza por el trigger correcto de
  arriba.
- `historial_machos.fecha_salida` con `TODAY()` por defecto, `ruc_dni` sin
  marcar como sensible, símbolo de moneda inconsistente ($ vs S/), enums
  específicos de Perú (razas, Yape/Plin) tal cual — se adaptan libremente, no
  son parte del contrato a preservar.

## Compatibilidad con lo ya construido (v1 + v2)

Nada de esto modifica una columna existente ni cambia su tipo — todo es
`CREATE TABLE` nuevo o `ADD COLUMN IF NOT EXISTS` con default `NULL`/enum
nuevo. Una organización que nunca activa el modo individual no ve ninguna
diferencia: `PECUARIO_REPRODUCTORES` queda vacía, los `CHECK` de "exactamente
uno de animal_id/lote_id" se satisfacen igual con `lote_id` solo, como ya
pasa hoy. Esto respeta el principio "Core + Verticals" del proyecto: mismo
esquema, interruptor en `Config` JSON de `ORGANIZACIONES`.

## Pendiente de decisión humana antes de escribir la migración (v3)

1. ¿Activar el modo individual para Granja Valencia desde ya, o dejarlo
   documentado como diseño aceptado para una fase posterior (dado que la v2
   —sanidad recurrente + insumos— todavía no se aplicó a producción)?
2. ¿Granja Valencia ya identifica físicamente a sus reproductoras/reproductores
   (aretes, collares, algún código propio) hoy en la práctica, o sería un
   proceso nuevo a introducir junto con esta funcionalidad? Esto afecta si
   hace falta un flujo de "alta retroactiva" de los animales ya existentes.
3. ¿`PECUARIO_TRATAMIENTOS` (tratamientos veterinarios puntuales) se separa de
   `PECUARIO_CONTROL_SANITARIO` (desinfección recurrente) como se propone
   arriba, o preferís fusionarlos en una sola tabla con un campo que
   distinga "recurrente" de "puntual"? Se propone separarlos porque tienen
   forma y frecuencia muy distintas, pero es una decisión de producto, no
   solo técnica.

Ninguna de estas tres bloquea seguir avanzando con la v2 ya escrita
(`20260911090000_pecuario_sanidad_insumos.sql`, todavía sin aplicar) — son
independientes y esta v3 se construye encima, no en paralelo.

## Decisiones tomadas (2026-09-11) y estado de esta v3

1. **Secuencia:** se aplican v2 y v3 juntas, en ese orden, en la misma
   sesión de trabajo con Claude Code CLI. La migración de esta v3
   (`supabase/migrations/20260911140000_pecuario_identificacion_individual.sql`)
   incluye un preflight (`DO $$ ... RAISE EXCEPTION`) que corta la ejecución
   si `PECUARIO_GALPONES`/`PECUARIO_INSUMOS`/`PECUARIO_JAULAS` no existen
   todavía, para no dejar la base a medio camino si se corre fuera de orden.
2. **Alta de reproductores:** Granja Valencia no identifica físicamente a
   sus reproductoras/reproductores hoy — es un proceso nuevo. **No hace
   falta ningún flujo de carga retroactiva/masiva**; cada animal se da de
   alta por primera vez a través de la app cuando se le pone su arete físico
   (mismo momento en que se genera y se pega la etiqueta QR).
3. **Tratamientos vs sanidad recurrente:** confirmado separar
   `PECUARIO_TRATAMIENTOS` (veterinario puntual, alcance
   galpón/lote/individual) de `PECUARIO_CONTROL_SANITARIO` (desinfección
   recurrente, v2, siempre a nivel de organización). Implementado así en la
   migración.

**Migración escrita, no aplicada todavía.** Falta, en este orden:
`20260911090000_pecuario_sanidad_insumos.sql` (v2) y luego
`20260911140000_pecuario_identificacion_individual.sql` (v3), ambas contra
la instancia real `jhtocgxlozfuzullrtol`, en Supabase Studio o vía Claude
Code CLI. El contrato de datos (`lib/validations/pecuario.ts`) ya incluye
`ReproductorSchema`, `HistorialMachoSchema` y `TratamientoSchema`, más las
extensiones de `PartoRegistroSchema` (`macho_id`), `MortalidadRegistroSchema`
y `VentaRegistroSchema` (ambas con `.refine()` replicando el `CHECK`
correspondiente de la base, para dar feedback inmediato en el formulario
antes de intentar guardar).

## Actualización 2026-09-11 — v2 y v3 aplicadas y verificadas en vivo

Confirmado por Claude Code CLI: **v2 y v3 quedaron aplicadas contra la
instancia real** (corridas manualmente por el usuario en Supabase Studio,
en ese orden). Detalle relevante para no repetir el mismo problema en
futuros módulos:

- El archivo `20260911090000_pecuario_sanidad_insumos.sql` (v2) nunca
  llegó a existir en el repositorio ni en su historial de git — se había
  redactado en esta sesión de Cowork pero recién se le envió al usuario
  como archivo descargable después de que ya lo había corrido en Studio.
  CLI, al no encontrarlo en el repo, asumió correctamente que no estaba
  aplicado y preguntó — el usuario corrigió con la información real
  ("ya lo corrí"), y CLI verificó en vivo en vez de confiar ciegamente en
  ninguna de las dos versiones, confirmando que sí estaba aplicado.
  **Lección de proceso:** todo archivo redactado en una sesión de Cowork
  necesita entregarse explícitamente (como archivo descargable) antes de
  asumir que "ya está en el repo" — no hay sincronización automática entre
  esta sesión y el repositorio real. CLI reconstruyó el archivo columna por
  columna contra el esquema real vía PostgREST OpenAPI (no lo adivinó) y lo
  dejó commiteado, etiquetado como reconstrucción.
- 16 tests nuevos (`tests/test_pecuario_sanidad_identificacion.py`) corridos
  contra la base real, 16/16 pasando — incluye verificación explícita de que
  los triggers `fn_dar_baja_animal_por_mortalidad`/`fn_dar_baja_animal_por_venta`
  quedaron correctos (a diferencia del bug real detectado en el bot "Auto-Baja
  Mortalidad" del app donante AppSheet), del trigger de cierre automático de
  `PECUARIO_HISTORIAL_MACHOS`, del descuento de stock por tratamiento, y de
  los tres `CHECK` de "individual XOR poblacional".
- `npm run build`/`dev`/lint limpios. Dos commits a `staging`: `e82bfee`
  (reconstrucción de v2) y `9df932e` (confirmación de v3 + tests + docs).
  `docs/ESTADO_PROYECTO.md` rotado (hitos 09-05 a 09-08 movidos a
  `docs/archive/ESTADO_HISTORICO.md`, regla de economía de tokens de
  `CLAUDE.md`).
- `lib/validations/pecuario.ts` no necesitó cambios — ya coincidía
  exactamente con el esquema real verificado.

**Backend de la v3 (identificación individual) queda cerrado y confirmado
en producción.** Siguiente paso natural: extender el prototipo de pantallas
(`app_mockup_granja_valencia.html`) con la ficha de reproductor individual
(alta con arete/QR, registrar parto/venta/muerte desde la ficha del animal) —
recién ahora tiene sentido, con el esquema real ya confirmado en vivo en vez
de en diseño.

### Pendiente real (no se pudo verificar desde esta sesión)

Igual criterio que en v1/v2 — antes de correr esta migración contra la
instancia real, confirmar contra el esquema en vivo
(`docs/schema_live_pecuario.md` si ya está al día, o consulta directa a
`information_schema.columns`) que ninguna de las columnas nuevas
(`PECUARIO_PARTOS.macho_id`, `PECUARIO_VENTAS.animal_id`,
`PECUARIO_MORTALIDAD.animal_id` pasando de reservada a FK real) choca con
algo agregado a esas tablas por fuera de esta conversación desde el
2026-09-11.

## Actualización 2026-09-11 (tarde) — ajustes de campo v4

Tres correcciones pedidas por el usuario tras revisar el mockup y comparar
contra la app AppSheet original. Las tres implican cambios sobre esquema
**ya aplicado en producción** (v1 `PECUARIO_VENTAS`, v2 `PECUARIO_INSUMOS`),
no solo maquetación — se manejan con una migración nueva (v4:
`20260911180000_pecuario_ventas_insumos_ajustes.sql`), nunca alterando las
migraciones v1/v2/v3 ya corridas.

### 1. "Escanear arete" no existe en la realidad

El arete físico trae un código impreso (de fábrica o asignado por la
granja), no una etiqueta QR — no hay nada que escanear con la cámara. El
mockup simulaba erróneamente un escaneo QR para identificar reproductores
(Parto/Mortalidad/Venta) y también sugería, en Alta de reproductor, que
el código "se imprime como etiqueta QR para pegar en el arete". Corregido:

- Los tres selectores de reproductor (Parto, Mortalidad, Venta) ahora
  llevan un campo de texto para digitar el código, que filtra la lista de
  chips en vivo — el chip-row queda como acceso rápido a los animales más
  recientes/frecuentes, no como resultado de un escaneo.
- El buscador del directorio de Reproductores pierde su botón "Escanear"
  redundante (ya tenía un input de búsqueda por código).
- Alta de reproductor: el botón pasa de "Generar" (con el mensaje "se
  imprime como QR") a "Sugerir" (asigna un correlativo propio editable) —
  y el hint aclara que lo normal es transcribir el código que el arete ya
  trae impreso.
- Lectura por **chip NFC** queda anotada en el hint de los tres selectores
  como posible fase futura (tecnología distinta a QR) — no se construye
  nada todavía, solo se deja constancia para no perder la idea.
- Esto es 100% mockup/UX — no toca `PECUARIO_REPRODUCTORES.codigo_arete`
  (ya es texto libre) ni requiere migración.
- El escaneo de **QR sí sigue vigente** para identificar ubicaciones físicas
  (poza, jaula, lote) — esa es una etiqueta que la granja imprime y pega
  ella misma en la estructura, no en el animal. No se tocó ese flujo.

### 2. Venta: por animal, no por peso

`PECUARIO_VENTAS` (v1) no tenía `precio_unitario` — solo `cantidad`,
`peso_total_kg` (nullable) y `precio_total` (NOT NULL). El mockup pedía
"Peso total (kg)" como si fuera la base del precio, cuando la
comercialización real es por cantidad de animales.

**Decisión:** agregar `precio_unitario NUMERIC(10,2)` (nullable — sin
backfill retroactivo, mismo criterio que v2/v3) y un trigger
(`fn_calcular_precio_total_venta`) que recalcula `precio_total = cantidad *
precio_unitario` cada vez que `precio_unitario` viene informado, para que
nunca queden desincronizados. Si el técnico no informa `precio_unitario`
(ej. un lote con un total pactado a ojo con el comprador), `precio_total`
se respeta tal cual se envía — no se vuelve obligatorio el precio unitario,
solo se habilita.

`peso_total_kg` se conserva pero pasa a dato referencial opcional (ej.
conversión alimenticia, o una venta de guano donde sí aplica peso) — deja
de ser protagonista del formulario.

Mockup: Venta ahora pide Cantidad → Precio individual → Precio total
(autocalculado, editable), con Peso total como campo secundario al final.
En modo "Reproductor identificado", Cantidad queda oculta y fija en 1 (ya
no solo como texto de ayuda: el stepper se bloquea en 1 de verdad).

**Nota fuera de alcance, no resuelta ahora:** `tipo_salida = 'guano'`
comparte la misma tabla y su "cantidad" no es realmente "cantidad de
animales" — es una inconsistencia de diseño heredada de v1 que no se pidió
corregir y no se tocó en esta pasada, para no ampliar el alcance sin pedido
explícito.

### 3. Insumos: reconciliación con el diseño de AppSheet

El AppSheet original usaba Tipo (Alimento / Medicamento / Vitamina /
Material) y Unidad (Kg / Litro / Unidad / Saco 50kg / Saco 40kg) como
pickers fijos, más un campo "Stock Actual" editado a mano. Lo ya aplicado
en v2 (`categoria_insumo`: alimento/sanitario/cama/equipo/otro; texto libre
para unidad; stock siempre calculado por vista sobre
`PECUARIO_INSUMOS_MOVIMIENTOS`) no distinguía medicamento de vitamina y no
tenía picker fijo de unidad.

**Qué se rescata del AppSheet:** la idea de picker fijo para ambos campos
(evita variantes como "kg"/"Kg"/"kilogramos" entre técnicos y
dispositivos), y la distinción Medicamento vs. Vitamina (importa para
reportes de costo y porque ambos se descuentan de stock vía
`fn_descontar_insumo_tratamiento` al registrar un tratamiento — antes
quedaban mezclados bajo "sanitario").

**Qué NO se rescata:** el campo "Stock Actual" editado a mano. Es
exactamente el problema que v2 vino a resolver — un valor manual se
desactualiza en cuanto alguien olvida tocarlo, mientras que el saldo
calculado por vista nunca puede divergir de los movimientos reales. La
manera más probable de que AppSheet lo haya resuelto así es una limitación
de la herramienta (no soporta vistas/rollups como Postgres), no una
decisión de negocio a preservar.

**Diseño final (`categoria_insumo`, vía `ALTER TYPE`):** alimento,
medicamento, vitamina, sanitario, material, equipo, otro. Se agregan
`medicamento` y `vitamina`; `cama` se renombra a `material` (cubre
viruta/cama y otros consumibles generales). `sanitario` se conserva
aparte de `medicamento` porque cubre desinfectantes/limpieza de
instalaciones — no se administran al animal, así que mezclarlos con
medicamentos habría sido incorrecto para reportes de costo sanitario vs.
costo de limpieza.

**Diseño final (unidad, nuevo enum `unidad_medida_insumo`):** kg, g,
litro, ml, unidad, saco_50kg, saco_40kg — el set de AppSheet más `g`/`ml`,
porque medicamentos y vitaminas suelen dosificarse en cantidades chicas.

**Solución de compromiso para "cuánto tengo hoy":** en vez de un campo de
stock editable, la pantalla de alta de insumo pide "Stock actual (opcional)"
solo como conveniencia de UI — al guardar, la Server Action crea el
insumo y además un primer movimiento de tipo `entrada` por esa cantidad en
`PECUARIO_INSUMOS_MOVIMIENTOS`. De ahí en adelante el stock se sigue
viendo únicamente por `vw_pecuario_insumos_stock`, nunca editable a mano.
Esto da la misma experiencia que pedía el AppSheet original ("escribo
cuánto tengo") sin reintroducir el problema de un valor que se desincroniza.

Cambios aplicados:
- Migración `supabase/migrations/20260911180000_pecuario_ventas_insumos_ajustes.sql`
  (idempotente, con guardas para no fallar si se corre dos veces; incluye
  consultas de verificación al final para correr a mano en Studio).
- `lib/validations/pecuario.ts`: `VentaRegistroSchema` gana `precio_unitario`
  y un refine que exige cantidad = 1 cuando hay `animal_id`;
  `InsumoSchema` actualiza `categoria` y `unidad_medida` a los enums
  nuevos y agrega `stock_inicial` (campo solo-UI, no persiste tal cual —
  ver comentario en el archivo).
- `app_mockup_granja_valencia.html`: Parto/Mortalidad/Venta con digitación
  manual de código de arete en vez de "Escanear arete"; Venta rediseñada
  (Cantidad → Precio individual → Precio total autocalculado → Peso
  referencial); Insumos gana una pestaña "Nuevo insumo" con los pickers de
  Tipo/Unidad reconciliados y el campo "Stock actual (opcional)".
  Publicado como Artifact, versión 6.

### Pendiente real (v4)

Antes de correr `20260911180000_pecuario_ventas_insumos_ajustes.sql`
contra la instancia real: confirmar contra el esquema en vivo que
`PECUARIO_INSUMOS` no tiene ya filas con `unidad_medida` en un formato que
el `CASE` de la migración no contempla (revisar `SELECT DISTINCT
unidad_medida FROM "PECUARIO_INSUMOS"` antes de correrla) — si aparece
algo fuera de lo mapeado, hoy cae a `'unidad'` por defecto, lo cual puede
no ser correcto y conviene revisar a mano antes de aplicar.
