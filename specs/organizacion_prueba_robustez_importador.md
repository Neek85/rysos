# Spec — Organización de prueba para robustez del importador y demo comercial

- **Estado:** **Completado.** Migración + alta de `ORG-TEST-DEMO`
  aplicadas por el usuario en Supabase Studio; ronda de robustez del
  importador ejecutada y verificada con evidencia real de base de
  datos (secciones 7-8) — progreso real, `beforeunload`, y corte
  limpio por fila ante interrupción, los 3 confirmados. Pendiente
  solo lo documentado como fuera de alcance (selector de organización
  real, sección 8).
- **Fecha:** 2026-09-01.
- **Contexto previo:** `docs/adr/ADR-008-etiqueta-organizacion-prueba-y-guardarail-e2e.md`,
  `docs/adr/ADR-030-convencion-codigo-organizaciones.md`,
  `specs/alta_organizacion_real.md` (runbook de alta, reutilizado acá),
  `specs/mejoras_importador_padron_masivo.md` (ronda 9 — atomicidad,
  progreso, `beforeunload`, es el flujo que esta org existe para probar).

## 0. Verificación de premisas del pedido (contra el repo real)

**a) Conflicto real con ADR-030 (resuelto con el usuario antes de escribir
código).** El pedido original pedía definir un `TIPO` nuevo (`DEMO-`/
`TEST-`) y documentarlo en `ADR-030`. `ADR-030` ya existe y dice
explícitamente que ese prefijo es solo para el primer caso real de un
tipo jurídico de organización (`COOP` hoy) y que **"no se reserva ni se
documenta un prefijo sin una organización real que lo use"** — una
organización sintética de prueba no es ese caso. El sistema ya tiene un
mecanismo dedicado exactamente para esto: `ADR-008`
(`es_organizacion_prueba boolean` + convención de nombre `ORG-TEST-*`,
creado tras el incidente real documentado ahí — 14 filas de prueba sin
ninguna señal de esquema que las distinguiera de datos reales).
**Decisión (confirmada con el usuario):** no se toca `ADR-030`. Esta
organización usa el mecanismo de `ADR-008` — código `ORG-TEST-DEMO`,
`es_organizacion_prueba = true`.

**b) Hallazgo colateral: `ORG-TEST-E2E` ya no existe.** `ORGANIZACIONES`
tiene hoy una sola fila real, `COOP-AROMAS-VALLE` (confirmado en vivo vía
REST) — la fila `ORG-TEST-E2E` que creó `ADR-008` para
`scripts/run_e2e_etl_test.py` fue borrada en algún momento (probablemente
en la misma limpieza de `ORGANIZACIONES` que preparó el alta de
`COOP-AROMAS-VALLE`, ver el contexto de `ADR-030`). Efecto colateral:
`scripts/run_e2e_etl_test.py` en modo real abortaría hoy con
`UnsafeOrgIdError` (`assert_org_is_test_marked` no encuentra la fila) —
**fuera de alcance de esta tarea**, se documenta acá solo porque se
encontró en el camino. `ORG-TEST-DEMO` (esta tarea) es una organización
nueva e independiente — no reemplaza ni repara `ORG-TEST-E2E`.

**c) Bloqueante nuevo encontrado, no relacionado con esta tarea pero que
la bloquea: la RPC `fn_crear_socio_con_certificaciones` no existe en la
instancia real.** `lib/actions/sociosActions.js::createSocio()` (usado
tanto por el alta manual de un socio en `/dashboard/socios` como por el
importador CSV masivo, mismo código) llama a esta RPC desde la ronda 9 de
`specs/mejoras_importador_padron_masivo.md` (ya commiteada). La migración
que la crea, `supabase/migrations/20260901120000_socio_creacion_atomica.sql`,
sigue **pendiente de aplicación manual en Supabase Studio** — confirmado
en vivo: `POST .../rpc/fn_crear_socio_con_certificaciones` devuelve
`PGRST202`, "no matches were found in the schema cache". Esto significa
que **el alta de un socio está rota hoy en producción**, no solo para
esta organización de prueba — afecta también a `COOP-AROMAS-VALLE`. No
es una tarea apta para ejecución autónoma (aplicar una migración DDL
requiere el SQL Editor de Supabase Studio, sin conexión Postgres directa
disponible desde este entorno, ver `CLAUDE.md`) — **el paso 6 de esta
tarea (cargar el CSV sintético vía el importador real y verificar
atomicidad) queda bloqueado hasta que el usuario aplique esa migración**.
La migración ya existe, es idempotente (`CREATE OR REPLACE FUNCTION`,
envuelta en `BEGIN;`/`COMMIT;`) — **ya no es cierto que "no requiere
ningún cambio"**, ver 0.d, corregido antes de que se aplique.

