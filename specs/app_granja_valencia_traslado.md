# Spec — App Granja Valencia: Registrar traslado

## 0. Backend real confirmado (recon previo + confirmación adicional en esta tarea)

`PECUARIO_TRASLADOS` (18 columnas, sin hotfixes de lógica de negocio — el
único "fix" real fue un `CHECK` agregado después,
`chk_traslados_lote_nuevo_solo_parcial`, ver recon de Pesaje/Traslado/
Venta). Trigger `trg_traslados_procesar` (`BEFORE INSERT`) ejecuta
`trg_procesar_traslado()`.

**Confirmado leyendo la función real, no asumido:**

- **`origen_jaula_id` lo resuelve el trigger, 100% del lado del
  servidor** — el cliente nunca lo manda (y si lo mandara, se
  sobreescribe igual, porque el trigger hace
  `SELECT ... poza_actual_id INTO NEW.origen_jaula_id FROM
  "PECUARIO_LOTES" WHERE id = NEW.lote_id` en modo lote, o
  `SELECT ... jaula_actual_id INTO NEW.origen_jaula_id FROM
  "PECUARIO_REPRODUCTORES" WHERE id = NEW.animal_id` en modo
  reproductor, siempre, sin condicional `IF NEW.origen_jaula_id IS
  NULL`). El schema Zod de esta pantalla no incluye este campo.
- **`destino_jaula_id` no tiene ninguna restricción real por
  `tipo_uso`** — la única validación que hace el trigger sobre el
  destino es que pertenezca a la misma organización (`RAISE EXCEPTION`
  si no). No hay ningún `CHECK`/FK que impida, por ejemplo, mover un
  lote de `recria` a una jaula `tipo_uso='empadre'`. **No se inventa
  esa restricción en el cliente** — si Neyser la quiere más adelante,
  es una decisión de producto explícita, no algo que este código deba
  adivinar.
- **`cantidad` (traslado parcial) sí tiene un guard real en el
  trigger** (`IF NEW.cantidad > v_cantidad_actual THEN RAISE
  EXCEPTION`) — a diferencia de Pesaje (que no tenía ningún respaldo
  real), acá el servidor ya rechaza un traslado parcial que exceda la
  `cantidad_actual` del lote origen. El tope del lado del cliente (ver
  §3) es una mejora de UX (feedback inmediato, sin ida y vuelta a la
  red) y una segunda capa de defensa, no la única barrera como en
  Pesaje.
- **`chk_traslados_origen_destino_distintos`** (`origen_jaula_id IS
  DISTINCT FROM destino_jaula_id`) es real — la pantalla excluye la
  jaula/poza de origen de la lista de chips de destino, para no ofrecer
  una opción que el servidor rechazaría.
- El trigger también da de baja/mueve todo lo demás sin ningún gap:
  traslado parcial crea el lote nuevo (`cantidad_inicial`/
  `cantidad_actual` = `NEW.cantidad`) y decrementa el lote origen;
  traslado completo solo mueve `poza_actual_id`; modo reproductor solo
  mueve `jaula_actual_id`. El cliente nunca calcula ni escribe
  `cantidad_actual` a mano en esta pantalla (a diferencia del hallazgo
  crítico documentado para Venta poblacional en el recon previo).

## 1. Alcance de la pantalla

Ambos modos del mockup, incluidos desde el arranque (a diferencia de
Parto, que recortó a un solo modo): "Lote (poblacional)" y "Reproductor
identificado" — ambos con respaldo real completo en el esquema
(columnas, `CHECK`s XOR, trigger que resuelve cada rama).

### Selector de modo

Chip, mismo patrón que Mortalidad/Venta del mockup: "Lote (poblacional)"
(default) / "Reproductor identificado".

### Modo Lote

- **Lote**: chips cargados desde `PECUARIO_LOTES` (`id, codigo_lote,
  poza_actual_id, cantidad_actual`) de la organización — mismo query
  base que ya existe en Pesaje, con `poza_actual_id` agregado para
  mostrar la poza actual junto al código (`L-004 (R-01)`, resuelto
  contra el mapa de `PECUARIO_JAULAS` cargado para toda la pantalla).
