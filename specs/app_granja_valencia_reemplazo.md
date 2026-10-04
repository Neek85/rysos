# Spec — App Granja Valencia: Reemplazo/descarte de reproductoras

**Estado: spec + contrato + tests. La pantalla NO está construida.** El backend
(tabla, motor de reglas por trigger, RLS por rol) está aplicado y verificado; ver
§0 y `docs/ESTADO_PROYECTO.md` (entrada del 2026-10-04). Esta spec define la
tarjeta de Alertas en Inicio y la pantalla nueva `/reemplazo`.

**Nota sobre fuentes:** `specs/pecuario_reglas_reemplazo_reproductoras.md` la
citan comentarios, migraciones y el mockup, pero **no existe en este repo** y no
se reconstruye acá: todo lo que sigue sale de la base real, de las migraciones y
del mockup (`claude.ai/artifact/7vebvnVwLNR15TT9DL2DyX`).

## 0. Recon (hechos confirmados, solo lectura)

**Tabla `PECUARIO_SUGERENCIAS_REEMPLAZO`** (`docs/schema_live_pecuario.md` v14,
confirmada en vivo): `id`, `ID_Organizacion`, `reproductor_id` (FK
`fk_sugerencia_reemplazo_reproductor`, `ON DELETE CASCADE`), `parto_id`
(nullable, `SET NULL`), `motivo` (`max_partos_alcanzado` |
`camada_chica_parto_temprano`), `detalle` (texto ya formateado, p. ej. `4 partos
registrados — alcanzó el máximo configurado (4)` o `1 cría(s) viva(s) en su parto
#1 — menos que el mínimo configurado (2)`), `estado` (`pendiente` | `confirmada` |
`ignorada`, default `pendiente`), `creada_en`, `resuelta_en`. `UNIQUE
(reproductor_id, motivo)`: una sugerencia resuelta no vuelve a generarse para ese
motivo. Las crea SIEMPRE el trigger `trg_partos_evaluar_sugerencia_reemplazo`
(`AFTER INSERT ON PECUARIO_PARTOS`, solo con `madre_id`); nadie las crea a mano.

**Enums** (en vivo): `proposito_animal` = `reproductor, engorde, reemplazo,
descarte`; `estado_animal` = `activo, vendido, muerto, enfermo`.

**Qué hace la base al resolver** (cuerpos literales leídos de `pg_proc`):
- `trg_sugerencia_reemplazo_resuelta_en` (BEFORE UPDATE, solo si cambia `estado`):
  pone `resuelta_en = now()` al pasar de `pendiente` a `confirmada`/`ignorada`.
- `trg_sugerencia_reemplazo_confirmar_descarte` (AFTER UPDATE, solo al pasar a
  `confirmada`): `UPDATE PECUARIO_REPRODUCTORES SET proposito = 'descarte' WHERE id
  = NEW.reproductor_id`. Es el ÚNICO disparador de `proposito='descarte'`.
  "Ignorar" no toca ninguna otra tabla.
- `trg_sugerencia_reemplazo_bloquear_cambio_campos` (BEFORE UPDATE): un UPDATE solo
  puede cambiar `estado` (y `resuelta_en`, que fija la base); cualquier cambio de
  `reproductor_id`, `motivo`, `parto_id`, `detalle`, `ID_Organizacion` o
  `creada_en` falla con 400 incluso para `admin`.
- Ninguno de los tres es `SECURITY DEFINER`: corren con los permisos de quien hace
  el UPDATE.

**RLS** (aplicada 2026-10-04, `20261004120000`): SELECT a los 3 roles de la
organización; INSERT/UPDATE `admin` + `tecnico_campo`; DELETE `admin`. Verificada
por `tests/test_pecuario_sugerencias_reemplazo_rls.py`.

**FKs reales** (para los embeds de PostgREST): `fk_sugerencia_reemplazo_reproductor`
(Sugerencias → Reproductores), `fk_pecuario_reproductores_jaula`
(`jaula_actual_id` → Jaulas, `SET NULL`) y `fk_pecuario_jaulas_galpon` (`galpon_id`
→ Galpones, `SET NULL`). Entre Sugerencias y Reproductores hay una sola FK, y entre
Reproductores y Jaulas también (`madre_id`/`padre_id` apuntan a Reproductores, no a
Jaulas): el embed se resuelve sin hint y sin ambigüedad.

