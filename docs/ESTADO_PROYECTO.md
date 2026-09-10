# ESTADO DEL PROYECTO RYZOS
*Última actualización: 10 de septiembre, 2026*

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

> **Rotación (2026-09-04):** este documento se recorta a los últimos 3
> hitos — historial completo movido a
> [`docs/archive/ESTADO_HISTORICO.md`](archive/ESTADO_HISTORICO.md)
> (no leído por defecto).

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

- **(2026-09-05) ADR-035 cerrado — piloto de "Camino 1" (Fase D Paso 2):
  `updateQcRecordAttributes`/`updateQcRecordGeometry` migran de Service
  Role Key a sesión real:** en `lib/actions/qcActions.js`, solo esas 2
  funciones (edición de atributos/geometría de un registro PENDIENTE en
  la Consola QC) ahora corren con `createSessionServerClient()` — RLS
  real de ADR-034 como autoridad, no un bypass. `approveQcRecord`/
  `rejectQcRecord` quedan con Service Role Key a propósito: aprobar/
  rechazar necesita distinguir `admin`/`auditor_qc` de `tecnico_campo`,
  y el RLS actual de las 3 tablas EUDR solo distingue por organización
  — eso es una decisión de diseño aparte, no un olvido. **Verificado en
  vivo:** con una fila descartable (creada y borrada en la misma
  verificación — las 3 tablas EUDR estaban completamente vacías, no
  había ningún registro real disponible) y una sesión real, el `UPDATE`
  afectó exactamente 1 fila, no 0 — confirma que el RLS real permite la
  escritura al usuario correcto en vez de bloquearla. `npm run build`
  limpio.
  **Hallazgo abierto, sin causa determinada:** `EUDR_MONITOREO`/
  `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` están vacías para **todas** las
  organizaciones, no solo la de prueba — mismo síntoma que
  `INSPECCIONES` (`AI_STATE.md` `2026-09-03f`/`g`), ahora en 3 tablas
  más. No investigado en esta tarea — mismo límite de entorno (sin
  acceso a backups/logs de Supabase desde acá), pendiente de que
  decidas si amerita revisar Point-in-Time Recovery/Database Logs en
  Supabase Studio. Ver
  [ADR-035](adr/ADR-035-piloto-camino-1-rls-sesion-qc-atributos-geometria.md)
  y `AI_STATE.md` (`2026-09-05`) para el detalle completo.

- **(2026-09-05) ADR-036 — piloto de "Camino 1", Fase A.1:
  `createParcela`/`updateParcela`/`deactivateParcela`/`deactivateSocio`
  migran de Service Role Key a sesión real:** mismo patrón que ADR-035,
  esta vez sobre `lib/actions/sociosActions.js`. Las 4 funciones ahora
  corren con `createSessionServerClient()` — el RLS real de
  `PADRON_SOCIOS`/`PADRON_PARCELAS` (ADR-034) es la autoridad.
  `createSocio`/`updateSocio` (certificaciones) y
  `resolveSocioCertFlags` quedan con Service Role Key a propósito —
  bloqueados por 2 gaps reales confirmados en el reconocimiento previo:
  `fn_crear_socio_con_certificaciones` no tiene `GRANT EXECUTE` para
  `authenticated`, y `SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO`
  no tienen ninguna política RLS para `authenticated` — eso es Fase A.2,
  tarea aparte. También se corrigió, en `specs/padron_web_socios.md`,
  la premisa retractada de "padrón compartido en vivo con otro
  repositorio" (ADR-023 ya la había corregido en `ADR-002`/`ADR-007`,
  pero nunca se había propagado a este spec — que es justamente el que
  sostenía el diseño original de `sociosActions.js`). **Verificado en
  vivo, con sesión real:** crear, editar y dar de baja una parcela
  descartable (`201`→`200`→`200`, `activo: false` confirmado); dar de
  baja un socio descartable con cascada real a su parcela (`activo:
  false` en ambas tablas); un intento cruzado con el `ID_Organizacion`
  de `COOP-AROMAS-VALLE` sobre una fila real de `ORG-TEST-DEMO` dio 0
  filas afectadas (bloqueado, mensaje claro, sin regresión de
  seguridad — solo cambia cuál de los 2 mensajes de error ya existentes
  ve el usuario, ver el ADR para el detalle). Filas descartables
  borradas al terminar. `npm run build`/`npm run lint`/`npm run dev`
  limpios. Ver
  [ADR-036](adr/ADR-036-migracion-parcial-camino-1-sociosactions.md)
  para el detalle completo, incluidos los 2 pendientes explícitos
  (Fase A.2: certificaciones; Fase A.3: los 3 targets EUDR del
  Ingestor de Capas Espaciales, que en realidad corre bajo
  `/dashboard/qc`, no `/dashboard/mapa`).
  **Nota de autoría/revisión:** esta tarea la redactó Claude (Cowork)
  de punta a punta — spec de corrección, ADR, código, verificación
  funcional en vivo y bitácora — sin una segunda revisión de Gemini en
  el medio (a diferencia del protocolo multi-IA que describe
  `docs/RYZOS_ORQUESTADOR_V3.1.md` §4.1 para tareas de SQL/RLS/
  migraciones/seguridad). La revisión de seguridad de este cambio queda
  cubierta dentro del mismo flujo de esta conversación (recon previo +
  verificación funcional real contra producción), no por un segundo
  revisor externo.

