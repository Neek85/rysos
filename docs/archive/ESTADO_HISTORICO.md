# ESTADO_HISTORICO.md

> Archivo histórico de `docs/ESTADO_PROYECTO.md` — hitos ya cerrados,
> movidos acá en la rotación de 2026-09-04 (ver `CLAUDE.md`, sección
> de economía de tokens). No se lee por defecto — consultar solo si
> hace falta el detalle histórico completo de un hito específico ya
> cerrado.

---

- Configurar el "lugar fijo" (Proyecto de Claude) para dejar de copiar y pegar el prompt orquestador en cada conversación.
- Definir la primera tarea real para probar el flujo completo (idealmente algo pequeño y visible, para validar que el proceso funciona antes de tareas grandes).
- **(2026-08-21) Consola QC (`/dashboard/qc`):** reordenado el layout a 3 columnas (lista | mapa | panel de edición fijo, sin scroll de página). Se encontró y arregló un bug real que dejaba **inoperables** las 4 acciones de escritura de la consola (Aprobar/Rechazar/Guardar Atributos/Guardar Geometría) desde que se construyó — las políticas RLS de `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` son solo `TO authenticated`, pero el frontend nunca autentica (usa la llave `anon`), así que todo `UPDATE` afectaba 0 filas siempre. Fix: Server Actions + Service Role Key (`lib/actions/qcActions.js`), mismo patrón que el Padrón — ver `docs/adr/ADR-003-consola-qc-server-actions-escritura.md`. Confirmado en vivo contra la base real (escritura + limpieza de un campo de prueba).
- **Pendiente, fuera de este repo:** aplicar manualmente `supabase/migrations/20260820_fn_validar_topologia_eudr.sql` en Supabase Studio SQL Editor — la función `fn_validar_topologia_eudr` existe en el código desde la tarea anterior pero nunca se aplicó a la instancia real (confirmado reproduciendo el error "Could not find the function..." en vivo). Hasta que se aplique, "Ejecutar Test Espacial" seguirá fallando.
- **(2026-08-21) Consola QC — capa de contexto de parcelas vecinas (Fase 3):** nueva capa informativa en el mapa (Monitoreos EUDR APROBADOS dentro de un radio configurable, 500m por defecto) con toggle on/off, ver `docs/adr/ADR-006-capa-contexto-parcelas-vecinas.md`. **Pendiente, fuera de este repo:** aplicar `supabase/migrations/20260821_221221_fn_parcelas_vecinas_eudr.sql` — hasta entonces la capa queda visible pero sin datos (fallo silencioso ya verificado como no disruptivo). **Tarea diferida a propósito (pedido explícito del prompt, no un olvido):** no existe pantalla de administración para que un admin configure el radio por organización (`ORGANIZACIONES.Config.gis.radio_contexto_vecinos_m`) — hoy solo se edita a mano en la base, si hiciera falta. Si se necesita esa UI, es una tarea nueva, no se debe asumir que ya existe.
- **(2026-08-21 a 23) Refuerzo de la Consola QC — resumen completo en un documento aparte:** bugs reales corregidos (colisión de herramientas de dibujo, popup con nombre técnico expuesto, solapamiento no auditable), mejoras nuevas (panel de info en vivo, capa de parcelas vecinas, exclusión de contención propia en el solapamiento), el incidente de datos de prueba huérfanos (`ORG-COOP-NORTE`) y las protecciones agregadas, y el fix del mensaje de error de la sincronización de Google Drive — ver **[docs/bitacora/2026-08-21_hardening-consola-qc.md](bitacora/2026-08-21_hardening-consola-qc.md)** (escrito para alguien que no programa, con enlaces a cada ADR técnico y commit).
- **(2026-08-25) Certificaciones normalizadas — 5 tablas nuevas:**
  `CERTIFICACIONES_CATALOGO`, `AGENCIAS_CERTIFICADORAS`,
  `ORGANIZACION_CERTIFICACIONES`, `SOCIO_CERTIFICACIONES`,
  `PARCELA_CERTIFICACIONES` reemplazan los 8 flags planos que vivían
  como columnas sueltas de `PADRON_SOCIOS` (esas columnas viejas **no**
  se borraron — quedan congeladas como respaldo, para no tener que
  recrear las 3 vistas que aún dependen de ellas). RLS/GRANTs replican el
  patrón ya usado en `PADRON_SOCIOS`/`PADRON_PARCELAS`. Ver
  [ADR-027](adr/ADR-027-certificaciones-normalizadas.md) y
  `specs/padron_certificaciones_normalizado.md` — commits `470de58`
  (migración + código) y `73304cb` (2 gaps de cobertura de tests
  cerrados tras la verificación post-migración: aislamiento multi-tenant
  en las 3 tablas org-scoped y el chequeo automatizado del backfill de
  `estado_organico`).
