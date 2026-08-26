# Roadmap — Padrón de Socios/Parcelas: certificaciones normalizadas, unicidad multi-organización, multi-producto

- **Estado:** En ejecución — ver "## Estado" abajo para el detalle paso a paso.
- **Fecha:** 2026-08-25

Diseño consolidado de una sesión de arquitectura (25 de agosto de 2026),
verificado contra la raíz real del proyecto vía Claude Code CLI. Este
documento es la fuente de verdad del plan completo — las partes ya
ejecutadas tienen sus propios specs/ADRs (ver Referencias al final); las
partes pendientes solo existen acá hasta que se conviertan en su propio
spec al ejecutarse.

## Estado

- Paso 1 (migración base + ADR-023) — completado y aplicado en producción (6ff1daf).
- Paso 1b (normaliza tipo hbp/otros_cultivo + ADR-024) — completado y aplicado en producción, en dos pasadas (c1b6401 fallido → 33941a1 corregido). Dejó pendiente un hallazgo de seguridad sobre vw_parcelas_web (GRANTs de escritura completos a anon/authenticated sin uso en el código) — sin resolver, hilo aparte.
- Paso 2, auditoría (641e028) — completada. Reveló que vw_monitoreo_web y view_eudr_dashboard_aprobados hacen JOIN contra PADRON_PARCELAS/PADRON_SOCIOS sin ID_Organizacion — deben corregirse en la MISMA migración que cambia la PK (pendiente). También reveló que lib/sociosSearch.js::fetchSocios no filtraba por organización y que la cascada deactivateSocio hacia PADRON_PARCELAS es el sitio de código más peligroso tras el cambio de PK (pendiente, va empaquetado con la migración real).
- Parte A, hotfix fetchSocios (9779717) — completado. Se encontró un mecanismo YA EXISTENTE (probe de organización en fetchPendingRecords/fetchRecords) y se replicó en fetchSocios y fetchParcelasBySocio, sin UI nueva. Verificado en vivo: /dashboard/socios pasó de mostrar 4 socios mezclando 2 organizaciones a mostrar solo los 2 correctos. Test nuevo tests/test_sociossearch_multitenant.mjs.
- Parte B, investigación RLS (de3d283, ADR-025) — completada. RLS en PADRON_SOCIOS/PADRON_PARCELAS SÍ está versionado (3 migraciones). Hallazgo clave: la política anon activa (USING (ID_Organizacion IS NOT NULL), agregada 2026-08-18) NO aísla por organización, solo exige que la fila tenga alguna asignada — todo el aislamiento multi-tenant real sigue dependiendo del filtrado en código de aplicación, no de RLS.
- Paso 3, migración real de PK (ADR-026) — completado (código y migración listos, commit pendiente de push a staging). Empaqueta las 4 cosas que la auditoría del paso 2 marcó como inseparables: id UUID + UNIQUE(ID_Organizacion, ID_Socio/ID_Parcela_Fija), fix de JOIN en vw_monitoreo_web/view_eudr_dashboard_aprobados (CREATE OR REPLACE VIEW, no hizo falta DROP VIEW ni reaplicar GRANTs — a diferencia de vw_parcelas_web en ADR-024, la constraint de PK no fuerza a soltar vistas dependientes), fix de la cascada deactivateSocio (el sitio más peligroso) y del resto de sitios de código de la auditoría (assertMatchesExistingOrg/assertParcelaMatchesOrg/assertSocioExists en sociosActions.js, assertSocioActivoOSinValor/assertParcelaActivaOSinValor en gisActions.js, checkSocioParcelaOrganizacion en eudrQcActions.js). Tests nuevos: tests/test_pk_surrogate_multiorganizacion.py (13 estáticos + 6 funcionales contra Supabase Live, auto-skip hasta aplicar la migración) y tests/test_pk_surrogate_code_sites.mjs (8 estructurales). Pendiente: aplicación manual en Supabase Studio.
- Pendiente: certificaciones normalizadas (3 tablas) y multi-producto/vertical — no iniciados. El hallazgo de seguridad sobre vw_parcelas_web (GRANTs de escritura completos a anon/authenticated sin uso en el código, ver Paso 1b) sigue sin resolver, hilo aparte.

## Decisión de premisas

