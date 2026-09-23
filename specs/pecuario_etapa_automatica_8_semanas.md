# Spec — Etapa productiva automática: corte Recría → Engorde a 8 semanas (Pecuario Cuyes)

**Estado: spec de backend, migración ya redactada
(`supabase/migrations/20260922100000_pecuario_vista_etapa_automatica.sql`),
NO aplicada todavía contra la instancia real.** Aplicación manual pendiente
del usuario, después de correr los tests de este documento en staging —
ninguna migración se aplica sola contra la base real (system prompt §4.1.4).

## 1. Contexto

Punto 1 de las 3 decisiones de negocio cerradas por Neyser el 2026-09-22
(ver `pecuario_panel_indicadores.md` §2.27): el corte entre las etapas
"Recría" y "Engorde" de un lote es fijo, **8 semanas**. En el mockup esto
se reflejó únicamente como texto de ayuda (§2.27, punto 1) — deliberadamente
sin recalcular `etapa` en vivo dentro del simulador, porque el simulador no
avanza el tiempo dentro de una sesión, así que la brecha nunca se nota ahí.
Esta spec es la versión real: cómo debe calcularse en la base de datos.

## 2. Lo que ya existe (verificado contra las migraciones reales, no asumido)

- `PECUARIO_LOTES.etapa etapa_productiva DEFAULT 'recria'` — columna real,
  ya existe desde la migración v1
  (`20260910160000_pecuario_cuyes_core.sql`). Se fija a mano hoy (alta de
  lote, o manualmente al designar un lote como `reproductor`).
- `PECUARIO_LOTES.fecha_destete DATE NOT NULL DEFAULT CURRENT_DATE` —
  también real, misma migración v1. Según
  `pecuario_destete_recoleccion_semanal.md` §2-3, un `PECUARIO_LOTES` se
  crea precisamente en el momento de "Conformar lotes" del flujo de
  destete — por lo tanto `fecha_destete` ya es, en la práctica, la fecha
  en que el lote nace como tal. No requiere backfill: todo lote existente
  ya tiene un valor válido (el `DEFAULT CURRENT_DATE` garantiza que nunca
  es NULL).
- `etapa_productiva` (enum): `'lactancia' | 'recria' | 'engorde' | 'reproductor'`.

## 3. Decisión de diseño: vista calculada, no columna mutada por cron

Se evaluaron dos caminos:

1. **Job programado** (pg_cron o similar) que actualice `etapa` a
   `'engorde'` cuando corresponda. Descartado: agrega infraestructura de
   scheduling nueva (no confirmado si pg_cron está habilitado en esta
   instancia), y si el job deja de correr, el dato queda mal en silencio
   — exactamente el patrón de "promesa/dato que no se refresca" que las
   auditorías del mockup vinieron corrigiendo toda la sesión (ver
   `pecuario_destete_recoleccion_semanal.md` §6-9).
2. **Vista calculada en el momento de la consulta** (elegida). Postgres no
   permite `CURRENT_DATE` en una columna `GENERATED ALWAYS` (requiere
   funciones inmutables), así que una columna generada tampoco era
   posible — la vista es la única forma de que el valor esté siempre
   exacto sin un proceso aparte que pueda fallar.

**`PECUARIO_LOTES.etapa` no se toca.** Sigue siendo la columna real,
editable a mano, que ya usan `MortalidadRegistroSchema.etapa` y el resto
del código existente (incluida la app de campo, cuando exista). La nueva
vista `vw_pecuario_lotes_etapa` expone además `etapa_calculada` (el valor
efectivo, con el corte de 8 semanas ya aplicado) y `dias_para_engorde`
(cuenta regresiva, útil para el Panel de indicadores). Cualquier pantalla
nueva que necesite mostrar la etapa "de verdad" debe leer de la vista, no
de la columna base — la columna base solo se auto-avanza en la vista, no
en la tabla.

## 4. Regla exacta

```
etapa = 'recria' AND estado = 'activo' AND (CURRENT_DATE - fecha_destete) >= 56
  => etapa_calculada = 'engorde'
cualquier otro caso (lactancia, reproductor, engorde ya fijado a mano,
lote no activo)
  => etapa_calculada = etapa (sin cambio)
```