- **¿Cuánto se traslada?**: chip "Todo el lote" (default, `alcance =
  'completo'`) / "Una parte" (`alcance = 'parcial'`).
  - Si "Una parte": **cantidad a trasladar** (`Stepper`, mismo criterio
    que el hallazgo de Pesaje — `max` = `cantidad_actual` real del
    lote origen, hint "Máximo disponible en el lote: N", más
    validación explícita antes del `INSERT` como defensa adicional del
    lado del cliente, aunque el trigger también la rechazaría) +
    **código del lote nuevo** (input + botón "Sugerir", mismo
    mecanismo real que Destete: consulta el máximo `codigo_lote`
    existente de la organización con la forma `L-NNN` y sugiere el
    siguiente correlativo — nunca un contador hardcodeado).
  - Si "Todo el lote": sin cantidad ni código nuevo.
  - Si el usuario cambia de lote después de haber ingresado una
    cantidad, se revalida/ajusta hacia abajo contra la `cantidad_actual`
    del lote nuevo (mismo criterio ya aplicado en Pesaje al cambiar de
    lote).

### Modo Reproductor

- Picker por código de arete (mismo patrón ya construido en
  Parto/Empadre: `TextInput` de búsqueda + chips filtrables, sin QR).
  A diferencia de Parto (que solo lista hembras), acá se listan
  reproductores de **ambos sexos**, activos, con `jaula_actual_id`
  no nulo (un reproductor sin jaula asignada no tiene un origen real
  que trasladar — ese caso es responsabilidad de Empadre, no de esta
  pantalla).

### Destino (ambos modos)

Chips de `PECUARIO_JAULAS` de la organización, **excluyendo la
jaula/poza de origen** (la del lote o del reproductor elegido) — real
por `chk_traslados_origen_destino_distintos` (ver §0). Sin filtrar por
`tipo_uso` (ver §0 — no hay restricción real que respaldar).

### Resto de los campos (ambos modos)

- **Fecha**: input de texto `AAAA-MM-DD`, default hoy.
- **Motivo**: chip, enum `motivo_traslado_pecuario` confirmado:
  "Enfermedad / aislamiento" (`enfermedad_aislamiento`, default,
  mismo orden que el mockup), "Recomposición de poza"
  (`recomposicion_poza`), "Sobrepoblación" (`sobrepoblacion`), "Otro"
  (`otro`).
- **Observaciones**: textarea, opcional.

## 2. Contrato de datos (Zod) — `lib/validations/pecuario.ts`

**Nombre nuevo `TrasladoSchema` — a propósito, NO `TrasladoRegistroSchema`.**
Ya existe `TrasladoRegistroSchema` en este archivo, pero a diferencia de
`PartoRegistroSchema` (que se pudo renombrar libremente porque no tenía
ningún consumidor real) `TrasladoRegistroSchema` **sí tiene un
consumidor real activo**: `tests/test_pecuario_traslado_interno.py::
TestZodContract` parsea este archivo de forma estática y falla si el
nombre, la ausencia de `origen_jaula_id`/`lote_nuevo_id`, o las 3
cadenas exactas de sus `.refine()` cambian. Además, `TrasladoRegistroSchema`
exige `id`/`device_id`/`created_offline_at` (diseño de sync offline,
nunca usado por ninguna pantalla de esta app) como campos obligatorios,
así que tampoco encaja tal cual para un `INSERT` online-first real. Por
eso: **no se toca `TrasladoRegistroSchema`** (su test sigue pasando sin
cambios) y se agrega un schema nuevo, sin colisión de nombre, para el
contrato real de esta pantalla.

**Forma elegida: un solo `z.object()` + `.refine()` en cascada**, no un
discriminated union anidado — mismo patrón que ya usan en este archivo
tanto `TrasladoRegistroSchema` como `MortalidadRegistroSchema` para
exactamente este tipo de regla cruzada (XOR + condicionales por
`alcance`). Un discriminated union de Zod no anida limpiamente dos
schemas con el mismo valor de discriminante (`tipo_origen: 'lote'` para
completo Y parcial a la vez) sin envolver una unión dentro de otra, lo
que Zod no soporta de forma directa para `z.discriminatedUnion` — la
alternativa (`z.union` de 3 objetos planos) es funcionalmente
equivalente pero da peores mensajes de error. Se prioriza consistencia
con el resto del archivo.

