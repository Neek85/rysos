# Spec — Adopción de `PADRON_SOCIOS`/`PADRON_PARCELAS` al historial de migraciones

## Contexto

`PADRON_SOCIOS`/`PADRON_PARCELAS` son, junto con `ORGANIZACIONES`, las
únicas tablas base del proyecto sin `CREATE TABLE` en `supabase/migrations/`
— fueron creadas fuera de este repo (ver `CLAUDE.md`, "Tablas base
(pre-existentes...)"). Esto es el primer prerequisito de una secuencia de 4
tareas de arquitectura decididas en una sesión de diseño externa (Cowork):
unicidad de códigos por organización, certificaciones normalizadas, y
multi-producto café/cacao son las otras 3, explícitamente **fuera de
alcance acá** — ninguna de las tres puede empezar a implementarse sobre un
schema no versionado, porque cualquier migración que las implemente
necesita poder expresar "ALTER TABLE ... a partir de esta base conocida" en
vez de asumir un estado no verificable.

## Objetivo

Que el schema real y completo de ambas tablas quede capturado en una
migración versionada, sin alterar absolutamente nada del comportamiento
actual — ni una fila de datos, ni una política RLS, ni un índice. El
resultado de aplicar esta migración contra la instancia viva debe ser
indistinguible, para cualquier consumidor (frontend, Server Actions,
scripts Python, QGIS), del estado antes de aplicarla.

## Corrección de premisa (segunda parte de esta tarea)

`ADR-002`/`ADR-007`/`CLAUDE.md` documentan una restricción real que pesó en
decisiones de diseño anteriores: "el padrón es compartido en vivo con otro
repositorio" (`backend-inspecciones`, ver
`docs/audits/auditoria_backend_inspecciones.md`, que confirmó ambos
proyectos apuntando al mismo Postgres, project ref `jhtocgxlozfuzullrtol`).
Esa restricción llevó, concretamente, a:

- **ADR-002:** justificar la baja lógica (nunca `DELETE` físico) citando,
  entre otras razones, que otro repositorio podía tener referencias sin FK
  hacia estos IDs.
- **ADR-007:** decidir explícitamente NO agregar una FK real
  `PADRON_SOCIOS`/`PADRON_PARCELAS → ORGANIZACIONES`, pese a que los datos
  reales lo permitían sin fricción (0 huérfanos) — el motivo citado fue
  evitar que un `ID_Organizacion` nuevo, creado primero desde el otro
  repositorio, empezara a ser rechazado por una FK agregada
  unilateralmente desde acá.

El usuario confirmó directamente (no es una inferencia de este repo, que no
tiene forma de verificar el estado de un repositorio externo por sí mismo):
`backend-inspecciones` **ya no comparte base de datos en vivo con este
proyecto** — era una arquitectura anterior, más pequeña, del mismo
proyecto, y el módulo de inspecciones socioeconómicas que cubría
(`INSPECCIONES`/`CAP_*`) ya fue portado a este mismo repo como Fase 6
(`app/dashboard/inspecciones`, confirmado en `docs/schema_live.md`). Esto
retira el motivo de coordinación cross-repositorio que documentaban
ADR-002/ADR-007 — **no** implica que el otro proyecto (`backend-inspecciones`)
sea código sin valor: la propia auditoría de 2026-08-17 identificó
componentes ahí que nunca se terminaron de portar (por ejemplo, un módulo
de generación de PDF dirigido por metadatos, más flexible que el actual
`scripts/generate_dossier_pdf.py`), que podrían rescatarse en el futuro
como una decisión aparte, sin relación con esta tarea.

**Lo que NO cambia con esta corrección de premisa:** la razón de
`ID_Socio`/`ID_Parcela_Fija` estar referenciados sin FK real desde
`EUDR_MONITOREO`/`INSPECCIONES` **dentro de este mismo repo** sigue siendo
válida — esa parte de la justificación de la baja lógica nunca dependió de
`backend-inspecciones`. Tampoco cambia nada del schema, de RLS, ni de la
lógica de negocio del Padrón — es una corrección de documentación sobre por
qué existían ciertas restricciones, no un cambio de esas restricciones en
sí (agregar la FK a `ORGANIZACIONES`, por ejemplo, sigue sin estar en
alcance de esta tarea).

## Contrato

