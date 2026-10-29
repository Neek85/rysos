# Spec — App Granja Valencia: Panel de indicadores (FASE 1 de 2: spec + contrato de lectura)

> Autor: Claude Sonnet 5.5 · 2026-10-29 · **Sin migración SQL, sin pantalla, sin escrituras.**
> Esta fase deja la spec y los schemas Zod de lectura. La pantalla es la fase 2
> (ver `plans/app_granja_valencia_panel_ejecucion.md`).
>
> Fuentes leídas (no de memoria):
> - Mockup `claude.ai/artifact/7vebvnVwLNR15TT9DL2DyX` (versión `1790102749-f687`), pantalla
>   `<!-- PANEL DE INDICADORES -->`. **Los números de línea de esta spec son del HTML exportado
>   de esa versión** (7063 líneas): sección `data-screen="dashboard"` = líneas 1731-1878; tiles de
>   Inicio = 729-741.
> - `specs/pecuario_panel_indicadores.md` §6 (diseño de backend, vistas) — única parte de esa spec
>   que existe en el repo; §1-§5 nunca se entregaron.
> - `docs/schema_live_pecuario.md` (v11, v16, huso horario) y el texto de las migraciones
>   `20260928090000`, `20260928110000`, `20261008100000`, `20260924110000`.
> - Catálogo/datos en vivo: lecturas **solo SELECT** con sesiones reales de las cuentas de prueba de
>   `GRANJA-TEST` (admin y `tecnico_campo`) y, para el rol auditor, de la cuenta demo de
>   `ORG-TEST-DEMO`. No se leyó `USUARIOS`/`USUARIOS_LOGIN` ni se imprimió PII. Los tokens se
>   obtienen con el mismo mecanismo ya usado por `tests/test_pecuario_compras_rls.py`
>   (magic link vía Auth admin).

## 1. Decisiones ya confirmadas por Neyser (no se reabren)

1. v1 muestra **solo widgets respaldados por backend**. Se omiten: **Fertilidad**, **deltas**
   ("vs mes anterior" / "vs año pasado") y **tendencias de 6 semanas / sparklines**.
2. Sin datos: **"Sin datos todavía"**. Nunca los números de ejemplo del mockup.
3. Tarjeta de ventas: **"S/ X · N animales"** con `animales_vendidos_mes` de `vw_pecuario_ventas_mes`
   (última columna, migración `20261008100000`).
4. En Inicio, el tile "Mortalidad del mes (ejemplo)" (línea 739) pasa a **"Muertes del mes"** real =
   suma de `cantidad_mes` de `vw_pecuario_incidencia_patologias`.
5. "Mortalidad de reproductoras" cuenta ambos sexos → se rotula **"reproductores"**.
6. La regla de Intervalo entre partos se cita literal del §6 (ver §5).
7. Los nombres de galpón requieren **join con `PECUARIO_GALPONES`**.
8. FCR/ganancia a nivel galpón y granja estará **vacío** hasta que los movimientos de insumo lleven
   `lote_id`; la UI muestra "Sin datos todavía", no un 0.
9. Fechas del día con `hoyOperativo()` (`apps/granja-valencia/lib/fecha/hoyOperativo.ts`); las vistas
   ya usan `fn_hoy_operativo()`.

## 2. Regla general de render (aplica a todos los widgets)

Cada widget lee una vista como `PostgREST → z.array(Schema).safeParse(data)`:

| Resultado | La UI muestra |
|---|---|
| `error` de red / HTTP ≠ 200 | Estado de error del widget ("No se pudo cargar", reintentar). **No** "Sin datos todavía": son cosas distintas. |
| `data = []` (0 filas) | **Sin datos todavía** |
| fila con la columna `null` | **Sin datos todavía** (nunca `0`, nunca `—` mudo) |
| fila con el valor `0` real | `0` (un cero real es un dato; ver §6 H2 para dónde el 0 real no existe como fila) |
| `safeParse` falla | Estado de error + log; el contrato cambió (columna ausente, numeric como string). No se renderiza parcial. |

El schema de lectura es **estricto**: `z.number()`, no `z.coerce.number()` (que convertiría `null` en
`0`). Ver §4.

