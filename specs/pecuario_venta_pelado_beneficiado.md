# Spec — Venta de cuy pelado (beneficiado): precio por kg o por animal (Pecuario Cuyes)

**Estado: validado en el simulador (mockup), NO construido todavía.** No hay
migración ni cambio de esquema para esta spec — se documenta acá para no
perder la decisión tomada mientras se valida con Neyser y con los técnicos
de Granja Valencia, antes de pasar a diseñar/aplicar nada contra la base
real. Esta spec complementa lo ya documentado sobre `PECUARIO_VENTAS` en
`specs/pecuario_identificacion_individual.md` (sección "Venta: por animal,
no por peso") y a `specs/pecuario_venta_subproductos_guano.md` (venta de
guano, un problema distinto: ahí el producto no es un animal; acá sí lo
es, solo que procesado).

## 1. Problema

El diseño de "Registrar venta" (incluida la versión que ya separó Animales
de Guano, ver `pecuario_venta_subproductos_guano.md`) asumía que toda venta
de animales se cobra **por animal** (precio individual × cantidad), con el
peso como dato opcional/referencial. Eso es correcto para animales vendidos
**en pie** (vivos), pero no para **cuy pelado** (beneficiado): el animal se
procesa en la granja antes de venderse, y ese producto —una carcasa— se
cobra muchas veces por su peso, como cualquier carne, no por cabeza.

Observación de Neyser: el diseño actual "está para ventas de animales
vivos" y no contempla el caso de venta ya pelada.

## 2. Decisiones tomadas (confirmadas por Neyser, 2026-09-13)

1. **La base del precio depende del comprador**: a veces se cobra por
   kilogramo de carcasa pelada, a veces por animal — no hay una regla única
   para todas las ventas de pelado. El técnico elige, venta por venta, cuál
   aplica.
2. **El flujo sigue siendo el mismo que hoy**: se sigue eligiendo un
   Lote o un Reproductor identificado (poblacional o individual, como ya
   existe), y la venta sigue dando de baja a los animales vendidos —
   "pelado" es un tipo de salida más, no un registro aparte ni una salida
   sin trazabilidad de origen.

## 3. Diseño reflejado en el simulador, versión 19

- **"Tipo de salida"** gana una cuarta opción: **Pelado (beneficiado)**,
  junto a Carne (en pie), Pie de cría y Reproductor de saca.
- Al elegir "Pelado (beneficiado)" aparece un selector nuevo, **"Base del
  precio para esta venta"**: *Por kilogramo* / *Por animal*.
- **Cantidad de animales** se sigue pidiendo siempre, sin importar la base
  de precio elegida — sirve para trazabilidad y para dar de baja a los
  animales correctos, independientemente de cómo se cobre la venta. Cuando
  la base es "Por kilogramo", un hint aclara que esa cantidad no participa
  del cálculo del precio.
- Según la base elegida, el formulario muestra un bloque de precio distinto
  (nunca ambos a la vez):
  - **Por kilogramo:** "Peso total pelado (kg)" pasa a ser el dato
    principal (ya no opcional/referencial como en la venta en pie) +
    "Precio por kilogramo (S/ por kg)". El precio total se calcula solo:
    peso × precio por kg.
  - **Por animal:** igual que la venta en pie de hoy — "Precio individual
    (S/ por animal)", peso queda opcional/referencial, y el total se
    calcula cantidad × precio individual.
- Para los otros tres tipos de salida (Carne en pie, Pie de cría,
  Reproductor de saca) no cambia nada — siguen siendo siempre por animal,
  sin el selector de base de precio.

## 4. Lo que falta construir (cuando se decida pasar de mockup a backend)

**Migración y contrato Zod redactados 2026-09-23, NO aplicados todavía
contra la base real — ver Sección 6.5.**

- Confirmar el modelo de datos: lo más simple es agregar a `PECUARIO_VENTAS`
  una columna `base_precio` (ENUM `por_animal | por_kg`, default
  `por_animal`) y permitir que `peso_total` sea la base del cálculo cuando
  `base_precio = 'por_kg'` (columna `precio_kg` nueva), sin tocar
  `precio_unitario` que sigue existiendo para el caso por animal — evita
  una tabla o un tipo de registro nuevo, ya que sigue siendo una venta de
  animal con trazabilidad hacia `PECUARIO_REPRODUCTORES`/lote igual que
  hoy.
- `tipo_salida` (o como se llame la columna real hoy — a verificar contra
  `docs/schema_live_pecuario.md`) gana el valor `pelado_beneficiado`, sin
  romper los valores existentes (`carne`, `pie_de_cria`,
  `reproductor_de_saca`).
