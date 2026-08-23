# ADR-011 — Cobertura completa de subdivisiones de Uso de Suelo (Fase B)

- **Estado:** Aceptado, verificado en vivo, y **corregido el mismo día**
  (ver sección "Corrección: de bloqueante a informativo" al final — el
  diseño original de bloqueo tenía un círculo imposible real, confirmado
  en vivo con 3 registros/parcelas reales).
- **Fecha:** 2026-08-23 (corrección: mismo día)
- **Migración:** `supabase/migrations/20260823_155621_fn_cobertura_uso_suelo_parcela.sql`
  (aplicada por el usuario en Supabase Studio — **sin cambios en la
  corrección**, sigue devolviendo `hueco_cobertura`/`bloquea_aprobacion`
  tal cual; solo cambió cómo el frontend los interpreta)
- **Código:** `app/api/qc/cobertura-uso-suelo/route.js`,
  `lib/qcCoberturaUsoSuelo.js`,
  `app/dashboard/qc/components/QcDetailEditor.jsx`
- **Investigación previa:** Fase B — Paso 1 de 2 (evaluación de
  `PADRON_PARCELAS.totalh`, sin ADR propio — resultados resumidos abajo)
- **Tests:** `tests/test_qc_cobertura_uso_suelo.mjs`

## Reglas de negocio (confirmadas, no reinterpretadas — la RPC no cambió)

1. Para una parcela (identificada por su `EUDR_MONITOREO`):
   - `area_monitoreo_ha`: área real del perímetro (`fn_calcular_area_ha`).
   - `totalh_padron_ha`: `PADRON_PARCELAS.totalh` vía `ID_Parcela_Fija`.
     `NULL` o `0` se tratan como "no disponible", nunca como `0` real.
   - `suma_uso_suelo_aprobado_ha`: suma de `area_calculada_ha` de las
     subdivisiones `EUDR_USO_SUELO` vinculadas vía `qfield_relation_id`
     (el join **real** de ADR-010, nunca el heurístico espacial de
     ADR-005/Fase A), filtrando solo `estado_revision = 'APROBADO'`.
2. **Hueco (el único criterio que bloquea):**
   `(area_monitoreo_ha - suma_uso_suelo_aprobado_ha) / area_monitoreo_ha > 0.05`
   → `hueco_cobertura = true`.
3. **`bloquea_aprobacion` es idéntico a `hueco_cobertura`.**
   `totalh_padron_ha` **nunca participa** en esta decisión, en ninguna
   dirección.
4. **Divergencia informativa (nunca bloquea):** si `totalh_padron_ha` está
   disponible, se calcula y muestra el % de diferencia contra
   `area_monitoreo_ha`, etiquetado explícitamente "Dato del Padrón — puede
   no ser confiable, ver ADR-011".

## Por qué `totalh` quedó completamente fuera de la decisión de bloqueo

La investigación previa (Fase B — Paso 1) ya había encontrado, con solo 2
casos reales disponibles, que `totalh` divergía masivamente del área real
del perímetro (52.6%–993.7% de diferencia según cómo se calculara) y que
el sistema de origen (AppSheet, compartido con otro repositorio sin
migraciones versionadas) es un riesgo real y documentado, no especulación.

**El caso concreto que decidió la regla:** `COOP-JS-003`
(`EUDR_MONITOREO` real `10425cbd-3d3e-51c3-b529-3a05c5610282`):

| Campo | Valor real |
|---|---|
| `area_monitoreo_ha` | 24.6072 ha |
| `totalh_padron_ha` | 2.25 ha |
| `suma_uso_suelo_aprobado_ha` (si sus 2 subdivisiones estuvieran aprobadas) | 15.0443 ha |
| Hueco real (`area_monitoreo_ha` vs. suma) | **38.86% ≈ 38.9%** |

Si `totalh` hubiera participado en la decisión de cualquier forma — por
ejemplo, comparando la suma de subdivisiones (15.0443 ha) contra `totalh`
(2.25 ha) en vez de contra el área real del perímetro — el resultado
habría sido "la suma ya excede varias veces el total del Padrón, no hay
hueco", **enmascarando por completo un hueco de cobertura real del
38.9%**. Esto es evidencia directa y concreta (no hipotética) de que
usar `totalh` en la decisión de bloqueo habría producido el resultado
opuesto al correcto en un caso real. Por eso la regla es tajante: `totalh`
nunca entra en la fórmula de `hueco_cobertura`/`bloquea_aprobacion`, solo
se muestra aparte, con su aviso de posible no confiabilidad.

