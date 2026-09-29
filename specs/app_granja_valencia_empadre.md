# Spec — App Granja Valencia: Asignar macho a jaula (Empadre)

> La pantalla con más historial de hotfixes de producción del backend
> Pecuario — este documento existe para que quien la toque después no
> repita el error del hotfix #3 (el más grave de los tres, porque no
> tronaba: devolvía `200 OK` sin hacer nada).

## 1. Alcance

- Subtítulo fijo: "Empadre continuo — el macho queda hasta que decidas
  rotarlo" — es el comportamiento real de hoy (`sistema_cria` siempre
  resuelve a `'continuo'`, ver §2). **No hay selector de "sistema de
  cría"** — no tiene efecto real todavía, no se construye.
- Jaula: chips con las pozas reales `tipo_uso='empadre'` de la
  organización.
- Macho candidato: buscador de texto (filtro client-side por
  `codigo_arete`) + chips con los machos activos de la organización. Se
  puede reasignar un macho que ya esté en otra jaula — los triggers
  reales cierran su asignación anterior, la app nunca lo hace a mano.
- Aviso no bloqueante de consanguinidad/jaula ocupada, mismo componente
  (`AdvertenciaBanner`) ya usado en Alta de reproductor — no se
  reescribe, se aisló para esta tarea (`components/ui/AdvertenciaBanner.tsx`,
  junto con `components/ui/Chip.tsx`).
- Fecha de ingreso (default hoy), fecha de retiro (opcional, hint literal
  del mockup: "Podés dejarlo en blanco — el macho queda en la jaula
  hasta que decidas rotarlo.").
- Guardar → `INSERT` en `PECUARIO_HISTORIAL_MACHOS`. **Nunca** se escribe
  a mano `PECUARIO_REPRODUCTORES.jaula_actual_id` ni
  `PECUARIO_RETIROS_MACHO_PENDIENTES` — los triggers reales lo hacen
  (§2). "Resolver un retiro pendiente" ("Marcar hecho") queda **fuera de
  alcance** de esta tarea — se conecta con Alertas cuando esa sección
  deje de estar vacía (`specs/app_granja_valencia_inicio.md` §5).

## 2. Contrato de datos (Zod) — compartido, en `lib/validations/pecuario.ts`

```ts
export const EmpadreAsignacionSchema = z.object({
  ID_Organizacion: z.string().min(1),
  macho_id: z.string().uuid(),
  jaula_id: z.string().uuid(),
  fecha_entrada: z.string(),
  fecha_salida: z.string().nullable().optional(),
  advertencia_confirmada: z.boolean().default(false),
})
```

## 3. Los 5 triggers reales — qué hace cada uno (definición literal confirmada en vivo, con los 3 hotfixes ya aplicados)

1. **`fn_cerrar_historial_macho_anterior`** (`AFTER INSERT` en
   `PECUARIO_HISTORIAL_MACHOS`, ya existía desde v3) — cierra cualquier
   asignación previa todavía abierta de **otro macho en la MISMA jaula**
   (`fecha_salida = COALESCE(NEW.fecha_entrada, CURRENT_DATE)`).
2. **`trg_historial_macho_validar`** (`BEFORE INSERT`) — valida que
   `macho_id`/`jaula_id` pertenezcan a la misma organización, que
   `macho_id` sea `sexo='macho'`, y (con el hotfix de cast ya aplicado,
   `("Config")::jsonb->...`) que si `sistema_cria='controlado'` para esa
   organización, `fecha_salida` venga obligatoria. Como `Config` es
   `text` y `NULL` para las 3 organizaciones reales hoy, esta última
   condición nunca se activa en la práctica — pero las validaciones de
   organización/sexo sí son reglas duras reales a nivel de base. La app
   no las duplica como bloqueo de UI porque los chips ya solo ofrecen
   machos/jaulas reales de la organización — nunca deberían violarse
   desde un uso normal.
3. **`trg_historial_macho_efectos`** (`AFTER INSERT`) — hace 3 cosas:
   (a) cierra cualquier asignación previa todavía abierta de **este
   MISMO macho en OTRA jaula** (complementa a #1 — juntos cubren
   "reasignar sin dejar nada abierto" sin que el cliente haga nada);
   (b) sincroniza `PECUARIO_REPRODUCTORES.jaula_actual_id = NEW.jaula_id`
   — la app **nunca** escribe esta columna directamente; (c) si
   `NEW.fecha_salida IS NOT NULL`, crea la fila de
   `PECUARIO_RETIROS_MACHO_PENDIENTES` — la app **nunca** inserta esa
   fila a mano.
4. **`trg_resolver_retiro_macho_pendiente`** (`AFTER UPDATE` en
   `PECUARIO_RETIROS_MACHO_PENDIENTES`, cuando `resuelta` pasa a `true`)
   — **con el hotfix #3 ya aplicado**: compara `PECUARIO_HISTORIAL_MACHOS.fecha_salida`
   actual contra la `fecha_retiro_planificada` copiada al crear el
   pendiente. Si siguen iguales (nadie reasignó el macho mientras
   tanto), cierra de verdad (`fecha_salida = CURRENT_DATE`,
   `jaula_actual_id = NULL`). Si ya no coinciden (reasignado antes),
   no toca nada — solo queda resuelto el pendiente. **Antes del hotfix
   #3, la condición comparaba contra `NULL`, que nunca podía ser
   verdadera para ninguna fila con un pendiente real — "Marcar hecho"
   devolvía `200 OK` sin cerrar nada, en silencio.** Fuera de alcance de
   esta tarea (§1).
5. **`trg_retiro_macho_resuelta_en`** (`BEFORE UPDATE` en
   `PECUARIO_RETIROS_MACHO_PENDIENTES`) — completa `resuelta_en` server-side
   al pasar `resuelta` a `true` (y lo limpia a `NULL` si vuelve a
   `false`) para no violar el `CHECK` que lo exige. Fuera de alcance de
   esta tarea (§1).

## 4. Estado

EN DISEÑO (2026-09-28) — pendiente de la prueba manual en dispositivo
real con la cuenta de GRANJA-TEST (asignar M-001 a P-001, confirmar que
`jaula_actual_id` se actualiza solo).
