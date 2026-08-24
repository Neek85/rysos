# Bitácora — Refuerzo de la Consola QC (21–23 de agosto de 2026)

*Para cualquiera que quiera entender qué pasó en este tramo de trabajo sin
necesidad de leer código. Cubre desde el commit `0d003e8` hasta el
`a7fd9f6`.*

> **Nota sobre el número de commits:** el pedido original de esta bitácora
> hablaba de "9 commits". Revisando el historial real, el tramo de
> trabajo que cubre todo lo pedido (los bugs de la Consola QC, el panel
> en vivo, la capa de parcelas vecinas, el incidente de datos huérfanos y
> el fix de sincronización de Drive) son en realidad **15 commits**, no
> 9. Se corrige el número acá para que la bitácora quede exacta; el
> listado completo está al final.

> **Actualización (mismo 23 de agosto, más tarde):** se agregaron las
> secciones 6 y 7 (que corrieron el resto del documento un lugar hacia
> abajo), con el trabajo de 3 commits nuevos (`1ec2c2d`, `5c6d4f9`,
> `2ac75d6`) que siguieron directamente después de `f099a75`: el vínculo
> real entre subdivisiones y su parcela madre, la validación de cobertura
> completa, y un bug crítico encontrado y corregido el mismo día. La
> sección 8 ("Qué queda pendiente") y la tabla técnica de la sección 9
> también se actualizaron para reflejar esto.

> **Actualización (mismo 23 de agosto, más tarde todavía):** se agregó la
> sección 8 ("El incidente de las aprobaciones que se revertían solas — y
> dos problemas más que destapó"), que corrió "Qué queda pendiente" y la
> tabla técnica un lugar más hacia abajo (ahora 9 y 10). Cubre 4 commits
> nuevos (`4de126d`, `a611779`, `9ad7aa2`, `6611451`) que siguieron
> directamente después de `2ac75d6`: una pregunta simple sobre polígonos
> duplicados al sincronizar Drive terminó destapando tres problemas reales
> distintos — aprobaciones que se revertían solas sin dejar rastro, una
> tabla de auditoría que existía solo en el papel, y códigos de parcela
> repetidos en lugares físicamente distintos.

> **Actualización (mismo 23 de agosto, cierre de la sesión):** se agregó
> la sección 9 ("El error que apuntaba a la causa equivocada, y un repaso
> del padrón de socios"), que corrió "Qué queda pendiente" y la tabla
> técnica un lugar más hacia abajo (ahora 10 y 11). Cubre 3 commits nuevos
> (`5ad2aa3`, `e938d0d`, `a7fd9f6`) que siguieron directamente después de
> `79a2e30`: un mensaje de conflicto de código de parcela reescrito en
> lenguaje simple, un bug real (sin relación con lo que el propio mensaje
> de error decía) que impedía aprobar registros de Instalaciones, y un
> repaso completo de cómo funciona hoy la baja de socios y qué haría falta
> para transferir una parcela entre organizaciones.

---

## 1. Qué problemas reales se encontraron y corrigieron en la Consola QC

La Consola QC (`/dashboard/qc`) es la pantalla donde un revisor aprueba o
rechaza los monitoreos que suben los técnicos de campo, y donde puede
corregir la geometría (el polígono dibujado en el mapa) si hace falta.
En este tramo de trabajo aparecieron tres problemas reales de uso:

**a) Dos herramientas de dibujo se pisaban entre sí.** La consola tiene
dos formas de editar geometría: "dibujar un registro nuevo" y "ajustar
la geometría de un registro ya existente". Estaban pensadas para
excluirse mutuamente (una bloquea a la otra mientras está activa), pero
en la práctica un revisor podía dejar un registro existente en modo
"Editando…" y, sin salir de ahí, arrancar a dibujar un polígono nuevo
por encima — dejando la pantalla en un estado confuso, con dos ediciones
superpuestas. Se corrigió para que ambas herramientas se bloqueen entre
sí de verdad, en las dos direcciones: editar bloquea dibujar, y dibujar
bloquea editar. En el camino apareció un bug relacionado (una función de
Leaflet mal usada) que dejaba el editor de mapa completamente roto —
también se corrigió.

**b) Un popup mostraba el nombre técnico de la tabla en vez de algo
legible.** Al seleccionar un registro de "Instalaciones" en el mapa,
aparecía literalmente el texto `EUDR_INSTALACIONES` sobre el mapa — un
nombre de tabla de base de datos, no algo pensado para que lo vea una
persona. Se sacó ese popup (el panel lateral ya mostraba la misma
información con un nombre legible, así que no hacía falta reemplazarlo
por otra cosa).

