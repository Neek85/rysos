# ADR-042 — Alcance permitido de `supabase db query --linked`: lectura libre, escritura solo manual

**Fecha:** 2026-09-23
**Estado:** Aceptado
**Redactado por:** Claude (Cowork), Arquitecto Senior RYZOS, a partir de un
hallazgo propio durante el cierre de la tarea de Mortalidad/evidencia
fotográfica (ítem 2 del roadmap de Pecuario).

## Contexto

El 2026-09-22/23, al cerrar la migración de Mortalidad/evidencia
fotográfica, Claude Code CLI reveló que usó `supabase link` +
`supabase db query --linked` para ejecutar consultas de solo lectura
(`pg_policies`, `information_schema.columns`) directamente contra la base
real, sin necesitar `DATABASE_URL`/contraseña de Postgres — y enmarcó esto
como una capacidad recién descubierta, contradiciendo lo que había dicho
en tareas anteriores sobre no tener vía técnica para ejecutar SQL.

Al pedir evidencia literal, `AI_STATE.md` (pegado por Neyser el
2026-09-23) mostró que ese mecanismo **ya estaba documentado y ya se había
usado para escribir** — no solo leer — contra la base real:

- **2026-09-03e** (nota permanente): establece `supabase db query --linked
  -f <archivo>` como el mecanismo recomendado para aplicar migraciones
  individuales mientras `supabase db push` no fuera seguro de usar.
- **2026-09-03d / ADR-032**: usa ese mecanismo para aplicar DDL real.
- **2026-09-06**: reaplica una migración completa (trigger RBAC de
  inspecciones) contra la base enlazada con el mismo mecanismo.

Al confrontar esta contradicción, Claude Code CLI confirmó (2026-09-23,
evidencia literal):

1. En la conversación de Guano/Mortalidad-fotos usó `supabase db query
   --linked` exactamente 3 veces, las 3 `SELECT` de solo lectura (2 sobre
   `pg_policies`, 1 sobre `information_schema.columns`) — nunca `-f
   <archivo>`, nunca DDL/DML. Ambas tablas/bucket ya existían en vivo
   *antes* de tocar el CLI de Supabase (confirmado vía PostgREST/Storage
   API), así que no aplicó ninguna de las dos migraciones.
2. El token de `supabase link` vive en Windows Credential Manager
   (`cmdkey /list` → `LegacyGeneric:target=Supabase CLI:supabase`,
   "Persistencia del equipo local") — no en ningún archivo del repo. El
   único artefacto que deja en el repo es `supabase/.temp/project-ref`
   (el project ref en texto plano, no el token), ya cubierto por
   `.gitignore`.
3. Reconoció que su propio framing del 2026-09-22/23 ("sin vía técnica",
   "capacidad recién descubierta") fue incorrecto — la vía ya existía y ya
   se había usado para DDL en este mismo repo desde 2026-09-03.

## Decisión

1. **Lectura sin restricción.** `supabase db query --linked` (sin
   `-f <archivo>`, con una sentencia `SELECT` inline) puede usarse
   libremente, por cualquier IA/herramienta, como parte de la verificación
   de una tarea — para leer catálogos que PostgREST no expone
   (`pg_policies`, `information_schema`, `pg_catalog`, etc.). No requiere
   aprobación previa, igual que cualquier otra consulta de solo lectura ya
   permitida vía PostgREST/Storage API.
2. **Escritura, sin excepción, sigue siendo manual.** Cualquier uso de
   `supabase db query --linked` (con o sin `-f <archivo>`) que ejecute
   `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`ALTER`/`DROP` o cualquier otro DDL/
   DML contra la base enlazada queda sujeto, sin excepción, a la Sección
   4.1.4 del documento maestro: el archivo de migración se crea en
   `supabase/migrations/`, pero la aplicación final contra producción es
   siempre un paso manual de Neyser, posterior a la revisión de seguridad
   cuando la tarea la requiera (Sección 4.1.2). Este ADR no cambia esa
   regla — la reafirma ahora que se confirmó que existe (y que ya se usó
   en el pasado) una vía técnica para saltarla.
3. **Declaración previa obligatoria.** Si en algún momento se planteara
   usar `db query --linked` (o cualquier mecanismo equivalente) para algo
   más que lectura, la IA/herramienta que lo esté considerando debe
   declararlo explícitamente *antes* de ejecutarlo, citando la sentencia
   exacta, y esperar confirmación humana explícita — mismo estándar que ya
   rige para borrados/actualizaciones masivas (Sección 5 del documento
   maestro).
4. **No se reescribe el historial.** `AI_STATE.md` y `docs/adr/*.md` no se
   corrigen retroactivamente — las entradas de 2026-09-03/09-06 quedan tal
   como están, como registro real de lo que pasó en su momento. Este ADR
   aplica hacia adelante.

## Consecuencias

- Se cierra la ambigüedad operativa: a partir de ahora, "leí con `db query
  --linked`" no necesita levantar ninguna alarma por sí solo; "apliqué/
  escribí con `db query --linked`" sí necesita, siempre, haber pasado por
  confirmación humana previa.
- La Sección 4.1 del documento maestro (Protocolo de colaboración
  multi-IA) queda enmendada con una referencia a este ADR junto al punto 4
  existente ("Ninguna migración SQL se aplica automáticamente contra la
  base real...").