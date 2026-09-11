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

**CORRECCIÓN (2026-09-11, Claude Code CLI, verificado en vivo y contra el
repo):** este documento afirmaba que la migración v2
(`20260911090000_pecuario_sanidad_insumos.sql`) estaba "escrita, no
aplicada todavía" — **es falso, el archivo no existe en el repo** (no está
en el working tree, no está en el historial de git, no está en ningún
stash). Solo existen v1 (`20260910160000_pecuario_cuyes_core.sql`,
aplicada y confirmada en vivo) y v3
(`20260911140000_pecuario_identificacion_individual.sql`, escrita, no
aplicada). Confirmado también en vivo contra `jhtocgxlozfuzullrtol`:
`PECUARIO_GALPONES`/`PECUARIO_INSUMOS`/`PECUARIO_INSUMOS_MOVIMIENTOS`/
`PECUARIO_CONTROL_SANITARIO`/`PECUARIO_LIMPIEZA_GALPON` (todas las tablas
que v2 debería crear) no existen — consistente con que la migración nunca
se escribió, no con que se escribió y no se aplicó. El preflight de v3
(sección 0 de esa migración) confirma esta misma dependencia y cortaría
la ejecución si se intentara correr v3 sin v2 primero.

`lib/validations/pecuario.ts` sí incluye el contrato completo de v2
(`ControlSanitarioSchema`, `LimpiezaGalponSchema`, `InsumoSchema`,
`MovimientoInsumoSchema`) además de v3 (`ReproductorSchema`,
`HistorialMachoSchema`, `TratamientoSchema`, más las extensiones de
`PartoRegistroSchema`/`MortalidadRegistroSchema`/`VentaRegistroSchema`) —
el contrato de datos de v2 sí se escribió, solo falta la migración SQL
correspondiente. No se redactó la migración v2 en esta sesión (fuera del
alcance de esta corrección de premisa — ver `docs/ESTADO_PROYECTO.md` para
la decisión de cómo seguir).

### Pendiente real (no se pudo verificar desde esta sesión)

Igual criterio que en v1/v2 — antes de correr esta migración contra la
instancia real, confirmar contra el esquema en vivo
(`docs/schema_live_pecuario.md` si ya está al día, o consulta directa a
`information_schema.columns`) que ninguna de las columnas nuevas
(`PECUARIO_PARTOS.macho_id`, `PECUARIO_VENTAS.animal_id`,
`PECUARIO_MORTALIDAD.animal_id` pasando de reservada a FK real) choca con
algo agregado a esas tablas por fuera de esta conversación desde el
2026-09-11.
