# ESTADO DEL PROYECTO RYZOS
*Última actualización: 4 de septiembre, 2026*

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

## 📌 PRÓXIMA VEZ QUE ABRAS UNA CONVERSACIÓN

Si vienes de una pausa, simplemente di: **"Lee el estado del proyecto y sigamos donde quedamos."** No necesitas repetir el contexto — este documento lo tiene.