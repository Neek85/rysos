# Spec — Módulo Pecuario Cuyes MVP (Granja Valencia y futuros tenants)

## Contexto y corrección de premisas (antes de diseñar)

Un primer diseño de este módulo fue redactado por Gemini (Gem RYZOS) y revisado
por Claude (Cowork) antes de tocar la base real, siguiendo el Gate de segunda
revisión de la Sección 4.1.2 del orquestador. La revisión encontró que el
diseño original **asumía** un esquema que no coincide con el real:

- `ORGANIZACIONES."ID"` es **texto** (códigos de negocio como
  `COOP-AROMAS-VALLE`, no UUID) — confirmado en `docs/schema_live.md` y en el
  alta real de `COOP-AROMAS-VALLE` (`claude/archivo_historico.md`).
- Todo el esquema real usa identificadores entrecomillados mixed-case
  (`"PADRON_SOCIOS"`, `"ID_Organizacion"`, `"ID_Socio"`) — un identificador
  sin comillas en Postgres se pliega a minúsculas y deja de coincidir con esa
  convención.
- El patrón RLS real usa `public.auth_org_id()` (retorna `text`, extraído del
  JWT) con la forma `"ID_Organizacion" = public.auth_org_id() OR auth.role() =
  'service_role' OR current_user = 'postgres'` (ver
  `supabase/migrations/20260816_fase3_seguridad_rls.sql`).
- `PECUARIO_GALPONES`, `PECUARIO_JAULAS`, `PECUARIO_LOTES` y
  `PECUARIO_PESAJE_ALIMENTACION` **ya existen en producción** (Granja Valencia
  ya opera como tenant activo) — un `CREATE TABLE IF NOT EXISTS` con un set de
  columnas nuevo, sin verificar el esquema real, puede quedar como no-op
  silencioso o crear una tabla duplicada si la existente está entrecomillada
  y la nueva no.

Esta versión del spec corrige esas tres cosas. **No corrige lo que no se pudo
verificar desde esta sesión** (sin conexión viva a Supabase ni al repo) — ver
"Verificación pendiente antes de ejecutar" al final.

## Alcance acordado

- Manejo **poblacional por poza/lote** (no por animal individual) — igual que
  hoy.
- Preparado para genealogía individual futura sin romper nada: `animal_id`
  como columna simple (sin FK, sin tabla `ANIMALES` todavía) reservada en
  `PECUARIO_MORTALIDAD`; `madre_id` reservada en `PECUARIO_PARTOS`. Documentado
  con `COMMENT ON COLUMN`, no solo en este spec.
- **Trazabilidad de lote hasta su origen:** a diferencia del diseño original,
  `PECUARIO_LOTES` sí guarda `parto_origen_id` además de `poza_origen_id` —
  sin esto, un lote de recría no se puede rastrear hasta la camada/madre que
  lo originó, que es justamente el objetivo de "trazabilidad" pedido.
- Offline-ready: `device_id`, `created_offline_at`, `synced_at` en toda tabla
  operativa (no en `PECUARIO_CONFIGURACION`, que es administrativa).
- Destete automatizado: trigger sobre `PECUARIO_PARTOS` crea una tarea en
  `TAREAS` a los N días configurados por organización (default 14).
- **Esto es para una app real de campo (celular/tablet), no una demo:** las
  pantallas de captura (parto, destete, pesaje, mortalidad, venta) deben
  funcionar con conectividad mala/nula, con botones grandes (uso con manos
  sucias/guantes en el galpón), y sin depender de que el usuario recuerde IDs
  internos — la app resuelve poza/lote por código visible, no por UUID.

## Decisión arquitectónica: multi-tenant real, no solo por diseño

A diferencia de la web (que hoy usa la `anon` key sin sesión real y por eso
varias tablas quedan fuera del modelo Zero-Trust a propósito), la app móvil
de Granja Valencia **sí tiene usuario interno autenticado** (tabla 6 del
orquestador: "Usuario interno, tenant propio"). Esto significa que las
políticas RLS con `authenticated` + `auth_org_id()` sí son la defensa real
aquí, no solo higiene — por eso este spec exige políticas `CREATE POLICY`
explícitas y probadas, no solo `ENABLE ROW LEVEL SECURITY`.

## Contrato de Datos (Zod / TypeScript)

Corrección clave respecto al diseño original: `ID_Organizacion` es
`z.string().min(1)` (código de negocio), **no** `z.string().uuid()`. Ver
`lib/validations/pecuario.ts` (misma carpeta que `lib/validations/socios.js`,
no `lib/validators/` — corregido, el diseño original tenía el nombre de
carpeta equivocado).

- Enums: `tipo_uso_poza`, `etapa_productiva`, `causa_mortalidad`,
  `tipo_venta_cuy` (sin cambios respecto al diseño original).