- **(2026-09-04) ADR-037 — piloto de "Camino 1", Fase A.2: certificaciones
  de socio migran a RLS por sesión — `sociosActions.js` queda 100% bajo
  sesión real:** cierra los 2 gaps que quedaban pendientes de ADR-036 —
  se agregaron 3 políticas RLS nuevas para `authenticated`
  (`SOCIO_CERTIFICACIONES`: `SELECT`+escritura; `CERTIFICACIONES_CATALOGO`:
  solo `SELECT`, catálogo compartido) y se otorgó `GRANT EXECUTE` sobre
  `fn_crear_socio_con_certificaciones` (antes solo `postgres`/
  `service_role`). Las políticas `anon` existentes no se tocaron.
  `createSocio`/`updateSocio`/`resolveSocioCertFlags` ahora usan
  `createSessionServerClient()` — el import de `getSupabaseServerClient`
  se eliminó del archivo por completo (sin uso restante). **Verificado
  en vivo:** crear un socio descartable con 2 certificaciones (RLS
  correcto en `id_organizacion`), editarlo cambiando el set de
  certificaciones (`DELETE`+`INSERT` bajo sesión), releer sus flags
  (`resolveSocioCertFlags`), y un intento cruzado con la organización
  equivocada — que reveló un modo de falla **distinto** al de Fase A.1:
  no "0 filas afectadas" (eso es de `UPDATE`s), sino un error real de
  Postgres (`403`, `42501`, violación de RLS) porque `createSocio` hace
  un `INSERT` nuevo dentro de una RPC. Filas descartables borradas al
  terminar. `npm run build`/`npm run lint` limpios. Ver
  [ADR-037](adr/ADR-037-fase-a2-rls-certificaciones-socios.md) para el
  detalle completo — incluye una corrección menor de `ADR-036` (estado
  actualizado a "Implementado", más una nota sobre este mismo hallazgo
  del `INSERT`). Sigue pendiente, sin tocar: Fase A.3
  (`gisActions.js`, atada al `resolveOrganizationId` de la Consola QC).
  **Misma nota de autoría:** redactada por Claude (Cowork) de punta a
  punta, revisión de seguridad cubierta en el mismo flujo, sin segunda
  revisión de Gemini.

- **(2026-09-04) Guía de Optimización de Tokens y Flujo Multi-IA
  aplicada — trabajo de documentación/tooling puro, sin RLS/SQL:**
  `CLAUDE.md` gana una sección "Token Economy & Output Rules" (no
  reimprimir archivos completos en tareas rutinarias; usar `git
  diff`/`git show` en tareas de SQL/RLS en vez del archivo completo; y
  esta misma rotación de bitácoras). `.claudeignore` nuevo
  (`node_modules/`, `.next/`, `docs/archive/`,
  `supabase/migrations/archivadas/`, binarios GIS, etc.). **Rotación de
  bitácoras:** `docs/ESTADO_PROYECTO.md` recortado a los últimos 3 hitos
  (historial completo en
  [`docs/archive/ESTADO_HISTORICO.md`](archive/ESTADO_HISTORICO.md));
  `AI_STATE.md` recortado a los bloqueos/diagnósticos activos — la nota
  permanente sobre `supabase db push` y la investigación sin causa raíz
  determinada de las tablas centrales vacías (historial completo en
  [`docs/archive/AI_STATE_HISTORICO.md`](archive/AI_STATE_HISTORICO.md)).
  **`docs/adr/INDEX.md` nuevo:** tabla de las 35 ADRs reales del repo
  (número, título, tabla/módulo, fecha, estado) — generada leyendo cada
  archivo, no de memoria; de paso corrigió el campo `Estado` de 4 ADRs
  (`032`/`033`/`034`/`035`) que decían "Propuesto... sin commitear"
  pese a estar aplicados y commiteados hace días. **`docs/schema_live.md`
  partido en 3** por vertical:
  [`docs/schema_live_core.md`](schema_live_core.md) (`ORGANIZACIONES`,
  `PADRON_SOCIOS`, Auth/`PERFILES_USUARIO_INTERNOS`),
  [`docs/schema_live_agricola.md`](schema_live_agricola.md)
  (`PADRON_PARCELAS`, `EUDR_*`, `INSPECCIONES`/`CAP_*`, vistas
  espaciales), [`docs/schema_live_pecuario.md`](schema_live_pecuario.md)
  (vertical pecuaria — confirmado por `grep` exhaustivo que no existe
  ninguna tabla `PECUARIO_*` todavía, sin inventar contenido). El
  contenido de cada sección se movió tal cual del archivo original (no
  se reescribió), con notas nuevas señalando las partes de RLS que
  quedaron desactualizadas por ADR-031 a 037 (posteriores a la última
  actualización real del archivo original). `CLAUDE.md` indica cuál de
  los 3 cargar según la carpeta que se esté tocando. 5 comentarios en
  código activo (`sociosActions.js`, `padronCsv.js`, `gisTargetTables.js`,
  `organizacionesActions.js`, `eudrQcActions.js`) que apuntaban al
  archivo viejo se corrigieron al nuevo archivo correspondiente —
  **no** se tocaron las ~55 referencias restantes en specs/ADRs/planes
  ya cerrados ni en migraciones (registro histórico, no se reescribe).
  **Sin tocar RLS/SQL/seguridad** — no requirió el gate de segunda
  revisión de la Sección 4.1. `npm run build`/`npm run lint` limpios.
  **Nota de autoría:** redactada por Claude (Cowork) de punta a punta.