**c) El "% Solapado" no se podía verificar a simple vista.** Cuando la
consola marcaba un registro como "Solapado 40%" (es decir, su polígono
se superpone con otro ya aprobado), no había forma de ver EN EL MAPA
cuál era ese otro polígono — el revisor tenía que confiar en el número a
ciegas. Se agregó una segunda capa en el mapa (línea punteada ámbar) que
dibuja exactamente los polígonos con los que se está solapando, para que
el revisor pueda verlo con sus propios ojos antes de decidir.

---

## 2. Qué mejoras nuevas se agregaron

**a) Panel de información en vivo mientras se dibuja.** Antes, para
saber el área o el perímetro de un polígono que se estaba dibujando,
había que terminar de dibujarlo y guardarlo. Ahora hay un panel que
muestra área, perímetro y si la forma es válida **mientras se está
dibujando**, actualizado en tiempo real. Se verificó con cuidado que el
número que muestra ese panel (calculado en el navegador) coincide con el
número real que después calcula el servidor — coinciden, con la
salvedad de que usan dos fórmulas matemáticas ligeramente distintas para
medir superficies sobre un globo (una aproxima la Tierra como una
esfera, la otra usa la forma real, algo ovalada) — la diferencia es
mínima (menos de medio por ciento) pero se agregó un margen de seguridad
para que, en un polígono al filo de las 4 hectáreas (el umbral legal
EUDR), el panel del navegador nunca deje de avisar cuando el servidor sí
lo haría.

**b) Capa de "parcelas vecinas" como contexto.** Se agregó una tercera
capa en el mapa, puramente informativa: mientras un revisor dibuja o
ajusta un polígono, la consola muestra (en gris, para no confundirla con
una alerta real) qué otros monitoreos aprobados hay cerca, dentro de un
radio de 500 metros por defecto. No implica ningún conflicto — es solo
"esto es lo que hay alrededor". El radio se puede configurar por
organización, aunque hoy no hay una pantalla para hacerlo (se deja
apuntado como tarea pendiente si hiciera falta).

**c) El sistema dejó de confundir "tu propia parcela" con "un
conflicto".** Este fue el cambio más delicado del tramo — se explica en
detalle abajo, en el punto 4, porque está ligado al mismo incidente de
datos de prueba.

---

## 3. El sistema de solapamiento: de un falso positivo a un cálculo confiable

Una parcela real en RYZOS tiene un perímetro general (el "Monitoreo") y,
adentro, subdivisiones por tipo de uso de la tierra ("Uso de Suelo" —
por ejemplo, una parte en producción de café, otra en pasto). Es
completamente normal que esas subdivisiones estén DENTRO del perímetro
general — no es un conflicto, es la estructura esperada.

El sistema, sin embargo, no distinguía eso: si una subdivisión estaba
contenida en el perímetro de su propia parcela, la marcaba igual como
"Solapado 100%", como si fuera una invasión de terreno ajeno. Se
confirmó con un caso real: una subdivisión de 0.95 hectáreas, totalmente
adentro de su propio perímetro, aparecía con la alerta amarilla de
conflicto.

Corregirlo resultó más difícil de lo esperado, porque **no existe hoy
ninguna forma directa de saber, en la base de datos, a qué perímetro
"pertenece" cada subdivisión** — el dato que debería vincularlos (un
identificador interno del sistema de captura de campo, QField) se pierde
durante el proceso de carga de datos y nunca queda guardado. Se decidió,
como solución provisoria, usar la ubicación real en el mapa: si una
subdivisión está **completamente adentro** de un único perímetro
aprobado (y de uno solo — si hay ambigüedad, por ejemplo dos parcelas
vecinas que se superponen entre sí, el sistema NO asume nada y sigue
mostrando la alerta), se considera que es su propia parcela y deja de
contar como conflicto.

Al probarlo contra casos reales apareció un matiz importante: exigir que
la subdivisión esté contenida "al 100% exacto" casi nunca se cumplía en
la práctica, porque el perímetro y la subdivisión se capturan por
separado en el campo, cada uno con su propio GPS de mano, y ese margen
de error entre dos capturas hace que casi nunca calcen matemáticamente
perfecto (se encontró un caso real al 99.64% de contención). Se ajustó
el criterio a un margen razonable (98% de contención, en vez de 100%
exacto) — manteniendo intacta la regla de "si hay ambigüedad, no asumas
nada", que se volvió a verificar con casos de prueba después del ajuste.