- Contrato Zod: cuando `base_precio = 'por_kg'`, `peso_total` pasa de
  opcional a obligatorio y `precio_kg` es obligatorio; cuando
  `base_precio = 'por_animal'`, se mantiene la validación actual
  (`precio_unitario` recomendado, `peso_total` opcional).
- No afecta a `fn_dar_baja_animal_por_venta()` — el pelado sigue dando de
  baja al animal igual que cualquier otro tipo de salida con `animal_id`
  o `lote_id` no nulo; el trigger no depende de la base de precio.

## 5. Pendiente

- Confirmar con los técnicos, en esta ronda de revisión del simulador, si
  falta alguna otra combinación de precio para el pelado (ej. un precio
  mixto, parte por kg y parte por animal, poco común pero posible en
  ventas grandes) — por ahora se asume que cada venta usa una sola base.
- Cuando se decida construir esto de verdad: escribir la migración
  (columnas `base_precio`/`precio_kg` en `PECUARIO_VENTAS`, nuevo valor de
  `tipo_salida`) y el contrato Zod — siguiendo el mismo flujo de siempre
  (spec → migración → Zod → Claude Code CLI → aplicación manual en
  Studio).

## 6. Auditoría de Venta — versión 40 (2026-09-21)

Ronda de auditoría "registro por registro" (misma revisión de esta
sesión). La Ronda 1 (`pecuario_ficha_poza_y_calculo_poblacion.md` §3.9)
ya había confirmado y corregido que `guardarVentaAnimal()` descuenta bien
la población (lote o reproductor identificado) — eso se reconfirmó acá
sin cambios. Esta ronda revisó específicamente el lado **comercial** de
la venta, que la Ronda 1 no había tocado.

### 6.1. Hallazgo: el precio, tipo de salida, base y peso se perdían al guardar

Toda la lógica de esta spec (tipo de salida, base de precio, peso,
precio total calculado en vivo por `calcularPrecioTotalVenta()`) vive en
la pantalla, pero `guardarVentaAnimal()` nunca la leía: el mensaje de
confirmación solo decía cuántos animales se vendieron y de dónde, sin
mencionar por cuánto ni bajo qué tipo/base. Un técnico que cargaba una
venta de pelado por S/ 211.20 no tenía ninguna confirmación de que ese
número se hubiera registrado — de hecho no se registraba en ningún lado.
(`guardarVentaSubproducto()`, la venta de guano, sí incluía el precio en
su mensaje — la inconsistencia entre ambas funciones fue lo que hizo
notar el hallazgo.)

### 6.2. Decisión confirmada por Neyser (2026-09-21)

Corregir solo el mensaje de confirmación — no se construye un historial
de ventas en esta ronda (no hay ningún `VENTAS` todavía, a diferencia de
`INSUMOS_MOVIMIENTOS` en Insumos/Stock). El precio, tipo, base y peso
quedan visibles al momento de guardar, pero no se persisten en ningún
arreglo del simulador.

### 6.3. Implementación en el simulador (versión 40)

- Nueva función `resumenComercialVenta()`: lee el tipo de salida
  seleccionado, la base de precio (si es Pelado), el peso y el precio
  total ya calculados en pantalla, y arma un texto tipo `"Tipo: Pelado
  (beneficiado) (por kg) · Peso: 9.6 kg · Total: S/ 211.20"`.
  `guardarVentaAnimal()` ahora agrega ese texto al mensaje de
  confirmación, tanto para venta de lote como de reproductor
  identificado.
- Verificado con un DOM headless (`jsdom`) ejecutando la función real
  `guardarVentaAnimal()` de punta a punta: venta de lote tipo Carne
  (12 animales × S/18 = S/216.00) y venta Pelado por kilogramo (9.6 kg ×
  S/22 = S/211.20), confirmando el descuento de población correcto y el
  texto exacto del mensaje de confirmación en ambos casos.

### 6.4. Para cuando se construya de verdad

- Si más adelante se decide llevar un historial real de ventas (mismo
  patrón que `INSUMOS_MOVIMIENTOS`), este es el punto natural para
  agregarlo — el cálculo del resumen comercial (`resumenComercialVenta()`)
  ya deja todos los campos relevantes juntos en un solo lugar.
- Ese historial sería además la fuente real para "Ventas del mes" en el
  Panel de indicadores, hoy marcado como dato de ejemplo (ver
  `pecuario_panel_indicadores.md` §2.6) — no se conecta en esta ronda.

### 6.5. Backend — migración y contrato Zod (2026-09-23)

