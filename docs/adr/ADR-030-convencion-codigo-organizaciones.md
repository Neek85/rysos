# ADR-030 — Convención de código `TIPO-SLUG` para `"ID"` de `ORGANIZACIONES`

- **Estado:** Aceptado
- **Fecha:** 2026-08-27
- **Spec relacionada:** `specs/alta_organizacion_real.md` (runbook operativo
  que usa esta convención)
- **Contexto previo:** `docs/schema_live.md` (sección `ORGANIZACIONES`,
  confirmado en vivo vía OpenAPI de PostgREST: `"ID"` es `text`, Primary
  Key, **sin `default`** — no hay `serial`/`uuid` autogenerado detrás,
  y sin ningún `CHECK` de formato en la base)

## Contexto

`ORGANIZACIONES."ID"` es un código de texto elegido a mano — la base no
fuerza ningún formato (confirmado en vivo: sin `default`, sin `CHECK`).
Hasta ahora existían 2 filas históricas (`COOP-JS`, `COOP-ND`) más una de
prueba (`ORG-TEST-E2E`) — ninguna documentaba explícitamente qué patrón
seguía el prefijo, ni si `-JS`/`-ND` eran iniciales del nombre o un
código arbitrario. Con la limpieza de datos de prueba (`ORGANIZACIONES`
vaciada) y el alta de la primera organización real del sistema en
producción, `COOP-AROMAS-VALLE` (`ORGANIZACIONES."Nombre_Organizacion" =
"COOPERATIVA AGRARIA AROMAS DEL VALLE"`), corresponde fijar la
convención hacia adelante en vez de seguir eligiendo códigos ad-hoc.

## Decisión

**Convención `TIPO-SLUG`:**

- **`TIPO`** — prefijo corto que identifica la naturaleza jurídica de la
  organización. **Hoy solo existe un caso real: `COOP`** (cooperativa),
  usado por `COOP-AROMAS-VALLE`. Otros prefijos plausibles a futuro —
  `ASOC` (asociación), `EMP` (empresa privada), u otros — **se definen
  recién cuando aparezca el primer caso real de ese tipo**, no antes. No
  se reserva ni se documenta un prefijo sin una organización real que lo
  use — evita fijar una convención sobre un caso hipotético que termine
  sin encajar con cómo se nombra la organización real cuando aparezca.
- **`SLUG`** — versión legible en mayúsculas del nombre de la
  organización, sin tildes ni caracteres especiales, palabras separadas
  por `-`. Ejemplo real: "Cooperativa Agraria Aromas del Valle" →
  `AROMAS-VALLE` (se omiten palabras genéricas del tipo de entidad ya
  cubiertas por el prefijo — "Cooperativa"/"Agraria" — y artículos/
  preposiciones — "del" —, quedando el nombre distintivo).

**Ejemplo real:** `COOP-AROMAS-VALLE`.

**Sin validación automática.** Es disciplina de equipo al momento de
elegir el código (paso 1 del runbook en `specs/alta_organizacion_real.md`
ya exige verificar que el código propuesto no exista antes de insertar),
no una regla exigida por la base de datos. Un `CHECK` por regex sobre
`"ID"` (ej. `^[A-Z]+-[A-Z0-9-]+$`) queda como **idea futura**, solo si el
alta de organizaciones se vuelve lo bastante frecuente como para
justificar el costo de una migración que agregue esa restricción — no
se implementa en este ADR.

## Consecuencias

- El código de una organización, una vez elegido e insertado, no está
  pensado para cambiar — es la Primary Key, y trabajo previo del
  proyecto (ver ADR-002, baja lógica) ya asume que los códigos de
  entidades del padrón son estables en el tiempo. Elegir bien el slug la
  primera vez importa más que en una PK autogenerada.
- Si en el futuro aparece la primera organización de un tipo jurídico
  distinto a cooperativa, ese es el momento de definir su prefijo real
  (y, si corresponde, agregar una entrada a este ADR documentándolo) —
  no antes.
- No se toca el schema de `ORGANIZACIONES` en este ADR — es una
  convención de valores, no un cambio de columna/constraint.

## Extensión (2026-09-10) — segundo tipo real: `GRANJA`

Apareció el primer caso real de una organización que no es cooperativa:
**Granja Valencia**, el tenant piloto del módulo Pecuario Cuyes MVP (ver
`specs/pecuario_cuyes_mvp.md`, `docs/schema_live_pecuario.md`). Siguiendo
la regla ya fijada arriba ("se define recién cuando aparezca el primer
caso real"), se agrega:

- **`GRANJA`** — explotación pecuaria/agropecuaria individual (no
  cooperativa). Primer y único caso real: `GRANJA-VALENCIA`
  (`Nombre_Organizacion` = "Granja Valencia").

**Slug igual que antes:** versión legible en mayúsculas del nombre
distintivo, sin la palabra genérica del tipo ("Granja" ya la cubre el
prefijo) — "Granja Valencia" → `VALENCIA`... pero acá se prefirió
mantener `GRANJA-VALENCIA` completo (repitiendo "Valencia" no aporta
ambigüedad porque es un nombre propio corto de una sola palabra, y
`GRANJA-VALENCIA` es más legible en logs/UI que un slug de una sola
palabra) — la regla de "omitir palabras genéricas" sigue aplicando para
organizaciones con nombres más largos; no es una excepción a la
convención, es cómo se resuelve cuando el nombre distintivo es una sola
palabra corta.

Sigue sin haber validación automática (`CHECK`) sobre `"ID"` — misma
decisión que el cuerpo original de este ADR.