**d) Hueco de seguridad real encontrado y cerrado en la migración de
0.c, antes de que se aplicara (2026-09-01, segunda pasada sobre este
archivo).** `fn_crear_socio_con_certificaciones` se creó sin ningún
`REVOKE`/`GRANT` explícito. Postgres otorga `EXECUTE` a `PUBLIC` por
defecto en toda función nueva — sin revocarlo, la función queda
alcanzable directo vía el endpoint RPC de PostgREST con solo la llave
`anon` pública, dejando crear socios reales (con certificaciones) en el
padrón de **cualquier organización**, sin pasar por
`assertMatchesExistingOrg`/`assertSocioExists` de
`lib/actions/sociosActions.js` (esas validaciones viven en la Server
Action, no en la base — la RPC no las hereda). El comentario original
del archivo justificaba la ausencia de `GRANT` citando
`fn_guardar_inspeccion_completa` como "mismo criterio" — **eso era
incorrecto**: esa otra función SÍ tiene un `GRANT EXECUTE` explícito a
`anon`/`authenticated` (`20260818_inspecciones_atomic_save.sql`),
deliberado, porque `INSPECCIONES`/`CAP_*` ya son escribibles por `anon`
vía RLS (`FOR ALL USING(true)`) — el `GRANT` no abre nada que la
política no permitiera ya. `PADRON_SOCIOS`/`SOCIO_CERTIFICACIONES` son
el caso opuesto: `anon` no tiene ninguna política de escritura ahí, por
diseño deliberado.

**Fix aplicado** (`supabase/migrations/20260901120000_socio_creacion_atomica.sql`,
antes del `COMMIT` final):
```sql
REVOKE EXECUTE ON FUNCTION public.fn_crear_socio_con_certificaciones(text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_crear_socio_con_certificaciones(text, text, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crear_socio_con_certificaciones(text, text, jsonb, jsonb) TO service_role;
```

**Nota honesta sobre severidad real (para que el arquitecto la tenga al
confirmar):** no fue posible confirmar en vivo contra
`pg_proc`/`information_schema.routine_privileges` si `PUBLIC` ya viene
restringido por defecto en esta instancia de Supabase específica (sin
conexión Postgres directa desde este entorno, y las pruebas hechas vía
REST con la anon key y con la Service Role Key dieron el mismo
`PGRST202` "no encontrada" para varias funciones de prueba — PostgREST
da ese mismo mensaje tanto para "no existe" como para "existe pero el
rol no tiene `EXECUTE`", así que no es una señal concluyente sin poder
probar la firma exacta). Como la función NO es `SECURITY DEFINER`, el
`INSERT` interno corre con los privilegios del rol que llama — si RLS en
`PADRON_SOCIOS`/`SOCIO_CERTIFICACIONES` ya deniega `INSERT` a `anon` hoy
(no hay política de escritura para ese rol), es *posible* que RLS por sí
sola ya bloqueara un intento de explotación real incluso sin este fix.
Aun así, depender solo de RLS como única capa es frágil — si en el
futuro se agrega cualquier política de escritura `anon` a estas tablas
por otro motivo (como ya pasó con `INSPECCIONES`/`CAP_*`, ver
`20260818_fix_inspecciones_rls.sql`), esta función habría quedado
explotable en el acto sin que nadie lo note, porque la capa de función
ya estaba abierta de antes. El `REVOKE`/`GRANT` es correcto como defensa
en profundidad independientemente de esa ambigüedad.