```ts
export const TrasladoSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  tipo_origen: z.enum(['lote', 'reproductor']),
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  destino_jaula_id: z.string().uuid(),
  alcance: z.enum(['completo', 'parcial']).optional().nullable(),
  cantidad: z.number().int().positive().optional().nullable(),
  codigo_lote_nuevo: z.string().min(1).max(50).optional().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  motivo_traslado: z.enum(['enfermedad_aislamiento', 'recomposicion_poza', 'sobrepoblacion', 'otro']),
  observaciones: z.string().max(500).optional().nullable(),
})
  .refine((d) => d.tipo_origen !== 'lote' || (d.lote_id != null && d.animal_id == null), {
    message: 'Traslado de lote requiere lote_id y no debe traer animal_id', path: ['lote_id'],
  })
  .refine((d) => d.tipo_origen !== 'reproductor' || (d.animal_id != null && d.lote_id == null), {
    message: 'Traslado de reproductor requiere animal_id y no debe traer lote_id', path: ['animal_id'],
  })
  .refine((d) => d.tipo_origen !== 'lote' || d.alcance != null, {
    message: 'Traslado de lote requiere indicar alcance (completo/parcial)', path: ['alcance'],
  })
  .refine((d) => d.tipo_origen !== 'reproductor' || (d.alcance == null && d.cantidad == null && d.codigo_lote_nuevo == null), {
    message: 'Traslado de reproductor no debe traer alcance/cantidad/codigo_lote_nuevo', path: ['alcance'],
  })
  .refine((d) => d.alcance !== 'parcial' || (d.cantidad != null && d.cantidad > 0 && !!d.codigo_lote_nuevo), {
    message: 'Traslado parcial requiere cantidad > 0 y código del lote nuevo', path: ['cantidad'],
  })
  .refine((d) => d.alcance !== 'completo' || (d.cantidad == null && d.codigo_lote_nuevo == null), {
    message: 'Traslado completo no debe traer cantidad ni código de lote nuevo', path: ['cantidad'],
  });
export type TrasladoInput = z.infer<typeof TrasladoSchema>;
```

Sin `origen_jaula_id` ni `lote_nuevo_id` (los resuelve el trigger, §0).
Sin `id`/`device_id`/`created_offline_at` (esta app no hace sync
offline, ninguna otra pantalla los usa).

## 3. Pantalla

`apps/granja-valencia/src/app/(protegido)/traslado/registrar.tsx`.
Reusa `BackToInicioButton`, `Chip`, un `Stepper` local con `max` (mismo
que se agregó en Pesaje).

- Carga, en un solo `useFocusEffect`: lotes (`id, codigo_lote,
  poza_actual_id, cantidad_actual`), reproductores activos con jaula
  asignada (`id, codigo_arete, jaula_actual_id`, ambos sexos) y jaulas
  (`id, codigo_poza`) de la organización.
- El origen (para excluirlo de los chips de destino) se deriva de la
  selección actual: `poza_actual_id` del lote elegido, o
  `jaula_actual_id` del reproductor elegido.
- Al guardar: valida con `TrasladoSchema`, valida además (defensa de
  cliente, ver §0) que `cantidad` no exceda `cantidad_actual` si
  `alcance='parcial'`, e inserta en `PECUARIO_TRASLADOS`. El mensaje de
  error de Postgres (incluido el del `RAISE EXCEPTION` del trigger si
  algo se escapa) se muestra tal cual, sin reescribirlo.

## 4. Navegación

Ruta nueva `traslado/registrar` agregada a `(protegido)/_layout.tsx`.
El tile "Traslado" de Inicio, que hoy apunta a `/proximamente/[title]`,
pasa a apuntar a `/traslado/registrar`.

## 5. Estado

Construido y verificado (`tsc --noEmit`, tests Zod, bundle real vía
`curl`, prueba en vivo contra GRANJA-TEST de los 3 escenarios: lote
parcial, lote completo, reproductor). Pendiente la prueba manual final
de Neyser en dispositivo real — no se considera "cerrado" hasta esa
confirmación, mismo criterio que el resto de las pantallas de esta app.
