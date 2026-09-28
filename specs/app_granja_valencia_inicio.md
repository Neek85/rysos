# Spec — App Granja Valencia: Pantalla Inicio (hub post-login)

> Réplica del mockup real (`claude.ai/artifact/7vebvnVwLNR15TT9DL2DyX`,
> sección `<!-- INICIO -->`, líneas 727-816 del HTML exportado). Fuente
> literal para colores/tipografía/copy/íconos SVG — leída directo del
> artifact, no reconstruida de memoria.

## 1. Alcance

Reemplaza a `galpones-pozas.tsx` como pantalla raíz autenticada (nueva
ruta `(protegido)/inicio.tsx`). `galpones-pozas.tsx` sigue existiendo
sin cambios de lógica — se mueve dentro del grupo protegido y se vuelve
alcanzable desde el tile "Pozas" del grid.

Incluye:
- 3 stat-tiles arriba, tocables como conjunto (llevan a
  `/proximamente/Dashboard`, placeholder hasta que exista el Panel real).
- Sección "Alertas" con estado vacío.
- Grid de 12 acciones (2 columnas), mismo orden y mismos íconos SVG que
  el mockup — 11 van a un placeholder "Próximamente" parametrizado por
  título (`(protegido)/proximamente/[title].tsx`, ruta dinámica única,
  no 11 archivos casi idénticos); "Pozas" va a la pantalla real
  (`galpones-pozas.tsx`).
- Header persistente (`AppHeader`, `components/AppHeader.tsx`), montado
  una sola vez en `(protegido)/_layout.tsx` vía `screenOptions.header`
  (patrón oficial de Expo Router,
  https://docs.expo.dev/router/advanced/authentication/ +
  https://docs.expo.dev/router/advanced/stack/) — reemplaza el botón de
  texto "Cerrar sesión" que vivía suelto en `galpones-pozas.tsx`.

## 2. Contrato de datos (Zod) — compartido, en `lib/validations/pecuario.ts`

```ts
export const PoblacionResumenSchema = z.object({
  ID_Organizacion: z.string(),
  total_poblacion: z.coerce.number().int().nonnegative(),
  total_reproductores: z.coerce.number().int().nonnegative(),
  total_recria: z.coerce.number().int().nonnegative(),
  total_engorde: z.coerce.number().int().nonnegative(),
  total_lactancia: z.coerce.number().int().nonnegative(),
})
```
Tipos ajustados exactamente a las columnas reales de
`vw_pecuario_poblacion_resumen` (confirmadas en vivo antes de escribir
esto) — sin agregar ninguna columna de más. `useProfile()` se amplió
(`apps/granja-valencia/lib/supabase/useProfile.ts`) para resolver
también `nombreOrganizacion` (de `"ORGANIZACIONES"."Nombre_Organizacion"`
— la PK real de `ORGANIZACIONES` es `"ID"`, no `"ID_Organizacion"`, no se
repite esa confusión). Retorno completo:
`{ organizacion, nombreOrganizacion, rol, loading }`.

**Reproductoras activas** (segunda stat-tile) no viene de una vista —
es un `count` directo sobre `PECUARIO_REPRODUCTORES` filtrado por
`sexo = 'hembra' AND estado = 'activo'` (columnas y valores de enum
confirmados en vivo, mismo patrón RLS `auth_org_id()` que el resto del
módulo).

## 3. Header persistente (`AppHeader`)

Réplica visual del `.statusbar` del mockup: fondo `accent`, nombre +
código de organización (`Nombre_Organizacion` / `ID`), pill de conexión,
botón circular de logout con el mismo ícono SVG (`log-out`, path data
literal del mockup). Montado una sola vez por `(protegido)/_layout.tsx`
— Inicio, Galpones/Jaulas y cualquier pantalla futura dentro del grupo
lo heredan automáticamente, sin repetir el componente por pantalla.

## 4. Íconos

`components/ui/Icon.tsx` — SVG (`react-native-svg@15.15.4`, versión
confirmada contra `expo/bundledNativeModules.json` antes de instalar,
no de memoria) con el path data literal de cada ícono del mockup
(objeto `ICONS` del artifact): `parto`, `destete`, `pesaje`,
`mortalidad`, `venta`, `sanidad`, `insumos`, `empadre`, `lotes`, `pozas`,
`compras`, `traslado`, más `logout` y `back` (del statusbar y de
`.back-btn` respectivamente). `currentColor` funciona en
`react-native-svg` vía el prop `color` del `<Svg>` raíz (confirmado en
el código fuente del paquete antes de usarlo).

## 5. Desviaciones deliberadas del mockup

1. **Tile "Empadre" siempre visible.** El mockup lo oculta/muestra según
   un toggle de simulador (`identificacionIndividualActiva`, ver
   `tileEmpadre.style.display` en el JS del artifact) — pero esa opción
   nunca existió como columna real en `PECUARIO_CONFIGURACION`
   (confirmado en vivo, dos veces, en el reconocimiento previo a esta
   tarea). No hay nada real que condicione la visibilidad, así que el
   tile queda siempre visible.
2. **Pill de conexión estática, siempre "En línea".** El mockup la
   controla con un toggle de simulador (`data-online`) para probar el
   escenario offline. Esta versión no tiene todavía ninguna cola de
   sincronización real (`SYNC_QUEUE` no existe para esta app) — se
   conecta a lógica de red real cuando esa infraestructura exista, no
   antes.
3. **Sección "Alertas" con estado vacío fijo, sin conectar ninguna
   fuente.** El mockup ya tiene `obtenerAlertas()` (tareas de limpieza,
   sugerencias de reemplazo de reproductoras, etc.) — esta versión
   siempre muestra "No hay tareas ni sugerencias pendientes por ahora."
   hasta que cada fuente se conecte pantalla por pantalla (empezando por
   las que ya tienen datos reales: sugerencias de reemplazo desde
   `PECUARIO_SUGERENCIAS_REEMPLAZO`, ítem 8 del roadmap web).

## 6. Estado

EN DISEÑO (2026-09-28).