Este arreglo NO cambia dos cosas importantes: si dos subdivisiones de
una misma parcela se superponen entre sí (posible doble registro de la
misma tierra con dos usos), eso SIGUE marcándose como conflicto. Y
cualquier superposición contra una parcela distinta (posible invasión de
terreno de otro productor) también SIGUE marcándose — este cambio solo
afecta el caso específico de "mi propia subdivisión, dentro de mi propio
perímetro".

Es, deliberadamente, una solución **provisoria** basada en la ubicación
en el mapa, no una relación real y confiable de datos — antes de avanzar
a una etapa futura más exigente (donde el sistema sumaría áreas y podría
llegar a bloquear una aprobación automáticamente), hace falta resolver
el vínculo real entre parcela y subdivisión de una forma más sólida que
"mirar dónde cae en el mapa".

---

## 4. El incidente de los datos huérfanos

Durante este tramo se descubrió que había datos de prueba reales
mezclados en la base de datos de producción, usando un nombre de
organización — `ORG-COOP-NORTE` — que **no correspondía a ningún
cliente real**. Concretamente: 14 registros (monitoreos, subdivisiones e
instalaciones) que un script de pruebas automáticas había ido dejando en
la base cada vez que se corría, sin limpiarlos después.

**Qué se decidió:** antes de borrar nada, se auditó **todo** el sistema
para confirmar que este era el único caso de este tipo (no había otros
"huérfanos" escondidos en otras tablas) — se confirmó que sí, era el
único caso. Recién con esa confirmación, y con aprobación explícita, se
borraron los 14 registros de prueba.

**Qué protección se agregó para que no vuelva a pasar:**

1. **Una etiqueta nueva en la base de datos** que marca explícitamente
   qué organizaciones son de prueba y cuáles son reales — por defecto,
   cualquier organización sin marcar se trata como **real**, para que el
   error, si alguna vez ocurre, sea "tratar algo de prueba como real"
   (inofensivo) y nunca al revés.
2. **El script de pruebas automáticas ahora se niega a correr** si la
   organización contra la que va a escribir no está marcada
   explícitamente como "de prueba" — en vez de escribir datos de prueba
   en cualquier lado por error, aborta sin escribir nada.
3. **Una regla de base de datos** (a nivel de motor, no solo de código)
   que impide insertar un registro con una organización que no existe
   realmente — así que aunque alguien se equivoque escribiendo el
   nombre, el sistema lo rechaza automáticamente en vez de aceptarlo en
   silencio.
4. **Un protocolo nuevo, por escrito**, para cualquier borrado o
   actualización masiva futura: antes de ejecutar algo así, hay que
   mostrar el conteo real de filas afectadas y el nombre real de la
   organización, y esperar una confirmación humana explícita citando
   esos números — nunca un "sí" genérico. Esta regla aplica sin importar
   si quien lo ejecuta es una persona, un script, o un asistente de IA.

---

## 5. El botón "Sincronizar Google Drive" — de un error mudo a un mensaje útil

El botón de sincronización manual (que trae datos de campo desde una
carpeta de Google Drive a la base de datos, solo funciona en entorno de
desarrollo local) empezó a fallar con el mensaje genérico "El script de
sincronización terminó con un error" — sin ningún detalle de qué había
salido mal.

La causa real resultó ser doble:

1. Un cliente de prueba había dejado, sin darse cuenta, un archivo real
   con la organización de prueba equivocada (`ORG-COOP-NORTE`, la misma
   del incidente anterior) — al renombrarse esa carpeta a la
   organización de prueba correcta, ese caso puntual se resolvió solo.
2. Pero el mensaje de error en sí **nunca mostraba el detalle real** del
   problema, ni siquiera cuando el problema era otro completamente
   distinto — el código descartaba esa información en vez de mostrarla.
   Se corrigió para que, de ahora en más, cualquier error real (el que
   sea) se muestre con un mensaje específico y útil en vez del genérico
   de siempre.

---

## 6. El vínculo real entre una subdivisión y su parcela madre

