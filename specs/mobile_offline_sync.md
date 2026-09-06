# Spec: Infraestructura de base de datos para sincronización móvil offline-first

## Contexto

`docs/ESTADO_PROYECTO.md` ya tiene decidido (sección "YA DEFINIDO Y
CERRADO"): tres apps móviles (App de Campo, App del Socio, App Granja
Valencia) construidas en React Native Expo, con TypeScript/Zod y
autenticación propia — **DNI + PIN para el Socio**, no el login
email+contraseña de `specs/login_real_organizacion_rol.md` (ese login
cubre exclusivamente `admin`/`tecnico_campo`/`auditor_qc`, nunca
`socio` — confirmado explícitamente en ese spec). Ninguna de las tres
apps existe todavía como código en este repo; esta spec cubre
únicamente la infraestructura de base de datos que las apps
necesitarán, antes de que exista una sola línea de React Native.

Esta spec no existía antes de esta tarea — se redacta acá siguiendo el
flujo SDD de `CLAUDE.md` (spec → plan → implementación → tests), ya que
el prompt original la daba por existente con un bloque SQL ya definido,
lo cual no era cierto (confirmado por búsqueda en el repo).

## Decisión de alcance (confirmada con el usuario antes de escribir código)

**El mecanismo real DNI+PIN → sesión autenticable en Postgres (RLS)
NO existe todavía en este repo** — `PERFILES_USUARIO_INTERNOS.rol`
tiene un `CHECK` que solo permite
`'admin'`/`'tecnico_campo'`/`'auditor_qc'`; un socio no tiene fila ahí,
no tiene `auth.uid()`, y por lo tanto `auth_org_id()`/`auth_role()` no
lo pueden reconocer hoy. Construir RLS que diga "lectura para socios"
sería inventar un actor que Postgres no puede autenticar todavía.

Decisión: **esta tarea construye las 3 tablas + columnas nuevas con
RLS que cubre únicamente a `admin`/`tecnico_campo`/`auditor_qc`** (los
3 roles que ya tienen sesión real desde `ADR-035`–`039`). El acceso de
la App del Socio (DNI+PIN) queda **explícitamente fuera de alcance**,
para una fase posterior cuando exista ese mecanismo de sesión — no se
inventa un bypass ni un rol `socio` ficticio para cubrir ese hueco
ahora.

## Invariantes

1. **Multi-tenant por organización**, mismo patrón que toda tabla
   nueva desde `ADR-027`/`028`: columna `id_organizacion` (minúscula,
   texto, `REFERENCES "ORGANIZACIONES"("ID")`), `DEFAULT
   public.auth_org_id()` para que el cliente no necesite enviarla
   explícitamente, con `WITH CHECK` de RLS como autoridad real (el
   `DEFAULT` es conveniencia, no el mecanismo de seguridad).
2. **RLS habilitado en las 3 tablas nuevas**, sin excepción — mismo
   bypass estándar `service_role`/`postgres` que ya usan todas las
   políticas de este repo desde `ADR-034`.
3. **`SYNC_QUEUE`**: cola genérica de mutaciones offline — `device_id`
   (identifica el dispositivo emisor), `payload` `jsonb` (el cuerpo de
   la mutación, formato libre por `entity_type` — no se valida su
   contenido en este nivel de infraestructura, eso le toca a quien
   procese la cola), `estado` (`PENDIENTE`/`PROCESADO`/`ERROR`).
   Cualquier miembro autenticado de la organización puede insertar y
   leer su propia cola — no hay restricción de rol para esta tabla
   (el prompt tampoco la pedía).
4. **`PRECIOS_PRODUCTO`**: lectura por organización para cualquier
   miembro autenticado (`admin`/`tecnico_campo`/`auditor_qc`),
   escritura (`INSERT`/`UPDATE`/`DELETE`) exclusiva para `admin` — tal
   como pedía el prompt, aplicado a los 3 roles reales que sí pueden
   autenticarse hoy. `id_producto` referencia `PRODUCTOS(id)`
   (`ADR-028`, catálogo café/cacao ya existente).
