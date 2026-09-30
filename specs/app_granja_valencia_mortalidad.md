# Spec — App Granja Valencia: Registrar mortalidad

## 0. Recon obligatorio (confirmado en vivo, no asumido)

**Nota sobre el prompt:** `claude/roadmap_granja_valencia_app_movil.md` **no
existe en este repo** (confirmado con `find`, buscado también en todo el
árbol de git) — no se pudo verificar el punto exacto del orden ("punto
6", "§3.1") que cita el prompt. No bloquea la tarea (el resto de las
instrucciones es autocontenido y verificable por otras vías), pero se
señala explícitamente en vez de fingir haberlo leído.

**a. `docs/schema_live_pecuario.md` + confirmación en vivo —
`PECUARIO_MORTALIDAD`** (14 columnas): `id, ID_Organizacion, poza_id
(nullable, SIN FK real — mismo gap ya visto en PECUARIO_VENTAS.poza_id,
no se repara, fuera de alcance), lote_id (nullable, FK real a
PECUARIO_LOTES), animal_id (nullable, FK real a PECUARIO_REPRODUCTORES),
fecha_evento (default CURRENT_DATE), cantidad (default 1, CHECK > 0),
etapa (enum etapa_productiva, NOT NULL), causa (enum causa_mortalidad,
default 'desconocido'), descripcion_sintomas, device_id,
created_offline_at, synced_at, created_at`.

CHECKs reales: `chk_mortalidad_cantidad` (`cantidad > 0`) y
`chk_mortalidad_individual_xor_poblacional`:
```sql
(animal_id IS NOT NULL AND lote_id IS NULL AND poza_id IS NULL)
OR
(animal_id IS NULL AND (lote_id IS NOT NULL OR poza_id IS NOT NULL))
```
— es decir, en modo poblacional puede ir `lote_id` y/o `poza_id`
(nunca junto con `animal_id`). **Hallazgo real, no inventado:** la
condición usa `OR` entre `lote_id`/`poza_id`, no un XOR — la base
técnicamente permite que ambos vengan seteados a la vez en modo
poblacional (un caso que el mockup nunca produce, porque solo ofrece
un único campo "Poza o lote afectado"). El contrato Zod de esta
pantalla (`MortalidadSchema`, §1) refleja esta misma permisividad real
tal cual — no se inventa una restricción XOR que la base no tiene.

**`PECUARIO_MORTALIDAD_FOTOS`** (v8, `20260923120000_..._evidencia_fotografica.sql`,
commit `5443d36`, ya cerrada): `id, ID_Organizacion, mortalidad_id` (FK
real a `PECUARIO_MORTALIDAD`, `ON DELETE CASCADE`), `storage_path`
(`UNIQUE`, convención real `{ID_Organizacion}/mortalidad/{mortalidad_id}/{filename}`),
`device_id, created_offline_at, synced_at, created_at`. Sin trigger.

**Enums reales** (`pg_enum`, no asumidos): `etapa_productiva` =
`lactancia, recria, engorde, reproductor`. `causa_mortalidad` =
`neumonia, distocia, aplastamiento, gastroenteritis, depredador,
desconocido (default), otro` — coinciden 1:1 con las 7 opciones del
`<select>` del mockup.

**b. ¿Algún trigger descuenta `cantidad_actual`?** Un solo trigger real
sobre esta tabla: `trg_dar_baja_animal_por_mortalidad` (`AFTER INSERT`)
→ `fn_dar_baja_animal_por_mortalidad()`, leída completa:
```sql
IF NEW.animal_id IS NOT NULL THEN
  UPDATE "PECUARIO_REPRODUCTORES"
  SET estado = 'muerto', jaula_actual_id = NULL, fecha_salida = NEW.fecha_evento, updated_at = now()
  WHERE id = NEW.animal_id;
END IF;
```
**Mismo gap exacto que en Venta** (`fn_dar_baja_animal_por_venta`):
solo actúa si `animal_id IS NOT NULL`. Cuando la mortalidad es de
`lote_id` (etapas recría/engorde), **ningún trigger real descuenta
`PECUARIO_LOTES.cantidad_actual`** — confirmado, no asumido. Fix: mismo
patrón ya usado en Venta — `UPDATE` explícito del cliente
(`cantidad_actual = cantidad_actual - cantidad`) inmediatamente después
del `INSERT`, no atómico, mismo riesgo ya aceptado en toda la vertical.
Cuando la mortalidad es de `poza_id` (etapas lactancia/reproductor sin
identificar), no hay ninguna columna de "población de la poza" real que
descontar en este esquema — solo queda el registro de auditoría, sin
ningún paso adicional.