La solución provisoria descrita en el punto 3 (adivinar "esta subdivisión
es de esta parcela" mirando dónde cae en el mapa) funcionaba para avisar
de un falso conflicto de solapamiento, pero no era suficientemente sólida
para algo más serio: usarla para decidir si una parcela ya está
completamente clasificada o no, y menos todavía para bloquear una
aprobación en base a eso. Un cálculo "por ubicación" siempre deja un
margen de duda; una decisión que bloquea el trabajo de alguien necesita
un dato real, no una suposición geográfica.

Investigando cómo llegan los datos desde el celular del técnico de campo
hasta la base de datos, apareció la solución de fondo: el sistema de
captura (QField) sí guarda, desde el origen, un identificador que conecta
cada subdivisión con su parcela — pero ese dato se estaba descartando
sin querer durante el proceso de carga, nunca llegaba a guardarse. Se
corrigió para que, de ahora en adelante, ese identificador se preserve —
y a partir de eso, "esta subdivisión pertenece a esta parcela" pasó a ser
un dato certero, no una suposición basada en el mapa.

Para las subdivisiones que ya estaban cargadas antes de este cambio (y
que por lo tanto nunca guardaron ese identificador), se recuperó el dato
para los casos posibles usando, por única vez y con mucho cuidado, la
misma técnica de "mirar el mapa" de antes — y solo cuando no había
ninguna duda. Con los pocos datos reales que existen hoy: **2 parcelas
se pudieron vincular sin ninguna ambigüedad, 1 quedó sin vincular por
simple falta de datos (no había ninguna subdivisión ahí todavía), y 0
casos quedaron en duda.** Antes de tocar cualquier dato existente, se
mostró ese resultado y se esperó una confirmación explícita — mismo
criterio que se usó durante todo este tramo de trabajo para cualquier
cambio sobre datos ya cargados.

## 7. Validación de cobertura completa — y un bug crítico encontrado a tiempo

**Por qué importa para EUDR:** una parcela de café puede tener varias
subdivisiones (una parte en producción, otra en pasto, etc.). Para que
un reporte de cumplimiento ambiental sea confiable, esas subdivisiones
tienen que sumar el 100% del terreno real de la parcela — si queda un
pedazo de tierra sin clasificar, ese reporte está incompleto sin que
nadie se dé cuenta a simple vista. Por eso se construyó una validación
que compara el área real del perímetro contra la suma de las
subdivisiones ya aprobadas, y avisa cuando falta cubrir más del 5% del
terreno.

**El dato del Padrón no sirve para esto.** Antes de construir la
validación, se investigó si se podía usar un número que ya existe en el
sistema del Padrón de productores (`totalh`, el total de hectáreas
declaradas) en vez de calcular el área real del mapa. Con los pocos
casos reales disponibles para comprobarlo, el resultado fue contundente:
en una parcela real (`COOP-JS-003`), el Padrón decía 2.25 hectáreas
mientras que el área real medida en el mapa es 24.6 hectáreas — casi 11
veces más. Ese número del Padrón viene de un sistema más viejo (una
migración desde una herramienta llamada AppSheet) que no tiene un
proceso claro de mantenimiento ni se actualiza de forma confiable. Por
eso se decidió no usarlo nunca para decidir si bloquear algo — solo se
muestra aparte, como información de referencia, con una advertencia
explícita de que puede no ser confiable.

**El hallazgo más importante de este tramo:** la primera versión de esta
validación sí bloqueaba el botón "Aprobar" cuando detectaba que faltaba
cobertura. Al probarla con datos reales en pantalla, apareció un problema
serio: **ninguna subdivisión, de ninguna parcela, podía aprobarse nunca**
— siempre aparecía "0% cubierto", sin excepción. La causa, en términos
simples: el cálculo solo contaba las subdivisiones que YA estaban
aprobadas — pero la que se está revisando en ese momento, por definición,
todavía no lo está. Es como pedirle la llave de un candado a algo que
está justamente adentro del candado, cerrado: la última subdivisión que
le faltaba a cualquier parcela para completarse nunca podía contarse a sí
misma antes de aprobarse, así que nunca podía pasar su propio control.
No era un caso raro — pasaba siempre, con cualquier parcela.

Este problema no lo encontró ninguna prueba automática — se encontró
mirando la pantalla real, con datos reales, y confirmando el problema con
capturas concretas. La corrección: la validación de cobertura dejó de
bloquear el botón "Aprobar" y pasó a ser **puramente informativa** — un
aviso amarillo, igual que el aviso de "Solapado X%" que ya existía, que
avisa "cobertura parcial, revisá si falta algo" pero nunca le impide a
nadie aprobar una subdivisión individual. El cálculo en sí (cuánto se
cubrió, cuánto falta) sigue funcionando exactamente igual — solo cambió
qué hace el sistema con ese resultado.

**Pendiente, explícitamente sin decidir:** en algún punto del proceso SÍ
va a hacer falta exigir que una parcela esté completamente cubierta antes
de darla por lista — probablemente al momento de exportar el reporte
oficial de trazabilidad (la exportación DDS que ya existe en el mapa),
no al aprobar cada subdivisión suelta una por una. Dónde exactamente se
debe aplicar ese control real todavía no se decidió — queda como una
tarea futura separada.

## 8. El incidente de las aprobaciones que se revertían solas — y dos problemas más que destapó

Este tramo arrancó de una pregunta simple: ¿podía estar generando
polígonos duplicados la sincronización con Google Drive? Investigarla con
cuidado, en vez de responderla rápido, destapó tres problemas reales
distintos, cada uno con su propia causa y su propia corrección.

### 8.1 Aprobaciones y rechazos que se revertían solos, sin dejar ningún rastro

Se confirmó, con evidencia real (no solo una sospecha): 3 registros que un
revisor humano ya había marcado como "Aprobado" volvieron por su cuenta a
"Pendiente de revisión" — como si nunca los hubiera revisado nadie, sin
ningún aviso ni rastro de que había pasado.

**Por qué pasaba, en simple:** cuando un técnico de campo sigue trabajando
sobre el mismo proyecto en QField (la app que usa para capturar datos en el
celular) y ese proyecto se vuelve a sincronizar, el sistema no solo trae los
registros nuevos que agregó — trae **todos** los registros del proyecto de
nuevo, incluidos los que ya se habían subido y revisado antes. El sistema
reconoce que un registro "ya existe" (por su parcela y fecha) y lo actualiza
en vez de duplicarlo — hasta ahí, correcto. El problema es que, al
actualizarlo, siempre volvía a escribir "Pendiente de revisión" sin
preguntar primero si un humano ya lo había aprobado o rechazado — pisando
esa decisión en silencio, sin que nadie se enterara.

**La corrección:** ahora, antes de actualizar cualquier registro durante una
sincronización, el sistema primero revisa si ese registro ya fue revisado
por una persona. Si ya tiene una decisión (Aprobado o Rechazado), lo deja
completamente intacto — ni el estado, ni la geometría, ni ningún otro dato
se toca — y el registro de la sincronización deja constancia explícita de
qué se protegió y por qué. Solo los registros que siguen genuinamente
pendientes (o que son nuevos de verdad) se actualizan con normalidad, como
siempre.

### 8.2 Una tabla de auditoría que existía en el papel, pero nunca en la base real

El sistema estaba diseñado, desde antes de este tramo, para dejar un
registro permanente de cada decisión real de la Consola QC (quién aprobó
qué, cuándo, por qué se rechazó algo) — pensado justamente para casos como
el del punto anterior, donde sin ese registro es imposible saber qué pasó.
El código para conectar esa auditoría ya estaba escrito y probado, pero la
tabla en sí, la que debía guardar esos datos, **nunca se había creado
realmente** en la base de datos — la documentación decía que sí estaba
creada, pero no era cierto.

Se aplicó la creación real de esa tabla, y se confirmó en vivo que la
conexión que ya existía funciona: aprobar o rechazar un registro real desde
la Consola QC ahora sí deja una fila permanente, con el contexto técnico de
la decisión (nunca datos personales de nadie). Se probó, además, que esa
tabla es imborrable de verdad: ni siquiera con el nivel de acceso más alto
que tiene el propio sistema se puede modificar o borrar una fila ya
escrita — un intento directo de cambiarla o borrarla fue rechazado por la
base de datos misma, no solo por una regla del código que alguien podría
saltarse.

### 8.3 El mismo código de parcela apuntando a dos lugares distintos

Se confirmó, como regla de negocio (no una suposición del sistema): un
código de parcela tiene que corresponder siempre a un único lugar físico —
nunca a dos ubicaciones distintas. Investigando cuánto se cumplía esto en
la práctica, se encontraron 3 casos reales donde no se cumplía: el mismo
código de parcela aparecía en dos ubicaciones separadas por distancias de
entre 768 metros y 3.5 kilómetros — demasiado lejos para tratarse del mismo
lugar capturado dos veces con un GPS de mano.

Se agregó una detección que, al abrir uno de estos registros en conflicto
en la Consola QC, bloquea los botones de Aprobar y Rechazar hasta que
alguien resuelva manualmente cuál de los dos registros tiene el código
equivocado — mostrando en pantalla la distancia real y cuál es el otro
registro involucrado. Esta protección se armó dos veces, a propósito: una
vez en la pantalla (el botón directamente no se puede apretar) y otra vez
del lado del servidor (aunque alguien intentara forzar la acción saltándose
el botón, por otro camino técnico, el sistema la rechaza igual) — para que
el bloqueo no dependa únicamente de que ese botón exista.

La distancia usada para decidir "esto es un conflicto real" (100 metros) es
provisoria: se documentó con honestidad que, entre los datos reales
disponibles hoy, no hay todavía ningún ejemplo de "mismo lugar, con el
margen de error normal de un GPS de campo" para calibrar ese número con
precisión — los 3 casos encontrados son todos, sin duda, "otro lugar". Se
ajustará ese número si en el futuro aparece un caso real que lo contradiga.

## 9. El error que apuntaba a la causa equivocada, y un repaso del padrón de socios

Antes de cerrar la sesión se hicieron dos cosas más, sin relación directa
entre sí: se hizo más claro el mensaje que ve un revisor cuando dos
registros comparten el mismo código de parcela (el número de distancia
crudo, tipo "1213.49m", pasó a mostrarse como "1.2 km", y el otro registro
en conflicto se identifica por su fecha de captura y su técnico
responsable en vez de un código interno sin significado para nadie no
técnico); y se investigó — y se corrigió parte de — un error que llevaba
cuatro días mostrando un mensaje equivocado.

### 9.1 El mensaje de error que apuntaba a la causa equivocada

El 19 de agosto se había corregido un problema real: los registros de
"Instalaciones" (por ejemplo, una construcción o beneficio dentro de una
parcela) no se podían aprobar ni rechazar en la Consola QC, porque le
faltaba a la base de datos un dato interno necesario para identificar cuál
fila actualizar. Ese día se aplicó la corrección — y quedó anotado en el
código que, en ese momento, no había ningún registro real de Instalaciones
esperando revisión, así que el problema, aunque corregido, no tenía forma
de mostrarse todavía.

Cuatro días después, alguien vio en pantalla, en vivo, el mensaje "falta
aplicar esa corrección" — a pesar de que ya estaba aplicada desde el 19.
En vez de darlo por resuelto con "ya está aplicada, entonces no hay nada
que investigar", se siguió la contradicción: la corrección del 19 de
agosto sí había arreglado la base de datos, pero **una pieza completamente
distinta del sistema — la parte que le pide los datos a la base desde la
pantalla — nunca había empezado a pedir el dato nuevo**. Es decir, el dato
ya estaba disponible desde el 19 de agosto, pero nadie se lo pedía, así
que nunca llegaba a la pantalla. El problema original (no poder aprobar
Instalaciones) nunca se había solucionado de verdad — solo se volvió
visible recién cuando llegaron, ese mismo día, los primeros registros
reales de Instalaciones esperando revisión (durante el trabajo descrito en
el punto 8.1) — y para entonces, el mensaje de error, escrito cuatro días
antes, ya apuntaba a una causa que ya no era cierta.

**La corrección:** se hizo que esa pieza del sistema pida el dato que
faltaba (un cambio de una sola línea), y se reescribió el mensaje de error
para que ya no le eche la culpa a una corrección puntual — ahora describe
lo que realmente pasa, sin asumir por qué, para que la próxima persona que
lo vea no pierda tiempo persiguiendo una pista equivocada. Se probó en
vivo, con un registro real: antes de este cambio, era imposible aprobar un
registro de Instalaciones desde la pantalla — después, funcionó
normalmente con el botón real.

### 9.2 Repaso del padrón: baja de socios y transferencia de parcelas entre organizaciones

Se pidió revisar cómo está preparado el sistema para dos situaciones: que
un socio deje una cooperativa (sin borrar su historial), y que una parcela
pase de una organización a otra conservando lo ya trabajado bajo la
organización original.

**La primera parte ya estaba resuelta, de una etapa anterior de este mismo
proyecto** — no hizo falta construirla de nuevo. Dar de baja a un socio (o
una parcela) nunca borra el registro: solo lo marca como inactivo, y deja
de aparecer en las pantallas de trabajo diario, pero el historial completo
sigue existiendo tal cual. El propio código ya explica por qué se decidió
así: el historial de monitoreo de campo de un socio tiene que sobrevivir
aunque el socio se dé de baja del padrón administrativo — es una exigencia
de cumplimiento EUDR, no solo una preferencia de diseño (ver el recuadro
regulatorio más abajo). Lo único que hacía falta corregir era chico: el
buscador que usa el formulario de Inspecciones para encontrar un socio o
una parcela por nombre o código todavía mostraba socios/parcelas ya dados
de baja como si estuvieran activos — se corrigió para que ya no aparezcan
ahí, sin tocar ningún dato ya guardado.

**La segunda parte reveló un problema más grande, que queda como tarea
pendiente de diseño, no como un arreglo rápido.** Hoy, el código de una
parcela (por ejemplo "COOP-JS-001") tiene que ser único en **todo el
sistema**, no solo dentro de una organización — la base de datos lo
impide directamente, con la misma regla que evita que dos personas tengan
el mismo número de documento en la tabla de socios. Eso significa que hoy
es **imposible** mover una parcela de una organización a otra manteniendo
el mismo código — la base de datos rechazaría el intento antes de que
llegara a guardarse nada. Antes de construir esa transferencia hace falta
decidir cómo resolver esa limitación (por ejemplo, si el código puede
cambiar al transferirse, o si hay que rediseñar cómo se identifican las
parcelas en la base) — se deja documentado como el tema grande pendiente
de esta sesión, sin apurar una solución.

> **Nota de contexto regulatorio (no es un consejo legal):** el reglamento
> europeo EUDR exige conservar la documentación de diligencia debida y
> trazabilidad durante al menos 5 años desde que un producto se coloca en
> el mercado. Es, en parte, el motivo por el que la baja de un socio nunca
> borra nada — un historial de monitoreo que en algún momento pudo
> respaldar un lote real de café no se puede perder solo porque el
> productor dejó la cooperativa después.

## 10. Qué queda pendiente

**a) Dónde debe exigirse la cobertura completa de verdad — no
decidido.** Como se explica en el punto 7: la validación de cobertura ya
existe y funciona, pero hoy es solo informativa. Falta decidir en qué
paso del proceso (probablemente la exportación DDS) se debe convertir en
un control real que si bloquee, sin que eso choque con el trabajo diario
de aprobar subdivisiones sueltas.

