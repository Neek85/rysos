# Spec — App Granja Valencia: Registrar venta

## 0. Backend real confirmado (recon previo + confirmación adicional en esta tarea)

`PECUARIO_VENTAS` (19 columnas, ver recon conjunto de Pesaje/Traslado/
Venta) y `PECUARIO_VENTAS_SUBPRODUCTOS` (14 columnas, tabla
independiente, sin FK hacia lotes/reproductores/`PECUARIO_VENTAS`, sin
triggers). Dos triggers reales sobre `PECUARIO_VENTAS`:
`trg_calcular_precio_total_venta` (`BEFORE INSERT OR UPDATE`) y
`trg_dar_baja_animal_por_venta` (`AFTER INSERT`, solo actúa si
`animal_id IS NOT NULL` — gap real de `cantidad_actual` en venta de
lote, ya confirmado en el recon, decisión de fix ya tomada con Neyser:
ver §3).

**`fn_calcular_precio_total_venta` — leída completa, no asumida:**

```sql
IF NEW.base_precio = 'por_kg' AND NEW.peso_total_kg IS NOT NULL AND NEW.precio_kg IS NOT NULL THEN
  NEW.precio_total := ROUND(NEW.peso_total_kg * NEW.precio_kg, 2);
ELSIF NEW.precio_unitario IS NOT NULL THEN
  NEW.precio_total := ROUND(NEW.cantidad * NEW.precio_unitario, 2);
END IF;
-- si ninguna de las 2 condiciones se cumple, NEW.precio_total queda
-- exactamente como lo mandó el cliente -- no hay rama ELSE.
```

**Respuesta a 0.a — el mockup SÍ es real, se construye tal cual:**

- **`base_precio='por_kg'`** (solo válido con `tipo_salida='pelado_beneficiado'`,
  y en ese caso `chk_ventas_base_precio_coherente` ya exige
  `peso_total_kg`/`precio_kg` no nulos): la rama `IF` **siempre** se
  cumple — el servidor recalcula `precio_total` siempre, cualquier
  valor que mande el cliente se pisa. No hay modo "total directo" para
  este camino.
- **`base_precio='por_animal'`** (cualquier `tipo_salida`) **y
  `precio_unitario` presente**: la rama `ELSIF` se cumple —
  `precio_total = cantidad × precio_unitario`, recalculado siempre,
  cualquier valor del cliente se pisa igual.
- **`base_precio='por_animal'` y `precio_unitario` vacío**: **ninguna**
  rama se cumple — el trigger no toca `precio_total` en absoluto. El
  valor que el cliente mandó en el `INSERT` es exactamente el que
  queda guardado. **Este es el modo "acordar un total directo sin
  precio por unidad" del mockup — es real, el backend lo soporta, se
  construye la opción.**

**Respuesta a 0.b:** `precio_total` es **`NOT NULL`, sin `DEFAULT`**
(confirmado en vivo) — el cliente **siempre** debe incluirlo en el
`INSERT`, nunca puede omitirlo. En los 2 caminos de auto-cálculo, el
cliente manda su propio preview (misma fórmula, redundante pero
inofensivo, ya que el trigger lo pisa con el mismo resultado). En el
modo "total directo", lo que el cliente manda **es** el valor real, sin
redundancia posible — por eso ese campo se vuelve editable solo en ese
modo específico.

**Hallazgo colateral, fuera de alcance:** `poza_id` (columna real de
`PECUARIO_VENTAS`) **no tiene ninguna FK** (confirmado: solo 3 FKs
reales en la tabla — `animal`, `lote`, `org` — ninguna para `poza_id`).
No se usa en esta pantalla (mismo criterio ya aplicado en Pesaje: sin
selector de poza, el campo queda `NULL`), y no se repara el gap de FK
faltante — no pedido, no se toca.

## 1. Cierre del hallazgo abierto de Pesaje (§2.12 del roadmap)

`PECUARIO_LOTES.estado` nunca cambia automáticamente al vender o
trasladar un lote hasta dejarlo en 0 — no hay ningún trigger que lo
haga. Ahora que Venta puede llevar `cantidad_actual` a 0 de verdad, se
agrega `.gt('cantidad_actual', 0)` al query de "listar lotes" en las 3
pantallas que ya seleccionan lotes para actuar sobre ellos:

- `pesaje/registrar.tsx` (el que ya existía, ahora con el filtro).
- `traslado/registrar.tsx` (idem).
- `venta/registrar.tsx` (nuevo, con el filtro desde el arranque).

**No se toca** la consulta de `pozas/[id].tsx` (lista los lotes de una
poza para *ver* su ficha/historial, no para elegir uno para actuar —
un lote en 0 sigue siendo parte del historial real de esa poza) ni la
de `sugerirCodigoLoteNuevo` en Traslado (necesita **todos** los
`codigo_lote` alguna vez usados, incluidos los que llegaron a 0, para
calcular bien el siguiente correlativo).