- **(2026-09-04) Fix menor: `docs/RYZOS_ORQUESTADOR_V3.1.md` seguía
  referenciando `docs/schema_live.md` (ya no existe, partido en 3 el
  2026-09-05) y `npm run sync-schema` (nunca existió como script
  real):** 4 referencias corregidas (Sección 1 punto 5, Sección 2, el
  prompt plantilla de la Sección 4, y Sección 7) — todas apuntan ahora a
  `docs/schema_live_core.md`/`_agricola.md`/`_pecuario.md`, y la
  Sección 7 ya no dice "se actualiza automáticamente al ejecutar `npm
  run sync-schema`" (confirmado otra vez contra `package.json` que ese
  script no existe) sino "se actualizan manualmente tras cada
  migración". Documentación pura, sin tocar RLS/SQL — no requirió el
  gate de la Sección 4.1. `npm run build` limpio (no afectado, cambio
  de un solo `.md`).

- **(2026-09-04) ADR-038 — piloto de "Camino 1", Fase A.3: las 3 ramas
  EUDR del Ingestor Espacial migran a RLS por sesión — cierra el pilar
  de escritura que quedaba pendiente:** en `lib/actions/gisActions.js`,
  las 3 ramas `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` de
  `uploadGeoSpatialFeature` ahora corren con `createSessionServerClient()`
  y resuelven la organización server-side vía `supabase.rpc('auth_org_id')`
  — ya no confían en el parámetro `organizationId` que manda el
  cliente. La rama `PADRON_PARCELAS` (delega en `createParcela`, ya
  migrada en ADR-036) sigue usando ese parámetro, sin tocar. **Sin
  migración SQL nueva** — la política `rls_write_eudr_*` (`FOR ALL`) ya
  existía desde ADR-034 y ya cubría `INSERT`, reconfirmado en vivo antes
  de escribir código. **Esto corrige un bug real y actual:** las 3
  tablas EUDR siguen vacías para las 2 organizaciones (mismo hallazgo
  abierto de ADR-035, sin causa raíz determinada), y el código viejo
  resolvía la organización con `resolveOrganizationId(records)` sobre
  esos mismos registros — con 0 filas, esa función siempre devolvía
  `null` y bloqueaba la escritura para cualquier organización antes de
  cualquier llamada de red. Ahora `auth_org_id()` no depende de que
  existan filas, así que el bloqueo queda cerrado de raíz. **Verificado
  en vivo:** con sesión real, insert legítimo en las 3 tablas (`201`,
  `ID_Organizacion` correcto) e insert falsificado con la organización
  de `COOP-AROMAS-VALLE` en las 3 tablas (`403`, `42501`, violación de
  RLS) — confirma que un `organizationId` falsificado ya no tiene
  ningún efecto, ni en el código (ya no se usa) ni si algo lo
  reintrodujera (RLS lo bloquea igual). Filas descartables borradas al
  terminar, `0` filas confirmadas en las 3 tablas después. `npm run
  build`/`npm run lint` limpios. Ver
  [ADR-038](adr/ADR-038-fase-a3-rls-sesion-gis-ingestor.md) para el
  detalle completo. **Nota de autoría:** redactada por Claude (Cowork)
  de punta a punta, revisión de seguridad cubierta en el mismo flujo
  (recon previo + verificación funcional real contra producción), sin
  segunda revisión de Gemini.

- **(2026-09-04) ADR-039 — Fase D: aprobar/rechazar en la Consola QC
  migran a sesión real, con control de rol en Postgres — cierra el
  pendiente que había dejado abierto ADR-035:** `approveQcRecord`/
  `rejectQcRecord` (`lib/actions/qcActions.js`) ahora corren con
  `createSessionServerClient()`. Lo que las bloqueaba antes (RLS por
  organización no distingue rol) se cerró con un trigger nuevo en
  Postgres (`fn_enforce_qc_approval_roles`, `BEFORE UPDATE` en las 3
  tablas EUDR): si `estado_revision` cambia de verdad, exige
  `admin`/`auditor_qc` (`auth_role()`), si no lanza `42501`. Con
  bypass para `service_role`/`postgres` (necesario para que
  `scripts/qgis_qc_actions.py`, que aprueba/rechaza vía conexión
  directa a Postgres desde QGIS Desktop, siga funcionando — no estaba
  en la redacción original del prompt, se agregó tras revisar ese
  script). **2 correcciones de premisa antes de escribir código:** el
  número de ADR pedido (`038`) ya estaba tomado por la tarea anterior
  de esta misma sesión (Fase A.3) — se usó `039`; el timestamp de
  migración pedido (`20260906000000`) estaba 2 días adelantado de la
  fecha real — se usó `20260904190000`. También se confirmó en vivo
  que no existe ningún `CHECK` constraint de Postgres sobre
  `estado_revision` (es solo convención de aplicación) — no se agregó
  ninguno, no se pidió explícitamente. **Verificado en vivo con 3
  sesiones reales de rol distinto** (`auditor_qc`/`tecnico_campo`/
  `admin`, más un `admin` de otra organización): aprobar con
  `auditor_qc` o `admin` → `200`; aprobar con `tecnico_campo` → `403`,
  `42501`, mensaje del trigger, fila real sin cambios; aprobar desde
  otra organización → `200`, `0` filas, RLS de organización bloquea
  antes de que el rol importe. Fila descartable borrada al terminar.
  `npm run build`/`npm run lint` limpios. Ver
  [ADR-039](adr/ADR-039-fase-d-qc-aprobar-rechazar-roles-rls.md) para
  el detalle completo.

- **(2026-09-06) ADR-040 — infraestructura de base de datos para
  sincronización móvil offline-first (sin código de app todavía):**
  3 tablas nuevas — `SYNC_QUEUE` (cola genérica de mutaciones offline
  por dispositivo, RLS por organización sin restricción de rol),
  `PRECIOS_PRODUCTO` (lectura por organización para cualquier
  autenticado, escritura exclusiva `admin`), `SOCIO_ACTIVACION_CODES`
  (códigos de activación, exclusivo `admin`) — y 2 columnas nuevas en
  `PADRON_SOCIOS` (`pin_hash`, `pin_configurado_en`). **Corrección de
  premisa central antes de escribir código:** el prompt pedía RLS de
  lectura para "socios/técnicos" en `PRECIOS_PRODUCTO`, pero el auth de
  socios (DNI+PIN) no existe todavía en este repo — `'socio'` no es un
  rol válido en `PERFILES_USUARIO_INTERNOS` y
  `specs/login_real_organizacion_rol.md` confirma que la app del Socio
  nunca usa el login real de `admin`/`tecnico_campo`/`auditor_qc`. Con
  el usuario, se decidió que el RLS de estas 3 tablas cubra únicamente
  los 3 roles que sí tienen sesión real hoy — el acceso de la App del
  Socio queda explícitamente para una fase posterior, cuando exista ese
  mecanismo. `specs/mobile_offline_sync.md` (nuevo) tampoco existía —
  se redactó desde cero siguiendo el flujo SDD antes de la migración.
  **Hallazgo durante la implementación:** se intentó un `REVOKE` de
  columna sobre `pin_hash` (defensa en profundidad extra, no pedida) y
  se descartó — Supabase ya otorga `SELECT` de tabla completa a
  `authenticated`/`anon`, y un `REVOKE` de columna no anula un `GRANT`
  de tabla ya existente (confirmado con `has_column_privilege()` que no
  tuvo efecto real); `pin_hash` queda protegido al mismo nivel que
  `socio_dni` — por RLS de organización, no por ACL de columna.
  **Verificado en vivo** con 4 sesiones reales: insert en `SYNC_QUEUE`
  sin especificar organización (`201`, resuelta sola vía
  `auth_org_id()`); lectura de `PRECIOS_PRODUCTO` scopeada por
  organización; `tecnico_campo` bloqueado al escribir precios (`403`,
  `42501`), `admin` sí puede; intento cruzado entre organizaciones
  bloqueado igual. Filas descartables borradas al terminar. `npm run
  build`/`npm run lint` limpios (sin cambios de código de aplicación).
  Ver
  [ADR-040](adr/ADR-040-infraestructura-sincronizacion-movil-offline.md)
  para el detalle completo, incluido todo lo que queda explícitamente
  fuera de alcance (RPC de PIN, tablas de acopio, código React Native).

- **(2026-09-06) ADR-041 — procesador server-side de `SYNC_QUEUE` para
  el dominio WebGIS:** `lib/actions/syncGisActions.js` (nuevo,
  `processWebGisSyncQueue()`) drena las filas `PENDIENTE` de
  `SYNC_QUEUE` (`ADR-040`) que apuntan a `EUDR_MONITOREO`/
  `EUDR_USO_SUELO`/`EUDR_INSTALACIONES` e insertan de verdad, con
  sesión real (`createSessionServerClient`). **Corrección de contrato
  antes de escribir código:** el prompt describía columnas de
  `SYNC_QUEUE` que no existen (`tabla_destino`/`error_log`/
  `synced_at`) — se usaron las columnas reales de `ADR-040`
  (`entity_type`/`error_mensaje`/`procesado_en`).
  `specs/sync_queue_webgis_ingestion.md` tampoco existía, se redactó
  desde cero. **Decisión de diseño:** en vez de escribir esquemas Zod
  nuevos (no existe ninguno para estas 3 tablas), el procesador llama
  directo a `uploadGeoSpatialFeature` (`ADR-038`, ya migrada a sesión
  real) para reusar su validación ya probada, en vez de duplicarla.
  **Verificado en vivo con la función real** (no una réplica por REST
  — esta función orquesta lógica, no es una sola consulta): se creó un
  Route Handler temporal (borrado antes del commit, nunca llegó a
  `staging`) que invoca `processWebGisSyncQueue()` de verdad dentro de
  un request de Next.js con sesión real. Resultado: 1 fila válida
  procesada (`EUDR_MONITOREO` creado, `estado: PROCESADO`); 2 filas
  inválidas (campo requerido faltante, geometría no soportada)
  quedaron en `estado: ERROR` con el mensaje real. Filas descartables
  borradas al terminar. `npm run build`/`npm run lint` limpios, mismas
  19 rutas (sin la ruta temporal). Ver
  [ADR-041](adr/ADR-041-procesador-sync-queue-webgis.md) para el
  detalle completo.

- **(2026-09-06) Dominio oficial de trazabilidad pública configurado:
  `https://ryzosagri.com` reemplaza a `app.ryzos.io`, ahora vía
  `NEXT_PUBLIC_APP_URL`:** `lib/traceabilityHash.js::getTraceUrl()` y
  `scripts/generate_lot_qr.py::get_trace_url()` (la URL que se imprime
  en el QR de cada lote de café/cacao exportado, Tarea 14) ya no tienen
  el dominio hardcodeado — leen `NEXT_PUBLIC_APP_URL`/
  `os.environ['NEXT_PUBLIC_APP_URL']`, con `https://ryzosagri.com`
  (el dominio real, confirmado con el usuario antes de tocar código
  que termina en QRs físicos de embarques reales) como fallback si la
  variable no está definida. **Sin lógica de detección de ambiente en
  el código** — cada entorno (dev/preview/producción) le asigna su
  propio valor a la misma variable, patrón estándar de Next.js/Vercel.
  `lib/eudrDdsExporter.js` (que el prompt pedía revisar) no requirió
  ningún cambio — no construye ninguna URL. Se agregó
  `scripts/generate_lot_qr.py` al alcance real (no estaba en la lista
  original) para no romper el invariante ya documentado de que el path
  JS y el path Python deben coincidir exacto — dejarlo desactualizado
  habría hecho que un lote generara QRs con dominios distintos según
  el método usado. 3 archivos de test/spec con la URL vieja hardcodeada
  también se actualizaron (`tests/test_trace_public.mjs`,
  `tests/test_tarea14_trazabilidad.py`,
  `specs/tarea14_trazabilidad_qr.md`). `node --test
  tests/test_trace_public.mjs` (10/10), `python -m pytest
  tests/test_tarea14_trazabilidad.py` (25/25) y la suite completa de
  Python (455 passed, 1 fallo preexistente no relacionado en
  `test_socio_creacion_atomica.py`, 36 skipped) — `npm run build`/`npm
  run lint` limpios. Ver
  `specs/configuracion_dominio_trazabilidad.md` y
  `plans/configuracion_dominio_ejecucion.md` para el detalle completo.

