# Spec — App Granja Valencia: Destete (recolección + conformación de lotes)

## 0. Backend real — ya construido, sin hotfixes

Recon completo hecho antes de esta tarea (ver hilo de la sesión):
`PECUARIO_RECOLECCIONES_DESTETE`, `PECUARIO_RECOLECCION_PARTOS`,
`PECUARIO_LOTES.recoleccion_origen_id`, `vw_pecuario_lactancia_restante`
y `vw_pecuario_recolecciones_destete` fueron construidos íntegramente en
un solo commit (`ab3431b`, 2026-09-25) y **nunca tuvieron ningún
hotfix** (`git log -S` sobre cada trigger/tabla → un único commit cada
uno) — a diferencia de Empadre (3 hotfixes reales). Esta pantalla
consume ese backend tal cual está, sin tocar ninguna migración.

`PECUARIO_JAULAS.tipo_uso` (enum `tipo_uso_poza`) incluye `'recria'`
real (`empadre, maternidad, recria, engorde, aislamiento`) — es el
destino correcto para "Poza destino" del Paso 2. **GRANJA-TEST no tiene
ninguna poza con ese tipo hoy** (solo `P-001` `empadre` y `H-001`
`maternidad`) — hace falta crear una poza `recria` real (vía
`galpones-pozas.tsx`, ya existente) antes de poder probar el Paso 2 de
punta a punta.

## 1. Paso 1 — Recolección

Lista de partos con lactancia pendiente: `vw_pecuario_lactancia_restante`
filtrada por la organización (`cantidad_restante` siempre > 0 por el
`HAVING` de la propia vista — no hace falta filtrar de nuevo en el
cliente). Checkboxes por parto + "Seleccionar todos" (igual que el
mockup). La selección es **todo o nada por parto** — nunca parcial: el
trigger `trg_recoleccion_partos_validar` fija `cantidad_incluida` al
remanente completo de esa vista, ignorando cualquier valor que mande el
cliente (confirmado en el recon, literal en el propio trigger).

Al confirmar:
1. `INSERT` en `PECUARIO_RECOLECCIONES_DESTETE` (`ID_Organizacion`,
   `fecha_destete`) → devuelve `id`.
2. Con ese `id`, un `INSERT` en `PECUARIO_RECOLECCION_PARTOS` por cada
   parto seleccionado (`ID_Organizacion`, `recoleccion_id`, `parto_id`)
   — **nunca se manda `cantidad_incluida`**, la pone el trigger.

## 2. Retomar una recolección abierta — mejora real sobre el mockup

Al entrar a la pantalla, **antes** de mostrar el Paso 1: consultar
`vw_pecuario_recolecciones_destete` filtrando `estado = 'abierta'` para
la organización. Si existe una fila con `cantidad_pendiente > 0`, la
pantalla entra directo al Paso 2 retomando esa recolección — no fuerza a
crear una nueva. El mockup simulaba este estado intermedio solo en
memoria de la sesión del navegador (`poolDestete`/`lotesDesteteFormados`,
según la §10 de `specs/pecuario_destete_recoleccion_semanal.md`) — se
perdía al cerrar la pestaña. Acá es un dato real y persistente
(`vw_pecuario_recolecciones_destete`), así que **retomar de verdad una
recolección que quedó a mitad de conformar es una mejora real sobre el
mockup**, no solo una réplica.

## 3. Paso 2 — Conformar lotes

Muestra `cantidad_pendiente` real de la recolección activa (de
`vw_pecuario_recolecciones_destete`). Form por lote, repetible:
- **Sexo**: chip `macho`/`hembra` — **nunca `'mixto'`** (el `CHECK
  chk_lotes_destete_sexo_definido` lo prohíbe cuando
  `recoleccion_origen_id IS NOT NULL`).
- **Poza destino**: chip con las pozas reales `tipo_uso='recria'` de la
  organización (ver §0 — hoy vacío en GRANJA-TEST hasta que se cree
  una).
- **Cantidad**: stepper, tope = `cantidad_pendiente` real (UX únicamente
  — la fuente de verdad real sigue siendo el trigger, que rechaza
  cualquier excedente aunque la UI lo hubiera dejado pasar).
- **Código de lote**: sugerido real — consulta el máximo `codigo_lote`
  existente de la organización y propone el siguiente correlativo (mismo
  criterio ya usado en "Sugerir" de Alta de reproductor), **no** un
  contador hardcodeado como en el mockup.

`INSERT` en `PECUARIO_LOTES` con `recoleccion_origen_id`, `fecha_destete`,
`etapa`/`estado` en su default de tabla (`'recria'`/`'activo'`, no se
envían). El trigger `trg_conformar_lote_destete` valida que
`cantidad_inicial` no exceda el remanente real — su mensaje de error se
muestra **tal cual**, sin reescribirlo.

Cerrar la pantalla con `cantidad_pendiente > 0` es un estado **válido**
— la recolección sigue `'abierta'` en la base, se retoma después (§2).
No es un error, no se bloquea.

## 4. Fuera de alcance a propósito

- **Peso opcional al destete** (`PECUARIO_PESAJES`) — la pantalla de
  Pesaje todavía no existe/no fue auditada; no se simula ese insert acá.
- **Alerta "Destete pendiente" agrupada** (por poza o por semana) —
  diferida en Alertas (spec de Inicio §5) — no se construye en esta
  tarea. No existe ninguna vista real equivalente hoy (confirmado en el
  recon: solo `vw_pecuario_recolecciones_destete`, que es por
  recolección, no por poza/semana).

## 5. Contrato de datos (Zod) — compartido, en `lib/validations/pecuario.ts`

```ts
export const RecoleccionDesteteSchema = z.object({
  ID_Organizacion: z.string().min(1),
  fecha_destete: z.string(),
})

export const RecoleccionPartoSchema = z.object({
  ID_Organizacion: z.string().min(1),
  recoleccion_id: z.string().uuid(),
  parto_id: z.string().uuid(),
})

export const SEXO_LOTE_DESTETE = ['macho', 'hembra'] as const

export const LoteDesteteSchema = z.object({
  ID_Organizacion: z.string().min(1),
  codigo_lote: z.string().trim().min(1, 'El código de lote es obligatorio.'),
  poza_actual_id: z.string().uuid(),
  cantidad_inicial: z.coerce.number().int().positive(),
  sexo: z.enum(SEXO_LOTE_DESTETE),
  recoleccion_origen_id: z.string().uuid(),
  fecha_destete: z.string(),
})
```

**Nota de nombres:** ya existían `RecoleccionDestemteSchema` y
`ConformarLoteDestemteSchema` en este archivo (diseño especulativo de
sync offline, `id`/`device_id`/`created_offline_at` obligatorios,
`partos_ids` como array en un solo objeto) — sin ningún consumidor real
(confirmado por grep). No colisionan de nombre con los 4 de esta tarea
(distintos a propósito), pero cubren el mismo dominio de negocio bajo un
diseño distinto — quedan intactos, sin tocar, señalado acá para que no
se confunda con duplicación accidental.

## 6. Estado

EN DISEÑO (2026-09-29) — pendiente de la prueba manual en dispositivo
con la cuenta GRANJA-TEST: recolectar el parto real de H-001, conformar
al menos 1 lote, confirmar `PECUARIO_LOTES` con `SELECT` real, y que un
segundo intento de recolectar el mismo parto falla con el mensaje real
del trigger ("no tiene lactancia pendiente de recolectar").
