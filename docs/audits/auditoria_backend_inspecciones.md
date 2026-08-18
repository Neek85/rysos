# Auditoría Técnica: Neek85/backend-inspecciones

**Fecha:** 2026-08-17
**Repositorio auditado:** `https://github.com/Neek85/backend-inspecciones.git` (clonado temporalmente en `.temp/backend-inspecciones`, eliminado al cerrar esta auditoría)
**Commits:** `a94ed75` "Migracio appsheet a vscode" (HEAD) — historial completo: `47e6e64e` → `e1378b8` → `2400491` → `7013ad2` → `61c47c2` → `004cf77` → `a94ed75`

## ⚠️ Hallazgo crítico previo a cualquier otra sección

**`backend-inspecciones` y `rysos` apuntan a la misma instancia Supabase en vivo.** El script `admin-fed/package.json:update-db` y `supabase/.temp/project-ref` referencian el project ref `jhtocgxlozfuzullrtol` — el **mismo** que `NEXT_PUBLIC_SUPABASE_URL` en `rysos/.env.local`. No son dos bases de datos independientes con esquemas parecidos: son **el mismo Postgres**, y las tablas `ORGANIZACIONES`, `PADRON_SOCIOS` y `PADRON_PARCELAS` (columnas `ID_Parcela_Fija`, `parcela_codigo`, `parcela_nombre`, `totalh`, `ID_Organizacion`, `geom`) que `rysos` ya usa vía `LEFT JOIN` en `vw_monitoreo_web` (ver `supabase/migrations/20260817_refine_vw_monitoreo_web.sql`) son las mismas filas que puebla el formulario de Inspecciones de este repo. Cualquier cambio de schema que se aplique desde uno de los dos proyectos (agregar/quitar columnas, cambiar tipos, políticas RLS) afecta directamente al otro. Esto **no es una recomendación de portabilidad — ya están acopladas en producción.**

---

## 1. Resumen Ejecutivo

`backend-inspecciones` es el frontend de un **sistema de inspecciones agrícolas de cumplimiento/certificación** (llamado internamente "Panel FED" — Bienestar, Manejo de Cultivo, Conservación, Riesgos, Gestión) para una organización cafetalera. El commit inicial ("Migracio appsheet a vscode") y una constante `APPSHEET_APP_ID` embebida en la función de generación de PDF confirman que el sistema **se originó en Google AppSheet** (una plataforma no-code) y está siendo portado manualmente a un stack de código propio — explica la nomenclatura de columnas (`my_element_273`, `lb_norte`, `sf_datos_socio`, tablas `CAP_*`/`CAT_*`) típica de exportaciones AppSheet.

**Nivel de madurez: parcial / en transición.** Un solo módulo está completamente funcional de punta a punta — el formulario de Inspección (creación, edición, listado con búsqueda y paginación, guardado multi-tabla) — con validación robusta (Zod + react-hook-form) y una función de generación de PDF en producción (Edge Function con envío por correo). Cuatro módulos planeados (`Socios`, `Parcelas`, `Organizaciones`, `No Conformidades`) son pantallas "Coming Soon" sin implementar, pese a que sus tablas en la base de datos ya existen y tienen datos reales. El dashboard de inicio (`InicioPage`) tiene sus 4 tarjetas de estadísticas hardcodeadas en `"—"`, nunca conectadas a datos reales. Hay logging de depuración extenso (`console.group`/`console.log` con `JSON.stringify` de datos de socios, incluyendo DNI) dejado en el código de producción — una fuga de PII a la consola del navegador que debería limpiarse antes de cualquier despliegue real.

No existen migraciones SQL versionadas en el repo (`supabase/migrations/` no existe) — el único rastro del schema es un export CSV (`admin-fed/src/esquema_bd.csv`) generado manualmente contra la base viva, y el propio código fuente (Zod schema, payloads de INSERT/UPDATE). El schema real se gestiona fuera del repositorio (probablemente desde el SQL Editor de Supabase Studio, o remanente de la migración AppSheet), el mismo patrón de riesgo que `rysos` ya tiene documentado en su propia memoria de proyecto (drift entre migraciones commiteadas y el estado real de producción).