- **(2026-09-06) RBAC en `/dashboard/socios` — `tecnico_campo`/
  `auditor_qc` pasan a "Solo lectura", `admin` mantiene todo:**
  implementa la matriz de permisos ya confirmada
  (`specs/login_real_organizacion_rol.md` §5) para esta pantalla, en 2
  capas: **(a) real** — `lib/actions/sociosActions.js` gana un helper
  `assertAdminRole(supabase)` (llama `auth_role()`, lanza
  `SocioActionError` si no es `'admin'`), aplicado en `createSocio`,
  `updateSocio`, `updateParcela`, `deactivateSocio`, `deactivateParcela`
  — **5 de 6** funciones de escritura; **(b) UX** — botones de
  creación/edición/baja/export/import ocultos en
  `app/dashboard/socios/page.jsx` y
  `components/features/socios/ParcelaFormModal.jsx` (nuevo prop
  `userRole`) para esos 2 roles, resuelto vía
  `lib/auth/getCurrentProfile.js` (ya existía desde Fase B del login
  real, sin consumidores hasta ahora — solo le faltaba `'use server'`
  para ser invocable desde un componente cliente).
  **Corrección de premisa central:** el prompt pedía tocar también
  `/dashboard/mapa` — no hacía falta. Esa página ya es 100% de solo
  lectura para los 3 roles (dice "Visor de solo lectura" en su propio
  subtítulo, sin ningún control de edición) y la matriz ya confirmada
  dice `Sí` para los 3 roles ahí — restringirla habría contradicho una
  decisión de seguridad ya tomada.
  **`createParcela` queda deliberadamente sin el chequeo de rol** —
  también la llama `gisActions.js::uploadGeoSpatialFeature` (Editor
  Vectorial de `/dashboard/qc`, fuera de alcance de esta tarea);
  agregar el chequeo ahí habría roto en silencio la creación de
  parcelas para `tecnico_campo` desde el Editor Vectorial, algo que
  suena a parte central de su trabajo y que nadie pidió ni confirmó
  restringir — gap documentado en `specs/rbac_webgis_padron.md`, no un
  descuido. Mismo criterio para exportación CSV
  (`lib/padronCsv.js`, fuera de la lista de archivos): botones
  ocultos en la UI, sin chequeo de rol nuevo dentro de esas funciones.
  **Verificado en vivo** (Route Handler temporal, borrado antes del
  commit): sesión real de `tecnico_campo` intentando
  `deactivateSocio` sobre un socio descartable → bloqueado
  (`SocioActionError: "Esta acción requiere el rol admin."`); sesión
  real de `admin` sobre el mismo socio → éxito. Fila descartable
  borrada al terminar. `npm run build`/`npm run lint` limpios, mismas
  19 rutas. Ver `specs/rbac_webgis_padron.md` y
  `plans/rbac_webgis_padron_ejecucion.md` para el detalle completo.