## 1. Fuente de datos: la TABLA con embeds, no la vista (decisión validada)

`vw_pecuario_sugerencias_reemplazo` existe (`id, ID_Organizacion, reproductor_id,
codigo_arete, jaula_actual_id, parto_id, motivo, detalle, estado, creada_en,
resuelta_en`), es una vista común (sin `security_invoker`, dueño `postgres`) con el
filtro escrito a mano `ID_Organizacion = auth_org_id() OR auth.role() =
'service_role' OR CURRENT_USER = 'postgres'`. Se probó con sesiones reales
(`authenticated`) sembrando datos `TEST-` en dos organizaciones:

- **Filtra bien por organización** (en una vista no `SECURITY DEFINER`,
  `CURRENT_USER` es quien consulta, no el dueño: no hay fuga como en el incidente de
  la RPC de Insumos). `anon` recibe `[]`.
- **No sirve para esta pantalla:** devolvió también las sugerencias de una hembra
  `vendido` y de una ya en `proposito='descarte'`, no trae `raza`, `estado`,
  `proposito` ni `codigo_poza`/galpón. Habría que consultar de nuevo para filtrar y
  para agrupar por jaula.

**Consulta elegida** (validada con sesión de `admin` y de `tecnico_campo`: HTTP 200,
devuelve solo las sugerencias de animales activos sin descarte de su organización,
incluida una hembra sin jaula con `PECUARIO_JAULAS: null`, y excluye vendidos y
descartados):

```
PECUARIO_SUGERENCIAS_REEMPLAZO?select=id,motivo,detalle,estado,reproductor_id,
  PECUARIO_REPRODUCTORES!inner(codigo_arete,raza,estado,proposito,jaula_actual_id,
    PECUARIO_JAULAS(codigo_poza,galpon_id,PECUARIO_GALPONES(codigo_galpon,nombre)))
&estado=eq.pendiente
&PECUARIO_REPRODUCTORES.estado=eq.activo
&PECUARIO_REPRODUCTORES.proposito=neq.descarte
&order=creada_en.asc
```
En supabase-js: `.from('PECUARIO_SUGERENCIAS_REEMPLAZO').select('id, motivo, detalle,
estado, reproductor_id, PECUARIO_REPRODUCTORES!inner(codigo_arete, raza, estado,
proposito, jaula_actual_id, PECUARIO_JAULAS(codigo_poza, galpon_id,
PECUARIO_GALPONES(codigo_galpon, nombre)))').eq('estado','pendiente')
.eq('PECUARIO_REPRODUCTORES.estado','activo').neq('PECUARIO_REPRODUCTORES.proposito','descarte')
.order('creada_en')`, filtrando además por `ID_Organizacion` (la RLS ya lo impone;
se repite por claridad, como en el resto de la app). Los embeds corren bajo la RLS
de cada tabla (todas con el patrón por organización).

Regla de visibilidad (igual que el mockup, `evaluarSugerenciaDescarte`): solo
animales `estado = 'activo'` y `proposito <> 'descarte'`. Un animal `enfermo` o
`vendido`/`muerto` deja de aparecer; si un `enfermo` vuelve a `activo`, su
sugerencia pendiente reaparece.

## 2. Alertas de Inicio

