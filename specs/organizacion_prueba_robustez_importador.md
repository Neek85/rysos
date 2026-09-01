# Spec — Organización de prueba para robustez del importador y demo comercial

- **Estado:** En progreso — org y padrón sintético preparados; alta en
  Supabase Studio y carga vía UI pendientes de que el usuario aplique un
  bloqueante encontrado en el camino (ver sección 0.c).
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
envuelta en `BEGIN;`/`COMMIT;`) y no requiere ningún cambio — solo
aplicarla.

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

## 7. Alta de la organización — pendiente, manual

Sigue el runbook de `specs/alta_organizacion_real.md`, adaptado con
`es_organizacion_prueba = true` (sección 3.2) y 2 filas en
`ORGANIZACION_PRODUCTOS` (Café + Cacao, sección 3.3). El `INSERT`
transaccional se entrega al usuario para revisar y aplicar en Supabase
Studio — mismo criterio que el runbook original y que la limpieza de
`COOP-AROMAS-VALLE` de la tarea anterior: no se ejecuta de forma
autónoma.

## 8. Carga vía importador real — bloqueada (ver 0.c)

No se puede completar hasta que el usuario aplique
`20260901120000_socio_creacion_atomica.sql`. Una vez aplicada, el plan
es: cargar `Socios.csv`/`Parcelas.csv` contra `ORG-TEST-DEMO` desde
`/dashboard/socios`, e interrumpir deliberadamente la carga a mitad de
camino (navegar afuera) para confirmar que las filas ya procesadas
quedan completas (socio + sus certificaciones, atómico por fila vía la
RPC) y que las filas no llegadas a procesar simplemente no existen
(sin filas a medio insertar) — documentando cuántas filas entraron
válidas, si la barra de progreso reflejó avance real, y si el aviso
`beforeunload` apareció al intentar cerrar/navegar afuera a mitad de
carga.

## 9. Criterios de aceptación

- [ ] `ORG-TEST-DEMO` existe en `ORGANIZACIONES` con
      `es_organizacion_prueba = true` y 2 filas en
      `ORGANIZACION_PRODUCTOS` (Café, Cacao).
- [ ] `scripts/generar_padron_sintetico.mjs` genera `Socios.csv`/
      `Parcelas.csv` entre 10 y 50 filas, deterministas por `--seed`,
      donde el 100% de las filas pasa `socioSchema`/`parcelaSchema`
      sin error.
- [ ] Ubigeo de cada socio existe realmente en `lib/data/ubigeo_peru.json`
      (Cajamarca → provincia real → distrito real).
- [ ] Integridad referencial 100%: todo `ID_Socio` en `Parcelas.csv`
      existe en `Socios.csv`.
- [ ] `COOP-AROMAS-VALLE` no aparece en ningún archivo ni sentencia SQL
      de esta tarea salvo para excluirla explícitamente.
- [ ] Carga real vía `/dashboard/socios` documentada en `AI_STATE.md`
      (filas válidas, atomicidad ante interrupción, progreso real) —
      condicionado a que la migración de la sección 0.c esté aplicada.
