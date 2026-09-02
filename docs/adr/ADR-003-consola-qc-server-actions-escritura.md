# ADR-003 — Consola QC: escrituras vía Server Actions + Service Role Key

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Migraciones:** ninguna (fix puramente de código — las políticas RLS
  `authenticated`-only de `supabase/migrations/20260818_rls_multi_tenant_fortification.sql`
  no cambian, se dejan de invocar con el cliente anon en vez de abrirse a `anon`)
- **Spec:** `specs/consola_qc_layout_y_validacion.md` (sección "Hallazgo
  adicional no solicitado")
- **Tests:** `tests/test_qc_server_actions_write_fix.mjs`,
  `tests/test_eudr_qc_actions.mjs` (sin cambios — la lógica pura no se tocó)

## Contexto

La Consola de Auditoría QC (`/dashboard/qc`) escribe sobre
`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` en 4 acciones:
aprobar, rechazar, corregir atributos, ajustar geometría
(`lib/eudrQcActions.js`). Estas 4 funciones se invocaban desde
`app/dashboard/qc/page.jsx` con `getSupabaseClient()` — el cliente anon
key, sin ninguna sesión real de Supabase Auth (este frontend nunca
autentica, ver el gotcha de RLS documentado en `CLAUDE.md`).

`supabase/migrations/20260818_rls_multi_tenant_fortification.sql` define
`rls_write_eudr_monitoreo` / `rls_write_eudr_uso_suelo` /
`rls_write_eudr_instalaciones` como `FOR ALL TO authenticated` — sin
ninguna política `anon`. El resultado: **todo `UPDATE` emitido desde el
frontend contra estas 3 tablas afectaba 0 filas siempre**, sin importar el
estado real del registro. El guard de concurrencia optimista ya existente
(`.match({ ..., estado_revision: 'PENDIENTE' })` + `if (data.length === 0)
throw ...`) interpretaba correctamente "0 filas afectadas" como "el
registro ya cambió de estado" — pero la causa real nunca era esa: era RLS
bloqueando el `UPDATE` antes de evaluar ninguna condición de negocio.

Encontrado investigando un prompt que pedía "corregir" el error "no se
pudo guardar la geometría: el registro ya no está en estado PENDIENTE",
asumiendo que el problema era la función de validación topológica
faltante (`fn_validar_topologia_eudr`, que sí faltaba aplicar, pero es un
problema independiente — ver la spec). Confirmado que el bug de escritura
existía desde que se implementó la Consola QC 2.0 (primera tarea de esta
línea de trabajo) — **Aprobar/Rechazar/Guardar Atributos/Guardar Geometría
nunca funcionaron contra la base de datos real**, aunque la UI, los tests
de inspección de código, y las pruebas en navegador (que nunca llegaron a
confirmar una escritura real exitosa, solo que la UI no tiraba errores de
consola) no lo habían detectado.

## Decisión

Pausado con `AskUserQuestion` antes de implementar — 3 opciones: (1)
Server Actions + Service Role Key (mismo patrón ya establecido en
`lib/actions/sociosActions.js` para el Padrón y `lib/actions/gisActions.js`
para el Editor Vectorial), (2) agregar políticas RLS `anon` de escritura a
las 3 tablas, (3) solo documentar y no arreglar en esta tarea. **El usuario
eligió la opción 1 (recomendada).**

Se creó `lib/actions/qcActions.js` (`'use server'`, Service Role Key vía
`getSupabaseServerClient()`) que envuelve las 4 funciones puras ya
existentes en `lib/eudrQcActions.js` sin modificar su lógica interna — el
guard multi-tenant (`assertSameOrganization`) y el guard de concurrencia
(`estado_revision = 'PENDIENTE'`) ya eran correctos, el problema nunca fue
esa lógica sino el cliente usado para ejecutarla. Como la Service Role Key
bypasea RLS por completo, el aislamiento multi-tenant que debería dar RLS
sigue siendo responsabilidad explícita del código (ya lo era, por diseño,
desde que se escribieron esas funciones).

Se descartó la opción 2 (políticas `anon`) por el mismo motivo que ya se
descartó para el Padrón (`specs/padron_web_socios.md`): abriría escritura
directa desde el navegador a datos operativos reales (estado de revisión
EUDR, con impacto en cumplimiento regulatorio) a cualquiera con la anon
key, sin pasar por ninguna validación server-side.

## Consecuencias

- `app/dashboard/qc/page.jsx` ya no necesita `getSupabaseClient()` en
  `handleDecision`/`handleSaveAttributes`/`handleSaveGeometry` — las 4
  acciones ahora son Server Actions (`approveQcRecord`/`rejectQcRecord`/
  `updateQcRecordAttributes`/`updateQcRecordGeometry`), invocadas
  directamente desde el cliente sin pasar ningún objeto Supabase a través
  del límite server/cliente.
- Mismo patrón de propagación de errores que `gisActions.js`: las Server
  Actions lanzan `EUDRQcError` directamente (no un objeto `{ok,error}`) —
  `page.jsx` ya capturaba `err instanceof EUDRQcError`, sin cambios
  necesarios en esa lógica.
- `fetchPendingRecords` (lectura) no cambia — sigue usando el cliente anon,
  porque `vw_monitoreo_poligonos`/`vw_monitoreo_puntos` corren con
  privilegio del owner (`postgres`), no del rol que consulta (mismo motivo
  ya documentado en `CLAUDE.md` para `vw_monitoreo_web`).
- Este bug estuvo presente desde la primera tarea de esta línea de trabajo
  — pero **nunca falló en silencio**: `handleDecision`/`handleSaveAttributes`/
  `handleSaveGeometry` esperan (`await`) la función de escritura antes de
  mostrar el toast de éxito, y las 4 funciones lanzan `EUDRQcError` cuando
  `data.length === 0` — cualquier intento real de Aprobar/Rechazar/Guardar
  siempre mostraba el toast de error correspondiente, nunca uno de éxito
  falso. No hay corrección de datos retroactiva que hacer (no hubo ningún
  `UPDATE` real que revertir, el estado en la base siempre fue el
  correcto) — el impacto fue una consola QC completamente inoperable para
  decisiones desde que se construyó, no datos corruptos ni decisiones
  fantasma.
