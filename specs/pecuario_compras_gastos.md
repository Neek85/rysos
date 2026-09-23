# Spec — Compras / gastos de la granja, separados del kardex de Insumos (Pecuario Cuyes)

**Estado: validado en el simulador (mockup), NO construido todavía.** No hay
migración ni cambio de esquema para esta spec — se documenta acá para no
perder la decisión tomada mientras se valida con Neyser y con los técnicos
de Granja Valencia, antes de pasar a diseñar/aplicar nada contra la base
real.

## 1. Contexto

Pregunta de Neyser: ¿dónde se registra hoy la compra de productos/insumos?
Hoy no existe una pantalla de "Compras" — se registraba como un movimiento
de tipo "Entrada" dentro de Insumos, que es puramente un kardex de stock
(cuánto entró), sin precio pagado ni proveedor.

## 2. Decisión tomada (confirmada por Neyser, 2026-09-13)

Se crea una sección nueva, **"Compras"**, separada de Insumos, para
registrar **cualquier gasto de la granja** — no solo insumos con stock:

- Combustible, mantenimiento y reparaciones, servicios veterinarios o
  técnicos, mano de obra externa, etc. — gastos que **no** tienen un
  insumo de stock al cual amarrarse.
- Compras de insumos (alimento, medicamentos, materiales) — estas **sí**
  deben seguir generando el movimiento de Entrada correspondiente en
  Insumos, para no duplicar el registro ni desincronizar el stock.

**Por qué separado de Insumos (razonamiento arquitectónico):** mezclar
kardex (cantidad que entra) con gasto (cuánto costó y a quién se le pagó)
en la misma pantalla tiene el mismo problema ya resuelto para
Guano/Animales en la venta (`pecuario_venta_subproductos_guano.md`):
- No toda Entrada de stock es una compra (puede ser una donación, una
  corrección, un traslado entre galpones) — obligarla a llevar
  precio/proveedor ensucia el kardex.
- No todo gasto de la granja tiene un insumo de stock asociado — un picker
  de insumo obligatorio dejaría fuera combustible, reparaciones, servicios.

## 3. Diseño reflejado en el simulador, versión 20

Nuevo tile **"Compras"** en la grilla de Registrar (junto a Insumos), con
pantalla `data-screen="compras"`:

- **Fecha**, **Proveedor (opcional)**.
- **Concepto**: *Insumo (con stock)* / *Servicio u otro gasto*.
  - **Insumo (con stock):** Insumo (picker, mismo catálogo que Insumos),
    Cantidad, Galpón de destino. Hint explícito: "esto genera
    automáticamente el movimiento de Entrada en Insumos — no hace falta
    registrarlo dos veces."
  - **Servicio u otro gasto:** Categoría del gasto (Combustible /
    Mantenimiento y reparaciones / Servicio veterinario-técnico / Mano de
    obra / Otro) + Descripción libre. Sin insumo, sin cantidad, sin
    galpón.
- **N° de comprobante (opcional)** — boleta/factura, texto libre por
  ahora.

## 3.1. Catálogo de insumos de solo lectura para el técnico — confirmado 2026-09-13

Pregunta/aclaración de Neyser sobre el picker de "Insumo" (usado en Insumos
→ Registrar movimiento, y ahora también en Compras → Insumo (con stock)):
**el listado de insumos debe manejarse como una tabla aparte en la base de
datos, de solo lectura para el técnico** — nadie más que el rol admin
puede escribir/crear un nombre de insumo nuevo. Objetivo explícito:
mantener la información limpia y coherente (evitar que un mismo insumo
quede registrado con nombres distintos según qué técnico lo escribió, ej.
"Alfalfa" / "alfalfa" / "Afalfa").

Esto ya era parcialmente cierto en el esquema (`PECUARIO_INSUMOS` como
tabla maestra, `PECUARIO_INSUMOS_MOVIMIENTOS` sin campo de texto libre para
el nombre) pero **no estaba explícito como regla de acceso por rol**, y el
picker de insumo en el simulador todavía usaba chips con una lista
hardcodeada en vez de reflejar que se lee de una tabla real.

**Decisión:**
- El picker de "Insumo" (en ambas pantallas) se llena leyendo el catálogo
  — nunca es un campo de texto libre para el técnico.