Sin tests existentes que dependan de la forma exacta de esas 2
consultas (los tests Jest de Pesaje/Traslado son puramente de
`PesajeSchema`/`TrasladoSchema`, no tocan Supabase) — confirmado, no
se rompe nada.

## 2. Alcance de la pantalla

### "¿Qué se vende?"

Chip: "Animales" (default) / "Guano (subproducto)" — mismo patrón del
mockup.

### Venta de Animales

- **Modo**: chip "Lote (poblacional)" (default) / "Reproductor
  identificado" — mismo patrón ya usado en Traslado.
- **Modo Lote**: selector de lote (chips, `cantidad_actual` real, con
  el filtro del §1 ya aplicado). **Cantidad a vender**: `Stepper`, `max`
  = `cantidad_actual` del lote elegido, mismo criterio de defensa que
  Pesaje/Traslado (tope visual + validación explícita antes del
  `INSERT`, acá **sin** respaldo real en la base — a diferencia de
  Traslado, ningún trigger valida `cantidad` contra `cantidad_actual`
  en `PECUARIO_VENTAS`, así que esta validación de cliente es la
  **única** barrera, mismo nivel de riesgo que Pesaje).
- **Modo Reproductor**: picker por código de arete (mismo patrón de
  Traslado/Parto — texto de búsqueda + chips, sin QR). Cantidad fija en
  `1`, no editable (mockup: "la cantidad queda fija en 1").
- **Tipo de salida**: chip — Carne / Pie de cría / Reproductor de saca
  / Pelado (beneficiado). **Nunca "guano"** — ese valor del enum
  `tipo_venta_cuy` es un vestigio inerte desde que el guano pasó a su
  tabla propia (confirmado: 0 filas históricas con ese valor,
  `VentaRegistroSchema` ya lo retiró de su propio enum también).
- **Si `tipo_salida='pelado_beneficiado'`**: aparece "Base del precio"
  (chip: Por kilogramo / Por animal — default Por animal, igual que el
  mockup). Con "Por kilogramo": campos **Peso vivo antes del
  beneficio (kg)** y **Peso total (kg)** se vuelven obligatorios (real,
  por `chk_ventas_base_precio_coherente`) y el **Rendimiento de
  carcasa** se muestra como `computed-box` de solo lectura —
  replicando en el cliente la misma fórmula de la columna `GENERATED`
  real (`peso_total_kg / peso_vivo_pre_beneficio_kg * 100`, redondeada
  a 1 decimal) solo para feedback visual; nunca se manda en el
  `INSERT` (columna `GENERATED ALWAYS`, igual criterio que
  `peso_promedio_g` en Pesaje).
- **Precio**: si `base_precio='por_kg'`, el campo es "Precio por
  kilogramo (S/ por kg)", obligatorio. Si `base_precio='por_animal'`,
  el campo es "Precio individual (S/ por animal)", **opcional** — y
  cuando se deja vacío, **"Precio total (S/)" se vuelve editable** (el
  modo real confirmado en §0). Cuando hay precio individual (o
  precio/kg), "Precio total" es un `computed-box` de solo lectura,
  recalculado en vivo con la misma fórmula que usará el servidor.