**Hallazgo colateral más amplio, fuera de alcance de esta tarea:** el
mismo patrón — un comentario en el archivo que *afirma* "no se otorga a
`anon`" sin ningún `REVOKE`/`GRANT` real que lo haga cumplir — aparece
también en `supabase/migrations/20260821_221221_fn_parcelas_vecinas_eudr.sql`
(línea 39: "NO usa... GRANT EXECUTE ... TO anon", pero cero sentencias
`GRANT`/`REVOKE` reales en el archivo). Un grep sobre
`supabase/migrations/*.sql` muestra que **solo 2 de 16 migraciones con
funciones nuevas** (`fn_guardar_inspeccion_completa` y, ahora,
`fn_crear_socio_con_certificaciones`) tienen `REVOKE`/`GRANT` reales;
el resto (`fn_sanitize_geometry`, `fn_validar_topologia_eudr` ×2,
`fn_cobertura_uso_suelo_parcela`, `fn_validar_codigo_parcela_unico` ×2,
`fn_parcelas_vecinas_eudr`, `get_my_org_id`, `auth_org_id`,
`fn_prevent_audit_log_mutation`) no tienen ninguno. No se auditó ni se
tocó ninguna de ellas en esta tarea — el pedido original era
específicamente sobre `20260901120000_socio_creacion_atomica.sql`, y
tocar migraciones ya aplicadas (o potencialmente aplicadas) sin que el
usuario lo pida es un cambio de alcance que merece su propia tarea y
confirmación explícita, no un agregado de último momento acá. Se
recomienda una auditoría dedicada de `GRANT`/`REVOKE` sobre todas las
funciones RPC del proyecto antes de aplicar cualquier migración
pendiente nueva.

## 1. Alcance

- Una organización nueva, aislada, marcada explícitamente como de
  prueba (`es_organizacion_prueba = true`), con un padrón sintético
  reproducible de socios y parcelas (10 a 50 filas, configurable).
- Sirve dos propósitos: (a) probar la robustez del importador masivo
  (transacción atómica por fila, barra de progreso real, aviso
  `beforeunload`) sin tocar datos reales; (b) quedar como base
  reutilizable para una futura demo comercial, sin exponer PII real de
  ningún socio.
- Vinculada a **Café y Cacao** (ver sección 3.3 — decisión tomada en
  esta tarea) para que la demo muestre el soporte multi-producto
  (ADR-028) con datos reales de ambos productos, no solo uno.

## 2. Fuera de alcance

- **No toca `COOP-AROMAS-VALLE` bajo ninguna circunstancia** — ningún
  script ni SQL de esta tarea filtra, lee para modificar, ni escribe
  contra `"ID_Organizacion" = 'COOP-AROMAS-VALLE'`.
- No repara `ORG-TEST-E2E` ni `scripts/run_e2e_etl_test.py` (sección
  0.b) — hallazgo colateral, no parte de este trabajo.
- No aplica la migración `20260901120000_socio_creacion_atomica.sql`
  de forma autónoma (sección 0.c) — es responsabilidad del usuario en
  Supabase Studio, como toda migración de este repo.
- No modifica `ADR-030` (sección 0.a).
- No agrega TypeScript, autenticación, ni ninguna infraestructura fuera
  del alcance ya definido en `docs/RYZOS_ORQUESTADOR_V3.1.md` sección 2.

## 3. Organización de prueba

### 3.1 Código

`ORG-TEST-DEMO` — sigue la convención de `ADR-008` (`ORG-TEST-*`), no la
de `ADR-030` (ver sección 0.a). `Nombre_Organizacion`:
`"Organización de Prueba — Demo Comercial e Importador — NO ES CLIENTE
REAL"` (mismo criterio de texto explícito que `ORG-TEST-E2E` en
`ADR-008`, para que sea inequívoco tanto en Supabase Studio como en
cualquier consulta automatizada).

### 3.2 Fila en `ORGANIZACIONES`

