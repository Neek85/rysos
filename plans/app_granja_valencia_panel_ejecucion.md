# Plan de ejecución — App Granja Valencia: Panel de indicadores (FASE 2 de 2)

> Autor: Claude Sonnet 5.5 · 2026-10-29. Spec: `specs/app_granja_valencia_panel_indicadores.md`.
> **Sin migración SQL en ninguna fase.** Todo el trabajo es app (Expo) + el contrato Zod ya entregado.
> Antes de tocar código de Expo/RN: leer la versión de `expo` en `apps/granja-valencia/package.json` (~57) y la
> doc versionada correspondiente (regla de `apps/granja-valencia/AGENTS.md`); no usar memoria de APIs.

## 0. Precondiciones (de la fase 1, ya hechas)

- [x] Schemas Zod de lectura en `lib/validations/pecuario.ts` (11 nuevos + `CAUSA_MORTALIDAD`).
- [x] `apps/granja-valencia/lib/validations/panel.test.ts` (Jest) pasando.
- [ ] **Decisiones D1-D4 de la spec §8.** Si Neyser no responde, se implementa el valor por defecto de cada una y
  queda anotado en `AI_STATE.md`; ninguna bloquea el orden de abajo.

## 1. Contrato (hecho en fase 1; en fase 2 solo se importa)

Importar con la ruta relativa que ya usan los demás tests/pantallas
(`../../../../lib/validations/pecuario` desde `lib/…`). **No** duplicar ni redefinir schemas en la app.
Verificación: `npx tsc --noEmit` y `npx jest` en `apps/granja-valencia` (hoy 17 suites / 203 tests).

## 2. Datos — `lib/panel/` (lógica pura + una función de carga)

Orden y criterio de terminado de cada paso:

1. **`lib/panel/formato.ts`** (puro, con test): `fmtEntero`, `fmtDecimal(n, dec)`, `fmtSoles(n)`, `fmtPct(n)`,
   `nombreMes(hoyISO)`. Verificar **en dispositivo** si `Intl`/`toLocaleString('es-PE')` funciona en Hermes
   (hallazgo H18); si no, formateo manual determinista (misma filosofía que `hoyOperativo`: sin `Intl`).
   *Hecho cuando:* test cubre `1840 → "S/ 1,840"`, `null → null`, redondeos a 1 decimal.
2. **`lib/panel/logica.ts`** (puro, con test — es donde viven las reglas de la spec):
   - `estadoCarga` → `'cargando' | 'error' | 'sin_datos' | 'ok'` (spec §2).
   - `intervaloPartos(fila)` con la tabla del §5 (individual / fallback "partos/hembra/año" / sin datos).
   - `fcrVisible(n)` y `gananciaVisible(n)`: `fcr ≤ 0` o `null` → sin dato; ganancia negativa se muestra.
   - `ordenarIncidencia(filas)` desc por `cantidad_mes`, `rotuloCausa(causa)` (incl. `null → Desconocida`).
   - `porcentajeEtapa(valor, total)`; `totalMuertesMes(filas)` = Σ `cantidad_mes`.
   - `rotuloGalpon(galpon, nombres)` → `nombre ?? codigo_galpon ?? 'Galpón sin nombre'`.
   *Hecho cuando:* tests cubren cada fila de las tablas del §3 y §5 (incluido el caso real −128,33 g/d y 0 filas).
3. **`lib/panel/datos.ts`**: una función `cargarPanel(supabase)` que lanza las lecturas en paralelo
   (`Promise.allSettled`, **una consulta por vista**, `select('*')`, sin filtro de organización: la vista ya
   filtra por `auth_org_id()`), valida cada resultado con `z.array(Schema).safeParse` y devuelve un objeto
   `{ [widget]: { estado, filas } }`. Un fallo de una vista **no** tumba el resto (cada widget tiene su estado).
   Las lecturas son solo `.select()`; **cero escrituras**. Join de galpones: una lectura extra de
   `PECUARIO_GALPONES` (`id, codigo_galpon, nombre`) solo cuando se despliega C4 (carga diferida).
   *Hecho cuando:* tipado limpio y test con un cliente simulado que devuelve `[]`, error y fila malformada.

## 3. Componentes — `components/panel/`

Réplica visual de `.kpi-grid` / `.kpi-tile` / `.bar-row` / `.section-label` del mockup (CSS líneas 282-306;
tokens en `theme/colors.ts`, ya existentes). Reusar `useThemeColors`. Sin librerías nuevas
(`react-native-svg` ya está, pero v1 **no** dibuja sparklines).

1. `KpiTile` (label, valor, pie opcional, estado: ok / sin datos / error / cargando). Siempre accesible
   (`accessibilityLabel` = label + valor). Sin `kpi-delta`.