5. **`SOCIO_ACTIVACION_CODES`**: contiene códigos de activación
   vinculados a un socio real (`PADRON_SOCIOS(id)` — el PK
   **surrogate** `uuid`, confirmado en vivo con `pg_constraint` que
   `PADRON_SOCIOS` ya usa `id` como PK desde `ADR-026`, no `ID_Socio`).
   Dato sensible (es, en esencia, un token de activación de cuenta) —
   RLS exclusivamente `admin`, ni siquiera lectura para
   `tecnico_campo`/`auditor_qc`. Coherente con "Activación de socios:
   centralizada desde el dashboard web" (`docs/ESTADO_PROYECTO.md`).
6. **`PADRON_SOCIOS.pin_hash`/`pin_configurado_en`**: solo columnas
   nuevas, nullable — el socio configura su PIN la primera vez que usa
   un código de activación válido (flujo de la app móvil, fuera de
   alcance de esta tarea: eso requiere la RPC de validación DNI+código
   que todavía no existe). **Se intentó un `REVOKE` de columna sobre
   `pin_hash`** (defensa en profundidad, no pedido por el prompt) **y
   se descartó**: Supabase ya otorga `SELECT` de tabla completa a
   `authenticated`/`anon` sobre `PADRON_SOCIOS`, y un `REVOKE` de
   columna no anula un `GRANT` de tabla ya existente — confirmado en
   vivo con `has_column_privilege()`, el `REVOKE` no tuvo ningún efecto
   real. Restringirlo de verdad exigiría revocar el `SELECT` de tabla
   completa y re-otorgarlo columna por columna, un cambio bastante más
   invasivo que el alcance de esta tarea. `pin_hash` queda protegido al
   mismo nivel que `socio_dni`/`celular_socio`: por RLS de organización
   (`ADR-034`), no por ACL de columna — documentado acá para que quede
   explícito, no una promesa de seguridad falsa.

## Explícitamente fuera de alcance de esta tarea

- Cualquier RPC de validación DNI+PIN o de canje de código de
  activación — requiere decidir primero cómo un socio obtiene algo
  equivalente a una sesión reconocible por RLS (ver "Decisión de
  alcance" arriba).
- Tablas de acopio/recepción (`receipt_local_id`, mencionado en
  `docs/ESTADO_PROYECTO.md` como regla de negocio) — no existen
  todavía, no se inventan acá; `SYNC_QUEUE.payload` puede cargar ese
  dato como parte del JSON libre cuando esas tablas existan.
- Cualquier código de app React Native/Expo — cero apps móviles
  existen todavía en este repo.
- Endurecer RLS/roles para la App del Socio — bloqueado por la
  decisión de alcance de arriba.

## Criterios de aceptación (adaptados de los Test A/B/C del prompt original)

- **Test A:** una sesión real de `tecnico_campo`/`admin`/`auditor_qc`
  inserta en `SYNC_QUEUE` con `device_id` y `payload` JSON válidos →
  éxito, fila creada con `id_organizacion` igual al de su propia
  sesión.
- **Test B:** esa misma sesión lee `PRECIOS_PRODUCTO` → solo ve filas
  de su propia organización.
- **Test C:** una sesión `tecnico_campo` intenta `INSERT`/`UPDATE` en
  `PRECIOS_PRODUCTO` → rechazado por RLS (`42501`), porque la política
  de escritura exige `auth_role() = 'admin'`.
- (Adicional, no estaba en el prompt pero es la contraparte obvia del
  aislamiento multi-tenant ya probado en `ADR-035`–`039`): un intento
  de `INSERT`/lectura cruzada con la organización de otra sesión real
  también debe bloquear, para las 3 tablas.
