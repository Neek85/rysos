# Spec — Auditoría, blindaje Zod-DB y atomicidad del Formulario de Inspecciones FED

## Contexto y premisas corregidas

El prompt original pedía auditar `lib/validations/inspecciones.ts` — ese
archivo no existe (el repo no tiene TypeScript en ningún lado; confirmado
por `CLAUDE.md`). El schema Zod real es `lib/inspeccionesSchema.js`, usado
por `components/features/inspecciones/useInspeccionForm.js` (hook) y
`components/features/inspecciones/tabs/*.jsx` (8 pestañas). Tampoco existe
`npm test` ni ningún framework de testing JS instalado (ni Jest ni Vitest) —
confirmado en `package.json`.

## Resultado de la auditoría (los 4 criterios del prompt)

### (b) Aislamiento por `ID_Organizacion` en autocompletado — ✅ ya correcto, sin cambios

`lib/padronSearch.js::searchSocios`/`searchParcelas` ya filtran
`.eq('ID_Organizacion', organizationId)` explícitamente del lado cliente
(necesario porque RLS por sí sola no puede aislar por tenant para tráfico
`anon` sin JWT real — ver `docs/schema_live.md`, sección RLS). No se
encontró ningún gap aquí.

### (d) Sin `console.log` de PII — ✅ ya correcto, sin cambios

Verificado por grep exhaustivo: cero llamadas `console.*` en las 8 pestañas
(`components/features/inspecciones/tabs/*.jsx`), el hook
(`useInspeccionForm.js`), el formulario, `PadronAutocomplete.jsx`,
`lib/padronSearch.js` y `lib/inspeccionesActions.js`. Ya estaba documentado
explícitamente en comentarios de `inspeccionesActions.js` como decisión
deliberada de un audit previo (`docs/audits/auditoria_backend_inspecciones.md`).

### (c) Atomicidad del guardado (INSPECCIONES + 6 CAP_*) — ❌ gap real, corregido

`saveInspeccion()` hacía 7 llamadas REST independientes vía `Promise.all` /
llamadas secuenciales de supabase-js, sin transacción de base de datos. Una
falla a mitad de camino (ej. la tabla `CAP_RIESGOS` rechazada por una
constraint) dejaba registros huérfanos: una fila en `INSPECCIONES` sin todas
sus tablas hijas, o algunas `CAP_*` actualizadas y otras no.

**Corregido** con `public.fn_guardar_inspeccion_completa` (
`supabase/migrations/20260818_inspecciones_atomic_save.sql`), una función
plpgsql que envuelve las 7 escrituras en una sola invocación — atómica por
construcción (cualquier excepción revierte todo lo que la función ya
escribió, dentro de la transacción implícita de la llamada RPC).
`saveInspeccion()` ahora hace una sola llamada `supabase.rpc(...)`.

Diseño de la función (decisiones registradas para no tener que
re-derivarlas si se toca este código de nuevo):

- Los nombres de columna de cada tabla se transcribieron directamente desde
  las funciones `payloadInspeccion`/`payloadSocio`/`payloadMic`/
  `payloadConservacion`/`payloadBienestar`/`payloadRiesgos`/`payloadGestion`
  y el extinto array `CHILD_TABLES` de la versión previa de
  `lib/inspeccionesActions.js` — no se inventó ningún nombre de columna.
- Las 6 tablas `CAP_*` se manejan como `DELETE` + `INSERT` (no
  select-then-update-or-insert): cada guardado del formulario siempre envía
  el valor completo de la pestaña de una vez (no hay edición parcial de una
  sola columna), así que un reemplazo completo de la fila hija es
  equivalente a un `UPDATE` completo, y evita listar las columnas dos veces.
- `jsonb_populate_record(NULL::public."TABLA", payload)` se usa solo como
  fuente de valores ya tipados según cada columna real — nunca como
  `INSERT ... SELECT *`, porque eso pisaría con `NULL` cualquier columna con
  `DEFAULT` (ej. `created_at`) ausente del payload. Todo `INSERT`/`UPDATE`
  lista sus columnas de destino explícitamente.
