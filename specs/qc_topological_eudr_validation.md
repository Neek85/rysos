# Spec — Validación Topológica bajo Demanda en la Consola QC

## Contexto y corrección de premisas (verificado contra el repo antes de diseñar)

Un prompt `[PROMPT PARA CLAUDE]` pidió un "Motor de Validación Topológica
Serverless y Cruzamiento contra la Línea Base de Deforestación EUDR" —
verificado antes de escribir código:

- **Firma de la RPC incorrecta.** `fn_validar_topologia_eudr(p_monitoreo_id
  UUID, p_id_organizacion UUID)` asume (a) que solo `EUDR_MONITOREO`
  necesita validación topológica — falso: `EUDR_USO_SUELO` (subdivisiones
  de uso de suelo) es igual de propenso a auto-intersección/solapamiento,
  y de hecho más, al ser polígonos más pequeños y numerosos dentro de una
  misma parcela; y (b) que `ID_Organizacion` es `uuid` — es `text` en todo
  el schema (códigos como `"ORG-COOP-NORTE"`), confirmado en
  `docs/schema_live.md`. Firma real:
  `fn_validar_topologia_eudr(p_tabla_origen text, p_registro_id text)`
  — sin parámetro de organización: la función la resuelve leyendo la fila
  real (más robusto que confiar en un valor que el cliente podría mandar
  desincronizado), y el whitelist de tablas excluye
  `EUDR_INSTALACIONES` (siempre puntual, sin topología de área).
- **`EUDR_COBERTURA_BOSCOSA_2020` no existe, y no hay ninguna fuente de
  datos satelital real conectada a esta base.** Ya existe un motor Python
  bien probado para exactamente este cruce
  (`scripts/satellite_prevalidation.py::SatellitePrevalidationEngine`,
  ver `specs/modulo_prevalidacion_satelital.md`), pero recibe los
  polígonos de pérdida forestal (Hansen GFW/PNCBM MINAM) y ANP (SERNANP)
  como **parámetro** del caller — nunca se conectó a una fuente de datos
  real, ni como tabla propia ni como integración de API externa.
  **Implementar el cruce en SQL habría significado fabricar una tabla sin
  datos reales detrás** — el badge "Apto EUDR / Alerta Deforestación"
  mostraría un veredicto de cumplimiento legal sin ninguna verificación
  real, un riesgo serio si alguien lo tratara como una validación de
  verdad. **Se pausó con `AskUserQuestion` antes de implementar esta
  parte — el usuario confirmó dejarla fuera de alcance por ahora**
  ("Solo topología por ahora"): el badge de deforestación en la UI
  siempre muestra "Sin datos — no integrado", nunca un resultado
  inventado, y la RPC devuelve explícitamente
  `deforestacion: {disponible: false, motivo: "..."}` en vez de omitir el
  campo silenciosamente.
- **Cálculo de área con UTM 17S (EPSG:32717) es innecesario y menos
  preciso que lo que ya existe.** `fn_calcular_area_ha()`
  (`20260818_gis_core_sanitization.sql`) ya calcula área geodésica real
  vía `::geography` (no depende de elegir la zona UTM correcta para cada
  geometría, que puede variar según dónde caiga la parcela) y ya se
  mantiene actualizada automáticamente por trigger en las 3 tablas
  EUDR_\*. Se reutiliza esa función en vez de reimplementar el cálculo
  con `ST_Transform(..., 32717)`.
- **`audit_logs` no existía** — se crea `qc_validation_audit_log`
  (nombre más específico, sin PII: solo `tabla_origen`/`registro_id`/
  `ID_Organizacion` (código, no nombre)/`resultado` jsonb/`created_at`).
- **Push a `main`:** el prompt afirmaba en su paso 1 que había 35 commits
  "acordados en el paso anterior" para hacer push — **eso no es cierto**,
  el usuario nunca confirmó el push en el chat (se le preguntó
  explícitamente en la tarea anterior y la respuesta seguía pendiente).
  No se hizo push basado en una instrucción que da por hecho un acuerdo
  que no ocurrió — se sigue esperando confirmación directa del usuario
  para eso, por separado de esta tarea.

## Diseño

- **`fn_validar_topologia_eudr(p_tabla_origen text, p_registro_id text)
  RETURNS jsonb`** (`supabase/migrations/20260820_fn_validar_topologia_eudr.sql`):
  `ST_IsValid`/`ST_IsValidReason`, `ST_IsSimple`, `fn_calcular_area_ha()`,
  y solapamiento (`ST_Overlaps`/`ST_Contains`) contra otros polígonos
  `APROBADO` de la MISMA organización (unión de `EUDR_MONITOREO` +
  `EUDR_USO_SUELO`, excluyendo la propia fila). Sin `SECURITY DEFINER`
  — se invoca exclusivamente desde el Route Handler con el Service Role
  Key, que ya bypassa RLS (mismo patrón que `fn_guardar_inspeccion_completa`).
- **`app/api/qc/validate-spatial/route.js`**: `runtime='nodejs'`, valida
  el body (`lib/qcTopologyValidation.js::validateTopologyRequest`),
  invoca la RPC vía `lib/supabaseServerClient.js`, inserta en
  `qc_validation_audit_log` (best-effort, no bloquea la respuesta si
  falla), devuelve `{ result }`.
- **`lib/qcTopologyValidation.js`** (no pedido explícitamente, agregado
  por testabilidad — mismo criterio que `lib/driveSyncTrigger.js`):
  lógica pura de validación del request, separada de los efectos de lado
  del route.
- **`QcDetailEditor.jsx`**: botón "Validar Topología & EUDR" (oculto para
  `EUDR_INSTALACIONES`), badges `✓/⚠ Topología Válida/Con Errores`,
  `✓/⚠ Sin Solapamiento/Solapado (X%)`, badge de deforestación SIEMPRE
  "🛰️ Deforestación: sin datos (no integrado)" (texto estático, nunca
  derivado de un resultado inventado), y área en hectáreas. Banner de
  advertencia (no bloqueante) junto a Aprobar/Rechazar si la última
  validación encontró topología inválida o solapamiento — **no
  deshabilita el botón Aprobar**, mismo criterio ya establecido en
  ADR-001 (el chequeo de área es informativo, nunca bloqueante) aplicado
  acá por consistencia: la Consola QC ya tiene su propio mecanismo de
  decisión humana (Aprobar/Rechazar con motivo), duplicar eso con un
  bloqueo automático por topología habría sido una regla de negocio nueva
  no pedida ni justificada con precedente en el proyecto.

## Fuera de alcance de esta tarea

- Cruce real contra cobertura boscosa/ANP (requiere una fuente de datos
  real — API de Global Forest Watch, dataset SERNANP/PNCBM cargado a
  PostGIS — decisión de arquitectura aparte, ver pregunta al usuario
  arriba).
- Bloquear el botón Aprobar por resultado topológico (se advierte, no se
  bloquea — ver arriba).

## Criterios de aceptación

- AC1: `fn_validar_topologia_eudr` rechaza `EUDR_INSTALACIONES` con un
  mensaje claro.
- AC2: El campo `deforestacion.disponible` de la respuesta es siempre
  `false` — ningún código de esta tarea lo pone en `true`.
- AC3: `area_ha` en la respuesta coincide con `fn_calcular_area_ha()`
  (mismo cálculo, no una reproyección distinta).
- AC4: `npm run build` compila sin errores.
