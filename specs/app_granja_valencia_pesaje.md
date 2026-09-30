# Spec — App Granja Valencia: Registrar pesaje

## 0. Backend real confirmado (recon previo + confirmación adicional en esta tarea)

`PECUARIO_PESAJES` (13 columnas, sin hotfixes, FK a `PECUARIO_LOTES` ON DELETE
CASCADE, sin `animal_id` — solo modo lote/muestra, consistente con el mockup
que tampoco ofrece un modo "Reproductor identificado" para Pesaje).

**Corrección a una suposición del recon anterior** (esa recon no llegó a
revisar `generation_expression` para esta tabla — solo lo había hecho para
`PECUARIO_VENTAS.rendimiento_carcasa_pct`): confirmado en vivo con
`information_schema.columns`:

- `peso_promedio_g` **SÍ es `GENERATED ALWAYS`**:
  `peso_total_muestra_g / NULLIF(animales_muestreados, 0)`. El cliente
  **nunca** debe enviarla en el `INSERT` — Postgres la calcula sola
  (enviarla explícitamente fallaría, `GENERATED ALWAYS` rechaza valores a
  menos que se use `OVERRIDING SYSTEM VALUE`, que no se usa acá).
- `ganancia_diaria_estimada_g` **NO es generada** — columna plana,
  nullable, `is_generated = 'NEVER'`. El cliente debe calcularla e
  insertarla explícitamente (o mandar `null`).

**Hallazgo importante sobre `vw_pecuario_seguimiento_lote`** (confirmado con
`pg_get_viewdef`): la vista **no lee la columna `ganancia_diaria_estimada_g`
en absoluto**. Calcula su propio `ganancia_diaria_g` desde cero, comparando
los dos `peso_promedio_g` más recientes de cada lote (CTE `pesajes_ranked`,
`ROW_NUMBER() OVER (PARTITION BY lote_id ORDER BY fecha_pesaje DESC,
created_at DESC)`, tomando `rn=1` como reciente y `rn=2` como anterior).
Esto significa que la columna `ganancia_diaria_estimada_g` guardada en cada
fila es un valor de referencia at-the-time-of-insert (útil para
trazabilidad/offline), pero **el panel de indicadores real (FCR, ganancia
total del período) no depende de que el cliente la calcule bien** — la
vista la recalcula siempre, de forma independiente, con la misma lógica que
esta pantalla debe replicar al insertar.

**Baseline para el primer pesaje de un lote — confirmado, no asumido:**

- `PECUARIO_CONFIGURACION` no tiene ninguna columna de peso/línea base
  (confirmado: `dias_lactancia_destete, max_partos_madre,
  min_crias_vivas_parto_temprano, dias_frecuencia_desinfeccion,
  alerta_consanguinidad_activa, generaciones_consanguinidad` — nada de
  peso).
- El "+ Registrar peso de este lote (opcional)" del mockup de Destete
  (Paso 2) **quedó fuera de alcance** en la pantalla real de Destete — no
  se implementó (ver `specs/app_granja_valencia_destete.md`).
- Confirmado en vivo: `SELECT count(*) FROM "PECUARIO_PESAJES"` → `0`.
  Ningún lote real tiene todavía un primer pesaje.
- **Conclusión: no existe ninguna línea base real.** El primer pesaje de
  un lote (sin pesaje anterior en `PECUARIO_PESAJES`) guarda
  `ganancia_diaria_estimada_g = NULL`. No se inventa ninguna fórmula
  alternativa.

**Para el segundo pesaje en adelante:** se busca el pesaje más reciente
anterior del mismo `lote_id` con
`SELECT fecha_pesaje, peso_promedio_g FROM "PECUARIO_PESAJES" WHERE
lote_id = :lote_id ORDER BY fecha_pesaje DESC, created_at DESC LIMIT 1`
(antes de insertar el nuevo). Si existe:
`ganancia_diaria_estimada_g = ROUND((peso_promedio_actual_g -
peso_promedio_anterior_g) / dias_transcurridos, 2)`, con
`dias_transcurridos = fecha_pesaje_actual - fecha_pesaje_anterior` (en
días). Si `dias_transcurridos <= 0` (mismo día o fecha inconsistente), se
guarda `NULL` — mismo criterio defensivo que usa la vista
(`CASE WHEN dias_periodo > 0 THEN ... ELSE NULL END`).