## 2. Stack Tecnológico

| Componente | `backend-inspecciones` (`admin-fed/`) | Comparación con `rysos` |
|---|---|---|
| Framework | Vite + React 19 | Next.js 14 (App Router) + React 18 |
| Lenguaje | **TypeScript** (`tsc -b && vite build`) | JavaScript puro (`.jsx`, sin `tsconfig.json`) |
| Enrutamiento | `react-router-dom` v7 (rutas cliente) | App Router de Next.js (rutas por carpeta) |
| Validación de formularios | `react-hook-form` + `zod` (resolver) | Sin librería — validación manual/inexistente |
| Estilos | TailwindCSS (mezcla de v3 en `admin-fed/package.json` y v4 en el `package.json` raíz — inconsistencia, ver §5) | TailwindCSS v3, consistente |
| Notificaciones UI | `sonner` (toasts) | Estado local + `<p>` con `setTimeout` manual (patrón repetido en `MapDashboard.jsx`, `QcConsolePage`, etc.) |
| Iconos | `lucide-react` | Emoji Unicode inline |
| Cliente de datos | `@supabase/supabase-js` v2, con **tipos generados** (`npx supabase gen types typescript`) | `@supabase/supabase-js` v2, sin generación de tipos (no aplica, proyecto JS) |
| Backend/lógica servidor | 1 Supabase Edge Function (Deno) — `generar-pdf-fed`, generación de PDF + envío de correo, disparada por Database Webhook | Sin Edge Functions; lógica de servidor vive en Server Components/Route Handlers de Next.js y scripts Python standalone |
| Generación de PDF | `pdfmake` (JS, corre en Deno) con layout dirigido por metadatos (tabla `METADATOS_CAMPOS`) | `ReportLab` (Python, `scripts/generate_dossier_pdf.py`), estructura hardcodeada en el script |
| Envío de correo | API de Resend, destinatario **hardcodeado** (`dneyser5@gmail.com`) — ver §5 | No implementado en `rysos` actualmente |
| Mapas/GIS | **Ninguno.** El GPS se captura como texto libre (`GPS_Punto_Control`, ej. `"-6.7654, -79.8397"`); `PADRON_PARCELAS.geom`/`PARCELAS.poligono_gps` existen en BD pero no se visualizan en ninguna pantalla | Leaflet + `react-leaflet`, WebGIS completo (`MapDashboard.jsx`, `QcConsoleMap.jsx`, `PublicLotMap.jsx`) |
| package.json raíz | Contiene solo `devDependencies`/`dependencies` sueltas (Tailwind v4, react-hook-form, zod, sonner) sin `scripts` — parece un remanente de una reestructuración incompleta; la app real vive enteramente en `admin-fed/` | N/A |

## 3. Inventario de Pantallas y Formularios UI

Definidas en `admin-fed/src/App.tsx`:

| Ruta | Componente | Estado |
|---|---|---|
| `/` | `InicioPage` | ⚠️ Implementado pero con datos falsos — 4 tarjetas de stats (`Inspecciones`, `Socios Activos`, `No Conformidades`, `En Proceso`) todas fijas en `"—"`, nunca conectadas a Supabase |
| `/inspecciones` | `InspeccionesPage` | ✅ Funcional — tabla paginada (15/página), búsqueda por `Inspector`/`Estado`/`Tipo_Inspeccion`/`ID_Socio` vía `.or(...).ilike`, badges de estado con color |
| `/inspecciones/nueva` | `InspeccionForm` | ✅ Funcional — formulario multi-tab (ver abajo) |
| `/inspecciones/editar/:id` | `InspeccionForm` (mismo componente, modo edición) | ✅ Funcional |
| `/socios` | `ComingSoon` | ❌ No implementado (placeholder "🚧 Módulo en construcción") |
| `/parcelas` | `ComingSoon` | ❌ No implementado |
| `/organizaciones` | `ComingSoon` | ❌ No implementado |
| `/no-conformidades` | `ComingSoon` | ❌ No implementado |

