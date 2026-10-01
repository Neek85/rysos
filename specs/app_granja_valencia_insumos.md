# Spec — App Granja Valencia: Insumos (stock, movimientos y alta de insumo)

**Estado:** spec + contratos Zod. La pantalla NO está construida. Depende de la
migración `20261001223000_fix_rls_insumos_y_galpon_movimientos.sql` (commits
`bc5e297` + `17db1e5`), **pendiente de aplicar por Neyser en Studio** al
escribir esto: hasta que lo confirme, no se asume que existen `galpon_id` en
movimientos, las policies por rol ni `fn_crear_insumo_con_stock_inicial`.

## 0. Recon (confirmado en vivo, solo lectura)

**Tablas** (`docs/schema_live_pecuario.md`, v2/v4 + comprobado contra
`information_schema`/`pg_policies`):

- `PECUARIO_INSUMOS` (catálogo): `id`, `ID_Organizacion` (FK), `nombre`
  (varchar NOT NULL), `categoria` (enum `categoria_insumo`: `alimento,
  sanitario, material, equipo, otro, medicamento, vitamina`, default `otro`),
  `unidad_medida` (enum `unidad_medida_insumo`: `kg, g, litro, ml, unidad,
  saco_50kg, saco_40kg`, default `unidad`), `stock_minimo` (numeric), `activo`
  (default true), campos offline. `UNIQUE (ID_Organizacion, nombre)`. Sin
  columna de stock.
- `PECUARIO_INSUMOS_MOVIMIENTOS`: `insumo_id` (FK `RESTRICT`),
  `tipo_movimiento` (enum `entrada|salida`), `cantidad` (> 0 por CHECK), `fecha`
  (default hoy), `poza_id`/`lote_id` (FK `SET NULL`, sin XOR), `observaciones`,
  campos offline. **`galpon_id`: lo agrega la migración pendiente.**
- `vw_pecuario_insumos_stock`: `stock_actual` = Σ entradas − Σ salidas por
  insumo, filtrada por organización en su propio `WHERE`.
- Sin triggers sobre estas dos tablas: un movimiento manual no dispara nada
  y nada impide un stock negativo. Los únicos escritores automáticos de
  movimientos son triggers de otras tablas: `fn_descontar_insumo_tratamiento`
  (salida, desde tratamientos) y `fn_compra_genera_entrada_insumo` (entrada,
  desde Compras con `concepto='insumo'`, con `poza_id`/`lote_id` en NULL).
- Datos reales: 0 filas en catálogo, movimientos y vista (todas las
  organizaciones, incluidas GRANJA-TEST y GRANJA-VALENCIA).

**Mockup** (artifact `7vebvnVwLNR15TT9DL2DyX`, `data-screen="insumos"`): una
pantalla con lista de stock arriba y dos sub-flujos por chips: "Registrar
movimiento" y "Nuevo insumo".

## 1. Reglas de rol (RLS, ya redactadas en la migración)

| Tabla | SELECT | INSERT | UPDATE / DELETE |
|---|---|---|---|
| `PECUARIO_INSUMOS` | toda la organización | solo `admin` | solo `admin` |
| `PECUARIO_INSUMOS_MOVIMIENTOS` | toda la organización | `admin` + `tecnico_campo` | solo `admin` |

La pantalla oculta "Nuevo insumo" a quien no sea `admin` (`rol` de
`useProfile`), pero la barrera real es la RLS, no la UI. Un `tecnico_campo`
ve la lista de stock y registra movimientos, nada más.

## 2. Flujo de la pantalla (3 secciones)

Ruta prevista: `apps/granja-valencia/src/app/(protegido)/insumos/index.tsx`; el
tile "Insumos" de Inicio hoy apunta a `/proximamente/[title]` y pasaría a
apuntar acá. Se arma como Sanidad: una pantalla, chips de modo.

1. **Lista de stock** (siempre visible): una fila por insumo activo, de
   `vw_pecuario_insumos_stock`: nombre, categoría, `stock_actual` con la
   unidad. Si `stock_minimo` no es nulo y `stock_actual < stock_minimo`, fila
   resaltada y texto "bajo el mínimo (N unidad)".
2. **Registrar movimiento** (`admin` + `tecnico_campo`): insumo (solo del
   catálogo, sin texto libre), tipo Entrada/Salida, cantidad (> 0), fecha,
   **galpón** (alcance principal, chips de `PECUARIO_GALPONES`),
   observaciones opcionales y un detalle opcional "poza o lote" (para
   aislar el consumo de una prueba puntual). Guarda con INSERT directo en
   `PECUARIO_INSUMOS_MOVIMIENTOS` (contrato `MovimientoInsumoCrearSchema`),
   sesión real, y refresca la lista.
3. **Nuevo insumo** (solo `admin`): nombre, categoría (7), unidad (7), stock
   mínimo opcional y "stock actual al registrar" opcional. Guarda con la RPC
   `fn_crear_insumo_con_stock_inicial` (§5).

## 3. Galpón, poza y lote en movimientos