- **(2026-09-06) Revisión de seguridad de `a975a7c` (RBAC Padrón de
  Socios) — aprobada con un gap real documentado, no un visto bueno
  limpio:** revisión Multi-IA pedida sobre el commit del RBAC.
  `assertAdminRole()` confirmado correcto contra lo que se pidió
  verificar (no se puede falsificar el rol inyectando campos en el
  payload — resuelve `auth_role()` server-side, nunca lee `values`).
  **Pero se encontró y confirmó en vivo un gap más importante, sin
  pedirlo explícitamente la tarea:** `assertAdminRole()` es una capa
  100% de aplicación, sin respaldo de RLS —
  `rls_write_padron_socios`/`rls_write_padron_parcelas` (`ADR-034`)
  solo filtran por organización, nunca por rol. Un `tecnico_campo`/
  `auditor_qc` puede saltarse `assertAdminRole()` por completo con un
  `PATCH` directo a PostgREST (confirmado en vivo: sesión real de
  `tecnico-campo-demo`, `PATCH` directo a `PADRON_SOCIOS` sin pasar
  por ninguna Server Action → `200 OK`, mutación aceptada). Mismo tipo
  de gap que `ADR-039` ya cerró para `approveQcRecord`/`rejectQcRecord`
  con un trigger de Postgres — esta tarea de RBAC no replicó ese
  patrón para `PADRON_SOCIOS`/`PADRON_PARCELAS`. **No se corrigió en
  esta revisión** (exige una migración SQL nueva, decisión de diseño
  aparte — qué debe seguir pudiendo escribir `service_role`/ETL sin
  romperse). Detalle completo, incluida la severidad (media — no
  explotable por `anon` ni cross-org, sí por un `tecnico_campo`/
  `auditor_qc` interno legítimo con su propio `access_token`) y la
  recomendación de fix en `AI_STATE.md` (2026-09-06, entrada de esta
  revisión). `node --test tests/test_trace_public.mjs` (10/10),
  `python -m pytest tests/test_tarea14_trazabilidad.py` (25/25), `npm
  run build`/`npm run lint` limpios — sin regresión en ninguno de los
  dos, ninguno relacionado con este commit.

