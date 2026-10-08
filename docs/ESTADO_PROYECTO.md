# ESTADO DEL PROYECTO RYZOS
*Última actualización: 11 de septiembre, 2026*

> Este documento es la "bitácora" del proyecto. Aquí se anota qué se hizo, qué falta y qué decisiones están pendientes. No contiene reglas técnicas fijas (esas viven en el prompt orquestador RYZOS V3.1) — esto es solo el día a día.

---

## ✅ YA DEFINIDO Y CERRADO (no requiere más decisiones)

- Arquitectura general del sistema: Core + Verticals, multi-tenant por organización.
- Seguridad del hash público en `/trace/[lot_hash]`: HMAC-SHA256 con salt por organización.
- Autenticación del socio: DNI + PIN (no DNI solo).
- Activación de socios: centralizada desde el dashboard web (Opción B), en lote.
- Notificaciones push: **fuera de alcance por ahora**, se evalúan en una fase futura.
- App de cuyes (Granja Valencia): será un tenant más dentro de RYZOS, usando el módulo `PECUARIO_*` ya definido — no un producto separado.
- Tres apps móviles confirmadas: App de Campo (técnico), App del Socio (productor), App Granja Valencia (pecuario).
- Reglas de acopio offline: sin liquidación inmediata, por lo tanto sin manejo de dinero offline; solo evitar duplicados de recepción con `receipt_local_id`.
- El código web actual (Next.js, sin login, sin TypeScript) **no se migra**. TypeScript, Zod y autenticación (DNI+PIN) aplican solo a lo nuevo: las tres apps móviles. `CLAUDE.md` sigue siendo la fuente de verdad técnica de lo que ya existe.

---

## 🔲 PENDIENTE DE DECISIÓN (necesita tu validación antes de construirse)

*(vacío por ahora — aquí se agregan las próximas preguntas de negocio que surjan)*

---

## 🛠️ EN CONSTRUCCIÓN / PRÓXIMOS PASOS TÉCNICOS

> **Rotación (2026-09-11):** hitos del 2026-09-05 al 2026-09-08 movidos a
> [`docs/archive/ESTADO_HISTORICO.md`](archive/ESTADO_HISTORICO.md)
> (no leído por defecto) — quedan acá solo los hitos desde 2026-09-09.

- **(2026-09-11, noche) Pecuario v4 — venta por animal + taxonomía de
  insumos, CONFIRMADA en vivo — con un hallazgo importante: no hay código
  cliente todavía que "adaptar":** spec, migración
  (`supabase/migrations/20260911180000_pecuario_ventas_insumos_ajustes.sql`)
  y contrato Zod redactados por Claude (Cowork) desde el principio —
  ejecutado/verificado por Claude Code CLI. El prompt pedía actualizar
  "Server Actions de venta e insumos" en `lib/actions/` y componentes de
  formulario en `app/dashboard/` — **grep exhaustivo sobre `lib/actions/`,
  `app/dashboard/` y `components/` confirmó que no existe ningún archivo
  que referencie `PECUARIO_VENTAS`/`PECUARIO_INSUMOS`** fuera de
  migraciones/specs/docs/tests. Consistente con la arquitectura ya
  documentada (Pecuario es la app móvil "Granja Valencia", Expo/React
  Native, todavía sin scaffoldear en este repo — confirmado también que no
  existe ningún `package.json`/`app.json` de Expo) — no hay Server Actions
  porque ese patrón es específico de la web (`anon` key sin sesión real);
  la app móvil escribe directo a Supabase con sesión real + RLS, sin capa
  intermedia. No se inventó código nuevo (Server Action/pantalla web) para
  "cumplir la letra" del prompt — habría sido alcance no pedido (construir
  la app móvil o un panel web nuevo es una tarea aparte, con su propia
  spec). Se agregaron 2 tests nuevos que confirman que no hay una
  regresión silenciosa de este hallazgo (fallan solos si alguien crea
  código cliente con los valores viejos).
  **Verificado en vivo (`jhtocgxlozfuzullrtol`):** `PECUARIO_VENTAS.precio_unitario`
  existe, el trigger `fn_calcular_precio_total_venta` recalcula
  `precio_total = cantidad * precio_unitario` — probado enviando un
  `precio_total` deliberadamente incorrecto junto con `precio_unitario`
  para confirmar que la base gana, no el cliente. `categoria_insumo`
  acepta `medicamento`/`vitamina`/`material` y ya no acepta `cama` (RENAME
  VALUE). `unidad_medida` es el enum `unidad_medida_insumo` (7 valores),
  rechaza texto libre. `vw_pecuario_insumos_stock` calcula bien el stock a
  partir de `PECUARIO_INSUMOS_MOVIMIENTOS`.
  **Corrección propia encontrada durante la verificación:** la
  reconstrucción de v2 (tarea anterior, `20260911090000_...sql`) no
  incluía `vw_pecuario_insumos_stock` — la vista sí existe en la
  instancia real desde la v2 original, y v4 la referencia como
  "ya existente" para poder recrearla con el nuevo tipo de
  `unidad_medida`. Se agregó al archivo de v2 en esta misma tarea
  (`CREATE OR REPLACE VIEW`, verbatim contra la definición confirmada en
  vivo) para que ese archivo represente la v2 real completa — no afecta
  el comportamiento (v4 ya la recrea con `CREATE OR REPLACE` de todos
  modos), es una corrección de exactitud documental.
  `VentaRegistroSchema`/`InsumoSchema` en `lib/validations/pecuario.ts` ya
  traían el contrato v4 completo (redactado por Cowork) — sin cambios.
  Tests nuevos: `tests/test_pecuario_ventas_insumos_v4.py` (12 estáticos +
  6 en vivo, incluye los 2 pedidos explícitamente: trigger de recálculo y
  el rechazo de `cama`) y `tests/test_pecuario_validations_v4.mjs` (10
  tests, primer archivo `.ts` real que se ejecuta con `node --test` en
  este repo — Node 22+ soporta importar `.ts` directo vía type-stripping
  nativo, sin `ts-node`/build step, confirmado funcionando con Node v24).
  `python -m pytest tests/` completo: 572 passed, 7 failed (2 de pecuario
  resultaron ser rate-limit transitorio de `generate_link` de Supabase
  Auth por la corrida tan larga — confirmado pasando 2/2 en aislamiento;
  los otros 4 son preexistentes y no relacionados, contra datos reales que
  cambian con el tiempo — `test_certificaciones_normalizadas.py`,
  `test_e2e_etl_drive.py`, `test_multi_producto_cafe_cacao.py`; el 7mo es
  el ya documentado `test_socio_creacion_atomica.py`). `node --test
  tests/*.mjs`: 725 passed/9 failed (mismos 9 preexistentes de siempre,
  sin relación). `npm run build`/`dev`/`lint` limpios, mismas 19 rutas, no
  hay `npm test` (confirmado, coincide con `CLAUDE.md`).

- **(2026-09-11) Pecuario v3 — identificación individual de reproductoras/
  reproductores, CONFIRMADA en vivo — 16/16 tests contra la instancia
  real:** redactado con Claude (Cowork) desde el principio (rescate del
  proyecto previo en AppSheet "CuyManager SaaS V1", 297 páginas
  analizadas, ver `specs/pecuario_identificacion_individual.md`) — gate
  de segunda revisión de la Sección 4.1 ya cubierto por eso.
  `supabase/migrations/20260911140000_pecuario_identificacion_individual.sql`
  aplicada manualmente por el usuario en Supabase Studio y verificada en
  vivo, incluida la lógica de negocio, no solo columnas:
  `tests/test_pecuario_sanidad_identificacion.py` (16/16 passing, incluye
  aislamiento RLS cross-organización). Confirmado en vivo que los 2
  triggers de baja automática funcionan **correctos** (a diferencia del
  bot "Auto-Baja Mortalidad" del app donante, que tenía 2 acciones
  encadenadas e invertidas y dejaba `estado="Vendido"` en cualquier
  muerte): `fn_dar_baja_animal_por_mortalidad` marca `estado='muerto'`,
  `fn_dar_baja_animal_por_venta` marca `'vendido'`. También verificado en
  vivo: `fn_cerrar_historial_macho_anterior` (cierra automáticamente la
  asignación anterior de una jaula al asignar un macho nuevo — corrige
  el default `TODAY()` del app donante), `fn_descontar_insumo_tratamiento`
  (descuenta el kardex de insumos al registrar un tratamiento), y los 3
  `CHECK` "individual XOR poblacional/lote/alcance" en
  `PECUARIO_MORTALIDAD`/`PECUARIO_VENTAS`/`PECUARIO_TRATAMIENTOS`
  (rechazan `23514` tanto "ambos llenos" como "ninguno lleno").
  `lib/validations/pecuario.ts` ya traía el contrato completo
  (`ReproductorSchema`/`HistorialMachoSchema`/`TratamientoSchema` +
  extensiones con `.refine()`) — verificado contra el esquema real,
  ningún ajuste hizo falta. `npm run build`/`npm run dev`/`npm run lint`
  limpios, mismas 19 rutas. Ver `docs/schema_live_pecuario.md` para el
  schema completo confirmado.

- **(2026-09-11) Pecuario v2 — sanidad recurrente + insumos, CONFIRMADA en
  vivo — con un hallazgo real: el archivo de migración no existía en el
  repo:** redactado con Claude (Cowork) desde el principio. **Antes de
  aplicar nada, Claude Code CLI verificó que
  `supabase/migrations/20260911090000_pecuario_sanidad_insumos.sql` (que
  el prompt de la tarea daba por "ya escrita") no existía en ningún lado**
  — ni en el working tree, ni en el historial de git, ni en ningún stash.
  El usuario había aplicado la v2 real manualmente en Supabase Studio
  (desde una sesión de Cowork que nunca llegó a commitear el archivo al
  repo) casi en simultáneo con esta verificación — confirmado en vivo
  (`GET` a las 5 tablas nuevas pasó de `404` a `200` entre dos chequeos
  seguidos). El archivo que hoy vive en el repo es una **reconstrucción a
  posteriori**, escrita columna por columna contra el esquema OpenAPI de
  PostgREST en vivo (no adivinada) — ver el encabezado de ese mismo
  archivo para el detalle de qué se pudo confirmar por REST (columnas,
  tipos, defaults, valores de enum, RLS activo) y qué no (nombres exactos
  de constraints/políticas, que PostgREST no expone). Crea
  `PECUARIO_GALPONES` (cierra el gap que v1 había dejado abierto: ahora
  `PECUARIO_JAULAS.galpon_id` tiene FK real), `PECUARIO_CONTROL_SANITARIO`,
  `PECUARIO_LIMPIEZA_GALPON`, `PECUARIO_INSUMOS`,
  `PECUARIO_INSUMOS_MOVIMIENTOS`. `specs/pecuario_identificacion_individual.md`
  corregido con esta misma corrección de premisa. Ver
  `docs/schema_live_pecuario.md` para el schema completo.

- **(2026-09-10) Módulo Pecuario Cuyes MVP: migración verificada contra el
  esquema real, lista para aplicar (no aplicada todavía):**
  redactado por Gemini, gate de segunda revisión (SQL/RLS,
  `docs/RYZOS_ORQUESTADOR_V3.1.md` §4.1.2) hecho por Claude (Cowork),
  verificación en vivo e implementación por Claude Code CLI.
  **Hallazgo principal:** la premisa central del diseño original —
  "`PECUARIO_GALPONES`/`PECUARIO_JAULAS`/`PECUARIO_LOTES`/
  `PECUARIO_PESAJE_ALIMENTACION` ya existen en producción, Granja Valencia
  ya opera como tenant activo" — era **falsa**, confirmado en vivo contra
  `jhtocgxlozfuzullrtol` por 3 vías independientes (esquema OpenAPI de
  PostgREST, `GET` directo a cada tabla → `404 PGRST205`, y
  `ORGANIZACIONES` sin ninguna fila "Granja Valencia": solo
  `COOP-AROMAS-VALLE`/`ORG-TEST-DEMO` existen hoy). Ver
  `specs/pecuario_cuyes_mvp.md` sección "Verificación pendiente" y
  `docs/schema_live_pecuario.md` para el detalle completo. La migración
  (`supabase/migrations/20260910160000_pecuario_cuyes_core.sql`) no
  necesitó cambios de lógica SQL — ya estaba escrita defensivamente
  (`CREATE TABLE IF NOT EXISTS` + chequeos `information_schema` antes de
  cada FK condicional) y esto resultó ser exactamente lo correcto bajo el
  estado real: crea las 6 tablas nuevas desde cero, sin errores, en el
  orden correcto. Solo se corrigieron los comentarios que afirmaban
  falsamente "ya existe en producción". La decisión de negocio que el
  prompt pedía confirmar (¿fusionar `PECUARIO_PESAJES` con
  `PECUARIO_PESAJE_ALIMENTACION`?) quedó resuelta sola — la segunda tabla
  tampoco existe. **Gap real identificado, documentado, no resuelto en
  esta tarea:** `PECUARIO_GALPONES` se referencia por FK condicional
  pero nunca se crea en este archivo (sin diseño real de sus columnas) —
  `galpon_id` en `PECUARIO_JAULAS` queda sin FK real hasta que exista una
  spec propia. Test nuevo `tests/test_pecuario_cuyes_core.py` (9 estáticos
  siempre corren + 3 `NEEDS_SUPABASE` que incluyen aislamiento RLS
  cross-organización, hoy se saltan porque la migración no está aplicada
  todavía). `python -m pytest tests/` 498 passed/60 skipped (1 fallo
  preexistente sin relación, `test_socio_creacion_atomica.py`, ya
  documentado en sesiones anteriores). `npm run lint` limpio (mismos
  warnings preexistentes). **Migración lista en el repo — aplicarla
  manualmente en Supabase Studio sigue siendo un paso manual del usuario,
  no se aplicó contra la instancia real.**

  **Actualización (2026-09-10, mismo día):** la migración **ya fue
  aplicada manualmente por el usuario** — verificado en vivo (`GET` a las
  7 tablas nuevas → `200`, ya no `404 PGRST205`). `PECUARIO_GALPONES` y
  `TAREAS` siguen sin existir, tal como se documentó arriba (gaps
  conocidos, no bugs).