backend-inspecciones ya no comparte base de datos con este proyecto
(arquitectura anterior más pequeña del mismo proyecto) — la restricción
de "padrón compartido, no tocar unilateralmente" documentada en
CLAUDE.md/ADR-002/ADR-007 ya no aplica. Esto no implica que el código de
esa base esté descartado — hay componentes (ej. un módulo de exportación
PDF casi terminado) que podrían rescatarse más adelante, decisión aparte.
PADRON_SOCIOS/PADRON_PARCELAS no tenían CREATE TABLE versionado en este
repo — nunca fueron adoptadas formalmente (resuelto en el paso 1).

## 1. Certificaciones — 3 niveles, sin datos duplicados

- CERTIFICACIONES_CATALOGO (codigo, nombre, es_certificacion_externa boolean, activo): 8 programas externos actuales (NOP USDA, UE 2018/848, COR Canadá, DS 044-2006-AG, LPO México, Rainforest Alliance, Comercio Justo, Fair Trade USA) con es_certificacion_externa=true, más normas_internas_17 (pregunta Sí/No de cumplimiento de reglamentos internos, usada en inspecciones) con es_certificacion_externa=false — sin agencia externa por diseño.
- AGENCIAS_CERTIFICADORAS (catálogo nuevo): una organización puede tener 2+ agencias certificando el mismo programa.
- ORGANIZACION_CERTIFICACIONES (id_organizacion, id_certificacion, fecha_obtencion): una sola fecha por organización+programa.
- SOCIO_CERTIFICACIONES (id_socio, id_certificacion, id_agencia_certificadora, UNIQUE(id_socio, id_certificacion)): la agencia se asigna a nivel socio, nunca a nivel parcela — un socio no puede tener parcelas certificadas por agencias distintas del mismo programa, garantizado estructuralmente. id_agencia_certificadora nullable para certificaciones internas.
- PARCELA_CERTIFICACIONES (id_parcela, id_certificacion, estado: Certificado/En Transición/No Certificado): estado granular por parcela, sin agencia propia (se hereda del socio dueño), solo estado actual sin historial.
- Retira las 8 columnas planas de PADRON_SOCIOS + cert_org_estatus/certificaciones (backfill primero, luego DROP).
- UI: selector real contra CERTIFICACIONES_CATALOGO, nunca checkbox fijo.

## 2. Unicidad multi-organización

- Hallazgo confirmado en vivo (INSERT real, error 23505): la unicidad de ID_Socio/ID_Parcela_Fija es la Primary Key misma, global, no un índice aparte.
- Decisión: opción B — id UUID propio como PK nueva; (ID_Organizacion, ID_Socio) / (ID_Organizacion, ID_Parcela_Fija) pasan a ser UNIQUE.
- Sin FKs reales apuntando a la PK actual (confirmado dos veces, incluida auditoría con pg_constraint).
- Ver specs/multi_organizacion_codigos_unicos.md y plans/multi_organizacion_codigos_unicos_ejecucion.md para la auditoría detallada de código y esquema afectado.

## 3. Vertical + Producto (café/cacao ahora, pecuario/cuyes después)

- PRODUCTOS (codigo, nombre, vertical: AGRICOLA/PECUARIO — columna fija, no tabla propia).
- ORGANIZACION_PRODUCTOS (id_organizacion, id_producto) — reemplaza la intención original de ORGANIZACIONES.Config para membresía de productos, sin tocar Config en sí (Config.gis.radio_contexto_vecinos_m sigue leyéndose activamente en lib/actions/qcActions.js).
- EUDR_USO_SUELO.id_producto_predominante (FK a PRODUCTOS, nullable) — campo nuevo, predominancia no exclusividad. El mix real de cultivos se deriva sumando área de subdivisiones agrupadas por este campo, mismo criterio que ADR-011.

## 4. Exportación DDS

- Selectores de producto + certificación antes de generar el paquete.
- Los Features no cambian de forma — uno por parcela, perímetro completo + subdivisiones.
- Agregar Excel como tercer formato de descarga junto a JSON y GeoJSON (EXPORT_FORMATS en lib/eudrDdsExporter.js).

## Alcance transversal — carga masiva CSV

lib/validations/socios.js::CERT_FLAG_FIELDS es la fuente única hoy, usada
en 7 archivos — todos migran juntos cuando certificaciones pase a las 3
tablas normalizadas. lib/padronCsv.js también necesita revisión
estructural por el cambio de PK.

## Referencias

- ADR-023, ADR-024, ADR-025
- supabase/migrations/20260825183000_baseline_padron_socios_parcelas.sql
- supabase/migrations/20260825142426_normaliza_tipo_hbp_otros_cultivo.sql
- specs/multi_organizacion_codigos_unicos.md
- plans/multi_organizacion_codigos_unicos_ejecucion.md
