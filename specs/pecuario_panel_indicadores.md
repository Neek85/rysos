# Panel de indicadores — Pecuario Cuyes

> **Nota de transparencia (2026-09-28):** este archivo no existía en el
> repo real hasta este commit — mismo hallazgo recurrente de todo el
> roadmap de Pecuario (Guano, Mortalidad-fotos, Sanidad, Traslado,
> Población, Empadre y Reglas de reemplazo pasaron por lo mismo). El
> documento original del simulador/mockup tenía las secciones §1 a §5
> (~2000 líneas, la spec más grande de las 15) — esas secciones **nunca
> se entregaron a este repo y no se inventan acá**. Este archivo contiene
> únicamente §6, el diseño de backend real (Claude/Cowork), que es lo que
> efectivamente se construyó, aplicó y verificó en producción. Las
> referencias a "§2.x"/"§5.x" dentro de §6 apuntan a secciones del
> documento original del simulador, no reproducidas en este repo.

## 6. Diseño de backend (Claude/Cowork, 2026-09-28)

**Ítem 10 del roadmap, el último y el más grande.** Alcance: 10 vistas
nuevas de solo lectura, CERO tablas/columnas/triggers/CHECK nuevos — el
perfil de riesgo más bajo de todo el roadmap, porque es pura agregación
sobre datos que los ítems 1-9 (+ Etapa automática/Compras/Venta pelado,
cerrados antes de esta ronda numerada) ya escriben y ya verificaron en
vivo. Detalle completo de cada vista, sus fórmulas y las verificaciones
de control está en el encabezado y el pie de
`supabase/migrations/20260928090000_pecuario_panel_indicadores_vistas.sql`
— acá solo el resumen de alcance y las decisiones de arquitectura.

### 6.1. Las 10 vistas

- **Bloque A (Ganancia diaria/FCR, 3 niveles):**
  `vw_pecuario_seguimiento_lote` (por lote, entre los dos pesajes más
  recientes, con `datos_suficientes`), `vw_pecuario_seguimiento_galpon` y
  `vw_pecuario_seguimiento_granja` (agregación **pooled**, ponderada por
  animal-día/kg real — ver 6.2, no es un promedio simple de promedios).
- **Bloque B (Reproductivos):** `vw_pecuario_reproduccion_mes`
  (partos, crías vivas, prolificidad, peso al nacimiento),
  `vw_pecuario_intervalo_partos` (individual vía `madre_id`, FK real
  desde v3, + fallback aproximado sin ID individual),
  `vw_pecuario_reemplazo_reproductoras_anual` (solo hembras, mismo tema
  que el ítem 8).
- **Bloque C (Sanitarios):** `vw_pecuario_indicadores_sanitarios_mes`
  (mortalidad lactancia/recría+engorde combinado del mes + reproductores
  % anual) y `vw_pecuario_incidencia_patologias` (V1: por causa de
  muerte, cero captura nueva).
- **Bloque D (Productivo):** `vw_pecuario_pesos_promedio_mes`
  (peso al destete del mes real de destete + peso de engorde actual,
  ambos ponderados por cantidad de animales).
- **Bloque E (Comercial):** `vw_pecuario_ventas_mes` (monto, kg,
  rendimiento de carcasa promedio — la columna generada ya existía desde
  v9, faltaba el agregado).

### 6.2. Decisión de arquitectura propia — agregación "pooled", no promedio de promedios

Ganancia diaria/FCR a nivel galpón/granja se calculan ponderados por
animal-día y por kg real (`SUM(ganancia_total) / SUM(animal_días)`,
`SUM(alimento_kg) / SUM(ganancia_kg)`), no como el promedio aritmético de
los números por lote — un lote chico y uno grande no deben pesar igual.
Esto NO es una decisión de negocio ya confirmada por Neyser (la spec
original nunca especificó el método de combinación, y esa spec no está
reproducida en este repo) — es el criterio técnico estándar por defecto,
documentado explícitamente como tal en el encabezado de la migración,
ajustable después sin costo (es una vista).

### 6.3. Fuera de alcance a propósito (no son bugs)

- **Edad al beneficio/saca** — un lote de Destete real agrupa varios
  partos sin una única fecha de nacimiento
  (`PECUARIO_RECOLECCION_PARTOS` es agregado/proporcional). Calcular una
  "edad" ahí sería inventar un criterio no pedido.
- **Incidencia de patologías V2** (por tratamientos, no por causa de
  muerte) — `PECUARIO_TRATAMIENTOS.diagnostico` es texto libre sin
  categorías; construir V2 exigiría inventar una taxonomía.
