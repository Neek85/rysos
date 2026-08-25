# ADR-002 — Padrón Enterprise: CSV Dividido, Pre-validación en Vivo y Baja en Cascada

- **Estado:** Aceptado
- **Fecha:** 2026-08-19
- **Migraciones:** `supabase/migrations/20260818_padron_baja_logica.sql`,
  `supabase/migrations/20260818_sync_parcelas_baja_por_socio_inactivo.sql`
- **Spec:** `specs/padron_web_socios.md` (sección "Actualización Enterprise")
- **Tests:** `tests/test_padron_csv.mjs`, `tests/test_socios_schema.mjs`
  (`node --test tests/*.mjs`)

> **Nota de numeración:** un prompt anterior pidió este documento como
> `ADR-004`. `docs/adr/` solo contiene `ADR-001` — no existen `ADR-002` ni
> `ADR-003` en ningún lugar del repositorio (verificado con `find` antes de
> escribir esto). Se numera `ADR-002` para no dejar un hueco en la
> secuencia sin ningún ADR-002/003 real que lo explique.

## Contexto

El módulo `/dashboard/socios` (Padrón Web de Socios y Fincas, ver
`specs/padron_web_socios.md`) ya tenía carga masiva por CSV y baja lógica
básica (`ADR` implícito en la spec original, commit `56f0a48`). Cuatro
gaps de uso real emergieron al operar el módulo con datos de cooperativas
reales:

1. **Duplicados solo se detectaban al confirmar la importación**, fila por
   fila — un archivo con 50 filas y el DNI #40 duplicado obligaba a
   corregir y reintentar sin saber de antemano cuántas otras filas también
   chocaban.
2. **La plantilla CSV descargable tenía un `ID_Socio` de ejemplo fijo**
   (`"JS-00001"`), que coincide con el primer socio real de los datos de
   prueba de este proyecto — importar la plantilla tal cual, sin editarla,
   producía un choque de PK inmediato.
3. **`createParcela` no verificaba que el socio referenciado existiera** en
   la organización activa antes de insertar — un `ID_Socio` mal tipeado
   (a mano o en un CSV importado) creaba una parcela huérfana sin ningún
   aviso.
4. **Dar de baja un socio no afectaba sus parcelas** — quedaban en
   `activo = true`, visibles y exportables como si el socio siguiera
   activo, en un padrón cuya UI y exports ya filtran por `activo = true`.

## Decisión

1. **Pre-validación síncrona contra la base en la vista previa de
   importación masiva** (`applySocioDbChecks`/`applyParcelaDbChecks`,
   `lib/padronCsv.js`). Antes de habilitar "Confirmar Importación", el
   frontend consulta `PADRON_SOCIOS`/`PADRON_PARCELAS` con `IN (...)` sobre
   los valores de DNI/Código de Socio/Código de Finca/Parcela Código
   presentes en el archivo (una consulta por campo, no N+1 por fila) y
   marca cada fila que colisiona con un motivo legible. El chequeo
   equivalente en la Server Action al confirmar (`assertDniNotDuplicated`,
   `assertCodigoFincaNotDuplicated`, `assertParcelaCodigoNotDuplicated`,
   `assertSocioExists`) **no se elimina** — sigue siendo la garantía real
   ante una carrera entre la vista previa y la confirmación; la
   pre-validación es puramente una mejora de UX, no reemplaza la
   validación de escritura.
2. **Plantillas CSV calculadas dinámicamente** (`buildSocioTemplateCsv`/
   `buildParcelaTemplateCsv` + `computeNextCodes`,
   `lib/parcelaDefaults.js`). El código de ejemplo en la plantilla
   descargada es el siguiente correlativo libre real de la organización
   activa, no un valor fijo — con fallback a un valor fijo si no hay
   conexión u organización nueva sin socios todavía, para que la descarga
   nunca se rompa por una consulta fallida.
3. **`assertSocioExists`** (`lib/actions/sociosActions.js`) — nueva
   verificación explícita en `createParcela`: el `ID_Socio` referenciado
   debe existir en la organización activa antes de insertar la parcela.
   Se distingue de `assertMatchesExistingOrg` (que valida el propio
   registro que se está editando/dando de baja, y omite el chequeo en
   silencio si no encuentra la fila — comportamiento correcto para ese
   caso) porque acá `ID_Socio` es una referencia a **otra** entidad que
   debe preexistir; omitir el chequeo en silencio habría permitido
   parcelas huérfanas.
4. **Baja lógica en cascada, nunca DELETE físico** — decisión heredada de
   la spec original (`activo = false`, no eliminación) y extendida acá:
   `deactivateSocio` ahora también marca `activo = false` en todas las
   filas de `PADRON_PARCELAS` del socio, en la misma llamada. Alcance
   **deliberadamente limitado a `PADRON_PARCELAS`**: no toca
   `EUDR_MONITOREO`, `EUDR_USO_SUELO`, `EUDR_INSTALACIONES`, ni las vistas
   WebGIS/EUDR (`vw_monitoreo_web`, `view_eudr_dashboard_aprobados`).

## Baja lógica vs. eliminación física — por qué (y por qué la cascada no rompe el historial EUDR)

> **Corrección de premisa (2026-08-25, ver
> [ADR-023](ADR-023-backend-inspecciones-ya-no-comparte-base.md)):**
> `backend-inspecciones` ya no comparte base de datos en vivo con este
> proyecto — el párrafo siguiente cita esa razón (compartido con otro
> repositorio) como parte de la justificación. Esa parte específica ya no
> aplica; la otra parte de la misma razón (`ID_Socio`/`ID_Parcela_Fija`
> referenciados desde `INSPECCIONES`/`EUDR_MONITOREO`, ambos **de este
> mismo repo**, sin FK real) sigue intacta y es, por sí sola, suficiente
> para sostener esta decisión. No se reescribe el párrafo original para
> mantener el registro histórico de por qué se decidió en su momento.

