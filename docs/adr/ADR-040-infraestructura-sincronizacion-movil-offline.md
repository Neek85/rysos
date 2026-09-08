# ADR-040 — Infraestructura de base de datos para sincronización móvil offline-first

- **Estado:** Implementado — migración aplicada, verificación
  funcional real hecha contra producción, commiteado y pusheado a
  `staging`. **Sin código de aplicación** — ninguna app React
  Native/Expo existe todavía en este repo; esto es solo la base de
  datos que esas apps necesitarán.
- **Migraciones:**
  `supabase/migrations/20260906100000_mobile_offline_sync_tables.sql`
  (nueva, este ADR) — aplicada.
- **Spec:** `specs/mobile_offline_sync.md` (nueva, este ADR — no
  existía antes de esta tarea, ver corrección de premisa abajo).
- **Tests:** ninguno nuevo (no hay código de aplicación que testear) —
  verificación funcional real contra producción, con sesiones reales
  de 4 usuarios distintos, sobre filas descartables creadas y borradas
  dentro de la misma verificación.
- **Contexto previo:** `docs/ESTADO_PROYECTO.md` (decisiones de
  negocio ya cerradas: 3 apps móviles, DNI+PIN para el Socio,
  activación centralizada en lote); `specs/login_real_organizacion_rol.md`
  (confirma que el login real de `admin`/`tecnico_campo`/`auditor_qc`
  nunca cubre `socio`); `ADR-026` (PK surrogate de `PADRON_SOCIOS`);
  `ADR-028` (`PRODUCTOS`, catálogo café/cacao).

## Correcciones de premisa, verificadas antes de escribir código

1. **`specs/mobile_offline_sync.md` no existía** — el prompt lo trataba
   como si ya tuviera un bloque SQL definido para "copiar". Se redactó
   desde cero siguiendo el flujo SDD de `CLAUDE.md` (spec antes que
   migración), como parte de esta misma tarea.
2. **El auth de socios (DNI+PIN) no existe todavía en este repo** — el
   prompt pedía RLS de lectura de `PRECIOS_PRODUCTO` para
   "socios/técnicos", pero `PERFILES_USUARIO_INTERNOS.rol` tiene un
   `CHECK` que solo admite `'admin'`/`'tecnico_campo'`/`'auditor_qc'` —
   `'socio'` no es un rol válido ahí, y
   `specs/login_real_organizacion_rol.md` confirma explícitamente que
   la app del Socio "nunca usa este login". Un socio no tiene
   `auth.uid()` hoy, así que `auth_org_id()`/`auth_role()` no lo pueden
   reconocer. **Decisión confirmada con el usuario antes de escribir
   la migración:** el RLS de las 3 tablas nuevas cubre únicamente
   `admin`/`tecnico_campo`/`auditor_qc` (los roles que sí tienen sesión
   real desde `ADR-035`–`039`); el acceso de la App del Socio queda
   explícitamente fuera de alcance, para cuando exista ese mecanismo de
   sesión — no se inventó un rol `socio` ficticio ni un bypass para
   cubrir el hueco.
3. **`PADRON_SOCIOS` ya no usa `ID_Socio` como PK** — confirmado en
   vivo con `pg_constraint` que el PK real es `id` (`uuid`, surrogate
   desde `ADR-026`), con `UNIQUE(ID_Organizacion, ID_Socio)` aparte.
   `SOCIO_ACTIVACION_CODES.id_socio` referencia `PADRON_SOCIOS(id)`, no
   `ID_Socio` — el prompt no especificaba esto, se resolvió contra el
   esquema real.
4. **El `REVOKE SELECT (pin_hash)` de columna, agregado como defensa en
   profundidad no pedida por el prompt, se probó y se descartó**:
   Supabase ya otorga `SELECT` de tabla completa a
   `authenticated`/`anon` sobre `PADRON_SOCIOS`, y un `REVOKE` de
   columna no anula un `GRANT` de tabla ya existente — confirmado en
   vivo con `has_column_privilege()` que el `REVOKE` no tuvo ningún
   efecto real (`authenticated` seguía pudiendo `SELECT pin_hash`
   después de aplicarlo). Restringirlo de verdad exigiría revocar el
   `SELECT` de tabla completa y re-otorgarlo columna por columna —
   cambio más invasivo que el alcance de esta tarea, con riesgo de que
   una columna futura quede invisible por descuido. Se retiró del
   `.sql` final; `pin_hash` queda protegido al mismo nivel que
   `socio_dni`/`celular_socio` — por RLS de organización, no por ACL de
   columna. Documentado acá para no dejar una promesa de seguridad
   falsa en el código.

## Qué se creó