- **Fertilidad (%)** — limitada a `sistema_cria = 'controlado'` en el
  diseño original. GRANJA-VALENCIA usa `'continuo'` — no hay ningún dato
  real hoy contra el cual verificar una fórmula de ventana de gestación,
  así que se deja fuera hasta que exista una organización con empadre
  controlado activo (no antes, para no construir sin poder probar).
- **FCR/ganancia a nivel de poza** (ficha de lote) — no hace falta vista
  aparte: un lote vive en una sola poza a la vez, así que
  `vw_pecuario_seguimiento_lote` filtrado por `lote_id` ya sirve.

### 6.4. Sin contrato Zod

Mismo criterio que la migración de Población (20260924110000): son
vistas de solo lectura para el dashboard web (JS plano, sin Server
Actions de Pecuario — confirmado en el ítem 9). No hay ningún
INSERT/UPDATE nuevo que validar. Si alguna app móvil llegara a consumir
uno de estos números en el futuro, ese consumo puntual llevaría su propio
contrato Zod en ese momento.

### 6.5. Verificación y cierre

1. Delivery a la CLI con el contenido literal de la migración.
2. Verificación de premisas por la CLI (paso 2) antes de tocar nada.
3. Tests estáticos + en vivo, incluyendo aislamiento RLS cruzado entre
   dos organizaciones de prueba sobre las 10 vistas, y 6 casos de
   control de FCR/ganancia diaria detallados al pie de la migración.
4. Neyser aplicó ambas migraciones en Supabase Studio manualmente (nunca
   automático).
5. Suite completa re-confirmada sin fallos nuevos.
6. `docs/schema_live_pecuario.md` (v16) + `docs/ESTADO_PROYECTO.md`
   actualizados y verificados literal, commit `2ba9750`.

### 6.6. Dos hallazgos reales de esquema al intentar aplicar (2026-09-28)

Ninguno bloqueó el diseño — los dos se corrigieron en el mismo archivo,
antes de que la migración tocara la base real:

1. **`RAISE EXCEPTION` con un `%` literal sin escapar** en el mensaje del
   preflight — PL/pgSQL interpreta `%` dentro de un `RAISE` como
   placeholder de formato (como `printf`), así que un `%` literal en el
   texto sin argumento revienta con "too few parameters specified for
   RAISE". Corregido a `%%`. Error propio de Cowork al redactar el
   mensaje, no un problema de esquema.
2. **`PECUARIO_INSUMOS.unidad_medida` es un ENUM (`unidad_medida_insumo`)
   en la base real, no el `VARCHAR(20)` de la copia local de la migración
   v2 (20260911090000) usada para diseñar esto** — `ILIKE` no tiene
   operador contra un enum sin castear (`42883`). Corregido a
   `unidad_medida::text ILIKE 'kg'` en las 3 comparaciones. Confirmado
   contra la base real antes de reintentar: `'kg'` SÍ es un valor válido
   del enum (`kg, g, litro, ml, unidad, saco_50kg, saco_40kg`) — el fix
   era correcto, no solo "compila".

**Hallazgo de datos (no de código), confirmado el mismo día:**
`PECUARIO_INSUMOS` está **completamente vacía** en la base real de
Granja Valencia (cero filas, cualquier categoría) — confirmado que
`categoria_insumo` sí tiene `'alimento'` como valor real del enum (junto
con `material`/`medicamento`/`vitamina`), así que no es un problema de
nombres, es que el catálogo de insumos todavía no se cargó en producción.
Consecuencia real para el Bloque A: hasta que Granja Valencia registre
insumos de alimento y sus movimientos, `alimento_consumido_kg` = 0 y
`fcr`/`datos_suficientes` = NULL/false para TODOS los lotes reales —
`vw_pecuario_seguimiento_galpon`/`vw_pecuario_seguimiento_granja`
devolverán 0 filas para GRANJA-VALENCIA (ambas filtran `WHERE
datos_suficientes`). **`ganancia_diaria_g` no se ve afectado** (no
depende de insumos, solo de dos pesajes) — sigue siendo un dato real
apenas haya 2+ pesajes de un lote. No es un bug: las vistas están listas,
falta que la operación real cargue su catálogo de insumos — se deja
anotado acá para que no se confunda con un error cuando el panel muestre
"sin datos" en FCR al principio.

### 6.7. Bug real encontrado por la CLI en vivo — FROM mal anclado en `vw_pecuario_reemplazo_reproductoras_anual` (2026-09-28)

Al aplicar la migración y correr los tests en vivo por primera vez (commit
`e1f934a`), la CLI encontró un bug real de diseño, no de sintaxis, y
correctamente NO lo corrigió por su cuenta — lo señaló para decisión de
Cowork, mismo criterio que los hotfixes de Empadre.

