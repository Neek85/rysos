# ADR-027 — Normalización de certificaciones: 5 tablas nuevas reemplazan las columnas planas de `PADRON_SOCIOS`

- **Estado:** Aceptado — migración escrita, código de aplicación
  actualizado, tests nuevos pasando. Pendiente de aplicación manual en
  Supabase Studio (mismo flujo de siempre en este repo); los tests Live
  se auto-saltan hasta entonces.
- **Fecha:** 2026-08-25
- **Migraciones:** `supabase/migrations/20260825222933_certificaciones_normalizadas.sql`
- **Spec:** `specs/padron_certificaciones_normalizado.md` (5 rondas de
  auditoría — contrato de datos en la sección 2, RLS/GRANTs relevados en
  la sección 7, estado de esta implementación en la sección 8)
- **Tests:** `tests/test_certificaciones_normalizadas.py`
  (`TestMigrationFileStatic`: 16 casos, estructura de la migración,
  siempre corre; `TestCertificacionesNormalizadasLive`: 5 casos
  funcionales contra Supabase Live, auto-skip hasta aplicar la
  migración), `tests/test_certificaciones_sociosactions_code_sites.mjs`
  (8 casos estructurales sobre `sociosActions.js`), más los casos nuevos
  de columnas dinámicas/rechazo de columna no reconocida agregados a
  `tests/test_padron_csv.mjs`.
- **Contexto previo:** `ADR-026` (PK surrogate `id` UUID en
  `PADRON_SOCIOS`/`PADRON_PARCELAS` — habilita las FK reales que usan
  `SOCIO_CERTIFICACIONES`/`PARCELA_CERTIFICACIONES`), `ADR-002` (baja
  lógica del padrón — mismo criterio de "nunca borrar físicamente" que
  informa por qué las columnas viejas quedan congeladas en vez de
  eliminadas).

## Contexto

`PADRON_SOCIOS` almacenaba certificaciones como 8 columnas de flag
`text` (`'Sí'`/`'No'`/`NULL`, no `boolean`) más dos campos de texto
libre (`certificaciones`, `cert_org_estatus`), sin ninguna estructura
relacional: sin catálogo, sin agencia certificadora, sin fecha de
obtención/vencimiento, sin forma de que una organización o una parcela
(no solo un socio) tuviera sus propias certificaciones. La auditoría de
5 rondas (`specs/padron_certificaciones_normalizado.md`) confirmó en
vivo, entre otras cosas: que las columnas son `text` no `boolean`; un
caso real (JS-00003) donde `certificaciones` no es derivable de los
flags; una tabla huérfana (`NORMAS`) con un bloque de columnas similar
pero desconectado de este módulo (confirmado fuera de alcance); y que
el importador CSV es CSV, no Excel, y no tocaba estas columnas en
absoluto hasta ahora.

## Decisión

**5 tablas nuevas**, contrato cerrado en la ronda 4 de la spec
(sección 2):

- `CERTIFICACIONES_CATALOGO` (`id`/`codigo`/`nombre`/`activo`/`creado_en`)
  — catálogo puro, sembrado con las 8 filas que ya representaban los 8
  flags.
- `AGENCIAS_CERTIFICADORAS` — vacía, sin seed.
- `ORGANIZACION_CERTIFICACIONES` — certificaciones a nivel organización,
  con FK real a `ORGANIZACIONES."ID"` (`text`), agencia/fechas.
- `SOCIO_CERTIFICACIONES` — `id_socio` UUID FK a `PADRON_SOCIOS(id)`
  (ADR-026), `id_organizacion` **denormalizado sin FK propia** (mismo
  patrón que otras columnas de `PADRON_PARCELAS`), `estado` libre.
- `PARCELA_CERTIFICACIONES` — igual que la de socio pero de presencia
  pura (sin `estado`): la fila existe = la parcela tiene esa
  certificación.

**Las columnas viejas de `PADRON_SOCIOS` NO se eliminan** — quedan
físicamente presentes, congeladas en su último valor, como respaldo
(decisión explícita de la ronda 4). Esto evita tener que recrear las 3
vistas que dependen de `certificaciones`
(`view_eudr_dashboard_aprobados`/`vw_monitoreo_eudr_aprobado`/`vw_socios_web`)
en esta migración — su retiro físico (`DROP COLUMN`) queda para una
tarea de limpieza aparte, después de confirmar que nada las sigue
leyendo.