- `PartoRegistroSchema`, `MortalidadRegistroSchema`, `PesajeLoteSchema`: igual
  que el diseño original, con la corrección de `ID_Organizacion` arriba.

## Verificación pendiente antes de ejecutar — RESUELTO (2026-09-10, Claude Code CLI)

Verificado en vivo contra la instancia real (`jhtocgxlozfuzullrtol`), Service
Role Key, 3 vías independientes: (1) esquema OpenAPI que expone PostgREST
(`GET {SUPABASE_URL}/rest/v1/` — lista todas las tablas/vistas expuestas en
`public`); (2) `GET` directo a cada tabla; (3) lectura completa de
`ORGANIZACIONES`.

**Resultado: la premisa central del diseño original era FALSA.** Ninguna de
las 5 tablas existe hoy en producción, y **`ORGANIZACIONES` no tiene ninguna
fila "Granja Valencia"** — hoy solo existen `COOP-AROMAS-VALLE` y
`ORG-TEST-DEMO`. El tenant sobre el que se diseñó todo este módulo ("Granja
Valencia ya opera como tenant activo") no está onboardeado — es trabajo a
futuro, no un cliente real en producción hoy.

1. ~~Columnas reales hoy de `"PECUARIO_JAULAS"`, `"PECUARIO_LOTES"`,
   `"PECUARIO_GALPONES"` y `"PECUARIO_PESAJE_ALIMENTACION"`~~ — **ninguna de
   las 4 existe.** `GET .../rest/v1/PECUARIO_JAULAS` (y las otras 3) →
   `404 PGRST205 "Could not find the table 'public.PECUARIO_JAULAS' in the
   schema cache"`. Tampoco aparecen en el esquema OpenAPI (58 definiciones
   reales, ninguna con "PECUARIO" en el nombre) ni en el historial completo
   de migraciones (`git log --all --grep`) ni en `docs/ESTADO_PROYECTO.md`
   (que ya documentaba esto explícitamente: "ninguna tabla PECUARIO_*
   todavía").
2. ~~Si `TAREAS` existe~~ — **no existe** (mismo resultado PGRST205, cero
   menciones en migraciones o docs fuera de este spec). El trigger de
   destete de la migración ya maneja esto correctamente sin intervención:
   verifica `to_regclass('public."TAREAS"')` antes de escribir y solo emite
   `RAISE WARNING` si falta — el `INSERT` del parto nunca se rompe. Ninguna
   tarea de destete se crea de verdad hasta que `TAREAS` exista como módulo
   propio (fuera de alcance de este MVP).
3. ~~¿Fusionar `PECUARIO_PESAJES` con `PECUARIO_PESAJE_ALIMENTACION`?~~ —
   **la pregunta queda resuelta sola: `PECUARIO_PESAJE_ALIMENTACION` tampoco
   existe.** No hay nada con qué fusionar. `PECUARIO_PESAJES` se crea como
   tabla nueva e independiente, tal como estaba en la migración.

**Un gap real que esta verificación sí encontró y que la migración original
no cubría:** `PECUARIO_GALPONES` se referencia por FK condicional
(`PECUARIO_JAULAS.galpon_id`) pero **nunca tiene un `CREATE TABLE` propio en
este archivo** — a diferencia de `PECUARIO_JAULAS`/`PECUARIO_LOTES`, que sí
son tablas nuevas creadas de cero. No se agregó acá porque no hay ningún
diseño real de sus columnas más allá de "un galpón agrupa jaulas" — inventar
su estructura sin más contexto sería alcance no verificado. Queda como
`galpon_id` sin FK real hasta que exista una spec propia para
`PECUARIO_GALPONES` (agrupación física de jaulas, capacidad, ubicación,
etc.) — la migración lo maneja sin romperse (bloque `DO` con `RAISE NOTICE`).

La migración (`supabase/migrations/20260910160000_pecuario_cuyes_core.sql`)
no necesitó cambios en su lógica SQL — su diseño defensivo (`CREATE TABLE
IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` + chequeos `information_schema`
antes de cada FK condicional) ya era correcto bajo el estado real: crea las
6 tablas nuevas desde cero, en el orden correcto, sin que ninguna FK
condicional falle en tiempo de aplicación (cada una encuentra su tabla ya
creada más arriba, dentro de la misma transacción). Solo se corrigieron los
comentarios que afirmaban "ya existe en producción" — ver el encabezado del
archivo.

## Fuera de alcance de este MVP

- Genealogía individual (aretes/IDs por animal) — columnas reservadas, tabla
  `ANIMALES` no se crea todavía.
- Notificaciones push por vencimiento de tarea (regla general del proyecto:
  fuera de alcance hasta que se active esa fase).
- Decisión de si el flujo offline de esta app escribe primero a `SYNC_QUEUE`
  (como el acopio de café) o directo a las tablas `PECUARIO_*` vía Supabase
  offline cache de Expo — **pendiente de decisión de negocio**, no asumido en
  este spec.
