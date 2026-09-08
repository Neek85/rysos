# Plan de ejecución: fix resolución de organización activa (Inspecciones)

Ver `specs/fix_resolucion_organizacion_inspecciones.md` para el diseño
completo. Este documento es solo la secuencia concreta.

## 1. `components/features/inspecciones/useInspeccionForm.js`

- Eliminar el import de `fetchInspecciones` y `resolveOrganizationId` de
  `@/lib/inspeccionesActions` (dejar `fetchInspeccionDetalle`,
  `saveInspeccion`, `InspeccionError`, que sí se siguen usando).
- Dentro de `load()`: reemplazar
  ```js
  const { rows } = await fetchInspecciones(supabase, { page: 0 })
  if (cancelled) return
  setOrganizationId(resolveOrganizationId(rows))
  ```
  por una llamada a `supabase.rpc('auth_org_id')`, manejando 3 casos:
  1. `error` → mismo tratamiento que el catch existente (mensaje de
     `loadError` genérico de carga).
  2. `data` (el `orgId`) es `null`/falsy → `loadError` específico
     ("No se pudo verificar tu organización activa. Verificá que tu
     perfil esté activo o contactá al administrador.") y `return`
     temprano — **no** llamar `fetchInspeccionDetalle` en este caso.
  3. `data` válido → `setOrganizationId(data)` y continuar exactamente
     igual que antes (incluida la rama `isEdit` con
     `fetchInspeccionDetalle`).
- Actualizar el comentario `// INVARIANTE: ...` justo arriba de
  `export function useInspeccionForm(id)` para describir el diseño
  nuevo: `organizationId` viene de la sesión real (`auth_org_id()` RPC),
  `existingOrganizationId` viene del registro específico
  (`fetchInspeccionDetalle`) — dos señales independientes por *origen*
  (identidad vs. dato del registro), no por dos consultas distintas
  sobre la misma tabla como estaba antes.
- No tocar `onSubmit`, `saveInspeccion`, el resto de los `useEffect`, ni
  el `return` del hook.

## 2. `lib/inspeccionesActions.js`

- Reescribir únicamente el docstring de `saveInspeccion()` (líneas
  552-569 en la versión actual) con las 2 correcciones del spec:
  1. Reemplazar la afirmación de que la RPC "repite la misma
     verificación del lado del servidor" por una descripción precisa:
     la función solo compara sus propios 2 parámetros entre sí; la
     autoridad real es el RLS de `INSPECCIONES`/`CAP_*` (ADR-033,
     `auth_org_id()`), que aplica porque la función es `SECURITY
     INVOKER`.
  2. Quitar la afirmación de que en creación `existingOrganizationId`
     "es la organización activa resuelta de la lista ya cargada" —
     aclarar que en creación queda `null` y la comparación de
     `saveInspeccion()` está gateada por `id`, así que nunca se ejecuta
     en ese modo.
- **No tocar la lógica de la función** — mismo cuerpo, mismos
  parámetros, mismo `supabase.rpc(...)`, solo el comentario.

## 3. Verificación

No hay `npm test`/test de RLS automatizado en este repo (confirmado).

1. `npm run build` — debe quedar limpio, mismas rutas/warnings
   preexistentes.
2. Verificación funcional real, con una sesión `authenticated` real
   (mismo mecanismo de magic link vía Admin API + `/auth/v1/verify` ya
   usado para verificar ADR-033 — nunca resetear la contraseña de la
   cuenta demo, y nunca imprimir el `access_token` completo en la
   salida):
   - Llamar `auth_org_id` como RPC con esa sesión y confirmar que
     devuelve un valor no-null (`ORG-TEST-DEMO`, la organización real de
     `admin-demo@ryzos-demo.test`).
   - Crear una inspección de prueba de punta a punta contra
     `ORG-TEST-DEMO` usando la misma RPC real que usa el formulario
     (`fn_guardar_inspeccion_completa`), confirmando éxito.
   - Editar esa misma inspección de prueba (ya que `INSPECCIONES` sigue
     vacía entre tareas — no hay una fila preexistente para reusar),
     confirmando éxito.
   - Limpiar la fila de prueba (`INSPECCIONES` + las 6 `CAP_*`) al
     terminar, igual que en verificaciones anteriores de esta sesión.

Nota: no hay forma de "ver la llamada de red en el Network tab" desde
este entorno (sin navegador real disponible en esta sesión, ver tarea
de ADR-033) — la verificación funcional se hace llamando exactamente la
misma RPC (`auth_org_id`, luego `fn_guardar_inspeccion_completa`) que el
código nuevo llama, con la misma sesión real, en vez de inspeccionar el
tráfico de un navegador real.

## 4. Si algo falla 2 veces seguidas

Detener, documentar la causa real en `AI_STATE.md` (nueva entrada), no
seguir reintentando la misma acción.

## 5. Bitácora y commit

- `AI_STATE.md` + `docs/ESTADO_PROYECTO.md`: hallazgo (RLS de ADR-033 es
  la autoridad real para escrituras vía RPC, no una verificación interna
  de la función), el fix aplicado, resultado de la verificación
  funcional.
- Commit único, Conventional Commits
  (`fix(inspecciones): resolver organización activa desde la sesión
  real, no desde filas cargadas`), push a `staging`.
