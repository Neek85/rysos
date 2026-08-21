# ESTADO DEL PROYECTO RYZOS
*Última actualización: 20 de agosto, 2026*

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

---

## 📌 PRÓXIMA VEZ QUE ABRAS UNA CONVERSACIÓN

Si vienes de una pausa, simplemente di: **"Lee el estado del proyecto y sigamos donde quedamos."** No necesitas repetir el contexto — este documento lo tiene.