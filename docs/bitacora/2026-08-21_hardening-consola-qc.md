# Bitácora — Refuerzo de la Consola QC (21–23 de agosto de 2026)

*Para cualquiera que quiera entender qué pasó en este tramo de trabajo sin
necesidad de leer código. Cubre desde el commit `0d003e8` hasta el
`2ac75d6`.*

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

## 8. Qué queda pendiente

**a) Dónde debe exigirse la cobertura completa de verdad — no
decidido.** Como se explica en el punto 7: la validación de cobertura ya
existe y funciona, pero hoy es solo informativa. Falta decidir en qué
paso del proceso (probablemente la exportación DDS) se debe convertir en
un control real que si bloquee, sin que eso choque con el trabajo diario
de aprobar subdivisiones sueltas.

> *Resuelto de la vez pasada:* la pregunta sobre si `PADRON_PARCELAS.totalh`
> era una referencia confiable — el pedido original de esta bitácora
> mencionaba que la "Fase B" estaba "frenada" por esa investigación, algo
> que en su momento no se encontró documentado. Esa investigación sí se
> hizo después, como parte de este mismo tramo (ver punto 7): la
> respuesta es que `totalh` **no** es confiable y no se usa para bloquear
> nada. Se retira de la lista de pendientes.

**b) Sigue sin confirmarse el origen completo de `ORG-COOP-NORTE`.** Se
confirmó que el nombre viene de un script de pruebas automáticas y,
probablemente, de alguna prueba manual adicional — ambas cosas dentro
de este mismo período de trabajo. Lo que no se pudo confirmar (porque
está fuera del alcance de lo que se puede ver desde el código) es si
ese mismo nombre se usó alguna vez, ANTES de esto, como una organización
de demostración a propósito — por ejemplo en una venta o presentación.
Vale la pena preguntarle a quien tenga esa historia.

**c) Evaluar pasar el proyecto de Supabase de un plan gratuito a uno
pago con respaldo automático, antes de cargar la primera organización
real.** Hoy el proyecto corre en un plan sin respaldos automáticos
configurados — razonable mientras todo el dato es de prueba, pero un
riesgo real una vez que haya datos de un cliente real cargados. No se
había planteado antes en este proyecto; queda como recomendación a
evaluar antes de ese paso.

---

## 9. Para quien quiera el detalle técnico

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

**Commits del tramo completo, en orden:** `0d003e8` → `111727b` →
`a62fce6` → `c56f18f` → `4a910a4` → `b212424` → `a6e817c` → `2391859` →
`488c993` → `7eb744e` → `ce4053f` → `affdc2a` → `cba6474` → `d2bcebd` →
`f099a75` → `1ec2c2d` → `5c6d4f9` → `2ac75d6`.