- **(2026-08-26) Multi-producto café/cacao:** 2 tablas nuevas
  (`PRODUCTOS`, catálogo con 2 filas semilla CAFE/CACAO;
  `ORGANIZACION_PRODUCTOS`, membresía N-a-N) y `id_producto_predominante`
  agregado en 2 lugares con roles distintos — `PADRON_PARCELAS` (dato
  maestro editable, con backfill obligatorio a CAFE) y
  `EUDR_USO_SUELO` (una foto por evento de monitoreo, poblada por un
  trigger `BEFORE INSERT` que nunca bloquea el `INSERT` aunque la cadena
  de resolución falle). `ParcelaFormModal.jsx` gana un `<select>` nuevo
  para elegir el producto de la parcela, y `lib/eudrDdsExporter.js`
  agrega `producto_codigo`/`producto_nombre` al paquete de trazabilidad
  exportado. Ver [ADR-028](adr/ADR-028-multi-producto-cafe-cacao.md) y
  `specs/multi_producto_cafe_cacao.md` §8 — migración
  `20260826120000_multi_producto_cafe_cacao.sql`, commit `4568bee`
  (implementación); `520436d`/`0064091` cerraron el paso 4 arreglando
  tests Live que no creaban la fila `ORGANIZACIONES` requerida por una FK
  real antes de insertar (`23503`).
- **(2026-08-26) Bug de `postgrest-py` en tests de GIS, causa raíz real
  encontrada:** el `22P02` (`invalid input syntax for type bigint:
  "None"`) que bloqueaba 2 tests de `TestGisSanitizationLive` no era un
  bug de la librería ni del trigger de sanitización (que funcionaba
  bien) — era el `DELETE` de limpieza de cada test, que filtraba
  `.eq("fid", row["fid"])` con `fid` en `NULL` (columna sin `DEFAULT`,
  siempre `NULL` en un `INSERT` manual de test). `postgrest-py`
  serializa ese filtro literal a `fid=eq.None`, que Postgres rechaza.
  Fix: filtrar por `id` (la PK real) en vez de `fid`. Commit `1a5bc19`
  (causa raíz confirmada capturando la request HTTP real, no una
  hipótesis) — ver `AI_STATE.md` para el detalle completo.
- **(2026-08-26) Fix del GUID de QField mal etiquetado como
  `"ID_Parcela_Fija"`:** `vw_monitoreo_poligonos`/`vw_monitoreo_puntos`
  exponían, para filas de `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`, el GUID
  crudo que QField genera para el `EUDR_MONITOREO` padre en vez del
  código real de parcela — invisible en el Dashboard (que ya tenía un
  guard defensivo) pero no en `lib/eudrDdsExporter.js`: producía "plots
  fantasma" (6 en vez de 3 para las filas reales de `ORG-TEST-E2E`).
  Fix: `LEFT JOIN LATERAL` contra `EUDR_MONITOREO` vía
  `qfield_relation_id`, con desempate determinístico de 2 niveles
  (`fecha_monitoreo DESC NULLS LAST, creado_en DESC`) ante un duplicado
  real confirmado — mismo criterio aplicado también al trigger del paso
  4 y (agregado el mismo día, confirmado explícitamente por el usuario)
  al `LATERAL` que resuelve `productor` en `vw_monitoreo_web`. Verificado
  contra la instancia real ya migrada: los "plots fantasma" bajaron de 6
  a 3 tal como se predijo, y se confirmó en vivo un `UNIQUE` real en
  `EUDR_MONITOREO` (`"ID_Organizacion", "ID_Parcela_Fija",
  fecha_monitoreo`) no documentado en ninguna migración — ver
  `docs/schema_live.md`. Ver [ADR-029](adr/ADR-029-fix-guid-qfield-id-parcela-fija.md)
  (su "Estado" quedó desactualizado — dice "sin implementar" y
  "`vw_monitoreo_web` no se toca", ambos ya no ciertos; pendiente de
  amendar) y `specs/fix_id_parcela_fija_guid_qfield.md` — migración
  `20260826140000_fix_id_parcela_fija_guid_qfield.sql`, commits
  `0d07138` (implementación), `e772844` (doc del `UNIQUE`), `ef60c35`
  (fix de un bug del propio test de verificación, no de la vista).

