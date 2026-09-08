# Spec: RBAC en WebGIS y Padrón de Socios

## Corrección de premisa central, verificada antes de escribir código

El prompt original pedía ocultar/deshabilitar controles de edición en
`/dashboard/mapa` para `tecnico_campo`/`auditor_qc`. Dos hallazgos
independientes contradicen esa premisa:

1. **`app/dashboard/mapa/page.jsx` ya es 100% de solo lectura para
   TODOS los roles** — el propio subtítulo de la página lo dice
   textualmente ("Visor de solo lectura · Parcelas y monitoreos
   aprobados"). No renderiza ningún botón de creación/edición/borrado
   — solo `<MapDashboard />` (mapa) y `<EudrStatsWidget />` (métricas).
   No hay nada que ocultar porque no hay ningún control de edición ahí
   para empezar.
2. **La matriz de permisos ya confirmada con el usuario**
   (`specs/login_real_organizacion_rol.md` §5, Fase A del login real)
   dice explícitamente `/dashboard/mapa` → `Sí` para los 3 roles
   (`admin`, `tecnico_campo`, `auditor_qc`) — sin ninguna restricción.
   Implementar una restricción ahí habría contradicho una decisión de
   seguridad ya tomada y aprobada, no una omisión a corregir.

**Decisión: `app/dashboard/mapa/page.jsx` no se toca.** El editor
GIS real con controles de mutación (Editor Vectorial, Carga Espacial,
aprobar/rechazar) vive en `/dashboard/qc` desde la reorganización
documentada en `lib/actions/gisActions.js`/`ADR-038` — pero
`/dashboard/qc` tampoco está en el alcance de esta tarea (no lo pidió
el prompt, y su fila de la matriz — "aprobar/rechazar": admin sí,
tecnico_campo no, auditor_qc sí — ya está cerrada por el trigger de
`ADR-039`). Esta tarea se enfoca exclusivamente en `/dashboard/socios`,
el módulo que sí tenía un gap real.

## Matriz de permisos aplicada (ya confirmada, no inventada acá)

De `specs/login_real_organizacion_rol.md` §5:

| Pantalla | admin | tecnico_campo | auditor_qc |
|---|---|---|---|
| `/dashboard/socios` (alta/edición/export) | Sí | Solo lectura | Solo lectura |
| `/dashboard/mapa` | Sí | Sí | Sí (sin cambios, ver arriba) |

"Solo lectura" para `/dashboard/socios` se interpreta literal: **toda
mutación** (crear/editar/dar de baja socio o parcela, importar CSV,
exportar CSV) queda exclusiva de `admin` — no solo las "acciones
destructivas" que mencionaba el prompt de forma más acotada. Dejar
`createSocio`/`updateSocio`/`createParcela`/`updateParcela` sin
verificación de rol mientras solo se protegían las bajas habría sido
una aplicación parcial e inconsistente de una matriz que ya dice
"Solo lectura" sin matices para esos 2 roles en esta pantalla.

Búsqueda, filtros, ver el detalle de un socio y ver sus parcelas
siguen disponibles para los 3 roles — son lecturas, no mutaciones.

## 2 capas de enforcement (mismo criterio que §5 del spec de login)

1. **Server Actions (`lib/actions/sociosActions.js`)** — la capa real.
   `createSocio`/`updateSocio`/`updateParcela`/`deactivateSocio`/
   `deactivateParcela` (5 de 6) ahora exigen `auth_role() === 'admin'`
   antes de cualquier escritura — un helper privado
   `assertAdminRole(supabase)` reutilizado en las 5. Un
   `tecnico_campo`/`auditor_qc` que invoque estas funciones
   directamente (sin pasar por la UI) recibe `SocioActionError`, no
   una escritura silenciosamente aceptada.

   **`createParcela` queda deliberadamente SIN el chequeo de rol —
   gap conocido, no un descuido:** además de `ParcelaFormModal.jsx`
   (`/dashboard/socios`), también la llama
   `lib/actions/gisActions.js::uploadGeoSpatialFeature` (rama
   `PADRON_PARCELAS`, el Ingestor de Capas Espaciales de
   `/dashboard/qc`, `ADR-036`/`ADR-038`) — confirmado con `grep` antes
   de tocar código. Esa pantalla está fuera de alcance de esta tarea, y
   la matriz de permisos (`specs/login_real_organizacion_rol.md` §5)
   no dice nada sobre si un `tecnico_campo` debe poder seguir creando
   parcelas nuevas desde el Editor Vectorial en el campo — algo que
   suena a parte central de su trabajo, no una excepción. Agregar
   `assertAdminRole` acá habría roto silenciosamente esa función para
   `tecnico_campo` sin que nadie lo pidiera ni lo confirmara. En la UI
   de `/dashboard/socios` el botón "+ Agregar parcela" igual se oculta
   para no-admin (ver capa 2) — la función server-side sigue
   alcanzable en teoría por un `tecnico_campo` que la invocara directo
   sin pasar por esa UI, mismo criterio que el gap ya documentado de
   exportación CSV más abajo. Resolverlo bien exigiría distinguir el
   origen de la llamada (¿socios o QC?) o decidir explícitamente en
   otra tarea si `/dashboard/qc` también debe restringir esta acción.
   **Actualización (2026-09-06/07):** el trigger de base de datos de
   "Cierre del gap de RLS" (más abajo) formaliza esto — `INSERT` en
   `PADRON_PARCELAS` queda explícitamente permitido para cualquier
   `authenticated`, por diseño, no como un descuido pendiente de
   cerrar. `UPDATE`/`DELETE` en `PADRON_PARCELAS` ahora sí quedan
   bloqueados para no-admin también a nivel de base de datos — ese
   trigger es el respaldo de RLS que le faltaba a `assertAdminRole()`
   de `updateParcela`/`deactivateParcela` (ambas ya lo tenían a nivel
   de aplicación desde el punto 1) para no ser bypasseable con una
   llamada directa a PostgREST (ver "Cierre del gap de RLS").
2. **UI (`app/dashboard/socios/page.jsx` +
   `components/features/socios/ParcelaFormModal.jsx`)** — UX, no
   seguridad real. Con el rol resuelto client-side (ver abajo), se
   ocultan: "+ Nuevo Socio", "Editar"/"Dar de baja" por fila,
   "Exportar Padrón de Socios/Parcelas (CSV)", "Cargar Padrón Masivo
   (CSV)" en la página, y "Editar"/"Dar de baja"/"+ Agregar parcela"
   dentro del modal de Parcelas — para `tecnico_campo`/`auditor_qc`.

**`ParcelaFormModal.jsx` no estaba en la lista de archivos del prompt,
pero se agrega igual** — sus propios botones de mutación quedarían
expuestos para `tecnico_campo`/`auditor_qc` (que sí pueden abrir el
modal vía el botón "Parcelas", una lectura) si solo se tocara
`page.jsx`. Recibe `userRole` como prop nueva desde `page.jsx`.

**Export CSV solo cliente, sin cambio server-side:** `exportSociosCsv`/
`exportParcelasCsv` viven en `lib/padronCsv.js`, fuera de la lista de
archivos de esta tarea — se ocultan los botones en la UI, pero no se
agrega un chequeo de rol dentro de esas funciones. Gap conocido y
documentado, no una omisión silenciosa: un `tecnico_campo`/`auditor_qc`
que invoque `exportSociosCsv` directo (fuera de la UI) hoy podría
seguir exportando. Queda para una tarea aparte si se decide cerrarlo.

## Cómo se resuelve el rol del lado del cliente

`lib/auth/getCurrentProfile.js` ya existía, escrito en Fase B del login
real ("sin consumidores todavía... se usa recién en Fase C/D para el
gating real") — exactamente la fase en la que estamos. No hacía falta
escribir nada nuevo: se le agrega `'use server'` (ya era una función
async pura, exportada, apta para Server Action tal cual) para que
`page.jsx` (`'use client'`) pueda invocarla directo. Devuelve
`{ userId, email, organizacion, rol }`, degrada a `rol: null` sin
sesión/perfil — `page.jsx` trata `rol !== 'admin'` (incluido `null`,
mientras carga) como "no-admin", nunca al revés — fail-closed, mismo
criterio que el resto del proyecto.

## Cierre del gap de RLS (2026-09-06/07, ver `AI_STATE.md` y `supabase/migrations/20260906220000_enforce_padron_admin_trigger.sql`)

La revisión de seguridad del commit `a975a7c` (`AI_STATE.md`,
2026-09-06) confirmó en vivo que `assertAdminRole()` no tenía ningún
respaldo de RLS: `rls_write_padron_socios`/`rls_write_padron_parcelas`
(`ADR-034`) solo filtran por organización, nunca por rol, así que un
`tecnico_campo`/`auditor_qc` podía saltarse la Server Action por
completo con un `PATCH`/`POST`/`DELETE` directo a PostgREST.

**Invariante de seguridad nuevo, a nivel de base de datos — no solo
aplicación:** un trigger `BEFORE INSERT OR UPDATE OR DELETE`
(`public.fn_enforce_padron_admin_role()`, mismo patrón que
`fn_enforce_qc_approval_roles` de `ADR-039`) exige
`auth_role() = 'admin'` para cualquier sesión `authenticated` que
intente escribir `PADRON_SOCIOS`/`PADRON_PARCELAS` — con una excepción
deliberada, confirmada con el usuario antes de aplicar la migración:

- **`PADRON_SOCIOS`:** `INSERT`/`UPDATE`/`DELETE` completos exigen
  `admin`. Sin excepción — `createSocio`/`updateSocio` no tienen
  ningún llamador legítimo fuera de `/dashboard/socios`.
- **`PADRON_PARCELAS`:** `UPDATE`/`DELETE` exigen `admin`. `INSERT`
  queda permitido para **cualquier** `authenticated`, sin importar el
  rol — necesario para no romper `createParcela` vía
  `gisActions.js::uploadGeoSpatialFeature` (Editor Vectorial/Carga
  Espacial de `/dashboard/qc`), donde `tecnico_campo` sí debe poder
  seguir creando parcelas nuevas desde el campo. Esto cierra el gap
  del párrafo de arriba (`createParcela` deliberadamente sin
  `assertAdminRole` a nivel de aplicación) **sin** convertirlo en una
  regresión funcional a nivel de base de datos.

`service_role`/conexiones directas de `postgres` quedan exentas de
forma natural: la condición del trigger solo se evalúa cuando
`auth.role() = 'authenticated'`, así que ETL/scripts/Admin API no se
ven afectados sin necesidad de un `OR` de bypass explícito.

Verificado en vivo (sesiones reales de `tecnico-campo-demo`/
`admin-demo`, filas descartables) y con test de integración
automatizado (`tests/test_padron_rbac_rls.py`, 5/5): el bypass
original ya no funciona (`403`, `42501`), el Editor Vectorial sigue
funcionando para `tecnico_campo`, y `admin` sigue pudiendo escribir
ambas tablas sin cambios.

## Fuera de alcance

- `/dashboard/mapa`, `/dashboard/qc`, `/dashboard/inspecciones`,
  `/dashboard/lotes` — no pedidos por el prompt, y `/dashboard/mapa`
  específicamente no necesita cambios (ver arriba).
- Chequeo de rol dentro de `lib/padronCsv.js` (ver gap documentado).
- Cualquier política RLS nueva — `PADRON_SOCIOS`/`PADRON_PARCELAS` ya
  tienen RLS por organización (`ADR-034`); esta tarea es control de
  rol a nivel de aplicación, no una migración SQL nueva.