Sigue el runbook de `specs/alta_organizacion_real.md` paso 3 (mismo
patrón transaccional), con `es_organizacion_prueba = true` en vez de
`false`, y `RUC`/`Direccion_Fiscal`/`Representante_Legal` con
placeholders explícitos ("N/A — organización sintética"), mismo criterio
que `ADR-008` decisión 2 para `ORG-TEST-E2E`.

### 3.3 Productos — decisión: Café y Cacao

`ORGANIZACION_PRODUCTOS` es N-a-N (`specs/alta_organizacion_real.md`,
prerrequisitos) y `PRODUCTOS` ya tiene ambos códigos reales confirmados
en vivo (`CAFE` = `6ae00de1-e156-4090-921c-d1244575856b`, `CACAO` =
`9f7cc233-4563-427f-a6bd-6b9b775817a9`). Se vincula la organización a
**ambos** — no solo Café — porque el propósito explícito (b) de esta
organización es servir de base para una demo comercial futura, y
mostrar el soporte multi-producto (ADR-028, `id_producto_predominante`)
con datos reales de los dos productos es más representativo del sistema
real que limitarse a uno. El dataset sintético (sección 5) reparte las
parcelas entre ambos productos en vez de asignar todas a Café.

## 4. Criterio de "sintético"

- **Ubigeo real:** Departamento fijo `Cajamarca` (misma región que
  `COOP-AROMAS-VALLE`, coherente con el contexto real del proyecto),
  provincia/distrito tomados de `lib/ubigeoData.js`
  (`getProvincias('Cajamarca')` / `getDistritos(...)`) — nunca un
  nombre inventado, siempre uno que exista realmente en el dataset de
  ubigeo del repo.
- **DNI:** 8 dígitos válidos contra el regex de `socioSchema`
  (`dniRequerido`), generados de forma puramente sintética
  (secuencia determinística, no aleatoria del sistema) — no
  corresponden a ninguna persona real.
- **Nombres:** lista fija de nombres/apellidos peruanos genéricos y
  claramente ficticios (combinatoria de pila de nombres × apellidos),
  no generados a partir de ningún dato real del padrón de
  `COOP-AROMAS-VALLE` ni de ninguna otra organización.
- **Hectáreas:** rango típico observado en el padrón real (0.5–5.0 ha
  por categoría, total por parcela entre ~1 y ~12 ha) — suficiente para
  pasar el `refine` de `parcelaSchema` (suma > 0) sin usar valores
  irreales.
- **Certificaciones:** patrón ficticio (una combinación variada de
  Sí/No por fila) sobre las 8 certificaciones activas reales de
  `CERTIFICACIONES_CATALOGO` (confirmadas en vivo) — no se inventan
  certificaciones nuevas, se reutiliza el catálogo real tal cual.
- **Reproducible:** el generador usa una semilla determinística (mismo
  `--seed` → mismo CSV byte a byte) para poder regenerar el dataset de
  demo de forma idéntica cuando haga falta refrescarlo.

## 5. Contrato de datos

Reutiliza el contrato Zod vigente sin modificarlo:
- `socioSchema` / `parcelaSchema` (`lib/validations/socios.js`) — el
  generador valida cada fila sintética contra estos schemas antes de
  escribir el CSV, para garantizar que pasa exactamente las mismas
  reglas que el importador real aplicará después.
- Columnas y encabezados: reutiliza `buildSociosCsv`/`buildParcelasCsv`
  (`lib/padronCsv.js`) tal cual — mismas columnas fijas
  (`SOCIO_EXPORT_COLUMNS`/`PARCELA_EXPORT_COLUMNS`), mismas columnas
  dinámicas de certificación (una por fila `activo = true` de
  `CERTIFICACIONES_CATALOGO`, encabezado = `nombre` del catálogo, ADR-027),
  mismo separador `\r\n` y escapado de celda (`escapeCsvCell`). No se
  reimplementa el formateo CSV — se importan esas funciones directo.
- Encoding: UTF-8 con BOM (mismo criterio que `triggerCsvDownload`,
  para que el archivo generado sea indistinguible de uno exportado
  desde la UI real).