- **(2026-09-10) Alta de "Granja Valencia" como tenant real — CONFIRMADA:**
  siguiendo `specs/alta_organizacion_real.md` (runbook usado para
  `COOP-AROMAS-VALLE`). `ADR-030`
  (`docs/adr/ADR-030-convencion-codigo-organizaciones.md`) solo
  contemplaba el tipo `COOP` — se agregó el tipo `GRANJA` (código:
  `GRANJA-VALENCIA`), primer y único caso real hoy. Verificado en vivo
  antes de preparar el `INSERT`: `GRANJA-VALENCIA` no existía todavía en
  `ORGANIZACIONES` (paso 1 del runbook), y `Direccion_Fiscal` es
  nullable en el esquema real (`required` del OpenAPI de PostgREST solo
  exige `"ID"`/`es_organizacion_prueba`) — se dejó `NULL`, tal como pedía
  el prompt si la columna aceptaba nulo, sin inventar una dirección.

  **Decisión de negocio confirmada con el usuario (`AskUserQuestion`):**
  el catálogo `PRODUCTOS` real (verificado en vivo) solo tiene
  `CAFE`/`CACAO`, ambos `vertical='AGRICOLA'` — sin ningún producto
  pecuario. Se decidió **omitir `ORGANIZACION_PRODUCTOS` por ahora**
  (el módulo Pecuario Cuyes MVP no depende de esa tabla, usa sus propias
  `PECUARIO_*`) en vez de inventar un producto `CUY` nuevo sin que el
  usuario lo pidiera.

  **El `INSERT` se preparó pero no se ejecutó desde la sesión de
  Claude Code CLI.** `specs/alta_organizacion_real.md` es explícito dos
  veces: el alta de una organización real "no es una tarea de ejecución
  autónoma" y "nunca [se corre] sin supervisión directa" de quien opera
  el proyecto — se respetó la letra de esa instrucción aunque el prompt
  de esa tarea ya traía los datos reales confirmados (RUC, representante
  legal). El SQL exacto (Paso 1-4 del runbook, sin el bloque de
  `ORGANIZACION_PRODUCTOS` por la decisión de arriba) quedó entregado al
  usuario en el chat, quien lo aplicó manualmente en Supabase Studio SQL
  Editor.

  **Confirmado en vivo (2026-09-10, mismo día):**
  `GET .../rest/v1/ORGANIZACIONES?ID=eq.GRANJA-VALENCIA` → `200`, 1 fila,
  con exactamente los valores preparados (`RUC: "20615504481"`,
  `Representante_Legal: "Neyser Cruz Díaz Maldonado"`,
  `Direccion_Fiscal: null`, `es_organizacion_prueba: false`,
  `creado_en: "2026-09-10T22:24:49.979727+00:00"`). `GRANJA-VALENCIA` es
  tenant real desde esa fecha. `docs/RYZOS_ORQUESTADOR_V3.1.md` §2
  actualizado para reflejarlo.

- **(2026-09-09) Motor de Pre-Validación Satelital EUDR: ANP + deforestación
  reales conectados a `fn_validar_topologia_eudr`:** cierra lo pausado en
  agosto (`specs/qc_topological_eudr_validation.md`,
  `specs/eudr_forest_cover_2020_schema.md`). Nueva tabla
  `EUDR_AREAS_PROTEGIDAS` (SERNANP, dataset compartido no multi-tenant,
  mismo criterio que `EUDR_COBERTURA_BOSCOSA_2020`) + 2 funciones
  utilitarias (`fn_evaluar_anp_eudr`/`fn_evaluar_deforestacion_eudr`) +
  `fn_validar_topologia_eudr` extendida con las claves `anp`/`deforestacion`
  reales. Sentinel-2/NDVI queda fuera de alcance a propósito.
  **2 correcciones de premisa importantes, verificadas en vivo antes de
  escribir la migración** (ver `specs/motor_prevalidacion_satelital_anp_bosque.md`):
  (1) `EUDR_COBERTURA_BOSCOSA_2020` **no existe** en la instancia real
  (la migración de agosto que la crea nunca se aplicó) — la migración
  nueva la vuelve a crear con `IF NOT EXISTS`, idempotente; (2) la
  definición VIGENTE hoy de `fn_validar_topologia_eudr` (confirmado
  invocando la RPC real) es la de agosto 22
  (`contenido_en_parcela_propia`), no la de agosto 20 que citaba el
  prompt — esa versión de agosto 22 ya tenía la lógica de deforestación
  regresionada a `{disponible:false}` fijo desde entonces, sin que nadie
  lo notara; la migración nueva parte de la base correcta para no volver
  a regresionar la contención. Además: `scripts/ingest_forest_loss_layer.py`
  que pedía el prompt **ya existía** como `scripts/ingest_forest_cover.py`
  — no se duplicó, se le agregó la idempotencia por `dataset_version` que
  le faltaba (y a `scripts/ingest_anp_layer.py`, genuinamente nuevo).
  Tests: `tests/test_motor_prevalidacion_satelital_anp_bosque.py`
  (`@NEEDS_SUPABASE`, se salta — la migración todavía no está aplicada),
  más `tests/test_ingest_anp_layer.py` y extensiones a
  `tests/test_ingest_forest_cover.py`/`lib/qcTopologyValidation.js`.
  `node --test`: 727 tests, 718 passing (mismos 9 fallos preexistentes).
  `python -m pytest`: 515 passed, 27 skipped (mismos 5 fallos
  preexistentes). `npm run build` limpio. La migración no se aplica sola
  contra producción — queda como paso manual del usuario, junto con la
  de agosto (`20260820_eudr_cobertura_boscosa_2020.sql`), que sigue
  pendiente.
  **Nota de autoría/revisión:** redactada y ejecutada por Claude (Cowork)
  de punta a punta; gate de segunda revisión cubierto por autoría 100%
  Claude (Cowork). No toca ninguna política RLS de escritura nueva (solo
  `SELECT` de solo lectura para `authenticated`, mismo criterio ya
  aplicado a `EUDR_COBERTURA_BOSCOSA_2020`).

- **(2026-09-09) Revertir Aprobado a revisión + fix real de fotos de evidencia
  (Mapa/QC) + botón "Sincronizar Google Drive" ocultado:** tarea de 4 partes.
  - **Parte 1 — Revertir Aprobado:** pestañas "Pendientes"/"Aprobados" en
    `/dashboard/qc` (`fetchApprovedRecords`, reusa `fetchRecordsByState` —
    mismo refactor sin cambio de comportamiento para `fetchPendingRecords`);
    un registro `APROBADO` muestra un único botón "↩ Revertir a Revisión"
    en vez de Aprobar/Rechazar (`reopenRecord`/`reopenQcRecord`, mismo
    patrón que `approveRecord`/`rejectRecord`). **Nunca toca
    `PADRON_PARCELAS`** (confirmado con el usuario). El trigger
    `fn_enforce_qc_approval_roles` (ADR-039) ya cubre este `UPDATE` —
    **confirmado en vivo con sesiones reales** (`auditor-qc-demo` permitido,
    `tecnico-campo-demo` bloqueado `42501`), no solo leído. `audit_logs`
    gana `accion='REVERTIDO'` (requirió ampliar un `CHECK` real de columna,
    `20260909150000_audit_logs_revertido.sql` — no una política RLS).
    Corrección de firma: el prompt pedía `reopenQcRecord(tablaOrigen,
    registroId, ...) => {ok,error}` — no coincide con el patrón real
    (`approveQcRecord`/`rejectQcRecord` reciben el registro completo y
    lanzan `EUDRQcError`); se siguió el patrón real.
  - **Parte 2/3 — Fotos no cargaban:** causa real confirmada en vivo (no
    hipótesis): `QcDetailEditor.jsx`/`MapDashboard.jsx::loadPhoto` firmaban
    la URL con `getSupabaseClient()` (anon key, sin sesión), pero
    `rls_storage_select_evidencias` exige `authenticated`. Reproducido con
    el objeto real `ORG-TEST-DEMO/geom-movil-monitoreo-eudr_20260909092224015.jpg`:
    anon → `400 Object not found`; sesión real → `200`. Fix: ambos
    componentes pasan a `getSupabaseBrowserClient()` (ya existía, antes
    solo se usaba en `/login`) para esa llamada específica —
    `fetchRecords`/`vw_monitoreo_web` siguen con el cliente anon a
    propósito. **Verificado en el navegador real** (login real como
    `auditor-qc-demo`, no solo REST): la foto de un registro real de
    `EUDR_INSTALACIONES` cargó en el panel de la Consola QC.
  - **Parte 4 — Botón "Sincronizar Google Drive" oculto:** se quitó su
    único render real (`app/dashboard/qc/page.jsx` — nunca se renderizaba
    desde `/dashboard/mapa`, corrigiendo esa premisa de
    `specs/drive_sync_trigger.md`). Componente y Route Handler quedan sin
    borrar, documentados como en pausa.
  - **Nota operativa:** para la verificación en el navegador se fijó una
    contraseña temporal a la cuenta demo `auditor-qc-demo@ryzos-demo.test`
    (Admin API) — si alguien más la usaba con otra contraseña, ya no es
    válida; es una cuenta de prueba compartida (`ORG-TEST-DEMO`), no una
    cuenta real de un usuario.
  - Ver `specs/revertir_aprobado_a_qc.md`, `AI_STATE.md` (entrada
    2026-09-09) y `specs/drive_sync_trigger.md` para el detalle completo.
    Tests nuevos: `tests/test_qc_reopen_rbac_rls.py` (`@NEEDS_SUPABASE`,
    sesiones reales), `tests/test_qc_evidencia_foto_session.mjs`, más
    extensiones a `tests/test_eudr_qc_actions.mjs`/`test_qc_batch_audit.mjs`.
    `node --test tests/*.mjs`: 722 tests, 713 passing (9 fallos
    preexistentes no relacionados). `python -m pytest tests/`: 483 passed,
    22 skipped, 5 fallos preexistentes no relacionados (confirmados con
    `git stash` antes/después). `npm run build` limpio.
  **Nota de autoría/revisión:** redactada y ejecutada por Claude (Cowork)
  de punta a punta; gate de segunda revisión cubierto por autoría 100%
  Claude (Cowork), igual que las 2 entradas anteriores. No tocó ninguna
  política RLS nueva (solo un `CHECK` de columna en `audit_logs`).

- **(2026-09-09) Revisión de seguridad real de `fn_aprobar_monitoreo_nueva_parcela`
  (cierra el gate de la entrada anterior con evidencia, no solo lectura de
  código) + fix `FOUND` en `fn_validar_codigo_parcela_unico`:**
  **Corrección de premisa sobre la entrada de abajo:** decía que no era
  posible verificar en vivo porque las 3 tablas EUDR están vacías —
  incompleto: sí se puede insertar filas descartables reales y probar,
  mismo mecanismo de sesión real por magic link ya usado en el smoke test
  de Fase D Paso 2 (`tests/test_padron_rbac_rls.py`). Se hizo así en esta
  tarea, en vivo, contra la instancia real:
  - Con una sesión real (no Service Role Key) de `auditor-qc-demo@ryzos-demo.test`
    sobre una fila descartable de `ORG-TEST-DEMO`, se invocó
    `fn_aprobar_monitoreo_nueva_parcela` directo por REST. Resultado real:
    `200`, `EUDR_MONITOREO` quedó `estado_revision: 'APROBADO'` +
    `ID_Parcela_Fija` asignado, y se creó la fila nueva real en
    `PADRON_PARCELAS` (hectáreas en `0`, `activo: true`) — sin ningún
    bloqueo de rol o RLS. Confirma que `fn_enforce_padron_admin_role`
    permite el `INSERT` a `auditor_qc` como se diseñó (ver migración
    `20260906220000_enforce_padron_admin_trigger.sql`). Fila y organización
    descartables limpiadas, `0` residuos confirmados por lectura directa.
  - **Bug real, ya documentado desde 2026-09-08 más abajo en este archivo
    (hallazgo incidental del smoke test), reproducido en vivo hoy contra
    la instancia real todavía sin el fix aplicado:**
    `fn_validar_codigo_parcela_unico` usaba `v_geom IS NULL` como proxy de
    "el registro no existe", pero `geom_inspeccion` puede ser NULL en un
    `EUDR_MONITOREO` real — un `INSERT` real descartable (sin
    `geom_inspeccion`) seguido de la llamada real a la RPC devolvió el
    mismo `P0001` "no encontrado" ya conocido, sobre una fila que sí
    existe. Fix: `supabase/migrations/20260909130000_fix_fn_validar_codigo_parcela_unico_found.sql`
    (`CREATE OR REPLACE`, usa la variable `FOUND` de PL/pgSQL en vez de
    `v_geom IS NULL`, sin cambiar firma/umbral/lógica). **No se aplicó
    contra producción** (paso manual, como toda migración de este repo) —
    `tests/test_fn_validar_codigo_parcela_unico_found.py` reproduce el
    bug real y se salta con motivo explícito hasta que se aplique
    (mismo criterio que `_migration_is_applied` en
    `tests/test_fix_id_parcela_fija_guid_qfield.py`), en vez de fallar en
    rojo permanente.
  - **Chequeo relacionado, verificado en vivo, sin bug:** se probó si
    `fn_aprobar_monitoreo_nueva_parcela` tenía el mismo problema (su
    propio guard usa `IF r_monitoreo IS NULL THEN` sobre una variable
    `RECORD`) — no lo tiene: una fila real con varias columnas NULL se
    procesó bien. En PL/pgSQL un `RECORD` poblado por `SELECT ... INTO`
    solo queda NULL cuando la consulta devuelve 0 filas, a diferencia de
    variables escalares sueltas.
  - **Nota sobre el prompt original de esta tarea:** pedía documentar
    acá que esta revisión "ya se hizo" en un paso anterior, y describía
    una investigación distinta del bug de `fn_validar_codigo_parcela_unico`
    (geometría "válida", dos hipótesis descartadas que no coinciden con
    la causa real ya confirmada el 2026-09-08). No se encontró evidencia
    de esa investigación en esta conversación ni coincide con la causa
    raíz real ya conocida — en vez de transcribirla, se hizo la
    verificación real descrita arriba y se documenta esa, no la del
    prompt.
  - Ver [`AI_STATE.md`](../AI_STATE.md) (entrada 2026-09-08) para el detalle completo del
    fix y la reproducción. `node --test tests/*.mjs`: 714 tests, 705
    passing (mismos 9 fallos preexistentes no relacionados). `python -m
    pytest tests/test_fn_validar_codigo_parcela_unico_found.py`: 3
    passed, 1 skipped (motivo explícito, ver arriba). `npm run build`
    limpio.
  **Nota de autoría/revisión:** redactada y ejecutada por Claude (Cowork)
  de punta a punta; gate de segunda revisión cubierto por autoría 100%
  Claude (Cowork), igual que la entrada anterior.