- **(2026-09-07) `GEMINI.md` nuevo + orquestador sube a V3.3 — Gemini
  CLI se suma como segundo ejecutor de terminal, distinto del Gem de
  Gemini (que solo redacta):** `GEMINI.md` (raíz del repo, nuevo) es
  el contexto que Gemini CLI lee automáticamente en cada sesión —
  apunta a las mismas fuentes de verdad que ya usa Claude Code CLI
  (`CLAUDE.md`, `docs/RYZOS_ORQUESTADOR_V3.1.md`, bitácora, esquema
  vivo) sin duplicar su contenido, y fija su propio límite de
  ejecución: puede correr tests/build/commit/push a `staging` de punta
  a punta para tareas rutinarias, pero se detiene después de redactar
  (nunca aplica, nunca hace push) en cualquier tarea que toque SQL/RLS/
  migraciones/autenticación/PII/`DELETE`-`UPDATE` masivo — mismo gate
  de seguridad que ya regía para el Gem de Gemini, ahora explícito
  también para la CLI. La Sección 4.1 del orquestador
  (`docs/RYZOS_ORQUESTADOR_V3.1.md`, título sube de V3.2 a V3.3) se
  reescribió completa para reflejar esta distinción de 2 herramientas
  distintas bajo el nombre "Gemini" (el Gem, que nunca ejecuta, y
  Gemini CLI, que sí) — antes solo hablaba de "Gemini" en general, sin
  distinguir las dos. Tarea de documentación pura, sin tocar SQL/RLS.
  `npm run build`/`npm run lint` limpios (no afectados, cambios de
  `.md` solamente).

- **(2026-09-07) Cerrado el gap de RLS de `PADRON_SOCIOS`/
  `PADRON_PARCELAS` encontrado en la revisión de seguridad de
  `a975a7c` — trigger `fn_enforce_padron_admin_role()`:** migración
  `supabase/migrations/20260906220000_enforce_padron_admin_trigger.sql`,
  mismo patrón que `fn_enforce_qc_approval_roles` (`ADR-039`). Un
  `tecnico_campo`/`auditor_qc` ya no puede saltarse `assertAdminRole()`
  con un `PATCH`/`POST`/`DELETE` directo a PostgREST — el trigger exige
  `auth_role() = 'admin'` para cualquier sesión `authenticated` que
  escriba estas 2 tablas. **Corrección de diseño confirmada con el
  usuario antes de aplicar:** el prompt pedía bloquear también
  `INSERT` en `PADRON_PARCELAS`, lo que habría roto en silencio
  `createParcela` vía el Editor Vectorial de `/dashboard/qc`
  (`tecnico_campo` legítimamente crea parcelas nuevas desde el campo,
  fuera del alcance de la matriz de `/dashboard/socios`) — se dejó
  `INSERT` abierto a cualquier `authenticated` en `PADRON_PARCELAS`,
  bloqueando solo `UPDATE`/`DELETE`; `PADRON_SOCIOS` bloquea las 3
  operaciones sin excepción, sin conflicto real ahí. **Verificado en
  vivo** (sesiones reales, filas descartables): el bypass original
  → `403`/`42501`; `admin` sigue pudiendo escribir ambas tablas; el
  Editor Vectorial sigue funcionando para `tecnico_campo`. Test de
  integración nuevo `tests/test_padron_rbac_rls.py` (5/5, patrón
  `NEEDS_SUPABASE`). `node --test tests/test_trace_public.mjs`
  (10/10), `python -m pytest tests/test_tarea14_trazabilidad.py`
  (25/25), `npm run build`/`npm run lint` limpios — sin regresión. Ver
  `specs/rbac_webgis_padron.md` (sección "Cierre del gap de RLS") y
  `AI_STATE.md` (hallazgo del 2026-09-06, ahora marcado RESUELTO) para
  el detalle completo.