**c. ¿`PECUARIO_REPRODUCTORES.estado` tiene `'muerto'`?** Sí —
confirmado (`pg_enum` de `estado_animal`: `activo, vendido, muerto,
enfermo`). **Mortalidad necesita los mismos 2 modos que Traslado/Venta**
("Poblacional" / "Reproductor identificado"), incluidos desde el
arranque — mismo criterio ya aplicado en esas 2 pantallas, no se acota
a un solo modo como en Parto.

**d. Mockup releído (líneas 1075-1166 del artifact)** — campos
confirmados, ninguno inventado, ninguno omitido:

- Selector de modo: "Poblacional" (default) / "Reproductor
  identificado" (chip).
- **Modo Poblacional**: "Etapa" (chip: Lactancia / Recría / Engorde /
  "Reproductor (sin identificar)" → enum `reproductor`), con el hint
  real "La etapa decide de dónde se descuenta — elegila primero"; luego
  "Poza o lote afectado" (chip, poblado según la etapa).
- **Modo Reproductor identificado**: picker por código de arete (mismo
  patrón que Traslado/Venta/Parto), con el hint real "Se da de baja
  automáticamente... no hace falta indicar cantidad".
- Fecha (ambos modos).
- Cantidad (stepper, min 1) — solo relevante en modo Poblacional (en
  modo Reproductor queda fija en 1, mismo criterio ya usado en
  Traslado/Venta para venta individual).
- Causa probable (`<select>` en el mockup → chip/lista en la app, mismo
  criterio de conversión ya usado en toda la app; default "Desconocida").
- Síntomas observados (opcional, textarea) → `descripcion_sintomas`.
- Fotos de evidencia (opcional, múltiples) → `PECUARIO_MORTALIDAD_FOTOS`.
- Guardar (botón en rojo/`danger` en el mockup — único botón `danger`
  de toda la app hasta ahora, se replica el color).

**Regla `etapa` → `poza_id`/`lote_id`, sin respaldo real en la base**
(ninguna FK/CHECK ata `etapa` a cuál de los dos campos se usa —
confirmado, no hay tercer CHECK más allá de los 2 ya listados): se
implementa como convención 100% de cliente, siguiendo la intención
literal del mockup — `lactancia` y `reproductor` (sin identificar) usan
`poza_id` (chips de `PECUARIO_JAULAS`, filtradas por `tipo_uso` acorde
—`maternidad` y `empadre` respectivamente, filtro de UX, no de
esquema); `recria` y `engorde` usan `lote_id` (chips de
`PECUARIO_LOTES` con `cantidad_actual > 0`, mismo filtro compartido ya
cerrado en Pesaje/Traslado/Venta).

**e. Librería de cámara/upload:** ni `expo-image-picker` ni
`expo-camera` ni `expo-file-system` estaban instalados (confirmado en
`package.json` y `node_modules`) — se instalan con `npx expo install`
(nunca `npm install` a mano, para resolver la versión compatible con el
SDK real del proyecto).

**Convención de Storage confirmada en vivo** (no inventada): bucket
`evidencias_pecuario` (`public=false`, 10MB, solo
`image/jpeg`/`image/png`/`image/webp`), 4 políticas RLS de
`storage.objects` que exigen `(storage.foldername(name))[1] =
auth_org_id()` — el primer segmento de la ruta debe ser exactamente el
`ID_Organizacion` real. Coincide exactamente con la convención ya
documentada: `{ID_Organizacion}/mortalidad/{mortalidad_id}/{filename}`.
Se sube primero el `INSERT` en `PECUARIO_MORTALIDAD` (para tener
`mortalidad_id` real), después cada foto a Storage, después una fila
por foto en `PECUARIO_MORTALIDAD_FOTOS`.

## 1. Contrato de datos (Zod) — `lib/validations/pecuario.ts`

**Nombres nuevos, sin tocar los existentes.** Dos colisiones
potenciales revisadas antes de escribir código:

- `MortalidadRegistroSchema` (ya existía, diseño especulativo de sync
  offline, `id`/`device_id`/`created_offline_at` obligatorios) —
  **cero consumidores reales** (confirmado por grep exhaustivo, igual
  que `PesajeLoteSchema`). No hay colisión de nombre forzada por esta
  tarea (a diferencia de Parto), así que se deja intacto y coexistiendo
  — se documenta acá la superposición por transparencia, mismo
  criterio ya usado con `PesajeLoteSchema`/`RecoleccionDestemteSchema`.