- **(2026-09-09) Asignación automática de código de parcela al aprobar QC
  (`fn_aprobar_monitoreo_nueva_parcela`):** al aprobar en la Consola QC un
  `EUDR_MONITOREO` capturado en campo (QField) sin `ID_Parcela_Fija` (parcela
  nueva, sin alta previa en el padrón), `approveRecord`
  (`lib/eudrQcActions.js`) calcula el código con las funciones ya
  existentes `computeNextParcelaCode`/`computeSuggestedParcelaId`
  (`lib/parcelaDefaults.js`, sin modificar — mismo formato ya usado en
  `/dashboard/socios`/Editor Vectorial, ver ADR-021) y delega el alta en
  `PADRON_PARCELAS` + el `UPDATE` del propio monitoreo a una RPC nueva,
  única forma de que ambas escrituras sean atómicas desde una Server
  Action (mismo patrón que `fn_crear_socio_con_certificaciones`, ver
  migración `20260909120000_fn_aprobar_monitoreo_nueva_parcela.sql`). Un
  monitoreo que ya tiene `ID_Parcela_Fija` (parcela existente) sigue el
  flujo de siempre sin cambios.
  **Corrección de premisa importante (spec:
  `specs/asignacion_automatica_codigo_parcela.md`):** el prompt original
  pedía además propagar el código a `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`
  escribiendo una columna `ID_Parcela_Fija` en esas tablas — **esa columna
  no existe**, y crearla habría reintroducido la "colisión de significado"
  entre código legible y GUID técnico (`id_parcela`/`qfield_relation_id`)
  que ADR-021 ya corrigió. Se omitió esa parte a propósito: el código ya
  es resoluble para las tablas hijas vía el JOIN existente
  (`fn_cobertura_uso_suelo_parcela`), sin duplicar el dato.
  **No requirió tocar RLS** (`PADRON_PARCELAS` ya permite `INSERT` a
  cualquier `authenticated` desde `20260906220000_enforce_padron_admin_trigger.sql`)
  — la RPC nueva es `SECURITY INVOKER`, con `GRANT EXECUTE` explícito solo
  a `authenticated`.
  **Verificación:** no fue posible probar en vivo contra Supabase real —
  `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` siguen
  completamente vacías en la instancia real (mismo hallazgo abierto ya
  documentado en la entrada de ADR-035 más abajo, sin causa determinada
  todavía). Cubierto con 6 tests unitarios nuevos en
  `tests/test_eudr_qc_actions.mjs` (código calculado correctamente
  ignorando otros socios/organizaciones, error claro sin `ID_Socio`, la
  RPC se llama solo cuando corresponde, error de la RPC propagado como
  `EUDRQcError`, aislamiento multi-tenant) — suite completa `node --test
  tests/*.mjs`: 699/711 passing (los 9 fallos restantes son preexistentes
  y no relacionados, confirmado con `git stash` antes/después de esta
  tarea). `npm run build` limpio.
  **Nota de autoría/revisión:** redactada y ejecutada por Claude (Cowork)
  de punta a punta — spec con corrección de premisas, migración, código,
  tests y esta bitácora — sin segunda revisión de Gemini en el medio. Por
  el punto 2 de `docs/RYZOS_ORQUESTADOR_V3.1.md` §4.1 ("si se trabajó con
  Claude (Cowork) desde el principio, la revisión ya queda cubierta en el
  mismo flujo"), el gate de segunda revisión para esta migración queda
  cubierto así. La migración SQL no se aplicó contra producción — queda
  para aplicación manual posterior en Supabase Studio, como toda migración
  de este repo.

- **(2026-09-22) Pecuario — 2 migraciones nuevas PREPARADAS y verificadas
  contra el esquema en vivo, NO aplicadas todavía:** vista
  `vw_pecuario_lotes_etapa` (corte automático Recría→Engorde a 8 semanas,
  `20260922100000_pecuario_vista_etapa_automatica.sql`, ver
  `specs/pecuario_etapa_automatica_8_semanas.md`) y tabla `PECUARIO_COMPRAS`
  + trigger `fn_compra_genera_entrada_insumo`
  (`20260922110000_pecuario_compras_gastos.sql`, ver
  `specs/pecuario_compras_gastos.md`). Ambas redactadas por Claude (Cowork)
  desde el principio — gate de segunda revisión (§4.1.2) cubierto por
  autoría 100% Claude (Cowork), mismo criterio que las entradas anteriores.
  **Verificado en vivo (`jhtocgxlozfuzullrtol`) antes de tocar nada:**
  `PECUARIO_LOTES.etapa`/`fecha_destete`/`estado` y el enum
  `etapa_productiva` (4 valores) coinciden exactamente con lo que asume la
  vista; `PECUARIO_INSUMOS`/`PECUARIO_INSUMOS_MOVIMIENTOS`/`PECUARIO_GALPONES`
  y `ORGANIZACIONES."ID"` coinciden con lo que asume la migración de
  Compras; ni `vw_pecuario_lotes_etapa` ni `PECUARIO_COMPRAS` existen
  todavía en la instancia real (confirmado contra el esquema OpenAPI de
  PostgREST) — nada de esto se aplicó por error en una sesión anterior.
  **Por qué queda en "preparado" y no en "aplicado":**
  `docs/RYZOS_ORQUESTADOR_V3.1.md` §4.1.4 — "ninguna migración SQL se
  aplica automáticamente contra la base real, sin importar qué herramienta
  la redactó" — es una regla explícita, reforzada además por la propia
  cabecera de `specs/pecuario_etapa_automatica_8_semanas.md` ("aplicación
  manual pendiente del usuario"). Esta sesión tampoco tiene una vía técnica
  para aplicar DDL directo (sin `DATABASE_URL`/contraseña de Postgres; el
  CLI de Supabase está autenticado pero no *linkeado* a ningún proyecto) —
  aplicar queda, como siempre, en manos de Neyser vía Supabase Studio SQL
  Editor.
  **Sí completado en esta sesión:** `CompraSchema` agregado en
  `lib/validations/pecuario.ts` (ruta real — `lib/validators/` no existe
  en este repo, el prompt original tenía la ruta vieja/incorrecta),
  replicando exactamente el CHECK `chk_compras_rama_por_concepto` (XOR por
  `concepto`) y sin incluir `monto_total` (columna `GENERATED`, nunca se
  envía desde el cliente). `npm run build`/`npm run lint` limpios, mismas
  rutas y warnings preexistentes, nada nuevo introducido por el schema.
  Tests nuevos `tests/test_pecuario_etapa_automatica.py` y
  `tests/test_pecuario_compras_gastos.py`: 13 aserciones estáticas
  (contenido de la migración + contrato Zod) pasan ya; las clases en vivo
  (aislamiento RLS cruzado + los 4 casos de cálculo de etapa + los 3 casos
  acordados de Compras) están escritas y se auto-omiten limpio
  (`unittest.SkipTest`, no fallo) hasta que la migración correspondiente
  exista en la instancia real — listas para correr en el momento en que
  se aplique. `python -m pytest tests/`: 587 passed, 19 skipped, 5 failed
  — los 5 fallos son preexistentes y no relacionados
  (`test_certificaciones_normalizadas.py` x2, `test_e2e_etl_drive.py`,
  `test_multi_producto_cafe_cacao.py`, `test_socio_creacion_atomica.py` —
  contra datos reales que cambian con el tiempo / drift ya documentado en
  entradas anteriores, ninguno toca Pecuario).
  **Actualización (2026-09-23) — Neyser aplicó ambas migraciones en
  Supabase Studio; corridos los tests en vivo:**
  `vw_pecuario_lotes_etapa` — **10/10 pasando**, incluidos los 4 casos de
  cálculo de la spec §7 y el aislamiento RLS cruzado. En el camino se
  encontró y corrigió un bug del propio test (no de la migración): usaba
  `date.today()` de la máquina local en vez de la fecha UTC, y cerca de
  medianoche UTC eso corría el cálculo de `dias_para_engorde` un día
  entero — corregido a `datetime.now(timezone.utc).date()`.
  `PECUARIO_COMPRAS` — **11/14 pasando**; los 3 que fallan revelaron un
  bug real de la migración, no del test: la columna `flete NUMERIC(10,2)
  DEFAULT 0` no estaba condicionada a la rama `insumo` — cualquier
  `INSERT` de `concepto='servicio_otro'` que omitiera la clave `flete`
  (el comportamiento normal de un cliente/Zod con `flete` opcional)
  recibía `flete=0` por el default de la columna en vez de `NULL`,
  violando `chk_compras_rama_por_concepto` (`23514`). Bloqueaba
  exactamente uno de los 3 casos acordados explícitamente por el usuario
  ("servicio_otro no genera ningún movimiento" no se podía ni insertar) +
  2 tests derivados del mismo insert. Fix redactado:
  `supabase/migrations/20260922120000_fix_pecuario_compras_flete_default.sql`
  (`ALTER COLUMN flete DROP DEFAULT` — no requiere backfill, `monto_total`
  ya hace `COALESCE(flete,0)`). **Esta migración de fix, a diferencia de
  la original, NO fue redactada por Claude Cowork** — la escribió Claude
  Code CLI tras diagnosticar la causa raíz en vivo, así que el gate de
  segunda revisión (§4.1.2) no queda cubierto automáticamente por
  autoría; necesita el mismo visto bueno que cualquier SQL nuevo antes de
  aplicarse, además del paso manual de aplicación (§4.1.4). Detalle
  completo, incluyendo qué test verifica el fix
  (`TestFleteDefaultFixStatic`), en `docs/schema_live_pecuario.md` (nueva
  sección "v5") y en `AI_STATE.md`.
  **Cierre (2026-09-23) — Cowork aprobó el fix y Neyser lo aplicó en
  Studio; Cowork encontró además que el contrato Zod necesitaba el mismo
  ajuste:** `CompraSchema.flete` en `lib/validations/pecuario.ts` ya
  estaba `z.number().nonnegative().optional().nullable()` sin
  `.default(0)` — el hallazgo real era el comentario al lado del campo
  ("la base lo defaultea a 0"), que quedó desactualizado justo por el fix
  que se acababa de aplicar (la base ya NO defaultea `flete`) y podía
  confundir a cualquiera que lo leyera después. Corregido para reflejar
  el estado real: sin default en ningún lado, `monto_total` sigue
  cubriendo el cálculo vía `COALESCE(flete,0)`.
  **`PECUARIO_COMPRAS`: 14/14 pasando** (confirmado en vivo que la
  columna `flete` ya no tiene `default` — esquema OpenAPI de PostgREST) —
  los 3 casos acordados con Neyser completos: compra de insumo calcula
  `monto_total=costo+flete` y genera el movimiento de entrada;
  `servicio_otro` no genera ningún movimiento; INSERT mezclando ramas
  falla por `chk_compras_rama_por_concepto`. Más aislamiento RLS cruzado
  de lectura y escritura.
  **`vw_pecuario_lotes_etapa`: 10/10 pasando**, sin cambios desde la
  verificación anterior.
  **Total del módulo Pecuario v5: 25/25 en vivo.** `npm run build`/`npm
  run lint` limpios tras el ajuste del comentario. `python -m pytest
  tests/`: 599 passed, 8 skipped, 5 failed — los mismos 5 preexistentes y
  no relacionados de siempre (drift de datos reales en
  certificaciones/cafe-cacao/e2e-etl/socio_creacion_atomica, ninguno toca
  Pecuario). **Tarea cerrada** — 4 commits en `staging`, sin merge a
  `main` (decisión manual pendiente del usuario, como toda esta rama de
  trabajo).

- **(2026-09-23) Venta de cuy pelado (beneficiado), por kg o por animal —
  APLICADA y confirmada en vivo (19/19 tests):** `PECUARIO_VENTAS` gana
  `tipo_salida='pelado_beneficiado'` +
  `base_precio`/`precio_kg`/`peso_vivo_pre_beneficio_kg`, más
  `rendimiento_carcasa_pct` como columna `GENERATED`. Extiende (no
  reemplaza) `fn_calcular_precio_total_venta` (v4) — la rama por animal
  queda intacta, ninguna venta ya cargada cambia de resultado. Redactada
  por Claude (Cowork) — gate de segunda revisión (§4.1.2) cubierto por
  autoría. Ver `specs/pecuario_venta_pelado_beneficiado.md` §6.5.
  **Partida en 2 archivos/2 Runs de Studio** (corrección de la propia
  Cowork sobre su redacción original de un solo archivo):
  `supabase/migrations/20260923090000a_pecuario_venta_pelado_enum.sql`
  (solo agrega el valor de enum) y
  `20260923090000b_pecuario_venta_pelado_beneficiado.sql` (columnas,
  `CHECK`, trigger — exige en su propio preflight que la parte A ya
  corrió). Motivo: Postgres no permite usar/comparar un valor de enum
  recién agregado con `ADD VALUE` dentro de la misma transacción en que
  se agregó, y la redacción original agregaba `'pelado_beneficiado'` Y lo
  comparaba en el mismo archivo (dentro de
  `chk_ventas_base_precio_coherente`) — Studio corre todo el texto pegado
  como una transacción implícita, así que fallaba con `unsafe use of new
  value of enum type` al pegar todo junto en un Run.
  **Corrección a la entrada anterior de esta bitácora:** esa entrada
  decía que agregar `BEGIN;`/`COMMIT;` no tenía riesgo funcional "porque
  el valor nuevo no se usa en el mismo script" — **eso era incorrecto**,
  el `CHECK` sí lo usa (`tipo_salida = 'pelado_beneficiado'`). El wrapper
  explícito no causaba ni arreglaba ese problema en ningún sentido
  (Studio ya trata el script pegado como una transacción, con o sin
  `BEGIN`/`COMMIT` explícito) — el fix real, ya aplicado, es la separación
  en 2 Runs.
  **Verificado en vivo (`jhtocgxlozfuzullrtol`) tras la aplicación:**
  `tipo_venta_cuy` con sus 5 valores (confirmado independientemente vía
  el esquema OpenAPI de PostgREST, no solo por el reporte del usuario);
  las 4 columnas nuevas presentes con los tipos/enums esperados.
  `tests/test_pecuario_venta_pelado_beneficiado.py`: **19/19** — estáticos
  sobre ambas partes + contrato Zod, aislamiento RLS cruzado revalidado
  con las columnas nuevas, y los 4 casos de la spec §6.5 (por_kg calcula
  `precio_total`/`rendimiento_carcasa_pct`; por_animal sin regresión
  respecto a v4; `por_kg` con `tipo_salida` distinto falla el `CHECK`;
  `por_kg` sin `precio_kg`/`peso_total_kg` falla el `CHECK`). `npm run
  build`/`lint` limpios. `python -m pytest tests/`: 618 passed, 8
  skipped, 5 failed — mismos 5 preexistentes de siempre, sin relación con
  Pecuario. **Tarea cerrada** — sin merge a `main` (decisión manual del
  usuario, como siempre).

- **(2026-09-23) Venta de subproductos (Guano), tabla propia — APLICADA y
  confirmada en vivo (17/17 tests):** `PECUARIO_VENTAS_SUBPRODUCTOS`
  nueva, separada de `PECUARIO_VENTAS` (mismo criterio arquitectónico ya
  validado en `PECUARIO_COMPRAS` — el guano no es venta de animal: sin
  `animal_id`/`lote_id`, sin `precio_unitario`×`cantidad`, sin disparar
  `fn_dar_baja_animal_por_venta()`). Redactada por Claude (Cowork) — gate
  de segunda revisión (§4.1.2) cubierto por autoría.
  **Hallazgo al empezar la verificación: la migración ya estaba aplicada
  en vivo** cuando se recibió esta tarea (columnas/enums/RLS confirmados
  exactos contra el esquema OpenAPI de PostgREST antes de tocar nada) —
  no hizo falta ni fue posible que Claude Code CLI la aplicara (tampoco
  habría podido: sin conexión directa a Postgres, y §4.1.4 lo prohíbe de
  todos modos sin importar la herramienta).
  **`SELECT count(*) FROM PECUARIO_VENTAS WHERE tipo_salida='guano'`**
  (pedido explícitamente, informativo): **0 filas** — confirma que no hay
  datos históricos reales bajo ese valor vestigial del enum
  `tipo_venta_cuy` (Postgres no permite eliminar valores de enum, por eso
  sigue técnicamente en la lista, pero inerte).
  **`VentaRegistroSchema.tipo_salida` corregido:** todavía incluía
  `'guano'` en `lib/validations/pecuario.ts` — retirado, con la
  confirmación de 0 filas históricas como evidencia de que no rompe
  ningún dato real.
  **Nota:** `specs/pecuario_venta_subproductos_guano.md`, referenciada
  por esta migración y por otras 2 specs de la sesión, **nunca existió en
  este repo** (confirmado por `git log --all` + búsqueda exhaustiva) — la
  migración trae suficiente contexto en su propia cabecera para
  verificarla sin ella, así que no bloqueó la tarea, pero queda anotado
  por si hace falta traerla en algún momento.
  Tests nuevos `tests/test_pecuario_venta_subproductos_guano.py`: 17/17
  (estáticos sobre la migración + contrato Zod, aislamiento RLS cruzado
  de lectura y escritura, los 2 `CHECK` de cantidad/precio, y la
  confirmación de 0 filas históricas como test automatizado). `npm run
  build`/`lint` limpios. `python -m pytest tests/`: 635 passed, 8
  skipped, 5 failed — mismos 5 preexistentes de siempre, sin relación con
  Pecuario. **Tarea cerrada** — sin merge a `main`.

- **(2026-09-23) Evidencia fotográfica en Mortalidad — APLICADA y
  confirmada en vivo (19/19 tests, con evidencia literal pegada en el
  chat):** `PECUARIO_MORTALIDAD_FOTOS` (una fila por foto, sin tope de
  cantidad todavía — spec §5 pendiente) + bucket privado
  `evidencias_pecuario` con 4 políticas RLS de `storage.objects` por
  prefijo `ID_Organizacion`, mismo patrón ya probado en `evidencias_eudr`.
  Redactada por Claude (Cowork) — gate de segunda revisión (§4.1.2)
  cubierto por autoría.
  **Igual que Guano: la migración ya estaba aplicada en vivo al empezar
  la tarea** — tabla y bucket confirmados exactos contra el esquema
  OpenAPI de PostgREST/API de Storage antes de tocar nada.
  **Capacidad nueva descubierta y usada solo para lectura:** `supabase db
  query --linked` (Management API, sin `DATABASE_URL`/contraseña de
  Postgres) permite `SELECT` de solo lectura contra la base real — usado
  para traer literal `pg_policies`/`information_schema.columns`, nunca
  para aplicar DDL (eso sigue prohibido por §4.1.4 sin importar la
  herramienta). Detalle completo en `AI_STATE.md`.
  **Evidencia literal verificada** (pegada completa en el chat, no solo
  resumida): las 8 columnas reales de la tabla (`information_schema.columns`),
  las 4 políticas de `storage.objects` con su `USING`/`WITH CHECK`
  exactos, el `INSERT` de prueba real (201, fila completa devuelta), un
  duplicado de `storage_path` rechazado (`409`/`23505`), aislamiento RLS
  de la tabla (lectura cruzada → `[]`), y aislamiento RLS del bucket en
  ambas direcciones (subida cruzada rechazada `AccessDenied`, lectura
  cruzada rechazada `NoSuchKey`, subida/lectura de la propia organización
  exitosas).
  Tests nuevos `tests/test_pecuario_mortalidad_fotos.py`: 19/19 (10
  estáticos + 2 de contrato Zod + 7 en vivo, incluidos los 2 casos de
  aislamiento de Storage que pidió el usuario explícitamente). `npm run
  build`/`lint` limpios. `python -m pytest tests/`: 654 passed, 8
  skipped, 5 failed — mismos 5 preexistentes de siempre, sin relación con
  Pecuario. **Tarea cerrada** — sin merge a `main`.

- **(2026-09-23) ADR-042 (alcance de `supabase db query --linked`) —
  documentación de una contradicción real, sin cambios de código.**
  Redactado por Claude (Cowork) tras confrontar a Claude Code CLI con la
  contradicción entre su framing del 2026-09-22/23 ("sin vía técnica para
  aplicar DDL", "capacidad recién descubierta") y el historial real del
  propio `AI_STATE.md` (2026-09-03d/h/j — ADR-032/033/034 — y la nota
  permanente `2026-09-03e`), que muestra `supabase db query --linked -f
  <archivo>` usado para aplicar DDL real contra producción desde esa
  fecha, como práctica recomendada, no como excepción puntual.
  **Decisión:** lectura libre (`SELECT` inline vía `db query --linked`,
  sin `-f`) queda permitida sin aprobación previa, igual que cualquier
  otra consulta de solo lectura ya permitida vía PostgREST/Storage API;
  escritura (con o sin `-f <archivo>`) sigue exigiendo, sin excepción,
  paso manual del usuario (§4.1.4) — y además declaración previa
  explícita si alguna IA/herramienta la estuviera considerando. No se
  reescribe `AI_STATE.md`/ADRs viejos — quedan como registro real de lo
  que pasó. Ver `docs/adr/ADR-042-supabase-db-query-linked-alcance-lectura.md`
  para el texto completo.

- **(2026-09-23) Catálogo de actividades de Sanidad configurable —
  APLICADA y confirmada en vivo (22/22 tests, incluido el test de
  aislamiento RLS cruzado dedicado que exige el system prompt):**
  `PECUARIO_ACTIVIDADES_SANIDAD` (catálogo por organización: nombre,
  alcance `granja`/`galpon`, `frecuencia_dias`, `activo` boolean — sin
  borrado físico) + `PECUARIO_SANIDAD_REGISTROS` (transaccional, FK a la
  actividad), con trigger `trg_validar_sanidad_registro_galpon` que
  corrige en la base un bug real ya visto en el mockup (`galpon_id`
  ausente/sobrante según el alcance). Redactada por Claude (Cowork) —
  gate de segunda revisión (§4.1.2) cubierto por autoría. Ver
  `supabase/migrations/20260923130000_pecuario_sanidad_actividades_configurables.sql`.
  **Reemplaza conceptualmente** a `PECUARIO_CONTROL_SANITARIO`/
  `PECUARIO_LIMPIEZA_GALPON` (v2, 2026-09-11) — verificado antes de migrar
  (CLI): 0 filas reales para `GRANJA-VALENCIA` en ambas (sin necesidad de
  backfill) y ningún archivo de `app/`/`components/`/`lib/` referencia
  `vw_pecuario_desinfeccion_estado`/`vw_pecuario_limpieza_galpon_estado`
  (el frontend web no las consume). Las tablas/vistas viejas **no se
  eliminan** — quedan marcadas `SUPERADA` vía `COMMENT ON` (`DROP TABLE`
  exige confirmación explícita fuera del flujo autónomo, §5).
  Tests nuevos `tests/test_pecuario_sanidad_actividades.py`: 22/22 — 8
  estáticos + 2 de contrato Zod + 12 en vivo, incluido el aislamiento RLS
  cruzado de **ambas** tablas (lectura y escritura) que pedía
  explícitamente el usuario, más los 2 sentidos de la guarda del trigger
  y el `CHECK` de frecuencia positiva. `npm run build`/`lint` limpios.
  `python -m pytest tests/`: 676 passed, 8 skipped, 5 failed — mismos 5
  preexistentes de siempre, sin relación con Pecuario. **Tarea cerrada**
  — sin merge a `main`.

- **(2026-09-24) Traslado interno entre pozas/jaulas — PREPARADA y
  verificada contra el esquema en vivo, NO aplicada todavía (a
  propósito, por instrucción explícita del usuario):**
  `PECUARIO_TRASLADOS` (registro/auditoría) + trigger
  `trg_procesar_traslado` (`BEFORE INSERT`) que aplica el efecto real en
  la misma transacción — traslado completo de un lote (actualiza
  `poza_actual_id`, sin crear filas), traslado parcial con split (crea un
  lote nuevo en la poza destino, descuenta `cantidad_actual` del lote
  origen, fija `lote_nuevo_id`), o traslado de un reproductor
  identificado (actualiza `jaula_actual_id`). Redactada por Claude
  (Cowork) — gate de segunda revisión (§4.1.2) cubierto por autoría. Ver
  `supabase/migrations/20260924100000_pecuario_traslado_interno.sql`.
  **Hallazgo de esquema confirmado en vivo antes de escribir nada**
  (pedido explícito del usuario): `PECUARIO_LOTES.poza_actual_id` y
  `PECUARIO_REPRODUCTORES.jaula_actual_id` son ambas FK a
  `PECUARIO_JAULAS(id)` — "poza" y "jaula" son la misma tabla — ya
  documentado en `docs/schema_live_pecuario.md`, coincide exacto con el
  esquema OpenAPI de PostgREST. `PECUARIO_TRASLADOS` no existe todavía en
  la instancia real.
  **2 hallazgos propios, sin cambiar ninguna columna/constraint
  redactada:** (1) faltaba el wrapper `BEGIN;`/`COMMIT;` — agregado por
  consistencia, sin riesgo (los 3 enums son `CREATE TYPE` nuevos, no
  `ALTER TYPE ADD VALUE`, así que no aplica la restricción que forzó
  partir en 2 archivos la migración de venta pelado); (2) ningún `CHECK`
  exige `lote_nuevo_id IS NULL` cuando `alcance='completo'` (sí lo exige
  para `tipo_origen='reproductor'`, pero no para ese caso de `lote`) —
  señalado como comentario en la migración para la revisión manual, sin
  agregar un `CHECK` nuevo (habría sido cambiar contenido pedido
  textualmente).
  **`specs/pecuario_traslado_interno.md` no existe en este repo**
  (verificado con `git log --all` + búsqueda exhaustiva) — el prompt
  daba por hecho que ya tenía un §7 actualizado. No bloqueó la tarea
  porque la migración/Zod se entregaron completos y literales en el
  prompt, pero el paso 7 (actualizar el header "Estado" de esa spec)
  queda sin hacer — no se fabricó un archivo nuevo.
  `TrasladoRegistroSchema` nuevo en `lib/validations/pecuario.ts` (ruta
  real). Tests nuevos `tests/test_pecuario_traslado_interno.py`, usando
  la organización real `GRANJA-VALENCIA` (pedido explícito) para los
  casos de negocio — confirmado antes de escribir el archivo que esa
  organización no tenía ninguna fila real en
  `PECUARIO_JAULAS`/`PECUARIO_LOTES`/`PECUARIO_REPRODUCTORES` (0 filas en
  las 3), así que todas las filas de los tests son descartables con
  prefijo `TEST-`, nunca sobre datos preexistentes. 11 estáticos/Zod
  pasan ya; 8 en vivo (completo, parcial con split, cantidad excedida,
  destino de otra organización, origen=destino, traslado de reproductor,
  `origen_jaula_id` ignorando lo que manda el cliente, aislamiento RLS
  cruzado contra `GRANJA-VALENCIA`) escritos y listos, se auto-omiten
  hasta la aplicación manual.
  **Regresión propia detectada y corregida antes de commitear:** insertar
  `TrasladoRegistroSchema` entre las dos secciones de Sanidad rompió 2
  subtests de `tests/test_pecuario_venta_subproductos_guano.py`
  (`test_venta_subproducto_no_tiene_campos_de_venta_animal`, campos
  `animal_id`/`lote_id`) — ese test acota su verificación desde
  `VentaSubproductoSchema` hasta un `export type` lejano en el bloque de
  cola de tipos, así que cualquier schema nuevo insertado en el medio (el
  mío fue el primero en declarar `lote_id`/`animal_id`) queda adentro del
  slice sin ser lo que se quiere probar. Reordenado
  `TrasladoRegistroSchema` a su propia sección (antes del bloque de cola,
  como el resto de los schemas) y corregido el límite del slice de ese
  test (y del mismo patrón en `test_pecuario_compras_gastos.py`, hallazgo
  latente que no había fallado todavía) para que corte en la siguiente
  definición de schema real, no en un `export type` compartido que crece
  con cada tarea nueva. `python -m pytest tests/` completo, después del
  fix: 687 passed, 16 skipped, 5 failed — mismos 5 preexistentes de
  siempre, sin relación con Pecuario. `npm run build`/`lint` limpios.

- **(2026-09-24, continuación) `chk_traslados_lote_nuevo_solo_parcial`
  agregado — incidente aparte: el archivo de la migración se
  sobreescribió en disco con texto de instrucciones, no SQL.** Antes de
  tocar nada, `20260924100000_pecuario_traslado_interno.sql` en disco no
  contenía SQL — contenía el texto de la propia tarea (33 líneas). El
  archivo real seguía intacto en el commit `e710636`; señalado
  explícitamente y restaurado con `git checkout --` sobre ese archivo
  puntual antes de aplicar nada nuevo. Sobre la base restaurada: `CHECK
  chk_traslados_lote_nuevo_solo_parcial` (`lote_nuevo_id IS NULL OR
  alcance = 'parcial'`) agregado después de
  `chk_traslados_origen_destino_distintos`, cerrando el gap que la
  entrada anterior había señalado solo como comentario. Nota
  "OBSERVACIÓN PARA LA REVISIÓN MANUAL" retirada del encabezado (ya
  resuelta); el resto de las notas quedaron intactas.
  Test nuevo `test_completo_con_lote_nuevo_id_falla_check` — 9 casos en
  vivo ahora (los 8 anteriores + este), todos siguen auto-omitiéndose
  hasta la aplicación manual (la migración sigue sin aplicarse, por
  instrucción explícita).
  **`specs/pecuario_traslado_interno.md` sigue sin existir** — reconfirmado
  antes de intentar actualizar su header; no se fabricó el archivo.
  `pytest tests/ -v` (sin `python -m`) falla la colección con 3 errores
  de import (`ModuleNotFoundError: No module named 'scripts'` en los 3
  archivos `test_e2e_*`) — problema preexistente de cómo esa invocación
  resuelve `sys.path`, no causado por esta tarea; `python -m pytest
  tests/ -v` (el comando documentado en `CLAUDE.md`) corre limpio: 687
  passed, 17 skipped, 5 failed — mismos 5 preexistentes de siempre. `npm
  run build`/`lint` limpios.
  **Pendiente:** Neyser revisa y aplica la migración en Supabase Studio;
  hecho eso, correr los 9 casos en vivo, actualizar el header de la spec
  (una vez que exista) y cerrar con un commit final "aplicada y
  verificada en vivo".

- **(2026-09-24) Ficha de poza y cálculo real de Población total —
  PREPARADA y verificada contra el esquema en vivo, NO aplicada todavía
  (por instrucción explícita del usuario):** 3 vistas de solo lectura —
  `vw_pecuario_lactancia_restante` (reemplaza el `CAMADAS_LACTANCIA`
  cargado a mano del simulador, calculado en vivo desde
  `PECUARIO_PARTOS`/`PECUARIO_LOTES.parto_origen_id`),
  `vw_pecuario_ocupacion_poza` (ficha de poza: lotes, reproductores por
  sexo, lactancia, total y `sobre_capacidad`) y
  `vw_pecuario_poblacion_resumen` (los 4 números del Dashboard +
  total general, por organización). Sin tablas/triggers/RLS de escritura
  nuevos — sin contrato Zod (no hay ningún `INSERT`/`UPDATE` nuevo que
  validar). Redactada por Claude (Cowork) — gate de segunda revisión
  (§4.1.2) cubierto por autoría. Ver
  `supabase/migrations/20260924110000_pecuario_poblacion_vistas.sql`.
  **2 hallazgos de esquema confirmados en vivo antes de escribir nada**
  (pedido explícito): `PECUARIO_LOTES.parto_origen_id` ya es FK real a
  `PECUARIO_PARTOS` desde la v1 (contradice lo que la spec original
  describía como "hueco de fondo"); `vw_pecuario_lotes_etapa` ya existe
  con `etapa_calculada` — ambos confirmados contra el esquema OpenAPI de
  PostgREST y ya documentados en `docs/schema_live_pecuario.md`. Ninguna
  de las 3 vistas nuevas existe todavía en la instancia real.
  **1 observación propia, sin cambiar contenido redactado:** agregado
  `BEGIN;`/`COMMIT;` (no lo traía) — sin riesgo, la migración es
  puramente `CREATE OR REPLACE VIEW`, sin ningún `CREATE TYPE`.
  **`specs/pecuario_ficha_poza_y_calculo_poblacion.md` no existe en este
  repo** (verificado con `git log --all` + búsqueda exhaustiva) — mismo
  hallazgo recurrente de toda la sesión. No bloqueó la tarea porque la
  migración se entregó completa y literal, pero el paso de actualizar el
  header "Estado" de esa spec queda sin hacer — no se fabricó un archivo
  nuevo.
  Tests nuevos `tests/test_pecuario_poblacion_vistas.py`, usando
  `GRANJA-VALENCIA` (mismo criterio que Traslado) para los casos de
  negocio y `ORG-TEST-DEMO` para el aislamiento cruzado — 9
  estáticos pasan ya (3 bugs propios del mismo patrón recurrente de esta
  sesión, corregidos: `assertNotIn` demasiado amplios sobre menciones
  legítimas en comentarios, y un conteo mal asumido); 11 en vivo (parto
  nuevo, destete parcial, destete completo, invariante de
  `total_poblacion` sin cambio con el destete, `etapa_calculada` vs.
  columna cruda, reproductor enfermo/vendido, `sobre_capacidad`,
  asimetría de mortalidad entre resumen y ocupación, aislamiento cruzado
  en las 3 vistas) escritos y listos, se auto-omiten hasta la aplicación
  manual. `npm run build`/`lint` limpios. `python -m pytest tests/`: 696
  passed, 28 skipped, 5 failed — mismos 5 preexistentes de siempre, sin
  relación con Pecuario.
  **Pendiente:** Neyser revisa y aplica la migración en Supabase Studio;
  hecho eso, correr los 11 casos en vivo, actualizar el header de la
  spec (una vez que exista) y cerrar con un commit final "aplicada y
  verificada en vivo".

- **(2026-09-24, cierre) Traslado interno y Población real — Neyser
  aplicó ambas migraciones en Studio; APLICADAS y confirmadas en vivo
  (20/20 tests cada una).** Al recorrer los tests de ambas por pedido
  del usuario, se encontraron y corrigieron 2 bugs propios en
  `tests/test_pecuario_traslado_interno.py` (no en las migraciones): el
  helper `_crear_lote()` reutilizaba el mismo `codigo_lote` en llamadas
  repetidas dentro de un mismo test (`409 Conflict` real al correr
  `test_completo_con_lote_nuevo_id_falla_check`, que crea 2 lotes) —
  corregido agregándole el mismo diferenciador por llamada que ya usan
  `_crear_jaula`/`_crear_reproductor`; eso a su vez rompió la
  verificación de `test_traslado_completo_cambia_poza_sin_crear_fila_nueva`
  (buscaba por el `codigo_lote` viejo, ya inexistente) — corregida para
  verificar por `poza_actual_id` en vez de por código. `tests/test_pecuario_poblacion_vistas.py`
  no necesitó ningún cambio, sus 20 tests pasaron limpios a la primera
  contra las vistas ya aplicadas.
  `python -m pytest tests/`: 7 failed en la corrida larga completa —
  2 de ellos (`test_pecuario_ventas_insumos_v4.py::TestV4Live`) resultaron
  ser el mismo rate-limit transitorio de `generate_link` de Supabase
  Auth ya documentado en este archivo para corridas largas — confirmado
  pasando 12/12 en aislamiento inmediatamente después. Los 5 restantes
  son los preexistentes de siempre, sin relación con Pecuario.
  `docs/schema_live_pecuario.md` actualizado con las secciones v10/v11
  (ambas ya `APLICADA`).
  **`specs/pecuario_traslado_interno.md`/`specs/pecuario_ficha_poza_y_calculo_poblacion.md`
  siguen sin existir en este repo** — reconfirmado, no se fabricaron.
  **Tarea cerrada** para ambos módulos, sin merge a `main`.


- **(2026-09-25, cierre) Destete: recolección semanal + conformación de
  lotes por sexo — Neyser aplicó la migración en Studio; APLICADA y
  confirmada en vivo (26/26, ninguno SKIPPED).** Reemplaza el estado en
  memoria del navegador del simulador
  (`poolDestete`/`lotesDesteteFormados`) con 2 tablas persistentes
  (`PECUARIO_RECOLECCIONES_DESTETE`, `PECUARIO_RECOLECCION_PARTOS`) + una
  columna nueva en `PECUARIO_LOTES` (`recoleccion_origen_id`) + 2 triggers
  server-side (`cantidad_incluida`/límite de remanente nunca confían en el
  cliente) + `vw_pecuario_lactancia_restante` **reemplazada** (mismo
  nombre/columna, ahora corta en la recolección en vez de en la
  conformación del lote — hallazgo propio de Cowork, documentado en la
  cabecera de la migración) + `vw_pecuario_recolecciones_destete` nueva.
  `specs/pecuario_destete_recoleccion_semanal.md` creado (autorizado
  explícitamente por el prompt) con nota de transparencia: solo tiene §10
  (Backend), las secciones §1–§9 del simulador nunca se entregaron y no
  se inventaron.
  `tests/test_pecuario_destete_recoleccion.py`: **26/26** (15
  estático+Zod, 11 en vivo — comportamiento real confirmado, no solo "no
  falla"). Un detalle documentado en el propio test: los 2 casos pedidos
  "recolectar el mismo parto 2 veces falla (UNIQUE global)" y "parto sin
  lactancia pendiente falla (mensaje del trigger)" colapsan en el mismo
  test/mecanismo — el propio trigger ya bloquea el 2do intento antes de
  llegar a violar el `UNIQUE` (recolección completa o nada), así que el
  `UNIQUE` queda como defensa en profundidad para una carrera
  concurrente, no observable en un test secuencial.

  **Hallazgo de infraestructura, resuelto en el camino:** al intentar
  correr los 11 tests en vivo por pedido de Neyser, se encontró que NO
  existía ningún mecanismo persistente (`conftest.py`, dotenv) para
  cargar `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`
  en los tests — toda corrida "en vivo" anterior de esta sesión dependía
  de un `export` manual en una terminal ya cerrada. `.env.local` sí tenía
  los 3 valores reales, pero las 2 primeras con prefijo
  `NEXT_PUBLIC_` (para el cliente Next.js) que los tests no reconocían.
  Se agregó `tests/conftest.py` (carga `.env.local` vía `python-dotenv`,
  agregado a `requirements.txt`, con fallback de nombre para las 2
  variables con prefijo) — no reescribe ningún test existente, no toca
  ningún valor real, y es no-op seguro en CI (`load_dotenv()` nunca
  sobreescribe una variable ya seteada). Efecto colateral esperado: los
  tests en vivo de todo el repo ahora corren de verdad en cualquier
  entorno local con `.env.local` completo.
  `npm run lint` limpio (solo warnings preexistentes, sin relación).
  `docs/schema_live_pecuario.md` v12 actualizado a `APLICADA`.

  Esa misma corrida completa reveló 7 fallos nuevos (antes SKIPPED, sin
  credenciales): 4 sin relación con Pecuario (dejados para triar
  aparte, ver `AI_STATE.md`) y **3 en `test_pecuario_poblacion_vistas.py`,
  regresión real causada por el reemplazo de `vw_pecuario_lactancia_restante`
  en v12** (ya no calcula desde `PECUARIO_LOTES.parto_origen_id`).
  Confirmado por grep en todo el repo (`lib/`, `app/`, `components/`,
  `scripts/`) que ningún Server Action real usa `parto_origen_id`
  directo -- no hay regresión de producto, solo de esos 3 tests, que se
  reescribieron para armar su escenario vía recolección + conformación
  real (mismos helpers que `test_pecuario_destete_recoleccion.py`).
  `pytest tests/test_pecuario_poblacion_vistas.py -v -rs`: **20/20**,
  ninguno SKIPPED. `docs/schema_live_pecuario.md` v11 anotado con el
  reemplazo. `parto_origen_id` no se tocó en el esquema (legacy
  inofensiva).
  **Tarea cerrada de verdad, sin deuda pendiente** — "aplicada y
  verificada en vivo", sin merge a `main`.

- **(2026-09-26, cierre) Empadre: "Asignar macho a jaula" + retiro
  pendiente — ítem 7 del roadmap, CERRADO.** `PECUARIO_RETIROS_MACHO_PENDIENTES`
  (nueva) + 2 triggers sobre `PECUARIO_HISTORIAL_MACHOS` (validación
  multi-tenant/sexo/modo controlado, efectos de cierre de asignación
  previa + sincronización de `jaula_actual_id` + creación de
  pendiente) + trigger de resolución + `vw_pecuario_retiros_macho_pendientes`.
  Reutiliza `HistorialMachoSchema` (v3) sin crear ningún schema Zod
  nuevo. La migración original (`20260926090000`) ya estaba aplicada en
  producción antes de empezar esta tarea (Neyser la aplicó por fuera de
  esta conversación) — confirmado por `supabase db query --linked`
  (lectura, ADR-042).

  **3 bugs reales encontrados y corregidos el mismo día**, cada uno
  confirmado con una prueba real (no especulación) antes de tocar nada,
  y cada hotfix decidido explícitamente por Neyser antes de escribirse
  (nunca corregidos unilateralmente):
  1. `ORGANIZACIONES."Config"` es `text`, no `jsonb` — el trigger de
     validación usaba el operador `->` directo y rompía **todo** insert
     legítimo con `42883`. Hotfix: cast puntual
     (`("Config")::jsonb->...`), `20260926100000`.
  2. `CHECK chk_retiros_macho_resuelta_coherente` exigía `resuelta_en`
     al resolver un pendiente, pero nada lo calculaba — "Marcar hecho"
     rompía con `23514`. Hotfix: trigger `BEFORE UPDATE` nuevo que lo
     calcula server-side, `20260926110000`.
  3. La condición `IF fecha_salida IS NULL` de
     `trg_resolver_retiro_macho_pendiente` era código muerto (nunca
     podía ser verdadera para una fila con pendiente) — "Marcar hecho"
     devolvía `200 OK` pero no cerraba nada, en silencio, el bug más
     grave de los 3 por no dar ningún error visible. Hotfix: comparar
     contra `fecha_retiro_planificada`, `20260926120000`.

  **Evidencia:** `tests/test_pecuario_empadre_asignacion_macho.py -v -rs`:
  **24/24**, ninguno SKIPPED, incluyendo el caso puntual "macho
  reasignado antes de marcar hecho el pendiente viejo no debe tocar
  `jaula_actual_id`". Suite general: 766 passed, 8 skipped, 54 subtests
  passed, 5 failed — los mismos 5 preexistentes de siempre, sin
  relación con Pecuario, sin ningún fallo nuevo, confirmado por Cowork.
  `docs/schema_live_pecuario.md` v13 actualizado a `APLICADA` con las 4
  migraciones (original + 3 hotfixes).

  **Limitación conocida, señalada, no corregida** (documentada en
  `AI_STATE.md`): una reasignación de macho con `fecha_salida` ya
  seteada (modo controlado, o continuo con fecha planificada) deja la
  fila anterior de `PECUARIO_HISTORIAL_MACHOS` con su `fecha_salida`
  original stale (dato de auditoría impreciso) — `jaula_actual_id`
  sigue siempre correcto, no afecta el comportamiento funcional. Ticket
  aparte, igual que el hallazgo más amplio de `Config`.

  **Tarea cerrada de verdad** — sin merge a `main`.

- **(2026-09-27, cierre) Reglas configurables de reemplazo/descarte de
  reproductoras — ítem 8 del roadmap, CERRADO.** Sugerencia automática
  (nunca acción automática) cuando una reproductora identificada
  alcanza el máximo de partos configurado (`PECUARIO_CONFIGURACION.max_partos_madre`)
  o tiene una camada chica en su 1er o 2do parto
  (`min_crias_vivas_parto_temprano`, renombrada desde
  `min_promedio_crias_vivas` — el nombre original sugería un promedio;
  la regla real es un umbral por-parto individual, confirmado por grep
  que nada la consumía todavía). `PECUARIO_SUGERENCIAS_REEMPLAZO`
  (nueva, `UNIQUE(reproductor_id, motivo)` + `ON CONFLICT DO NOTHING`
  para que una sugerencia resuelta nunca reaparezca) + FK real
  `PECUARIO_PARTOS.madre_id -> PECUARIO_REPRODUCTORES` (antes
  "reservado, sin FK") + validación multi-tenant/sexo + motor de
  reglas que solo corre cuando `madre_id` está identificado + `resuelta_en`
  calculado por trigger + "Confirmar descarte" como único disparador
  de `proposito='descarte'` (nunca automático) + vista para Alertas.
  Reutiliza un solo schema Zod (`SugerenciaReemplazoAccionSchema`) para
  las 2 acciones ("Confirmar descarte"/"Ignorar por ahora").

  **Diagnóstico de solo lectura previo** (paso explícito del prompt,
  `supabase db query --linked`, ADR-042, antes de escribir la
  migración): 0 partos con `madre_id` huérfanos, 0 organizaciones con
  fila de configuración — migración confirmada segura de aplicar antes
  de tocar nada.

  **Evidencia:** `tests/test_pecuario_reglas_reemplazo.py -v -rs`:
  **28/28**, ninguno SKIPPED — cubre el rename, ambas reglas (máximo de
  partos, camada chica 1ro/2do con el caso de "3er parto no dispara
  nada nuevo" y el de dedup por `ON CONFLICT`), que solo cuenta
  `n_vivos` nunca `n_muertos`, confirmar/ignorar con `resuelta_en`, el
  `CHECK` de coherencia vía un insert directo que bypasea el trigger,
  validación de `madre_id` (organización/sexo), aislamiento RLS
  cruzado, y el caso poblacional sin `madre_id`. `npm run lint` limpio.
  Suite general (2026-09-27): 793 passed, 8 skipped, 54 subtests
  passed, 6 failed — los 5 preexistentes de siempre + 1 hallazgo de
  huso horario en `test_pecuario_empadre_asignacion_macho.py` (ítem 7,
  ya cerrado, sin relación con esta migración, documentado en
  `AI_STATE.md`, no corregido por exceder el alcance de esta tarea).
  Re-confirmada la misma lista de 6, sin ningún fallo nuevo, en una
  corrida posterior pedida explícitamente para verificarlo.

  `docs/schema_live_pecuario.md` v14 actualizado a `APLICADA`.

  **Tarea cerrada de verdad** — sin merge a `main`.

- **(2026-09-27, cierre) Alerta de consanguinidad en Empadre/Alta —
  item 9 del roadmap, CERRADO.** Conecta fn_son_parientes() (v3,
  2026-09-11) al resto del esquema: 2 columnas de configuracion por
  organizacion, funcion nueva fn_jaula_tiene_otro_macho_activo(), columna
  de auditoria advertencia_confirmada en 2 tablas. Sin CHECK/trigger
  bloqueante — advertencia, nunca bloqueo duro, verificado con test
  dedicado. Correccion de alcance real durante la verificacion: el diseño
  original asumia Server Actions de Pecuario que no existen en este repo
  (la app real es un cliente Expo separado) — corregido antes de escribir
  codigo, sin rehacer nada. Evidencia: 21/21 en vivo sin skips, suite
  completa re-confirmada sin fallos nuevos (814 passed, los mismos 6 ya
  catalogados). Ver docs/schema_live_pecuario.md v15. Migracion
  20260927100000_pecuario_alerta_consanguinidad_config.sql, commit
  401afcb.

- **2026-09-28 — Pecuario: Panel de indicadores (ítem 10/10 del roadmap,
  ÚLTIMO) — CERRADO.** 10 vistas de solo lectura (seguimiento/FCR,
  reproducción, sanitario, productivo, comercial), cero tablas/columnas/
  triggers/CHECK nuevos. Commits: `6f27a00` → `592674a` (fix BEGIN/COMMIT)
  → `0009e26` (fix escape `%%` en RAISE) → `e1f934a` (fix
  `unidad_medida::text`, ENUM real vs VARCHAR asumido) → `178eaf7` (fix
  FROM mal anclado en `vw_pecuario_reemplazo_reproductoras_anual`, mismo
  bug-class que `vw_pecuario_poblacion_resumen`). Verificado en vivo
  25/25 propios + suite completa sin fallos nuevos (`5 failed, 840 passed,
  8 skipped`). Redactado y revisado por Claude (Cowork) de punta a punta
  — gate de segunda revisión (§4.1.2) cubierto en el mismo flujo. Aplicado
  manualmente por Neyser en Studio, nunca por la CLI (§4.1.4, reafirmado
  explícitamente durante este cierre ante una instrucción ambigua). Sin
  merge a `main`. **Con este ítem, el roadmap completo de Pecuario Cuyes
  (mockup → backend, 10/10 ítems) queda cerrado.**

- **(2026-09-30, cierre) App móvil Granja Valencia — Pesaje (control de
  crecimiento del lote), CERRADA.** Redactado y ejecutado por Claude
  (Cowork). Sin gate de segunda revisión (§4.1.2) — esta tarea no toca
  SQL/RLS/migraciones/esquema, solo la app Expo y su contrato Zod.
  `peso_promedio_g` es `GENERATED ALWAYS` en `PECUARIO_PESAJES`
  (confirmado en vivo antes de escribir código) — se excluye del
  `INSERT`. `ganancia_diaria_estimada_g` no es generada: la calcula el
  cliente contra el pesaje anterior más reciente del mismo lote, y
  queda `NULL` en el primer pesaje (sin ninguna línea base real en
  `PECUARIO_CONFIGURACION` ni en filas existentes — documentado, no se
  inventó una fórmula). **Bug real corregido el mismo día:** "Animales
  muestreados" no tenía tope contra la cantidad real del lote (aceptó
  una muestra de 3 en un lote con `cantidad_actual=2`) — sin ningún
  `CHECK`/trigger real que lo prevenga en la base, la regla vive 100%
  del lado del cliente (tope del `Stepper` + validación explícita antes
  del `INSERT`). Verificado en vivo contra GRANJA-TEST y en dispositivo
  real. `tsc --noEmit` limpio, Jest 44/44. Commits:
  `7c9265c` (pantalla) → `25c46e4` (fix del tope de cantidad). Ver
  `specs/app_granja_valencia_pesaje.md`. Sin merge a `main`.

- **(2026-09-30, cierre) App móvil Granja Valencia — Traslado
  (movimiento interno entre pozas/jaulas), CERRADA.** Redactado y
  ejecutado por Claude (Cowork). Sin gate de segunda revisión (§4.1.2).
  `trg_procesar_traslado` calcula `cantidad_actual` automáticamente en
  los 3 escenarios reales (parcial, completo, reproductor) — el
  cliente nunca lo escribe a mano, a diferencia del gap ya conocido en
  Venta. Ambos modos del mockup ("Lote poblacional" y "Reproductor
  identificado") incluidos desde el arranque. **Falso positivo
  investigado y cerrado el mismo día:** se reportó que el destino
  mostrado para M-001 en modo Reproductor excluía la jaula equivocada
  — la causa real, confirmada con un panel de `DEBUG TEMPORAL` visible
  en pantalla (ya retirado) más evidencia SQL en vivo, fue un bundle de
  Metro cacheado en el cliente sin reload completo, no un bug de
  código; la exclusión de origen ya funcionaba igual en ambos modos
  desde el primer commit de la pantalla. Documentado como precedente
  para el resto del roadmap en `specs/app_granja_valencia_traslado.md`
  §8. Verificado en vivo los 3 escenarios contra GRANJA-TEST y en
  dispositivo real. `tsc --noEmit` limpio, Jest 55/55. Commits:
  `0e98d73` (pantalla) → `98b8eda`/`58cb861` (investigación e
  instrumentación temporal del falso positivo) → `99033a3` (retiro del
  panel de debug). Sin merge a `main`.

- **(2026-09-30, cierre) App móvil Granja Valencia — Venta
  (animales/pelado/guano), CERRADA.** Redactado y ejecutado por Claude
  (Cowork). Sin gate de segunda revisión (§4.1.2). Commit `334e6e8`.
  Contrato Zod nuevo `VentaAnimalSchema`/`VentaGuanoSchema` — sin tocar
  `VentaRegistroSchema` ni `VentaSubproductoSchema` preexistentes, que
  ya tienen consumidores reales activos (varios tests Python que
  parsean el archivo de forma estática). Cierra el hallazgo abierto de
  Pesaje: se agregó `.gt('cantidad_actual', 0)` al selector de lotes en
  las 3 pantallas (Pesaje, Traslado, Venta) — `PECUARIO_LOTES.estado`
  nunca cambia solo al agotarse un lote. Verificado en vivo contra
  GRANJA-TEST y en dispositivo real las variantes del mockup (Carne,
  Pelado por kg, Pelado por animal, Pie de cría, Reproductor de saca,
  Guano), confirmado por SQL sin discrepancias. `tsc --noEmit` limpio,
  Jest 69/69.

  **Hallazgo de proceso, no de código, sin fix requerido:** al probar
  "Reproductor identificado" en dispositivo se vendió por accidente a
  H-001 (reservada para pruebas de Empadre/Parto) en vez de dar de alta
  un reproductor nuevo para la prueba — confirmado por `PECUARIO_VENTAS`/
  `PECUARIO_REPRODUCTORES` en vivo (`estado='vendido'`, misma mecánica
  de `trg_dar_baja_animal_por_venta` ya verificada con M-001). No
  representa ningún bug: el flujo funcionó de punta a punta tal como
  debía. GRANJA-TEST quedó sin ningún reproductor activo como
  consecuencia. **Decisión: no revertir por SQL** (organización de
  prueba, no de producción) — cualquier tarea futura que necesite
  reprobar Empadre/Parto/Traslado en modo Reproductor debe dar de alta
  reproductores nuevos primero. Sin merge a `main`.

- **(2026-09-30, cierre) App móvil Granja Valencia — Mortalidad (+
  fotos), CERRADA.** Redactado y ejecutado por Claude (Cowork). Sin
  gate de segunda revisión (§4.1.2) — sin SQL/RLS/esquema nuevo en esta
  tarea, `PECUARIO_MORTALIDAD`/`PECUARIO_MORTALIDAD_FOTOS`/bucket
  `evidencias_pecuario` ya estaban cerrados desde el roadmap de backend
  (commit `5443d36`). Commit `f3f17cc`.

  Gap real confirmado en el recon, mismo patrón exacto que Venta:
  `trg_dar_baja_animal_por_mortalidad` solo actúa si `animal_id IS NOT
  NULL` — el cliente hace el `UPDATE` explícito de `cantidad_actual`
  cuando el origen es un lote. **Hallazgo real de nombre engañoso:**
  `chk_mortalidad_individual_xor_poblacional` usa `OR` entre
  `lote_id`/`poza_id`, no un XOR pese al nombre — la base permite ambos
  a la vez. Se ajustó el test que asumía XOR, no la restricción de la
  base (la base ya estaba bien, el error era la expectativa del test).
  `estado_animal` sí tiene `'muerto'` → ambos modos ("Poblacional" /
  "Reproductor identificado") incluidos desde el arranque, igual que
  Traslado/Venta.

  **Diseño confirmado on-device:** la etapa elegida decide si el
  formulario pide un lote o una poza — en "Lactancia" o "Reproductor
  (sin identificar)" todavía no existe lote (se arma recién en
  Destete), así que pide poza en vez de lote.

  Librería nueva: `expo-image-picker` vía `npx expo install`;
  `base64-arraybuffer` necesitó `--legacy-peer-deps` por un conflicto
  de peers preexistente del proyecto (`react-native-worklets`), ajeno
  al paquete en sí.

  **Verificado en dispositivo real:** cámara + subida de foto de
  evidencia confirmada contra el bucket `evidencias_pecuario`
  (`storage_path` real observado en vivo:
  `GRANJA-TEST/mortalidad/262fd453-.../foto-1790740941150-0.jpg`, fila
  correspondiente en `PECUARIO_MORTALIDAD_FOTOS`, objeto real de 55.9KB
  en `storage.objects` — confirmado antes de escribir esta entrada, no
  transcrito a ciegas). Los 3 escenarios de datos (lote, poza,
  reproductor con baja automática) verificados por SQL contra
  GRANJA-TEST. `tsc --noEmit` limpio, Jest 80/80. Sin merge a `main`.

- **(2026-10-01, cierre) App móvil Granja Valencia — Sanidad (registrar +
  configurar actividades), CERRADA.** Pantalla 7 del punto 7 del orden de
  implementación. Commits: `ae961c4` (pantalla), `41e873a` (migración de
  RLS por rol, `20260930202402_fix_rls_sanidad_por_rol.sql`), `fcb1b45`
  (test de aislamiento por rol,
  `tests/test_pecuario_sanidad_rls_por_rol.py`). Spec:
  `specs/app_granja_valencia_sanidad.md`.

  **Hallazgo de seguridad real:** `PECUARIO_ACTIVIDADES_SANIDAD` y
  `PECUARIO_SANIDAD_REGISTROS` tenían una única política RLS `ALL`
  filtrada solo por `ID_Organizacion`, sin distinguir rol — cualquier
  usuario autenticado de la organización podía escribir el catálogo de
  sanidad vía API, pese a que la UI lo oculta a no-admin. Corregido:
  catálogo solo-admin para INSERT/UPDATE/DELETE; registros con INSERT
  para admin + `tecnico_campo`, UPDATE/DELETE solo admin; SELECT abierto
  a los tres roles de la organización.

  Redactado y revisado por: Claude (Cowork), Arquitecto Senior RYZOS —
  gate de la Sección 4.1.2 cubierto en el mismo flujo (la misma IA
  redactó y revisó).

  **Nota de arquitectura para futuras tareas:** `GRANJA-TEST` y
  `GRANJA-VALENCIA` son dos organizaciones dentro del mismo (único)
  proyecto Supabase `jhtocgxlozfuzullrtol` — no hay staging separado a
  nivel de RLS/base de datos. Una migración de políticas aplicada contra
  la base real queda vigente para todas las organizaciones al instante.
  Sin riesgo de negocio en este caso: `GRANJA-VALENCIA` no tenía
  actividad real en Sanidad al aplicar la migración (0 filas en ambas
  tablas, confirmado en vivo).

  **Test de aislamiento:** 17 tests (4 estáticos + 13 en vivo con
  sesiones reales de admin/`tecnico_campo`/`auditor_qc`, sin usar
  `service_role` para simular usuarios), cubriendo bloqueo de catálogo
  para `tecnico_campo`, acceso completo de admin, aislamiento cruzado de
  organización y solo-lectura de `auditor_qc`.

  **Suite completa:** 850 passed, 15 failed, 8 skipped — los 15 fallos
  confirmados preexistentes y no relacionados (verificado con `git stash
  -u` del trabajo de la sesión + corrida comparativa).

  **Pendiente (no bloquea el cierre):** el cambio suelto en
  `docs/RYZOS_ORQUESTADOR_V3.1.md` (ADR-042, sin commitear desde antes de
  esta tarea) y el de `scripts/provision_login_accounts.mjs` (cuenta de
  prueba `tecnico_campo`), ambos a criterio de Neyser.

- **(2026-10-03, cierre) App móvil Granja Valencia — Insumos (lista de
  stock, registrar movimiento, alta con stock inicial), CERRADA.** Segunda
  pantalla del punto 7 del orden de implementación (backend aplicado el
  2026-10-01; pantalla y verificación on-device el 2026-10-03). Commits:
  `17db1e5` (RLS por rol + columna `galpon_id` + función atómica, con los 2
  fixes de NULL-safety y validación de organización ya incluidos), `bc5e297`
  (versión inicial de esa migración, superada por `17db1e5`),
  `20261001230000_revoke_execute_publico_insumos.sql` y
  `20261001231500_fix_rpc_crear_insumo_guarda_real.sql` (incidente de
  seguridad, ver abajo), `c73351f` (ambas migraciones del incidente + test de
  aislamiento RLS/RPC), `8eb73f7` (spec y contratos), `fc3496f` (pantalla).
  Spec: `specs/app_granja_valencia_insumos.md`.

  **Hallazgo de seguridad real #1 (antes de construir la pantalla):**
  `PECUARIO_INSUMOS` y `PECUARIO_INSUMOS_MOVIMIENTOS` tenían una única
  política RLS `ALL` sin distinguir rol, igual que Sanidad. Corregido: catálogo
  solo-admin; movimientos `admin` + `tecnico_campo` INSERT / solo-admin
  UPDATE-DELETE; SELECT abierto a la organización.

  **Hallazgo de seguridad real #2, más grave, encontrado por el propio test de
  aislamiento (no por revisión de texto):** la función `SECURITY DEFINER`
  `fn_crear_insumo_con_stock_inicial` tenía una guarda que usaba `CURRENT_USER
  = 'postgres'` como parte del bypass de autorización — ese patrón es válido
  dentro de una política RLS (donde `CURRENT_USER` es el rol que consulta)
  pero NO dentro de una función `SECURITY DEFINER` (donde `CURRENT_USER` es
  siempre el dueño de la función, sin importar quién la llame). Resultado: la
  validación de organización/rol nunca se ejecutaba para nadie. Comprobado en
  vivo: `tecnico_campo`, `auditor_qc`, y un admin pasando la organización de
  otro tenant, los tres pudieron crear insumos vía la RPC. Corregido
  eliminando el atajo y dejando el bypass solo con `auth.role() =
  'service_role'`; verificado rojo→verde contra el test antes de aplicar.
  Redactado y revisado por Claude (Cowork) — error de origen de la propia
  revisión de Cowork, documentado sin minimizarlo.

  **Auditoría de alcance (sin corregir, en backlog):**
  `exportar_esquema_ryzos()`, `fn_jaula_tiene_otro_macho_activo()` y
  `fn_son_parientes()` son invocables por `anon`/`PUBLIC` con permisos del
  dueño — candidatas a revisión aparte; `exportar_esquema_ryzos()` es la más
  urgente. Detalle en `AI_STATE.md`.

  Redactado y revisado por: Claude (Cowork), Arquitecto Senior RYZOS — gate de
  la Sección 4.1.2 cubierto en el mismo flujo.

  **Verificación:** suite completa verificada tras Sanidad y tras el incidente
  de seguridad (850 passed → 870 passed, mismos 15 fallos preexistentes); las
  etapas de spec y pantalla se verificaron con tsc y Jest (97/97), no con
  pytest completo.
  Verificación on-device de ambos roles confirmada por Neyser en el chat de la
  tarea: admin con alta con y sin stock inicial, movimiento, y salida con stock
  negativo (guarda con aviso, sin bloqueo); `tecnico_campo` sin acceso a "Nuevo
  insumo" en la UI y con movimiento registrado con éxito.

  **Pendiente (no bloquea el cierre de Insumos):** Compras (tercera pantalla
  del punto 7) y la auditoría de las 3 funciones del backlog de seguridad.

- **(2026-10-03, cierre) App móvil Granja Valencia — Compras (gastos de la
  granja: insumo con stock / servicio u otro gasto), CERRADA.** Tercera y
  última pantalla del punto 7 del roadmap de la app Granja Valencia (Sanidad,
  Insumos, Compras). Con esto, el punto 7 queda completo. Spec:
  `specs/pecuario_compras_gastos.md`.

  **Backend:** `PECUARIO_COMPRAS` ya existía desde 2026-09-22 (con un fix de
  `flete` del 2026-09-23). Para esta tarea se cerró el gap de RLS (única
  política `ALL` sin distinguir rol) y se corrigió el trigger de auto-Entrada
  para que copie `galpon_id`. Decisión: solo `admin` puede
  INSERT/UPDATE/DELETE (ni siquiera `tecnico_campo`, a diferencia de
  Sanidad/Insumos); SELECT abierto a los 3 roles. Migración
  `20261001234500_fix_rls_compras_y_galpon_trigger.sql`, commit `5ccb9e5`.
  Redactada y revisada por Claude (Cowork), gate de la Sección 4.1.2 cubierto
  en el mismo flujo (como consta en el header de la migración).

  **Incidente de seguridad real:** un `EXISTS` correlacionado en las cláusulas
  `WITH CHECK` de INSERT/UPDATE usaba una referencia a `ID_Organizacion` sin
  calificar, que Postgres resolvía contra la tabla del propio subquery en vez
  de la fila externa de `PECUARIO_COMPRAS` — dejaba sin efecto la validación
  cruzada de organización (tautología). Encontrado y corregido antes de
  cualquier commit (nunca llegó a aplicarse ni a commitearse con el bug).
  Corrección: calificar la fila externa como
  `"PECUARIO_COMPRAS"."ID_Organizacion"` en las 4 ocurrencias.

  **Test de aislamiento:** `tests/test_pecuario_compras_rls.py`, 21 passed + 26
  subtests, commit `c29a90d`. Cubre SELECT/INSERT/UPDATE/DELETE por rol, el
  caso específico del bug de scoping (rechazado correctamente tras el fix), y
  que el trigger copia `galpon_id`.

  **Suite completa sin regresiones:** 7 failed, 896 passed (eran 15 failed,
  870 passed al cerrar Insumos) — los 7 son subconjunto exacto de los 15
  preexistentes. Hallazgo aparte sin relación: 8 tests de
  `test_pecuario_panel_indicadores.py` que fallaban antes ahora pasan, sin que
  el trabajo de Compras los haya tocado — anotado en `AI_STATE.md` como
  pendiente de investigar, no bloqueante.

  **Spec y contrato:** `specs/pecuario_compras_gastos.md` actualizada a la
  realidad aplicada; `CompraSchema`/`CompraInput` existentes (sin necesidad de
  un schema nuevo) con `costo_insumo` pasado a `.positive()` a nivel de
  contrato (la base sigue en `>= 0`). Commit `2e10117`.

  **Pantalla construida:**
  `apps/granja-valencia/src/app/(protegido)/compras/index.tsx`, commit
  `c58f12f`, 5 archivos, 572 inserciones. Listado abierto a los 3 roles, alta
  solo `admin` (cosmético en UI, real en RLS), costo total calculado y de solo
  lectura, mismo patrón offline-first que Insumos (UUID v4 cliente vía
  `expo-crypto`).

  **Verificación on-device (2026-10-03):** `admin` registró 3 compras (insumo
  sin flete, servicio, insumo con flete) con los montos/costos unitarios
  correctos; `tecnico_campo` ve el listado sin el botón de alta; `auditor_qc`
  no es parte de esta app (aclarado por Neyser, opera desde el dashboard web).
  Confirmado por SQL real de solo lectura que los 2 movimientos de entrada
  generados tienen el `galpon_id` correcto, cantidades correctas, y que la
  compra de servicio no generó movimiento — primera confirmación del fix del
  trigger fuera de los tests.

  **Cierre:** con esto, el punto 7 del roadmap (Sanidad, Insumos, Compras)
  queda completo.

- **(2026-10-04) Punto 8 de la app Granja Valencia (Reemplazo/descarte) —
  tramo de BACKEND de RLS cerrado; el punto 8 NO está cerrado.** Solo se cerró
  la RLS por rol de `PECUARIO_PARTOS` y `PECUARIO_SUGERENCIAS_REEMPLAZO`.
  **Faltan:** la spec de la pantalla (`specs/pecuario_reglas_reemplazo_reproductoras.md`
  la citan comentarios y migraciones, pero no existe en el repo), el ajuste del
  contrato Zod (ya existe `SugerenciaReemplazoAccionSchema`, pensado para una
  Server Action web), la pantalla de la app y la verificación on-device.

  **Qué se cerró:** antes, las dos tablas tenían una única policy `ALL` sin
  distinguir rol, filtrada solo por `ID_Organizacion`; la de Sugerencias,
  además, era `TO public` (no `TO authenticated` como el resto de las tablas
  pecuarias; inofensivo en la práctica porque `auth_org_id()` es NULL para
  `anon`, pero corregido de paso).

  **Migraciones y commits** (sin aplicar hasta que Neyser las corrió en
  Studio):
  `20261004130000_fix_rls_partos_por_rol.sql` (`c681c2db…eaaede18`, 141
  líneas, commit `1656609`) y
  `20261004120000_fix_rls_sugerencias_reemplazo_por_rol.sql` (`e9ddb89e…3e52dd9f`,
  158 líneas, commit `2d707d9`). Aplicadas por Neyser en Studio en el orden
  Partos → Sugerencias. **Por qué ese orden:** si Sugerencias se aplicaba
  primero, quedaba una ventana en la que un `auditor_qc` todavía podía insertar
  un parto (la RLS vieja de Partos se lo permitía) y el trigger
  `trg_partos_evaluar_sugerencia_reemplazo` —que no es `SECURITY DEFINER` y
  corre con los permisos de quien registra el parto— fallaba contra la nueva
  RLS de Sugerencias con un error confuso en una tabla distinta. Con Partos
  primero, el auditor queda bloqueado ya en el parto.

  **Reglas:** SELECT abierto a los 3 roles de la organización; INSERT/UPDATE
  `admin` + `tecnico_campo`; DELETE solo `admin`. En Partos, INSERT/UPDATE
  validan además que `poza_id` y `macho_id` (cuando viene) pertenezcan a la
  misma organización del parto, con todas las referencias calificadas
  (`"PECUARIO_PARTOS".poza_id`, `"PECUARIO_PARTOS".macho_id`,
  `"PECUARIO_PARTOS"."ID_Organizacion"`); `madre_id` no se duplica en la policy
  porque ya lo valida `trg_partos_validar_madre`. En Sugerencias, el trigger
  `trg_sugerencia_reemplazo_bloquear_cambio_campos` (BEFORE UPDATE) permite
  cambiar solo `estado` (y `resuelta_en`, que la fija
  `trg_sugerencia_reemplazo_resuelta_en`): rechaza cualquier cambio de
  `reproductor_id`, `motivo`, `parto_id`, `detalle`, `ID_Organizacion` o
  `creada_en`, incluso para `admin`. Su bypass es `auth.role() = 'service_role'
  OR CURRENT_USER = 'postgres'` (API con service_role, y sesión directa en
  Studio, que conecta como `postgres`). **Por qué ese bypass es seguro acá y
  no en el incidente de Insumos:** este trigger NO es `SECURITY DEFINER`, así
  que `CURRENT_USER` refleja siempre a quien realmente ejecuta el `UPDATE`,
  nunca al dueño de una función; el atajo solo sería peligroso si alguna
  función `SECURITY DEFINER` de dueño `postgres` actualizara esta tabla
  (verificado: hoy ninguna lo hace).

  **Hallazgos:** (1) `auditor_qc` podía insertar, editar y borrar partos
  (`PECUARIO_PARTOS` con policy `ALL` por organización, sin rol), lo que además
  habría hecho fallar de forma confusa un parto que dispara una sugerencia una
  vez restringida Sugerencias. (2) Fragilidad de scoping: en el borrador de la
  migración de Partos (commit `7c6349a`), las políticas INSERT **y** UPDATE
  tenían `poza_id`/`macho_id` sin calificar dentro de los `EXISTS`; hoy
  `PECUARIO_JAULAS` no tiene `poza_id` ni `PECUARIO_REPRODUCTORES` tiene
  `macho_id`, así que no era un bug activo, pero una columna futura con ese
  nombre habría vuelto la validación una tautología silenciosa. Corregida antes
  de aplicar (commit `1656609`). (3) El trigger de bloqueo de columnas
  rechazaba toda edición hecha desde Studio (donde `auth.role()` es NULL);
  se agregó el bypass de `postgres` (commit `2d707d9`). (4) Gap de integridad
  de datos, fuera de RLS: `PECUARIO_PARTOS.macho_id` no valida que el
  reproductor sea macho (a diferencia de `madre_id`, que sí valida
  `trg_partos_validar_madre`); anotado como backlog en `AI_STATE.md`.

  **Tests** (commit `ef903ad`): `tests/test_pecuario_partos_rls.py`, 20 passed
  (3 estáticos + 17 en vivo), y `tests/test_pecuario_sugerencias_reemplazo_rls.py`,
  18 passed (3 estáticos + 15 en vivo); 69 subtests entre ambos. Sesiones reales
  de `admin`, `tecnico_campo` y `auditor_qc`. Suite completa: **7 failed, 934
  passed, 8 skipped**, con las mismas 7 fallas preexistentes de siempre.
  Verificado contra `pg_policies` (lectura, ADR-042) que lo aplicado en Studio
  coincide con lo commiteado: las 8 policies, `TO authenticated`, sin
  `rls_all_*` residual, cuerpo del trigger de bloqueo idéntico al commiteado.
  Sin residuos en la base tras la corrida (`PECUARIO_PARTOS`: 3 filas, todas de
  GRANJA-TEST como antes; `PECUARIO_SUGERENCIAS_REEMPLAZO`: 0). **Limitación:**
  el bypass de `CURRENT_USER = 'postgres'` no es simulable por API (requiere
  una sesión directa en Studio); solo lo cubren el chequeo estático y un
  control positivo con `service_role`.

  **Trazabilidad (protocolo 4.1):** redactadas y revisadas por Claude (Cowork);
  la CLI encontró la fragilidad de scoping y el gap del bypass en Studio;
  Neyser las aplicó manualmente.

- **(2026-10-06, cierre) App móvil Granja Valencia — pantalla de
  Reemplazo/descarte (punto 8 del roadmap), CERRADA.** Completa el punto 8
  junto con el tramo de backend de RLS ya registrado en la entrada del
  2026-10-04 (`PECUARIO_PARTOS` y `PECUARIO_SUGERENCIAS_REEMPLAZO`, commit
  `6f4352c`). Solo cliente: sin SQL ni migraciones nuevas en esta tarea.

  **Spec y contrato** (commit `f9cb90d`): `specs/app_granja_valencia_reemplazo.md`
  y `SugerenciaReemplazoResolverSchema` en `lib/validations/pecuario.ts`
  (extiende `SugerenciaReemplazoAccionSchema`, que no se tocó porque un test
  Python exige su cuerpo exacto, con `estado: 'confirmada' | 'ignorada'`).
  Decisión de lectura validada con sesiones reales: consultar la TABLA con
  embed anidado (reproductor → jaula → galpón, `!inner`) y no la vista
  `vw_pecuario_sugerencias_reemplazo`, que no excluye vendidos ni descartados.

  **Pantalla** (commit `a07bd77`):
  `apps/granja-valencia/src/app/(protegido)/reemplazo/index.tsx`,
  `lib/reemplazo/datos.ts` (una sola función de lectura compartida entre Inicio
  y la lista) y `lib/reemplazo/logica.ts` (agrupar por jaula, contar animales
  distintos, desglose por motivo, textos), con tests Jest propios; tarjeta de
  Alertas en Inicio ("N reproductora(s) sugerida(s) para reemplazo", con
  desglose por motivo y botón "Ver lista"). Acción en BLOQUE por reproductor
  (UPDATE de `estado` sobre todas sus sugerencias pendientes), con diálogo de
  confirmación que avisa que no se puede deshacer; sin escritura offline.
  Botones visibles solo para `admin` y `tecnico_campo` (cosmético; la barrera
  real es la RLS).

  **Corrección** (commit `4096d68`): el subtítulo de `/reemplazo` decía "1
  reproductora agrupadas por jaula"; ahora concuerda en singular
  (`subtituloLista` en `lib/reemplazo/logica.ts`, con tests para 0, 1 y N).

  **Verificación de código:** `tsc --noEmit` limpio, Jest completo de la app
  132/132, bundle por ruta servido por Metro con HTTP 200 y 0
  `UnableToResolveError`, y los tests Python
  `tests/test_pecuario_reglas_reemplazo.py` y
  `tests/test_pecuario_sugerencias_reemplazo_rls.py` (49 passed, incluidos los
  3 tests en vivo de la forma en bloque del UPDATE con sesión real).

  **Verificación en dispositivo (2026-10-06, GRANJA-TEST):** con la cuenta
  `admin` se ignoró H-002 y, con la cuenta `tecnico_campo`, se confirmó H-003.
  Resultado confirmado por SQL de solo lectura: H-002 con sugerencia
  `ignorada` (`resuelta_en` no nulo), `proposito = 'reproductor'` y estado
  `activo`; H-003 con sugerencia `confirmada` (`resuelta_en` no nulo),
  `proposito = 'descarte'` y estado `activo`. Eran 2 filas en total en
  `PECUARIO_SUGERENCIAS_REEMPLAZO`, todas de GRANJA-TEST (ninguna de otra
  organización), y H-003 es el único reproductor en descarte en toda la base.

  **Pendientes conocidos (no bloquean el cierre):**
  - El bloque con dos motivos a la vez en un mismo animal no se probó en
    dispositivo (sí lo cubre el test automatizado en vivo).
  - El texto del diálogo de ignorar, "por ninguno de sus motivos", suena raro
    cuando el animal tiene un solo motivo.
  - El copy está en voseo ("revisá", "confirmá", "ignorá") sin una decisión
    tomada para toda la app.
  - La tarjeta "Reproductoras activas" de Inicio no baja al descartar: cuenta
    por `estado = 'activo'` y el descarte cambia `proposito`, no `estado`.

  **Trazabilidad (protocolo 4.1):** Redactado y revisado por Claude (Cowork),
  Arquitecto Senior RYZOS. La CLI encontró observaciones durante el recon (se
  resolvieron). Neyser aplicó las migraciones en Supabase Studio y verificó en
  dispositivo.

- **(2026-10-07) Seguridad — vistas sin escritura / `USUARIOS_LOGIN`
  (APLICADAS por Neyser en Studio el 2026-10-08).** Redactó Claude (Cowork) a partir de una auditoría
  de catálogos de solo lectura (2026-10-07, sin sondas de escritura, sin leer
  filas de `USUARIOS`/`USUARIOS_LOGIN`). Hallazgo: `USUARIOS_LOGIN` (vista sin
  filtro, dueña `postgres`) deja a `anon`/`authenticated` leer y escribir DNI,
  teléfono, email, rol y firma de todos los usuarios; y las 28 vistas de
  `postgres` tienen `arwdDxtm` para `anon`/`authenticated` por `pg_default_acl`
  (caso confirmado: `vw_pecuario_lotes_etapa`, sin `WITH CHECK OPTION`).
  **Archivos (commit sin aplicar):** `supabase/migrations/20261008090000_seguridad_usuarios_login_sin_acceso_cliente.sql`
  (sha256 `f1b2074c…4bf0`) y `20261008091000_seguridad_vistas_sin_escritura_cliente.sql`
  (sha256 `ff093656…4f3a`), copiadas sin modificar; reversa en
  `supabase/rollbacks/20261008090000_seguridad_rollback.sql` (fuera de
  `migrations/`; reabre la fuga); test permanente
  `tests/test_seguridad_vistas_sin_escritura.py`; `docs/adr/ADR-043-vistas-sin-escritura-cliente.md`.
  Snapshot previo (ACL por grantee, `pg_default_acl`, auto-actualizabilidad)
  fuera del repo en `~/ryzos_scratch/seguridad_antes/`.
  **Estado del test ANTES de aplicar:** 2 fallan y 2 pasan, como se espera. Fallan
  `test_a` (56 combinaciones vista/rol con escritura: 28 vistas × `anon` y
  `authenticated`) y `test_b` (`USUARIOS_LOGIN` concede todo a `anon` y
  `authenticated`); pasan los dos de `test_d` (la web conserva `SELECT` para
  `anon` en las 4 vistas EUDR; `authenticated` en las `vw_pecuario_*`). No están
  marcados xfail: el rojo desaparece al aplicar las dos migraciones.
  **Pendiente (Neyser):** aplicar en Supabase Studio, en orden `…090000` y luego
  `…091000`; reejecutar el test y esperar 4/4 verdes. Decisiones pendientes:
  (1) confirmar que nada externo (p. ej. AppSheet) usa `USUARIOS_LOGIN` con
  `anon`/`authenticated`; (2) si `USUARIOS`/`USUARIOS_LOGIN` siguen vivas o se
  eliminan; (3) tareas aparte, no cubiertas: 4 tablas sin RLS con permisos
  totales para `anon` (`CONFIGURACION_REPORTES_ORG`, `MENU_APP`,
  `METADATOS_CAMPOS`, `spatial_ref_sys`) y 4 políticas de `SELECT` permisivas
  de `anon` (`id_organizacion IS NOT NULL`). Riesgo residual: `pg_default_acl`
  sigue dando todos los permisos a objetos nuevos; lo vigila el test.
  **Trazabilidad (protocolo 4.1):** redactado por Claude (Cowork); revisión de
  seguridad pendiente de que Neyser aplique y de este test.

- **(2026-10-07) Seguridad — tablas sin RLS / lectura anon / funciones
  (APLICADAS por Neyser en Studio el 2026-10-08).** Redactó Claude (Cowork); copiadas sin cambios por
  Claude Code CLI (sha256 verificados). Archivos:
  `supabase/migrations/20261008092000_seguridad_tablas_sin_rls_sin_acceso_cliente.sql`
  (`ed597dce…08ec`) y `20261008093000_seguridad_lectura_anon_y_funciones.sql`
  (`dbba57b4…5d2d`); reversa `supabase/rollbacks/20261008092000_seguridad_rollback.sql`;
  tests `tests/test_seguridad_tablas_funciones.py`; addendum en
  `docs/adr/ADR-043-vistas-sin-escritura-cliente.md`; snapshot previo en
  `~/ryzos_scratch/seguridad_antes2/`. **Dependencias ocultas (paso 3, solo lectura):**
  sin vistas, funciones, políticas, CHECK, triggers ni defaults que dependan de las 7
  tablas, salvo `agregar_campo_y_metadato` (sin EXECUTE para clientes) y FK internas; las 3
  funciones no tienen invocadores dentro de la base y solo las usa la app Expo con sesión
  `authenticated` (conservan EXECUTE). Nombres de política y de función de las migraciones
  = vivos (coinciden exactamente).
  **Estado de los tests ANTES de aplicar:** en `test_seguridad_tablas_funciones.py` fallan
  a. (3 tablas sin RLS y con permisos), b. (4 políticas anon abiertas) y d. (3 funciones con
  EXECUTE para anon/PUBLIC), con mensaje "migración … no aplicada"; pasan c. (lecturas con
  lector real siguen abiertas) y e. (`spatial_ref_sys`: informa un `UserWarning` "pendiente:
  soporte de Supabase", no falla). Con los de ADR-043: 5 fallan y 4 pasan, como se espera.
  **Pendiente (Neyser):** confirmar que nada externo (AppSheet / `backend-inspecciones`)
  usa `CONFIGURACION_REPORTES_ORG`, `MENU_APP` ni `METADATOS_CAMPOS` con `anon` o sesión;
  aplicar en Studio (orden: …090000, …091000, …092000, …093000); `spatial_ref_sys` requiere
  soporte de Supabase (`postgres` no es miembro de `supabase_admin`). **Tarea futura:**
  mover las lecturas anon de `SOCIO_CERTIFICACIONES` (`lib/padronCsv.js:203,1409`) a una
  Server Action y cerrar su política. Revisión de seguridad pendiente de la aplicación.

- **(2026-10-08, cierre) Seguridad — 4 migraciones APLICADAS por Neyser en Studio y
  verificadas.** `20261008090000` (`USUARIOS_LOGIN`), `20261008091000` (vistas sin
  escritura), `20261008092000` (tablas sin RLS) y `20261008093000` (lectura anon y
  funciones), descritas en las dos entradas de arriba (ADR-043 y su addendum). Las
  redactó y les dio el visto bueno de seguridad Claude (Cowork); las aplicó Neyser a mano
  en Supabase Studio; **verificadas por catálogo por el CLI y por Neyser en Studio**.
  **Verificado por Neyser en Studio:** 0 vistas con escritura abierta ni `USUARIOS_LOGIN`
  con acceso; 0 tablas heredadas sin RLS o con acceso; las 4 políticas anon en `false`; las
  3 funciones con `anon = false` y `authenticated = true`; `spatial_ref_sys` SIGUE con
  escritura abierta para `anon` y `authenticated` (esperado). Prueba manual de Neyser:
  dashboard web (mapa y QC), lista de socios y Asignar macho en la app Expo funcionan.
  **Verificado por el CLI (solo lectura):** los dos tests de catálogo
  (`tests/test_seguridad_vistas_sin_escritura.py`, `tests/test_seguridad_tablas_funciones.py`)
  dan 9 passed, 1 warning ("pendiente: soporte de Supabase", caso de `spatial_ref_sys`).
  Contra los snapshots previos (`~/ryzos_scratch/seguridad_antes*`): `USUARIOS_LOGIN` y las
  3 tablas propias pasaron de `arwdDxtm` a ningún privilegio para `anon`/`authenticated`;
  27 vistas pasaron de `arwdDxtm` a `SELECT` + `MAINTAIN`; las 4 políticas anon cambiaron
  solo su `USING` a `false` (mismo nombre, comando y rol); las 3 funciones perdieron
  `EXECUTE` para `PUBLIC` y `anon`; `postgres`, `service_role`, `pg_default_acl`,
  `geometry_columns`/`geography_columns` y `spatial_ref_sys` sin cambios; entre las
  funciones `SECURITY DEFINER` solo cambiaron esas 3. Tablas de `public`: 72 con RLS, 1 sin
  RLS (`spatial_ref_sys`). Límite: no hay snapshot previo del resto de las tablas y
  funciones, así que "ningún otro objeto cambió" se confirma solo para lo cubierto por los
  snapshots y por `pg_default_acl`.
  **Observación:** las 27 vistas conservan `MAINTAIN` para `anon`/`authenticated` (la
  migración no lo revocaba y el test no lo cubre); el contrato decía "solo `SELECT`".
  Sin efecto práctico conocido en vistas simples; decidir si se revoca.
  **Pendientes:** (1) `spatial_ref_sys` — escritura abierta para `anon`/`authenticated`;
  requiere soporte de Supabase (`postgres` no es miembro de `supabase_admin`); (2) mover
  las lecturas anon de `SOCIO_CERTIFICACIONES` (`lib/padronCsv.js:203,1409`) a una Server
  Action y entonces cerrar su política; (3) `pg_default_acl` sigue dando permisos totales a
  objetos nuevos y `EXECUTE` a `PUBLIC` en funciones nuevas; (4) revisión de logs de acceso
  a `USUARIOS_LOGIN` (la vista estuvo abierta a `anon` hasta el 2026-10-08); (5)
  `exportar_esquema_ryzos()` para `authenticated` (conserva `EXECUTE`; decidir si se
  revoca); (6) decidir si `USUARIOS`/`USUARIOS_LOGIN` siguen vivas o se eliminan.

- **(2026-10-07) Huso horario Lima - Migración 1 (APLICADA por Neyser en Studio el 2026-10-08).**
  Redactó Claude (Cowork); copiada sin cambios por Claude Code CLI (sha256 `86ef7165…9763`
  verificado). Revisión de seguridad pendiente. Problema: la base corre en UTC y 8 vistas
  Pecuario usan `CURRENT_DATE`; entre las 19:00 y las 24:00 de Lima el mes, los 12 meses y
  los 56 días desde el destete se calculan con un día de adelanto. La migración crea
  `fn_fecha_operativa(timestamptz)` y `fn_hoy_operativo()` (sql, STABLE, sin DEFINER/SET;
  EXECUTE solo `anon`, `authenticated`, `service_role`), reescribe 8 vistas con `CREATE OR
  REPLACE VIEW` (conserva ACL y COMMENT) y agrega `animales_vendidos_mes` al final de
  `vw_pecuario_ventas_mes`. Archivos: `supabase/migrations/20261008100000_huso_horario_lima_vistas_pecuario.sql`,
  reversa `supabase/rollbacks/20261008100000_huso_horario_lima_rollback.sql` (conserva la columna
  nueva; los `DROP FUNCTION` van comentados), `tests/test_pecuario_huso_horario.py`,
  `specs/pecuario_huso_horario_lima.md`, `plans/pecuario_huso_horario_ejecucion.md`, `tzdata`
  en `requirements.txt`. Snapshot previo en `~/ryzos_scratch/huso_antes/` (13 definiciones,
  `SELECT *` de las 8 vistas, comentarios, ACL, hora UTC/Lima).
  **Pruebas antes de aplicar:** 15 pasan y 3 se saltan ("migración 20261008100000 no
  aplicada": las dos de funciones y d1). Pasan los estáticos (migración y reversa), la lectura
  con `anon`/`authenticated` más el aislamiento cruzado, y d0 (siembra y limpieza en
  GRANJA-TEST, verificada). Las d. con base solo discriminan el error antiguo entre las 19:00
  y las 24:00 de Lima; fuera de esa ventana lo cubre a.+b.
  **Qué falta:** (1) revisión de seguridad; (2) aplicación manual por Neyser en Studio y
  re-correr el test (idealmente de noche, hora de Lima); (3) Migración 2 (defaults
  `CURRENT_DATE` de Pecuario y 3 funciones); (4) app Expo: helper único de "hoy" (`hoyISO()`
  está copiada en 10 pantallas); (5) tests existentes que asumen UTC o `date.today()`
  (panel, Empadre, etapa_automatica, poblacion_vistas); (6) `docs/schema_live_*.md` después de
  aplicar.

- **(2026-10-08, cierre) Huso horario Lima - Migraciones 1 y 2 APLICADAS por Neyser en
  Studio el 2026-10-08.** `20261008100000` (funciones, 8 vistas, `animales_vendidos_mes`) y
  `20261008110000` (15 defaults `date` de `PECUARIO_*`, 3 funciones y
  `vw_pecuario_retiros_macho_pendientes`). Las redactó y les dio el visto bueno de seguridad
  Claude (Cowork); las aplicó Neyser a mano; verificadas por catálogo y por tests por el CLI.
  Neyser verificó 7 controles de catálogo (true, 0, 0, 15, 0, 1, 0).
  **Verificado por el CLI (solo lectura + siembra en GRANJA-TEST con limpieza verificada):**
  `tests/test_pecuario_huso_horario.py` 18 passed (funciones con `anon` y `authenticated`,
  lectura de las 8 vistas, aislamiento, bordes del mes y de los 56 días) a las 21:37 de Lima
  (02:37 UTC del día siguiente: dentro de la ventana 19:00-24:00, donde se distingue el error
  antiguo); `tests/test_pecuario_huso_horario_defaults.py` 15 passed (estáticos, catálogo:
  0 defaults `CURRENT_DATE` en `PECUARIO_*`, 15 con `fn_hoy_operativo()`, funciones con los mismos
  `prosecdef`/`proconfig`, triggers presentes; y un parto, un lote y un stock inicial sin fecha
  reciben el hoy de Lima) a las 21:45 de Lima; `test_seguridad_vistas_sin_escritura.py` 4 passed
  (ACL de las vistas intacto). Archivos nuevos: migración 2 (sha256 `83795e24…fd65`), reversa
  `supabase/rollbacks/20261008110000_huso_horario_lima_rollback.sql`. Tests existentes alineados
  con la fecha de Lima (solo el "hoy"): `test_pecuario_panel_indicadores.py:80`,
  `test_pecuario_empadre_asignacion_macho.py:382`, `test_pecuario_etapa_automatica.py:139-144`,
  `test_pecuario_poblacion_vistas.py:271,443`. **No se corrieron en vivo** esas 4 suites: siembran
  en GRANJA-VALENCIA o COOP-AROMAS-VALLE (organizaciones reales); solo se comprobó la sintaxis y
  sus casos estáticos (36 passed). Corrida pendiente cuando el panel pase a una organización de
  prueba. `docs/schema_live_pecuario.md` y `schema_live_core.md` actualizados.
  **Pendientes:** (1) helper de "hoy" en la app Expo (`hoyISO()` en UTC, copiada en 10
  pantallas); (2) mover el panel de indicadores (y Empadre/poblacion_vistas) a una organización
  de prueba (`ORG-TEST-PANEL`, con revisión de Cowork); (3) `EUDR_MONITOREO.fecha_monitoreo` y
  `PRECIOS_PRODUCTO.vigente_desde` (default `CURRENT_DATE` de otros módulos); (4) vistas SUPERADA
  (`desinfeccion_estado`, `limpieza_galpon_estado`); (5) `MAINTAIN` en las vistas (ver entrada de
  seguridad).

## 📌 PRÓXIMA VEZ QUE ABRAS UNA CONVERSACIÓN

Si vienes de una pausa, simplemente di: **"Lee el estado del proyecto y sigamos donde quedamos."** No necesitas repetir el contexto — este documento lo tiene.