**b) Cómo resuelve una persona, en la práctica, un conflicto de código de
parcela — no construido todavía.** Como se explica en el punto 8.3: hoy,
cuando el sistema detecta que un código de parcela aparece en dos lugares
distintos, el registro queda bloqueado (no se puede aprobar ni rechazar)
pero no existe ningún camino en pantalla para resolver el conflicto —
alguien tiene que corregirlo a mano, directamente en la base de datos.
Falta diseñar un flujo real (por ejemplo, renombrar el código equivocado, o
marcar uno de los dos registros como un error de captura) para que ese
conflicto se pueda resolver desde la propia Consola QC.

**c) Rediseñar cómo se identifican las parcelas y los socios en el
padrón, para poder transferir una parcela entre organizaciones — no
decidido.** Como se explica en el punto 9.2: hoy el código de una parcela
(y el código de un socio) tiene que ser único en todo el sistema, no por
organización, así que es imposible hoy transferir una parcela a otra
organización manteniendo el mismo código. Es el tema grande pendiente de
esta sesión — necesita una decisión de diseño (no solo código) antes de
poder estimarse.

> *Resuelto de la vez pasada:* la pregunta sobre si `PADRON_PARCELAS.totalh`
> era una referencia confiable — el pedido original de esta bitácora
> mencionaba que la "Fase B" estaba "frenada" por esa investigación, algo
> que en su momento no se encontró documentado. Esa investigación sí se
> hizo después, como parte de este mismo tramo (ver punto 7): la
> respuesta es que `totalh` **no** es confiable y no se usa para bloquear
> nada. Se retira de la lista de pendientes.