1. **`SYNC_QUEUE`** — cola genérica de mutaciones offline por
   dispositivo (`device_id`, `entity_type`, `operation`, `payload`
   `jsonb`, `estado` `PENDIENTE`/`PROCESADO`/`ERROR`). RLS: cualquier
   miembro autenticado de la organización lee/escribe su propia cola
   (`FOR ALL`, sin restricción de rol — el prompt tampoco la pedía para
   esta tabla).
2. **`PRECIOS_PRODUCTO`** — precios por organización y producto
   (`id_producto` referencia `PRODUCTOS(id)`, `ADR-028`). RLS: `SELECT`
   por organización para cualquier miembro autenticado
   (`admin`/`tecnico_campo`/`auditor_qc`); `INSERT`/`UPDATE`/`DELETE`
   exclusivo `auth_role() = 'admin'`.
3. **`SOCIO_ACTIVACION_CODES`** — códigos de activación de cuenta,
   dato sensible. RLS: exclusivo `admin`, ni siquiera lectura para
   `tecnico_campo`/`auditor_qc`.
4. **`PADRON_SOCIOS.pin_hash`/`pin_configurado_en`** — columnas nuevas,
   nullable, sin lógica de aplicación todavía (ver corrección de
   premisa #4 sobre su nivel real de protección).

Las 3 tablas nuevas: `id_organizacion` con `DEFAULT public.auth_org_id()`
(conveniencia — el `WITH CHECK` de cada política es la autoridad real,
no el default), `RLS ENABLE` sin excepción, bypass estándar
`service_role`/`postgres` en todas las políticas — mismo patrón que
toda tabla de este repo desde `ADR-034`.

## Qué queda fuera (ver `specs/mobile_offline_sync.md` para el detalle)

Cualquier RPC de validación DNI+PIN o de canje de código de activación;
tablas de acopio/recepción (`receipt_local_id`); código de app React
Native/Expo; acceso RLS para la App del Socio — todo bloqueado por la
misma decisión de alcance (corrección de premisa #2).

## Verificación funcional real

4 sesiones `authenticated` reales, obtenidas vía magic link (Admin API
`generate_link` + `/auth/v1/verify`, sin resetear contraseña, sin
exponer ningún `access_token` completo) — mismo mecanismo que
`ADR-035`–`039`: `tecnico-campo-demo@ryzos-demo.test`,
`auditor-qc-demo@ryzos-demo.test`, `admin-demo@ryzos-demo.test` (las 3
en `ORG-TEST-DEMO`) y `neyser.maldonado@est.unj.edu.pe` (`admin` en
`COOP-AROMAS-VALLE`, para el aislamiento cruzado).

1. **Test A (`SYNC_QUEUE`):** `tecnico_campo` inserta con `device_id`/
   `payload` JSON, sin especificar `id_organizacion` → **`201`**, fila
   creada con `id_organizacion: "ORG-TEST-DEMO"` (el `DEFAULT
   auth_org_id()` resolvió solo, sin que el cliente lo mandara).
2. **Test B (`PRECIOS_PRODUCTO`, lectura por organización):** 2 precios
   de prueba sembrados con Service Role Key (uno por organización) →
   `auditor_qc` de `ORG-TEST-DEMO` lee la tabla → **`200`**, ve
   únicamente la fila de su propia organización.
3. **Test C (`PRECIOS_PRODUCTO`, rol no autorizado):** `tecnico_campo`
   intenta `INSERT` → **`403`**, `42501`, violación de RLS. Control
   positivo: `admin` de la misma organización sí puede `INSERT` →
   **`201`**.
4. **Aislamiento cruzado (`PRECIOS_PRODUCTO`):** `admin` de
   `COOP-AROMAS-VALLE` intenta `INSERT` forzando
   `id_organizacion: "ORG-TEST-DEMO"` → **`403`**, `42501` (el `WITH
   CHECK` exige `id_organizacion = auth_org_id()`, y su
   `auth_org_id()` real es `COOP-AROMAS-VALLE`); esa misma sesión lee
   `PRECIOS_PRODUCTO` → solo ve filas de `COOP-AROMAS-VALLE`.
5. **`SOCIO_ACTIVACION_CODES`:** `admin` crea un código de activación
   para un socio real → **`201`**; `tecnico_campo` intenta leer la
   tabla → **`200`, `0` filas** (RLS lo filtra en silencio, sin error,
   igual que cualquier `SELECT` bajo una política que no aplica).
6. **Limpieza:** las 5 filas descartables (`SYNC_QUEUE`,
   3× `PRECIOS_PRODUCTO`, `SOCIO_ACTIVACION_CODES`) borradas con
   Service Role Key. Confirmado `0` filas restantes en las 3 tablas
   nuevas después.

`npm run build`/`npm run lint`: limpios — sin cambios de código de
aplicación, mismas 19 rutas, mismos warnings preexistentes.