**`InspeccionForm` — 8 pestañas** (`components/features/inspecciones/tabs/`), cada una mapeada 1:1 a una tabla `CAP_*`:

1. **Datos Generales** (`TabGeneral`) → `INSPECCIONES` — fecha de visita, inspector, estado, tipo, resultado global, punto GPS (texto libre), fecha de cierre, resumen de incumplimientos.
2. **Datos del Socio** (`TabSocio`) → `CAP_DATOS_SOCIO` — ~45 campos: identidad (DNI, nombre, género, fecha nacimiento), ubicación, estado civil/cónyuge, educación, contacto, acceso a crédito/banca, desglose porcentual de fuentes de ingreso, composición familiar, salud, transporte.
3. **Manejo del Cultivo** (`TabMic`) → `CAP_MIC` — semilla, prácticas orgánicas certificadas, infraestructura de beneficio húmedo (tanque, pulpero), manejo de aguas mieles, plagas/enfermedades, fertilización, diversificación.
4. **Conservación** (`TabConservacion`) → `CAP_CONSERVACION` — extracción de agua, prohibición de tala de bosque nativo (**mismo concepto que la fecha de corte EUDR de `rysos`**, aunque sin fecha explícita), fauna/vida silvestre, protección de fuentes de agua.
5. **Bienestar** (`TabBienestar`) → `CAP_BIENESTAR` — condiciones laborales, salario mínimo, jornada, trabajo infantil, discriminación, EPP, seguridad, quejas/reclamos.
6. **Riesgos** (`TabRiesgos`) → `CAP_RIESGOS` — insumos no permitidos, tala, contaminación, mezcla de producto, secado/almacenamiento, levantamiento de no conformidades.
7. **Gestión** (`TabGestion`) → `CAP_GESTION` — cronograma de finca, asistencia técnica, prima de comercio justo, capacitaciones, inversión, gobernanza (directivos, procedimiento de reclamo).
8. **Cierre** (`TabCierre`) → resumen de solo lectura + campos de cierre formal (repetidos de `TabGeneral`) + banner de advertencia antes de marcar como "Cerrada".

Cada pestaña de puntaje (MIC, Conservación, Bienestar, Riesgos, Gestión) tiene contadores `men`/`may`/`obl` (menor/mayor/obligatorio) y `total_puntaje` — un **sistema de scoring de cumplimiento por sección**, evaluado presumiblemente contra `CAT_NORMAS`/`NORMAS` (no se encontró el motor de cálculo del puntaje en el frontend — probablemente vive en fórmulas de AppSheet aún no portadas, o se calcula manualmente).

## 4. Esquema de Base de Datos

Fuente: `admin-fed/src/esquema_bd.csv` (export manual, no hay migraciones SQL versionadas). **33 tablas de negocio** + vistas de sistema PostGIS (`geography_columns`, `geometry_columns`, `spatial_ref_sys`, confirmando PostGIS habilitado en el mismo proyecto).

**Núcleo del proceso de inspección:**
- `INSPECCIONES` (tabla raíz, PK `ID_Inspeccion` text) — `ID_Socio`, `ID_Organizacion`, `ID_Parcela`, `Fecha_Visita`, `Inspector`, `Estado`, `Tipo_Inspeccion`, `Resultado_Global`, `Firma_Productor`/`Firma_Inspector` (fotos/firmas como texto — probablemente rutas de archivo AppSheet), `url_pdf_generado`.
- `CAP_DATOS_SOCIO`, `CAP_MIC`, `CAP_CONSERVACION`, `CAP_BIENESTAR`, `CAP_RIESGOS`, `CAP_GESTION` — una tabla hija por pestaña del formulario, todas con PK propia + FK `ID_Inspeccion`, todas con `created_at`/`actualizado_en`.
- `NORMAS` — checklist de certificaciones (USDA-NOP, UE 2018/848, COR Canadá, Rainforest Alliance, Comercio Justo, Fair Trade USA) por inspección.
- `NO_CONFORMIDADES` — hallazgos: `id_norma` (FK a `CAT_NORMAS`), `respuesta`, `accion_correctiva`, `fecha_limite`, `responsable`, `foto`, `estado` (default `'Abierto'`).
- `FAMILIA` — datos de hijos del socio (nombre, fecha nacimiento, escolaridad) — **PII de menores**.