> *Resuelto (2026-08-23, investigación dedicada):* la pregunta sobre si
> `ORG-COOP-NORTE` fue alguna vez una organización de demostración usada
> a propósito (por ejemplo en una venta o presentación) antes de existir
> el script de pruebas automáticas. Se revisó el historial completo del
> repositorio, no solo los commits recientes, buscando la primerísima
> aparición del nombre. **Respuesta: no.** El nombre nace exactamente el
> 16 de agosto de 2026, en el mismo commit que crea por primera vez el
> script de pruebas automáticas — el propio documento que pidió crear ese
> script ya usaba `ORG-COOP-NORTE` como nombre de ejemplo, inventado ahí
> mismo, sin ninguna referencia a algo anterior. Dos días después (18 de
> agosto), como ese script ya había corrido de verdad contra la base de
> datos real, quedó como la única organización con datos reales
> "aprobados" disponibles en ese momento — y por eso se reutilizó, de
> forma oportunista, para probar otras funciones sin relación (el
> generador de PDF de trazabilidad, el chequeo de que no se filtran datos
> personales), incluso apareciendo mencionado en un informe interno de
> cierre de esa etapa del proyecto. Ese uso posterior podría dar la
> impresión de algo "oficial", pero en el fondo siempre fue el mismo dato
> de prueba, reciclado — nunca una organización real ni una demo
> preparada a propósito. Se retira de la lista de pendientes.