Hoy la sección "Alertas" de `inicio.tsx` es texto fijo ("No hay tareas ni
sugerencias pendientes por ahora."), sin consulta. Cambio:

- Misma consulta de §1 (con `useFocusEffect`, como el resto de Inicio, para que se
  refresque al volver de `/reemplazo` o de Parto).
- **Con sugerencias pendientes:** una sola tarjeta (no una por animal):
  título `N reproductora(s) sugerida(s) para reemplazo`, con N = reproductores
  DISTINTOS (`reproductor_id`); detalle con el desglose por motivo, contando
  sugerencias (`1 por máximo de partos · 2 por camada chica`, en ese orden fijo; solo
  los motivos con conteo > 0); botón `Ver lista` → `router.push('/reemplazo')`. Como
  un animal puede tener los dos motivos a la vez, la suma del desglose puede superar
  a N (divergencia respecto del mockup, que evaluaba un solo motivo por animal;
  documentada en `docs/schema_live_pecuario.md` v14).
- **Sin sugerencias pendientes** (o error de carga): se mantiene el texto actual.
- Las demás alertas del mockup (sanidad, stock, destete, retiro de macho…) NO se
  implementan acá.

## 3. Pantalla `/reemplazo`

Archivo previsto: `apps/granja-valencia/src/app/(protegido)/reemplazo/index.tsx`,
registrado en `_layout.tsx` (`reemplazo/index`). No es un tile de la grilla de
"Registrar": se llega desde la tarjeta de Alertas.

- Título "Sugeridas para reemplazo"; subtítulo `N reproductora(s) agrupadas por jaula
  — revisá y confirmá o ignorá cada una`. Sin sugerencias: "No hay reproductoras
  sugeridas para reemplazo por ahora."
- **Agrupación por jaula**, encabezado `Jaula X — Galpón Y · N sugerida(s)` (X =
  `codigo_poza`, Y = `codigo_galpon`, N = animales del grupo); si la jaula no tiene
  galpón, `Jaula X · N sugerida(s)`. Orden por `codigo_poza` ascendente; el grupo
  `Sin jaula asignada` (`jaula_actual_id` nulo) va al final.
- **Una fila por ANIMAL** (no por sugerencia): código de arete, raza (si existe), un
  badge por motivo (`Máx. partos` / `Camada chica`), el texto de `detalle` de cada
  sugerencia, y los botones `Confirmar descarte` / `Ignorar por ahora`. La acción es
  por animal porque la decisión es sobre el animal, no sobre una regla.
- Se refresca con `useFocusEffect` y después de cada acción.

## 4. Acción: Confirmar descarte / Ignorar por ahora

**Acción en BLOQUE por reproductor:** un Confirmar/Ignorar pasa a
`confirmada`/`ignorada` todas las sugerencias `pendiente` de ese `reproductor_id`.
**Sin "deshacer".** Antes de cada acción, un diálogo de confirmación (`Alert.alert`,
con "Cancelar"):
- Confirmar: "Se marcará a `<código>` como descarte. Esta acción no se puede
  deshacer."
- Ignorar: "No se volverá a sugerir el reemplazo de `<código>` por ninguno de sus
  motivos. Esta acción no se puede deshacer."

**Forma exacta del UPDATE** (validada en vivo con sesión de `admin` y de
`tecnico_campo`, `tests/test_pecuario_sugerencias_reemplazo_rls.py`):

```ts
const parsed = SugerenciaReemplazoResolverSchema.safeParse({ reproductor_id, ID_Organizacion, estado })
const { data, error } = await supabase
  .from('PECUARIO_SUGERENCIAS_REEMPLAZO')
  .update({ estado: parsed.data.estado })        // el cliente escribe SOLO estado
  .eq('reproductor_id', parsed.data.reproductor_id)
  .eq('ID_Organizacion', parsed.data.ID_Organizacion)
  .eq('estado', 'pendiente')
  .select('id')
```
- **`data` con ≥ 1 fila:** éxito. Confirmar → mensaje "`<código>` marcada para
  descarte."; Ignorar → "No se volverá a sugerir el reemplazo de `<código>`.". Se
  refresca la lista.
- **`data` vacío (0 filas):** nadie tenía pendientes (otro técnico ya las resolvió, o
  un rol sin permiso: la RLS descarta la fila sin error). Mensaje "Estas sugerencias
  ya fueron resueltas." y se refresca la lista.
- **`error`:** `42501`/"row-level security" → "No tenés permiso para resolver
  sugerencias."; fallo de red → "Sin conexión. No se guardó nada: reintentá cuando
  vuelva la señal."; cualquier otro, el mensaje de la base (incluida la excepción del
  trigger de columnas, que esta pantalla no debería provocar nunca). El botón se
  deshabilita mientras la llamada está en curso.

**Qué escribe el cliente y qué la base:**
| Escribe el cliente | Escribe la base |
|---|---|
| `PECUARIO_SUGERENCIAS_REEMPLAZO.estado` (`confirmada`/`ignorada`) | `resuelta_en` (trigger) |
| — | `PECUARIO_REPRODUCTORES.proposito = 'descarte'` (trigger, solo al confirmar) |

Confirmar no vende ni da de baja al animal: no cambia `estado` ni la jaula (la venta
o la baja son flujos aparte). Hoy ninguna vista ni función de la base lee
`proposito='descarte'`: solo lo escribe el trigger (y la pantalla lo usa para ocultar
la sugerencia).