- **Peso total (kg)**: campo aparte y puramente referencial cuando
  `base_precio='por_animal'` (mismo criterio del mockup — "la venta se
  comercializa por animal, no por peso"); se convierte en el campo
  obligatorio de arriba cuando `base_precio='por_kg'` (mismo campo de
  la tabla, dos roles distintos según el modo, igual que el mockup).
- **Comprador (opcional)**: texto libre. **Nunca se hace `console.log`
  de este campo ni de nada que lo contenga** — PII de un tercero, regla
  inviolable del proyecto.
- **Guardar**: `INSERT` en `PECUARIO_VENTAS`. Si `lote_id` está
  seteado, inmediatamente después se hace un `UPDATE` explícito
  `cantidad_actual = cantidad_actual - cantidad` sobre ese lote — fix
  ya decidido con Neyser (ver §3), no atómico, mismo patrón y mismo
  riesgo ya aceptado en Destete. Si `animal_id` está seteado, no hace
  falta ningún paso extra — `trg_dar_baja_animal_por_venta` da de baja
  al reproductor solo.

### Venta de Guano

Fecha, producto (fijo "Guano", único valor real del enum
`tipo_subproducto_pecuario`), cantidad, unidad (chip: Sacos / Kg —
enum `unidad_venta_subproducto` real), precio total (opcional — la
columna real es nullable, a diferencia de `PECUARIO_VENTAS`), galpón de
origen (opcional, chips de `PECUARIO_GALPONES` de la organización —
"solo para referencia, el guano no se rastrea por poza ni por lote"),
comprador (opcional, mismo criterio de PII que arriba). `INSERT` directo
en `PECUARIO_VENTAS_SUBPRODUCTOS` — tabla independiente, sin ningún
paso adicional (sin trigger, sin `cantidad_actual` que tocar).

## 3. Fix decidido — `cantidad_actual` en venta de lote (no atómico)

Decisión ya tomada con Neyser, no se reabre: el cliente hace
```
UPDATE "PECUARIO_LOTES" SET cantidad_actual = cantidad_actual - :cantidad WHERE id = :lote_id
```
inmediatamente después del `INSERT` exitoso en `PECUARIO_VENTAS`. Dos
escrituras separadas, no atómicas — si la segunda falla después de que
la primera ya se confirmó, `PECUARIO_VENTAS` queda con una fila real
pero `cantidad_actual` no se descuenta (inconsistencia posible, mismo
riesgo aceptado ya en Destete al conformar lotes, por la ausencia de
Server Actions/RPC transaccional en esta app). No se agrega ningún
mecanismo de compensación — está fuera de alcance, documentado tal
cual, no se reconsidera.

## 4. Contrato de datos (Zod) — `lib/validations/pecuario.ts`

**Nombres nuevos, a propósito NI `VentaRegistroSchema` NI
`VentaSubproductoSchema`.** Ambos ya existen y tienen consumidores
reales activos (`tests/test_pecuario_venta_pelado_beneficiado.py` y
`tests/test_pecuario_venta_subproductos_guano.py`, que parsean este
archivo de forma estática) — no se tocan. Ambos exigen además
`id`/`device_id`/`created_offline_at` (diseño de sync offline que
ninguna pantalla de esta app usa). Mismo criterio y misma resolución ya
aplicada en Traslado con `TrasladoRegistroSchema`/`TrasladoSchema`.

`VentaAnimalSchema` (para `PECUARIO_VENTAS`) mirror-ea exactamente las
mismas reglas cruzadas reales de `VentaRegistroSchema` (XOR
`lote_id`/`animal_id`, `cantidad=1` en venta individual, `base_precio`
coherente con `tipo_salida`), sin los campos offline:

```ts
export const VentaAnimalSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  fecha_venta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  tipo_salida: z.enum(['carne', 'pie_cria', 'reproductor_saca', 'pelado_beneficiado']),
  cantidad: z.number().int().positive(),
  precio_unitario: z.number().nonnegative().optional().nullable(),
  peso_total_kg: z.number().positive().optional().nullable(),
  precio_total: z.number().nonnegative(),
  comprador_nombre: z.string().max(150).optional().nullable(),
  base_precio: z.enum(['por_animal', 'por_kg']).default('por_animal'),
  precio_kg: z.number().nonnegative().optional().nullable(),
  peso_vivo_pre_beneficio_kg: z.number().positive().optional().nullable(),
})
  .refine((d) => !!d.animal_id !== !!d.lote_id, { ... })
  .refine((d) => !d.animal_id || d.cantidad === 1, { ... })
  .refine((d) => d.base_precio === 'por_animal' || d.tipo_salida === 'pelado_beneficiado', { ... })
  .refine((d) => d.base_precio !== 'por_kg' || (d.peso_total_kg != null && d.precio_kg != null), { ... })
  .refine((d) => d.base_precio !== 'por_animal' || d.precio_kg == null, { ... });
```

Sin `rendimiento_carcasa_pct` (GENERATED, nunca se manda) ni
`id`/`device_id`/`created_offline_at`.

`VentaGuanoSchema` (para `PECUARIO_VENTAS_SUBPRODUCTOS`), mismo
criterio, sin campos offline:

```ts
export const VentaGuanoSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  producto: z.literal('guano').default('guano'),
  cantidad: z.number().positive(),
  unidad: z.enum(['sacos', 'kg']),
  precio_total: z.number().nonnegative().optional().nullable(),
  galpon_id: z.string().uuid().optional().nullable(),
  comprador_nombre: z.string().max(150).optional().nullable(),
});
```

No se usó `z.discriminatedUnion` por el mismo motivo ya documentado en
Traslado: dos ramas comparten el mismo valor de discriminante potencial
(`tipo_origen`/modo) con reglas distintas por debajo (`alcance` en
Traslado, `base_precio`/`tipo_salida` acá) — Zod no anida limpiamente
un discriminated union dentro de otro con el mismo valor repetido. Un
solo `z.object()` + `.refine()` en cascada, igual que
`VentaRegistroSchema`, mantiene la consistencia del archivo.

## 5. Pantalla

`apps/granja-valencia/src/app/(protegido)/venta/registrar.tsx`. Reusa
`BackToInicioButton`, `Chip`, el `Stepper` local con `max` (mismo
patrón de Pesaje/Traslado).

## 6. Navegación

Ruta nueva `venta/registrar` agregada a `(protegido)/_layout.tsx`. El
tile "Venta" de Inicio, que hoy apunta a `/proximamente/[title]`, pasa
a apuntar a `/venta/registrar`.

## 7. Estado

Construido y verificado (`tsc --noEmit`, tests Zod, bundle real vía
`curl`, prueba en vivo contra GRANJA-TEST). Pendiente la prueba manual
final de Neyser en dispositivo real — no se considera "cerrado" hasta
esa confirmación, mismo criterio que el resto de las pantallas de esta
app.