**El bug:** la vista anclaba su `FROM` en la CTE `activas` (hembras con
`estado IN ('activo','enfermo')` HOY). Con el resto de las CTEs unidas
por `LEFT JOIN` *hacia* `activas`, una organización cuya única hembra
reproductora activa se vende o muere en el período **desaparece por
completo de la vista** — ni la baja ni la tasa se muestran, aunque
`bajas_mortalidad`/`bajas_venta` sí tengan la fila. Es exactamente el
caso que una "tasa de reemplazo" más necesita mostrar, y quedaba
invisible en silencio (sin error, sin fila en NULL, directamente
ausente). Confirmado por la CLI con una prueba manual determinística
(vender la única hembra activa de una organización de prueba).

Mismo bug-class ya corregido antes en el módulo por la misma razón
(`vw_pecuario_poblacion_resumen`, 20260924110000, ancla en una CTE
`orgs` = UNION de las 4 tablas fuente, para que una organización sin
población en una categoría no desaparezca de las demás) — no debería
haber pasado dos veces, queda anotado para revisar el `FROM` de toda
vista de agregación por defecto en el futuro, no solo cuando el patrón
ya falló una vez.

**Fix:** `supabase/migrations/20260928110000_fix_pecuario_reemplazo_reproductoras_from.sql`
— cambia el ancla del `FROM` a `SELECT DISTINCT "ID_Organizacion" FROM
PECUARIO_REPRODUCTORES WHERE sexo='hembra'` (cualquier estado, no solo
activo/enfermo). Con esto, `hembras_activas_actual` puede ser 0 sin que
la fila desaparezca; `tasa_reemplazo_pct` pasa a `NULL` cuando el
denominador es 0 (ya usaba `NULLIF`, sin cambios ahí — correcto, un %
sobre base 0 no tiene un valor con sentido); `bajas_hembras_12m` sigue
mostrando su valor real en ese caso, que es el dato que antes se perdía.
No cambia ninguna otra columna ni ninguna otra vista de la migración
original.

### 6.8. CERRADO (2026-09-28)

Las 10 vistas de `20260928090000_pecuario_panel_indicadores_vistas.sql`
aplicadas en Studio por Neyser, más el hotfix real
`20260928110000_fix_pecuario_reemplazo_reproductoras_from.sql` (§6.7).
Commits, en orden: `6f27a00` (migración original) → `592674a` (fix
BEGIN/COMMIT, hallazgo de la CLI antes de aplicar) → `0009e26` (fix `%%`
en `RAISE EXCEPTION`, error propio) → `e1f934a` (fix
`unidad_medida::text` — la copia local tenía ese campo como `VARCHAR`,
en la base real es `ENUM`) → `178eaf7` (fix del `FROM` mal anclado en
`vw_pecuario_reemplazo_reproductoras_anual`, hallazgo real de la CLI en
vivo, + test actualizado).

**Verificado en vivo de verdad, 25/25 del archivo de este ítem, ninguno
SKIPPED** (`tests/test_pecuario_panel_indicadores.py -v -rs`). Suite
completa re-confirmada tras el último fix, salida literal
`5 failed, 840 passed, 8 skipped, 28 warnings, 84 subtests passed in
1454.51s` — los mismos 5 ya catalogados (certificaciones x2,
e2e_etl_drive, multi_producto_cafe_cacao, test_no_grant_statement),
ninguno nuevo.

Dos hallazgos de esquema real corregidos en el camino (§6.6, sin
relación con la lógica de las vistas): `unidad_medida` es `ENUM`, no
`VARCHAR`, en la base real; y un `FROM` mal anclado en
`vw_pecuario_reemplazo_reproductoras_anual` hacía desaparecer
organizaciones sin reproductoras activas (mismo bug-class ya corregido
antes en `vw_pecuario_poblacion_resumen`). Un hallazgo de DATOS, no de
código: `PECUARIO_INSUMOS` está vacía en producción — el Bloque A
(FCR/ganancia diaria a nivel galpón/granja) devuelve 0 filas para
GRANJA-VALENCIA hasta que carguen su catálogo de insumos;
`ganancia_diaria_g` por lote no se ve afectado.

Sin `CHECK`/trigger nuevo (ninguno existía ni existe — son 10 vistas de
solo lectura). `docs/schema_live_pecuario.md` (v16) y
`docs/ESTADO_PROYECTO.md` actualizados y verificados palabra por palabra,
commit `2ba9750`. Sin merge a `main`.

**Con esto, el roadmap completo de Pecuario Cuyes (mockup → backend,
10/10 ítems) queda cerrado.**