1. **Fidelidad exacta al schema real.** La migración debe reflejar,
   columna por columna, tipo por tipo, nulabilidad y default por default,
   lo que existe hoy en la instancia viva — confirmado por introspección
   real (ver "Verificación en vivo" abajo), no por lo que documenta
   `docs/schema_live.md` en prosa (que, de hecho, no menciona una columna
   real que sí existe — ver hallazgo).
2. **Cero cambios de comportamiento.** `CREATE TABLE IF NOT EXISTS` —
   contra una tabla que ya existe, Postgres no ejecuta ni valida la
   definición de columnas del `CREATE TABLE`; es un no-op garantizado por
   la semántica del propio motor, no algo que dependa de que esta tarea
   haya acertado cada detalle. La migración es adopción de documentación,
   no una alteración de schema.
3. **Primary Key simple, tal cual existe hoy.** `ID_Socio` /
   `ID_Parcela_Fija` como PK de una sola columna — confirmado en vivo
   (introspección OpenAPI de PostgREST, ver abajo). Pasar a una PK
   compuesta o agregar un `id` sintético nuevo es la tarea siguiente de la
   secuencia (`multi_organizacion_codigos_unicos.md`), explícitamente
   fuera de esta.
4. **Sin RLS, sin índices adicionales, sin FKs nuevas.** Esta migración
   solo captura la forma de la tabla (`CREATE TABLE`) — las políticas RLS
   ya aplicadas (ver `CLAUDE.md`, "RLS gotcha") y cualquier índice
   existente más allá de la PK no se tocan ni se re-declaran acá, para no
   arriesgar una re-aplicación accidentalmente distinta de lo real.

## Verificación en vivo (previa a escribir la migración)

Introspección real vía el endpoint OpenAPI de PostgREST
(`GET {SUPABASE_URL}/rest/v1/` con `Accept: application/openapi+json`,
Service Role Key) — expone el schema real tal como Postgres lo reporta al
propio PostgREST, no una inferencia desde datos de ejemplo.

**Hallazgo confirmado, discrepancia real con `docs/schema_live.md`:**
`PADRON_SOCIOS` tiene una columna `normas_internas_17` (`text`) que no
está documentada en ningún lugar del repo — cero referencias en código,
specs, ADRs, ni migraciones (ya detectado en una auditoría previa de esta
misma secuencia de tareas). Se incluye en la migración porque el contrato
de este archivo es fidelidad exacta al schema real, no al schema
documentado — pero se deja explícitamente anotada como columna huérfana,
sin ningún uso conocido, para que la siguiente tarea de certificaciones
normalizadas decida si migra este dato o lo deja fuera del modelo nuevo.

**Segundo hallazgo, no buscado explícitamente:** `PADRON_PARCELAS.hbp`
(una de las 7 columnas de hectáreas por categoría de uso,
`hcp`/`hcc`/`ho`/`hip`/`hrp`/`hbp`/`otros_cultivo`) es `text` en la
instancia real, **no** `numeric` como sí lo son `hcp`/`hcc`/`ho`/`hip`/`hrp`
— y `otros_cultivo` también es `text`. `lib/validations/socios.js`
(`HECTARE_FIELDS`) trata los 7 como numéricos (`nonNegativeNum`,
coerción Zod) sin que esto haya causado un error observado — PostgREST
acepta un valor numérico serializado como string en una columna `text` sin
problema. La migración refleja el tipo real (`text`), no el tipo que
asume el código de validación; corregir esa discrepancia de tipos (si
amerita una migración `ALTER COLUMN` para volverlas consistentes) queda
fuera de esta tarea — se documenta acá para que quede visible antes de
diseñar los specs siguientes.

**Conteos base, antes de aplicar la migración (para la verificación de
no-op posterior):** `PADRON_SOCIOS` = 7 filas, `PADRON_PARCELAS` = 11
filas.

## Fuera de alcance (a propósito)

- Las otras 3 tareas de la secuencia de Cowork (unicidad por organización,
  certificaciones normalizadas, multi-producto café/cacao/cuyes).
- Agregar la FK `ID_Organizacion → ORGANIZACIONES` a estas 2 tablas (sigue
  bloqueada por lo que documenta ADR-007 sobre `ID_Organizacion`
  nuevos que puedan crearse primero desde otro flujo — eso no cambió con
  esta corrección de premisa, que solo retira el argumento de
  coordinación con `backend-inspecciones`).
- Corregir el tipo real de `hbp`/`otros_cultivo` (`text` en vez de
  `numeric`) — documentado como hallazgo, no corregido acá.
- Decidir qué hacer con `normas_internas_17` — documentado como hallazgo,
  no corregido acá.