## 5. Roles

- `admin` y `tecnico_campo` resuelven (botones visibles). Cualquier otro rol ve la
  lista sin botones. `auditor_qc` solo lee y NO es parte de esta app (opera desde el
  dashboard web).
- Ocultar los botones por rol es cosmético; la barrera real es la RLS ya aplicada
  (UPDATE solo `admin` y `tecnico_campo`, y el trigger que limita el UPDATE a
  `estado`).

## 6. Sin escritura offline

A diferencia de Insumos y Compras, esta pantalla no tiene patrón offline: la acción
es un UPDATE sobre filas que ya existen. No hay UUID de cliente que generar, ni
`device_id`/`created_offline_at` que completar, ni nada que encolar (tampoco hay
`SYNC_QUEUE`), y el resultado depende de qué estaba pendiente en el servidor en ese
momento. Sin conexión la acción falla con el mensaje de §4 y no se guarda nada.

## 7. Dependencias y riesgos

- **RLS permisiva de `PECUARIO_REPRODUCTORES`.** Hoy tiene una única política `ALL`
  por organización, sin distinguir rol. Eso es lo que permite que el UPDATE del
  trigger de confirmar (que corre con los permisos de quien confirma) funcione para
  `tecnico_campo`. **Si algún día se restringe esa tabla por rol** (por ejemplo,
  UPDATE solo para `admin`), el `UPDATE ... SET proposito='descarte'` del trigger
  afectaría 0 filas **sin error** (la RLS descarta la fila) para un `tecnico_campo`:
  la sugerencia quedaría `confirmada` y desaparecería de la lista, pero el animal
  seguiría como `reproductor`, una pérdida silenciosa. Cualquier migración que
  cierre la RLS de `PECUARIO_REPRODUCTORES` debe mantener este flujo (o volver el
  trigger `SECURITY DEFINER` con guardas explícitas). Lo protegen
  `test_confirmar_marca_descarte_en_el_reproductor_con_cualquier_rol_escritor` y los
  tests de la forma en bloque (`test_resolver_en_bloque_*`), todos con sesión real de
  `tecnico_campo`.
- **Descarte irreversible desde la app.** Volver una sugerencia a `pendiente` no
  restaura `proposito`; y una `ignorada` no se vuelve a generar (UNIQUE).
- **Ventana de datos.** La lista y la tarjeta se calculan sobre las sugerencias de la
  organización; hoy hay 0 (GRANJA-TEST no tiene ninguna hembra activa).
- **Datos de prueba.** Para ver una sugerencia real hace falta dar de alta una hembra
  activa con jaula y registrar un parto desde la pantalla de Partos: con 0 o 1 cría
  viva en su 1.º o 2.º parto genera `camada_chica_parto_temprano` al instante; con 4
  partos, `max_partos_alcanzado` (umbrales por defecto 4 y 2: GRANJA-TEST no tiene
  fila en `PECUARIO_CONFIGURACION`).

## 8. Contrato

`lib/validations/pecuario.ts`: se agrega `SugerenciaReemplazoResolverSchema =
SugerenciaReemplazoAccionSchema.extend({ estado: z.enum(['confirmada', 'ignorada']) })`
y `SugerenciaReemplazoResolverInput`. **`SugerenciaReemplazoAccionSchema` no se
modifica** (un test Python exige su cuerpo exacto). `'pendiente'` es inválido a
propósito. Tests Jest: `apps/granja-valencia/lib/validations/reemplazo.test.ts`.

## 9. Fuera de alcance

Las otras alertas del mockup; una ficha de reproductor individual (no existe en la
app; la acción vive en la lista); editar los umbrales (`max_partos_madre`,
`min_crias_vivas_parto_temprano`); cerrar la RLS de `PECUARIO_REPRODUCTORES`; validar
el sexo de `PECUARIO_PARTOS.macho_id` (backlog en `AI_STATE.md`).

## 10. Estado

Spec y contrato escritos; sin pantalla. Verificado: `tsc --noEmit`, Jest y los tests
Python de reglas de reemplazo y de RLS de Sugerencias (ver el reporte del commit).
Pendiente: construir la pantalla y la tarjeta, y la prueba on-device con `admin` y
`tecnico_campo`.