- Crear un insumo nuevo ("Nuevo insumo" en la pantalla de Insumos) es una
  acción **exclusiva del rol admin**. Un técnico de campo no ve o no puede
  usar esa opción en la app real.

**Reflejado en el simulador, versión 21:**
- El picker de "Insumo" pasó de chips a un `<select>` (`insumoMovSelect`
  en Insumos, `insumoCompraSelect` en Compras), ambos poblados desde un
  mismo arreglo `INSUMOS_CATALOGO` en el código — simula que los dos
  pickers leen la misma tabla en vez de mantener listas independientes que
  podrían desincronizarse.
- El panel "Nuevo insumo" ahora tiene un aviso explícito: "🔒 Solo el rol
  admin puede crear insumos nuevos en el catálogo — evita que cada técnico
  escriba el mismo insumo distinto (...) y mantiene la información limpia
  para toda la organización." El simulador no oculta el panel (todavía no
  simula login por rol, solo por sistema de cría/identificación
  individual), pero el aviso deja clara la regla de negocio para la ronda
  de validación con los técnicos.

## 3.2. Costo de flete/transporte del insumo — agregado 2026-09-13

Observación de Neyser: faltaba el costo del flete/transporte de traer el
insumo hasta la granja, que muchas veces el proveedor cobra aparte del
precio del producto.

**Decisión:** dentro del panel "Insumo (con stock)" de Compras, el costo
se separa en dos campos en vez de un solo "Monto total":
- **Costo del insumo (S/)** — precio del producto en sí.
- **Flete / transporte (S/) — opcional** — costo de traerlo hasta la
  granja, cuando aplica.
- **Costo total de esta compra (S/)** — calculado solo (costo + flete),
  no editable a mano.

Separar ambos campos (en vez de sumarlos de una vez en un solo total)
permite más adelante reportar cuánto se gasta en logística vs. en el
insumo mismo, sin perder ese detalle. El panel "Servicio u otro gasto"
mantiene un único campo "Monto total (S/)" — el concepto de flete no
aplica ahí de la misma forma (un servicio ya es un monto acordado único).

**Reflejado en el simulador, versión 21.**

## 3.3. Auditoría de Insumos/Stock — versión 36, 2026-09-21

Quinta ronda de la auditoría "registro por registro" pedida por Neyser
(población → Pesaje/Alimentación → Reproductores → KPIs sueltos → esta).
Este hallazgo ya había quedado señalado, sin corregir, al cerrar la ronda
de Pesaje/Alimentación (`pecuario_panel_indicadores.md` §2.5): a
diferencia de Lotes/Reproductores, acá **no existía ningún registro de
stock detrás** — `INSUMOS_CATALOGO` era solo un arreglo de nombres, sin
movimientos, y tanto "Guardar movimiento" (Insumos) como "Guardar
insumo" (alta de insumo) como la compra de un insumo (esta pantalla)
solo mostraban el toast de guardado, sin tocar ningún dato. El stock que
se veía arriba de Insumos (340 kg de Alfalfa, etc.) era un número fijo.

**Corregido — se construyó el modelo real que faltaba:**
- `INSUMOS_CATALOGO` pasó de arreglo de nombres a objeto: cada insumo
  guarda `tipo`, `unidad` y `stockMinimo`.
- `INSUMOS_MOVIMIENTOS`: única fuente del stock — un movimiento por cada
  Entrada/Salida, con insumo, cantidad, galpón, poza/lote opcional y
  fecha. El stock de cada insumo se calcula sumando Entradas y restando
  Salidas (`calcularStockInsumo()`), **nunca se guarda como un número
  aparte que se pueda desincronizar** — esto ya lo pedía el propio texto
  de ayuda de "Nuevo insumo" en el simulador, pero no estaba implementado
  así.
- "Guardar insumo" (`guardarInsumo()`) ahora sí agrega la entrada al
  catálogo, y si se cargó un "stock actual" al momento de la alta, lo
  registra como el primer movimiento de Entrada (tal como decía el hint).
