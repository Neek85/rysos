# ESTADO DEL PROYECTO RYZOS
*Última actualización: 1 de septiembre, 2026*

> Este documento es la "bitácora" del proyecto. Aquí se anota qué se hizo, qué falta y qué decisiones están pendientes. No contiene reglas técnicas fijas (esas viven en el prompt orquestador RYZOS V3.1) — esto es solo el día a día.

---

## ✅ YA DEFINIDO Y CERRADO (no requiere más decisiones)

- Arquitectura general del sistema: Core + Verticals, multi-tenant por organización.
- Seguridad del hash público en `/trace/[lot_hash]`: HMAC-SHA256 con salt por organización.
- Autenticación del socio: DNI + PIN (no DNI solo).
- Activación de socios: centralizada desde el dashboard web (Opción B), en lote.
- Notificaciones push: **fuera de alcance por ahora**, se evalúan en una fase futura.
- App de cuyes (Granja Valencia): será un tenant más dentro de RYZOS, usando el módulo `PECUARIO_*` ya definido — no un producto separado.
- Tres apps móviles confirmadas: App de Campo (técnico), App del Socio (productor), App Granja Valencia (pecuario).
- Reglas de acopio offline: sin liquidación inmediata, por lo tanto sin manejo de dinero offline; solo evitar duplicados de recepción con `receipt_local_id`.
- El código web actual (Next.js, sin login, sin TypeScript) **no se migra**. TypeScript, Zod y autenticación (DNI+PIN) aplican solo a lo nuevo: las tres apps móviles. `CLAUDE.md` sigue siendo la fuente de verdad técnica de lo que ya existe.

---

## 🔲 PENDIENTE DE DECISIÓN (necesita tu validación antes de construirse)

*(vacío por ahora — aquí se agregan las próximas preguntas de negocio que surjan)*

---

## 🛠️ EN CONSTRUCCIÓN / PRÓXIMOS PASOS TÉCNICOS

- Configurar el "lugar fijo" (Proyecto de Claude) para dejar de copiar y pegar el prompt orquestador en cada conversación.
- Definir la primera tarea real para probar el flujo completo (idealmente algo pequeño y visible, para validar que el proceso funciona antes de tareas grandes).
- **(2026-08-21) Consola QC (`/dashboard/qc`):** reordenado el layout a 3 columnas (lista | mapa | panel de edición fijo, sin scroll de página). Se encontró y arregló un bug real que dejaba **inoperables** las 4 acciones de escritura de la consola (Aprobar/Rechazar/Guardar Atributos/Guardar Geometría) desde que se construyó — las políticas RLS de `EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES` son solo `TO authenticated`, pero el frontend nunca autentica (usa la llave `anon`), así que todo `UPDATE` afectaba 0 filas siempre. Fix: Server Actions + Service Role Key (`lib/actions/qcActions.js`), mismo patrón que el Padrón — ver `docs/adr/ADR-003-consola-qc-server-actions-escritura.md`. Confirmado en vivo contra la base real (escritura + limpieza de un campo de prueba).
- **Pendiente, fuera de este repo:** aplicar manualmente `supabase/migrations/20260820_fn_validar_topologia_eudr.sql` en Supabase Studio SQL Editor — la función `fn_validar_topologia_eudr` existe en el código desde la tarea anterior pero nunca se aplicó a la instancia real (confirmado reproduciendo el error "Could not find the function..." en vivo). Hasta que se aplique, "Ejecutar Test Espacial" seguirá fallando.
- **(2026-08-21) Consola QC — capa de contexto de parcelas vecinas (Fase 3):** nueva capa informativa en el mapa (Monitoreos EUDR APROBADOS dentro de un radio configurable, 500m por defecto) con toggle on/off, ver `docs/adr/ADR-006-capa-contexto-parcelas-vecinas.md`. **Pendiente, fuera de este repo:** aplicar `supabase/migrations/20260821_221221_fn_parcelas_vecinas_eudr.sql` — hasta entonces la capa queda visible pero sin datos (fallo silencioso ya verificado como no disruptivo). **Tarea diferida a propósito (pedido explícito del prompt, no un olvido):** no existe pantalla de administración para que un admin configure el radio por organización (`ORGANIZACIONES.Config.gis.radio_contexto_vecinos_m`) — hoy solo se edita a mano en la base, si hiciera falta. Si se necesita esa UI, es una tarea nueva, no se debe asumir que ya existe.
- **(2026-08-21 a 23) Refuerzo de la Consola QC — resumen completo en un documento aparte:** bugs reales corregidos (colisión de herramientas de dibujo, popup con nombre técnico expuesto, solapamiento no auditable), mejoras nuevas (panel de info en vivo, capa de parcelas vecinas, exclusión de contención propia en el solapamiento), el incidente de datos de prueba huérfanos (`ORG-COOP-NORTE`) y las protecciones agregadas, y el fix del mensaje de error de la sincronización de Google Drive — ver **[docs/bitacora/2026-08-21_hardening-consola-qc.md](bitacora/2026-08-21_hardening-consola-qc.md)** (escrito para alguien que no programa, con enlaces a cada ADR técnico y commit).
- **(2026-08-25) Certificaciones normalizadas — 5 tablas nuevas:**
  `CERTIFICACIONES_CATALOGO`, `AGENCIAS_CERTIFICADORAS`,
  `ORGANIZACION_CERTIFICACIONES`, `SOCIO_CERTIFICACIONES`,
  `PARCELA_CERTIFICACIONES` reemplazan los 8 flags planos que vivían
  como columnas sueltas de `PADRON_SOCIOS` (esas columnas viejas **no**
  se borraron — quedan congeladas como respaldo, para no tener que
  recrear las 3 vistas que aún dependen de ellas). RLS/GRANTs replican el
  patrón ya usado en `PADRON_SOCIOS`/`PADRON_PARCELAS`. Ver
  [ADR-027](adr/ADR-027-certificaciones-normalizadas.md) y
  `specs/padron_certificaciones_normalizado.md` — commits `470de58`
  (migración + código) y `73304cb` (2 gaps de cobertura de tests
  cerrados tras la verificación post-migración: aislamiento multi-tenant
  en las 3 tablas org-scoped y el chequeo automatizado del backfill de
  `estado_organico`).