---

- **(2026-08-27) Primera organización real del sistema creada:**
  `COOP-AROMAS-VALLE` (COOPERATIVA AGRARIA AROMAS DEL VALLE), aplicada
  directamente en Supabase (alta de dato, no de esquema — no fue una
  migración) y vinculada a Café en `ORGANIZACION_PRODUCTOS`. El
  procedimiento quedó documentado como runbook repetible en
  `specs/alta_organizacion_real.md`, con la convención de código
  (`TIPO-SLUG`) fijada en
  [ADR-030](adr/ADR-030-convencion-codigo-organizaciones.md).

- **(2026-09-01) Incidente de seguridad real cerrado — lectura de
  `PADRON_SOCIOS`/`PADRON_PARCELAS` sin aislamiento vía la llave `anon`
  pública:** una política RLS agregada el 2026-08-18 para el
  autocompletado de Inspecciones (`USING ("ID_Organizacion" IS NOT
  NULL)`) resultó ser, en la práctica, sin ninguna restricción real —
  cualquiera con la llave `anon` (pública por diseño, embebida en el
  sitio) podía leer el padrón completo de **cualquier** organización sin
  sesión. Confirmado en vivo antes de corregir: 618 socios reales de
  `COOP-AROMAS-VALLE` alcanzables (DNI, nombre, celular incluidos), no
  una hipótesis. Cerrado bloqueando esa lectura directa (`USING
  (false)`) y reemplazando los 6 caminos reales del código que dependían
  de ella (listado de socios, parcelas por socio, autocompletado de
  Inspecciones y de la Consola QC, importador masivo, enriquecimiento de
  parcela en QC) por 10 funciones `SECURITY DEFINER` parametrizadas por
  organización, con `REVOKE`/`GRANT EXECUTE` explícito a `service_role`
  únicamente desde el día uno. Verificado end-to-end contra producción
  (686/686 tests, 6/6 tests de aislamiento cruzado real, verificación
  manual en `/dashboard/socios`). Ver
  [ADR-031](adr/ADR-031-lecturas-padron-security-definer.md). **Fase 2
  del mismo incidente, ya dimensionada pero sin aplicar:**
  `INSPECCIONES`/`CAP_*` tienen el mismo defecto de política (más
  severo — incluye escritura y borrado), con migraciones de contención
  preparadas y esperando revisión antes de aplicarse — el contenido real
  expuesto ahí hoy es mínimo (2 filas sin datos sensibles), a diferencia
  del caso de `PADRON_SOCIOS`.

- **(2026-09-01) Fase 1b del mismo incidente — exportación CSV del
  padrón restaurada:** el lockdown de arriba dejó `exportSociosCsv`/
  `exportParcelasCsv` (`/dashboard/socios`) devolviendo un CSV vacío —
  esas 2 funciones no estaban entre los 6 caminos reemplazados en la
  primera ronda. Cerrado con el mismo patrón (`fn_exportar_padron_socios`/
  `fn_exportar_padron_parcelas`, `SECURITY DEFINER` + `REVOKE`/`GRANT
  EXECUTE` a `service_role` únicamente), sin parámetros de filtro
  (confirmado que ninguna de las 2 funciones originales respetaba
  ningún filtro de la UI — siempre exportaban el padrón activo completo).
  Verificado end-to-end: 12/12 tests de aislamiento cruzado real, 692/692
  de la suite completa, y verificación manual real — los 2 CSV
  descargados desde `/dashboard/socios` confirmados con 618 socios / 821
  parcelas, ambos con `ID_Organizacion = COOP-AROMAS-VALLE` únicamente,
  0 IDs duplicados. Ver [ADR-031](adr/ADR-031-lecturas-padron-security-definer.md).

