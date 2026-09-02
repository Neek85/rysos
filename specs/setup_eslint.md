# SPEC: Configuración de ESLint para el código JS/JSX del frontend

## 1. Objetivo
Habilitar `npm run lint` de forma funcional y no interactiva sobre el
código plano (`.js`/`.jsx`, sin TypeScript) de `app/`, `components/`,
`lib/`, usando la configuración estándar de Next.js
(`eslint-config-next` vía `next/core-web-vitals`), sin migrar nada a
TypeScript ni alterar lógica de negocio.

## 2. Contexto: por qué esto no funcionaba hasta ahora
`CLAUDE.md` y varias entradas de `AI_STATE.md` (`2026-08-25` entre
otras) documentan que `npm run lint` (`next lint`) no podía correr en
este entorno. Causa raíz real, confirmada antes de tocar nada: no existe
ningún archivo de configuración de ESLint en el repo
(`.eslintrc.json`/`eslint.config.*`) ni las dependencias
`eslint`/`eslint-config-next` están instaladas (`package.json` no las
lista, `node_modules/.bin/eslint` no existe). `next lint` sin
configuración previa dispara un asistente **interactivo** (elegir
Strict/Base/Cancel, luego instala las dependencias él mismo) — eso es lo
que bloqueaba el comando en una sesión no interactiva, no un bug de
Next.js ni del proyecto. La solución es declarar la configuración de
forma explícita ANTES de correr `next lint`, para que nunca dispare ese
asistente.

## 3. Invariantes de Negocio y Seguridad
- **Sin TypeScript:** el código web existente sigue siendo `.js`/`.jsx`
  plano (`CLAUDE.md`, "Estado técnico real del código web"). Este setup
  no agrega `tsconfig.json` ni migra ningún archivo.
- **Sin cambios de lógica:** cualquier corrección que `npm run lint`
  fuerce debe ser mecánica (imports no usados, hooks mal declarados,
  etc.) — nunca un cambio de comportamiento observable. Si un hallazgo
  del linter requiere una decisión de diseño (no un fix mecánico obvio),
  se documenta y se deja para una tarea aparte en vez de forzarlo acá.
- **Directorios pesados/autogenerados fuera del lint:** `node_modules/`,
  `.next/`, `out/`, `dist/`, `public/` (estos 2 últimos no existen hoy en
  el repo, se excluyen igual de forma preventiva por si se agregan más
  adelante).
- **Protocolo de recuperación (Sección 3.2 del orquestador):** si tras 2
  intentos reales de correr `npm run lint` sigue fallando por un motivo
  no mecánico, se detiene la tarea y se documenta la causa raíz en
  `AI_STATE.md` en vez de seguir reintentando ciegamente.

## 4. Criterios de Aceptación
- [ ] `npm run lint` corre de punta a punta sin pedir ningún input
      interactivo, en esta sesión y en cualquier sesión futura.
- [ ] `.eslintrc.json` extiende `next/core-web-vitals`.
- [ ] `node_modules/`, `.next/`, `out/`, `dist/`, `public/` quedan
      excluidos del lint.
- [ ] `eslint`/`eslint-config-next` quedan declarados en
      `devDependencies` de `package.json`, en una versión compatible con
      `next@^14.2.0` ya instalado.
- [ ] Todo error/warning real que `next lint` reporte sobre código
      existente queda corregido de forma mínima, o documentado
      explícitamente si no es un fix mecánico seguro.
- [ ] `npm run build` sigue compilando limpio después del setup.
- [ ] `node --test tests/*.mjs` sigue en 692/692 (este cambio no toca
      ningún módulo `lib/*.js` testeado).

## 5. Plan de Despliegue
1. Agregar `eslint`/`eslint-config-next` a `devDependencies`,
   `npm install`.
2. Crear `.eslintrc.json` (`{ "extends": "next/core-web-vitals" }`) y
   `.eslintignore` con los 5 directorios de la Sección 3.
3. Correr `npm run lint`, revisar la salida real.
4. Corregir hallazgos mecánicos; documentar cualquier hallazgo no trivial
   sin tocarlo.
5. `npm run build` + `node --test tests/*.mjs` para confirmar que nada
   se rompió.
6. Documentar el resultado en `AI_STATE.md`.