- `ID_Socio`/`ID_Parcela_Fija`: códigos manuales vía
  `computeNextCodes`/`computeSuggestedParcelaId`
  (`lib/parcelaDefaults.js`, reutilizados tal cual) con prefijo
  `DEMO-` — sin colisión posible porque la organización nace vacía.
  Integridad referencial: cada `Parcelas.csv.ID_Socio` corresponde a un
  `ID_Socio` real presente en `Socios.csv` de la misma corrida (se
  generan socios primero, luego 1-2 parcelas por socio).

## 6. Generador reproducible

`scripts/generar_padron_sintetico.mjs` (Node ESM, `node
scripts/generar_padron_sintetico.mjs [--count N] [--seed S] [--out
DIR]`) — ver el script para el detalle de implementación. Produce
`Socios.csv` y `Parcelas.csv` en el directorio de salida (por defecto
`scratch/padron_sintetico/`, no versionado). Necesita las mismas
credenciales que el resto de scripts que leen catálogos en vivo
(`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` de
`.env.local`) — solo para leer `CERTIFICACIONES_CATALOGO` (lectura,
sin escritura).

## 7. Alta de la organización — APLICADA

`ORG-TEST-DEMO` fue aplicada manualmente por el usuario en Supabase
Studio (migración `20260901120000_socio_creacion_atomica.sql` +
INSERT de la organización) — confirmado en vivo al empezar la ronda de
robustez: `ORGANIZACIONES` tiene la fila con `es_organizacion_prueba =
true`, `ORGANIZACION_PRODUCTOS` confirma Café + Cacao, y la RPC
`fn_crear_socio_con_certificaciones` devuelve `P0001` (su propio guard
clause) con Service Role Key y `42501 permission denied` con la anon
key — prueba de que existe y de que el `REVOKE`/`GRANT` de la tarea
anterior funciona de verdad.

## 8. Carga vía importador real — COMPLETADA (ver AI_STATE.md 2026-09-01f para el detalle completo con evidencia)

**Bloqueante nuevo encontrado antes de poder cargar nada:**
`/dashboard/socios` no tenía ningún selector de organización — la
"organización activa" de toda la página se resolvía con un único probe
(primera fila de `PADRON_SOCIOS`), que con `COOP-AROMAS-VALLE` ya
teniendo 618 filas reales, **siempre** resolvía a `COOP-AROMAS-VALLE`,
nunca a `ORG-TEST-DEMO`. Resuelto con un override temporal por query
param (`?org=<codigo>`, verificado server-side contra
`ORGANIZACIONES.es_organizacion_prueba = true` antes de aceptarse —
`lib/actions/organizacionesActions.js::resolveTestOrganizationOverride`,
`lib/sociosSearch.js::fetchSocios` con el parámetro nuevo
`organizationIdOverride`) — decisión del usuario, con la condición
explícita de que la verificación cubriera tanto lectura como escritura,
confirmado en vivo (ver AI_STATE.md 2026-09-01f).

**Resultado real, con evidencia de base de datos (no solo de pantalla):**
- **Carga completa sin interrupción (Socios.csv, 15 filas):** 15/15
  válidas, 15/15 confirmadas en `PADRON_SOCIOS` + 48 filas en
  `SOCIO_CERTIFICACIONES` (vía FK real).
- **Progreso real fila por fila:** confirmado en pantalla en múltiples
  momentos de cargas distintas ("Importando fila 20 de 50 (40%)",
  "Importando fila 35 de 37 (95%)") — el porcentaje siempre coincidió
  exactamente con `processed/total`, nunca un salto instantáneo.
- **`beforeunload`:** confirmado que SÍ bloquea la navegación —
  intentar navegar fuera a mitad de una carga de 50 filas disparó el
  diálogo nativo "Leave site?" del navegador (la navegación quedó
  bloqueada hasta forzar el descarte del diálogo). Un intento anterior
  con un lote de 15 filas no llegó a capturar el diálogo porque la
  carga ya había terminado antes de que la navegación se disparara —
  limitación de la ventana de tiempo de la prueba, no de
  `beforeunload` en sí.
