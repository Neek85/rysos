# ESTADO DEL PROYECTO RYZOS
*Última actualización: 5 de septiembre, 2026*

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

## 📌 PRÓXIMA VEZ QUE ABRAS UNA CONVERSACIÓN

Si vienes de una pausa, simplemente di: **"Lee el estado del proyecto y sigamos donde quedamos."** No necesitas repetir el contexto — este documento lo tiene.