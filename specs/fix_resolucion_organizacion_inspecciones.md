# Fix: resolución de organización activa en el formulario de Inspecciones

## Problema

`useInspeccionForm.js` deriva `organizationId` (el valor que
`saveInspeccion()` manda como `p_organizacion` a
`fn_guardar_inspeccion_completa`) con `resolveOrganizationId(rows)`
sobre el resultado de `fetchInspecciones(supabase, { page: 0 })`. Esa
función (`lib/eudrDdsExporter.js`) mira los `ID_Organizacion` que
aparecen en `rows` — no depende de la sesión real en absoluto, depende
de que ya existan filas visibles de `INSPECCIONES` para poder "adivinar"
a qué organización pertenece el usuario.

Con `INSPECCIONES` vacía (0 filas, confirmado esta sesión —
`AI_STATE.md` `2026-09-03f`/`g`, causa aún sin determinar, no relevante
para este fix), `rows` es siempre `[]`, `resolveOrganizationId([])`
siempre devuelve `null`, `organizationId` nunca se resuelve, y
`saveInspeccion()` aborta de entrada (`lib/inspeccionesActions.js:571-573`)
con `'No se pudo determinar la organización activa.'` — **antes de
cualquier round-trip de red**, tanto en creación como en edición. El
mensaje sugiere un problema de datos ("no se encontró organización");
la causa real es que el mecanismo de resolución nunca miró la sesión.
Esto es independiente de RLS — pasaba antes de ADR-033 y sigue pasando
después, con cualquier política activa, mientras la tabla esté vacía (o,
más en general, mientras el usuario no tenga aún ninguna inspección
propia visible).

## Decisión

Reemplazar esa resolución por una llamada directa a
`supabase.rpc('auth_org_id')` al iniciar la carga del formulario.
`public.auth_org_id()` ya tiene `EXECUTE` otorgado a `authenticated`
(confirmado contra `information_schema.routine_privileges` en la
instancia real, tarea de reconocimiento anterior) y es la misma función
que las políticas RLS de `INSPECCIONES`/`CAP_*` (ADR-033) usan como
autoridad para decidir qué organización puede tocar cada fila — pasa a
ser también la fuente que el cliente usa para decidir qué mandar. Un
solo origen de verdad entre lo que el cliente cree y lo que el servidor
va a exigir, en vez de dos mecanismos independientes que hoy coinciden
por causalidad, no por diseño.

`fetchInspecciones(supabase, { page: 0 })` se elimina de este hook:
confirmado (lectura completa del archivo, tarea de reconocimiento
anterior) que su único uso en `useInspeccionForm.js` era proveer `rows`
a `resolveOrganizationId` — no alimenta ningún otro estado ni efecto en
este archivo. El listado real de inspecciones (`/dashboard/inspecciones`,
la tabla) vive en otro componente/página, no en este hook, y no se toca.

`existingOrganizationId` no cambia: sigue viniendo exclusivamente de
`fetchInspeccionDetalle()`, solo en modo edición.

## Manejo de `auth_org_id()` devolviendo `null`

Puede pasar con una sesión válida (pasó el gate de `middleware.js`) pero
sin fila activa en `PERFILES_USUARIO_INTERNOS` (perfil desactivado, o
inconsistencia de datos). En ese caso: mensaje distinto y más preciso
que el genérico actual — *"No se pudo verificar tu organización activa.
Verificá que tu perfil esté activo o contactá al administrador."* — y
**no continuar con `fetchInspeccionDetalle()`** en ese caso. Sin
organización resuelta no hay ningún flujo de guardado válido posible;
cortar temprano con un estado de error claro es preferible a dejar
cargar un formulario (con datos de la inspección incluidos, en modo
edición) que de todos modos va a fallar al guardar.

## Corrección de documentación (no de comportamiento) en `lib/inspeccionesActions.js`

El docstring de `saveInspeccion()` afirma hoy: *"la función RPC repite
la misma verificación del lado del servidor como autoridad real"* — es
inexacto. `fn_guardar_inspeccion_completa` (confirmado `SECURITY
INVOKER`, sin cláusula explícita — Postgres usa ese default cuando no se
especifica `SECURITY DEFINER`) solo compara sus propios dos parámetros,
`p_existing_organizacion` contra `p_organizacion`, entre sí — ninguno de
los dos se deriva de la sesión real dentro de la función. La autoridad
real es el RLS de `INSPECCIONES`/`CAP_*` (ADR-033, `WITH CHECK
"ID_Organizacion" = auth_org_id()`), que se aplica porque la función
corre con el rol del llamador (`SECURITY INVOKER`), no por ninguna
verificación propia de la función. El docstring se reescribe para
reflejar esto con precisión.

También corregir: *"Para creación nueva, `existingOrganizationId` es la
organización activa resuelta de la lista ya cargada"* — no es así ni
antes ni después de este fix: en creación, `existingOrganizationId`
simplemente queda `null` (el estado inicial de React, nunca se
sobreescribe fuera de la rama `isEdit`), y la comparación en
`saveInspeccion()` (`if (id && existingOrganizationId && ...)`) está
gateada por `id`, así que estructuralmente nunca se ejecuta en modo
creación — no hay ninguna "organización resuelta de la lista" que
comparar ahí, para ningún valor de `organizationId`.

## Contrato de datos

`organizationId` sigue siendo `string | null` (mismo tipo que
`"ID_Organizacion"`, columna `text` en `INSPECCIONES` y en
`PERFILES_USUARIO_INTERNOS`) — cambia de dónde viene, no de forma. Sin
cambios de esquema SQL, sin cambios en los payloads que
`saveInspeccion()` manda a la RPC.

## Fuera de alcance, explícito

No se modifica `fn_guardar_inspeccion_completa` ni se agrega ninguna
migración SQL. Si en el futuro se decide que la función también debería
validar `p_organizacion` contra `auth_org_id()` internamente, como
defensa adicional en profundidad (dado que hoy no lo hace — confirmado
en el reconocimiento de esta tarea), eso queda para una tarea aparte,
con su propio ADR — este fix es puramente del lado del cliente, sobre
cómo se resuelve el valor que se envía, no sobre qué hace el servidor
con él.
