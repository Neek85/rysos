# Spec: huso horario operativo (America/Lima) en Pecuario

**Estado:** Migración 1 redactada y probada en texto, **NO aplicada**. Redactó Claude (Cowork);
revisión de seguridad pendiente. Plan: `plans/pecuario_huso_horario_ejecucion.md`.

## 1. Problema

La base corre en UTC (`TimeZone=UTC`) y las vistas Pecuario calculan "hoy", "el mes" y los
"últimos 12 meses" con `CURRENT_DATE`. El negocio opera en Lima (UTC−5 fijo, sin horario de
verano), así que entre las 19:00 y las 24:00 de Lima `CURRENT_DATE` ya es "mañana": el mes, la
ventana de 12 meses y los 56 días desde el destete se calculan con un día de adelanto.
Consecuencias reales ya observadas: 8 tests del panel de indicadores que fallaban de noche y el
test de Empadre `'2026-10-08' != '2026-10-07'` (trigger con `CURRENT_DATE`).

## 2. Decisión

- Dos funciones `LANGUAGE sql STABLE`, sin `SECURITY DEFINER` ni `SET`, para que el planificador
  las expanda dentro de la consulta:
  - `public.fn_fecha_operativa(p_ts timestamptz) RETURNS date` = `(p_ts AT TIME ZONE 'America/Lima')::date`
  - `public.fn_hoy_operativo() RETURNS date` = `fn_fecha_operativa(now())`, sin argumentos
    (un argumento como la organización la evaluaría por fila).
- `EXECUTE` solo para `anon`, `authenticated` y `service_role` (las vistas corren con los
  privilegios del dueño, pero las funciones se comprueban contra el rol que consulta).
- Toda aritmética de ventanas en fechas puras: `date_trunc('month', <date>::timestamp)::date`,
  nunca el overload `timestamptz` (depende del huso de sesión).
- `vw_pecuario_ventas_mes` gana, al final, `animales_vendidos_mes integer NOT NULL` = suma de
  `cantidad` sin el valor vestigial `guano` (0 si no hay filas de animales). `monto_total_mes`
  sigue sin incluir `PECUARIO_VENTAS_SUBPRODUCTOS`.
- Contrato Zod futuro del panel (aún no se implementa): `animales_vendidos_mes: z.number().int().nonnegative()`.

## 3. Alcance

**Migración 1 (esta):** las funciones y 8 vistas con `CREATE OR REPLACE VIEW`, que conserva
dueño, ACL y COMMENT: `lotes_etapa`, `reproduccion_mes`, `intervalo_partos`,
`reemplazo_reproductoras_anual`, `indicadores_sanitarios_mes`, `incidencia_patologias`,
`pesos_promedio_mes`, `ventas_mes`. `poblacion_resumen`, `ocupacion_poza` y `seguimiento_*`
dependen de `lotes_etapa` sin cambio de texto. Ninguna otra columna cambia de nombre, tipo ni orden.

**Migración 2 (aparte):** los 15–16 `DEFAULT CURRENT_DATE` de columnas `date` de Pecuario; las
funciones `fn_cerrar_historial_macho_anterior`, `fn_crear_insumo_con_stock_inicial` y
`trg_resolver_retiro_macho_pendiente`; las vistas SUPERADA (`desinfeccion_estado`,
`limpieza_galpon_estado`) y `retiros_macho_pendientes`.

**Cliente (aparte):** helper único de "hoy" en la app Expo (`hoyISO()` está copiada en 10
pantallas con `toISOString()` UTC); tests existentes que asumen UTC o `date.today()`
(`test_pecuario_etapa_automatica.py`, `test_pecuario_poblacion_vistas.py`,
`test_pecuario_empadre_asignacion_macho.py:382`, `test_pecuario_panel_indicadores.py`).

## 4. Fuera de alcance

Permisos de las vistas (ya resueltos en ADR-043: `anon`/`authenticated` solo `SELECT`/`MAINTAIN`;
`CREATE OR REPLACE VIEW` los conserva, esta migración no ejecuta GRANT/REVOKE sobre vistas);
huso por organización (la función sin argumentos fija Lima); `PECUARIO_VENTAS_SUBPRODUCTOS`.

## 5. Criterios de aceptación

1. El SQL (sin comentarios ni literales) no contiene `CURRENT_DATE` ni `now()::date`; 8 `CREATE OR REPLACE VIEW`.
2. Las funciones cumplen el contrato (sql, STABLE, sin DEFINER/SET; EXECUTE solo anon/authenticated/service_role).
3. `fn_fecha_operativa('2026-10-01T04:30:00Z') = 2026-09-30` y `('…05:00:00Z') = 2026-10-01`; `fn_hoy_operativo()` = hoy de Lima (con anon y authenticated).
4. Las 8 vistas se leen con sesión `authenticated` sin error de permisos; aislamiento por organización intacto; `anon` sin error (0 filas).
5. En GRANJA-TEST: parto del día 1 del mes de Lima cuenta y el del día anterior no; lote a `hoy−56` es `engorde` y a `hoy−55` tiene `dias_para_engorde = 1`; ventas 2 + 3 del mes ⇒ `animales_vendidos_mes = 5` y `ventas_mes = 2` (la del mes anterior no cuenta); mortalidad del día 1 entra en el mes.
6. Reversa idempotente (`supabase/rollbacks/20261008100000_huso_horario_lima_rollback.sql`): vuelve las 8 vistas a su texto previo, conserva `animales_vendidos_mes` y no toca GRANT; los `DROP FUNCTION` van comentados.

## 6. Cobertura de pruebas (honestidad)

Los casos con base (d.) solo discriminan el error antiguo entre las 19:00 y las 24:00 de Lima.
Fuera de esa ventana UTC y Lima coinciden y d. no distingue las dos implementaciones; lo que
cubre el caso a cualquier hora es lo estático (a.) más las funciones con instantes fijos (b.).
`tests/test_pecuario_huso_horario.py`.
