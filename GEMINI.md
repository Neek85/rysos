# GEMINI.md — Contexto de Gemini CLI para RYZOS

Este archivo es leído automáticamente por Gemini CLI en cada sesión. Su único propósito es apuntar a las fuentes de verdad reales del proyecto y fijar el límite de ejecución que le corresponde a esta herramienta — no duplica su contenido, para evitar que las dos copias se desincronicen.

## Fuentes de verdad (leer antes de cualquier tarea)
- `CLAUDE.md` — comandos reales, arquitectura del código tal como existe hoy, RLS gotchas. Fuente de verdad de "qué existe hoy".
- `docs/RYZOS_ORQUESTADOR_V3.1.md` — reglas de negocio, seguridad y el protocolo multi-IA (§4.1). Fuente de verdad de "qué reglas debe seguir el trabajo nuevo".
- `docs/ESTADO_PROYECTO.md`, `AI_STATE.md`, `docs/adr/*.md` (`docs/adr/INDEX.md` como punto de entrada), `specs/*.md` — bitácora y decisiones ya tomadas.
- `docs/schema_live_core.md` (siempre) + `docs/schema_live_agricola.md`/`docs/schema_live_pecuario.md` (según la vertical que toque la tarea) — esquema real en vivo. Verificar antes de proponer cualquier cambio de datos.

## Límite de ejecución — específico de Gemini CLI
Gemini CLI puede leer, escribir y ejecutar comandos directamente en este repositorio (`npm test`, `npm run build`, `git commit`/`push` a `staging`) para **tareas rutinarias sin riesgo de seguridad**, cerrando la tarea de punta a punta como lo hace Claude Code CLI.

Para cualquier tarea que toque las categorías "inviolables" de `docs/RYZOS_ORQUESTADOR_V3.1.md` §5 (SQL, RLS, migraciones, autenticación, sanitización de PII, o cualquier `DELETE`/`UPDATE` masivo) **Gemini CLI se detiene después de redactar el código y el plan de reversión — nunca lo aplica, nunca lo da por cerrado, y nunca hace push a `staging` sin decírselo antes al usuario.** Entrega el diff/SQL completo y le indica explícitamente al usuario: "esto necesita el visto bueno de seguridad de Claude (Cowork) antes de aplicarse — pásaselo con el prompt exacto para Claude Code CLI". Esta es la misma regla que ya aplicaba al Gem de Gemini (§4.1 del orquestador) — Gemini CLI no cambia el gate de seguridad, solo cambia que ahora Gemini también puede ejecutar directamente las tareas que SÍ están fuera de esas categorías.

Igual que Claude Code CLI, ninguna migración SQL se aplica automáticamente contra la base real: se crea el archivo en `supabase/migrations/`, se aplica puntualmente con `supabase db query --linked -f <archivo>` si hace falta probarla (nunca `supabase db push`, inseguro en este repo), pero la aplicación final contra producción siempre es un paso manual del usuario, posterior a la revisión de seguridad.

El sistema ya tiene login real por organización y rol (Supabase Auth + RLS de sesión, ver `docs/adr/ADR-032` a `ADR-039`) — cualquier escritura de usuario nueva sigue ese mismo patrón (sesión real vía `createSessionServerClient()`), nunca Service Role Key para escritura de usuario.

Nunca commitear directo a `main`. Siempre `staging`. Conventional Commits (`feat(modulo):`, `fix(modulo):`, `chore:`, `docs:`), sin modificarlo.