- **(2026-08-26) Multi-producto café/cacao:** 2 tablas nuevas
  (`PRODUCTOS`, catálogo con 2 filas semilla CAFE/CACAO;
  `ORGANIZACION_PRODUCTOS`, membresía N-a-N) y `id_producto_predominante`
  agregado en 2 lugares con roles distintos — `PADRON_PARCELAS` (dato
  maestro editable, con backfill obligatorio a CAFE) y
  `EUDR_USO_SUELO` (una foto por evento de monitoreo, poblada por un
  trigger `BEFORE INSERT` que nunca bloquea el `INSERT` aunque la cadena
  de resolución falle). `ParcelaFormModal.jsx` gana un `<select>` nuevo
  para elegir el producto de la parcela, y `lib/eudrDdsExporter.js`
  agrega `producto_codigo`/`producto_nombre` al paquete de trazabilidad
  exportado. Ver [ADR-028](adr/ADR-028-multi-producto-cafe-cacao.md) y
  `specs/multi_producto_cafe_cacao.md` §8 — migración
  `20260826120000_multi_producto_cafe_cacao.sql`, commit `4568bee`
  (implementación); `520436d`/`0064091` cerraron el paso 4 arreglando
  tests Live que no creaban la fila `ORGANIZACIONES` requerida por una FK
  real antes de insertar (`23503`).
- **(2026-08-26) Bug de `postgrest-py` en tests de GIS, causa raíz real
  encontrada:** el `22P02` (`invalid input syntax for type bigint:
  "None"`) que bloqueaba 2 tests de `TestGisSanitizationLive` no era un
  bug de la librería ni del trigger de sanitización (que funcionaba
  bien) — era el `DELETE` de limpieza de cada test, que filtraba
  `.eq("fid", row["fid"])` con `fid` en `NULL` (columna sin `DEFAULT`,
  siempre `NULL` en un `INSERT` manual de test). `postgrest-py`
  serializa ese filtro literal a `fid=eq.None`, que Postgres rechaza.
  Fix: filtrar por `id` (la PK real) en vez de `fid`. Commit `1a5bc19`
  (causa raíz confirmada capturando la request HTTP real, no una
  hipótesis) — ver `AI_STATE.md` para el detalle completo.
- **(2026-08-26) Fix del GUID de QField mal etiquetado como
  `"ID_Parcela_Fija"`:** `vw_monitoreo_poligonos`/`vw_monitoreo_puntos`
  exponían, para filas de `EUDR_USO_SUELO`/`EUDR_INSTALACIONES`, el GUID
  crudo que QField genera para el `EUDR_MONITOREO` padre en vez del
  código real de parcela — invisible en el Dashboard (que ya tenía un
  guard defensivo) pero no en `lib/eudrDdsExporter.js`: producía "plots
  fantasma" (6 en vez de 3 para las filas reales de `ORG-TEST-E2E`).
  Fix: `LEFT JOIN LATERAL` contra `EUDR_MONITOREO` vía
  `qfield_relation_id`, con desempate determinístico de 2 niveles
  (`fecha_monitoreo DESC NULLS LAST, creado_en DESC`) ante un duplicado
  real confirmado — mismo criterio aplicado también al trigger del paso
  4 y (agregado el mismo día, confirmado explícitamente por el usuario)
  al `LATERAL` que resuelve `productor` en `vw_monitoreo_web`. Verificado
  contra la instancia real ya migrada: los "plots fantasma" bajaron de 6
  a 3 tal como se predijo, y se confirmó en vivo un `UNIQUE` real en
  `EUDR_MONITOREO` (`"ID_Organizacion", "ID_Parcela_Fija",
  fecha_monitoreo`) no documentado en ninguna migración — ver
  `docs/schema_live.md`. Ver [ADR-029](adr/ADR-029-fix-guid-qfield-id-parcela-fija.md)
  (su "Estado" quedó desactualizado — dice "sin implementar" y
  "`vw_monitoreo_web` no se toca", ambos ya no ciertos; pendiente de
  amendar) y `specs/fix_id_parcela_fija_guid_qfield.md` — migración
  `20260826140000_fix_id_parcela_fija_guid_qfield.sql`, commits
  `0d07138` (implementación), `e772844` (doc del `UNIQUE`), `ef60c35`
  (fix de un bug del propio test de verificación, no de la vista).