**d) Evaluar pasar el proyecto de Supabase de un plan gratuito a uno
pago con respaldo automático, antes de cargar la primera organización
real.** Hoy el proyecto corre en un plan sin respaldos automáticos
configurados — razonable mientras todo el dato es de prueba, pero un
riesgo real una vez que haya datos de un cliente real cargados. No se
había planteado antes en este proyecto; queda como recomendación a
evaluar antes de ese paso.

---

## 11. Para quien quiera el detalle técnico

| Tema | Documento técnico | Commit(s) |
|---|---|---|
| Colisión de herramientas de dibujo, popup expuesto, solapamiento auditable, panel en vivo, redondeo, margen turf/PostGIS | [ADR-005](../adr/ADR-005-qc-editor-geometria-y-solapamiento.md) | `0d003e8`, `111727b`, `a62fce6`, `c56f18f`, `4a910a4` |
| Exclusión de contención propia en el solapamiento (Fase A + margen de tolerancia) | [ADR-005](../adr/ADR-005-qc-editor-geometria-y-solapamiento.md) (secciones "Fase A") | `cba6474`, `d2bcebd`, `f099a75` |
| Capa de contexto de parcelas vecinas | [ADR-006](../adr/ADR-006-capa-contexto-parcelas-vecinas.md) | `b212424` |
| Auditoría e integridad referencial de `ID_Organizacion` (incidente de datos huérfanos, parte 1: FK) | [ADR-007](../adr/ADR-007-integridad-referencial-id-organizacion.md) | `a6e817c`, `2391859` |
| Etiqueta de organización de prueba + guardarail del script E2E (incidente, parte 2: protección futura) | [ADR-008](../adr/ADR-008-etiqueta-organizacion-prueba-y-guardarail-e2e.md) | `488c993` |
| Fix del mensaje de error vacío en la sincronización de Google Drive | [ADR-009](../adr/ADR-009-fix-mensaje-error-sync-drive.md) | `7eb744e`, `ce4053f` |
| Regla de reinicio periódico del servidor de desarrollo (`CLAUDE.md`) | — (sin ADR, cambio de documentación de proceso) | `affdc2a` |
| Vínculo real entre Uso de Suelo y su Monitoreo padre (reemplaza el heurístico de Fase A para este propósito) | [ADR-010](../adr/ADR-010-vinculo-real-uso-suelo-monitoreo.md) | `1ec2c2d` |
| Validación de cobertura completa, investigación de `totalh`, y el bug crítico del bloqueo circular (encontrado y corregido) | [ADR-011](../adr/ADR-011-cobertura-completa-uso-suelo.md) | `5c6d4f9`, `2ac75d6` |
| El ETL protege registros ya revisados (Aprobado/Rechazado) de resincronizaciones que los revertían en silencio | [ADR-012](../adr/ADR-012-eudr-etl-protege-registros-revisados.md) | `4de126d` |
| `audit_logs` aplicada de verdad y conectada a Aprobar/Rechazar (corrección de premisa: la conexión ya existía, la tabla no) | [ADR-013](../adr/ADR-013-audit-logs-conectado-a-consola-qc.md) | `a611779` |
| Un código de parcela debe corresponder a un único lugar físico — detección, bloqueo en pantalla, guard del lado del servidor, y mensaje en lenguaje claro | [ADR-014](../adr/ADR-014-codigo-parcela-unico-por-ubicacion.md) | `9ad7aa2`, `6611451`, `5ad2aa3` |
| `PUNTOS_COLUMNS` nunca pedía `id_origen` — el mensaje de error culpaba a una migración ya aplicada; Instalaciones ya se puede aprobar/rechazar | [ADR-015](../adr/ADR-015-fix-puntos-columns-id-origen.md) | `e938d0d` |
| Autocompletado de Inspecciones excluye socios/parcelas dados de baja; repaso de baja lógica y bloqueo de transferencia entre organizaciones | [ADR-016](../adr/ADR-016-padron-autocompletado-excluye-inactivos.md) | `a7fd9f6` |

**Commits del tramo completo, en orden:** `0d003e8` → `111727b` →
`a62fce6` → `c56f18f` → `4a910a4` → `b212424` → `a6e817c` → `2391859` →
`488c993` → `7eb744e` → `ce4053f` → `affdc2a` → `cba6474` → `d2bcebd` →
`f099a75` → `1ec2c2d` → `5c6d4f9` → `2ac75d6` → `4de126d` → `a611779` →
`9ad7aa2` → `6611451` → `5ad2aa3` → `e938d0d` → `a7fd9f6`.