## Diseño: resolución del vínculo vive en la ruta, no en la función SQL

`fn_cobertura_uso_suelo_parcela(p_monitoreo_id uuid)` asume que ya se le
pasó un `EUDR_MONITOREO` real y resuelto — igual que
`fn_validar_topologia_eudr` asume `(tabla_origen, registro_id)` ya
resueltos por el caller. La resolución real — "dado un `EUDR_USO_SUELO`
en revisión, ¿cuál es su `EUDR_MONITOREO` padre?" — vive en
`app/api/qc/cobertura-uso-suelo/route.js`:

1. Lee `id_parcela` del `EUDR_USO_SUELO` solicitado.
2. Si es `NULL` → responde el caso "sin vínculo" (ver abajo) sin llamar
   la RPC.
3. Busca `EUDR_MONITOREO` donde `qfield_relation_id = id_parcela` **y**
   `ID_Organizacion` coincide (defensa en profundidad — `CLAUDE.md` exige
   `ID_Organizacion` en toda consulta a tablas transaccionales).
4. Si el resultado no es **exactamente 1** fila (0, o más de una —
   ambigüedad nunca se asume, mismo criterio ya establecido en Fase
   A/B0) → responde el caso "sin vínculo".
5. Solo si hay exactamente 1 match, llama a la RPC con ese
   `id_monitoreo`.

### Caso "sin vínculo" — nunca un bloqueo silencioso

`buildSinVinculoResult()` (`lib/qcCoberturaUsoSuelo.js`) devuelve
explícitamente `{ vinculo_disponible: false, bloquea_aprobacion: false,
hueco_cobertura: false, mensaje: "No se pudo determinar la parcela madre
de este registro — revisar manualmente." }` — confirmado en vivo contra
la ruta real corriendo (no solo por inspección de código): se insertó un
`EUDR_USO_SUELO` desechable con un `id_parcela` que no coincide con
ningún `EUDR_MONITOREO`, se llamó `POST /api/qc/cobertura-uso-suelo` real
contra el servidor de desarrollo, y la respuesta fue exactamente:

```json
{"result":{"vinculo_disponible":false,"hueco_cobertura":false,"bloquea_aprobacion":false,"mensaje":"No se pudo determinar la parcela madre de este registro — revisar manualmente."}}
```

`bloquea_aprobacion: false` explícito — nunca `true` por defecto ni por
ausencia de dato.

## Frontend (estado actual, tras la corrección de más abajo)

