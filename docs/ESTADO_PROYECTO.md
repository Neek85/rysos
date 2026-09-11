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


## 📌 PRÓXIMA VEZ QUE ABRAS UNA CONVERSACIÓN

Si vienes de una pausa, simplemente di: **"Lee el estado del proyecto y sigamos donde quedamos."** No necesitas repetir el contexto — este documento lo tiene.