2. `BarraIncidencia` / `BarraEtapa` (barra horizontal con valor y pct).
3. `SeccionPanel` (`section-label` + hint opcional).
4. `EstadoVacio` ("Sin datos todavía") y `EstadoError` ("No se pudo cargar" + Reintentar).
*Hecho cuando:* se ven los 4 estados de cada tile en claro y oscuro (el mockup define ambos temas).

## 4. Pantalla — `src/app/(protegido)/panel.tsx`

1. Ruta nueva `panel` (hermana de `inicio`), con `BackToInicioButton` y el título/subtítulo del mockup
   ("Panel de indicadores" / "Reproducción, producción y ventas", líneas 1734-1735).
2. Secciones en este orden (mockup): Reproducción (R1, R2, R3, R5) → Sanidad (S1, S2, S3, S4) →
   Población por etapa (P1) → Producción y ventas (Pr1, Pr2, Pr3, C1, C2, C3, C4).
   Subtítulos de ventana según spec H8 (R5 "12 meses", R3 sin "este mes"). Mes en el encabezado con
   `nombreMes(hoyOperativo())`.
3. **No** portar: Fertilidad, deltas, sparklines, hint de la línea 1737, hint 1767, hints de simulador 1800/1802.
4. Cargar con `cargarPanel` al enfocar la pantalla (`useFocusEffect` de `expo-router`, verificar la API en la doc
   de la versión instalada) y con pull-to-refresh. Cada widget gestiona su estado; el panel nunca queda en
   blanco por el fallo de una vista.
5. Gating por rol según D3: `rol` de `useProfile()`; `admin` y `tecnico_campo` ven la entrada. Es cosmético
   (la RLS filtra por org, no por rol); mismo patrón que `compras/index.tsx`.
*Hecho cuando:* `npx tsc --noEmit`, `npx expo lint` y `npx jest` limpios, y la pantalla renderiza con datos
reales de GRANJA-TEST (ver §6).

## 5. Tile de Inicio — `src/app/(protegido)/inicio.tsx`

1. Reemplazar el tile "Mortalidad del mes (ejemplo)" por **"Muertes del mes"**: lectura de
   `vw_pecuario_incidencia_patologias`, `totalMuertesMes(filas)`; sin `opacity:.7`, sin "(ejemplo)"; 0 filas →
   "Sin datos todavía" (D1).
2. El conjunto de 3 tiles pasa de `/proximamente/Dashboard` a `/panel`.
3. Los tiles I1/I2 **no cambian**.
*Hecho cuando:* Inicio muestra el número real y el tap abre el panel.

## 6. Verificación

**Con la sesión real de las cuentas de prueba (solo SELECT; sin escrituras):**
1. Lectura de las 12 vistas/tablas con admin y `tecnico_campo` de GRANJA-TEST: 200 y `safeParse` OK en cada una
   (script de verificación, igual al de la fase 1). Ninguna escritura contra GRANJA-VALENCIA ni COOP-AROMAS-VALLE.
2. Repetir el chequeo de aislamiento: ninguna fila con otro `ID_Organizacion`.

**On-device (Expo, build de desarrollo):** con la cuenta `tecnico_campo` de GRANJA-TEST:
- Los 4 estados (cargando / sin datos / error en modo avión / ok) de al menos un widget.
- C2, C3 y C4 muestran "Sin datos todavía" (esperado hoy: sin alimento con `lote_id`) y **no** "0".
- Formato de moneda y decimales (H18).
- Entre las **19:00 y las 24:00 de Lima**: el mes/rótulo y los widgets del mes coinciden con la fecha de Lima
  (las vistas usan `fn_hoy_operativo()`; la app, `hoyOperativo()`).
- Tema claro y oscuro; fuente grande del sistema.
- Con el rol admin y con `tecnico_campo`: misma pantalla.

**Cierre:** `npx tsc --noEmit`, `npx expo lint`, `npx jest` (con el recuento), actualizar
`docs/ESTADO_PROYECTO.md` y `AI_STATE.md`, commit a `staging`. Si algo falla 2 veces: detenerse y documentar
en `AI_STATE.md`.

## 7. Qué NO hace este plan

Ninguna migración ni cambio de vista (denominadores de mortalidad H6, mortalidad de lactancia H7, FCR pooled H4
quedan como hallazgos para una migración aparte con su propia revisión de seguridad); ni Fertilidad, ni deltas,
ni tendencias; ni escrituras; ni la ficha de poza (`vw_pecuario_ocupacion_poza`) ni la ficha de lote
(`vw_pecuario_seguimiento_lote`).