Sección "Cobertura de la parcela" en `QcDetailEditor.jsx`, visible solo
para registros `EUDR_USO_SUELO`, **buscada automáticamente al
seleccionar el registro** (no detrás de un botón manual como "Validar
Topología") — para que el dato ya esté disponible apenas el revisor abre
el registro, sin depender de que alguien decida revisar la cobertura
primero. Muestra área de Monitoreo, suma de subdivisiones aprobadas,
badge de % de cobertura, y — en una sub-sección visualmente separada
(fondo blanco liso, texto gris, sin badge de color, menor énfasis que el
resto del panel) — el dato de `totalh` con su etiqueta "Dato del Padrón —
puede no ser confiable, ver ADR-011" y el % de divergencia si está
disponible.

Cuando `hueco_cobertura = true`, se muestra un aviso **informativo**
(fondo ámbar, `bg-amber-50 text-amber-800` — mismo estilo que la alerta
de "Solapado X%" de Fase A): "Cobertura parcial: X% de la parcela
clasificado — revisá si faltan subdivisiones por registrar antes de
considerar esta parcela completa." **Nunca menciona `totalh`**, porque no
participa en `hueco_cobertura`. El botón "Aprobar" **ya no depende de
`coberturaResult` en absoluto** (`disabled={busy}`, igual que cualquier
otro registro) — ver la corrección abajo. El botón "Rechazar" tampoco
dependió nunca de esto.

## Bug real encontrado probando en el navegador (no solo con curl)

Antes de dar el frontend por terminado, se abrió `/dashboard/qc` real en
Chrome y se seleccionó un registro de Uso de Suelo: el panel "Cobertura
de la parcela" mostraba `Registro EUDR_USO_SUELO 1 no encontrado.` — el
`useEffect` nuevo enviaba `record.registro_id` (el campo que se había
asumido como "el id real de la fila" por analogía con
`lib/eudrQcActions.js`), pero el campo real que usa el resto de la
consola para identificar una fila es `record.id_origen` — confirmado
contra `resolveUpdateTarget` (`lib/eudrQcActions.js`) y la llamada ya
existente a `/api/qc/validate-spatial` en `page.jsx` (línea 194,
`registro_id: record.id_origen`). Corregido (`record.id_origen` en las
dos referencias del `useEffect`), recargado en el navegador real, y
confirmado visualmente: área Monitoreo 4.22 ha, subdivisiones aprobadas
0.00 ha, cobertura 0%, `totalh` mostrado aparte (2.00 ha, diverge
52.59%), mensaje de bloqueo correcto, botón "Aprobar" visualmente
deshabilitado y "Rechazar" habilitado — sin errores de consola.

## Verificación en vivo — los 3 escenarios pedidos

**(a) `COOP-JS-003` — el caso real que motivó el diseño.** Se marcaron
temporalmente `APROBADO` las 2 subdivisiones reales (`id=19`, `id=20`,
normalmente `PENDIENTE`), se llamó la RPC real, y se revirtieron
inmediatamente después a su estado original:

```json
{"hueco_cobertura": true, "bloquea_aprobacion": true, "area_monitoreo_ha": 24.6072,
 "suma_uso_suelo_aprobado_ha": 15.0443, "totalh_padron_ha": 2.25, "divergencia_totalh_pct": 90.86}
```

`bloquea_aprobacion: true`, hueco real 38.86% ≈ 38.9% — confirmado, **sin
importar** que `totalh_padron_ha` (2.25) sea incluso menor que la propia
suma de subdivisiones (15.0443), lo que habría sugerido "sin hueco" si
`totalh` hubiera participado. `id=19`/`id=20` confirmados de vuelta en
`PENDIENTE` tras la prueba (su estado real, sin cambios permanentes).

**(b) Fixture de cobertura completa.** Perímetro de Monitoreo y
subdivisión de Uso de Suelo con la **misma geometría exacta** (492.068
ha ambos, `ID_Parcela_Fija` sintético sin fila en `PADRON_PARCELAS`):

```json
{"hueco_cobertura": false, "bloquea_aprobacion": false, "area_monitoreo_ha": 492.068,
 "suma_uso_suelo_aprobado_ha": 492.068, "totalh_padron_ha": null, "divergencia_totalh_pct": null}
```

No bloquea — confirmado. `totalh_padron_ha: null` en este caso también
confirma, de paso, que la ausencia de `totalh` no afecta el resultado
"no bloquea" tampoco.

**(c) Fixture con `totalh` NULL y cobertura parcial real.** Perímetro de
491.7018 ha con una única subdivisión de 122.926 ha aprobada (75%+ de
hueco real), `ID_Parcela_Fija` sintético sin fila en `PADRON_PARCELAS`:

```json
{"hueco_cobertura": true, "bloquea_aprobacion": true, "area_monitoreo_ha": 491.7018,
 "suma_uso_suelo_aprobado_ha": 122.926, "totalh_padron_ha": null, "divergencia_totalh_pct": null}
```

El bloqueo se evalúa exactamente igual que en cualquier otro caso, sin
ningún manejo especial para `totalh_padron_ha: null` — confirma que la
función nunca necesitó (ni tiene) un caso especial para "totalh
ausente", porque nunca lo usa para decidir.

**Limpieza:** los 3 fixtures desechables ((b): 1 Monitoreo + 1 Uso de
Suelo; (c): 1 Monitoreo + 1 Uso de Suelo; más un 4º fixture usado para
confirmar en vivo el caso "sin vínculo": 1 Uso de Suelo suelto) se
borraron por `id`/`id_monitoreo` inmediatamente después de cada prueba —
conteos verificados en 2→0 (Monitoreo), 2→0 y luego 1→0 (Uso de Suelo),
sin nada residual. Los 2 registros reales usados en el escenario (a)
quedaron confirmados de vuelta en su estado original (`PENDIENTE`).

## Corrección (mismo día): de bloqueante a informativo

### El hallazgo real: un círculo imposible

Tras dar la tarea original por terminada, el usuario reportó — con
capturas reales de 3 registros distintos, 2 parcelas distintas
(`COOP-JS-001` vía `id=18`, `COOP-JS-003` vía `id=19` e `id=20`) — que
**los 3 mostraban "Subdivisiones aprobadas: 0.00 ha" y quedaban
bloqueados sin excepción**, sin importar la parcela.

La causa, confirmada analíticamente contra la SQL real de
`fn_cobertura_uso_suelo_parcela` (sin necesidad de tocar la base para
verificarlo — la lectura del código ya lo demuestra):

```sql
SELECT COALESCE(SUM(area_calculada_ha), 0) INTO v_suma_uso_suelo_ha
FROM public."EUDR_USO_SUELO"
WHERE id_parcela = v_qfield_relation_id
  AND "ID_Organizacion" = v_org
  AND estado_revision = 'APROBADO';
```

La suma solo cuenta subdivisiones **ya** `APROBADO` — el registro que se
está revisando en ese momento, por definición, todavía no lo está. Para
la ÚLTIMA subdivisión que le falta a una parcela para llegar al 95% de
cobertura, el candado se evalúa siempre **antes** de que esa aprobación
cuente, así que nunca puede contarse a sí misma — el candado que decide
si puede aprobarse nunca puede pasar por su propia aprobación. Esto no
es un caso raro: es estructural, para **cualquier** parcela con
**cualquier** cantidad de subdivisiones, la última necesaria para
completar la cobertura queda bloqueada para siempre.

### Decisión: la cobertura pasa a ser informativa, nunca bloqueante

Mismo patrón ya usado y probado para "Solapado X%" en Fase A: informa,
nunca bloquea. `fn_cobertura_uso_suelo_parcela` **no se tocó** — sigue
calculando y devolviendo `hueco_cobertura`/`bloquea_aprobacion` tal cual
(son datos reales y útiles, y es razonable que se reutilicen cuando se
investigue el punto de control real — ver pendiente abajo). El cambio es
enteramente del lado del frontend:

- `lib/qcCoberturaUsoSuelo.js`: `buildBloqueoMensaje` (mensaje rojo, "no
  se puede aprobar") se reemplazó por `buildCoberturaAvisoMensaje`
  (mensaje ámbar, "Cobertura parcial: X%... revisá si faltan
  subdivisiones..."), activado por `hueco_cobertura` en vez de
  `bloquea_aprobacion` (mismo valor hoy, pero la lectura correcta ya es
  "hay un hueco que informar", no "hay que bloquear").
- `QcDetailEditor.jsx`: el botón "Aprobar" volvió a `disabled={busy}` —
  ya no lee `coberturaResult` en absoluto. El mensaje rojo junto a los
  botones se eliminó; el aviso ámbar ahora vive dentro del propio panel
  "Cobertura de la parcela", en el mismo lugar donde vive el aviso de
  "Solapado X%" dentro de "Validación topológica & EUDR".

### Verificación en vivo tras la corrección

Se repitieron los mismos registros reales que las capturas del usuario:

- **`id=18` (COOP-JS-001, 0% de cobertura):** el botón "Aprobar" está
  habilitado (mismo estilo que cualquier registro sin problemas), y el
  panel muestra el aviso ámbar "Cobertura parcial: 0% de la parcela
  clasificado — revisá si faltan subdivisiones por registrar antes de
  considerar esta parcela completa." — informativo, no bloquea.
- **`id=19`/`id=20` (COOP-JS-003, 0% de cobertura cada uno antes de
  aprobar):** mismo resultado — "Aprobar" habilitado, aviso ámbar visible.
- **Caso contrario (el círculo roto, en la práctica):** se aprobó
  realmente `id=18` a través del botón "Aprobar" real (no un fixture) —
  la aprobación se ejecutó sin bloqueo. Se volvió a calcular la cobertura
  de `COOP-JS-001` (`id_monitoreo = b2f305a0-...`) y el resultado reflejó
  la aprobación: `suma_uso_suelo_aprobado_ha` pasó de `0` a `0.9455` (el
  área de `id=18`), `hueco_cobertura` recalculado sobre el nuevo total —
  confirma que `fn_cobertura_uso_suelo_parcela` sigue funcionando
  correctamente para el cálculo informativo; solo cambió el efecto del
  bloqueo, no el cálculo en sí. `id=18` se revirtió a `PENDIENTE`
  inmediatamente después para dejar el dataset de referencia como estaba.

## Pendiente — fuera de alcance de esta tarea

**Dónde debe aplicarse el control real de "esta parcela debe estar 100%
cubierta" antes de considerarla lista para exportar/certificar — no
decidido en esta tarea.** Probablemente ligado a la exportación DDS ya
visible en `/dashboard/mapa`, pero esa decisión de diseño queda
explícitamente para una investigación futura separada, no se decide ni
se toca acá. `hueco_cobertura`/`bloquea_aprobacion` siguen disponibles en
`fn_cobertura_uso_suelo_parcela` para cuando esa investigación ocurra.
