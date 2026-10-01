# Spec — App Granja Valencia: Sanidad (registrar + configurar actividades)

## 0. Recon (confirmado, no asumido)

**Nota:** `claude/roadmap_granja_valencia_app_movil.md` no es un archivo del
repo (bitácora propia del usuario) — no se buscó. El mockup se leyó del
artifact `7vebvnVwLNR15TT9DL2DyX` (sección `data-screen="sanidad"` y
`guardarActividadSanidad`/`agregarActividadSanidad`).

**a/b. Tablas y relación** (`docs/schema_live_pecuario.md`, v9, migración
`20260923130000`): `PECUARIO_ACTIVIDADES_SANIDAD` es el catálogo por organización
(`nombre`, `alcance` enum `granja|galpon`, `frecuencia_dias` > 0 por CHECK,
`activo`). `PECUARIO_SANIDAD_REGISTROS` es el transaccional: N registros por
actividad (`actividad_id` NOT NULL, FK `ON DELETE RESTRICT`), `galpon_id`
nullable, `fecha`, `producto_usado`, `responsable`, `observaciones`. Sin migración
nueva necesaria.

**c. "Aplicar a quién":** NO es lote/poza/reproductor. El alcance real es
**toda la granja** o **un galpón** (`galpon_id`). Trigger
`trg_validar_sanidad_registro_galpon`: `alcance='galpon'` exige `galpon_id`;
`alcance='granja'` lo prohíbe. La app repite la regla en JS (UI), el trigger es
la fuente de verdad. Tratamientos por animal son otra tabla (`PECUARIO_TRATAMIENTOS`),
fuera de alcance.

**d. Mockup — campos reales.** Registrar: Actividad (chips del catálogo),
Galpón (solo si alcance galpón), tarjeta con "Cada N días" + "Última · Próxima"
(o "Sin registro previo"), Fecha, Producto usado, Responsable, Observaciones
(los tres opcionales). Actividades (admin): lista (nombre, alcance, N días) +
Agregar (Nombre, Alcance "Toda la granja"/"Por galpón", Frecuencia).

**e. Zod existente:** `SanidadActividadSchema`/`SanidadRegistroSchema` exigen
`id`/`device_id`/`created_offline_at` (diseño offline) y tienen consumidor real
(`tests/test_pecuario_sanidad_actividades.py`) — no se tocan. Se agregan
`SanidadActividadCrearSchema` y `SanidadRegistroCrearSchema` (contrato de INSERT).

**f. Datos GRANJA-TEST (vivo):** 1 galpón (`A`), 0 actividades, 0 registros, 1
perfil con `rol='admin'`. Se parte de catálogo vacío (la migración deliberadamente
no siembra).

## 1. Contrato — `lib/validations/pecuario.ts`

`SanidadActividadCrearSchema` (nombre trim 1–100, alcance enum, frecuencia entera
> 0) y `SanidadRegistroCrearSchema` (actividad_id uuid, galpon_id uuid|null, fecha
`YYYY-MM-DD`, producto/responsable ≤150, observaciones ≤500). La regla cruzada
galpón↔alcance no va en Zod (requiere el catálogo).

## 2. Pantalla

`apps/granja-valencia/src/app/(protegido)/sanidad/registrar.tsx`, ruta agregada
a `_layout.tsx`; tile "Sanidad" de Inicio apunta a `/sanidad/registrar`. Una
sola pantalla con dos modos (chips) como el mockup. Próxima fecha = última
fecha registrada (por galpón si aplica) + `frecuencia_dias`, calculada en cliente.

## 3. Recortes deliberados

- Sin "Deshacer" / contador de sesión (UI de simulador del mockup).
- Sin alertas de vencimiento en Inicio (`calcularAlertasSanidad`) — es el
  Panel de indicadores (ítem aparte del roadmap).
- Sin desactivar/editar actividades: el mockup solo lista y agrega (`activo`
  existe en la tabla; UI de baja queda para una tarea futura).
- Fecha como texto `AAAA-MM-DD` (mismo patrón que el resto de la app), con
  validación de fecha real.

## 4. Riesgo de seguridad abierto (no resuelto aquí)

La RLS de ambas tablas es "mismo org" para `authenticated`; **no distingue
rol**. "Actividades (admin)" se oculta por `rol === 'admin'` en la app, pero un
`tecnico_campo` autenticado puede insertar en el catálogo por API directa. Cerrarlo
exige una migración/policy por `auth_role()` → pasa por el gate de segunda
revisión de seguridad (§4.1.2); registrado en `AI_STATE.md`.

## 5. Estado

`tsc --noEmit` limpio; Jest 88/88 (8 nuevos en `lib/validations/sanidad.test.ts`);
`tests/test_pecuario_sanidad_actividades.py` 22/22 sin cambios. **No verificado en
dispositivo/Metro** desde este entorno (ni el flujo de las dos pantallas ni los
escenarios en vivo): pendiente de prueba manual de Neyser con GRANJA-TEST
(crear actividad granja + una por galpón, registrar ambas, intentar registrar
por galpón sin galpón).