`'lactancia'` y `'reproductor'` quedan explícitamente fuera de la regla
automática: en la práctica un `PECUARIO_LOTES` nace ya en `'recria'` (se
crea al destetar, ver Sección 2), así que `'lactancia'` describe más bien
el estado de una camada todavía en `PECUARIO_PARTOS`/`CAMADAS_LACTANCIA`,
no de un lote — se deja en el enum por compatibilidad, pero la vista no
la transiciona. `'reproductor'` es una decisión humana (se aparta un
animal/lote como pie de cría) que nunca debe revertirse sola por tiempo
transcurrido.

## 5. Migración

`supabase/migrations/20260922100000_pecuario_vista_etapa_automatica.sql` —
`CREATE OR REPLACE VIEW public.vw_pecuario_lotes_etapa` (idempotente),
filtro de organización escrito a mano en el `WHERE` (mismo criterio que
`vw_pecuario_insumos_stock` y las demás vistas del módulo, por la lección
de ADR-001: una vista corre con privilegios del dueño y no hereda RLS de
la tabla base). `GRANT SELECT ... TO authenticated`, mismo patrón que las
vistas existentes.

Aditiva y no destructiva: no hay `ALTER`/`DROP` sobre `PECUARIO_LOTES`,
ningún dato existente se reescribe.

## 6. Contrato de datos

No requiere cambios en `lib/validators/pecuario.ts` — la vista es de solo
lectura y no participa de ningún `INSERT`/`UPDATE` desde la app. Cuando el
dashboard web o la app de campo necesiten mostrar la etapa calculada,
consultan `vw_pecuario_lotes_etapa` en vez de `PECUARIO_LOTES` directo;
no hay contrato Zod de escritura asociado.

## 7. Tests requeridos antes de aplicar en producción

Aislamiento RLS cruzado (obligatorio, system prompt Sección 3.1):

- Un usuario autenticado de la Organización A no debe poder leer, a
  través de `vw_pecuario_lotes_etapa`, ningún lote de la Organización B
  (ni siquiera aunque `etapa_calculada` recién haya cambiado a
  `'engorde'`).

Lógica de cálculo (unitarios contra datos de prueba, no contra
producción):

- Lote con `fecha_destete` hace 40 días, `etapa='recria'`,
  `estado='activo'` → `etapa_calculada = 'recria'`, `dias_para_engorde = 16`.
- Lote con `fecha_destete` hace exactamente 56 días, mismo estado →
  `etapa_calculada = 'engorde'`, `dias_para_engorde = NULL`.
- Lote con `fecha_destete` hace 90 días pero `etapa='reproductor'` (fijado
  a mano) → `etapa_calculada = 'reproductor'` (la regla automática NO lo
  pisa).
- Lote con `fecha_destete` hace 90 días pero `estado != 'activo'` (ej.
  vendido/dado de baja) → `etapa_calculada` se mantiene igual a `etapa`
  (no se recalcula un lote que ya no está activo).

## 8. Pendiente

- Cuando exista `docs/schema_live_pecuario.md` actualizado en esta
  sesión (no se pudo confirmar su contenido actual — ver nota de
  transparencia entregada a Neyser junto con esta spec), reconfirmar que
  no hay ninguna otra columna/trigger que ya intente resolver esta misma
  regla por otro camino, para no terminar con dos fuentes de verdad.
- Posible próximo paso, no incluido en esta spec: una vista agregada
  "lotes por etapa" (conteo por galpón/organización) para alimentar
  directamente el Panel de indicadores — se deja para cuando se construya
  esa sección del panel contra datos reales.
- `docs/ESTADO_PROYECTO.md` debe actualizarse con esta tarea en el mismo
  commit (system prompt §4.1.3) — no se pudo editar desde esta sesión
  porque el archivo no está presente en el directorio de trabajo actual
  (ver nota de transparencia); queda como paso manual para quien aplique
  esta migración con acceso al repo real.