---

- **(2026-08-27) Primera organización real del sistema creada:**
  `COOP-AROMAS-VALLE` (COOPERATIVA AGRARIA AROMAS DEL VALLE), aplicada
  directamente en Supabase (alta de dato, no de esquema — no fue una
  migración) y vinculada a Café en `ORGANIZACION_PRODUCTOS`. El
  procedimiento quedó documentado como runbook repetible en
  `specs/alta_organizacion_real.md`, con la convención de código
  (`TIPO-SLUG`) fijada en
  [ADR-030](adr/ADR-030-convencion-codigo-organizaciones.md).

- **(2026-09-01) Incidente de seguridad real cerrado — lectura de
  `PADRON_SOCIOS`/`PADRON_PARCELAS` sin aislamiento vía la llave `anon`
  pública:** una política RLS agregada el 2026-08-18 para el
  autocompletado de Inspecciones (`USING ("ID_Organizacion" IS NOT
  NULL)`) resultó ser, en la práctica, sin ninguna restricción real —
  cualquiera con la llave `anon` (pública por diseño, embebida en el
  sitio) podía leer el padrón completo de **cualquier** organización sin
  sesión. Confirmado en vivo antes de corregir: 618 socios reales de
  `COOP-AROMAS-VALLE` alcanzables (DNI, nombre, celular incluidos), no
  una hipótesis. Cerrado bloqueando esa lectura directa (`USING
  (false)`) y reemplazando los 6 caminos reales del código que dependían
  de ella (listado de socios, parcelas por socio, autocompletado de
  Inspecciones y de la Consola QC, importador masivo, enriquecimiento de
  parcela en QC) por 10 funciones `SECURITY DEFINER` parametrizadas por
  organización, con `REVOKE`/`GRANT EXECUTE` explícito a `service_role`
  únicamente desde el día uno. Verificado end-to-end contra producción
  (686/686 tests, 6/6 tests de aislamiento cruzado real, verificación
  manual en `/dashboard/socios`). Ver
  [ADR-031](adr/ADR-031-lecturas-padron-security-definer.md). **Fase 2
  del mismo incidente, ya dimensionada pero sin aplicar:**
  `INSPECCIONES`/`CAP_*` tienen el mismo defecto de política (más
  severo — incluye escritura y borrado), con migraciones de contención
  preparadas y esperando revisión antes de aplicarse — el contenido real
  expuesto ahí hoy es mínimo (2 filas sin datos sensibles), a diferencia
  del caso de `PADRON_SOCIOS`.

- **(2026-09-01) Fase 1b del mismo incidente — exportación CSV del
  padrón restaurada:** el lockdown de arriba dejó `exportSociosCsv`/
  `exportParcelasCsv` (`/dashboard/socios`) devolviendo un CSV vacío —
  esas 2 funciones no estaban entre los 6 caminos reemplazados en la
  primera ronda. Cerrado con el mismo patrón (`fn_exportar_padron_socios`/
  `fn_exportar_padron_parcelas`, `SECURITY DEFINER` + `REVOKE`/`GRANT
  EXECUTE` a `service_role` únicamente), sin parámetros de filtro
  (confirmado que ninguna de las 2 funciones originales respetaba
  ningún filtro de la UI — siempre exportaban el padrón activo completo).
  Verificado end-to-end: 12/12 tests de aislamiento cruzado real, 692/692
  de la suite completa, y verificación manual real — los 2 CSV
  descargados desde `/dashboard/socios` confirmados con 618 socios / 821
  parcelas, ambos con `ID_Organizacion = COOP-AROMAS-VALLE` únicamente,
  0 IDs duplicados. Ver [ADR-031](adr/ADR-031-lecturas-padron-security-definer.md).

## 📌 PRÓXIMA VEZ QUE ABRAS UNA CONVERSACIÓN

Si vienes de una pausa, simplemente di: **"Lee el estado del proyecto y sigamos donde quedamos."** No necesitas repetir el contexto — este documento lo tiene.