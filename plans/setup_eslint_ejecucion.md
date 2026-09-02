# PLAN DE EJECUCIÓN: Configuración de ESLint (setup_eslint)

## 1. Pasos de Desarrollo
1. **Dependencias:** agregar `eslint` y `eslint-config-next` a
   `devDependencies` en `package.json`, en una versión `^14.2.x`
   (misma major/minor que `next`, ya en `^14.2.0`). `npm install` para
   materializarlas en `node_modules/`.
2. **Configuración explícita (evita el asistente interactivo de `next
   lint`):**
   - `.eslintrc.json`: `{ "extends": "next/core-web-vitals" }`.
   - `.eslintignore`: `node_modules/`, `.next/`, `out/`, `dist/`,
     `public/`.
3. **Script `lint`:** ya existe (`"lint": "next lint"` en
   `package.json`) — no requiere cambio, solo confirmarlo.
4. **Ejecución real:** `npm run lint`. Si reporta hallazgos:
   - Mecánicos (import no usado, dependencia de hook faltante que no
     cambia el comportamiento real, etc.): corregir directo.
   - No mecánicos (requieren juicio de diseño): documentar en
     `AI_STATE.md`, no forzar un fix.
5. **Validación de build:** `npm run build` (higiene de dev server:
   matar `node`, `rm -rf .next` si había un `next dev` corriendo antes).
6. **Regresión de la suite existente:** `node --test tests/*.mjs` — debe
   seguir en 692/692, este cambio no toca ningún módulo `lib/*.js`
   testeado.
7. **Documentación:** entrada nueva en `AI_STATE.md` con el resultado
   real (qué encontró el linter, qué se corrigió, qué quedó
   documentado sin tocar).

## 2. Plan de Rollback
Si `npm run lint` termina bloqueando el flujo de forma no resoluble
(tras 2 intentos reales, por el protocolo de la Sección 3.2 del
orquestador):
- `.eslintrc.json`/`.eslintignore` son archivos nuevos, sin efecto sobre
  nada existente si se eliminan.
- Revertir `package.json` a su estado anterior (quitar las 2
  `devDependencies` agregadas) y `npm install` de nuevo restaura
  `node_modules/` al estado previo.
- Ningún archivo de `app/`/`components/`/`lib/` se toca hasta que el
  paso 4 confirme qué hallazgos son reales y mecánicos — no hay cambios
  de lógica que revertir si se aborta antes de ese paso.