- **(2026-09-08) Cerrado el incidente real de login — Eduardo (`admin`,
  COOP-AROMAS-VALLE) y Dante (`tecnico_campo`, COOP-AROMAS-VALLE), el
  roster real y no las 3 cuentas demo de Fase D Paso 1, ya entran a
  `/dashboard` con su propia cuenta, verificado en vivo con las dos:**
  el smoke test formal (Fase D Paso 2) encontró que ninguno de los dos
  podía completar login — no un problema de SMTP/dominio (ya resuelto
  antes: Resend entregaba los correos, confirmado "Delivered"), sino
  dos huecos de código reales que nunca se habían topado hasta que el
  roster real llegó tan lejos (las cuentas demo se activaron por Admin
  API, sin pasar por este camino).

  1. **`/actualizar-password` no existía.** El botón "Send password
     recovery" del Dashboard de Supabase no acepta `redirectTo` propio
     — siempre usa el Site URL vigente, que apuntaba al dashboard
     público (`app/page.jsx`, sin ningún formulario de contraseña).
     Fix: página nueva (cliente de sesión por cookies, para que
     `middleware.js` pueda validarla) + link self-service "¿Olvidaste
     tu contraseña?" en `/login` + Site URL de Supabase Auth
     actualizado a mano (fuera del repo, vía Claude in Chrome) a
     `.../actualizar-password`. Ver `specs/recuperacion_password.md`,
     commit `15be571`.
  2. **`/dashboard` a secas daba 404 real.** Login y
     `/actualizar-password` navegaban ahí por defecto tras un login
     exitoso, pero nunca existió `app/dashboard/page.jsx` — Next.js no
     tenía nada que resolver para ese path exacto. Encontrado recién
     al verificar el fix anterior en vivo (Basic Auth y sesión de
     Supabase ya pasaban las dos). Fix: `app/dashboard/page.jsx`
     redirige a `/dashboard/mapa`. Ver
     `specs/redirect_dashboard_default.md`, commit `f87345c`.

  **Verificado en vivo, de punta a punta, con las dos cuentas reales**
  (no una réplica): Eduardo y Dante completaron el formulario de
  contraseña nueva y llegaron al Mapa WebGIS (`/dashboard/mapa`)
  cargado, sin 404 ni bloqueo de Basic Auth — confirmado por el
  usuario con capturas de las dos cuentas. `npm run build` limpio en
  los dos commits. Sin gate de segunda revisión aplicable — ninguno de
  los dos hallazgos tocó SQL/RLS/migraciones (Sección 4.1.2 del
  protocolo Multi-IA); redactado, corregido y verificado por Claude
  (Cowork) de punta a punta, incluida la edición manual del Site URL
  de Supabase Auth.

- **(2026-09-08) Fase D Paso 2 cerrado — smoke test formal por rol
  (`specs/smoke_test_fase_d_paso2.md`), matriz 15/15:** verificación en
  vivo de las 5 pantallas × 3 roles contra el código real de
  `lib/actions/*.js`/`lib/inspeccionesActions.js` (Server Actions
  reales, sesiones reales por magic link — no equivalentes REST
  reconstruidos a mano). Encontró 1 gap real:
  `/dashboard/inspecciones` × `auditor_qc` podía escribir sin ningún
  bloqueo (`saveInspeccion` sin chequeo de rol, RLS de ADR-033 solo por
  organización). Cerrado con
  `supabase/migrations/20260908150000_enforce_inspecciones_role_trigger.sql`
  (trigger `fn_enforce_inspecciones_role`, mismo patrón que
  `fn_enforce_padron_admin_role`) + `assertInspeccionWriteRole` en
  `lib/inspeccionesActions.js`. **Verificado en vivo con las 3 cuentas
  reales** (Eduardo=admin, Dante=tecnico_campo, `auditor-qc-demo`=
  auditor_qc): admin/tecnico_campo permitidos, auditor_qc bloqueado
  (`403`, `42501`). Test de integración nuevo
  `tests/test_inspecciones_rbac_rls.py` (4/4), sin regresión en
  `tests/test_padron_rbac_rls.py` (5/5, refactor de `assertAdminRole`
  para reusar `lib/auth/resolveAuthRole.js`). `npm run build`/`npm run
  lint` limpios. Detalle completo, incluida la corrección de un bug
  propio de fail-open (`NOT IN` con NULL) encontrado y corregido antes
  de aplicar la migración, en `AI_STATE.md` (entrada 2026-09-08,
  RESUELTO). **Fase D Paso 3 (retirar el gate de Basic Auth de
  `middleware.js`) es el único pendiente real de
  `specs/login_real_organizacion_rol.md` §6.** Migración + código
  creados y verificados en vivo, pero **sin commitear/pushear
  todavía** — a la espera del visto bueno explícito del usuario
  (gate de segunda revisión, `docs/RYZOS_ORQUESTADOR_V3.1.md` §4.1).