- **Corte limpio por fila ante interrupción real, no corrupción de
  archivo:** de 50 filas válidas, 37 quedaron commiteadas
  (`DEMO-00046`..`DEMO-00082`) y 13 nunca se intentaron. Las 37 tienen
  **cero huérfanas** (se verificó que las 37 tienen al menos 1 fila en
  `SOCIO_CERTIFICACIONES`) — confirma en vivo lo que la sección 9.b ya
  documentó a nivel de diseño: atomicidad por fila, no de archivo.
- **Parcelas.csv:** mismo componente/mecanismo (progreso real
  confirmado también ahí), 37/37 válidas cargadas sin interrupción; las
  13 filas restantes del mismo CSV (referenciando los socios que la
  interrupción de arriba dejó afuera) fueron correctamente rechazadas
  por la validación referencial existente ("el Código de Socio no
  existe en la organización activa"), sin que se pidiera probar esto
  explícitamente.
- `COOP-AROMAS-VALLE` sin cambios en ningún momento de toda la ronda
  (618 socios / 821 parcelas, verificado antes y después).

**Hallazgos colaterales (documentados, no resueltos en esta tarea):**
1. Bug real en `scripts/generar_padron_sintetico.mjs` (`socio_dni`/
   `codigo_finca` no se offseteaban contra socios ya existentes de la
   organización, a diferencia de `ID_Socio`) — encontrado y corregido
   en esta misma tarea.
2. `exportSociosCsv`/`exportParcelasCsv` (`lib/padronCsv.js`) no
   respetan ningún scope de organización — a diferencia de
   `fetchSocios`, no reciben `organizationId` en absoluto. Sin riesgo
   real (solo lectura de datos ya visibles en la UI), pero es un gap
   preexistente real — fuera de alcance, no tocado.

**Pendiente:** el override `?org=` es temporal, pensado solo para esta
ronda de prueba (sin persistencia ni UI visible) — un selector de
organización real queda como tarea aparte, con su propio spec, para
cuando haya una segunda organización REAL o se priorice la demo
comercial.

## 9. Decisiones de diseño de `fn_crear_socio_con_certificaciones`

### 9.a — Certificación con `codigo` sin match en el catálogo: se omite en silencio, a propósito

Dentro del `LOOP` de `p_certificaciones`, el `INSERT ... SELECT ... FROM
CERTIFICACIONES_CATALOGO WHERE cat.codigo = r_cert.codigo AND cat.activo
= true` no inserta ninguna fila si el `codigo` no matchea (catálogo
desactualizado, o una certificación que se desactivó entre que el
frontend cargó `CERT_FLAG_FIELDS` y que se llamó a la RPC) — no hay
ningún `RAISE`/error por esto. **Es a propósito, mismo criterio ya
documentado para `cert_org_estatus`/`syncSocioCertificaciones` en
`specs/mejoras_importador_padron_masivo.md` (ronda 1):** una
certificación individual que no matchea no debe bloquear el alta del
socio completo — el socio y sus certificaciones válidas se guardan
igual. **No se cambia a loguear/reportar el mismatch en esta tarea** —
el prompt original preguntaba si convenía, y la respuesta es: no hace
falta hoy, porque el catálogo (`CERTIFICACIONES_CATALOGO`) es un catálogo
estable gestionado desde Supabase Studio, no algo que cambie con
frecuencia suficiente para justificar telemetría dedicada; si en el
futuro se observa un mismatch real en producción (mismo patrón que otros
hallazgos de este proyecto — investigar cuando aparece evidencia real,
no antes), ahí se evalúa agregar un `RAISE WARNING` o una fila de log,
no antes.

### 9.b — La atomicidad es POR FILA, no de todo el archivo

`fn_crear_socio_con_certificaciones` envuelve **un solo socio + sus
certificaciones** en una transacción implícita (la propia invocación
RPC) — si algo falla a mitad de esa función, esa fila entera revierte.
Pero el importador masivo (`ImportPadronModal.jsx`) llama a esta RPC
**una vez por fila del CSV**, en un bucle — no hay ninguna transacción
que envuelva el archivo completo. **Consecuencia explícita:** interrumpir
la carga a mitad de camino (cerrar la pestaña, navegar afuera) deja las
filas YA procesadas commiteadas tal cual (socio + certificaciones
completos, nunca a medias) y el resto del archivo simplemente sin
procesar — **no es un rollback total del archivo**, es un corte limpio
en el punto exacto de la interrupción. Esto es la mejora real que trajo
la ronda 9 sobre el comportamiento anterior (antes, un corte a mitad de
UNA fila podía dejar un socio sin sus certificaciones; ahora eso no
puede pasar, pero un corte entre filas sigue dejando el archivo
parcialmente cargado, por diseño). **Se deja explícito acá para que
nadie asuma más adelante que reintentar el mismo CSV completo es
seguro sin revisar primero qué filas ya entraron** — el propio
importador ya maneja el caso de fila duplicada (mensaje "se omite" en
vez de error, ronda 9), así que un reintento del archivo completo SÍ es
seguro en la práctica (las filas ya cargadas se detectan como duplicado
y se saltan), pero eso es una propiedad de `ImportPadronModal.jsx`, no
de la atomicidad de la RPC en sí — no confundir las dos capas.

## 10. Verificaciones repetidas en esta tarea (premisas del prompt)

- **uuid de `CACAO`:** re-confirmado con una consulta REST nueva contra
  `PRODUCTOS` en el momento de esta tarea (no reutilizado de memoria del
  turno anterior) — `9f7cc233-4563-427f-a6bd-6b9b775817a9`, idéntico al
  ya usado. `ORGANIZACIONES` sigue con una sola fila real
  (`COOP-AROMAS-VALLE`).
- **Validación de formato de RUC en la UI:** grep sobre `components/`,
  `app/`, `lib/` — **no existe ningún validador de formato de RUC en
  todo el repo** (ni longitud, ni regex, ni chequeo de dígito
  verificador). El placeholder `'N/A — organización sintética'` para
  `RUC` (mismo criterio que `ADR-008` usó para `ORG-TEST-E2E`) no tiene
  ninguna vista que pueda romper por esto.

## 11. Criterios de aceptación

- [x] `ORG-TEST-DEMO` existe en `ORGANIZACIONES` con
      `es_organizacion_prueba = true` y 2 filas en
      `ORGANIZACION_PRODUCTOS` (Café, Cacao). Aplicado por el usuario,
      confirmado en vivo.
- [x] `scripts/generar_padron_sintetico.mjs` genera `Socios.csv`/
      `Parcelas.csv` entre 10 y 50 filas, deterministas por `--seed`,
      donde el 100% de las filas pasa `socioSchema`/`parcelaSchema`
      sin error. Corrido en vivo múltiples veces durante la ronda de
      robustez (15, 30, 50 filas).
- [x] Ubigeo de cada socio existe realmente en `lib/data/ubigeo_peru.json`
      (Cajamarca → provincia real → distrito real).
- [x] Integridad referencial 100%: todo `ID_Socio` en `Parcelas.csv`
      existe en `Socios.csv` DEL MISMO LOTE. Nota real encontrada
      durante la ronda: si un lote de Socios se interrumpe a mitad de
      camino, el `Parcelas.csv` generado en esa misma corrida sí puede
      referenciar `ID_Socio` que nunca se llegaron a crear — el
      importador de Parcelas lo detecta y rechaza correctamente esas
      filas (sección 8), pero es responsabilidad de quien opera la
      demo cargar Parcelas.csv después de confirmar qué socios
      realmente entraron, no asumir que el archivo generado es 100%
      consistente si la carga de Socios se cortó.
- [x] `COOP-AROMAS-VALLE` no aparece en ningún archivo ni sentencia SQL
      de esta tarea salvo para excluirla explícitamente. Verificado en
      vivo antes/después de cada carga (618 socios / 821 parcelas, sin
      cambios en ningún momento).
- [x] Carga real vía `/dashboard/socios` documentada en `AI_STATE.md`
      (filas válidas, atomicidad ante interrupción, progreso real) —
      completado, ver entrada `2026-09-01f`.
