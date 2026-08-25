# ADR-023 — `backend-inspecciones` ya no comparte base de datos en vivo con este proyecto

- **Estado:** Aceptado — corrección de premisa
- **Fecha:** 2026-08-25
- **Migraciones:** `supabase/migrations/20260825183000_baseline_padron_socios_parcelas.sql`
  (tarea acompañante, ver `specs/padron_baseline_adopcion.md`)
- **Documentos corregidos:** `CLAUDE.md`, `docs/adr/ADR-002-padron-enterprise-y-baja-cascada.md`,
  `docs/adr/ADR-007-integridad-referencial-id-organizacion.md`

## Contexto

`docs/audits/auditoria_backend_inspecciones.md` (2026-08-17) confirmó un
hallazgo crítico: `backend-inspecciones` (un frontend Vite/React/TypeScript
separado, "Panel FED", originado como una migración manual desde Google
AppSheet) y este proyecto apuntaban al **mismo Postgres en vivo**
(project ref `jhtocgxlozfuzullrtol`). No eran dos bases de datos
independientes con esquemas parecidos — compartían literalmente las mismas
filas de `ORGANIZACIONES`, `PADRON_SOCIOS` y `PADRON_PARCELAS`.

Ese hallazgo se convirtió en una restricción de diseño real, citada
explícitamente en dos decisiones posteriores:

- **ADR-002** justificó la baja lógica (`activo = false`, nunca `DELETE`
  físico) citando, entre otras razones, que "el padrón es compartido en
  vivo con otro repositorio" y sus IDs podían estar referenciados desde
  ahí sin FK.
- **ADR-007** decidió explícitamente **no** agregar una FK real
  `PADRON_SOCIOS`/`PADRON_PARCELAS → ORGANIZACIONES`, pese a que los datos
  reales lo permitían sin fricción (0 huérfanos confirmados) — el riesgo
  citado fue que una FK agregada unilateralmente desde este repo empezara
  a rechazar `ID_Organizacion` nuevos creados primero desde el otro
  sistema (por ejemplo, un onboarding que arrancara del lado de
  `backend-inspecciones`).

## La corrección

El usuario confirmó directamente: `backend-inspecciones` **ya no comparte
base de datos en vivo con este proyecto**. Era una arquitectura anterior,
más pequeña, del mismo proyecto — y el único módulo de ese repo que
llegó a estar completamente funcional (el formulario de Inspección,
`INSPECCIONES` + 6 tablas `CAP_*`) ya fue portado a este mismo repositorio
como Fase 6 (`app/dashboard/inspecciones`, `lib/inspeccionesActions.js`,
confirmado en `docs/schema_live.md`) — exactamente la recomendación de
"alta prioridad" #1 que había dejado anotada la auditoría de 2026-08-17.
Esto no es una verificación que este repo pueda hacer por sí mismo (no hay
forma de introspeccionar el estado de un repositorio y una base de datos
externos desde acá) — es información directa del usuario sobre la
arquitectura actual del ecosistema más amplio del proyecto, igual que
cualquier otra decisión de negocio que este repo documenta a partir de lo
que confirma quien lo opera.

**Importante — esto no declara `backend-inspecciones` como código sin
valor.** La propia auditoría de 2026-08-17 identificó componentes ahí que
nunca se terminaron de portar a RYZOS: el más notable, un módulo de
generación de PDF dirigido por metadatos (`METADATOS_CAMPOS` +
`CONFIGURACION_REPORTES_ORG`, más flexible que el actual
`scripts/generate_dossier_pdf.py`, que tiene el layout hardcodeado). Ese
código podría rescatarse en el futuro como una decisión de portabilidad
aparte, evaluada por su propio mérito — lo único que este ADR resuelve es
la restricción de coordinación de base de datos compartida, no el valor
del resto de ese repositorio.

## Qué cambia

- **ADR-007:** el motivo de no agregar la FK `ID_Organizacion →
  ORGANIZACIONES` sobre `PADRON_SOCIOS`/`PADRON_PARCELAS` — evitar
  rechazar inserts de un repositorio externo — ya no aplica. Se deja una
  nota en ese documento señalando esto (sin reescribir su contenido
  histórico), **pero agregar la FK en sí sigue sin estar en el alcance de
  esta tarea** — es una decisión aparte, para cuando se retome
  específicamente ese tema.
- **ADR-002 / `CLAUDE.md`:** la justificación de la baja lógica
  mencionaba dos razones en la misma frase — "compartido en vivo con otro
  repositorio" **y** "IDs referenciados desde `INSPECCIONES`/
  `EUDR_MONITOREO` sin FK real". Se retira la primera; **la segunda sigue
  intacta y vigente**, porque `INSPECCIONES`/`EUDR_MONITOREO` son tablas
  de este mismo repo (Fase 6 e ETL respectivamente) que efectivamente
  referencian `ID_Socio`/`ID_Parcela_Fija` sin una FK real — ese riesgo
  nunca dependió de `backend-inspecciones`. La baja lógica sigue siendo la
  decisión correcta por esa razón, sola.

## Qué NO cambia

- El schema de `PADRON_SOCIOS`/`PADRON_PARCELAS` — sin alteraciones acá
  (ver la migración base acompañante, que es adopción de documentación,
  no un cambio de diseño).
- Ninguna política RLS.
- La decisión de no agregar la FK `→ ORGANIZACIONES` en sí — solo se
  retira uno de los dos motivos que la sostenían; si en el futuro se
  decide agregarla, es una tarea explícita aparte, no una consecuencia
  automática de este ADR.
- El valor de `backend-inspecciones` como código fuente de posibles
  portabilidades futuras (ver arriba).

## Consecuencias

- Documentación desbloqueada: la secuencia de 4 tareas de arquitectura
  decidida en la sesión de diseño de Cowork (unicidad de códigos por
  organización, certificaciones normalizadas, multi-producto
  café/cacao/cuyes, y esta adopción de baseline) ya no necesita cargar con
  una restricción de coordinación cross-repositorio que no es real hoy.
- No implica ningún cambio de código además del texto de documentación
  corregido — este ADR es puramente correctivo.