- **(2026-09-02) Fix certificaciones desactualizadas en /dashboard/socios
  (modal, listado y filtros):** El modal de edición de socio, la columna
  "CERTIFICACIÓN" del listado y sus 2 filtros (`p_cert_org_estatus`,
  `p_cert_flags`) leían las columnas `cert_*`/`cert_org_estatus` de
  `PADRON_SOCIOS`, congeladas desde ADR-027 y sin escritura desde la
  normalización a `SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO` —
  ningún consumidor se había migrado a leer del catálogo real. Cerrado en
  2 partes: `resolveSocioCertFlags` (`lib/actions/sociosActions.js`)
  resuelve en vivo los 8 flags (presencia de fila, sin importar `estado`)
  y `cert_org_estatus` (misma certificación más reciente que ya usaba
  `fetchSocioCertOrgEstatus`) para el modal; `fn_listar_padron_socios`
  reescrita (`20260901180000_fix_cert_org_estatus_listado.sql`,
  `SECURITY DEFINER`, con rollback preparado antes de aplicar y aplicada
  manualmente en Supabase Studio) para exponer los mismos valores reales
  en el listado y filtros, vía 2 `LEFT JOIN LATERAL`. Verificado con
  12/12 tests live (incluye `EXECUTE` revocado para `anon`), valores
  exactos confirmados contra un caso real (`COOP-AROMAS-VALLE-002`),
  filtro de certificación probado en positivo y negativo, build limpio,
  692/692 suite completa, y confirmación visual manual en pantalla.
  Commit `097648a`. Ver [ADR-031](adr/ADR-031-lecturas-padron-security-definer.md).

- **(2026-09-02) Gate temporal de contraseña compartida para
  `/dashboard/**` (preparación para desplegar en Vercel):** mientras se
  diseña el login real por organización/rol (proyecto aparte),
  `middleware.js` nuevo exige HTTP Basic Auth (usuario fijo `ryzos` +
  contraseña desde `DASHBOARD_GATE_PASSWORD`, variable nueva requerida
  en Production/Preview de Vercel) sobre `/dashboard/**` y las rutas
  internas de `/api/qc/**`/`/api/gis/**` que las respaldan.
  `/trace/[lot_hash]`/`/api/trace/**` (portal público de trazabilidad)
  quedan explícitamente fuera del gate. Fail-closed: sin la variable de
  entorno definida, bloquea con 401 en vez de dejar pasar sin
  contraseña. Verificado: `npm run build` compila limpio con el
  middleware incluido en el bundle, `npm run lint` sin hallazgos nuevos.
  `vercel.json` (cabeceras de seguridad + `framework: "nextjs"`) ya
  existía de una preparación anterior y ya cumple
  `specs/despliegue_vercel.md`. **Hallazgo colateral, pendiente de
  decisión, no bloqueante:** `lib/traceabilityHash.js`/
  `scripts/generate_lot_qr.py` generan el `lot_hash` público con
  SHA-256 plano, sin HMAC ni salt por organización — contradice el
  invariante documentado en `CLAUDE.md`/
  [RYZOS_ORQUESTADOR_V3.1.md](RYZOS_ORQUESTADOR_V3.1.md) §1. No es
  explotable hoy porque ningún campo PII entra al hash (la sanitización
  real de PII es un mecanismo aparte), pero queda pendiente decidir si
  se implementa el HMAC+salt real o se corrige la documentación.

