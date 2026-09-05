# Índice de ADRs

Generado a partir del contenido real de cada archivo en `docs/adr/`
(título, `Fecha`/`Estado` cuando existen esos campos — no todos los ADRs
más antiguos los tienen en el mismo formato). "Tabla/módulo" es un
resumen de una línea del alcance real de cada ADR, no una cita textual.

**Nota de estado (2026-09-04):** 4 ADRs (`032`, `033`, `034`, `035`)
tenían su propio campo `Estado` desactualizado (decían "Propuesto...
sin commitear" pese a estar aplicados y commiteados hace días) — se
corrigieron como parte de esta misma tarea, junto con este índice.

| # | Título corto | Tabla/módulo | Fecha | Estado |
|---|---|---|---|---|
| [001](ADR-001-gis-sanitization-and-eudr-triggers.md) | Sanitización espacial GIS Core y triggers EUDR | `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` | 2026-08-18 | Aceptado |
| [002](ADR-002-padron-enterprise-y-baja-cascada.md) | Padrón Enterprise: CSV dividido, pre-validación en vivo, baja en cascada | `PADRON_SOCIOS`/`PADRON_PARCELAS` | 2026-08-19 | Aceptado |
| [003](ADR-003-consola-qc-server-actions-escritura.md) | Consola QC: escrituras vía Server Actions + Service Role Key | `EUDR_*` (`lib/actions/qcActions.js`) | 2026-08-21 | Aceptado |
| [005](ADR-005-qc-editor-geometria-y-solapamiento.md) | Editor Vectorial de QC: 2 bugs reales + solapamiento auditable | `EUDR_MONITOREO`/`EUDR_USO_SUELO` (Consola QC) | 2026-08-21 (Fase A: 08-22) | Aceptado |
| [006](ADR-006-capa-contexto-parcelas-vecinas.md) | Capa de contexto de parcelas vecinas (Fase 3) | `EUDR_MONITOREO` (Consola QC, mapa) | 2026-08-21 | Aceptado |
| [007](ADR-007-integridad-referencial-id-organizacion.md) | Integridad referencial de `ID_Organizacion` | `PADRON_SOCIOS`/`PADRON_PARCELAS`/`ORGANIZACIONES` | 2026-08-21 | Aceptado y aplicado (FK validada) — nota de corrección de ADR-023 agregada |
| [008](ADR-008-etiqueta-organizacion-prueba-y-guardarail-e2e.md) | Etiqueta `es_organizacion_prueba` + guardarail del E2E test | `ORGANIZACIONES` | 2026-08-22 | Aceptado |
| [009](ADR-009-fix-mensaje-error-sync-drive.md) | Fix `detail` vacío en `/api/gis/sync-drive` + migración ORG-COOP-NORTE→ORG-TEST-E2E | `EUDR_*` (Ingestor Google Drive) | 2026-08-21 | Aceptado y verificado en vivo |
| [010](ADR-010-vinculo-real-uso-suelo-monitoreo.md) | Vínculo real `EUDR_USO_SUELO` → `EUDR_MONITOREO` padre (Fase B0) | `EUDR_USO_SUELO`/`EUDR_MONITOREO` | 2026-08-23 | Aceptado y verificado en vivo |
| [011](ADR-011-cobertura-completa-uso-suelo.md) | Cobertura completa de subdivisiones de Uso de Suelo (Fase B) | `EUDR_USO_SUELO` | 2026-08-23 | Aceptado, verificado, corregido el mismo día |
| [012](ADR-012-eudr-etl-protege-registros-revisados.md) | El ETL de Drive protege registros ya revisados en resincronizaciones | `EUDR_*` (ETL Python) | 2026-08-23 | Aceptado y verificado en vivo |
| [013](ADR-013-audit-logs-conectado-a-consola-qc.md) | `audit_logs` conectado a la Consola QC | `audit_logs` / `EUDR_*` | 2026-08-23 | Aceptado y verificado en vivo |
| [014](ADR-014-codigo-parcela-unico-por-ubicacion.md) | Un código de parcela = un único lugar físico | `PADRON_PARCELAS`/`EUDR_MONITOREO` | 2026-08-23 | Aceptado y verificado en vivo |
| [015](ADR-015-fix-puntos-columns-id-origen.md) | `PUNTOS_COLUMNS` nunca pedía `id_origen` (no era la migración) | `vw_monitoreo_puntos` | 2026-08-23 | Aceptado y verificado en vivo |
| [016](ADR-016-padron-autocompletado-excluye-inactivos.md) | El autocompletado de Inspecciones excluye socios/parcelas de baja | `PADRON_SOCIOS`/`PADRON_PARCELAS` | 2026-08-23 | Aceptado y verificado en vivo |
| [017](ADR-017-formato-real-exportacion-trazabilidad.md) | El exportador de `/dashboard/mapa` usa el GeoJSON oficial de la UE, no un "DDS" propio | `vw_monitoreo_web` (`lib/eudrDdsExporter.js`) | 2026-08-23 | Aceptado y verificado en vivo |
| [018](ADR-018-editor-vectorial-restriccion-por-tabla.md) | El Editor Vectorial restringe botones de dibujo por tabla destino, prohíbe capas huérfanas | `EUDR_*` (Editor Vectorial QC) | 2026-08-24 | Aceptado y verificado en vivo |
| [019](ADR-019-editor-vectorial-validacion-padron-y-creacion-socio.md) | Editor Vectorial valida contra el Padrón real, permite crear socio nuevo | `PADRON_SOCIOS`/`PADRON_PARCELAS` (Editor Vectorial) | 2026-08-24 | Aceptado y verificado en vivo |
| [020](ADR-020-validacion-organizacion-socio-parcela.md) | Un registro EUDR puede referenciar socio/parcela de OTRA organización | `EUDR_MONITOREO` + `PADRON_SOCIOS`/`PARCELAS` | 2026-08-24 | Aceptado y verificado en vivo |
| [021](ADR-021-vinculo-real-editor-vectorial-y-creacion-parcela.md) | Editor Vectorial genera vínculo real de cobertura + crear parcela nueva | `EUDR_USO_SUELO`/`PADRON_PARCELAS` | 2026-08-25 | Aceptado y verificado en vivo |
| [022](ADR-022-instalaciones-en-editor-vectorial-qc.md) | `EUDR_INSTALACIONES` como tabla destino en el Editor Vectorial | `EUDR_INSTALACIONES` (Editor Vectorial QC) | *(sin campo Fecha/Estado en el archivo)* | Aceptado (implícito — documenta un fix ya hecho) |
| [023](ADR-023-backend-inspecciones-ya-no-comparte-base.md) | `backend-inspecciones` ya no comparte base de datos en vivo | `PADRON_SOCIOS`/`PADRON_PARCELAS` (corrección de premisa) | 2026-08-25 | Aceptado — corrección de premisa |
| [024](ADR-024-normaliza-tipo-hbp-otros-cultivo.md) | Normaliza `PADRON_PARCELAS.hbp`/`otros_cultivo` a `numeric` | `PADRON_PARCELAS` | 2026-08-25 | Aceptado y corregido el mismo día |
| [025](ADR-025-investigacion-rls-padron.md) | Investigación: por qué RLS está habilitado en `PADRON_SOCIOS`/`PADRON_PARCELAS` | `PADRON_SOCIOS`/`PADRON_PARCELAS` | 2026-08-25 | Investigación de solo lectura — resuelta con evidencia |
| [026](ADR-026-pk-surrogate-multiorganizacion.md) | PK surrogate UUID + unicidad de códigos por organización | `PADRON_SOCIOS`/`PADRON_PARCELAS` | 2026-08-25 | Aceptado — migración escrita, código corregido, tests |
| [027](ADR-027-certificaciones-normalizadas.md) | Normalización de certificaciones — 5 tablas nuevas | `SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO`/etc. | 2026-08-25 | Aceptado — migración escrita, código de aplicación |
| [028](ADR-028-multi-producto-cafe-cacao.md) | Multi-producto (café/cacao) — `PRODUCTOS`/`ORGANIZACION_PRODUCTOS` | `PRODUCTOS`/`PADRON_PARCELAS`/`EUDR_USO_SUELO` | 2026-08-26 | Aceptado — migración escrita, código de aplicación |
| [029](ADR-029-fix-guid-qfield-id-parcela-fija.md) | Resolver el GUID de QField vía `LEFT JOIN LATERAL` con desempate determinístico | `vw_monitoreo_*`/`EUDR_MONITOREO` | 2026-08-26 | Implementado y aplicado |
| [030](ADR-030-convencion-codigo-organizaciones.md) | Convención de código `TIPO-SLUG` para `ORGANIZACIONES."ID"` | `ORGANIZACIONES` | 2026-08-27 | Aceptado |
| [031](ADR-031-lecturas-padron-security-definer.md) | Cierre de lectura sin aislamiento de `PADRON_SOCIOS`/`PADRON_PARCELAS` vía `anon` | `PADRON_SOCIOS`/`PADRON_PARCELAS` | 2026-09-01 | Aceptado y aplicado en producción |
| [032](ADR-032-limpieza-drift-rls-espanol.md) | Limpieza de 8 políticas RLS huérfanas en español | `INSPECCIONES` + 6 `CAP_*` | 2026-09-03 | **Implementado** (`fd8b7c3`) |
| [033](ADR-033-fase-c-paso2-rls-real-inspecciones-cap.md) | Aislamiento real por organización, cierre completo de `anon` (Fase C Paso 2) | `INSPECCIONES` + 6 `CAP_*` | 2026-09-03 | **Implementado** (`27f0504`) |
| [034](ADR-034-limpieza-drift-rls-eudr-padron.md) | Limpieza de drift RLS + políticas oficiales faltantes | `EUDR_*` (5 tablas) + `PADRON_SOCIOS`/`PARCELAS` | 2026-09-03 | **Implementado** (`f8ce9b4`) |
| [035](ADR-035-piloto-camino-1-rls-sesion-qc-atributos-geometria.md) | Piloto "Camino 1": atributos/geometría de QC migran a sesión real | `EUDR_*` (`lib/actions/qcActions.js`) | 2026-09-05 | **Implementado** (`88d9f1c`) |
| [036](ADR-036-migracion-parcial-camino-1-sociosactions.md) | Piloto "Camino 1", Fase A.1: 4 funciones de `sociosActions.js` a sesión real | `PADRON_SOCIOS`/`PADRON_PARCELAS` | 2026-09-05 | Implementado (`f1279d3`) |
| [037](ADR-037-fase-a2-rls-certificaciones-socios.md) | Piloto "Camino 1", Fase A.2: certificaciones de socio a sesión real | `SOCIO_CERTIFICACIONES`/`CERTIFICACIONES_CATALOGO` | 2026-09-04 | Implementado (`77f98a1`) |
| [038](ADR-038-fase-a3-rls-sesion-gis-ingestor.md) | Piloto "Camino 1", Fase A.3: las 3 ramas EUDR del Ingestor Espacial a sesión real | `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` (`lib/actions/gisActions.js`) | 2026-09-04 | Implementado |
| [039](ADR-039-fase-d-qc-aprobar-rechazar-roles-rls.md) | Fase D: aprobar/rechazar en la Consola QC a sesión real, con control de rol vía trigger en Postgres | `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` (`lib/actions/qcActions.js`) | 2026-09-04 | Implementado |

## Notas

- No existe `ADR-004` en el repositorio (numeración no consecutiva —
  confirmado por listado real de archivos, no un archivo faltante por
  error de este índice).
- El drift de RLS más amplio en las 5 tablas EUDR/PADRON quedó cerrado
  por `ADR-034`; el endurecimiento real de `anon` en
  `INSPECCIONES`/`CAP_*` por `ADR-033`; el mismo patrón en `PADRON_*`
  por `ADR-031`/`ADR-034`. Para el estado RLS más reciente de una tabla
  específica, el ADR con el número más alto que la mencione es
  normalmente la fuente de verdad — los ADRs más viejos sobre RLS
  (`007`, `025`) documentan decisiones que ADRs posteriores revisaron.