- Sin `SECURITY DEFINER`: la función corre con el rol del llamador
  (`anon`/`authenticated`), igual que las 7 llamadas REST que reemplaza —
  no escala privilegios, solo agrupa las mismas escrituras ya permitidas por
  las políticas RLS existentes (`20260818_fix_inspecciones_rls.sql`) en una
  transacción.
- La verificación multi-tenant (`existingOrganizationId !== organizationId`)
  se mantiene en dos capas: client-side (fail-fast, sin round-trip de red) y
  dentro de la función (autoridad real — nunca confiar solo en el chequeo
  del cliente).

### (a) Paridad Zod-DB de tipos/obligatoriedad/enumeraciones — parcialmente corregido (alcance acotado, confirmado con el usuario)

**Limitación reconocida:** no hay conexión viva a la base de datos en este
entorno — "contra la base de datos viva" del prompt original no se pudo
verificar contra `information_schema`/constraints reales. La única fuente
de verdad disponible fueron los `<select>` ya en producción en el UI (que
representan los valores que la app ya escribe hoy).

**Hallazgo:** `Estado`, `Tipo_Inspeccion`, `Resultado_Global` (además de
decenas de campos Sí/No y `socio_genero`/`estado_civil` en las 8 pestañas)
están restringidos a listas fijas en su `<select>`, pero el schema Zod los
declaraba como string libre — nada impedía que un valor fuera de lista
pasara la validación de cliente.

**Corregido, alcance acotado (decisión confirmada con el usuario):** se
agregó `z.enum(...)` solo a los 3 campos core de `INSPECCIONES`
(`Estado`, `Tipo_Inspeccion`, `Resultado_Global`), extrayendo los valores
exactos de `TabGeneral.jsx`/`TabCierre.jsx` (mismas 4/5/4 opciones en ambas
pestañas, verificado que coinciden). Los ~50+ campos Sí/No y
`socio_genero`/`estado_civil` de las 8 pestañas quedan fuera de esta tarea —
menor riesgo real (un valor "Sí"/"No" mal escrito no tiene el mismo impacto
que un `Estado` inválido) y el trabajo de extraer cada `<option>` de las 8
pestañas completas se consideró desproporcionado para esta ronda.

## Decisiones de diseño (confirmadas con el usuario)

1. Atomicidad: implementar la función RPC transaccional completa (no un
   rollback best-effort en JS).
2. Cobertura de enums: solo los 3 campos core de `INSPECCIONES`, no las 8
   pestañas completas.
3. Testing: script Node plano (`node:test` + `node:assert`, ambos nativos
   desde Node 18+), sin instalar Jest/Vitest — cero dependencias nuevas.

## Nota técnica — ejecución del test Node

`node --test tests/test_inspecciones_schema.mjs` funciona sin configuración
adicional en Node 24 (detección automática de sintaxis ESM en `.js` sin
`"type": "module"` en `package.json`, estable desde Node 22.7). Emite una
advertencia de rendimiento (`MODULE_TYPELESS_PACKAGE_JSON`) — inocua, no
falla ningún test. No se agregó `"type": "module"` a `package.json` porque
afectaría la resolución de módulos de todo el proyecto (incluye archivos
`.js` de configuración como `postcss.config.js`/`tailwind.config.js` que
usan CommonJS) — fuera del alcance mínimo pedido.

## Criterios de aceptación

- AC1: `saveInspeccion()` hace una sola llamada RPC, no 7 llamadas REST.
- AC2: La función RPC revierte todas sus escrituras si cualquier tabla
  falla (correctitud por diseño de PL/pgSQL, no verificable sin Supabase
  Live en este entorno — documentado como riesgo residual).
- AC3: `Estado`/`Tipo_Inspeccion`/`Resultado_Global` rechazan valores fuera
  de su lista real de opciones.
- AC4: `node --test tests/test_inspecciones_schema.mjs` pasa al 100%.
- AC5: `npm run build` compila sin errores tras los cambios.
