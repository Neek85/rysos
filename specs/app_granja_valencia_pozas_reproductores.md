# Spec — App Granja Valencia: Pozas (directorio) + Ficha de poza + Alta de reproductor

> Primera pieza real de la nueva hoja de ruta — desbloquea datos reales
> para Empadre/Partos/Destete/Pesaje (sin reproductores registrados, esos
> flujos no tienen nada que operar). El tile "Pozas" del grid de Inicio
> deja de apuntar directo al formulario de alta de Galpones/Jaulas
> (`galpones-pozas.tsx`) y pasa a apuntar a este directorio real — ese
> formulario sigue existiendo intacto, reubicado como "+ Nueva poza /
> galpón" dentro del directorio.

## 0. Recon previo (confirmado en vivo antes de escribir código)

- `PECUARIO_CONFIGURACION.alerta_consanguinidad_activa` (boolean, default
  `true`) y `.generaciones_consanguinidad` (int, default `3`) **sí
  existen como columnas reales** — a diferencia de "identificación
  individual", que se confirmó en una tarea anterior que NO existe. Son
  conceptos distintos, no corren la misma suerte. GRANJA-VALENCIA no
  tiene fila propia en esta tabla todavía, así que el comportamiento
  real hoy es el default de columna: alerta activa, 3 generaciones —
  igual al default de `fn_son_parientes(generaciones INT DEFAULT 3)`. El
  código de la app lee la tabla con fallback a estos defaults, no los
  hardcodea — si Neyser crea una fila de configuración más adelante con
  otros valores, la app los respeta sin cambios de código.
- `proposito_animal` (enum completo): `reproductor`, `engorde`,
  `reemplazo`, `descarte`. No se expone en el formulario — queda en su
  default de tabla (`'reproductor'`).
- `PECUARIO_REPRODUCTORES.madre_id`/`padre_id` son FK reales
  self-referencing a la misma tabla (`REFERENCES "PECUARIO_REPRODUCTORES"(id)
  ON DELETE SET NULL`). `jaula_actual_id` es FK a `PECUARIO_JAULAS(id)`.
  `codigo_arete` tiene `UNIQUE ("ID_Organizacion", codigo_arete)`
  (`uq_reproductor_org_arete`).
- `PECUARIO_LOTES.poza_actual_id` es FK real a `PECUARIO_JAULAS(id)` —
  usado para la ocupación de la ficha de poza (vacío hasta que exista
  Destete real, no es un bug).
- RLS de `PECUARIO_REPRODUCTORES` confirmada por `pg_policies` (no por
  analogía): `FOR ALL TO authenticated`, `auth_org_id()`-scoped, mismo
  patrón que el resto del módulo.

## 1. Contrato de datos (Zod) — compartido, en `lib/validations/pecuario.ts`

```ts
export const SEXO_CUY = ['macho', 'hembra'] as const
export const ReproductorAltaSchema = z.object({
  ID_Organizacion: z.string().min(1),
  codigo_arete: z.string().trim().min(1, 'El código de arete es obligatorio.'),
  sexo: z.enum(SEXO_CUY),
  raza: z.string().trim().optional(),
  fecha_nacimiento: z.string().optional(),
  jaula_actual_id: z.string().uuid().nullable().optional(),
  madre_id: z.string().uuid().nullable().optional(),
  padre_id: z.string().uuid().nullable().optional(),
  advertencia_confirmada: z.boolean().default(false),
})
```
`proposito`/`estado` quedan en su default de tabla, no se envían.
Violación de `uq_reproductor_org_arete` (Postgres `23505`) se traduce a
un mensaje claro ("Ya existe un reproductor con ese código de arete en
esta organización."), nunca el error crudo de Postgres.

## 2. Pantalla "Pozas" (directorio)

`(protegido)/pozas/index.tsx`. Lista `vw_pecuario_ocupacion_poza` de la
organización (código, galpón si tiene — resuelto por un fetch separado a
`PECUARIO_GALPONES`, la vista solo trae `galpon_id` — tipo_uso, badge
`total_animales / capacidad_max`). Buscador por código, filtro
client-side (no hace falta un endpoint nuevo). Botón "+ Nueva poza /
galpón" navega a `galpones-pozas.tsx` (reubicado, no modificado). Dos
secciones fijas al final, siempre visibles (mismo criterio ya aplicado
al tile Empadre de Inicio — no hay toggle real que las condicione):
"Sin asignar" (reproductores activos con `jaula_actual_id IS NULL`) e
"Historial" (`estado IN ('vendido','muerto')`).

El botón "Escanear" (QR) del mockup queda fuera de alcance — no hay
lector QR implementado todavía; se omite en vez de fingir que funciona.

## 3. Pantalla "Ficha de poza"

`(protegido)/pozas/[id].tsx`. Header (código, galpón + tipo_uso, badge
de ocupación) + resumen usando directo `vw_pecuario_ocupacion_poza`
(ya trae todos los totales — no se duplica ese cálculo a mano).
"Ocupantes": `PECUARIO_REPRODUCTORES` con `jaula_actual_id` = esta poza y
`estado='activo'`. "Lotes": `PECUARIO_LOTES.poza_actual_id` = esta poza
(vacío hasta que exista Destete real). Botón "+ Nuevo reproductor en
esta poza" **solo visible si `tipo_uso` es `'empadre'` o `'maternidad'`**
— regla real por tipo de poza (replicada tal cual del mockup), no un
toggle de organización.

## 4. Pantalla "Alta de reproductor"

`(protegido)/reproductores/nuevo.tsx`, con `jaula` opcional por query
param (pre-seleccionada si viene desde una ficha de poza). Campos: sexo
(chip Hembra/Macho), código de arete (obligatorio, + "Sugerir" que arma
el siguiente correlativo `H-00X`/`M-00X` según lo que ya exista para esa
organización y sexo), raza (chips Andina/Perú/Inti/Otra — "Otra" revela
un input libre, se guarda como texto plano), fecha de nacimiento
(opcional), jaula asignada (chips de pozas reales + "Sin asignar"),
madre (chips de hembras activas identificadas — hoy vacío, "Sin madre
identificada"), padre (ídem, machos).

**Aviso de consanguinidad NO bloqueante:** al cambiar jaula/madre/padre/
sexo, se buscan los ocupantes activos de sexo opuesto en la jaula
elegida y se llama `fn_son_parientes(madre_id, ocupante.id, generaciones)`
y `fn_son_parientes(padre_id, ocupante.id, generaciones)` por cada uno
(la capacidad de una jaula es baja, nunca más de un puñado de llamadas).
Si `sexo='macho'`, se suma `fn_jaula_tiene_otro_macho_activo(jaula_id)`
al mismo banner. **Todo el chequeo (ambas partes) está gateado por
`PECUARIO_CONFIGURACION.alerta_consanguinidad_activa`** — el comentario
real de la migración `20260927100000` documenta que ese toggle cubre
"la advertencia de consanguinidad... o al dar de alta un reproductor ya
en una jaula", combinando consanguinidad + "jaula ya ocupada" en un
único banner y un único booleano de confirmación
(`PECUARIO_REPRODUCTORES.advertencia_confirmada`, cuyo propio comentario
en esa migración dice literal: "aplicado al alta de un reproductor ya
asignado a una jaula desde el momento de creación" — este es exactamente
ese caso). El banner nunca bloquea el guardado; el checkbox "Entiendo el
riesgo" solo aparece si hay advertencia, y solo entonces puede marcar
`advertencia_confirmada=true` — sin advertencia, queda siempre en
`false`.

## 5. Estado

EN DISEÑO (2026-09-28).