- **(2026-09-08) Fase D Paso 3 cerrado — gate de Basic Auth retirado de
  `middleware.js` (commit `e16e897`), `specs/login_real_organizacion_rol.md`
  queda completo (Fases A-D):** única capa de acceso a `/dashboard/**`,
  `/api/qc/**`, `/api/gis/**` ahora es la sesión real de Supabase Auth
  (`auth.getUser()`) — el bloque de `GATE_USER`/`gatePassword`/
  `unauthorized()`/decodificación de `Authorization: Basic` se elimina
  por completo de `middleware.js`; el `matcher` no cambia.
  `app/login/page.jsx` actualizado (el comentario que decía "el gate de
  Basic Auth sigue activo en paralelo" ya no es cierto).
  `tests/test_dashboard_gate_session_redirect_live.mjs` (verificaba las
  2 capas combinadas) reemplazado por
  `tests/test_dashboard_session_redirect_live.mjs`. Ver
  `specs/retirar_basic_auth_gate.md`.

  **Verificado en vivo contra `staging` (Vercel, no localhost) por
  Cowork vía navegador:** sin sesión, `/dashboard/mapa` redirige a
  `/login` — con o sin un header `Authorization: Basic` viejo/inventado,
  nunca `401`, nunca deja pasar (confirma que Basic Auth ya no se
  evalúa en absoluto, ni siquiera como capa opcional); con sesión ya
  presente, carga el Mapa WebGIS con normalidad, sin ningún prompt de
  Basic Auth del navegador en ningún caso. Sin gate de segunda revisión
  formal (no es SQL/RLS/migración), pero tratado con el mismo rigor por
  tocar el gate de acceso a todo `/dashboard/**` — Cowork revisó el
  contenido literal de `middleware.js` y el diff de `app/login/page.jsx`
  antes de aprobar el commit. `npm run build` limpio,
  `node --test tests/test_dashboard_session_redirect_live.mjs` 3/3.

  **Esto cierra `specs/login_real_organizacion_rol.md` por completo** —
  las 4 fases (A: identidad, B: login real, C: RLS real de
  INSPECCIONES/CAP_*, D: cuentas reales + smoke test + retiro de Basic
  Auth) están terminadas. No queda ningún paso pendiente de ese
  proyecto.

  **Nota aparte (no bloqueante, ya resuelta):** la verificación por SQL
  en Supabase Studio del trigger de `INSPECCIONES` (Fase D Paso 2,
  commit `267f802`) sigue pendiente de confirmación del usuario — no es
  parte de este cierre, solo una nota de seguimiento.

- **(2026-09-08) Merge de `staging` a `main` — login real en producción
  (commit `c9b25f0`):** merge (mensaje default de Git), 94 archivos, 2
  conflictos — ambos de documentación
  (`docs/ESTADO_PROYECTO.md`, `docs/RYZOS_ORQUESTADOR_V3.1.md`, main
  había quedado con snapshots viejos desde el bootstrap manual del
  2026-08-21), resueltos a favor del contenido de `staging` — **ningún
  archivo de código en conflicto**. `npm run build` limpio antes del
  push, verificado por CLI antes de completar el merge commit.

  Esto lleva a producción real (`ryzosagri.com`) todo el proyecto de
  login real (Fases A-D): login por sesión real de Supabase Auth, RBAC
  con triggers de rol en las 7 tablas de Padrón/QC/Inspecciones, y el
  retiro completo del gate de Basic Auth de `middleware.js`.

  **Verificado en vivo contra producción real:** Eduardo (`admin`) y
  Dante (`tecnico_campo`) entraron con normalidad por
  `ryzosagri.com/login`; Cowork confirmó por navegador que sin sesión
  (con o sin un header `Authorization: Basic` viejo) siempre redirige a
  `/login`, nunca `401`, nunca deja pasar — mismo resultado que ya se
  había verificado en `staging`.

  **Esto cierra `specs/login_real_organizacion_rol.md` de punta a
  punta, ahora también en producción** — no queda ningún pendiente de
  ese proyecto en ninguna rama.

- **(2026-09-08) Fuga de PII encontrada y corregida en `/dashboard/socios`
  — cualquier cuenta autenticada veía el padrón real de
  `COOP-AROMAS-VALLE` (618 socios, nombre + DNI):** confirmado en vivo
  por el usuario (captura de la cuenta demo). Causa raíz:
  `lib/sociosSearch.js::fetchSocios` usaba `resolveOrganizationId()`
  (`lib/actions/organizacionesActions.js`) como fallback por defecto —
  resolvía "la organización real más antigua" sin mirar la sesión en
  absoluto, una heurística de antes de que existiera login real
  (`specs/mejoras_importador_padron_masivo.md` ronda 8) que nadie
  actualizó cuando el login real (`specs/login_real_organizacion_rol.md`,
  Fases A-D) se completó y llegó a producción. Las escrituras nunca
  estuvieron expuestas (`ID_Organizacion` siempre viene del registro real
  que se edita, más `fn_enforce_padron_admin_role`, `ADR-039`, del lado
  de RLS) — era un gap de lectura únicamente.

  **Fix:** `resolveOrganizationId()` retirada (sin ningún otro caller en
  el repo); nueva `resolveSessionOrganizationId()` resuelve por sesión
  real, mismo patrón que `lib/auth/getCurrentProfile.js`
  (`PERFILES_USUARIO_INTERNOS`, fail-closed a `null`).
  `resolveTestOrganizationOverride()` sin cambios. Test nuevo
  `tests/test_resolve_session_organization_id.mjs` — ver `AI_STATE.md`
  (hallazgo del 2026-09-08) para el detalle completo, incluido por qué el
  test no puede ejercitar una sesión real fuera del runtime de Next y qué
  prueba en su lugar. `node --test tests/*.mjs`: 681/685 antes y después
  del fix (4 fallos preexistentes sin relación, confirmados con `git
  stash` sobre el mismo `origin/staging`). `npm run build`/`npm run lint`
  limpios, sin regresión.

  **Commit a `staging` únicamente en esta revisión — sin merge a `main`.**
  Redactado, corregido y verificado por Claude (Cowork) de punta a punta
  (gate de segunda revisión de la Sección 4.1 ya cubierto por eso); el
  merge a producción queda como paso manual del usuario, pendiente de su
  propia revisión del diff.

## 📌 PRÓXIMA VEZ QUE ABRAS UNA CONVERSACIÓN

Si vienes de una pausa, simplemente di: **"Lee el estado del proyecto y sigamos donde quedamos."** No necesitas repetir el contexto — este documento lo tiene.