`galpon_id` es el alcance principal. `poza_id`/`lote_id` son detalle opcional
y la base permite ambos a la vez; el contrato no inventa una exclusión.
**Efecto sobre el FCR (hecho comprobado, no cambia con esta tarea):**
`vw_pecuario_seguimiento_lote` suma solo salidas de insumos `categoria =
'alimento'` en `kg` con `lote_id` del lote dentro del período entre pesajes.
Un movimiento que solo lleva `galpon_id` queda registrado y descuenta stock,
pero **no** alimenta el FCR de ningún lote; para que cuente hay que elegir el
lote en el detalle. La pantalla lo debe avisar en el hint del detalle por
lote. Tampoco hay conversión de sacos (`saco_50kg`/`saco_40kg`) a kg: esos
insumos no entran al FCR (límite ya documentado en la migración de vistas).

## 4. Stock negativo: solo aviso

Sin guard en la base (decisión confirmada). Tras guardar una **salida**, la
pantalla compara el stock de la vista antes y después; si queda negativo,
muestra un aviso ("El stock quedó negativo — revisá si falta registrar alguna
entrada"), nunca bloquea ni revierte. Mismo criterio que la advertencia de
consanguinidad. El contrato Zod no valida stock (eso requiere consultar la
base).

## 5. Alta de insumo con stock inicial: RPC atómica

Llamada: `supabase.rpc('fn_crear_insumo_con_stock_inicial', {...})` con los
parámetros nombrados de la función: `p_insumo_id`, `p_id_organizacion`,
`p_nombre`, `p_categoria`, `p_unidad_medida`, `p_stock_minimo`, `p_activo`,
`p_device_id`, `p_created_offline_at`, `p_stock_inicial`, `p_movimiento_id`,
`p_galpon_id`. Contrato del payload: `InsumoAltaConStockInicialSchema`.

- `p_insumo_id` y `p_movimiento_id` son UUID v4 generados en el cliente.
- `p_device_id` y `p_created_offline_at` no tienen default en la función: el
  cliente debe enviarlos siempre (pueden ir `null`).
- Si `stock_inicial > 0`, `movimiento_id` es obligatorio (la RPC lo exige; el
  schema lo replica con un `refine`). El movimiento inicial es una `entrada`
  con la fecha de hoy fijada por la base (`CURRENT_DATE`), observación
  "Stock inicial al dar de alta el insumo" y el `galpon_id` opcional, que la
  RPC valida contra la organización.
- La RPC valida organización y rol `admin` dentro; se espera error si el
  nombre ya existe (`UNIQUE (ID_Organizacion, nombre)`), que la pantalla
  traduce a "Ya existe un insumo con ese nombre".
- Sin `stock_inicial` (o 0) la RPC crea solo el insumo.

## 6. Contratos Zod — `lib/validations/pecuario.ts`

Nombres nuevos; **no se tocan** `InsumoSchema` ni `MovimientoInsumoSchema`
(`InsumoSchema` tiene consumidores reales en `tests/test_pecuario_validations_v4.mjs`
y `tests/test_pecuario_ventas_insumos_v4.py`; sus requisitos offline —
`id`, `device_id`, `created_offline_at` — no aplican a un INSERT directo con
sesión real).

- `InsumoCrearSchema`: `ID_Organizacion`, `nombre` (trim, 1–150), `categoria`
  (enum de 7, default `otro`), `unidad_medida` (enum de 7, default `unidad`),
  `stock_minimo` (≥ 0, opcional/null), `activo` (default true).
- `MovimientoInsumoCrearSchema`: `ID_Organizacion`, `insumo_id`,
  `tipo_movimiento`, `cantidad` (> 0), `fecha` (`YYYY-MM-DD`), `galpon_id`,
  `poza_id`, `lote_id` (opcionales/null, sin exclusión mutua),
  `observaciones` (≤ 500).
- `InsumoAltaConStockInicialSchema`: `InsumoCrearSchema` + `insumo_id`,
  `stock_inicial` (≥ 0, opcional), `movimiento_id`, `galpon_id`, `device_id`,
  `created_offline_at` (opcionales/null), con la regla "stock_inicial > 0 exige
  `movimiento_id`".

## 7. Recortes y fuera de alcance

- Sin "Deshacer" ni contador de sesión del mockup (UI de simulador).
- Sin alertas de "bajo el mínimo" en Inicio (corresponde al Panel de
  indicadores).
- Sin editar ni desactivar insumos (el mockup solo da de alta); el borrado
  físico lo bloquea `ON DELETE RESTRICT` si hay movimientos.
- Sin conversión de unidades ni suma automática al historial de alimento del
  lote que hace el simulador: en la base, el FCR sale de los movimientos (§3).
- Laguna preexistente fuera de alcance: la policy de INSERT de movimientos
  no valida que `insumo_id`/`poza_id`/`lote_id`/`galpon_id` sean de la misma
  organización (nota de backlog en `AI_STATE.md`, candidato a ADR).

## 8. Estado

Contratos escritos y revisados con `tsc --noEmit`, Jest 97/97 (incluye 9 tests
temporales de los contratos nuevos, no commiteados por salirse del alcance de
esta tarea), `tests/test_pecuario_validations_v4.mjs` 10/10 y los tests
estáticos de Sanidad sin cambios. No hay pantalla ni prueba en dispositivo; la
migración no está confirmada como aplicada.