- **(2026-09-02) Login real por organización y rol — Fase A (capa de
  identidad), diseñada y lista para revisión, NO aplicada todavía:**
  primer paso de `specs/login_real_organizacion_rol.md` — un proyecto
  que además fusiona la Fase 2 (pausada) del incidente de seguridad de
  `PADRON_SOCIOS`/`PADRON_PARCELAS`: cerrar RLS real de
  `INSPECCIONES`/6 `CAP_*` estaba bloqueado exactamente por no existir
  sesión `authenticated` real, así que este proyecto la desbloquea.
  Migración nueva (`20260902213506_login_fase_a_identidad.sql`): tabla
  `PERFILES_USUARIO_INTERNOS` (vincula `auth.users` con organización +
  rol `admin`/`tecnico_campo`/`auditor_qc`, sin escritura para
  `authenticated` — el aprovisionamiento de cuentas es Fase D, server-side
  con Service Role Key), función nueva `auth_role()` y `auth_org_id()`
  redefinida (mismo nombre/firma) para resolver la organización desde el
  perfil en vez de un claim JWT que nunca se puebla. **Inerte en
  comportamiento hoy** — nadie tiene sesión real todavía, confirmado por
  diseño y verificado en vivo (`auth_org_id()` sigue devolviendo `null`).
  5 tests nuevos de aislamiento (`tests/test_login_fase_a_identidad_live.mjs`)
  con usuarios reales de prueba creados/borrados vía la Admin API de
  Supabase Auth (capacidad confirmada en vivo antes de escribir el
  test) — se saltan hasta que se aplique la migración, mismo patrón que
  el resto de tests Live de esta sesión. `npm run build`/`npm run lint`
  limpios (0 cambios en `app/`/`components/`/`lib/actions/`,
  `middleware.js` sin tocar). Esta tarea se hizo con Claude desde el
  principio — el gate de segunda revisión del protocolo multi-IA
  ([RYZOS_ORQUESTADOR_V3.1.md](RYZOS_ORQUESTADOR_V3.1.md) §4.1) ya queda
  cubierto en este mismo flujo, no requiere una revisión aparte.
  **Hallazgo colateral, no causado por esta tarea:** al correr la suite
  completa se encontraron 5 tests preexistentes fallando por un cambio
  de fin de línea (`LF` → `CRLF`) en sus archivos objetivo, efecto
  colateral de `core.autocrlf=true` al cambiar de rama en la tarea
  anterior — el código real de esos 5 archivos está intacto, sin
  relación con este cambio; ver `AI_STATE.md` para el detalle completo,
  no se tocó nada de eso acá.

- **(2026-09-03) Login real en la web — Fase B (login real,
  implementado y verificado en vivo):** pantalla `/login`
  (email+contraseña, Supabase Auth real) + `middleware.js` **extendido**
  (no reemplazado) para exigir, además del gate de contraseña
  compartida ya activo, una sesión real validada con `auth.getUser()`
  (nunca `getSession()` sin validar) — sin sesión, redirige a
  `/login?next=<ruta original>` en vez de dejar pasar. Basic Auth sigue
  activo en paralelo sobre las mismas rutas
  (`/dashboard/**`/`/api/qc/**`/`/api/gis/**`) — se retira recién en
  Fase D, después de verificar todo end-to-end. `/trace/[lot_hash]`/
  `/api/trace/**` siguen totalmente públicos, sin cambios. Clientes
  nuevos con nombre claro para no confundirse con el cliente de Service
  Role Key existente: `lib/supabase/browserClient.js`/
  `lib/supabase/sessionServerClient.js` (sesión real, respetan RLS).
  Logout real con botón visible en el sidebar de `/dashboard/*`
  (`lib/actions/authActions.js` + `components/layout/DashboardSidebar.jsx`).
  Verificado con un test HTTP real contra el dev server (Basic Auth
  correcto sin sesión → 307 a `/login`, confirmado 2/2) y build/lint
  limpios (`/login` aparece como ruta nueva, `ƒ Middleware` creció de
  26.7 kB a 89.9 kB al empaquetar `@supabase/ssr`, mismos 8 warnings
  preexistentes). Sin cambios en `INSPECCIONES`/`CAP_*` (Fase C) ni
  aprovisionamiento de cuentas reales (Fase D) — fuera de alcance.

  **Smoke test manual pendiente de confirmación (cuenta descartable ya
  creada y ACTIVA, en `ORG-TEST-DEMO`):**
  - Usuario: `smoketest-fase-b@ryzos-test.invalid` — Contraseña:
    `RyzosSmokeTest-FaseB-2026!` — perfil `admin` en `ORG-TEST-DEMO`.
  - **(a)** Entrar a `/dashboard/socios` en el navegador (con la
    contraseña de Basic Auth cuando la pida) sin haber iniciado sesión
    todavía → debe redirigir a `/login`.
  - **(b)** Loguearse en `/login` con el usuario/contraseña de arriba →
    debe llevar directo a `/dashboard/socios` sin pedir nada más.
  - **(c)** Click en "Cerrar sesión" (sidebar) y volver a entrar a
    `/dashboard/socios` → debe volver a redirigir a `/login`.
  - **Borrar la cuenta al terminar de probar** (Supabase Studio → Authentication
    → buscar `smoketest-fase-b@ryzos-test.invalid` → Delete user — el
    `ON DELETE CASCADE` de `PERFILES_USUARIO_INTERNOS.user_id` borra el
    perfil solo).