**RLS/GRANTs** replican exactamente el patrón ya establecido para
`PADRON_SOCIOS`/`PADRON_PARCELAS` (sección 7.1 de la spec): los 2
catálogos (`CERTIFICACIONES_CATALOGO`/`AGENCIAS_CERTIFICADORAS`) usan
`SELECT` abierto para `anon` (`USING (true)`, sin dato de organización
que filtrar); las 3 tablas de relación usan `SELECT` para `anon` con
`USING (id_organizacion IS NOT NULL)`. Ninguna de las 5 tiene política
de escritura para `anon` — las escrituras siguen exclusivas de Server
Actions con Service Role Key. GRANTs declarados explícitos y
defensivos (spec 7.2: no existe ningún `GRANT` versionado para las
tablas del padrón, ni forma de confirmar el privilegio por defecto de
Supabase sin SQL crudo).

**Excepción documentada:** `SOCIO_CERTIFICACIONES` recibe además
`GRANT DELETE` para `service_role`, más allá de lo pedido originalmente
(`SELECT`/`INSERT`/`UPDATE`). Motivo: `updateSocio` sincroniza el set
completo de certificaciones de un socio en cada guardado
(borrar-todo-y-reinsertar, ver abajo), y la tabla no tiene columna de
baja lógica — sin `DELETE`, destildar una certificación en una edición
sería imposible de guardar.

**Backfill** de los 7 socios reales: por cada columna en `'Sí'`, una
fila en `SOCIO_CERTIFICACIONES`. `estado` copia `cert_org_estatus` del
socio **solo** para las 5 certificaciones de tipo "equivalencia
orgánica" (`NOP_USDA`/`UE_2018_848`/`COR_CANADA`/`DS_0442006_AG`/`LPO_MX`
— interpretación documentada con su evidencia en la sección 3.4 de la
spec, no una lectura literal de ningún nombre de catálogo); las otras 3
quedan con `estado = NULL`. Idempotente **por socio**, no por fila: si
`SOCIO_CERTIFICACIONES` ya tiene alguna fila para un `id_socio`, ese
socio se saltea entero en una segunda corrida.

**`createSocio`/`updateSocio`** (`lib/actions/sociosActions.js`) dejan
de escribir las 8 columnas planas y `cert_org_estatus`/`certificaciones`
(`socioPayload` ya no las incluye). El formulario y `socioSchema` NO
cambiaron de forma — siguen validando los mismos 8 campos `Sí`/`No` de
siempre — pero ese payload ahora se traduce a `SOCIO_CERTIFICACIONES`
vía `syncSocioCertificaciones`: resuelve el catálogo activo, borra
todas las filas del socio y reinserta solo las marcadas `'Sí'`. Se
eligió "borrar todo y reinsertar" en vez de un `upsert` porque la tabla
es de presencia pura: no hay forma de "des-marcar" una fila existente
salvo borrándola. Costo aceptado: refresca `creado_en` de
certificaciones que no cambiaron; sin transacción real entre el
`DELETE` y el `INSERT` (mismo patrón ya aceptado en `deactivateSocio`).

**CSV** (`lib/padronCsv.js`): las columnas fijas de certificación se
retiran del export/plantilla/import; en su lugar, una columna dinámica
por cada fila `activo = true` del catálogo, con `nombre` como
encabezado — diseño cerrado en la sección 6.1 de la spec. Internamente
se traduce de vuelta al mismo campo fijo de siempre (`cert_nop_usda`,
etc., vía un mapeo `codigo → field`), así que `createSocio`/
`socioSchema` no necesitaron cambiar de forma por este lado tampoco. Una
columna del archivo que no matchea ningún campo fijo conocido **ni**
el nombre de una certificación activa **rechaza el archivo completo**
(lanza, no marca fila por fila) — nunca se ignora en silencio, para que
un typo o una certificación desactivada no se pierdan sin que el
usuario se entere.

## Consecuencias

- **Pendiente, diferido a propósito:** `lib/sociosSearch.js`,
  `app/dashboard/socios/page.jsx` y `SocioFormModal.jsx` siguen
  leyendo/mostrando las 8 columnas viejas al usuario final. Como ya no
  se escriben, un socio creado/editado después de esta migración queda
  con esas columnas congeladas en su valor previo — lo que la tabla/
  formulario muestran para certificaciones puede quedar desactualizado.
  No se resolvió acá por ser un alcance de rediseño de UI, no una
  extensión mecánica (ver sección 8.1 de la spec). No rompe nada
  mientras tanto.
- El retiro físico de las 8 columnas + `cert_org_estatus`/
  `certificaciones` de `PADRON_SOCIOS` (y la recreación de las 3 vistas
  dependientes) queda como una tarea de limpieza separada, después de
  confirmar que el ítem anterior ya no las necesita.
- Una certificación activa que se agregue al catálogo sin un `codigo`
  presente en `CODIGO_TO_FIELD` (`lib/padronCsv.js`) queda fuera del
  CSV — limitación conocida, documentada en el propio código; no afecta
  al alta/edición manual vía `SOCIO_CERTIFICACIONES` directamente.