**Registro maestro (COMPARTIDO con `rysos`, ver hallazgo crítico):**
- `ORGANIZACIONES` (`ID`, `Nombre_Organizacion`, `RUC`, `Representante_Legal`, `Logo`, `Config`).
- `PADRON_SOCIOS` (`ID_Socio`, `ID_Organizacion`, `socio_dni`, `socio_nombre_completo`, certificaciones, ubicación) — el registro maestro de productores.
- `PADRON_PARCELAS` (`ID_Parcela_Fija`, `ID_Organizacion`, `ID_Socio`, `parcela_codigo`, `parcela_nombre`, desglose de hectáreas por uso (`hcp`/`hcc`/`ho`/`hip`/`hrp`/`hbp`), `totalh`, **`geom` (`USER-DEFINED` = tipo PostGIS)**.
- `PARCELAS` (84 columnas) — inspección detallada por parcela en cada visita: GPS/polígono, verificación de área (`area_reportada` vs `area_verificada` con `alerta_diferencia_area` — control de discrepancias), erosión, fuentes de agua, renovación/rehabilitación de cafetales, y **datos de colindancia en las 4 direcciones cardinales** (norte/sur/este/oeste: nombre del colindante, cultivo, riesgo de contaminación, prácticas) — el equivalente funcional más cercano a un análisis de riesgo de deforestación en fincas vecinas que tiene este sistema.
- `DETALLE_CAFE`, `DETALLE_FERTILIZACION`, `DETALLE_PLAGAS`, `DETALLE_SOMBRA` — detalle agronómico por parcela (variedad, densidad de siembra, fertilización, plagas, árboles de sombra).
- `USUARIOS` / `USUARIOS_LOGIN` — dos tablas casi idénticas (mismas 12 columnas: `ID_Usuario`, `Rol`, `Firma_Digital`, etc.) — probable remanente de la migración AppSheet→login real, a confirmar cuál es la vigente.

**Catálogos (`CAT_*`):** `CAT_FAUNA`, `CAT_FORESTAL`, `CAT_INSUMOS`, `CAT_NORMAS` (con `criticidad`/`certificacion`), `CAT_TEMAS_CAPACITACION`, `CAT_USO_TIERRA`, `CAT_VARIEDADES`.

**Meta/configuración (patrón notable, ver §5):** `MENU_APP` (navegación dirigida por datos — remanente AppSheet), `METADATOS_CAMPOS` (`modulo`, `tabla_origen`, `nombre_maquina`, `nombre_humano_defecto`, `orden_seccion`, `orden_pregunta`, `visible_pdf` — catálogo de labels/orden usado tanto para el frontend como para el render del PDF), `CONFIGURACION_REPORTES_ORG` (personalización de reportes por organización — nombres de campo, orden de impresión, visibilidad).

## 5. Recomendaciones de Portabilidad hacia RYSOS

Priorizadas por valor/esfuerzo, siguiendo metodología SDD (spec → plan → implementación → tests) para cada ítem que se decida portar:

### Alta prioridad

1. **El módulo de Inspección Socio-Económica/Certificación completo** (`CAP_DATOS_SOCIO`, `CAP_MIC`, `CAP_CONSERVACION`, `CAP_BIENESTAR`, `CAP_RIESGOS`, `CAP_GESTION` + su UI de 8 pestañas). `rysos` hoy solo cubre la dimensión geoespacial EUDR (`EUDR_MONITOREO`/`EUDR_USO_SUELO`/`EUDR_INSTALACIONES`) — no tiene ningún dato socio-económico, de bienestar laboral o de certificación orgánica/comercio justo del productor. Dado que **`PADRON_SOCIOS`/`PADRON_PARCELAS` ya son compartidas**, portar este módulo a `/dashboard` en Next.js sería completar el mismo padrón que `rysos` ya consume, no crear un sistema paralelo. Requiere: escribir spec/plan SDD, portar el Zod schema a validación equivalente en JS, y decidir si se reimplementa la UI en Next.js o se embebe la app Vite existente.
2. **Patrón "UPDATE-si-existe / INSERT-si-no" para escritura multi-tabla** (`useInspeccionForm.ts`, función `onSubmit`): verifica con `Promise.all` de `.maybeSingle()` qué filas hijas ya existen antes de decidir `update` vs `insert` por tabla. Es exactamente el problema que ya enfrentó el ETL de `rysos` (`scripts/etl_drive_to_supabase.py`, upserts idempotentes) — vale la pena comparar ambos enfoques antes de estandarizar uno.
3. **Patrón de guard anti-bucle en Database Webhooks** (`generar-pdf-fed/index.ts`, líneas 82-89): compara `payload.old_record` vs `payload.record` para detectar si el propio webhook disparó su propia actualización (al escribir `url_pdf_generado`) y corta la ejecución. Es un patrón genérico reutilizable para cualquier futuro trigger de `rysos` sobre `EUDR_MONITOREO` u otra tabla con columnas auto-escritas.

### Media prioridad

4. **PDF dirigido por metadatos** (`METADATOS_CAMPOS` + `buildSmartGrid()` en la Edge Function): en vez de hardcodear el layout del PDF como hace `scripts/generate_dossier_pdf.py` de `rysos`, esta tabla permite reordenar/renombrar/ocultar campos por organización sin tocar código (`CONFIGURACION_REPORTES_ORG` extiende esto por-org). Migrar el dossier PDF de `rysos` a este patrón sería más flexible para clientes con distintos formatos de certificación, pero es un cambio de arquitectura, no un port directo.
5. **Sistema de scoring de cumplimiento** (`men`/`may`/`obl`/`total_puntaje` por sección): el frontend solo persiste estos valores, no se encontró dónde se calculan (probablemente una fórmula AppSheet aún no portada). Antes de portar hay que localizar o reconstruir la lógica de cálculo — sin eso, portar solo las columnas no aporta valor.
6. **`FormField`/`FieldError` (`components/ui/FormHelpers.tsx`)**: primitivas mínimas (10 líneas) — trivial de replicar en JS, no amerita "portar" tanto como "inspirarse".

### Baja prioridad / no portar tal cual

7. **NO portar** el destinatario hardcodeado de Resend (`dneyser5@gmail.com` en `generar-pdf-fed/index.ts:301`) ni la dependencia del `APPSHEET_APP_ID` para descarga de imágenes — son artefactos de una configuración de desarrollo/transición específica de ese repo, no un patrón reutilizable.
8. **NO portar** el logging de depuración (`console.group`/`console.log(JSON.stringify(...))` de `useInspeccionForm.ts`) — expone `socio_dni`/`socio_nombre_completo` en la consola del navegador en producción. Si se porta cualquier lógica de ese hook, este logging debe eliminarse o quedar detrás de un flag de desarrollo explícito.
9. **`MENU_APP`** (navegación dirigida por tabla) — es un remanente directo de AppSheet; el sidebar modular que `rysos` ya construyó (`components/layout/DashboardSidebar.jsx`) resuelve el mismo problema de forma más simple (array estático en código) y no necesita esta indirección.

### Riesgo a resolver antes de portar cualquier ítem

10. **No hay migraciones SQL versionadas en `backend-inspecciones`** — antes de portar cualquier tabla (`FAMILIA`, `NO_CONFORMIDADES`, `CAT_NORMAS`, etc.) hay que confirmar su schema real contra la instancia viva (no contra `esquema_bd.csv`, que es un export manual y puede estar desactualizado), siguiendo el mismo patrón de verificación que ya se aplicó esta sesión al construir la Consola QC de `rysos` (dos discrepancias reales encontradas entre migración y base viva).

---

*Repositorio clonado temporalmente en `.temp/backend-inspecciones/`, eliminado tras completar esta auditoría. Ningún dato del repositorio auditado (incluyendo el archivo `.env` con credenciales de desarrollo) fue commiteado a `rysos`.*