- **(2026-09-03) Login real — Fase C Paso 1 (cliente de sesión en
  INSPECCIONES/CAP_*) verificado en vivo, y bug preexistente encontrado
  (Paso 1.5, fix listo, sin aplicar):** los 3 puntos reales donde el
  módulo de Inspecciones llama a Supabase pasaron del cliente `anon` al
  cliente de sesión real de la Fase B — verificado en vivo que la
  lectura no cambió en nada (todavía sin RLS nuevo, eso es Paso 2).
  Durante esa verificación apareció un bug **preexistente, sin relación
  con el login**: crear una inspección nueva siempre fallaba
  (`fn_guardar_inspeccion_completa()`, creada en agosto, compara un
  `uuid` contra la columna real `"ID_Inspeccion"` que es `text` —
  mismatch de tipos que Postgres rechaza). Confirmado que también falla
  igual con la llave `anon` pura (no es cosa del login) y que no deja
  ningún dato a medio guardar (la función revierte todo automáticamente
  ante el error). Migración de fix ya escrita
  (`supabase/migrations/20260903045407_fix_tipo_id_inspeccion.sql`,
  cambia esos 2 campos de `uuid` a `text`, nada más) —
  **pendiente de tu revisión y aplicación manual en Supabase Studio**,
  igual que toda migración de este proyecto. Ver `AI_STATE.md`
  (`2026-09-03b`) para el detalle técnico completo y los pasos de
  verificación manual preparados para después de aplicarla.

- **(2026-09-03) Login real — Fase D Paso 1 (aprovisionamiento de
  cuentas) corrido en vivo:** script nuevo
  (`scripts/provision_login_accounts.mjs`, corrida manual, con Service
  Role Key) creó/vinculó las **5 cuentas de login** previstas: las 2
  reales de `COOP-AROMAS-VALLE` (invitadas por email, pendientes de que
  cada persona acepte la invitación) y las 3 demo de `ORG-TEST-DEMO`
  (una por rol: `admin`, `tecnico_campo`, `auditor_qc`). Cada una quedó
  vinculada a su fila en `PERFILES_USUARIO_INTERNOS` con la
  organización y el rol correctos — confirmado con una consulta de
  solo lectura aparte, no solo con la salida del script. Las 3
  contraseñas demo generadas se entregaron fuera de este documento
  (directamente en el chat) — **no quedaron guardadas en ningún archivo
  del repositorio.** `middleware.js` no se tocó — el gate de Basic Auth
  sigue activo. Pendiente (Paso 2/3 de esta fase, no arrancado
  todavía): probar cada cuenta contra las 5 pantallas de la matriz de
  permisos y el aislamiento cross-org, y solo después de eso, retirar
  el gate de Basic Auth. Ver `AI_STATE.md` (`2026-09-03c`) para el
  detalle completo.