- `MortalidadFotoSchema` (ya existía) — **sí tiene un consumidor real
  activo** (`tests/test_pecuario_mortalidad_fotos.py`, que parsea este
  archivo de forma estática) y exige los mismos 3 campos offline. No se
  toca — mismo criterio ya aplicado con `TrasladoRegistroSchema`/
  `VentaRegistroSchema`/`VentaSubproductoSchema`.

```ts
export const MortalidadSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  poza_id: z.string().uuid().optional().nullable(),
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  fecha_evento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  cantidad: z.number().int().positive(),
  etapa: z.enum(['lactancia', 'recria', 'engorde', 'reproductor']),
  causa: z.enum(['neumonia', 'distocia', 'aplastamiento', 'gastroenteritis', 'depredador', 'desconocido', 'otro']).default('desconocido'),
  descripcion_sintomas: z.string().max(500).optional().nullable(),
})
  .refine((d) => !!d.animal_id !== (!!d.lote_id || !!d.poza_id), {
    message: 'Debe indicar un animal identificado O un lote/poza, no ambos ni ninguno.', path: ['animal_id'],
  })
  .refine((d) => !d.animal_id || d.cantidad === 1, {
    message: 'La mortalidad de un animal identificado es siempre de cantidad 1.', path: ['cantidad'],
  });
export type MortalidadInput = z.infer<typeof MortalidadSchema>;

export const MortalidadFotoInsertSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  mortalidad_id: z.string().uuid(),
  storage_path: z.string().min(1),
});
export type MortalidadFotoInsertInput = z.infer<typeof MortalidadFotoInsertSchema>;
```

## 2. Pantalla

`apps/granja-valencia/src/app/(protegido)/mortalidad/registrar.tsx`.
Reusa `BackToInicioButton`, `Chip`, el `Stepper` local con `max`
(cantidad solo se topa contra `cantidad_actual` cuando el origen es un
lote — misma defensa de cliente que Venta, sin respaldo real en la
base).

Flujo: modo → (Poblacional: etapa → poza/lote según etapa; Reproductor:
picker por código) → fecha → cantidad (fija en 1 si es individual) →
causa → síntomas (opcional) → fotos (opcional, `expo-image-picker`) →
guardar. Al guardar: `INSERT` en `PECUARIO_MORTALIDAD`; si `lote_id` fue
el origen, `UPDATE` explícito de `cantidad_actual` (spec §0.b); si hubo
fotos, cada una se sube a `evidencias_pecuario` y se inserta su fila en
`PECUARIO_MORTALIDAD_FOTOS`.

## 3. Navegación

Ruta nueva `mortalidad/registrar` agregada a `(protegido)/_layout.tsx`.
El tile "Mortalidad" de Inicio, que hoy apunta a `/proximamente/[title]`,
pasa a apuntar a `/mortalidad/registrar`.

## 4. Estado

`tsc --noEmit` limpio, Jest 80/80 (suite completa), pytest de
`MortalidadFotoSchema` (`tests/test_pecuario_mortalidad_fotos.py`)
19/19 sin cambios. Bundle real verificado por `curl` (ruta de la
pantalla + bundle de entrada general, ambos HTTP 200, 0
`UnableToResolveError` — requirió reiniciar Metro con `-c` porque el
proceso que venía corriendo desde tareas anteriores no recogió los
paquetes nativos nuevos, mismo síntoma de proceso de larga vida
entrando en un estado roto ya documentado para `next dev` en
`CLAUDE.md`, ahora confirmado también en Metro).

Verificado en vivo contra GRANJA-TEST los 3 escenarios de datos
(mortalidad poblacional por lote con `UPDATE` de `cantidad_actual`,
poblacional por poza, y reproductor identificado con baja automática
del trigger) y el filtro compartido `etapa + cantidad_actual > 0`. **No
se probó en vivo la subida de fotos a `evidencias_pecuario`** desde
este entorno (requiere una sesión de app real con `expo-image-picker`,
no algo simulable por SQL directo) — queda pendiente de la prueba
manual de Neyser en dispositivo, junto con el resto del flujo. No se
considera "cerrada" hasta esa confirmación, mismo criterio que el resto
de las pantallas de esta app.