`PADRON_SOCIOS`/`PADRON_PARCELAS` son el padrón maestro, compartido en vivo
con otro repositorio (`backend-inspecciones`, mismo Postgres — ver
`docs/audits/auditoria_backend_inspecciones.md`), y sus IDs (`ID_Socio`,
`ID_Parcela_Fija`) pueden estar referenciados desde `INSPECCIONES` y desde
`EUDR_MONITOREO` **sin que exista una FK real que lo impida**. Un `DELETE`
físico:

- Dejaría inspecciones y registros de monitoreo EUDR ya aprobados
  apuntando a un `ID_Socio`/`ID_Parcela_Fija` que ya no existe — ruptura
  silenciosa de joins, no un error visible.
- Sería irreversible sin restaurar desde backup, para una acción que en la
  práctica es administrativa ("este productor ya no es socio de la
  cooperativa hoy"), no un borrado de datos erróneos.
- Rompería trazabilidad EUDR: el Reglamento (UE) 2023/1115 exige poder
  reconstruir el historial de debida diligencia de una parcela; que un
  productor deje la cooperativa no debe borrar evidencia de que su parcela
  fue monitoreada y aprobada en su momento.

La baja lógica (`activo = false`) resuelve esto: el registro deja de
aparecer en la UI activa (`page.jsx`), en los exports CSV (`exportSociosCsv`/
`exportParcelasCsv`, ambos filtran `activo = true`), y en las plantillas de
ejemplo (`fetchSampleSocioIds` solo trae `activo = true`) — pero sigue
existiendo para cualquier join histórico.

**La cascada a `PADRON_PARCELAS` no amplía este alcance al historial
EUDR — es la misma decisión aplicada consistentemente:** una parcela de un
socio dado de baja también debe dejar de aparecer como "padrón activo" (no
tendría sentido que el socio esté inactivo pero sus parcelas sigan
apareciendo como activas en el mismo padrón). La cascada se detiene
explícitamente en `PADRON_PARCELAS` — no toca `EUDR_MONITOREO` ni las
vistas de monitoreo/traceability, que deben seguir mostrando el historial
de esa parcela sin importar el estado administrativo actual del socio en
el padrón. Es la misma línea que ya trazó `ADR-001` entre "tabla base
operativa" (donde se aplican reglas de negocio activas) y "vistas de
lectura EUDR" (que deben permanecer estables para cumplimiento).

## Alternativas consideradas

- **`DELETE` físico con `ON DELETE CASCADE` hacia `EUDR_MONITOREO`:**
  descartada de plano — borraría evidencia de cumplimiento EUDR real, el
  caso de uso central de este sistema.
- **Baja lógica de socio sin cascada a parcelas** (dejar que el usuario dé
  de baja cada parcela manualmente): descartada — el gap real observado
  (parcelas "huérfanas" activas de un socio inactivo) es el motivo de esta
  decisión; exigir N pasos manuales por cada parcela del socio no elimina
  el riesgo, solo lo hace más probable por olvido.
- **Cascada también hacia `EUDR_MONITOREO`** (marcar inactivos los
  registros de monitoreo de las parcelas dadas de baja): descartada
  explícitamente — confundiría estado administrativo del padrón
  (¿es socio hoy?) con estado de cumplimiento EUDR (¿esta parcela fue
  monitoreada y aprobada?), que deben poder divergir sin perder ninguno de
  los dos.

## Consecuencias

- Positivo: una carga masiva con datos sucios se corrige de una vez en la
  vista previa, no fila por fila tras cada intento de confirmación.
  Positivo: plantillas descargables ya no chocan con datos reales de
  prueba del proyecto ni requieren edición manual del ID de ejemplo antes
  de poder importarlas.
- Positivo: imposible crear una parcela huérfana (referencia a un socio
  inexistente) desde el formulario ni desde importación masiva.
- Positivo: dar de baja un socio deja su padrón de parcelas consistente en
  una sola operación, sin dejar activo = true residual.
- **Hallazgo no solicitado, documentado acá por pedido de convención de
  sesión (ver `specs/padron_web_socios.md`):** los 11 archivos
  `tests/*.mjs` del proyecto (Node test runner nativo, incluidos los 2 de
  este módulo con 177 tests en total) **no están conectados a ningún paso
  de CI** — `.github/workflows/test_and_deploy.yml` solo ejecuta
  `python -m pytest tests/ -v --tb=short`. Hoy dependen de que alguien los
  corra manualmente (`node --test tests/*.mjs`) antes de mergear un cambio
  a `lib/padronCsv.js`/`lib/validations/socios.js`/`lib/parcelaDefaults.js`
  — una regresión en esos archivos no rompería el pipeline de CI actual.
  Cerrar este gap (agregar un step de `node --test tests/*.mjs` al
  workflow) queda fuera del alcance de esta tarea de documentación.
- Pendiente (no verificable en este entorno): confirmar que las dos
  migraciones de esta actualización (`20260818_padron_baja_logica.sql`,
  `20260818_sync_parcelas_baja_por_socio_inactivo.sql`) están aplicadas
  contra la instancia Supabase `jhtocgxlozfuzullrtol` — mismo caveat que
  `ADR-001`, sin conexión Postgres directa desde este entorno.