- **(2026-09-03) ADR-032 aplicado en vivo — limpieza de 8 políticas RLS
  huérfanas en español (`INSPECCIONES` + las 6 `CAP_*`):** confirmado
  antes de tocar nada (query en vivo a `pg_policies`) que las 8 políticas
  ("Permitir edicion desde el panel web", "Permitir lectura al panel
  web", "Permitir web SOCIO", "Permitir web MIC" x5) eran redundantes con
  las oficiales `rls_anon_all_*` ya vigentes — no cerraban ni abrían
  ningún acceso real. Aplicada la migración
  (`supabase/migrations/20260903064952_limpieza_drift_rls_policies_espanol.sql`)
  vía `supabase db query --linked` (SQL directo contra la base real, sin
  usar `supabase db push` — ese comando habría intentado re-aplicar las
  43 migraciones del historial completo, no solo esta, porque la tabla
  de tracking del CLI está vacía aunque casi todas ya estén aplicadas a
  mano en Studio). Verificado en vivo después: las 8 desaparecieron, las
  7 oficiales quedaron idénticas carácter por carácter. `npm run build`
  limpio. Ver [ADR-032](adr/ADR-032-limpieza-drift-rls-espanol.md) y
  `AI_STATE.md` (`2026-09-03d`) para el detalle completo, incluidos los
  2 pendientes que quedan fuera de alcance a propósito (drift EUDR/PADRON
  en las 5 tablas, y el endurecimiento real de `anon` en
  INSPECCIONES/CAP_*, bloqueado por `fn_guardar_inspeccion_completa` no
  ser `SECURITY DEFINER`).

- **(2026-09-03) Fix uuid/text de `fn_guardar_inspeccion_completa`
  verificado funcionalmente — con 2 hallazgos importantes:** al intentar
  aplicar `supabase/migrations/20260903045407_fix_tipo_id_inspeccion.sql`
  contra la instancia real, se descubrió que **ya estaba aplicada**
  (probablemente a mano en Supabase Studio, en algún momento fuera de
  esta serie de conversaciones — no hay forma de confirmar quién ni
  cuándo). Confirmado contra `pg_proc`/grants reales: la función ya
  tiene `p_id text`/`v_id text` y los mismos permisos que la migración
  buscaba dejar. Verificación funcional igual completa contra una fila
  descartable en `ORG-TEST-DEMO` (vía RPC real, misma llave `anon` que
  reprodujo el bug original): **creación exitosa** (antes fallaba
  siempre con `42883`), **edición exitosa** (confirmado que el cambio
  persistió), **limpieza sin residuo** (0 filas en `INSPECCIONES` y las
  6 `CAP_*` para esa fila de prueba, verificado después). `npm run
  build` limpio.
  **Hallazgo aparte — investigación de RLS ya cerrada, sigue pendiente
  la causa de fondo:** el paso de verificación pedía confirmar que 2
  filas legacy de `COOP-JS` en `INSPECCIONES` seguían intactas.
  `INSPECCIONES` está completamente vacía (0 filas) — no había nada que
  verificar. **Se descartó que fuera un artefacto de RLS/rol:**
  reconfirmado con Service Role Key vía REST (bypass total de RLS,
  mismo resultado: 0 filas) y con `pg_policies` sobre `INSPECCIONES`
  (sin cambios desde ADR-032, solo `rls_anon_all_inspecciones`, ninguna
  de las 2 migraciones de contención sin aplicar
  `20260901150000`/`20260901150100` apareció aplicada por fuera de esta
  sesión). **El vacío es real a nivel de dato, no de acceso.** La causa
  de fondo (cuándo/por qué desaparecieron esas 2 filas) sigue sin
  resolver — fuera del alcance de este entorno, que no tiene acceso a
  backups ni a logs de Supabase. **Pendiente de que el arquitecto
  revise directamente en Supabase Studio:** Point-in-Time Recovery (si
  el plan lo tiene habilitado) y Database → Logs — ninguna acción desde
  acá puede sustituir eso. No bloquea ningún trabajo de código/RLS en
  curso, incluida la Fase C Paso 2. Ver `AI_STATE.md` (`2026-09-03f` y
  `2026-09-03g`) para el detalle completo.

- **(2026-09-03) Fase C Paso 2 — ADR-033 aplicado en vivo: aislamiento
  real por organización en `INSPECCIONES` + las 6 `CAP_*`, `anon`
  cerrado por completo:** aplicada
  `supabase/migrations/20260903170404_fase_c_paso2_rls_real_inspecciones_cap.sql`
  -- cada una de las 7 tablas pasó de una única política combinada
  `anon`+`authenticated` sin aislamiento real (`IS NOT NULL`/`true`) a 2
  políticas separadas: `anon` deniega todo, `authenticated` exige que la
  fila pertenezca a la organización real de la sesión
  (`auth_org_id()`). **Verificado en vivo, no solo por diseño:** `anon`
  ahora recibe `401`/`42501` al intentar guardar (confirmado además que
  el `SELECT` de `anon` sigue en 0 aun con una fila real presente,
  insertada aparte para descartar que fuera solo tabla vacía);
  `authenticated`, con una sesión real obtenida vía magic link
  (Admin API, sin tocar la contraseña de la cuenta demo), creó y editó
  una inspección de prueba en `ORG-TEST-DEMO` sin problema. Fila de
  prueba limpiada, `INSPECCIONES` vuelve a 0. `npm run build` limpio.
  Las 2 migraciones de contención de emergencia que este diseño
  reemplaza (`20260901150000`/`20260901150100`) se movieron a
  `supabase/migrations/archivadas/` (con un `README.md` explicando por
  qué, y por qué no deben aplicarse nunca — colisión de nombres de
  política). **Pendiente, ya trackeado aparte, no bloqueante para este
  cierre:** `resolveOrganizationId()` en `lib/inspeccionesActions.js`
  sigue derivando la organización de filas ya cargadas en vez de la
  sesión real — el flujo de creación real desde el navegador sigue roto
  por esa razón (independiente de RLS) mientras `INSPECCIONES` esté
  vacía. Ver [ADR-033](adr/ADR-033-fase-c-paso2-rls-real-inspecciones-cap.md)
  y `AI_STATE.md` (`2026-09-03h`) para el detalle completo.

- **(2026-09-03) Task 16 — fix de resolución de organización activa en
  Inspecciones (cierra el pendiente de ADR-033):**
  `useInspeccionForm.js` derivaba `organizationId` mirando filas ya
  cargadas de `INSPECCIONES` (`resolveOrganizationId(rows)`) — con la
  tabla vacía eso siempre daba `null` y bloqueaba la creación/edición
  real antes de cualquier llamada de red, sin relación con RLS. Ahora
  `organizationId` se resuelve con `supabase.rpc('auth_org_id')` al
  cargar el formulario — la misma función que las políticas RLS de
  ADR-033 usan como autoridad, un solo origen de verdad entre lo que el
  cliente cree y lo que el servidor exige. Si `auth_org_id()` devuelve
  `null` (perfil inactivo/inconsistente), el formulario corta temprano
  con un mensaje específico en vez de cargar y fallar después.
  **Hallazgo de esta tarea:** confirmado, línea por línea contra el
  cuerpo real de `fn_guardar_inspeccion_completa`, que esa función NO
  valida `p_organizacion` contra la sesión — es `SECURITY INVOKER` y
  solo compara sus 2 parámetros entre sí; la autoridad real es el RLS de
  ADR-033. El docstring de `saveInspeccion()` (que afirmaba lo
  contrario) se corrigió para reflejarlo — sin tocar la lógica.
  `fn_guardar_inspeccion_completa` no se tocó, a propósito. **Verificado
  en vivo:** con una sesión real (magic link), `auth_org_id` devolvió
  `ORG-TEST-DEMO`, y con ese valor la creación y edición de una
  inspección de prueba funcionaron de punta a punta — fila limpiada al
  terminar. `npm run build` limpio. Ver
  `specs/fix_resolucion_organizacion_inspecciones.md`,
  `plans/fix_resolucion_organizacion_inspecciones_ejecucion.md` y
  `AI_STATE.md` (`2026-09-03i`) para el detalle completo.

- **(2026-09-03) Task 10 — ADR-034 aplicado en vivo: limpieza de drift
  RLS en las 5 tablas EUDR/PADRON (`EUDR_MONITOREO`,
  `EUDR_INSTALACIONES`, `EUDR_USO_SUELO`, `PADRON_SOCIOS`,
  `PADRON_PARCELAS`), cierra el pendiente que ADR-032 había dejado
  fuera de alcance:** de las 21 políticas activas encontradas en el
  reconocimiento previo, **13 eran huérfanas** (nunca creadas por
  ninguna migración, o creadas por una migración que un `DROP` posterior
  intentó eliminar sin éxito en producción — mismo patrón que ADR-032).
  **Hallazgo más serio en el camino:** `PADRON_SOCIOS`/`PADRON_PARCELAS`
  **nunca tuvieron** las políticas oficiales `rls_select_*`/`rls_write_*`
  vivas, pese a que una migración de agosto sí las creaba — todo el
  acceso `authenticated` real corría por políticas huérfanas, no
  documentadas. La migración crea primero las 4 políticas oficiales
  faltantes y recién después borra las 13 huérfanas, para no dejar sin
  acceso real a `authenticated` en el medio. **Verificado en vivo:**
  `pg_policies` después de aplicar muestra exactamente 12 políticas (las
  13 huérfanas ya no están, las 4 nuevas sí, `rls_anon_select_*` de
  ADR-031 intacta); con una sesión real (`ORG-TEST-DEMO`), `SELECT`
  contra ambas tablas Padrón sigue funcionando igual que antes — 67
  filas de socios, 37 de parcelas, mismos conteos que documenta ADR-031,
  sin fuga cross-org. No se tocó código de la app (la migración es RLS
  puro). Ver [ADR-034](adr/ADR-034-limpieza-drift-rls-eudr-padron.md) y
  `AI_STATE.md` (`2026-09-03j`) para el detalle completo.

> **Rotación (2026-09-11):** hitos del 2026-09-05 al 2026-09-08 movidos acá desde `docs/ESTADO_PROYECTO.md` (economía de tokens, `CLAUDE.md`) — quedan en ese archivo solo los últimos hitos activos (2026-09-09 en adelante).

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