El mes se rotula con `hoyOperativo()` (mes calendario de Lima), p. ej. "octubre 2026". Los widgets
"este mes" usan las vistas, que ya calculan el mes con `fn_hoy_operativo()`; la app **no** recalcula
ventanas.

## 3. Tabla de widgets (mockup → v1)

Convenciones: **V** = vista; **Cols** = columnas exactas (confirmadas en catálogo/migración);
**0 filas / NULL** = qué muestra; **CONFIG** = qué hace si la organización no tiene fila en
`PECUARIO_CONFIGURACION`; **GALPONES** = depende de join con `PECUARIO_GALPONES`.

**CONFIG, válido para todos:** ninguna de las 10 vistas del panel ni `vw_pecuario_poblacion_resumen` lee
`PECUARIO_CONFIGURACION` (0 coincidencias en el texto de las 3 migraciones). Hoy esa tabla tiene
**0 filas** (leído con admin y `tecnico_campo` de GRANJA-TEST: HTTP 200, 0 filas). Por tanto **ningún widget
v1 depende de ella** y los defaults de columna no intervienen. La única dependencia de configuración del
mockup era `sistema_cria` (vive en `ORGANIZACIONES."Config"`, no en `PECUARIO_CONFIGURACION`), que solo
condicionaba **Fertilidad** (líneas 3926-3933, `kpiFertilidad`), omitida en v1.

### 3.1 Inicio (tiles, líneas 729-741)

| # | Widget (línea) | (a) v1 | (b) V · Cols | (c) 0 filas / NULL | (e) GALPONES |
|---|---|---|---|---|---|
| I1 | "Población total" (731) | Sí — ya real (spec Inicio §2) | `vw_pecuario_poblacion_resumen` · `total_poblacion` | 0 filas → "Sin datos todavía". `0` real solo si hay fila | No |
| I2 | "Reproductoras activas" (732) | Sí — ya real, **no cambia** | `count` directo `PECUARIO_REPRODUCTORES` (`sexo='hembra' AND estado='activo'`) — fuera del panel | `0` real | No |
| I3 | "Mortalidad del mes (ejemplo)" (739) → **"Muertes del mes"** | Sí — decisión 4. Quita `opacity:.7` y "(ejemplo)" | `vw_pecuario_incidencia_patologias` · `Σ cantidad_mes` (todas las filas) | 0 filas → "Sin datos todavía" (ver §8 D1) | No |

El conjunto de los 3 tiles sigue tocable y lleva a la ruta real del panel (hoy `/proximamente/Dashboard`).
"Ver panel completo →" (741) se conserva.

### 3.2 Reproducción — este mes (líneas 1739-1767)

| # | Widget (línea) | (a) v1 | (b) V · Cols | (c) 0 filas / NULL | (e) |
|---|---|---|---|---|---|
| R1 | "Partos" (1741-1745) | Sí; **sin delta** (1744) | `vw_pecuario_reproduccion_mes` · `partos_mes` | 0 filas (sin partos en el mes) → "Sin datos todavía" | No |
| R2 | "Crías vivas / parto" (1746-1750) | Sí; sin delta | misma V · `crias_vivas_promedio_parto` (numeric 2 dec.; se muestra con 1 decimal, p. ej. `3,2`) | 0 filas → "Sin datos todavía" | No |
| R3 | "Intervalo entre partos" (1751-1755) | Sí; sin delta. **Con la regla del §5** | `vw_pecuario_intervalo_partos` · `intervalo_promedio_dias_individual`, `madres_con_intervalo_calculado`, `partos_ultimos_12m_total`, `hembras_activas_actual` | 0 filas (nunca hubo un parto) o regla del §5 sin base → "Sin datos todavía" | No |
| R4 | "Fertilidad" (1756-1760, `display:none`) | **No** | — | — | — |
| R5 | "Reemplazo de reproductoras (anual)" (1761-1765) | Sí; sin delta | `vw_pecuario_reemplazo_reproductoras_anual` · `tasa_reemplazo_pct` (+ `bajas_hembras_12m`, `altas_hembras_12m`, `hembras_activas_actual` como pie) | 0 filas (nunca hubo una hembra reproductora) o `tasa_reemplazo_pct = NULL` (0 hembras activas) → "Sin datos todavía" | No |

