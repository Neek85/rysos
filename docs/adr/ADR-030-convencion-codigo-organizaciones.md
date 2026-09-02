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