## 1. Alcance de la pantalla

Solo el flujo de "pesaje de seguimiento" (después del primero) que pide el
mockup (líneas ~1032-1072 del artifact) — pero a diferencia del mockup, que
asume que "el primer pesaje... se registra en Registrar destete", en la app
real **esta pantalla es también donde se registra el primer pesaje de un
lote** (por el punto 0: esa ruta opcional de Destete no existe). El hint
correspondiente del mockup no se replica tal cual — se documenta la
desviación acá en vez de mostrar un mensaje que no aplica a la app real.

Sin selector de poza — igual que la tabla real (`poza_id` queda `NULL` en
este flujo; solo se usa `lote_id`), y sin modo "Reproductor identificado"
(no existe columna `animal_id`, y el mockup tampoco lo ofrece para Pesaje).

Campos: selección de lote (chips, un lote a la vez), fecha, animales
muestreados (stepper, mínimo 1), peso total de la muestra en g (input
numérico), peso promedio por animal (computed-box de solo lectura — réplica
en el cliente de la misma fórmula `GENERATED`, solo para feedback inmediato;
el valor real que queda guardado lo calcula Postgres, no lo que se muestra
en pantalla), guardar.

## 2. Contrato de datos (Zod) — `lib/validations/pecuario.ts`

Nombre nuevo `PesajeSchema`, sin tocar los schemas existentes. **Nota de
transparencia** (mismo criterio que `RecoleccionDestemteSchema` /
`ConformarLoteDestemteSchema` en Destete): ya existía `PesajeLoteSchema`
(diseño especulativo de sync offline, `id`/`device_id`/`created_offline_at`
obligatorios, sin `peso_promedio_g` ni `ganancia_diaria_estimada_g`, cero
consumidores reales confirmado por grep). No hay colisión de nombre (el
prompt pidió explícitamente `PesajeSchema`, un nombre libre), así que se
deja intacto y coexistiendo — solo se documenta acá la superposición para
que quede visible.

```ts
export const PesajeSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  lote_id: z.string().uuid(),
  fecha_pesaje: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  animales_muestreados: z.number().int().positive({ message: 'Debe muestrear al menos 1 animal' }),
  peso_total_muestra_g: z.number().positive({ message: 'El peso debe ser mayor a 0' }),
  peso_promedio_g: z.number().positive(),
  ganancia_diaria_estimada_g: z.number().nullable(),
});
export type PesajeInput = z.infer<typeof PesajeSchema>;
```

`peso_promedio_g` va en el contrato Zod (para validar la forma del dato
calculado en el cliente antes de mostrarlo/usarlo en cálculos derivados),
pero **se excluye explícitamente del payload del `INSERT`** — mandarla
rompería contra la columna `GENERATED ALWAYS` real. Mismo patrón ya usado en
esta app para columnas derivadas que la base controla sola (acá al revés:
en vez de agregar un campo fuera del schema como `cantidad_actual` en
Destete, se valida con Zod pero se quita antes de tocar Supabase).

## 3. Pantalla

`apps/granja-valencia/src/app/(protegido)/pesaje/registrar.tsx`. Reusa
`BackToInicioButton`, `Chip`, un `Stepper` local (mismo patrón inline ya
usado en `parto/registrar.tsx` y `destete/registrar.tsx` — no se extrajo a
`components/ui/` en ninguna pantalla anterior, así que no se extrae acá
tampoco por consistencia).

- **Lote**: chips cargados desde `PECUARIO_LOTES` (`id, codigo_lote,
  cantidad_actual`) de la organización, ordenados por `created_at`. **No
  se filtra por `estado='activo'`** — corrección a una suposición de una
  tarea posterior que asumía que sí se filtraba así: confirmado leyendo el
  código real, la consulta nunca tuvo ese filtro (solo `ID_Organizacion`).
  `PECUARIO_LOTES.estado` sí existe como columna real (varchar, sin
  `CHECK`, todos los lotes actuales en `'activo'`), pero agregar ese
  filtro queda fuera del alcance de esta tarea — se deja como hallazgo
  abierto, no se decide unilateralmente. Tampoco se filtra por
  `cantidad_actual > 0` — un lote que llegó a 0 (vendido/trasladado
  completo) igual podría necesitar un pesaje de cierre; se deja sin filtrar
  y es una decisión de bajo riesgo, no bloqueante.
