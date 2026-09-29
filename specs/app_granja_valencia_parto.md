# Spec — App Granja Valencia: Registrar parto

## 1. Alcance — solo modo "Reproductora identificada"

El mockup tiene dos modos: "Poza (poblacional)" y "Reproductora
identificada". **Esta pantalla construye solo el segundo** —
`madre_id` es obligatorio en el contrato (§2), a diferencia del
`PECUARIO_PARTOS.madre_id` real de la base, que sí es `nullable` (el
modo poblacional tiene dónde insertarse en el esquema, confirmado en
vivo antes de esta tarea — simplemente no se construyó esa mitad de la
pantalla en esta ronda). Tampoco se construye el toggle "Requiere
revisión sanitaria" del mockup — no tiene ningún efecto real
confirmado (no hay tabla de tareas sanitarias conectada a `PECUARIO_PARTOS`
hoy), así que agregarlo sería fingir una funcionalidad que no existe.

## 2. Contrato de datos (Zod) — compartido, en `lib/validations/pecuario.ts`

```ts
export const PartoRegistroSchema = z.object({
  ID_Organizacion: z.string().min(1),
  poza_id: z.string().uuid(),
  madre_id: z.string().uuid(),
  macho_id: z.string().uuid().nullable().optional(),
  fecha_parto: z.string(),
  n_vivos: z.coerce.number().int().nonnegative(),
  n_muertos: z.coerce.number().int().nonnegative(),
  peso_total_camada_g: z.coerce.number().int().positive().nullable().optional(),
  observaciones: z.string().trim().optional(),
})
```

**Nota de nombres (2026-09-29):** ya existía un `PartoRegistroSchema`
en este archivo desde el v1 original del módulo web — diseño
especulativo de sync offline (`device_id`/`created_offline_at`
obligatorios), nunca conectado a ningún consumidor real (confirmado por
grep exhaustivo antes de tocar nada). Por decisión explícita de Neyser,
ese schema viejo se renombró a `PartoOfflineDraftSchema` (forma sin
cambios) para liberar el nombre `PartoRegistroSchema` para este
contrato real de la app — no es una limpieza unilateral, fue una
decisión puntual pedida en el momento.

## 3. Cómo se resuelve `macho_id` — NO lo completa ningún trigger

El mockup dice "el macho se completa solo, viene del historial de
jaula" — confirmado en vivo, **antes de escribir código**, que eso es
comportamiento del JS del simulador, no de la base real: ningún
trigger sobre `PECUARIO_PARTOS` toca `macho_id`. La pantalla lo resuelve
ella misma: al elegir la madre, consulta `PECUARIO_JAULAS` (por
`madre.jaula_actual_id`) para mostrar la poza, y `PECUARIO_HISTORIAL_MACHOS`
(`WHERE jaula_id = esa poza AND fecha_salida IS NULL`) para encontrar el
macho activo — si no hay ninguno, muestra "Sin macho activo asignado" y
**no bloquea el guardado** (`macho_id` queda `NULL` en el insert).

## 4. ⚠️ Landmine real documentado — `trg_generar_destete_parto` / `TAREAS`

`PECUARIO_PARTOS` tiene un trigger `AFTER INSERT` real
(`trg_generar_destete_parto` → `fn_crear_tarea_destete`) que:
1. Hace no-op seguro (`RAISE WARNING`, sin fallar el insert) si la tabla
   `TAREAS` no existe — **confirmado en vivo que hoy no existe**
   (`to_regclass('public."TAREAS"')` → `NULL`), así que todo insert real
   de esta pantalla pasa limpio hoy.
2. **Pero si `TAREAS` llega a existir**, ese mismo trigger intenta un
   `INSERT INTO "TAREAS" (id, "ID_Organizacion", descripcion,
   fecha_limite, prioridad, estado, device_id, created_at)` con columnas
   que **el propio comentario de la función admite que nunca se
   confirmaron contra el esquema real** ("Columnas de TAREAS asumidas
   del diseño original, NO confirmadas... Si el INSERT falla por columna
   inexistente, ajustar aquí tras verificar").

**Cualquier tarea futura que cree `TAREAS` debe leer esto primero** y
confirmar que sus columnas reales coinciden con las que asume
`fn_crear_tarea_destete` — si no coinciden, **todo insert a
`PECUARIO_PARTOS` empezaría a fallar en ese momento**, no solo los
nuevos de esta pantalla. Esta pantalla no reintenta el insert si eso
pasa — muestra el error real de Postgres tal cual, sin esconderlo ni
reintentarlo ciegamente.

## 5. Estado

EN DISEÑO (2026-09-29) — pendiente de la prueba manual en dispositivo
real con la cuenta de GRANJA-TEST (registrar un parto para H-001, 3
vivos, confirmar con SELECT real y que `vw_pecuario_lactancia_restante`
y "Población total" de Inicio suben de 0).
