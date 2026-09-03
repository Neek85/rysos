# ESTADO DEL PROYECTO RYZOS
*Última actualización: 2 de septiembre, 2026*

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

## 📌 PRÓXIMA VEZ QUE ABRAS UNA CONVERSACIÓN

Si vienes de una pausa, simplemente di: **"Lee el estado del proyecto y sigamos donde quedamos."** No necesitas repetir el contexto — este documento lo tiene.