- **Fecha**: input de texto `AAAA-MM-DD`, default hoy — mismo patrón que
  Destete (sin date-picker nativo en ninguna pantalla anterior).
- **Animales muestreados**: `Stepper` min 1, default 1, **`max` = la
  `cantidad_actual` real del lote seleccionado** (ver §3.1).
- **Peso total de la muestra (g)**: input numérico.
- **Peso promedio (computed-box)**: `peso_total_muestra_g /
  animales_muestreados`, recalculado en vivo en cada cambio de cualquiera de
  los dos campos — react-side, puramente para feedback visual (ver §2).
- **Guardar**: antes de insertar, busca el pesaje anterior más reciente del
  lote elegido (query de §0) para resolver `ganancia_diaria_estimada_g`
  (`NULL` si no hay anterior o si `dias_transcurridos <= 0`). Inserta
  `{ ID_Organizacion, lote_id, fecha_pesaje, animales_muestreados,
  peso_total_muestra_g, ganancia_diaria_estimada_g }` — sin
  `peso_promedio_g` (columna generada, la excluye Postgres).

## 3.1 Tope de `animales_muestreados` contra `cantidad_actual` — vive 100% en el cliente

**Hallazgo real** (2026-09-29): la pantalla dejaba muestrear más animales
que los que el lote realmente tiene (ej. un lote con `cantidad_actual=2`
aceptaba `animales_muestreados=3`). Confirmado leyendo `PECUARIO_PESAJES`:
no hay ningún `CHECK` ni trigger que compare `animales_muestreados` contra
`PECUARIO_LOTES.cantidad_actual` — ni siquiera hay FK directa que permita
un `CHECK` entre tablas sin trigger. Esta regla **no tiene ningún respaldo
real en la base** y no puede tenerlo con un simple `CHECK` (requeriría un
trigger dedicado, que no existe); por eso vive enteramente del lado del
cliente, en dos capas independientes:

1. **Tope del stepper**: `max` = `cantidad_actual` del lote elegido. No se
   puede incrementar más allá con el botón "+". Al elegir un lote, si el
   valor ya cargado supera la `cantidad_actual` del lote nuevo, se ajusta
   hacia abajo a `min(valor_actual, cantidad_actual)` automáticamente
   (cubre tanto la selección inicial como un cambio de lote a mitad de
   captura).
2. **Validación explícita antes de `INSERT`**: no se confía solo en el
   tope del stepper (que es una restricción de UI, no del dato en sí) —
   justo antes de guardar se vuelve a comparar `animales_muestreados` con
   la `cantidad_actual` real del lote seleccionado. Si la excede, se
   bloquea con el mensaje real `"No puedes muestrear más de los N
   animales que tiene el lote."` (N = `cantidad_actual`), sin llegar a
   tocar Supabase.

Si `cantidad_actual` fuera `null` (no debería pasar — todo lote real que
pasa por Destete lo manda explícito desde el fix de
`specs/app_granja_valencia_destete.md` §6 — pero no hay `NOT NULL` a nivel
de columna que lo garantice), ninguna de las dos capas aplica tope: se
prefiere no bloquear con un dato ausente antes que inventar un límite
falso.

## 4. Navegación

Ruta nueva `pesaje/registrar` agregada a
`(protegido)/_layout.tsx`. El tile "Pesaje" de Inicio, que hoy apunta a
`/proximamente/[title]`, pasa a apuntar a `/pesaje/registrar` — mismo
patrón de activación ya aplicado para Parto/Destete/Empadre al construir
cada pantalla real.

## 5. Estado

Construido y verificado (`tsc --noEmit`, tests Zod, bundle real vía
`curl`). Pendiente la prueba manual final de Neyser en dispositivo real —
no se considera "cerrado" hasta esa confirmación, mismo criterio que el
resto de las pantallas de esta app.