- R4 omitido porque Fertilidad solo aplica con empadre controlado y no hay dato real contra el cual
  verificarla (`specs/pecuario_panel_indicadores.md` §6.3). El hint de la línea 1767 ("Fertilidad solo
  aparece con empadre controlado…") **se elimina**: ya no hay nada que explicar.
- R5 y R3 son ventanas de 12 meses / histórica, **no** "este mes"; ver §6 H8 para el rótulo.

### 3.3 Sanidad y bioseguridad — este mes (líneas 1769-1797)

| # | Widget (línea) | (a) v1 | (b) V · Cols | (c) 0 filas / NULL | (e) |
|---|---|---|---|---|---|
| S1 | "Mortalidad en lactancia" (1771-1775) | Sí; sin delta | `vw_pecuario_indicadores_sanitarios_mes` · `mortalidad_lactancia_pct_mes` (+ `muertes_lactancia_mes` como pie) | 0 filas o `…_pct_mes = NULL` (población de lactancia = 0) → "Sin datos todavía". `0,0 %` real si hay población y 0 muertes | No |
| S2 | "Mortalidad en recría/engorde" (1776-1780) | Sí; sin delta | misma V · `mortalidad_recria_engorde_pct_mes` (+ `muertes_recria_engorde_mes`) | ídem S1 (NULL cuando recría+engorde = 0) | No |
| S3 | "Mortalidad de **reproductores** (anual)" (1781-1785) | Sí; **rótulo cambia de "reproductoras" a "reproductores"** (ambos sexos); sin delta | misma V · `mortalidad_reproductores_pct_anual` (+ `muertes_reproductores_12m`) | ídem S1 (NULL cuando 0 reproductores) | No |
| S4 | "Incidencia de patologías clave" (1789-1797) | Sí, como barras (`bar-row`) | `vw_pecuario_incidencia_patologias` · `causa`, `cantidad_mes`, `porcentaje_mes` | 0 filas → "Sin datos todavía". `causa = NULL` → rótulo "Desconocida" | No |

- Hint 1787 ("Recría/engorde usa el mismo corte de etapa… 8 semanas") se conserva.
- Hint 1790 ("Basado en la causa de muerte registrada… no incluye animales tratados") se conserva: sigue
  siendo verdad (V1 por causa de muerte, `specs/pecuario_panel_indicadores.md` §6.3).
- S4: la vista **no ordena**; la UI ordena por `cantidad_mes` desc. Ancho de barra = `porcentaje_mes`;
  valor = `cantidad_mes`; pct = `porcentaje_mes` (1 decimal). Rótulos (mockup + 2 que el mockup no
  tiene): `neumonia→Neumonía`, `gastroenteritis→Gastroenteritis`, `aplastamiento→Aplastamiento`,
  `desconocido→Desconocida`, `otro→Otro`, `distocia→Distocia`, `depredador→Depredador`, `NULL→Desconocida`.
  Los 5 del mockup son una muestra de ejemplo; el enum real tiene 7 valores (`causa_mortalidad`).

### 3.4 Población por etapa (líneas 1799-1802; JS 6951-6973)

| # | Widget | (a) v1 | (b) V · Cols | (c) 0 filas / NULL | (e) |
|---|---|---|---|---|---|
| P1 | "Población por etapa (N total)" | Sí — **ya era real** en el mockup (línea 1737) | `vw_pecuario_poblacion_resumen` · `total_lactancia`, `total_recria`, `total_engorde`, `total_reproductores`, `total_poblacion` | 0 filas **o** `total_poblacion = 0` → "Sin datos todavía". Barras: 4 fijas (Lactancia, Recría, Engorde, Reproductores); pct = `valor / total_poblacion` redondeado | No |

Reutiliza `PoblacionResumenSchema` (existente, **no se modifica**). El mockup oculta Lactancia y
Reproductores cuando valen 0 (6954, 6957); v1 muestra las 4 siempre cuando hay fila (una etapa en 0 es un
dato). El hint largo de las líneas 1800 y 1802 habla del simulador ("En este simulador la etapa…", "En el
backend real todavía falta el vínculo…") y **no se porta**: ya está resuelto (v11, v12, v5).

### 3.5 Producción y ventas (líneas 1804-1877)

| # | Widget (línea) | (a) v1 | (b) V · Cols | (c) 0 filas / NULL | (e) |
|---|---|---|---|---|---|
| Pr1 | "Peso promedio al nacimiento" (1805-1815) | Sí, **solo el número** (`sv`); **sin sparkline** (1810-1813) | `vw_pecuario_reproduccion_mes` · `peso_promedio_nacimiento_g` (+ `partos_con_peso_registrado`) | 0 filas o NULL (ningún parto del mes pesó la camada) → "Sin datos todavía". Pie: "N partos con peso" | No |
| Pr2 | "Peso promedio al destete" (1816-1826) | Sí, solo número; sin sparkline | `vw_pecuario_pesos_promedio_mes` · `peso_promedio_destete_g_mes` | 0 filas o NULL (ningún lote conformado en el mes con primer pesaje) → "Sin datos todavía" | No |
| Pr3 | "Peso promedio de engorde" (1827-1837) | Sí, solo número; **sin** hint "Últimas 6 semanas — tendencia en aumento" (1836) | misma V · `peso_promedio_engorde_g_actual` | 0 filas o NULL (ningún lote en engorde con pesaje) → "Sin datos todavía" | No |
| C1 | "Ventas del mes" (1839-1843) | Sí → **"S/ X · N animales"** (decisión 3). Sin delta (1842 ya lleva "96 animales" ahí; pasa al subtítulo) | `vw_pecuario_ventas_mes` · `monto_total_mes`, `animales_vendidos_mes` | 0 filas (sin ventas en el mes) → "Sin datos todavía" (ver §8 D1) | No |
| C2 | "Ganancia diaria prom." (1844-1848) | Sí; sin delta | `vw_pecuario_seguimiento_granja` · `ganancia_diaria_promedio_g` | 0 filas o NULL → "Sin datos todavía" (**esperado hoy**, ver decisión 8) | No |
| C3 | "Conversión alimenticia (FCR)" (1849-1853) | Sí; sin delta | misma V · `fcr_promedio` | 0 filas, NULL **o `≤ 0`** → "Sin datos todavía" (ver §6 H4) | No |
| C4 | "+ Ver detalle por galpón" (1856-1877) | Sí, desplegable | `vw_pecuario_seguimiento_galpon` · `galpon_id`, `ganancia_diaria_promedio_g`, `fcr_promedio`, `lotes_con_datos` **+** `PECUARIO_GALPONES` · `id`, `codigo_galpon`, `nombre` | 0 filas → "Sin datos todavía" (el botón se muestra igual; al abrirlo dice eso). Por galpón: ganancia o FCR NULL/≤0 → "Sin datos todavía" en esa celda | **Sí**: rótulo = `nombre ?? codigo_galpon`; si el `galpon_id` no está en `PECUARIO_GALPONES` → "Galpón sin nombre" (no hay FK real, ver §6 H14) |

- Pr1-Pr3 como número solo: el `kpi-label` + valor en `g` con 1 decimal ("42,0 g" o "42 g" si es entero;
  decisión de formato en el plan).
- C1: el subtítulo "N animales" usa `animales_vendidos_mes`; `ventas_mes` (cantidad de transacciones) no
  se muestra.
- Hint 1855 ("FCR: kg de alimento… Los dos números de arriba son el promedio de toda la granja") se conserva
  y ahora es exacto (promedio **ponderado**, ver spec backend §6.2).
- Hint 1737 ("los números de este panel son de ejemplo…") **se elimina**.

### 3.6 Resumen de inclusión

Incluidos en v1: I1, I3, R1, R2, R3, R5, S1, S2, S3, S4, P1, Pr1, Pr2, Pr3, C1, C2, C3, C4 (+ I2 sin cambios).
Omitidos: R4 Fertilidad; todos los `kpi-delta` (1744, 1749, 1754, 1759, 1764, 1774, 1779, 1784, 1842, 1847,
1852); las 3 sparklines (1810-1813, 1821-1824, 1832-1835).

**Ningún widget incluido carece de columna o vista de respaldo** (paso 6 de la tarea: no hay que detenerse).

## 4. Contrato de datos (Zod de lectura) — `lib/validations/pecuario.ts`

Solo agregados al final del archivo; ningún schema previo se tocó ni se renombró. Colisión de nombres:
`grep` previo sin coincidencias para `Panel*`/`CAUSA_MORTALIDAD`; `PoblacionResumenSchema` **ya existía** y se
reutiliza para P1/I1 en vez de duplicarse.

| Vista / tabla | Schema | Usado por |
|---|---|---|
| `vw_pecuario_seguimiento_lote` | `PanelSeguimientoLoteSchema` | (no hay widget del panel; ficha de lote; fuente de las otras dos) |
| `vw_pecuario_seguimiento_galpon` | `PanelSeguimientoGalponSchema` | C4 |
| `vw_pecuario_seguimiento_granja` | `PanelSeguimientoGranjaSchema` | C2, C3 |
| `vw_pecuario_reproduccion_mes` | `PanelReproduccionMesSchema` | R1, R2, Pr1 |
| `vw_pecuario_intervalo_partos` | `PanelIntervaloPartosSchema` | R3 |
| `vw_pecuario_reemplazo_reproductoras_anual` | `PanelReemplazoReproductorasSchema` | R5 |
| `vw_pecuario_indicadores_sanitarios_mes` | `PanelIndicadoresSanitariosSchema` | S1, S2, S3 |
| `vw_pecuario_incidencia_patologias` | `PanelIncidenciaPatologiasSchema` (+ `CAUSA_MORTALIDAD`) | S4, I3 |
| `vw_pecuario_pesos_promedio_mes` | `PanelPesosPromedioSchema` | Pr2, Pr3 |
| `vw_pecuario_ventas_mes` | `PanelVentasMesSchema` | C1 |
| `PECUARIO_GALPONES` (3 columnas) | `PanelGalponNombreSchema` | C4 (join) |
| `vw_pecuario_poblacion_resumen` | `PoblacionResumenSchema` (existente) | P1, I1 |
| `vw_pecuario_ocupacion_poza` | — (sin schema) | **no es widget del panel**; es la ficha de poza (otra pantalla). Solo se verificó su acceso (§7) |

**numeric de PostgREST — confirmado con lectura real (texto crudo de la respuesta):**
`"crias_vivas_promedio_parto":1.00`, `"mortalidad_reproductores_pct_anual":33.3`, `"tasa_reemplazo_pct":0.0`.
Los `numeric` llegan como **número JSON**, no como string; los `bigint` convertidos con `::integer` también.
Por eso el schema es `z.number()` (y `.int()` en conteos), y `nullable()` donde la definición SQL admite NULL.
`z.coerce.number()` queda **descartado** para estas lecturas porque `Number(null) === 0`.

Tests Jest: `apps/granja-valencia/lib/validations/panel.test.ts` — forma, nullables, fila vacía (`[]`),
columna faltante, numeric como string (falla), conteo con decimales (falla), `fcr = 0` con
`datos_suficientes=false`, valores negativos, `causa` NULL/inválida, `animales_vendidos_mes` obligatoria.
Se validó además que **las filas reales** capturadas en vivo (8 vistas/tabla con datos) pasan los schemas.

## 5. Intervalo entre partos — regla

**Cita literal de `specs/pecuario_panel_indicadores.md` §6.1** (único texto de ese §6 sobre este indicador):

> `vw_pecuario_intervalo_partos` (individual vía `madre_id`, FK real
> desde v3, + fallback aproximado sin ID individual)

§6 **no define** cuándo se pasa del cálculo individual al fallback ni la unidad del fallback. El detalle
que sí existe en el repo está en el `COMMENT ON VIEW` de la propia vista (migración `20260928090000`), citado
literal:

> Frecuencia de partos (spec §5.1, el indicador reproductivo correcto para empadre continuo).
> intervalo_promedio_dias_individual usa PECUARIO_PARTOS.madre_id (FK real desde v3) cuando la identificación
> individual está en uso -- promedio de días entre partos consecutivos de la misma madre. Cuando
> madres_con_intervalo_calculado es bajo o 0 (identificación individual poco usada), el consumidor debe
> preferir la aproximación partos_ultimos_12m_total/hembras_activas_actual (partos por hembra/año, no un
> intervalo real -- misma limitación que ya admite la spec).

"bajo" **no está cuantificado en ningún documento del repo**. No se inventa un umbral. **Propuesta para que
Neyser confirme** (D2, §8):

| Condición | La tarjeta muestra |
|---|---|
| 0 filas | "Sin datos todavía" |
| `madres_con_intervalo_calculado ≥ 1` y `intervalo_promedio_dias_individual` no NULL | "**N d**" (1 decimal) · pie "N madres identificadas" — rótulo "Intervalo entre partos" |
| `madres_con_intervalo_calculado = 0` y `hembras_activas_actual > 0` | "**x partos/hembra/año**" = `partos_ultimos_12m_total / hembras_activas_actual` (1 decimal) · rótulo **"Partos por hembra al año (aprox.)"** — **nunca** con el rótulo "Intervalo" ni en días |
| `madres_con_intervalo_calculado = 0` y `hembras_activas_actual = 0` | "Sin datos todavía" |

El rótulo distinto en el fallback es obligatorio: el mockup lo muestra en días ("62 d", línea 1753), pero la
vista misma dice que el fallback no es un intervalo.

## 6. Hallazgos de datos que afectan la v1

Verificados contra el catálogo/migraciones y, donde se indica, con datos reales de GRANJA-TEST.

- **H1 — numeric llega como número.** Ver §4. No hace falta `parseFloat`; sí hace falta evitar `coerce`.
- **H2 — "sin eventos" = 0 filas, no una fila de ceros.** `reproduccion_mes`, `ventas_mes`,
  `incidencia_patologias` agrupan sobre los eventos del mes: sin partos/ventas/muertes en el mes calendario,
  **la vista no devuelve fila**. La UI no puede distinguir "no se registró nada" de "nada ocurrió". Con la
  regla "0 filas → Sin datos todavía" un mes sin ventas se lee como "sin datos". Ver D1.
- **H3 — Bloque A casi vacío hoy.** GRANJA-TEST (admin y tecnico): `seguimiento_galpon` 0 filas,
  `seguimiento_granja` 0 filas. Detrás: `seguimiento_lote` tiene 7 lotes, **1** con `ganancia_diaria_g`,
  **0** con `datos_suficientes`, solo 2 con `galpon_id`. Galpón y granja filtran `WHERE datos_suficientes`
  (alimento con `lote_id`), así que **C2, C3 y C4 saldrán "Sin datos todavía"** aunque haya lotes con dos
  pesajes. Es lo esperado según la decisión 8.
- **H4 — FCR pooled sin guarda de signo.** `fcr_promedio = Σ alimento / NULLIF(Σ ganancia_total, 0)`: si la
  ganancia agregada es negativa el resultado es **negativo**, no NULL (la guarda `ganancia > 0` solo existe en
  el FCR por lote). Real: el único lote con ganancia en GRANJA-TEST tiene **−128,33 g/d** (pérdida de
  peso). Regla de UI: `fcr_promedio ≤ 0` → "Sin datos todavía". `ganancia_diaria_promedio_g` negativa **sí se
  muestra** (es un dato real; es pérdida de peso).
- **H5 — `fcr = 0` por lote.** En `seguimiento_lote`, con ganancia positiva y **sin** alimento el FCR sale
  `0.00`, no NULL (`tests/test_pecuario_panel_indicadores.py::test_caso2…`). Cualquier consumidor por lote
  debe decidir con `datos_suficientes`, no con `fcr`. (El panel v1 no usa la vista por lote.)
- **H6 — Tasas de mortalidad con denominador aproximado.** Migración `20260928090000`: "el denominador
  (población en riesgo) se aproxima con la población ACTUAL de esa etapa… no con un promedio de población
  durante el período". Efecto visible: GRANJA-TEST muestra **33,3 %** de mortalidad de reproductores =
  1 muerte / 3 reproductores **vivos hoy** (el muerto no está en el denominador). Es un % sobrestimado en
  granjas chicas. v1 lo muestra tal cual con el pie "N muertes" y la etiqueta "aprox."; corregirlo es un
  cambio de vista (fuera de esta fase).
- **H7 — `total_lactancia` descuenta TODA la mortalidad de lactancia histórica.** En
  `vw_pecuario_poblacion_resumen`: `GREATEST(lactancia_bruta − Σ mortalidad etapa='lactancia' (sin filtro de
  fecha), 0)`, mientras `lactancia_bruta` solo cuenta camadas aún no recolectadas. Con el tiempo se resta
  mortalidad de camadas que ya salieron de lactancia → `total_lactancia` (y `total_poblacion`, P1, I1, y el
  denominador de S1) puede quedar subestimado. Ya documentado como limitación parcial en v11 ("sin atribuir a
  poza/parto"); aquí se deja constancia de que no está acotado al mes. No bloquea v1; no se resuelve.
- **H8 — Rótulos de ventana.** El mockup agrupa bajo "Reproducción — este mes" (1739) a R3 (intervalo:
  **todo el historial** de madres identificadas, sin ventana de fecha en `partos_con_madre`) y R5
  (**12 meses**). Rotular R5 "(12 meses)" y R3 sin "este mes".
- **H9 — "Ventas del mes" no incluye subproductos.** `monto_total_mes` suma solo `PECUARIO_VENTAS`
  (excluye `PECUARIO_VENTAS_SUBPRODUCTOS`/guano); `animales_vendidos_mes` excluye el valor vestigial
  `tipo_salida='guano'`. Pie recomendado: "Solo venta de animales".
- **H10 — `PECUARIO_LOTES.cantidad_actual` puede ser NULL.** Real: 1 de 7 lotes. Los Σ de las vistas lo
  ignoran (pueden subestimar), y el schema de `seguimiento_lote` lo declara nullable.
- **H11 — `causa` nullable y enum de 7 valores.** El mockup solo ilustra 5 causas. Ver S4.
- **H12 — "Muertes del mes" (I3) ≠ S1+S2.** `incidencia_patologias` suma **toda** la mortalidad del mes (todas
  las etapas, incluida `reproductor`); S1/S2 cubren solo lactancia y recría/engorde. I3 ≥ S1+S2 en muertes
  absolutas. Rotular I3 "Muertes del mes" (sin "mortalidad") — y no compararlo con las tasas.
- **H13 — Orgs sin la fila.** `intervalo_partos` se ancla en orgs con ≥1 parto; `reemplazo` en orgs con ≥1
  hembra reproductora; `pesos_promedio_mes` en orgs con ≥1 lote; `poblacion_resumen` en orgs con alguna jaula,
  lote, reproductor o parto. Una org nueva da 0 filas en todo (incluido GRANJA-VALENCIA para los widgets que
  dependan de datos que aún no se cargan).
- **H14 — Galpón sin FK real.** `PECUARIO_JAULAS.galpon_id` no tiene FK (docs/schema_live_pecuario.md): el
  `galpon_id` de una fila de `seguimiento_galpon` puede no existir en `PECUARIO_GALPONES`. Fallback
  "Galpón sin nombre". `PECUARIO_GALPONES.nombre` es `VARCHAR(150)` nullable → cae a `codigo_galpon`.
- **H15 — `PECUARIO_CONFIGURACION` vacía.** 0 filas (GRANJA-TEST); ningún widget la lee (§3).
- **H16 — El filtro por rol no existe en las vistas.** Ver §7.
- **H17 — Un intervalo de 0,5 días es posible.** GRANJA-TEST: `intervalo_promedio_dias_individual = 0.5`
  (partos del mismo día cargados como prueba). La UI no filtra valores "raros"; muestra lo que dice la vista.
- **H18 — Formato numérico en Hermes.** El mockup usa `S/ 1,840` (coma de miles). Si se usa
  `toLocaleString('es-PE', …)` hay que **verificar en dispositivo** que Hermes aplica el locale; si no, formatear
  a mano. Se resuelve en el plan, paso 2.
- **H19 — Pozas no entran.** `vw_pecuario_ocupacion_poza` no es del panel (ver §4).

No se encontró **ninguna** columna ni vista faltante para un widget incluido.

## 7. Acceso: filtro por organización y lectura por rol

**Filtro por organización (texto de las migraciones):** las 10 vistas, `vw_pecuario_poblacion_resumen` y
`vw_pecuario_ocupacion_poza` terminan con `"ID_Organizacion" = auth_org_id() OR auth.role() = 'service_role'
OR current_user = 'postgres'` (las dos de galpón/granja heredan el filtro de `seguimiento_lote`). Además
`tests/test_pecuario_panel_indicadores.py::test_aislamiento_cruzado_las_10_vistas` y
`test_pecuario_poblacion_vistas.py::test_aislamiento_cruzado_*` prueban en vivo que una sesión de otra org
recibe `[]` (corridas del 2026-10-29: 25 y 20 passed).

**Lectura con sesión real (solo SELECT, 2026-10-29), GRANJA-TEST:**

| Vista / tabla | admin | tecnico_campo |
|---|---|---|
| `vw_pecuario_seguimiento_lote` | 200 · 7 filas | 200 · 7 filas |
| `vw_pecuario_seguimiento_galpon` | 200 · 0 | 200 · 0 |
| `vw_pecuario_seguimiento_granja` | 200 · 0 | 200 · 0 |
| `vw_pecuario_reproduccion_mes` | 200 · 1 | 200 · 1 |
| `vw_pecuario_intervalo_partos` | 200 · 1 | 200 · 1 |
| `vw_pecuario_reemplazo_reproductoras_anual` | 200 · 1 | 200 · 1 |
| `vw_pecuario_indicadores_sanitarios_mes` | 200 · 1 | 200 · 1 |
| `vw_pecuario_incidencia_patologias` | 200 · 0 | 200 · 0 |
| `vw_pecuario_pesos_promedio_mes` | 200 · 1 | 200 · 1 |
| `vw_pecuario_ventas_mes` | 200 · 0 | 200 · 0 |
| `vw_pecuario_poblacion_resumen` | 200 · 1 | 200 · 1 |
| `vw_pecuario_ocupacion_poza` | 200 · 4 | 200 · 4 |
| `PECUARIO_GALPONES` (join de C4) | 200 · 1 | 200 · 1 |
| `PECUARIO_CONFIGURACION` | 200 · 0 | 200 · 0 |

**Resultado: ningún rol queda sin acceso.** Todas las filas devueltas a ambos roles son de `GRANJA-TEST`
(único `ID_Organizacion` observado). Los "0" son vistas sin eventos en la ventana, no falta de permiso (HTTP 200).

**Dato adicional (para §8 D3):** la cuenta `auditor_qc` de `ORG-TEST-DEMO`, con sesión real, también obtiene
HTTP 200 en las 12 vistas y en `PECUARIO_GALPONES`, y ve filas de su propia organización
(`reemplazo`, `sanitarios`, `poblacion_resumen`). **Las vistas filtran por organización, no por rol.**

## 8. Quién ve el panel (propuesta) y decisiones pendientes

**Propuesta (D3) — para que Neyser confirme:** el panel y el tile "Muertes del mes" los ven **`admin` y
`tecnico_campo`** (los dos roles de campo de Granja Valencia). `auditor_qc` **no usa esta app**: no se le
muestra la entrada. Aclaración de seguridad: ocultar el tile por rol es **cosmético** (mismo criterio que
Compras/Insumos en esta app); las vistas son legibles por cualquier rol de la organización (§7). Es aceptable
porque los datos son de la propia organización y de solo lectura; si se quisiera una barrera real, haría falta
cambiar las vistas (otra fase, otra revisión de seguridad).

**Decisiones a confirmar (no bloquean la fase 2 si se acepta el valor por defecto):**

- **D1 — Cero real vs "Sin datos todavía".** Para R1, R2, Pr1, C1 e I3, "0 filas" puede significar "este mes no
  hubo ventas/partos/muertes" (un cero real). Por defecto v1 sigue la regla confirmada ("Sin datos todavía").
  Alternativa a considerar solo para C1 e I3: "S/ 0 · 0 animales" / "0". Requiere decisión de Neyser porque
  la vista no distingue ambos casos (H2).
- **D2 — Umbral del fallback de Intervalo entre partos** (§5): por defecto `madres_con_intervalo_calculado ≥ 1`.
- **D3 — Roles del panel** (arriba).
- **D4 — Pies informativos** ("N muertes", "N partos con peso", "Solo venta de animales", "aprox."): por
  defecto sí, en texto `hint` pequeño; son datos que ya trae la vista.

## 9. Fuera de alcance de esta fase

Pantalla, hooks de datos, componentes, ruta, cambio del tile de Inicio, verificación en dispositivo
(ver plan). Cualquier cambio de vista (denominadores de mortalidad H6, mortalidad de lactancia H7, FCR pooled
H4): **no se hace**; si se decide, es una migración aparte con su revisión.

## 10. Estado

EN DISEÑO — FASE 1 de 2 (2026-10-29). Contrato de lectura implementado y probado; pantalla pendiente.