Redactado por Claude (Cowork), tras confirmar la Sección 6.2 de
`pecuario_panel_indicadores.md` (Ronda 46, 2026-09-22: opción (b), pedir
el peso vivo puntual al vender Pelado). Incorpora en una sola migración
las dos piezas pendientes de esta spec: la base de precio por kg/animal
(Sección 4, decisión original del 2026-09-13) y el peso vivo
pre-beneficio para Rendimiento de carcasa (decisión del 2026-09-22).

`supabase/migrations/20260923090000_pecuario_venta_pelado_beneficiado.sql`:

- `tipo_venta_cuy` gana el valor `'pelado_beneficiado'` (`ALTER TYPE ...
  ADD VALUE IF NOT EXISTS`, sin romper los valores existentes).
- Enum nuevo `base_precio_venta` (`'por_animal'` default | `'por_kg'`) +
  columnas `base_precio`, `precio_kg`, `peso_vivo_pre_beneficio_kg` en
  `PECUARIO_VENTAS`.
- `CHECK chk_ventas_base_precio_coherente`: `por_kg` solo permitido con
  `tipo_salida = 'pelado_beneficiado'`, y en ese caso exige
  `peso_total_kg`/`precio_kg` — mismo criterio ya usado en el resto del
  módulo (XOR reforzado a nivel de base, no solo de formulario).
  `peso_vivo_pre_beneficio_kg` queda **sin** CHECK obligatorio a
  propósito: no bloquea la captura offline si el técnico no lo carga
  (mismo criterio que el resto de RYZOS — avisa, no bloquea).
- `fn_calcular_precio_total_venta()` (el trigger de v4) se **extiende**,
  no se reemplaza: la rama nueva (`peso_total_kg * precio_kg`) se evalúa
  primero, y si no aplica cae al comportamiento existente
  (`cantidad * precio_unitario`) — ninguna venta ya cargada por animal
  cambia de resultado.
- **Novedad respecto a lo que pedía la Sección 4 original:**
  `rendimiento_carcasa_pct` se agrega como columna **generada**
  (`peso_total_kg / peso_vivo_pre_beneficio_kg * 100`), no como cálculo
  solo-en-pantalla. Esto resuelve de una vez lo que la Sección 6.4 dejaba
  como posible trabajo futuro ("si se decide llevar un historial real de
  ventas..."): `PECUARIO_VENTAS` ya es una tabla real (a diferencia del
  simulador, que nunca persistió esto), así que el historial real de
  Rendimiento de carcasa queda disponible apenas se aplique esta
  migración — no hace falta una tabla ni un cálculo aparte.
- No toca `fn_dar_baja_animal_por_venta()` (v3) — sigue dependiendo solo
  de `animal_id`/`lote_id`, no de `base_precio`.

`lib/validators/pecuario.ts` — `VentaRegistroSchema` extendido (no
reemplazado): `tipo_salida` gana `'pelado_beneficiado'`, más
`base_precio`/`precio_kg`/`peso_vivo_pre_beneficio_kg` y dos `.refine()`
nuevos que replican `chk_ventas_base_precio_coherente` exactamente —
mismo criterio de "el formulario nunca promete algo que la base
terminaría rechazando" ya usado en `CompraSchema`.

**Tests requeridos antes de aplicar en producción** (aislamiento RLS
cruzado + lógica), mismo criterio que las migraciones anteriores de esta
sesión:

- Org A no debe poder leer/insertar ventas de Org B (ya cubierto por la
  RLS existente de `PECUARIO_VENTAS`, v1 — esta migración no cambia esa
  política, pero corresponde revalidarla con las columnas nuevas).
- Venta pelado por kg (peso 9, peso vivo 15, precio_kg 22) →
  `precio_total = 198.00`, `rendimiento_carcasa_pct = 60.0`.
- Venta carne por animal (cantidad 12, precio_unitario 18) →
  `precio_total = 216.00` (sin cambio respecto a v4 — regresión).
- `base_precio='por_kg'` con `tipo_salida != 'pelado_beneficiado'` →
  debe fallar por `chk_ventas_base_precio_coherente`.
- `base_precio='por_kg'` sin `precio_kg` o sin `peso_total_kg` → debe
  fallar por el mismo CHECK.

### 6.6. Continuación — "Comprador" también se perdía (versión 42)

Misma ronda, un campo más encontrado al revisar la venta de guano en
paralelo (ver `pecuario_venta_subproductos_guano.md` §5): "Comprador
(opcional)" se cargaba en el formulario de venta de animales y tampoco
quedaba en el mensaje de confirmación. Se agregó a
`resumenComercialVenta()` junto con el resto — mismo criterio de la
Sección 6.2 (no se persiste en ningún registro, solo se deja de prometer
silencio sobre un dato que sí se cargó).