- "Guardar movimiento" (`guardarMovimientoInsumo()`) ahora sí registra el
  movimiento y recalcula el stock. Si el movimiento deja el stock en
  negativo, se avisa con un mensaje (⚠) pero **no se bloquea el guardado**
  — mismo criterio ya usado en el resto de RYZOS para no romper la
  escritura offline por un número que puede estar desactualizado (ver la
  cita de `fn_son_parientes()` en `pecuario_alerta_consanguinidad_empadre.md`
  §2: la app avisa, no bloquea duro).
- La compra de un insumo (`guardarCompra()`, esta misma pantalla) ahora sí
  empuja el movimiento de Entrada real a `INSUMOS_MOVIMIENTOS` — cumple
  lo que la §2 de esta spec ya pedía ("estas sí deben seguir generando el
  movimiento de Entrada"), que hasta esta ronda solo pasaba en el texto
  del toast, no en los datos.
- **Conexión con el FCR de Pesaje/Alimentación (nueva, ver
  `pecuario_panel_indicadores.md` §2.5):** si una Salida de un insumo tipo
  Alimento se detalla contra un lote específico ("Detallar por poza/lote"
  en Insumos), esa cantidad (convertida a kg) se suma también al
  `alimentoRegistros` de ese lote — el mismo historial que usa el cálculo
  de FCR. Antes de esta ronda existían dos formas separadas de anotar
  alimento de un lote (el registro rápido de la ficha de lote, y el
  detalle por poza/lote de Insumos) que nunca se hablaban entre sí; un
  técnico que usara una y no la otra tendría un FCR incompleto sin
  saberlo.
- **Alertas de stock bajo, integradas a la lista general de Alertas de
  Inicio** (antes solo se veían como una tarjeta roja dentro de la
  pantalla de Insumos — si el técnico no entraba ahí, no se enteraba).
- **De paso:** el galpón ofrecido en "Registrar movimiento" y en esta
  misma pantalla de Compras era "Galpón 1"/"Galpón 2" fijos — nombres que
  no existen en ningún otro lado del simulador (`POZAS` usa "Galpón A"/
  "Galpón B"). Se corrigió para derivar los galpones reales desde `POZAS`
  en vez de tener una tercera lista de galpones por su cuenta. También se
  corrigió el chip de "Poza o lote" del detalle de Insumos, que ofrecía
  un lote ("L-2026-011") que no existe.

**Verificado** con `node --check` sobre el archivo completo y con un
script Node que ejecuta las funciones reales extraídas del archivo (no
una reimplementación): el stock inicial reproduce los mismos valores que
ya se mostraban (340 kg / 3 L / 18 sacos), el desinfectante aparece bajo
el mínimo desde el arranque (3 < 5), una entrada y una salida grandes
mueven el stock y la lista de "bajo mínimo" correctamente, y la
conversión de unidades a kg (Kg/g/Saco 50kg/Saco 40kg) da los valores
esperados, con Litro/ml/Unidad correctamente excluidos de la conversión
(no son alimento por peso).

## 4. Lo que falta construir (cuando se decida pasar de mockup a backend)

**Migración y contrato Zod redactados 2026-09-22, NO aplicados todavía
contra la base real:**
`supabase/migrations/20260922110000_pecuario_compras_gastos.sql`
(`PECUARIO_COMPRAS`, trigger `fn_compra_genera_entrada_insumo`, RLS) +
`CompraSchema` en `lib/validators/pecuario.ts`. Decisiones tomadas al
redactar (no estaban explícitas antes):

- El nombre final es `PECUARIO_COMPRAS` (no `GASTOS`).
- `monto_total` es una columna **generada** (`GENERATED ALWAYS ... STORED`,
  mismo patrón que `PECUARIO_PESAJES.peso_promedio_g`), no un trigger —
  costo_insumo + flete para la rama insumo, `monto_servicio` directo para
  la rama servicio_otro. Nunca se escribe a mano ni puede desincronizarse.
- **Gap de granularidad documentado, no resuelto en esta migración:**
  `PECUARIO_COMPRAS` guarda `galpon_id` (destino a nivel de galpón), pero
  `PECUARIO_INSUMOS_MOVIMIENTOS` solo tiene `poza_id`/`lote_id` (no
  `galpon_id`) — el movimiento que el trigger genera automáticamente
  queda sin ese dato (`poza_id`/`lote_id` en NULL). No se amplió el
  esquema de Movimientos para resolver esto ahora; es información que
  hoy simplemente no viaja de una tabla a la otra.
- Sigue exactamente igual de pendiente lo de la Sección 5 (offline,
  restricción de alta de insumo por rol) — ver ahí.

Diseño original de esta sección, ya reflejado en la migración de arriba:

- Tabla nueva `PECUARIO_COMPRAS` (o `GASTOS`, a definir el nombre): id,
  organizacion_id, fecha, proveedor (opcional), concepto ENUM
  (`insumo` | `servicio_otro`), categoria_gasto (solo cuando concepto =
  servicio_otro; reutilizar o extender un enum), descripcion (solo
  servicio_otro), insumo_id + cantidad + galpon_id + costo_insumo +
  flete (solo cuando concepto = insumo, `flete` opcional/nullable),
  monto_total (para concepto = servicio_otro, o calculado como
  costo_insumo + flete cuando concepto = insumo — a decidir si se
  almacena el total ya calculado o se deja como columna generada),
  comprobante (opcional), device_id + offline (si esta pantalla también
  se usa desde la app de campo, a confirmar — hoy el mockup no distingue,
  se está validando primero en el flujo web/general).
- Trigger `fn_compra_genera_entrada_insumo()`: AFTER INSERT en
  `PECUARIO_COMPRAS` cuando `concepto = 'insumo'`, inserta el movimiento de
  tipo `entrada` correspondiente en `PECUARIO_INSUMOS_MOVIMIENTOS` — un
  solo punto de entrada para el técnico, dos tablas actualizadas
  correctamente (mismo patrón que `fn_descontar_insumo_tratamiento` ya
  documentado en `pecuario_identificacion_individual.md`).
- `PECUARIO_INSUMOS_MOVIMIENTOS` sigue sin columna de costo — el costo
  vive solo en `PECUARIO_COMPRAS`, evitando duplicar el dato en dos
  tablas; el kardex de Insumos sigue siendo puramente de cantidades.
- **RLS de `PECUARIO_INSUMOS` (alta de insumo nuevo):** política de
  `INSERT` restringida al rol `admin` — hoy la web no tiene sesión de
  Supabase Auth real (usa la llave `anon`, ver `CLAUDE.md`), así que
  mientras eso siga así la restricción real debe aplicarse en la Server
  Action correspondiente (`lib/actions/`), no solo confiar en una política
  RLS que hoy no se ejecuta contra el tráfico real del frontend web. Para
  las apps móviles nuevas (donde sí habrá auth DNI+PIN / usuario interno
  con rol), la política RLS por rol sí aplica de lleno.
- Contrato Zod: cuando `concepto = 'insumo'`, `insumo_id`/`cantidad`/
  `galpon_id`/`costo_insumo` obligatorios, `flete` opcional (default 0);
  cuando `concepto = 'servicio_otro'`, `categoria_gasto`/`descripcion`/
  `monto_total` obligatorios.
- Reporte de gastos por categoría, y de flete acumulado vs. costo de
  insumo (probable pieza futura del Panel de indicadores) — no se diseña
  todavía, queda anotado como posible próximo paso una vez que haya datos
  reales de Compras.

## 5. Pendiente

- Confirmar si esta pantalla se necesita también desde la app de campo
  (offline) o si por ahora alcanza con el flujo del dashboard web/técnico
  en oficina — afecta si `PECUARIO_COMPRAS` necesita `device_id` y
  soporte de `SYNC_QUEUE` desde el día uno.
- Confirmar si "Nuevo insumo" debe directamente ocultarse de la
  navegación para roles no-admin en el simulador (hoy solo lleva un
  aviso de texto) — se dejó así porque el simulador todavía no tiene login
  por rol, solo por sistema de cría/identificación individual; evaluar si
  vale la pena agregar un selector de rol al login del simulador para
  validar esto con más fidelidad antes de construir la app real.
- Cuando se decida construir esto de verdad: escribir la migración, el
  trigger de auto-Entrada, la política RLS de `PECUARIO_INSUMOS` y el
  contrato Zod — siguiendo el mismo flujo de siempre (spec → migración →
  Zod → Claude Code CLI → aplicación manual en Studio).
